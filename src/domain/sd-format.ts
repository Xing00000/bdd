/** Canonical headings for one Gherkin's dedicated .sd.md. */
export const sdSections = [
  '1. 核准基準與文件歸屬',
  '2. 核心範圍與技術選擇',
  '3. 架構、開發目錄與流程設計',
  '4. 階段、確認與失效',
  '5. 文件與測試的權威來源',
  '6. 入庫檢核、正規化與穩定識別',
  '7. 資料庫 DDL／DML 與 migration',
  '8. 核心 API、事件與可觀察結果',
  '9. 同會話瀏覽器、親自錄製與重播',
  '10. Workspace、PTY 與執行生命週期',
  '11. codegen 與 BDD 補齊設計',
  '12. DB UI、人類流程測試及報告',
  '13. 實作順序、驗收覆蓋與待確認事項',
  '14. 驗收測試契約',
] as const;

export const sdGenerationTask = `Draft a Traditional Chinese <feature-name>.sd.md for human review, dedicated to the supplied Gherkin. Do not change Gherkin or claim human approval. Use these exact level-two headings, in order:
${sdSections.map(section => `## ${section}`).join('\n')}
Each section must contain concrete design derived from the input, or an explicit not-applicable reason. Do not copy workbench-specific technologies or capabilities into unrelated projects: headings about browser recording, DB UI or PTY may be not applicable.
Include metadata (requirement, source Gherkin version/hash when supplied, SD version and pending approval status). Section 3 must include the planned development file tree inside a fenced text code block, each file/module's responsibility, plus concrete control/data flows, transaction boundaries and failure handling. Distinguish existing files from planned changes.
Section 7 must state the database dialect/version, complete DDL with keys/constraints/indexes, parameterized business DML with parameter meanings and transaction boundaries, deployment seed/backfill DML separately, migration order and source/target schema versions, prerequisites, rollback/backup and data risks. Explicitly state when deployment DML is unnecessary; do not invent seed records or empty SQL placeholders.
Define how the program produces deploy/ containing migration SQL, DDL and any required deployment DML from the canonical schema/migrations, an ordered manifest with source hashes, and execution/rollback instructions. Treat deploy/ as generated output, never a second editable schema. Do not claim generation or execution has occurred. Do not mix target test DB fixtures into production migrations. Section 14 must include the feature's test interfaces, fixtures, locators and environment requirements without creating a separate CONTRACT.md. List unresolved facts as questions instead of guessing. Use supplied source files, database schema, seed fixtures, Gherkin metadata, and existing SD as authoritative evidence; do not ask the user to repeat facts that those inputs establish. For this SD workflow, a pending-review proposal may include unresolved non-blocking compatibility or environment questions in section 13 and still return status="completed". Return status="needs_input" only when a missing or conflicting source prevents a faithful design of the approved acceptance behavior or the required SD structure.`;

export type SdDiagnostic = { file: string; line: number; column: number; reason: string };

export function validateSdFormat(rawText: string, file: string): SdDiagnostic[] {
  const lines = rawText.split(/\r?\n/);
  const headings: { title: string; line: number }[] = [];
  let fence: string | undefined;
  for (const [line, text] of lines.entries()) {
    const marker = text.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = undefined;
      continue;
    }
    if (!fence && text.startsWith('## ')) headings.push({ title: text.slice(3).trim(), line });
  }
  const problems: SdDiagnostic[] = [];
  const diagnostic = (line: number, reason: string) => problems.push({ file, line: line + 1, column: 1, reason });
  let previous = -1;
  for (const section of sdSections) {
    const matches = headings.filter(heading => heading.title === section);
    if (matches.length !== 1) { diagnostic(matches[0]?.line ?? 0, `SD 必須恰有一個章節：${section}`); continue; }
    const start = matches[0].line;
    if (start <= previous) diagnostic(start, `SD 章節順序錯誤：${section}`);
    previous = start;
    const end = headings.find(heading => heading.line > start)?.line ?? lines.length;
    const body = lines.slice(start + 1, end).join('\n').trim();
    if (!body) diagnostic(start, `SD 章節缺少內容或不適用原因：${section}`);
    if (section === sdSections[2] && !/(?:```|~~~)(?:text)?\s*\n[\s\S]+?(?:```|~~~)/.test(body))
      diagnostic(start, 'SD 架構章節必須包含預計開發的檔案目錄結構');
    if (section === sdSections[6] && !/(?:```|~~~)sql\s*\n[\s\S]+?(?:```|~~~)/i.test(body)
      && !/(?:無資料庫|不使用資料庫|不涉及資料庫|資料庫不適用)[^\n]*[：:，,].+/.test(body))
      diagnostic(start, 'SD 資料庫章節必須包含 SQL 或明確的不適用原因');
  }
  return problems;
}
