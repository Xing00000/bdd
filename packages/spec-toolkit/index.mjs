import { readdir, readFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { id, invariant, version, exists, safePath, walk, readJson, writeJson, atomicWrite, digest, identity } from '../contracts/index.mjs';

import { validateContract } from '../contracts/schemas.mjs';

export const layout = Object.freeze({ specRoot: 'spec', testsRoot: 'tests', reportsRoot: 'reports', projectsRoot: 'projects' });
const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
const json = value => `${JSON.stringify(value, null, 2)}\n`;
export function featureKey(requirementId, featureId) { return `${id(requirementId, 'requirementId')}/${id(featureId, 'featureId')}`; }
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
export const TOOLKIT_VERSION = '1.1.0';
export const TOOLKIT_FILES = Object.freeze(['contracts/index.mjs', 'contracts/schemas.mjs', 'git-core/index.mjs', 'spec-toolkit/index.mjs', 'spec-toolkit/engine.mjs', 'spec-toolkit/reporter.mjs', 'spec-toolkit/cli.mjs']);
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

export async function createFeature(root, input) {
  const key = featureKey(input.requirementId, input.featureId), config = await configuration(root);
  invariant(typeof input.title === 'string' && input.title.trim() && input.title.length <= 300 && !/[\r\n]/.test(input.title), 'INVALID_TITLE', 'A one-line title is required');
  const projectIds = input.projectIds ?? [];
  invariant(Array.isArray(projectIds) && new Set(projectIds).size === projectIds.length && projectIds.every(p => config.projects.some(x => x.id === p)), 'UNKNOWN_PROJECT', 'Feature references an unknown project');
  const directory = await safePath(root, `spec/${key}`);
  invariant(!await exists(directory), 'FEATURE_EXISTS', 'Feature already exists', 409);
  const requirementPath = await safePath(root, `spec/${input.requirementId}/requirement.yaml`);
  const requirement = await exists(requirementPath) ? version(await readJson(requirementPath))
    : { schemaVersion: 1, id: input.requirementId, title: input.requirementId, features: [] };
  invariant(requirement.id === input.requirementId && Array.isArray(requirement.features) && !requirement.features.includes(input.featureId), 'INVALID_REQUIREMENT', 'Requirement metadata does not match its directory');
  const caseId = 'CASE-001';
  const files = {
    [`spec/${key}/feature.yaml`]: json({ schemaVersion: 1, id: input.featureId, requirementId: input.requirementId, title: input.title, projectIds, caseIds: [caseId], profiles: ['chromium'] }),
    [`spec/${key}/${input.featureId}.feature`]: `Feature: ${input.title}\n\n  @case:${caseId}\n  Scenario: Define acceptance behaviour\n    Given the acceptance steps have not been implemented\n`,
    [`spec/${key}/${input.featureId}.sd.md`]: `# ${input.title}\n\nStatus: DRAFT\n\n## Scope\n\n## Architecture\n\n## Data and migrations\n\n## Test and deployment contract\n`,
    [`tests/${key}/${input.featureId}.steps.ts`]: `import { Given } from '../../_shared/bdd';\n\nGiven('the acceptance steps have not been implemented', async () => {\n  throw new Error('UNIMPLEMENTED_ACCEPTANCE_STEP: replace this scaffold with real operations and assertions');\n});\n`,
    [`tests/${key}/${input.featureId}.hooks.ts`]: `import { AfterStep } from '../../_shared/bdd';\n\nAfterStep(async ({ page, $testInfo, $step }) => {\n  await $testInfo.attach('step-' + $step.title, {\n    contentType: 'image/png', body: await page.screenshot(),\n  });\n});\n`,
    [`tests/${key}/fixtures/.gitkeep`]: '', [`tests/${key}/support/.gitkeep`]: '',
    [`reports/${key}/.gitkeep`]: ''
  };
  for (const [relative, content] of Object.entries(files)) await atomicWrite(await safePath(root, relative), content);
  requirement.features.push(input.featureId); requirement.features.sort(); await writeJson(requirementPath, requirement);
  const reviewPath = await safePath(root, `spec/${input.requirementId}/review.json`);
  if (!await exists(reviewPath)) await writeJson(reviewPath, { schemaVersion: 1, features: {} });
  return { key, files: Object.keys(files), stage: 'GHERKIN' };
}
export async function scan(root) {
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
        invariant(Array.isArray(feature[field]) && feature[field].length > 0 && new Set(feature[field]).size === feature[field].length, 'INVALID_FEATURE_MATRIX', `${key}.${field}`);
        feature[field].forEach(value => id(value, field));
      }
      invariant(feature.profiles.every(p => ['chromium', 'firefox', 'webkit'].includes(p)), 'UNSUPPORTED_PROFILE', key);
      for (const file of [`spec/${key}/${featureId}.feature`, `spec/${key}/${featureId}.sd.md`, `tests/${key}/${featureId}.steps.ts`, `tests/${key}/${featureId}.hooks.ts`])
        await readFile(await safePath(root, file, { missing: false }));
      features.push({ ...feature, key });
    }
  }
  for (const area of ['tests', 'reports']) for (const req of await directories(root, area))
    for (const feature of await directories(root, `${area}/${req}`)) invariant(features.some(x => x.key === `${req}/${feature}`), 'ORPHAN_FEATURE_DIRECTORY', `${area}/${req}/${feature}`);
  return { config, features };
}
export async function validate(root, git, { pinned = false } = {}) {
  const result = await scan(root), modules = await git.modules(root);
  invariant(identity(modules.map(x => x.path).sort()) === identity(result.config.projects.map(x => x.path).sort()), 'PROJECT_GITLINK_MISMATCH', 'workbench.yaml and .gitmodules/gitlinks differ');
  if (pinned) invariant(modules.every(x => x.actual === x.commit && !x.dirty), 'SUBMODULE_NOT_PINNED', 'Initialize clean projects at their recorded gitlinks');
  const tracked = (await git.command(root, ['ls-files', '-z'])).stdout.split('\0').filter(Boolean);
  invariant(!tracked.some(x => /^(\.runtime|\.generated|node_modules)\//.test(x) || /(^|\/)\.env($|\.)/.test(x) && !x.endsWith('.example')), 'RUNTIME_FILES_TRACKED', 'Do not commit runtime output, node_modules or .env secrets');
  const snapshot = version(await readJson(await safePath(root, '.workbench-tools/manifest.json', { missing: false })));
  invariant(Array.isArray(snapshot.files) && snapshot.files.length > 0, 'INVALID_TOOLKIT_MANIFEST', 'Toolkit manifest is empty');
  for (const entry of snapshot.files) invariant(digest(await readFile(await safePath(root, `.workbench-tools/${entry.path}`, { missing: false }))) === entry.sha256, 'TOOLKIT_HASH_MISMATCH', entry.path);
  return { ...result, modules, valid: true };
}
export async function baseline(root, requirementId, featureId) {
  const key = featureKey(requirementId, featureId), files = [];
  const add = async relative => { if (await exists(await safePath(root, relative))) files.push([relative, digest(await readFile(await safePath(root, relative)))]); };
  await add(`spec/${key}/${featureId}.feature`);
  await add(`spec/${requirementId}/requirement.yaml`);
  const gherkin = identity(files);
  await add(`spec/${key}/${featureId}.sd.md`); await add(`spec/${key}/feature.yaml`);
  const sd = identity(files);
  for (const folder of ['tests/_shared', `tests/${requirementId}/_shared`, `tests/${key}`, '.workbench-tools']) {
    const directory = await safePath(root, folder);
    if (await exists(directory)) for (const file of await walk(directory)) await add(`${folder}/${file}`);
  }
  for (const file of ['workbench.yaml', 'bdd.config.ts', 'playwright.config.ts', 'package.json', 'package-lock.json']) await add(file);
  return { gherkin, sd, tests: identity(files), files };
}
export async function reviewState(root, requirementId, featureId) {
  const hashes = await baseline(root, requirementId, featureId);
  const review = version(await readJson(await safePath(root, `spec/${id(requirementId)}/review.json`, { missing: false })));
  validateContract('review', review);
  const records = Object.hasOwn(review.features, id(featureId)) ? review.features[featureId] : {};
  const confirmed = {};
  for (const stage of ['gherkin', 'sd', 'tests']) confirmed[stage] = records[stage]?.digest === hashes[stage];
  const stage = !confirmed.gherkin ? 'GHERKIN' : !confirmed.sd ? 'SD' : !confirmed.tests ? 'TESTS' : 'IMPLEMENTATION';
  return { stage, confirmed, hashes, records };
}
export async function confirm(root, input) {
  invariant(['gherkin', 'sd', 'tests'].includes(input.stage), 'INVALID_STAGE', 'Confirm gherkin, sd or tests');
  invariant(typeof input.confirmedBy === 'string' && input.confirmedBy.trim() && input.confirmedBy.length <= 120, 'CONFIRMER_REQUIRED', 'Supply the human reviewer identity');
  const state = await reviewState(root, input.requirementId, input.featureId);
  invariant(input.expectedDigest === state.hashes[input.stage], 'CONTENT_CHANGED', 'Source changed since review', 409);
  if (input.stage !== 'gherkin') invariant(state.confirmed.gherkin, 'UPSTREAM_NOT_CONFIRMED', 'Confirm Gherkin first', 409);
  if (input.stage === 'tests') invariant(state.confirmed.sd, 'UPSTREAM_NOT_CONFIRMED', 'Confirm SD first', 409);
  const file = await safePath(root, `spec/${input.requirementId}/review.json`), review = await readJson(file);
  review.features ??= {}; if (!Object.hasOwn(review.features, input.featureId)) review.features[input.featureId] = {};
  review.features[input.featureId][input.stage] = { digest: state.hashes[input.stage], confirmedBy: input.confirmedBy, confirmedAt: new Date().toISOString() };
  await writeJson(file, review);
  return { ...(await reviewState(root, input.requirementId, input.featureId)), committed: false };
}
export async function saveFile(root, input) {
  invariant(typeof input.content === 'string' && Buffer.byteLength(input.content) <= 2 * 1024 * 1024, 'INVALID_CONTENT', 'File content must be at most 2 MiB');
  invariant((/^(spec|tests)\//.test(input.path) || ['workbench.yaml', 'bdd.config.ts', 'playwright.config.ts', 'package.json', 'package-lock.json'].includes(input.path)) && !/(^|\/)review\.json$/.test(input.path), 'FILE_NOT_EDITABLE', 'Edit spec/tests sources; use explicit review operations for confirmations', 403);
  const file = await safePath(root, input.path);
  const current = await exists(file) ? digest(await readFile(file)) : null;
  invariant(Object.hasOwn(input, 'expectedHash') && current === input.expectedHash, 'CONTENT_CHANGED', 'File changed since it was opened', 409);
  await atomicWrite(file, input.content); return { path: input.path, sha256: digest(input.content), committed: false };
}
