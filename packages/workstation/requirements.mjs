/** Two-field requirement authoring: preserve source and edited Gherkin independently. */
import { readFile } from 'node:fs/promises';
import { id, invariant, digest, identity, safePath, exists, readJson, writeJson, atomicWrite } from '../contracts/index.mjs';
import { createFeature, scan, assertFileEditable } from '../spec-toolkit/index.mjs';

export const MAX_REQUIREMENT_BYTES = 256 * 1024;
export function requirementText(value, label, { empty = true } = {}) {
  invariant(typeof value === 'string' && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value) && Buffer.byteLength(value) <= MAX_REQUIREMENT_BYTES,
    'INVALID_REQUIREMENT_TEXT', `${label}必須是 256 KiB 以內的文字。`);
  invariant(empty || value.trim(), 'DESCRIPTION_REQUIRED', '請先描述需求或上傳文件。');
  return value;
}
const oneLine = value => value.replace(/\s+/g, ' ').trim().slice(0, 160);
const heading = /^(?:Feature|功能|機能|特性):\s*(.+)$/m;
export function requirementTitle(gherkin, description) {
  return oneLine(heading.exec(gherkin)?.[1] || description.split(/\r?\n/).find(x => x.trim())?.replace(/^#+\s*/, '') || '未命名需求');
}
/** No AI completion is claimed: this local formatter preserves supplied outcomes.
 * The generated grammar subset is also parsed by official Cucumber in browser CI.
 * It never executes or treats requirement/document text as instructions.
 */
export function generateRequirement(description) {
  requirementText(description, '需求描述', { empty: false });
  const normalized = description.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (/^(?:#[^\n]*\n\s*)*(?:Feature|功能|機能|特性):/.test(normalized)) {
    const diagnostics = requirementDiagnostics(normalized);
    // Existing Gherkin may be unfinished. Generating a draft is not approval.
    return { gherkin: normalized + '\n', diagnostics, suggestions: requirementSuggestions(normalized), method: 'existing-gherkin', draft: true };
  }
  const lines = normalized.split(/\n+/).map(x => x.replace(/^\s*(?:[-*•]|\d+[.)、]|#+)\s*/, '').trim()).filter(Boolean);
  const title = oneLine(lines[0]);
  let clauses = lines.length > 1 ? lines.slice(1) : lines;
  clauses = clauses.flatMap(x => x.split(/(?<=[。！？])\s*/u)).filter(Boolean);
  invariant(clauses.length <= 100, 'TOO_MANY_SCENARIOS', '文件包含超過 100 個敘述，請將需求分成較小範圍；原文未被修改。');
  // Long paragraphs remain intact as description; do not silently truncate requirements.
  const output = [`Feature: ${title}`, '  # 依原始描述整理的草稿；請審閱前置條件、操作及預期結果。'];
  for (const [index, raw] of clauses.entries()) {
    const text = raw.replace(/[。；;]$/, ''), number = String(index + 1).padStart(3, '0');
    let action = '使用者執行此情境的操作', outcome = text;
    const split = /^(?:當|如果|若)?(.+?)(?:後[，,：:]?|時[，,：:]?|[，,]\s*(?=應|會|可以|能|必須|要|則|顯示|出現|不|無法))\s*(.+)$/.exec(text);
    if (split) { action = split[1].trim(); outcome = split[2].replace(/^則\s*/, '').trim(); }
    output.push('', `  @case:CASE-${number}`, `  Scenario: ${oneLine(text)}`,
      '    Given 使用者已具備此情境所需的前置條件', `    When ${action}`, `    Then ${outcome}`);
  }
  const gherkin = output.join('\n') + '\n';
  requirementText(gherkin, 'Gherkin');
  const diagnostics = requirementDiagnostics(gherkin);
  invariant(!diagnostics.length, 'GENERATION_FORMAT_ERROR', '草稿未通過格式檢查；下方內容未被修改。');
  return { gherkin, diagnostics, suggestions: requirementSuggestions(gherkin), method: 'local-format-draft', draft: true };
}
/** Non-blocking editorial suggestions. Do not inspect comments or document data,
 * and never infer approval or test success from words chosen by the author.
 */
export function requirementSuggestions(text) {
  const suggestions = []; let docString = null;
  for (const [index, row] of text.split(/\r?\n/).entries()) {
    const line = row.trim();
    if (docString) { if (line.startsWith(docString)) docString = null; continue; }
    if (/^("""|```)/.test(line)) { docString = line.slice(0, 3); continue; }
    if (/^(Then|那麼|那么)\s+請補充可驗收的結果[。.]?$/.test(line)) {
      suggestions.push({ line: index + 1, code: 'LEGACY_PLACEHOLDER',
        message: '這行是舊範本的提示文字，可在下方改寫；不會阻擋儲存或人工確認。' });
    }
  }
  return suggestions.slice(0, 10);
}
/** Conservative structural diagnostics, not a substitute for full BDD discovery.
 * Do not require a When/Then pair: static checks, Background and * are valid styles.
 * Business adequacy belongs to the human reviewer; execution remains a separate gate.
 * Invalid/incomplete drafts remain saveable.
 */
export function requirementDiagnostics(text) {
  if (!text.trim()) return [{ line: 1, message: '請產生或填寫下方 Gherkin 後再確認需求。' }];
  const errors = [], rows = text.split(/\r?\n/);
  const add = (line, message) => errors.push({ line, message });
  let featureCount = 0, scenarios = [], current, docString = null, examples = false;
  for (let i = 0; i < rows.length; i++) {
    const line = rows[i].trim(), number = i + 1;
    if (docString) { if (line.startsWith(docString)) docString = null; continue; }
    if (/^("""|```)/.test(line)) { if (!current?.steps.length) add(number, 'Doc String 必須放在步驟之後。'); docString = line.slice(0, 3); continue; }
    if (!line || line.startsWith('#') || line.startsWith('@')) continue;
    if (/^(Feature|功能|機能|特性):/.test(line)) { featureCount++; if (!line.split(':').slice(1).join(':').trim()) add(number, 'Feature 必須有名稱。'); continue; }
    if (/^(Scenario(?: Outline| Template)?|Example|場景(?:大綱)?|劇本(?:大綱)?|情境(?:大綱)?):/.test(line)) {
      if (!featureCount) add(number, 'Scenario 必須放在 Feature 之內。');
      current = { line: number, steps: [], outline: /Outline|Template|大綱/.test(line), examples: false }; scenarios.push(current); examples = false;
      if (!line.split(':').slice(1).join(':').trim()) add(number, 'Scenario 必須有名稱。'); continue;
    }
    if (/^(Background|背景):/.test(line)) { current = { line: number, steps: [], background: true }; examples = false; continue; }
    if (/^(Rule|規則):/.test(line)) { current = null; examples = false; continue; }
    if (/^(Examples|Scenarios|例子|範例):/.test(line)) { if (!current?.outline) add(number, 'Examples 必須屬於 Scenario Outline。'); else current.examples = true; examples = true; continue; }
    if (/^(Given|When|Then|And|But|假如|假設|假定|當|那麼|那么|並且|而且|但是|\*)\s+\S/.test(line)) {
      if (!current) add(number, '步驟必須放在 Scenario 或 Background 內。');
      else { if (examples) add(number, 'Examples 表格後不可再加入步驟。'); current.steps.push(line); }
      continue;
    }
    if (line.startsWith('|')) { if (!current || (!examples && !current.steps.length)) add(number, '資料表必須放在步驟或 Examples 之後。'); continue; }
    if (current?.steps.length) add(number, `第 ${number} 行不是有效的 Gherkin 步驟，請使用 Given／When／Then／And。`);
  }
  if (featureCount !== 1) add(1, '一份需求需要且只能包含一個 Feature。');
  if (!scenarios.length) add(1, '請至少加入一個 Scenario。');
  for (const s of scenarios) {
    if (!s.steps.length) add(s.line, '此 Scenario 尚無步驟，請在下方加入至少一個步驟；草稿仍可儲存。');
    if (s.outline && !s.examples) add(s.line, 'Scenario Outline 需要 Examples。');
  }
  if (docString) add(rows.length, 'Doc String 尚未關閉。');
  return errors.slice(0, 20);
}
export function composerPaths(requirementId, featureId) {
  const key = `${id(requirementId)}/${id(featureId)}`;
  return { key, gherkin: `spec/${key}/${featureId}.feature`, source: `spec/${key}/requirement-source.json`, metadata: `spec/${key}/feature.yaml` };
}
export async function readComposer(root, requirementId, featureId) {
  const p = composerPaths(requirementId, featureId), gherkin = await readFile(await safePath(root, p.gherkin, { missing: false }), 'utf8');
  const source = await exists(await safePath(root, p.source)) ? await readJson(await safePath(root, p.source)) : { description: '' };
  // Existing hand-authored files are untouched; never synthesize a source description.
  const description = source.description ?? '';
  return { requirementId, featureId, key: p.key, description, gherkin,
    token: identity({ description, gherkin }), diagnostics: requirementDiagnostics(gherkin), suggestions: requirementSuggestions(gherkin) };
}
export async function saveComposer(root, input) {
  const description = requirementText(input.description, '需求描述'), gherkin = requirementText(input.gherkin, 'Gherkin');
  invariant(description.trim() || gherkin.trim(), 'EMPTY_REQUIREMENT', '請先填寫需求描述或 Gherkin。');
  let requirementId = input.requirementId, featureId = input.featureId;
  const title = requirementTitle(gherkin, description);
  if (requirementId || featureId) {
    invariant(requirementId && featureId, 'INVALID_REQUIREMENT_ID', '需求識別不完整。');
    const current = await readComposer(root, requirementId, featureId);
    invariant(input.expectedToken === current.token, 'CONTENT_CHANGED', '這份需求已由其他操作更新，兩個編輯區的草稿都已保留。', 409);
    await assertFileEditable(root, composerPaths(requirementId, featureId).gherkin);
  } else {
    invariant(input.expectedToken === null, 'CONTENT_CHANGED', '請以新的需求表單儲存。', 409);
    const features = (await scan(root)).features; let n = 1;
    while (features.some(f => f.requirementId === `REQ-${String(n).padStart(3, '0')}`)) n++;
    requirementId = `REQ-${String(n).padStart(3, '0')}`; featureId = 'feature';
    await createFeature(root, { requirementId, featureId, title, projectIds: input.projectIds ?? [] });
  }
  const p = composerPaths(requirementId, featureId), meta = await readJson(await safePath(root, p.metadata));
  // Edited Gherkin is authoritative. Keep its exact bytes, including unfinished text.
  const cases = [...gherkin.matchAll(/(?:^|\s)@case:([A-Za-z0-9][A-Za-z0-9_-]{0,79})(?=\s|$)/g)].map(x => x[1]);
  const caseIds = [...new Set(cases)];
  await atomicWrite(await safePath(root, p.gherkin), gherkin);
  await writeJson(await safePath(root, p.source), { schemaVersion: 1, description });
  await writeJson(await safePath(root, p.metadata), { ...meta, title, ...(caseIds.length ? { caseIds } : {}) });
  return { ...(await readComposer(root, requirementId, featureId)), sha256: digest(gherkin) };
}
