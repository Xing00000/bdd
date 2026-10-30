import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import { fixture, git, specRepository, approve } from './helpers.mjs';
import { createFeature, validate, baseline, reviewState, confirm, saveFile, initialize } from '../../packages/spec-toolkit/index.mjs';
import { digest, writeJson } from '../../packages/contracts/index.mjs';

test('spec initialization creates a portable hashed toolkit and parallel feature layout', async t => {
  const f = await fixture(t); await specRepository(f.repo);
  const data = await validate(f.repo, git); assert.equal(data.valid, true); assert.equal(data.features[0].key, 'REQ-001/login');
  for (const name of ['spec/REQ-001/login/login.feature', 'tests/REQ-001/login/login.steps.ts', 'tests/REQ-001/login/login.hooks.ts', 'reports/REQ-001/login/.gitkeep']) assert.ok(await readFile(path.join(f.repo, name)));
  assert.match(await readFile(path.join(f.repo, 'tests/REQ-001/login/login.steps.ts'), 'utf8'), /throw new Error\('UNIMPLEMENTED_ACCEPTANCE_STEP/);
  const config = await readFile(path.join(f.repo, 'bdd.config.ts'), 'utf8'); assert.match(config, /tests\/\$\{key\}/); assert.ok(!config.includes('reports/'));
});
test('initialization and feature creation refuse overwrites', async t => {
  const f = await fixture(t); await specRepository(f.repo);
  await assert.rejects(initialize(f.repo, { specRepositoryId: 'new' }), { code: 'REPOSITORY_NOT_EMPTY' });
  await assert.rejects(createFeature(f.repo, { requirementId: 'REQ-001', featureId: 'login', title: 'overwrite' }), { code: 'FEATURE_EXISTS' });
});
test('feature projects must reference the Spec registry', async t => {
  const f = await fixture(t); await specRepository(f.repo);
  await assert.rejects(createFeature(f.repo, { requirementId: 'REQ-002', featureId: 'bad', title: 'bad', projectIds: ['unknown'] }), { code: 'UNKNOWN_PROJECT' });
});
test('reports-only changes do not invalidate confirmations', async t => {
  const f = await fixture(t); await specRepository(f.repo); await approve(f.repo);
  const before = await reviewState(f.repo, 'REQ-001', 'login');
  await mkdir(path.join(f.repo, 'reports/REQ-001/login/RUN-001'), { recursive: true }); await writeFile(path.join(f.repo, 'reports/REQ-001/login/RUN-001/report.json'), '{}');
  const after = await reviewState(f.repo, 'REQ-001', 'login'); assert.deepEqual(after.hashes, before.hashes); assert.ok(Object.values(after.confirmed).every(Boolean));
});
test('shared test changes invalidate tests but not Gherkin/SD confirmation', async t => {
  const f = await fixture(t); await specRepository(f.repo); await approve(f.repo);
  await writeFile(path.join(f.repo, 'tests/_shared/helper.ts'), 'export const value = 2;\n');
  const state = await reviewState(f.repo, 'REQ-001', 'login');
  assert.deepEqual(state.confirmed, { gherkin: true, sd: true, tests: false }); assert.equal(state.stage, 'TESTS');
});
test('Gherkin changes invalidate all dependent confirmations', async t => {
  const f = await fixture(t); await specRepository(f.repo); await approve(f.repo);
  await writeFile(path.join(f.repo, 'spec/REQ-001/login/login.feature'), 'Feature: changed\n');
  assert.deepEqual((await reviewState(f.repo, 'REQ-001', 'login')).confirmed, { gherkin: false, sd: false, tests: false });
});
test('review requires upstream confirmation and current digest', async t => {
  const f = await fixture(t); await specRepository(f.repo); const state = await reviewState(f.repo, 'REQ-001', 'login');
  await assert.rejects(confirm(f.repo, { requirementId: 'REQ-001', featureId: 'login', stage: 'tests', expectedDigest: state.hashes.tests, confirmedBy: 'reviewer' }), { code: 'UPSTREAM_NOT_CONFIRMED' });
  await assert.rejects(confirm(f.repo, { requirementId: 'REQ-001', featureId: 'login', stage: 'gherkin', expectedDigest: 'outdated', confirmedBy: 'reviewer' }), { code: 'CONTENT_CHANGED' });
});
test('file saves protect concurrent edits and cannot edit review records', async t => {
  const f = await fixture(t); await specRepository(f.repo); const relative = 'spec/REQ-001/login/login.sd.md';
  const old = await readFile(path.join(f.repo, relative));
  await saveFile(f.repo, { path: relative, content: 'new design', expectedHash: digest(old) });
  await assert.rejects(saveFile(f.repo, { path: relative, content: 'stale edit', expectedHash: digest(old) }), { code: 'CONTENT_CHANGED' });
  await assert.rejects(saveFile(f.repo, { path: 'spec/REQ-001/review.json', content: '{}', expectedHash: null }), { code: 'FILE_NOT_EDITABLE' });
  assert.equal(await readFile(path.join(f.repo, relative), 'utf8'), 'new design');
});
test('toolkit snapshot tampering is detected before execution', async t => {
  const f = await fixture(t); await specRepository(f.repo);
  await writeFile(path.join(f.repo, '.workbench-tools/contracts/index.mjs'), 'export const compromised = true;');
  await assert.rejects(validate(f.repo, git), { code: 'TOOLKIT_HASH_MISMATCH' });
});
test('schema versions and unsupported YAML syntax fail explicitly', async t => {
  const f = await fixture(t); await specRepository(f.repo);
  const file = path.join(f.repo, 'workbench.yaml'), config = JSON.parse(await readFile(file, 'utf8'));
  config.schemaVersion = 99; await writeJson(file, config);
  await assert.rejects(validate(f.repo, git), { code: 'SCHEMA_VERSION_UNSUPPORTED' });
  await writeFile(file, 'schemaVersion: 1\n'); await assert.rejects(validate(f.repo, git), { code: 'CONFIG_FORMAT_UNSUPPORTED' });
});
test('orphan test feature directories are rejected rather than assigned to another requirement', async t => {
  const f = await fixture(t); await specRepository(f.repo); await mkdir(path.join(f.repo, 'tests/REQ-999/missing'), { recursive: true });
  await assert.rejects(validate(f.repo, git), { code: 'ORPHAN_FEATURE_DIRECTORY' });
});
test('source snapshot traversal through a symlink is refused', async t => {
  const f = await fixture(t); await specRepository(f.repo);
  await symlink('/etc/passwd', path.join(f.repo, 'tests/REQ-001/login/secret.ts'));
  await assert.rejects(baseline(f.repo, 'REQ-001', 'login'), { code: 'SYMLINK_FORBIDDEN' });
});
