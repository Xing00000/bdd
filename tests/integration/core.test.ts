import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCore, sha256, type Core } from '../../src/application/core.ts';
import { parseGherkin, parseTypeScript } from '../../src/domain/parsers.ts';
import { schema } from '../../src/adapters/sqlite/schema.ts';

const feature = `Feature: Documents\n  Background:\n    Given an application\n  @AC-DEMO-001\n  Scenario Outline: Edit\n    Given role "<role>"\n    When editing\n    Then outcome "<expected>"\n    Examples: first\n      | case_id | role | expected |\n      | a | A | denied |\n    Examples: second\n      | case_id | role | expected |\n      | b | B | saved |\n`;
const mappings = [
  { testKey: 'test-a', scenarioId: 'AC-DEMO-001', caseId: 'a' },
  { testKey: 'test-a-extra', scenarioId: 'AC-DEMO-001', caseId: 'a' },
  { testKey: 'test-b', scenarioId: 'AC-DEMO-001', caseId: 'b' },
];
const spec = (pending = false, keys = mappings.map(m => m.testKey)) => "import {test,expect} from '@playwright/test';\n" + keys.map(key => `test('${key}', {annotation:{type:'workbenchTestId',description:'${key}'}}, async()=>{${pending ? "throw Error('UnimplementedStepError');" : "expect(2+2).toBe(4);"}});`).join('\n');
async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'workbench-core-')), file = join(dir, 'metadata.sqlite'), core = await createCore(file);
  t.after(async () => { await core.close(); await rm(dir, { recursive: true, force: true }); });
  const project = await core.createProject({ name: '共用專案', workspaceRef: dir });
  const req = await core.createRequirement(project.id, { requirementKey: 'REQ-DEMO-001' });
  return { core, project, req, dir, file };
}
async function confirmed(core: Core, req: Awaited<ReturnType<Core['getRequirement']>>) {
  const g = await core.saveVersion(req.documents.gherkin.id, { rawText: feature });
  await core.confirm(req.id, 'gherkin', { versionId: g.versionId!, rawSha256: g.rawSha256! });
  const sd = await core.saveVersion(req.documents.sd.id, { rawText: '# SD\nDDL/DML plan\n', sourceGherkinVersionId: g.versionId });
  await core.confirm(req.id, 'sd', { versionId: sd.versionId!, rawSha256: sd.rawSha256! });
  return { g, sd };
}
async function skeleton(core: Core, req: Awaited<ReturnType<Core['getRequirement']>>) {
  const { g, sd } = await confirmed(core, req), rawText = spec(true);
  const sk = await core.saveVersion(req.documents.spec.id, { rawText, sourceGherkinVersionId: g.versionId, testStage: 'SKELETON', manifest: { specSha256: sha256(rawText), sourceGherkinVersionId: g.versionId, gherkinSha256: g.rawSha256, sdSha256: sd.rawSha256, mappings } });
  return { g, sd, sk };
}
function completion(source: Awaited<ReturnType<typeof skeleton>>, rawText = spec(), edits: Record<string, any> = {}) {
  return { rawText, sourceGherkinVersionId: source.g.versionId, sourceSkeletonVersionId: source.sk.versionId, testStage: 'COMPLETED' as const,
    manifest: { sourceGherkinVersionId: source.g.versionId, specSha256: sha256(rawText), sourceSkeletonVersionId: source.sk.versionId, sourceSkeletonSha256: source.sk.rawSha256, sourceSkeletonManifestSha256: source.sk.manifestSha256, mappings, ...edits } };
}
const errorCode = (code: string, status?: number) => (error: any) => error.code === code && (!status || error.statusCode === status);

test('migration preserves documented initial schema and applies feature workflows; worker uses real SQLite/WAL/FK and persists after close', async t => {
  const { core, project, file } = await setup(t);
  const sd = await readFile('spec/REQ-WB-001/workbench/workbench.sd.md', 'utf8');
  const section = sd.split('### 7.1 ')[1].split('### 7.3 ')[0];
  const expected = [...section.matchAll(/~~~sql\n([\s\S]*?)\n~~~/g)].map(m => m[1]).join('\n\n');
  assert.equal(schema, expected);
  assert.equal((await core.store.all("SELECT count(*) n FROM sqlite_schema WHERE type='table'"))[0].n, 30);
  assert.equal((await core.store.all('PRAGMA table_info(requirements)')).some(row=>row.name==='project_id'),false);
  assert.equal((await core.store.all('SELECT project_id FROM requirement_projects'))[0].project_id,project.id);
  assert.equal((await core.store.all('PRAGMA foreign_keys'))[0].foreign_keys, 1);
  assert.equal((await core.store.all('PRAGMA journal_mode'))[0].journal_mode, 'wal');
  assert.match(core.sqliteVersion, /^3\./);
  await core.close(); const reopened = await createCore(file);
  try { assert.equal((await reopened.listProjects())[0].id, project.id); } finally { await reopened.close(); }
});
test('batch rollback retains all prior state if a later SQL constraint fails', async t => {
  const { core } = await setup(t), before = await core.listProjects();
  await assert.rejects(core.store.batch([
    { sql: 'INSERT INTO projects VALUES (?,?,?)', params: ['temporary', 'temporary', '/tmp'] },
    { sql: 'INSERT INTO projects VALUES (?,?,?)', params: ['temporary', 'duplicate', '/tmp'] },
  ]));
  assert.deepEqual(await core.listProjects(), before);
});
test('raw UTF-8 bytes and immutable historical projections survive new heads', async t => {
  const { core, req } = await setup(t), rawText = feature.replaceAll('\n', '\r\n') + '# 註解 😀\r\n';
  const first = await core.saveVersion(req.documents.gherkin.id, { rawText });
  const second = await core.saveVersion(req.documents.gherkin.id, { rawText: feature });
  assert.equal((await core.getVersion(req.documents.gherkin.id, first.versionId!)).rawText, rawText);
  assert.equal(first.rawSha256, sha256(rawText)); assert.equal(second.versionNo, 2);
  const a = await core.structure(req.documents.gherkin.id, first.versionId!);
  const b = await core.structure(req.documents.gherkin.id, second.versionId!);
  assert.equal(a.sourceCases.length, 2); assert.equal(a.exampleCells.length, 6); assert.equal(a.stepGroups.length, 2);
  assert.deepEqual(a.steps.map(step => step.keyword).sort(), ['Given', 'Given', 'Then', 'When']);
  assert.equal(a.scenarios[0].id, b.scenarios[0].id); // Stable Scenario entity, separate source-version cases.
  assert.notEqual(a.sourceCases[0].id, b.sourceCases[0].id);
});
test('official parsers reject real errors with positions and preserve effective head', async t => {
  const { core, req } = await setup(t);
  await core.saveVersion(req.documents.gherkin.id, { rawText: feature });
  const before = await core.getRequirement(req.id), count = await core.store.all('SELECT count(*) n FROM document_versions');
  await assert.rejects(core.saveVersion(req.documents.gherkin.id, { rawText: 'Feature: broken\n Scenario: broken\n  Given x\n   """\n   open\n' }), (error: any) => {
    assert.equal(error.statusCode, 422); assert.equal(error.code, 'SYNTAX_INVALID');
    assert.ok(error.file.endsWith('.feature')); assert.ok(error.diagnostics[0].line > 0); assert.ok(error.diagnostics[0].column > 0); assert.ok(error.diagnostics[0].reason.length); return true;
  });
  assert.deepEqual(await core.getRequirement(req.id), before); assert.deepEqual(await core.store.all('SELECT count(*) n FROM document_versions'), count);
  assert.throws(() => parseTypeScript("const x = ;", 'broken.spec.ts', false), errorCode('SYNTAX_INVALID', 422));
  assert.throws(() => parseGherkin(feature.replace('| b | B | saved |', '| a | B | saved |'), 'a.feature'), errorCode('MAPPING_INVALID', 422));
});
test('confirmation requires exact current version/hash and gates phase writes', async t => {
  const { core, req } = await setup(t), doc = req.documents.gherkin.id;
  await assert.rejects(core.saveVersion(req.documents.sd.id, { rawText: '# SD' }), errorCode('ARTIFACT_LOCKED_IN_STAGE', 409));
  const first = await core.saveVersion(doc, { rawText: feature }), second = await core.saveVersion(doc, { rawText: feature });
  await assert.rejects(core.confirm(req.id, 'gherkin', { versionId: first.versionId!, rawSha256: first.rawSha256! }), errorCode('CONFIRMATION_VERSION_MISMATCH', 409));
  await assert.rejects(core.confirm(req.id, 'gherkin', { versionId: second.versionId!, rawSha256: '0'.repeat(64) }), errorCode('CONFIRMATION_VERSION_MISMATCH', 409));
  assert.equal((await core.confirm(req.id, 'gherkin', { versionId: second.versionId!, rawSha256: second.rawSha256! })).stage, 'SD');
  await assert.rejects(core.saveVersion(doc, { rawText: feature + '\n' }), errorCode('ARTIFACT_LOCKED_IN_STAGE', 409));
  await assert.rejects(core.startDevelopment(req.id), errorCode('WORKFLOW_GATE_NOT_MET', 409));
});
test('multi-test source mappings persist and skeleton is explicitly pending/unexecuted', async t => {
  const { core, req } = await setup(t), { sk } = await skeleton(core, req);
  const list = await core.scenarioTests(req.id);
  assert.equal(list.readiness, 'PENDING_COMPLETION');
  assert.deepEqual(list.cases.find(c => c.caseId === 'a')!.testKeys, ['test-a', 'test-a-extra']);
  assert.ok(list.cases.every(c => c.executionStatus === 'NOT_RUN'));
  assert.equal((await core.structure(req.documents.spec.id, sk.versionId!)).mappings.length, 3);
  await assert.rejects(core.startDevelopment(req.id), errorCode('TESTS_PENDING_COMPLETION', 409));
});
test('mapping failures leave no partial version, head, definitions or mappings', async t => {
  const { core, req } = await setup(t), sources = await skeleton(core, req);
  const snapshot = async () => JSON.stringify(await core.store.all('SELECT * FROM document_versions ORDER BY id')) + JSON.stringify(await core.store.all('SELECT * FROM test_case_mappings ORDER BY test_definition_id,source_case_id')) + JSON.stringify(await core.store.all('SELECT * FROM document_heads ORDER BY document_id'));
  const before = await snapshot();
  for (const bad of [mappings.slice(1), [...mappings, mappings[0]], mappings.map((m, i) => i ? m : { ...m, caseId: 'missing' }), mappings.map((m, i) => i ? m : { ...m, scenarioId: 'AC-MISSING' })]) {
    await assert.rejects(core.saveVersion(req.documents.spec.id, completion(sources, spec(), { mappings: bad })), errorCode('MAPPING_INVALID', 422));
    assert.equal(await snapshot(), before);
  }
  await assert.rejects(core.saveVersion(req.documents.spec.id, completion(sources, spec(), { specSha256: '0'.repeat(64) })), errorCode('MAPPING_INVALID', 422));
  assert.equal(await snapshot(), before);
});
test('completion cannot delete/remap source tests or pass unresolved slots', async t => {
  const { core, req } = await setup(t), sources = await skeleton(core, req);
  await assert.rejects(core.saveVersion(req.documents.spec.id, completion(sources, spec(false, ['test-a', 'test-b']), { mappings: [mappings[0], mappings[2]] })), errorCode('MAPPING_INVALID', 422));
  await assert.rejects(core.saveVersion(req.documents.spec.id, completion(sources, spec(), { mappings: mappings.map(m => ({ ...m, caseId: m.testKey === 'test-a' ? 'b' : m.caseId })) })), errorCode('MAPPING_INVALID', 422));
  await assert.rejects(core.saveVersion(req.documents.spec.id, completion(sources, spec(true))), errorCode('TESTS_PENDING_COMPLETION', 409));
  const completed = await core.saveVersion(req.documents.spec.id, completion(sources));
  assert.equal(completed.sourceSkeletonVersionId, sources.sk.versionId);
  assert.equal((await core.getVersion(req.documents.spec.id, sources.sk.versionId!)).rawText, spec(true));
  const r = await core.startDevelopment(req.id);
  assert.equal(r.stage, 'IMPLEMENTATION'); assert.ok(r.baseline); assert.equal(r.baseline.manifest.tests.length, 3);
  assert.equal((await core.scenarioTests(req.id)).cases[0].executionStatus, 'NOT_RUN');
  await assert.rejects(core.saveVersion(req.documents.spec.id, completion(sources)), errorCode('ARTIFACT_LOCKED_IN_STAGE', 409));
});
test('all six invalid mapping categories identify the actual error before skeleton preservation checks', async t => {
  const { core, req } = await setup(t), sources = await skeleton(core, req);
  const baseMappings = [mappings[0], mappings[2]], raw = spec(false, ['test-a', 'test-b']);
  const cases = [
    { problem: '有測試未提供明確的情境與案例對應', raw, mappings: [baseMappings[1]] },
    { problem: '來源Gherkin有應生成的案例未對應任何測試', raw: spec(false, ['test-a']), mappings: [baseMappings[0]] },
    { problem: '不同測試定義使用相同test ID', raw: spec(false, ['test-a', 'test-a']), mappings: baseMappings },
    { problem: '完全相同test ID與來源案例的映射資料重複', raw, mappings: [...baseMappings, baseMappings[0]] },
    { problem: '引用指定來源版本中不存在的Scenario ID', raw, mappings: [{ ...baseMappings[0], scenarioId: 'AC-MISSING-999' }, baseMappings[1]] },
    { problem: '引用指定來源情境中不存在的Examples case_id', raw, mappings: [{ ...baseMappings[0], caseId: 'missing' }, baseMappings[1]] },
  ];
  const before = JSON.stringify(await core.structure(req.documents.spec.id, sources.sk.versionId!));
  const beforeHead = (await core.getRequirement(req.id)).documents.spec.versionId;
  const beforeCount = await core.store.all('SELECT count(*) n FROM document_versions');
  for (const candidate of cases) {
    await assert.rejects(core.saveVersion(req.documents.spec.id, completion(sources, candidate.raw, { mappings: candidate.mappings })), (error: any) => {
      assert.equal(error.statusCode, 422); assert.equal(error.code, 'MAPPING_INVALID');
      const diagnostic = error.diagnostics.find((item: any) => item.reason.includes(candidate.problem));
      assert.ok(diagnostic, `${candidate.problem}: ${JSON.stringify(error.diagnostics)}`);
      assert.ok(diagnostic.testKey || diagnostic.sourceCaseKey);
      assert.ok(diagnostic.line > 0 && diagnostic.column > 0); assert.ok(diagnostic.file.endsWith('.spec.ts'));
      return true;
    });
    assert.equal((await core.getRequirement(req.id)).documents.spec.versionId, beforeHead);
    assert.equal(JSON.stringify(await core.structure(req.documents.spec.id, sources.sk.versionId!)), before);
    assert.deepEqual(await core.store.all('SELECT count(*) n FROM document_versions'), beforeCount);
  }
  // AC021's two otherwise valid tests still cannot delete test-a-extra.
  await assert.rejects(core.saveVersion(req.documents.spec.id, completion(sources, raw, { mappings: baseMappings })), (error: any) =>
    error.code === 'MAPPING_INVALID' && error.diagnostics.some((item: any) => item.testKey === 'test-a-extra' && /cannot delete/.test(item.reason)));
});
test('a valid sourceCaseId cannot conceal contradictory Scenario or Examples IDs', async t => {
  const { core, req } = await setup(t), sources = await skeleton(core, req);
  const sourceCases = (await core.structure(req.documents.gherkin.id, sources.g.versionId!)).sourceCases;
  const explicit = mappings.map(mapping => ({ ...mapping, sourceCaseId: sourceCases.find(row => row.caseKey === mapping.caseId)!.id }));
  const before = (await core.getRequirement(req.id)).documents.spec.versionId;
  for (const conflict of [{ ...explicit[0], scenarioId: 'AC-CONFLICTING-001' }, { ...explicit[0], caseId: 'b' }]) {
    await assert.rejects(core.saveVersion(req.documents.spec.id, completion(sources, spec(), { mappings: [conflict, ...explicit.slice(1)] })), (error: any) => {
      assert.equal(error.code, 'MAPPING_INVALID'); assert.equal(error.statusCode, 422);
      const diagnostic = error.diagnostics.find((d: any) => d.reason.includes('sourceCaseId') && d.reason.includes('不一致'));
      assert.equal(diagnostic.testKey, 'test-a'); assert.ok(diagnostic.sourceCaseKey); assert.ok(diagnostic.file && diagnostic.line > 0 && diagnostic.column > 0); return true;
    });
    assert.equal((await core.getRequirement(req.id)).documents.spec.versionId, before);
  }
  const saved = await core.saveVersion(req.documents.spec.id, completion(sources, spec(), { mappings: explicit }));
  assert.equal((await core.structure(req.documents.spec.id, saved.versionId!)).mappings.length, 3);
});
test('the human-facing 測試基線 alias returns to TESTS and invalidates downstream state', async t => {
  const { core, req } = await setup(t), sources = await skeleton(core, req);
  await core.saveVersion(req.documents.spec.id, completion(sources)); const started = await core.startDevelopment(req.id);
  assert.ok(started.baseline);
  const returned = await core.returnTo(req.id, '測試基線');
  assert.equal(returned.stage, 'TESTS'); assert.ok(returned.confirmations.gherkin); assert.ok(returned.confirmations.sd);
  assert.equal(returned.baseline, null);
  assert.equal((await core.store.all('SELECT valid FROM baselines WHERE id=?', [started.baseline.id]))[0].valid, 0);
});
test('expected head and source confirmation assertions reject stale long-running proposals without saving', async t => {
  const { core, req } = await setup(t), documentId = req.documents.gherkin.id;
  const first = await core.saveVersion(documentId, { rawText: feature, expectedCurrentVersionId: null });
  const second = await core.saveVersion(documentId, { rawText: feature + '\n', baseVersionId: first.versionId });
  await assert.rejects(core.saveVersion(documentId, { rawText: feature, expectedCurrentVersionId: first.versionId }), errorCode('VERSION_CONFLICT', 409));
  await assert.rejects(core.saveVersion(documentId, { rawText: feature, expectedCurrentVersionId: null }), errorCode('VERSION_CONFLICT', 409));
  assert.equal((await core.getRequirement(req.id)).documents.gherkin.versionId, second.versionId);
  await core.confirm(req.id, 'gherkin', { versionId: second.versionId!, rawSha256: second.rawSha256! });
  const before = await core.store.all('SELECT count(*) n FROM document_versions');
  await assert.rejects(core.saveVersion(req.documents.sd.id, { rawText: '# SD', sourceGherkinVersionId: second.versionId, expectedConfirmedGherkinVersionId: first.versionId! }), errorCode('SOURCE_VERSION_MISMATCH', 409));
  assert.deepEqual(await core.store.all('SELECT count(*) n FROM document_versions'), before);
  assert.equal((await core.getRequirement(req.id)).documents.sd.versionId, null);
  const sd = await core.saveVersion(req.documents.sd.id, { rawText: '# SD', sourceGherkinVersionId: second.versionId, expectedCurrentVersionId: null, expectedConfirmedGherkinVersionId: second.versionId! });
  assert.ok(sd.versionId);
});
test('schemaVersion 2 snapshots require exact confirmed Gherkin and SD versions/hashes', async t => {
  const { core, req } = await setup(t), { g, sd } = await confirmed(core, req), rawText = spec(true);
  const manifest = { schemaVersion: 2, sourceGherkinVersionId: g.versionId, gherkinSha256: g.rawSha256, sdVersionId: sd.versionId, sdSha256: sd.rawSha256, specSha256: sha256(rawText), mappings };
  for (const field of ['sourceGherkinVersionId', 'gherkinSha256', 'sdVersionId', 'sdSha256']) {
    const missing: Record<string, any> = { ...manifest }; delete missing[field];
    await assert.rejects(core.saveVersion(req.documents.spec.id, { rawText, sourceGherkinVersionId: g.versionId, testStage: 'SKELETON', manifest: missing }), errorCode('MAPPING_INVALID', 422));
    assert.equal((await core.getRequirement(req.id)).documents.spec.versionId, null);
  }
  await assert.rejects(core.saveVersion(req.documents.spec.id, { rawText, sourceGherkinVersionId: g.versionId, testStage: 'SKELETON', manifest, expectedConfirmedSdVersionId: 'stale-confirmation' }), errorCode('SOURCE_VERSION_MISMATCH', 409));
  const sk = await core.saveVersion(req.documents.spec.id, { rawText, sourceGherkinVersionId: g.versionId, testStage: 'SKELETON', manifest, expectedCurrentVersionId: null, expectedConfirmedGherkinVersionId: g.versionId!, expectedConfirmedSdVersionId: sd.versionId! });
  assert.equal(sk.manifest.sdVersionId, sd.versionId);
  await core.saveVersion(req.documents.spec.id, { ...completion({ g, sd, sk }), manifest: { ...completion({ g, sd, sk }).manifest, ...manifest, specSha256: sha256(spec()) }, expectedCurrentVersionId: sk.versionId });
});
test('identical SD text reapproved as a new version cannot reuse a legacy skeleton or completed baseline', async t => {
  const { core, req } = await setup(t), original = await skeleton(core, req);
  await core.saveVersion(req.documents.spec.id, completion(original));
  await core.returnTo(req.id, 'sd');
  const sd = await core.saveVersion(req.documents.sd.id, { rawText: original.sd.rawText!, sourceGherkinVersionId: original.g.versionId });
  assert.equal(sd.rawSha256, original.sd.rawSha256); assert.notEqual(sd.versionId, original.sd.versionId);
  await core.confirm(req.id, 'sd', { versionId: sd.versionId!, rawSha256: sd.rawSha256! });
  await assert.rejects(core.saveVersion(req.documents.spec.id, completion(original)), errorCode('REGENERATE_SKELETON_REQUIRED', 409));
  await assert.rejects(core.startDevelopment(req.id), errorCode('REGENERATE_SKELETON_REQUIRED', 409));
  const rawText = spec(true), manifest = { schemaVersion: 2, sourceGherkinVersionId: original.g.versionId, gherkinSha256: original.g.rawSha256, sdVersionId: sd.versionId, sdSha256: sd.rawSha256, specSha256: sha256(rawText), mappings };
  const sk = await core.saveVersion(req.documents.spec.id, { rawText, sourceGherkinVersionId: original.g.versionId, testStage: 'SKELETON', manifest });
  await core.saveVersion(req.documents.spec.id, completion({ g: original.g, sd, sk }, spec(), { ...manifest, specSha256: sha256(spec()) }));
  assert.equal((await core.startDevelopment(req.id)).stage, 'IMPLEMENTATION');
});
test('start-development expectations bind the validated test and confirmed document versions/hashes', async t => {
  const { core, req } = await setup(t), sources = await skeleton(core, req), completed = await core.saveVersion(req.documents.spec.id, completion(sources));
  const expected = { expectedSpecVersionId: completed.versionId!, expectedSpecSha256: completed.rawSha256!, expectedConfirmedGherkinVersionId: sources.g.versionId!, expectedConfirmedGherkinSha256: sources.g.rawSha256!, expectedConfirmedSdVersionId: sources.sd.versionId!, expectedConfirmedSdSha256: sources.sd.rawSha256! };
  for (const [key, error] of [['expectedSpecVersionId', 'VERSION_CONFLICT'], ['expectedSpecSha256', 'VERSION_CONFLICT'], ['expectedConfirmedGherkinVersionId', 'SOURCE_VERSION_MISMATCH'], ['expectedConfirmedGherkinSha256', 'SOURCE_VERSION_MISMATCH'], ['expectedConfirmedSdVersionId', 'SOURCE_VERSION_MISMATCH'], ['expectedConfirmedSdSha256', 'SOURCE_VERSION_MISMATCH']]) {
    await assert.rejects(core.startDevelopment(req.id, { ...expected, [key]: 'stale' }), errorCode(error, 409));
    assert.equal((await core.getRequirement(req.id)).stage, 'TESTS'); assert.deepEqual(await core.store.all('SELECT id FROM baselines'), []);
  }
  const started = await core.startDevelopment(req.id, expected); assert.equal(started.stage, 'IMPLEMENTATION'); assert.ok(started.baseline);
});
test('return invalidates confirmations/baselines/results atomically but keeps historical evidence', async t => {
  const { core, req, project } = await setup(t), sources = await skeleton(core, req);
  await core.saveVersion(req.documents.spec.id, completion(sources)); const started = await core.startDevelopment(req.id);
  assert.ok(started.baseline);
  await core.store.run("INSERT INTO runs(id,project_id,requirement_id,feature_id,origin,execution_scope,baseline_id,definition_snapshot_json,environment_snapshot_json,status) VALUES (?,?,?,?,'target_ci','ALL_REQUIRED',?,'{}','{}','FAILED')", ['old-run', project.id, req.id, req.featureId, started.baseline.id]);
  await core.store.run("UPDATE features SET stage='VERIFIED' WHERE id=?", [req.featureId]);
  const returned = await core.returnTo(req.id, 'gherkin');
  assert.equal(returned.stage, 'GHERKIN'); assert.deepEqual(returned.confirmations, {});
  assert.equal((await core.store.all('SELECT valid FROM baselines'))[0].valid, 0);
  assert.equal((await core.store.all('SELECT status FROM runs'))[0].status, 'INVALID');
  assert.equal((await core.getVersion(req.documents.spec.id, sources.sk.versionId!)).rawText, spec(true));
  await assert.rejects(core.startDevelopment(req.id), errorCode('WORKFLOW_GATE_NOT_MET', 409));
});
test('independent scripts save raw/actions without fabricated requirement or CI linkage', async t => {
  const { core, project, req } = await setup(t), original = await core.getRequirement(req.id);
  const saved = await core.createScript({ projectId: project.id, purpose: 'recording', rawText: spec(), actions: [{ kind: 'navigate', pageKey: 'page-1', url: 'https://example.com' }] });
  assert.equal(saved.requirementId, null); assert.equal(saved.sourceGherkinVersionId, null); assert.equal(saved.testStage, null);
  const restored = await core.getVersion(saved.id, saved.versionId!); assert.equal(restored.rawText, spec()); assert.equal(restored.actions?.length, 1);
  assert.equal((await core.store.all('SELECT * FROM test_case_mappings')).length, 0);
  assert.equal((await core.store.all('SELECT * FROM git_snapshots')).length, 0);
  assert.deepEqual(await core.getRequirement(req.id), original);
  const before = (await core.store.all('SELECT count(*) n FROM documents'))[0].n;
  await assert.rejects(core.createScript({ projectId: project.id, purpose: 'integration', rawText: 'const broken = ;' }), errorCode('SYNTAX_INVALID', 422));
  assert.equal((await core.store.all('SELECT count(*) n FROM documents'))[0].n, before);
});
test('normal Scenario has one explicit default source case; background arguments retain location', () => {
  const parsed = parseGherkin('Feature: F\n Background:\n  Given data\n   """\n   contents\n   """\n @AC-NORMAL-1\n Scenario: plain\n  When action\n  Then result\n', 'normal.feature');
  assert.equal(parsed.scenarios[0].kind, 'scenario'); assert.equal(parsed.groups[0].steps[0].line, 3);
  assert.ok(parsed.groups[0].steps[0].argument); assert.equal(parsed.pickles.length, 1);
  assert.throws(() => parseTypeScript("for (const k of ['a']) test(k,{annotation:{type:'workbenchTestId',description:'a'}},async()=>{});", 'dynamic.spec.ts', true), errorCode('MAPPING_INVALID', 422));
});
