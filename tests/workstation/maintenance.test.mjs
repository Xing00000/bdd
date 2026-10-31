import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rm, cp } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fixture, git, toolkitRoot, specRepository, commitAll, sealedBundle } from './helpers.mjs';
import { digest, identity, writeJson, readJson, exists } from '../../packages/contracts/index.mjs';
import { planFiles, publicPlan, applyPlan, resumePlan } from '../../packages/workstation/transactions.mjs';
import { planUpgrade } from '../../packages/workstation/upgrades.mjs';
import { planLegacyImport, readLegacy, backupLegacySelection } from '../../packages/workstation/legacy.mjs';
import { reindexReports, artifactDirectory, currentVerification } from '../../packages/workstation/reports.mjs';
import { openStore } from '../../packages/workstation/store.mjs';
import { createWorkstation } from '../../packages/workstation/service.mjs';
import { createStandaloneServer } from '../../packages/workstation/http.mjs';
import { validate } from '../../packages/spec-toolkit/index.mjs';

async function base(t) {
  const f = await fixture(t); await mkdir(f.home); await specRepository(f.repo); return f;
}
function storeFor(t, f) {
  const store = openStore(f.home); store.register({ id: 'WS-one', title: 'Fixture', remoteUrl: f.repo }); t.after(() => store.close()); return store;
}
async function legacyFixture(f, { oldSchema = false } = {}) {
  const file = path.join(f.base, 'legacy.sqlite'), db = new DatabaseSync(file);
  db.exec(`CREATE TABLE requirements(id TEXT PRIMARY KEY,requirement_key TEXT,deleted_at TEXT);
    ${oldSchema ? '' : 'CREATE TABLE features(id TEXT PRIMARY KEY,requirement_id TEXT,feature_key TEXT,stage TEXT);'}
    CREATE TABLE documents(id TEXT PRIMARY KEY,requirement_id TEXT,${oldSchema ? '' : 'feature_id TEXT,'} kind TEXT,purpose TEXT,file_name TEXT);
    CREATE TABLE document_heads(document_id TEXT,version_id TEXT);
    CREATE TABLE document_versions(id TEXT,document_id TEXT,version_no INTEGER,raw_text TEXT,raw_sha256 TEXT,created_at TEXT);
    CREATE TABLE confirmations(requirement_id TEXT,${oldSchema ? '' : 'feature_id TEXT,'} kind TEXT,version_id TEXT,raw_sha256 TEXT);
    CREATE TABLE runs(id TEXT,requirement_id TEXT,${oldSchema ? '' : 'feature_id TEXT,'} status TEXT,execution_scope TEXT,candidate_commit TEXT,tested_commit TEXT,environment_snapshot_json TEXT);
    CREATE TABLE case_results(id TEXT,run_id TEXT);
    CREATE TABLE step_results(id TEXT,case_result_id TEXT);
    CREATE TABLE screenshots(id TEXT,step_result_id TEXT,artifact_ref TEXT,sha256 TEXT);
    CREATE TABLE secrets(value TEXT);
    INSERT INTO secrets VALUES('DO-NOT-EXPORT-SERVER-SECRET');
    INSERT INTO requirements VALUES('old-req','REQ-OLD',NULL);
    ${oldSchema ? '' : "INSERT INTO features VALUES('old-feature','old-req','login','VERIFIED');"}`);
  const featureId = oldSchema ? 'old-req' : 'old-feature';
  const texts = ['Feature: original\n\n  Scenario: Legacy\n    Given original condition\n', '# Original design\n', "import { test } from '@playwright/test';\ntest('old', async () => {});\n"];
  for (const [index, kind] of ['gherkin', 'sd', 'spec'].entries()) {
    const values = [`doc-${index}`, 'old-req', ...(oldSchema ? [] : [featureId]), kind, kind === 'spec' ? 'target_ci' : 'requirement', 'legacy'];
    db.prepare(`INSERT INTO documents VALUES(${values.map(() => '?').join(',')})`).run(...values);
    db.prepare('INSERT INTO document_versions VALUES(?,?,?,?,?,?)').run(`version-${index}`, `doc-${index}`, 1, texts[index], digest(texts[index]), '2025-01-01T00:00:00Z');
    db.prepare('INSERT INTO document_heads VALUES(?,?)').run(`doc-${index}`, `version-${index}`);
  }
  const confirmation = ['old-req', ...(oldSchema ? [] : [featureId]), 'gherkin', 'version-0', digest(texts[0])];
  db.prepare(`INSERT INTO confirmations VALUES(${confirmation.map(() => '?').join(',')})`).run(...confirmation);
  const run = ['old-run', 'old-req', ...(oldSchema ? [] : [featureId]), 'PASSED', 'ALL_REQUIRED', null, null, 'DO-NOT-EXPORT-ENVIRONMENT-SECRET'];
  db.prepare(`INSERT INTO runs VALUES(${run.map(() => '?').join(',')})`).run(...run);
  const images = path.join(f.base, 'legacy-images'); await mkdir(images);
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 128]); await writeFile(path.join(images, 'old.png'), png);
  db.exec("INSERT INTO case_results VALUES('case','old-run'); INSERT INTO step_results VALUES('step','case');");
  db.prepare('INSERT INTO screenshots VALUES(?,?,?,?)').run('shot', 'step', 'old.png', digest(png)); db.close();
  return { file, images, texts, png };
}
async function publishedFixture(f, { runId = 'RUN-index', modified = false, screenshot = false } = {}) {
  const testedSpecCommit = await git.resolve(f.repo), folder = path.join(f.repo, 'reports/REQ-001/login', runId);
  const plan = { runId, requirementId: 'REQ-001', featureId: 'login', testedSpecCommit, testOutcome: 'FAILED', verification: 'NOT_VERIFIED', scope: 'ALL_CASES', baseline: 'a'.repeat(64), projects: [] };
  await sealedBundle(folder, plan, modified ? { label: 'altered evidence' } : {});
  let bytes;
  if (screenshot) {
    bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 128, 255, 10]); await mkdir(path.join(folder, 'screenshots'));
    await writeFile(path.join(folder, 'screenshots/binary.png'), bytes);
    const manifest = await readJson(path.join(folder, 'manifest.json')); manifest.artifacts.push({ path: 'screenshots/binary.png', size: bytes.length, sha256: digest(bytes) });
    await writeJson(path.join(folder, 'manifest.json'), manifest);
    await writeJson(path.join(folder, 'seal.json'), { schemaVersion: 1, manifestSha256: digest(await readFile(path.join(folder, 'manifest.json'))) });
  }
  await commitAll(f.repo, 'Record tooling evidence'); return { testedSpecCommit, reportCommit: await git.resolve(f.repo), folder, bytes };
}

test('upgrade preview is deterministic and preserves authored configuration/tests', async t => {
  const f = await base(t);
  const unchanged = await planUpgrade(f.repo, toolkitRoot); assert.equal(unchanged.files.length, 0);
  const oldManifest = await readJson(path.join(f.repo, '.workbench-tools/manifest.json')); oldManifest.version = '1.0.0'; await writeJson(path.join(f.repo, '.workbench-tools/manifest.json'), oldManifest); await commitAll(f.repo);
  const plan = await planUpgrade(f.repo, toolkitRoot); assert.equal(plan.files.length, 1); assert.equal(plan.metadata.toVersion, '1.3.0');
  assert.deepEqual(publicPlan(plan), publicPlan(await planUpgrade(f.repo, toolkitRoot))); assert.equal(publicPlan(plan).files[0].content, undefined);
  const authored = await readFile(path.join(f.repo, 'bdd.config.ts'));
  const result = await applyPlan({ root: f.repo, home: f.home, repositoryId: 'WS-one', transactionId: 'TX-upgrade', plan, expectedDigest: plan.digest, sourceHead: await git.resolve(f.repo) });
  assert.equal(result.committed, false); assert.equal(result.status, 'APPLIED'); assert.deepEqual(await readFile(path.join(f.repo, 'bdd.config.ts')), authored);
  assert.equal((await readJson(path.join(f.repo, '.workbench-tools/manifest.json'))).version, '1.3.0');
});
test('upgrade refuses modified or untracked toolkit files', async t => {
  const f = await base(t); await writeFile(path.join(f.repo, '.workbench-tools/unmanaged.mjs'), 'custom');
  await assert.rejects(planUpgrade(f.repo, toolkitRoot), { code: 'TOOLKIT_CUSTOMIZED' });
  await rm(path.join(f.repo, '.workbench-tools/unmanaged.mjs'));
  await writeFile(path.join(f.repo, '.workbench-tools/contracts/index.mjs'), 'edited');
  await assert.rejects(planUpgrade(f.repo, toolkitRoot), { code: 'TOOLKIT_CUSTOMIZED' });
});
test('stale preview is rejected before any target files are written', async t => {
  const f = await base(t), plan = await planFiles(f.repo, [{ path: 'tests/new.txt', content: 'new' }], { kind: 'fixture' });
  await assert.rejects(applyPlan({ root: f.repo, home: f.home, repositoryId: 'WS-one', transactionId: 'TX-stale', plan, expectedDigest: 'wrong', sourceHead: await git.resolve(f.repo) }), { code: 'PLAN_CHANGED' });
  assert.equal(await exists(path.join(f.repo, 'tests/new.txt')), false);
});
test('interrupted file plans resume without duplicating or discarding earlier writes', async t => {
  const f = await base(t), plan = await planFiles(f.repo, [{ path: 'tests/first.txt', content: 'first' }, { path: 'tests/second.txt', content: 'second' }], { kind: 'fixture' });
  const options = { root: f.repo, home: f.home, repositoryId: 'WS-one', transactionId: 'TX-resume', sourceHead: await git.resolve(f.repo) };
  await assert.rejects(applyPlan({ ...options, plan, expectedDigest: plan.digest, afterWrite: () => { throw new Error('power interruption'); } }), /power interruption/);
  assert.equal(await readFile(path.join(f.repo, 'tests/first.txt'), 'utf8'), 'first');
  assert.equal((await resumePlan(options)).status, 'APPLIED'); assert.equal(await readFile(path.join(f.repo, 'tests/second.txt'), 'utf8'), 'second');
  assert.equal((await resumePlan(options)).status, 'APPLIED');
});
test('transaction recovery refuses changed HEAD or a post-interruption human edit', async t => {
  const f = await base(t), plan = await planFiles(f.repo, [{ path: 'tests/first.txt', content: 'first' }, { path: 'tests/second.txt', content: 'second' }], { kind: 'fixture' });
  const options = { root: f.repo, home: f.home, repositoryId: 'WS-one', transactionId: 'TX-conflict', sourceHead: await git.resolve(f.repo) };
  await assert.rejects(applyPlan({ ...options, plan, expectedDigest: plan.digest, afterWrite: () => { throw new Error('stop'); } }));
  await assert.rejects(resumePlan({ ...options, sourceHead: 'f'.repeat(40) }), { code: 'HEAD_MISMATCH' });
  await writeFile(path.join(f.repo, 'tests/first.txt'), 'human draft');
  await assert.rejects(resumePlan(options), { code: 'MIGRATION_FILE_CONFLICT' });
  assert.equal(await readFile(path.join(f.repo, 'tests/first.txt'), 'utf8'), 'human draft'); assert.equal(await exists(path.join(f.repo, 'tests/second.txt')), false);
});
test('migration plans cannot target Git metadata, products, or source outside approved roots', async t => {
  const f = await base(t);
  for (const relative of ['../outside', '.git/config', 'projects/product/file', 'package.json']) await assert.rejects(planFiles(f.repo, [{ path: relative, content: 'bad' }], {}));
});
test('legacy import preserves exact source, history and screenshots without carrying verification or secrets', async t => {
  const f = await base(t), old = await legacyFixture(f), before = digest(await readFile(old.file));
  const { plan, snapshot } = await planLegacyImport(f.repo, { legacyFile: old.file, legacyArtifactsRoot: old.images });
  assert.equal(plan.metadata.mapping[0].requirementId, 'REQ-OLD'); assert.equal(snapshot.versions.length, 3);
  assert.ok(!JSON.stringify(snapshot).includes('DO-NOT-EXPORT'));
  await backupLegacySelection(f.home, snapshot);
  await applyPlan({ root: f.repo, home: f.home, repositoryId: 'WS-one', transactionId: 'TX-legacy', plan, expectedDigest: plan.digest, sourceHead: await git.resolve(f.repo) });
  assert.equal(await readFile(path.join(f.repo, 'spec/REQ-OLD/login/login.feature'), 'utf8'), old.texts[0]);
  assert.deepEqual(await readJson(path.join(f.repo, 'spec/REQ-OLD/review.json')), { schemaVersion: 1, features: {} });
  assert.match(await readFile(path.join(f.repo, 'tests/REQ-OLD/login/login.steps.ts'), 'utf8'), /MIGRATION_REQUIRES_REVIEW/);
  const archived = plan.files.find(x => x.path.endsWith('/legacy.json')); const record = JSON.parse(Buffer.from(archived.content, 'base64'));
  assert.equal(record.verification, 'UNKNOWN'); assert.equal(record.source.tested_commit, null);
  assert.deepEqual(Buffer.from(plan.files.find(x => x.path.endsWith('.png')).content, 'base64'), old.png);
  assert.equal(digest(await readFile(old.file)), before); assert.equal((await validate(f.repo, git)).features.length, 2);
});
test('legacy v1 requirements without a features table are imported deterministically', async t => {
  const f = await base(t), old = await legacyFixture(f, { oldSchema: true });
  const a = await planLegacyImport(f.repo, { legacyFile: old.file }), b = await planLegacyImport(f.repo, { legacyFile: old.file });
  assert.equal(a.plan.digest, b.plan.digest); assert.equal(a.plan.metadata.mapping[0].featureId, 'REQ-OLD');
});
test('legacy imports do not overwrite existing requirements and reject missing selected IDs', async t => {
  const f = await base(t), old = await legacyFixture(f);
  assert.throws(() => readLegacy(old.file, ['does-not-exist']), { code: 'LEGACY_SELECTION_NOT_FOUND' });
  await mkdir(path.join(f.repo, 'spec/REQ-OLD'));
  await assert.rejects(planLegacyImport(f.repo, { legacyFile: old.file }), { code: 'LEGACY_DESTINATION_EXISTS' });
});
test('legacy source hashes are checked and changed data invalidates an earlier preview', async t => {
  const f = await base(t), old = await legacyFixture(f), a = await planLegacyImport(f.repo, { legacyFile: old.file });
  const db = new DatabaseSync(old.file); db.prepare('UPDATE requirements SET requirement_key=?').run('REQ-CHANGED'); db.close();
  const b = await planLegacyImport(f.repo, { legacyFile: old.file }); assert.notEqual(a.plan.digest, b.plan.digest);
  const broken = new DatabaseSync(old.file); broken.exec("UPDATE document_versions SET raw_text='tampered'"); broken.close();
  assert.throws(() => readLegacy(old.file), { code: 'LEGACY_DOCUMENT_HASH_MISMATCH' });
});
test('missing legacy images are reported, not replaced with fabricated screenshots', async t => {
  const f = await base(t), old = await legacyFixture(f); await rm(path.join(old.images, 'old.png'));
  const { plan } = await planLegacyImport(f.repo, { legacyFile: old.file, legacyArtifactsRoot: old.images });
  assert.ok(plan.metadata.warnings.some(x => x.includes('ENOENT'))); assert.equal(plan.files.some(x => x.path.endsWith('.png')), false);
});
test('legacy artifact traversal is refused without reading outside the configured root', async t => {
  const f = await base(t), old = await legacyFixture(f), db = new DatabaseSync(old.file);
  db.exec("UPDATE screenshots SET artifact_ref='../legacy.sqlite'"); db.close();
  const { plan } = await planLegacyImport(f.repo, { legacyFile: old.file, legacyArtifactsRoot: old.images });
  assert.ok(plan.metadata.warnings.some(x => x.includes('INVALID_PATH'))); assert.equal(plan.files.some(x => /screenshots\//.test(x.path)), false);
});
test('Git report reindex preserves binary bytes and never switches the dirty developer checkout', async t => {
  const f = await base(t), published = await publishedFixture(f, { screenshot: true }), store = storeFor(t, f);
  await writeFile(path.join(f.repo, 'spec/REQ-001/login/login.sd.md'), 'developer draft'); const before = await git.inspect(f.repo);
  const result = await reindexReports({ root: f.repo, home: f.home, repositoryId: 'WS-one', git, store });
  assert.equal(result.errors.length, 0); assert.equal(result.indexed.length, 1); assert.deepEqual(await git.inspect(f.repo), before);
  const entry = store.reports('WS-one')[0], directory = await artifactDirectory({ home: f.home, store, repositoryId: 'WS-one', runId: entry.runId, reportKey: entry.key });
  assert.deepEqual(await readFile(path.join(directory, 'screenshots/binary.png')), published.bytes); assert.equal(entry.reportCommit, published.reportCommit);
});
test('a fresh clone indexes an evidence branch without a local execution database', async t => {
  const f = await base(t), baseCommit = await git.resolve(f.repo);
  await git.branch(f.repo, { name: 'evidence/RUN-index', create: true }, await git.inspect(f.repo)); await publishedFixture(f);
  await git.branch(f.repo, { name: 'main', create: false }, await git.inspect(f.repo)); assert.equal(await git.resolve(f.repo), baseCommit);
  const other = path.join(f.base, 'other'); await git.clone(f.repo, other);
  const store = storeFor(t, f), result = await reindexReports({ root: other, home: f.home, repositoryId: 'WS-one', git, store });
  assert.equal(result.errors.length, 0); assert.equal(result.indexed.length, 1); assert.equal(store.runs('WS-one').length, 0);
  assert.match(store.reports('WS-one')[0].ref, /origin\/evidence\//);
});
test('Git report index rejects tampered artifacts and mismatched identities', async t => {
  const f = await base(t), published = await publishedFixture(f), store = storeFor(t, f);
  await writeFile(path.join(published.folder, 'report.json'), 'tampered'); await commitAll(f.repo);
  const result = await reindexReports({ root: f.repo, home: f.home, repositoryId: 'WS-one', git, store });
  assert.equal(result.indexed.length, 0); assert.equal(result.errors[0].code, 'EVIDENCE_HASH_MISMATCH'); assert.equal(store.reports('WS-one').length, 0);
});
test('conflicting immutable run IDs are quarantined rather than silently replacing prior evidence', async t => {
  const f = await base(t), first = await publishedFixture(f), store = storeFor(t, f);
  await reindexReports({ root: f.repo, home: f.home, repositoryId: 'WS-one', git, store });
  await rm(first.folder, { recursive: true }); await publishedFixture(f, { modified: true });
  const result = await reindexReports({ root: f.repo, home: f.home, repositoryId: 'WS-one', git, store });
  assert.ok(result.errors.some(x => x.code === 'REPORT_ID_CONFLICT')); assert.equal(store.reports('WS-one')[0].invalidReason, 'REPORT_ID_CONFLICT');
  await assert.rejects(artifactDirectory({ home: f.home, store, repositoryId: 'WS-one', runId: 'RUN-index', reportKey: 'REQ-001/login/RUN-index' }), { code: 'REPORT_NOT_FOUND' });
});
test('current verification distinguishes a valid baseline from stale, partial and conflicting history', () => {
  const feature = { requirementId: 'REQ-001', id: 'login', review: { confirmed: { gherkin: true, sd: true, tests: true }, hashes: { tests: 'baseline' } } };
  const modules = [{ id: 'product', actual: 'a', commit: 'a', dirty: false }];
  const report = { manifest: { requirementId: 'REQ-001', featureId: 'login', verification: 'VERIFIED', scope: 'ALL_CASES', coverageComplete: true, evidenceComplete: true, baseline: 'baseline', projects: [{ id: 'product', commit: 'a' }] } };
  assert.equal(currentVerification(feature, modules, [report]).status, 'VERIFIED');
  assert.equal(currentVerification(feature, [{ ...modules[0], dirty: true }], [report]).status, 'STALE');
  assert.equal(currentVerification({ ...feature, review: { ...feature.review, hashes: { tests: 'changed' } } }, modules, [report]).status, 'STALE');
  assert.equal(currentVerification(feature, modules, [{ ...report, invalidReason: 'REPORT_ID_CONFLICT' }]).status, 'NOT_VERIFIED');
  assert.equal(currentVerification(feature, modules, [{ manifest: { ...report.manifest, scope: 'SELECTED_CASES' } }]).status, 'NOT_VERIFIED');
});
test('workspace schema upgrades preserve existing operation and registry records', async t => {
  const f = await base(t), store = openStore(f.home);
  store.register({ id: 'WS-one', title: 'Before migration', remoteUrl: f.repo }); store.close();
  const db = new DatabaseSync(path.join(f.home, 'metadata.sqlite')); db.exec('DROP TABLE report_index; PRAGMA user_version=1;'); db.close();
  const upgraded = openStore(f.home); t.after(() => upgraded.close());
  assert.equal(upgraded.repository('WS-one').title, 'Before migration'); assert.deepEqual(upgraded.reports('WS-one'), []);
});
test('imported Git reports are served through the real API on a new workstation', async t => {
  const f = await base(t), published = await publishedFixture(f, { screenshot: true });
  const target = path.join(f.home, 'repositories/WS-one/repo'); await mkdir(path.dirname(target), { recursive: true }); await git.clone(f.repo, target);
  const app = await createStandaloneServer({ home: f.home, toolkitRoot, allowLocal: true }); t.after(() => app.close()); app.service.register({ id: 'WS-one', title: 'New machine', remoteUrl: f.repo });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); const origin = `http://127.0.0.1:${app.server.address().port}`;
  app.service.enqueue({ schemaVersion: 1, operationId: 'OP-index', repositoryId: 'WS-one', operation: 'reports.reindex', input: {} });
  const result = await app.service.wait('OP-index'); assert.equal(result.status, 'SUCCEEDED', JSON.stringify(result.error));
  const detail = await app.service.detail('WS-one'); assert.equal(detail.reports.length, 1);
  const response = await fetch(`${origin}/repository-api/v1/spec-repositories/WS-one/runs/RUN-index/artifact?path=screenshots%2Fbinary.png&reportKey=REQ-001%2Flogin%2FRUN-index`);
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/png'); assert.deepEqual(Buffer.from(await response.arrayBuffer()), published.bytes);
});
