import {assertDesignDecisionsResolved,parseDesignDecisions} from './design-decisions.mjs';
import { readdir, readFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { id, invariant, version, exists, safePath, walk, readJson, writeJson, atomicWrite, digest, identity } from '../contracts/index.mjs';
import { gitSourcePaths, gitSourceFiles } from '../git-core/index.mjs';

import { validateContract } from '../contracts/schemas.mjs';

export const layout = Object.freeze({ specRoot: 'spec', testsRoot: 'tests', reportsRoot: 'reports', projectsRoot: 'projects' });
const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
const json = value => `${JSON.stringify(value, null, 2)}\n`;
export function featureKey(requirementId, featureId) { return `${id(requirementId, 'requirementId')}/${id(featureId, 'featureId')}`; }
export const reviewKinds = Object.freeze(['gherkin','sd','tests']);
export const defaultProfiles = Object.freeze(['chromium']);
export function reviewStage(confirmed) {
  const pending=reviewKinds.find(kind=>!confirmed[kind]);
  return pending?{gherkin:'GHERKIN',sd:'SD',tests:'TESTS'}[pending]:'IMPLEMENTATION';
}
async function directories(root, relative) {
  const directory = await safePath(root, relative);
  if (!await exists(directory)) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) invariant(!entry.isSymbolicLink(), 'SYMLINK_FORBIDDEN', `${relative}/${entry.name}`);
  return entries.filter(x => x.isDirectory() && !x.name.startsWith('_')).map(x => id(x.name)).sort();
}
export async function configuration(root) {
  const config = version(await readJson(await safePath(root, 'workbench.yaml', { missing: false })));
  validateContract('workbench', config);
  id(config.specRepositoryId, 'specRepositoryId');
  invariant(identity(config.layout) === identity(layout), 'INVALID_LAYOUT', 'v1 requires spec/, tests/, reports/ and projects/');
  invariant(Array.isArray(config.projects), 'INVALID_PROJECTS', 'projects must be an array');
  for (const p of config.projects) { id(p.id, 'projectId'); invariant(p.path === `projects/${p.id}`, 'INVALID_PROJECT_PATH', 'Project path must be projects/<id>'); }
  invariant(new Set(config.projects.map(p => p.id)).size === config.projects.length, 'DUPLICATE_PROJECT', 'Duplicate project IDs');
  invariant(config.execution?.featureIsolation === 'process', 'INVALID_EXECUTION', 'Each feature must run in its own process');
  invariant(config.reports?.storage === 'git' && config.reports.publishMode === 'explicit', 'INVALID_REPORT_POLICY', 'v1 reports use Git and explicit publication');
  return config;
}
export const TOOLKIT_VERSION = '1.8.0';
export const TOOLKIT_FILES = Object.freeze(['contracts/index.mjs', 'contracts/schemas.mjs', 'git-core/index.mjs', 'git-core/source-files.mjs', 'git-core/vendor/ignore.cjs', 'git-core/vendor/ignore-LICENSE', 'git-core/progress.mjs', 'git-core/progress-store.mjs', 'spec-toolkit/index.mjs', 'spec-toolkit/design-decisions.mjs', 'spec-toolkit/engine.mjs', 'spec-toolkit/workspace.mjs', 'spec-toolkit/source-checkpoint.mjs', 'spec-toolkit/reporter.mjs', 'spec-toolkit/tags.mjs', 'spec-toolkit/dependencies.mjs', 'spec-toolkit/cli.mjs']);
export async function toolkitSnapshot(toolkitRoot) {
  const files = await Promise.all(TOOLKIT_FILES.map(async relative => ({ path: relative, content: await readFile(path.join(toolkitRoot, relative)) })));
  return { files, manifest: { schemaVersion: 1, version: TOOLKIT_VERSION, files: files.map(x => ({ path: x.path, sha256: digest(x.content) })) } };
}
export async function initialize(root, { specRepositoryId, templateRoot = path.join(sourceRoot, 'templates/spec-repo/v1'), toolkitRoot = path.join(sourceRoot, 'packages') }) {
  id(specRepositoryId, 'specRepositoryId');
  const existing = (await readdir(root)).filter(name => name !== '.git');
  invariant(existing.length === 0, 'REPOSITORY_NOT_EMPTY', 'Initialization only accepts an empty Git working directory', 409);
  const files = await walk(templateRoot);
  for (const relative of files) {
    const destination = await safePath(root, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(templateRoot, relative), destination);
  }
  const config = await readJson(path.join(root, 'workbench.yaml')); config.specRepositoryId = specRepositoryId;
  await writeJson(path.join(root, 'workbench.yaml'), config);
  const snapshot = await toolkitSnapshot(toolkitRoot);
  for (const file of snapshot.files) await atomicWrite(await safePath(root, `.workbench-tools/${file.path}`), file.content);
  await writeJson(path.join(root, '.workbench-tools/manifest.json'), snapshot.manifest);
  return { schemaVersion: 1, files: [...files, ...snapshot.files.map(x => `.workbench-tools/${x.path}`), '.workbench-tools/manifest.json'], requiresDependencyLock: true };
}

const singleLine = (value, limit = 260) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
export function buildGuidedFeature(input) {
  const title = singleLine(input.title, 160);
  invariant(title.length > 0, 'INVALID_TITLE', '請先寫下需求名稱。');
  const goal = singleLine(input.goal, 500);
  const raw = String(input.acceptance ?? '');
  invariant(raw.length <= 4000, 'ACCEPTANCE_TOO_LONG', '驗收結果最多 4000 字。');
  const acceptance = raw.split(/\r?\n/).map(x => singleLine(x.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, ''), 220)).filter(Boolean);
  invariant(acceptance.length <= 12, 'TOO_MANY_CASES', '每個功能最多 12 項驗收結果，請先拆成多個功能。');
  const criteria = acceptance.length ? acceptance : ['請補充可驗收的結果'];
  const lines = ['# BDD-WORKBENCH-GUIDED-V1', `Feature: ${title}`];
  if (goal) lines.push(`  目標：${goal}`);
  for (const [index, item] of criteria.entries()) {
    const number = String(index + 1).padStart(3, '0');
    lines.push('', `  @case:CASE-${number}`, `  Scenario: ${item}`,
      `    Given 系統已準備好讓使用者操作 ${title}`,
      `    When 使用者嘗試完成 ${title}`,
      `    Then ${item}`);
  }
  return { title, goal, acceptance: criteria.join('\n'), caseIds: criteria.map((_, i) => `CASE-${String(i + 1).padStart(3, '0')}`), featureText: lines.join('\n') + '\n' };
}
export function parseGuidedFeature(text) {
  if (typeof text !== 'string' || !text.startsWith('# BDD-WORKBENCH-GUIDED-V1\n')) return null;
  const title = /^Feature: (.+)$/m.exec(text)?.[1];
  const goal = /^  目標：(.+)$/m.exec(text)?.[1] ?? '';
  const acceptance = [...text.matchAll(/^    Then (.+)$/gm)].map(match => match[1]).join('\n');
  if (!title || !acceptance) return null;
  const draft = buildGuidedFeature({ title, goal, acceptance });
  return draft.featureText === text ? { title: draft.title, goal: draft.goal, acceptance: draft.acceptance } : null;
}

export async function createFeature(root, input) {
  const key = featureKey(input.requirementId, input.featureId), config = await configuration(root);
  invariant(typeof input.title === 'string' && input.title.trim() && input.title.length <= 300 && !/[\r\n]/.test(input.title), 'INVALID_TITLE', 'A one-line title is required');
  const projectIds = input.projectIds ?? [];
  invariant(Array.isArray(projectIds) && new Set(projectIds).size === projectIds.length && projectIds.every(p => config.projects.some(x => x.id === p)), 'UNKNOWN_PROJECT', 'Feature references an unknown project');
  const directory = await safePath(root, `spec/${key}`);
  invariant(!await exists(directory), 'FEATURE_EXISTS', 'Feature already exists', 409);
  const requirementPath = await safePath(root, `spec/${input.requirementId}/requirement.yaml`);
  const requirement = await exists(requirementPath) ? version(await readJson(requirementPath))
    : { schemaVersion: 1, id: input.requirementId, title: input.title, features: [] };
  invariant(requirement.id === input.requirementId && Array.isArray(requirement.features) && !requirement.features.includes(input.featureId), 'INVALID_REQUIREMENT', 'Requirement metadata does not match its directory');
  const draft = input.guided ? buildGuidedFeature(input) : null;
  const caseId = 'CASE-001';
  const files = {
    [`spec/${key}/feature.yaml`]: json({ schemaVersion: 1, id: input.featureId, requirementId: input.requirementId, title: input.title, projectIds, caseIds: draft?.caseIds ?? [caseId], profiles: [...defaultProfiles] }),
    [`spec/${key}/${input.featureId}.feature`]: draft?.featureText ?? `Feature: ${input.title}\n\n  @case:${caseId}\n  Scenario: Define acceptance behaviour\n    Given the acceptance steps have not been implemented\n`,
    [`spec/${key}/${input.featureId}.sd.md`]: `# ${input.title}\n\nStatus: DRAFT\n\n## Scope\n\n## Architecture\n\n## Data and migrations\n\n## Test and deployment contract\n`,
    [`tests/${key}/${input.featureId}.steps.ts`]: '',
    [`tests/${key}/${input.featureId}.hooks.ts`]: '',
    [`tests/${key}/fixtures/.gitkeep`]: '', [`tests/${key}/support/.gitkeep`]: '',
    [`reports/${key}/.gitkeep`]: ''
  };
  for (const [relative, content] of Object.entries(files)) await atomicWrite(await safePath(root, relative), content);
  requirement.features.push(input.featureId); requirement.features.sort(); await writeJson(requirementPath, requirement);
  const reviewPath = await safePath(root, `spec/${input.requirementId}/review.json`);
  if (!await exists(reviewPath)) await writeJson(reviewPath, { schemaVersion: 1, features: {} });
  return { key, files: Object.keys(files), stage: 'GHERKIN' };
}
export async function assertFeatureActive(root,requirementId,featureId) {
  const key=featureKey(requirementId,featureId),feature=version(await readJson(await safePath(root,`spec/${key}/feature.yaml`,{missing:false})));
  validateContract('feature',feature);
  invariant(!feature.deletedAt,'FEATURE_DELETED','需求已刪除，不能再修改或執行。',409);
  return feature;
}
/** Logical removal preserves canonical files, identifiers and historical evidence. */
export async function deleteFeature(root,input) {
  const key=featureKey(input.requirementId,input.featureId);
  invariant(input.confirmedKey===key,'CONFIRMATION_REQUIRED','請先確認要刪除的需求。',409);
  const feature=(await scan(root,{includeDeleted:true})).features.find(f=>f.key===key);
  invariant(feature&&!feature.deletedAt,'FEATURE_NOT_FOUND','找不到可刪除的需求。',404);
  const file=await safePath(root,`spec/${key}/feature.yaml`,{missing:false}),metadata=await readJson(file),deletedAt=new Date().toISOString();
  await writeJson(file,{...metadata,deletedAt});
  return {key,title:feature.title,deleted:true,deletedAt};
}
export async function scan(root, {includeDeleted=false}={}) {
  const config = await configuration(root), features = [];
  for (const requirementId of await directories(root, 'spec')) {
    const requirement = version(await readJson(await safePath(root, `spec/${requirementId}/requirement.yaml`, { missing: false })));
    validateContract('requirement', requirement);
    invariant(requirement.id === requirementId, 'REQUIREMENT_ID_MISMATCH', requirementId);
    const featureIds = await directories(root, `spec/${requirementId}`);
    invariant(Array.isArray(requirement.features) && identity([...requirement.features].sort()) === identity(featureIds), 'FEATURE_INDEX_MISMATCH', requirementId);
    validateContract('review', version(await readJson(await safePath(root, `spec/${requirementId}/review.json`, { missing: false }))));
    for (const featureId of featureIds) {
      const key = featureKey(requirementId, featureId);
      const feature = version(await readJson(await safePath(root, `spec/${key}/feature.yaml`, { missing: false })));
      validateContract('feature', feature);
      invariant(feature.id === featureId && feature.requirementId === requirementId, 'FEATURE_ID_MISMATCH', key);
      invariant(Array.isArray(feature.projectIds) && new Set(feature.projectIds).size === feature.projectIds.length
        && feature.projectIds.every(p => config.projects.some(x => x.id === p)), 'UNKNOWN_PROJECT', key);
      for (const field of ['caseIds', 'profiles']) {
        invariant(Array.isArray(feature[field]) && (feature[field].length > 0 || feature.authoringOnly && field === 'profiles') && new Set(feature[field]).size === feature[field].length, 'INVALID_FEATURE_MATRIX', `${key}.${field}`);
        feature[field].forEach(value => id(value, field));
      }
      invariant(feature.profiles.every(p => ['chromium', 'firefox', 'webkit'].includes(p)), 'UNSUPPORTED_PROFILE', key);
      const testPaths = feature.authoringOnly ? [] : [`tests/${key}/${featureId}.steps.ts`, `tests/${key}/${featureId}.hooks.ts`];
      for (const file of [`spec/${key}/${featureId}.feature`, `spec/${key}/${featureId}.sd.md`, ...testPaths])
        await readFile(await safePath(root, file, { missing: false }));
      const testPlan = { paths: testPaths, ready: !feature.authoringOnly && (await Promise.all(testPaths.map(async file => Boolean((await readFile(await safePath(root, file), 'utf8')).trim())))).every(Boolean) };
      features.push({ ...feature, key, testPlan });
    }
  }
  for (const area of ['tests', 'reports']) for (const req of await directories(root, area))
    for (const feature of await directories(root, `${area}/${req}`)) invariant(features.some(x => x.key === `${req}/${feature}`), 'ORPHAN_FEATURE_DIRECTORY', `${area}/${req}/${feature}`);
  return { config, features:includeDeleted?features:features.filter(f=>!f.deletedAt) };
}
export async function validateToolkitSnapshot(root) {
  const snapshot = version(await readJson(await safePath(root, '.workbench-tools/manifest.json', { missing: false })));
  invariant(Array.isArray(snapshot.files) && snapshot.files.length > 0, 'INVALID_TOOLKIT_MANIFEST', 'Toolkit manifest is empty');
  for (const entry of snapshot.files) invariant(digest(await readFile(await safePath(root, `.workbench-tools/${entry.path}`, { missing: false }))) === entry.sha256, 'TOOLKIT_HASH_MISMATCH', entry.path);
  return snapshot;
}
export async function validate(root, git, { pinned = false } = {}) {
  const result = await scan(root), modules = await git.modules(root);
  invariant(identity(modules.map(x => x.path).sort()) === identity(result.config.projects.map(x => x.path).sort()), 'PROJECT_GITLINK_MISMATCH', 'workbench.yaml and .gitmodules/gitlinks differ');
  if (pinned) invariant(modules.every(x => x.actual === x.commit && !x.dirty), 'SUBMODULE_NOT_PINNED', 'Initialize clean projects at their recorded gitlinks');
  const tracked = (await git.command(root, ['ls-files', '-z'])).stdout.split('\0').filter(Boolean);
  invariant(!tracked.some(x => /^(\.runtime|\.generated|node_modules)\//.test(x) || /(^|\/)\.env($|\.)/.test(x) && !x.endsWith('.example')), 'RUNTIME_FILES_TRACKED', 'Do not commit runtime output, node_modules or .env secrets');
  await validateToolkitSnapshot(root);
  return { ...result, modules, valid: true };
}
export async function baseline(root, requirementId, featureId) {
  const key = featureKey(requirementId, featureId), files = [];
  const folders=['tests/_shared', `tests/${requirementId}/_shared`, `tests/${key}`, '.workbench-tools'],sources=await gitSourceFiles(root,folders);
  const candidates=[`spec/${key}/${featureId}.feature`,`spec/${requirementId}/requirement.yaml`,`spec/${key}/${featureId}.sd.md`,`spec/${key}/feature.yaml`,...sources,'workbench.yaml','bdd.config.ts','playwright.config.ts','package.json','package-lock.json'];
  const accepted=new Set(await gitSourcePaths(root,candidates));
  const add = async relative => { if (accepted.has(relative)&&await exists(await safePath(root, relative))) files.push([relative, digest(await readFile(await safePath(root, relative)))]); };
  await add(`spec/${key}/${featureId}.feature`);
  await add(`spec/${requirementId}/requirement.yaml`);
  const gherkin = identity(files);
  await add(`spec/${key}/${featureId}.sd.md`); await add(`spec/${key}/feature.yaml`);
  const sd = identity(files);
  for(const file of sources)await add(file);
  for (const file of ['workbench.yaml', 'bdd.config.ts', 'playwright.config.ts', 'package.json', 'package-lock.json']) await add(file);
  return { gherkin, sd, tests: identity(files), files };
}
export async function reviewState(root, requirementId, featureId) {
  const hashes = await baseline(root, requirementId, featureId);
  const review = version(await readJson(await safePath(root, `spec/${id(requirementId)}/review.json`, { missing: false })));
  validateContract('review', review);
  const records = Object.hasOwn(review.features, id(featureId)) ? review.features[featureId] : {};
  const confirmed = {};
  let upstream = true;
  for (const stage of reviewKinds) {
    confirmed[stage] = upstream && records[stage]?.digest === hashes[stage];
    upstream = confirmed[stage];
  }
  const stage = reviewStage(confirmed);
  return { stage, confirmed, hashes, records, editable: {gherkin:!records.gherkin,sd:!records.sd,tests:confirmed.sd&&!records.tests} };
}
export async function confirm(root, input) {
  if(input.stage==='sd')assertDesignDecisionsResolved(await readFile(await safePath(root,`spec/${id(input.requirementId)}/${id(input.featureId)}/${input.featureId}.sd.md`,{missing:false}),'utf8'));
  if (input.stage === 'tests') {
    const feature = await readJson(await safePath(root, `spec/${input.requirementId}/${input.featureId}/feature.yaml`, { missing: false }));
    invariant(!feature.authoringOnly, 'TEST_RUNNER_NOT_CONFIGURED', '此規格尚未接線工作台測試執行器。', 409);
  }
  invariant(reviewKinds.includes(input.stage), 'INVALID_STAGE', 'Confirm gherkin, sd or tests');
  invariant(typeof input.confirmedBy === 'string' && input.confirmedBy.trim() && input.confirmedBy.length <= 120, 'CONFIRMER_REQUIRED', 'Supply the human reviewer identity');
  await assertFeatureActive(root,input.requirementId,input.featureId);
  const state = await reviewState(root, input.requirementId, input.featureId);
  invariant(input.expectedDigest === state.hashes[input.stage], 'CONTENT_CHANGED', 'Source changed since review', 409);
  if (input.stage !== 'gherkin') invariant(state.confirmed.gherkin, 'UPSTREAM_NOT_CONFIRMED', 'Confirm Gherkin first', 409);
  if (input.stage === 'tests') invariant(state.confirmed.sd, 'UPSTREAM_NOT_CONFIRMED', 'Confirm SD first', 409);
  if(state.records[input.stage]) {
    invariant(state.confirmed[input.stage],'STAGE_READ_ONLY','請先退回此階段，才能重新確認已變更的來源。',409);
    return {...state,committed:false};
  }
  const file = await safePath(root, `spec/${input.requirementId}/review.json`), review = await readJson(file);
  review.features ??= {}; if (!Object.hasOwn(review.features, input.featureId)) review.features[input.featureId] = {};
  review.features[input.featureId][input.stage] = { digest: state.hashes[input.stage], confirmedBy: input.confirmedBy, confirmedAt: new Date().toISOString() };
  for (const stage of reviewKinds.slice(reviewKinds.indexOf(input.stage) + 1)) delete review.features[input.featureId][stage];
  await writeJson(file, review);
  return { ...(await reviewState(root, input.requirementId, input.featureId)), committed: false };
}
export async function saveFile(root, input) {
  invariant(typeof input.content === 'string' && Buffer.byteLength(input.content) <= 2 * 1024 * 1024, 'INVALID_CONTENT', 'File content must be at most 2 MiB');
  invariant((/^(spec|tests)\//.test(input.path) || ['workbench.yaml', 'bdd.config.ts', 'playwright.config.ts', 'package.json', 'package-lock.json'].includes(input.path)) && !/(^|\/)(review|workflow|feedback|acceptance)\.json$/.test(input.path), 'FILE_NOT_EDITABLE', 'Edit spec/tests sources; use explicit review operations for confirmations', 403);
  const file = await safePath(root, input.path);
  const current = await exists(file) ? digest(await readFile(file)) : null;
  invariant(Object.hasOwn(input, 'expectedHash') && current === input.expectedHash, 'CONTENT_CHANGED', 'File changed since it was opened', 409);
  await assertFileEditable(root, input.path);
  if(input.path.endsWith('.sd.md'))parseDesignDecisions(input.content);
  await atomicWrite(file, input.content); return { path: input.path, sha256: digest(input.content), committed: false };
}

/** Source ownership follows the same review digests used to derive workflow progress. */
export async function assertFileEditable(root, relative) {
  for (const feature of (await scan(root,{includeDeleted:true})).features) {
    if(feature.deletedAt){if(relative.startsWith(`spec/${feature.key}/`)||relative.startsWith(`tests/${feature.key}/`))await assertFeatureActive(root,feature.requirementId,feature.id);continue;}
    const state = await reviewState(root, feature.requirementId, feature.id);
    const stage = relative === `spec/${feature.key}/${feature.id}.feature` || relative === `spec/${feature.key}/requirement-source.json` || relative === `spec/${feature.requirementId}/requirement.yaml` ? 'gherkin'
      : relative === `spec/${feature.key}/${feature.id}.sd.md` || relative === `spec/${feature.key}/feature.yaml` ? 'sd'
      : relative.startsWith(`tests/${feature.key}/`) || state.hashes.files.some(([file]) => file === relative) ? 'tests' : null;
    if (!stage) continue;
    invariant(!state.records[stage], 'STAGE_READ_ONLY', '此階段已確認，請先退回該階段再修改。', 409);
    if (stage === 'tests' && relative.startsWith(`tests/${feature.key}/`)) invariant(state.confirmed.sd, 'UPSTREAM_NOT_CONFIRMED', '確認系統設計後才能編輯測試計劃。', 409);
  }
}

export async function restartReview(root, input) {
  const stages = reviewKinds, index = stages.indexOf(input.stage);
  invariant(index >= 0, 'INVALID_STAGE', '退回需求、系統設計或測試計劃。');
  await assertFeatureActive(root,input.requirementId,input.featureId);
  const state = await reviewState(root, input.requirementId, input.featureId);
  invariant(input.expectedDigest === state.hashes.tests, 'CONTENT_CHANGED', '內容已更新，請重新讀取後再退回。', 409);
  invariant(stages.slice(0, index).every(stage => state.confirmed[stage]), 'UPSTREAM_NOT_CONFIRMED', '只能退回目前或已通過的階段。', 409);
  const file = await safePath(root, `spec/${id(input.requirementId)}/review.json`), review = await readJson(file);
  for (const stage of stages.slice(index)) if (review.features[input.featureId]) delete review.features[input.featureId][stage];
  await writeJson(file, review);
  // Clear the current plan, preserving previous bytes in SQLite authoring history.
  if (index <= stages.indexOf('sd')) {
    const directory = await safePath(root, `tests/${featureKey(input.requirementId, input.featureId)}`);
    for (const relative of await walk(directory)) await atomicWrite(await safePath(directory, relative), '');
  }
  return { ...(await reviewState(root, input.requirementId, input.featureId)), nextStage: { gherkin: 'GHERKIN', sd: 'SD', tests: 'TESTS' }[input.stage] };
}
