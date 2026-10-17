import { randomUUID, createHash } from 'node:crypto';
import { createSqliteStore } from '../adapters/sqlite/store.ts';
import type { Row, SqlCommand, SqlValue } from '../ports/store.ts';
import { fail, invalid } from '../domain/errors.ts';
import { parseGherkin, parseTypeScript, type ParsedGherkin, type ParsedTest } from '../domain/parsers.ts';

export const sha256 = (raw: string | Uint8Array): string => createHash('sha256').update(raw).digest('hex');
export type SaveVersionInput = {
  rawText: string;
  expectedCurrentVersionId?: string | null;
  baseVersionId?: string | null;
  expectedConfirmedGherkinVersionId?: string;
  expectedConfirmedSdVersionId?: string;
  sourceGherkinVersionId?: string | null;
  testStage?: 'SKELETON' | 'COMPLETION_DRAFT' | 'COMPLETED' | null;
  sourceSkeletonVersionId?: string | null;
  manifest?: Record<string, any> | null;
  executionConfig?: Record<string, unknown>;
  actions?: Record<string, any>[];
};
export type ScenarioTestsQuery = { gherkinVersionId?: string; specVersionId?: string; skeletonVersionId?: string; testBaselineId?: string; runId?: string };
export type StartDevelopmentExpectations = {
  expectedSpecVersionId?: string;
  expectedSpecSha256?: string;
  expectedConfirmedGherkinVersionId?: string;
  expectedConfirmedGherkinSha256?: string;
  expectedConfirmedSdVersionId?: string;
  expectedConfirmedSdSha256?: string;
};

export async function createCore(metadataFile: string) {
  const store = await createSqliteStore(metadataFile);
  let serial: Promise<unknown> = Promise.resolve();
  const mutation = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = serial.then(operation); serial = result.catch(() => undefined); return result;
  };
  const one = async (sql: string, params: SqlValue[] = [], label = 'Resource'): Promise<Row> => {
    const rows = await store.all(sql, params);
    return rows[0] ?? fail(404, 'NOT_FOUND', `${label} not found`);
  };
  const insert = (table: string, row: Record<string, SqlValue>): SqlCommand => {
    const fields = Object.keys(row);
    return { sql: `INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`, params: Object.values(row), expectChanges: 1 };
  };
  const stageGuard = (id: string, stage: string): SqlCommand => ({ sql: 'SELECT id FROM requirements WHERE id=? AND stage=?', params: [id, stage], mode: 'all', expectRows: 1 });
  const document = (id: string) => one('SELECT * FROM documents WHERE id=?', [id], 'Document');
  const requirement = (id: string) => one('SELECT * FROM requirements WHERE id=?', [id], 'Requirement');
  const head = async (id: string): Promise<Row | undefined> => (await store.all('SELECT v.* FROM document_heads h JOIN document_versions v ON v.id=h.version_id WHERE h.document_id=?', [id]))[0];
  function view(d: Row, v?: Row) {
    return {
      id: String(d.id), documentId: String(d.id), projectId: d.project_id, requirementId: d.requirement_id,
      kind: d.kind, purpose: d.purpose, fileName: d.file_name, versionId: v?.id ?? null,
      versionNo: v?.version_no ?? null, rawText: v?.raw_text ?? null, rawSha256: v?.raw_sha256 ?? null,
      sourceGherkinVersionId: v?.source_gherkin_version_id ?? null,
      sourceSkeletonVersionId: v?.source_skeleton_version_id ?? null, testStage: v?.test_stage ?? null,
      manifest: v?.test_manifest_json ? JSON.parse(v.test_manifest_json) : null,
      manifestSha256: v?.test_manifest_sha256 ?? null,
      executionConfig: v?.execution_config_json ? JSON.parse(v.execution_config_json) : {}, createdAt: v?.created_at ?? null,
      parserName: v?.parser_name ?? null, parserVersion: v?.parser_version ?? null,
    };
  }
  async function getVersion(documentId: string, versionId: string) {
    const d = await document(documentId), v = await one('SELECT * FROM document_versions WHERE id=? AND document_id=?', [versionId, documentId], 'Version');
    const actions = d.purpose === 'recording' ? (await store.all('SELECT payload_json FROM recording_actions WHERE spec_version_id=? ORDER BY ordinal', [versionId])).map(row => JSON.parse(row.payload_json)) : undefined;
    return { ...view(d, v), ...(actions ? { actions } : {}) };
  }
  async function getRequirement(id: string) {
    const r = await requirement(id), documents: Record<string, ReturnType<typeof view>> = {};
    for (const d of await store.all("SELECT * FROM documents WHERE requirement_id=? AND purpose IN ('requirement','target_ci') ORDER BY id", [id]))
      documents[d.kind] = view(d, await head(d.id));
    const confirmations: Record<string, { versionId: string; rawSha256: string; confirmedAt: string }> = {};
    for (const c of await store.all('SELECT * FROM confirmations WHERE requirement_id=?', [id]))
      confirmations[c.kind] = { versionId: c.version_id, rawSha256: c.raw_sha256, confirmedAt: c.confirmed_at };
    const b = (await store.all("SELECT * FROM baselines WHERE requirement_id=? AND kind='tests' AND valid=1 ORDER BY rowid DESC LIMIT 1", [id]))[0];
    return { id: r.id as string, projectId: r.project_id as string, requirementKey: r.requirement_key as string, stage: r.stage as string, documents, confirmations,
      baseline: b ? { id: b.id, sha256: b.sha256, valid: !!b.valid, manifest: JSON.parse(b.manifest_json) } : null };
  }
  const invalidation = (id: string, kind: string): SqlCommand[] => {
    const result: SqlCommand[] = [];
    if (kind === 'gherkin') result.push({ sql: 'DELETE FROM confirmations WHERE requirement_id=?', params: [id] });
    else if (kind === 'sd') result.push({ sql: "DELETE FROM confirmations WHERE requirement_id=? AND kind='sd'", params: [id] });
    result.push({ sql: 'UPDATE baselines SET valid=0 WHERE requirement_id=?' + (kind === 'source' ? " AND kind='source'" : ''), params: [id] });
    result.push({ sql: "UPDATE runs SET status='INVALID' WHERE requirement_id=?", params: [id] });
    return result;
  };
  function checkStage(d: Row, r?: Row) {
    if (d.purpose === 'integration' || d.purpose === 'recording') return;
    const expected = { gherkin: 'GHERKIN', sd: 'SD', spec: 'TESTS' }[d.kind as string];
    if (r?.stage !== expected) fail(409, 'ARTIFACT_LOCKED_IN_STAGE', '此階段不可修改該產物');
  }
  async function projectionCommands(parsed: ParsedGherkin, versionId: string, requirementId: string): Promise<SqlCommand[]> {
    const commands: SqlCommand[] = [], ids = new Map<string, string>();
    for (const [ordinal, scenario] of parsed.scenarios.entries()) {
      const existing = (await store.all('SELECT id FROM scenarios WHERE requirement_id=? AND scenario_key=?', [requirementId, scenario.scenarioKey]))[0];
      const id = existing?.id ?? randomUUID(); ids.set(scenario.scenarioKey, id);
      if (!existing) commands.push(insert('scenarios', { id, requirement_id: requirementId, scenario_key: scenario.scenarioKey }));
      commands.push(insert('scenario_versions', { gherkin_version_id: versionId, scenario_id: id, ordinal: ordinal + 1, scenario_kind: scenario.kind, title: scenario.title, source_line: scenario.line, source_column: scenario.column }));
      if (scenario.kind === 'scenario') commands.push(insert('source_cases', { id: randomUUID(), gherkin_version_id: versionId, scenario_id: id, example_table_id: null, row_ordinal: 0, case_key: 'default' }));
      for (const [i, table] of scenario.examples.entries()) {
        const tableId = randomUUID();
        commands.push(insert('example_tables', { id: tableId, gherkin_version_id: versionId, scenario_id: id, ordinal: i + 1, title: table.title }));
        table.columns.forEach((name, column) => commands.push(insert('example_columns', { table_id: tableId, ordinal: column + 1, name })));
        for (const row of table.rows) {
          const caseId = randomUUID();
          commands.push(insert('source_cases', { id: caseId, gherkin_version_id: versionId, scenario_id: id, example_table_id: tableId, row_ordinal: row.rowOrdinal, case_key: row.caseKey }));
          row.values.forEach((value, column) => commands.push(insert('example_cells', { source_case_id: caseId, example_table_id: tableId, column_ordinal: column + 1, value })));
        }
      }
    }
    for (const group of parsed.groups) {
      const groupId = randomUUID();
      commands.push(insert('step_groups', { id: groupId, gherkin_version_id: versionId, scenario_id: group.scenarioKey ? ids.get(group.scenarioKey)! : null, scope: group.scope, owner_key: group.ownerKey }));
      group.steps.forEach((step, ordinal) => commands.push(insert('steps', { id: randomUUID(), group_id: groupId, ordinal: ordinal + 1, keyword: step.keyword, text: step.text, argument_json: step.argument === null ? null : JSON.stringify(step.argument), source_line: step.line, source_column: step.column })));
    }
    return commands;
  }
  async function mappedTests(d: Row, versionId: string, tests: ParsedTest[], sourceId: string | null, manifest: Record<string, any> | null, standard: boolean): Promise<SqlCommand[]> {
    const mappings = manifest?.mappings;
    if (standard && (!manifest || !Array.isArray(mappings))) invalid(d.file_name, 'MAPPING_INVALID', [{ line: 1, column: 1, reason: 'Standard spec requires an explicit mappings manifest' }]);
    if (mappings !== undefined && !Array.isArray(mappings)) invalid(d.file_name, 'MAPPING_INVALID', [{ line: 1, column: 1, reason: 'mappings must be an array' }]);
    const available: Row[] = sourceId ? await store.all('SELECT c.*,s.scenario_key FROM source_cases c JOIN scenarios s ON s.id=c.scenario_id WHERE c.gherkin_version_id=? AND s.requirement_id=?', [sourceId, d.requirement_id]) : [];
    const testsByKey = new Map(tests.map(test => [test.testKey, test])), matched = new Set<string>(), covered = new Set<string>(), pairs = new Set<string>();
    const definitionIds = new Map(tests.map(test => [test.testKey, randomUUID()])), commands: SqlCommand[] = [];
    for (const test of tests) commands.push(insert('test_definitions', { id: definitionIds.get(test.testKey)!, spec_version_id: versionId, test_key: test.testKey, title: test.title, source_line: test.line, source_column: test.column }));
    const errors: { line: number; column: number; reason: string; testKey?: string; sourceCaseKey?: string }[] = [];
    for (const mapping of mappings ?? []) {
      if (!mapping || typeof mapping !== 'object') { errors.push({ line: 1, column: 1, reason: 'Mapping must be an object' }); continue; }
      const test = testsByKey.get(mapping.testKey), location = { line: test?.line ?? 1, column: test?.column ?? 1, testKey: mapping.testKey };
      if (!test) { errors.push({ ...location, reason: `Mapping references undeclared test ${mapping.testKey}` }); continue; }
      const source = available.find(row => mapping.sourceCaseId ? row.id === mapping.sourceCaseId : (row.scenario_key === mapping.scenarioId || row.scenario_id === mapping.scenarioId) && row.case_key === mapping.caseId);
      if (!source) {
        const knownScenario = mapping.sourceCaseId || available.some(row => row.scenario_key === mapping.scenarioId || row.scenario_id === mapping.scenarioId);
        errors.push({ ...location, sourceCaseKey: mapping.sourceCaseId ?? `${mapping.scenarioId}/${mapping.caseId}`,
          reason: knownScenario ? '引用指定來源情境中不存在的Examples case_id' : '引用指定來源版本中不存在的Scenario ID' });
        continue;
      }
      if (mapping.sourceCaseId && (mapping.scenarioId !== undefined && ![source.scenario_key, source.scenario_id].includes(mapping.scenarioId) || mapping.caseId !== undefined && mapping.caseId !== source.case_key)) {
        errors.push({ ...location, sourceCaseKey: `${mapping.scenarioId ?? source.scenario_key}/${mapping.caseId ?? source.case_key}`,
          reason: `明確sourceCaseId ${mapping.sourceCaseId}與Scenario ID或Examples case_id不一致` });
        continue;
      }
      const pair = `${test.testKey}\0${source.id}`;
      if (pairs.has(pair)) { errors.push({ ...location, sourceCaseKey: `${source.scenario_key}/${source.case_key}`, reason: '完全相同test ID與來源案例的映射資料重複' }); continue; }
      pairs.add(pair); matched.add(test.testKey); covered.add(source.id);
      commands.push(insert('test_case_mappings', { test_definition_id: definitionIds.get(test.testKey)!, source_case_id: source.id }));
    }
    if (standard) {
      for (const test of tests) if (!matched.has(test.testKey)) errors.push({ ...test, reason: `有測試未提供明確的情境與案例對應：${test.testKey}` });
      for (const source of available) if (!covered.has(source.id)) errors.push({ line: 1, column: 1, sourceCaseKey: `${source.scenario_key}/${source.case_key}`, reason: '來源Gherkin有應生成的案例未對應任何測試' });
    }
    if (errors.length) invalid(d.file_name, 'MAPPING_INVALID', errors);
    return commands;
  }
  async function saveVersionUnsafe(documentId: string, payload: SaveVersionInput, newDocument?: Row) {
    const d = newDocument ?? await document(documentId), r = d.requirement_id ? await requirement(d.requirement_id) : undefined;
    checkStage(d, r);
    if (typeof payload.rawText !== 'string') fail(400, 'RAW_TEXT_REQUIRED', 'rawText must be a string');
    const raw = payload.rawText, hash = sha256(raw), versionId = randomUUID(), commands: SqlCommand[] = [];
    const expectedHead = payload.expectedCurrentVersionId !== undefined ? payload.expectedCurrentVersionId : payload.baseVersionId;
    if (payload.expectedCurrentVersionId !== undefined && payload.baseVersionId !== undefined && payload.expectedCurrentVersionId !== payload.baseVersionId)
      fail(400, 'INVALID_VERSION_EXPECTATION', 'Expected current version and baseVersionId disagree');
    if (expectedHead !== undefined && ((await head(documentId))?.id ?? null) !== expectedHead)
      fail(409, 'VERSION_CONFLICT', 'Document head changed; the submitted version was not saved');
    for (const [kind, expected] of [['gherkin', payload.expectedConfirmedGherkinVersionId], ['sd', payload.expectedConfirmedSdVersionId]] as const) {
      if (expected === undefined) continue;
      const guard: SqlCommand = { sql: 'SELECT c.version_id FROM confirmations c JOIN document_versions v ON v.id=c.version_id JOIN document_heads h ON h.document_id=v.document_id AND h.version_id=c.version_id WHERE c.requirement_id=? AND c.kind=? AND c.version_id=? AND v.raw_sha256=c.raw_sha256', params: [d.requirement_id ?? null, kind, expected], mode: 'all', expectRows: 1 };
      if (!(await store.all(guard.sql, guard.params)).length) fail(409, 'SOURCE_VERSION_MISMATCH', `Confirmed ${kind} version changed; the submitted version was not saved`);
      commands.push(guard);
    }
    const sourceId = payload.sourceGherkinVersionId ?? null, standard = d.kind === 'spec' && d.purpose === 'target_ci';
    const testStage = payload.testStage ?? null, skeletonId = payload.sourceSkeletonVersionId ?? null, manifest = payload.manifest ?? null;
    const modernManifest = Number(manifest?.schemaVersion ?? 0) >= 2;
    if (manifest && (typeof manifest !== 'object' || Array.isArray(manifest))) invalid(d.file_name, 'MAPPING_INVALID', [{ line: 1, column: 1, reason: 'manifest must be an object' }]);
    if (d.kind !== 'spec' && (testStage || skeletonId || manifest)) invalid(d.file_name, 'MAPPING_INVALID', [{ line: 1, column: 1, reason: 'Only spec documents may carry test-stage metadata' }]);
    if (testStage && (!standard || !['SKELETON', 'COMPLETION_DRAFT', 'COMPLETED'].includes(testStage))) invalid(d.file_name, 'MAPPING_INVALID', [{ line: 1, column: 1, reason: 'Invalid test stage or document purpose' }]);
    if (testStage && !manifest) invalid(d.file_name, 'MAPPING_INVALID', [{ line: 1, column: 1, reason: 'Test-stage snapshots require a manifest' }]);
    if (!testStage && skeletonId) invalid(d.file_name, 'MAPPING_INVALID', [{ line: 1, column: 1, reason: 'Source skeleton requires an explicit completion stage' }]);
    if (d.kind === 'gherkin' && sourceId) invalid(d.file_name, 'MAPPING_INVALID', [{ line: 1, column: 1, reason: 'Gherkin cannot reference a source Gherkin version' }]);
    if (d.kind === 'sd' || standard || sourceId) {
      if (!sourceId) invalid(d.file_name, 'MAPPING_INVALID', [{ line: 1, column: 1, reason: 'A source Gherkin version is required' }]);
      const source = (await store.all('SELECT v.*,d.kind,d.project_id,d.requirement_id FROM document_versions v JOIN documents d ON d.id=v.document_id WHERE v.id=?', [sourceId]))[0];
      if (!source || source.kind !== 'gherkin' || source.project_id !== d.project_id || source.requirement_id !== d.requirement_id)
        invalid(d.file_name, 'MAPPING_INVALID', [{ line: 1, column: 1, reason: 'Source Gherkin belongs to a different document kind, project or requirement' }]);
      if (d.kind === 'sd' || standard) {
        const guard: SqlCommand = { sql: "SELECT c.version_id FROM confirmations c JOIN document_versions v ON v.id=c.version_id JOIN document_heads h ON h.document_id=v.document_id AND h.version_id=c.version_id WHERE c.requirement_id=? AND c.kind='gherkin' AND c.version_id=? AND c.raw_sha256=? AND v.raw_sha256=c.raw_sha256", params: [d.requirement_id, sourceId, source.raw_sha256], mode: 'all', expectRows: 1 };
        if (!(await store.all(guard.sql, guard.params)).length) fail(409, 'GHERKIN_NOT_CONFIRMED', 'Source Gherkin version must be currently confirmed');
        commands.push(guard);
      }
      if (manifest?.sourceGherkinVersionId && manifest.sourceGherkinVersionId !== sourceId) invalid(d.file_name, 'MAPPING_INVALID', [{ line: 1, column: 1, reason: 'Manifest source Gherkin version mismatch' }]);
      if (manifest?.gherkinSha256 && manifest.gherkinSha256 !== source.raw_sha256) invalid(d.file_name, 'MAPPING_INVALID', [{ line: 1, column: 1, reason: 'Manifest Gherkin hash mismatch' }]);
      if (standard && modernManifest && (manifest?.sourceGherkinVersionId !== sourceId || manifest?.gherkinSha256 !== source.raw_sha256))
        invalid(d.file_name, 'MAPPING_INVALID', [{ line: 1, column: 1, reason: 'Manifest schemaVersion>=2 requires the exact confirmed Gherkin version and hash' }]);
    }
    let confirmedSd: Row | undefined;
    if (standard) {
      const sd = (await store.all("SELECT v.* FROM confirmations c JOIN document_versions v ON v.id=c.version_id JOIN documents d ON d.id=v.document_id JOIN document_heads h ON h.document_id=d.id AND h.version_id=c.version_id WHERE c.requirement_id=? AND c.kind='sd' AND v.raw_sha256=c.raw_sha256 AND v.source_gherkin_version_id=?", [d.requirement_id, sourceId]))[0];
      if (!sd) fail(409, 'SD_NOT_CONFIRMED', 'Current SD must be confirmed for the selected Gherkin');
      confirmedSd = sd;
      if (manifest?.sdSha256 && manifest.sdSha256 !== sd.raw_sha256) invalid(d.file_name, 'MAPPING_INVALID', [{ line: 1, column: 1, reason: 'Manifest SD hash mismatch' }]);
      if (manifest?.sdVersionId && manifest.sdVersionId !== sd.id) invalid(d.file_name, 'MAPPING_INVALID', [{ line: 1, column: 1, reason: 'Manifest SD version mismatch' }]);
      if (modernManifest && (manifest?.sdVersionId !== sd.id || manifest?.sdSha256 !== sd.raw_sha256))
        invalid(d.file_name, 'MAPPING_INVALID', [{ line: 1, column: 1, reason: 'Manifest schemaVersion>=2 requires the exact confirmed SD version and hash' }]);
      commands.push({ sql: "SELECT version_id FROM confirmations WHERE requirement_id=? AND kind='sd' AND version_id=? AND raw_sha256=?", params: [d.requirement_id, sd.id, sd.raw_sha256], mode: 'all', expectRows: 1 });
    }
    if (standard && !testStage && !manifest) invalid(d.file_name, 'MAPPING_INVALID', [{ line: 1, column: 1, reason: 'Standard spec requires a manifest; Git imports must provide their immutable source reference' }]);
    if (standard && manifest?.specSha256 !== hash) invalid(d.file_name, 'MAPPING_INVALID', [{ line: 1, column: 1, reason: 'Manifest specSha256 does not match submitted UTF-8 source' }]);
    if (testStage === 'SKELETON' && skeletonId) invalid(d.file_name, 'MAPPING_INVALID', [{ line: 1, column: 1, reason: 'Skeleton cannot reference another skeleton' }]);
    if ((testStage === 'COMPLETION_DRAFT' || testStage === 'COMPLETED') && !skeletonId) invalid(d.file_name, 'MAPPING_INVALID', [{ line: 1, column: 1, reason: 'Completion requires an immutable source skeleton' }]);
    let skeleton: Row | undefined;
    if (skeletonId) {
      skeleton = (await store.all('SELECT * FROM document_versions WHERE id=?', [skeletonId]))[0];
      if (!skeleton || skeleton.document_id !== documentId || skeleton.test_stage !== 'SKELETON' || skeleton.source_gherkin_version_id !== sourceId)
        invalid(d.file_name, 'MAPPING_INVALID', [{ line: 1, column: 1, reason: 'Source skeleton must be SKELETON of this document and source Gherkin' }]);
      if (manifest?.sourceSkeletonSha256 !== skeleton.raw_sha256 || (manifest?.sourceSkeletonVersionId && manifest.sourceSkeletonVersionId !== skeletonId) || (manifest?.sourceSkeletonManifestSha256 && manifest.sourceSkeletonManifestSha256 !== skeleton.test_manifest_sha256))
        invalid(d.file_name, 'MAPPING_INVALID', [{ line: 1, column: 1, reason: 'Source skeleton version/hash/manifest mismatch' }]);
      const skeletonManifest = skeleton.test_manifest_json ? JSON.parse(skeleton.test_manifest_json) : {};
      if (confirmedSd && (skeletonManifest.sdVersionId ? skeletonManifest.sdVersionId !== confirmedSd.id : Number(confirmedSd.version_no) > 1))
        fail(409, 'REGENERATE_SKELETON_REQUIRED', 'Source skeleton is not bound to this confirmed SD version; regenerate tests before completion');
    }
    let parserName: string | null = null, parserVersion: string | null = null;
    if (d.kind === 'gherkin') {
      const parsed = parseGherkin(raw, d.file_name); parserName = '@cucumber/gherkin'; parserVersion = '39.1.0';
      commands.push(...await projectionCommands(parsed, versionId, d.requirement_id));
    } else if (d.kind === 'spec') {
      const parsed = parseTypeScript(raw, d.file_name, standard); parserName = 'typescript'; parserVersion = '5.9.3';
      if (testStage === 'COMPLETED' && parsed.pending) fail(409, 'TESTS_PENDING_COMPLETION', 'Unimplemented steps cannot form a completed test snapshot');
      // Validate the submitted mapping before comparing against the immutable
      // skeleton, so its actual missing/duplicate/unknown reference is reported.
      commands.push(...await mappedTests(d, versionId, parsed.tests, sourceId, manifest, standard));
      if (skeleton) {
        const oldMappings = await store.all('SELECT t.test_key,c.id AS source_case_id,c.scenario_id,c.case_key FROM test_definitions t JOIN test_case_mappings m ON m.test_definition_id=t.id JOIN source_cases c ON c.id=m.source_case_id WHERE t.spec_version_id=?', [skeletonId]);
        for (const old of oldMappings) {
          const scenario = await one('SELECT scenario_key FROM scenarios WHERE id=?', [old.scenario_id]);
          if (!parsed.tests.some(t => t.testKey === old.test_key) || !manifest?.mappings?.some((m: any) => m.testKey === old.test_key && (m.sourceCaseId === old.source_case_id || (m.scenarioId === old.scenario_id || m.scenarioId === scenario.scenario_key) && m.caseId === old.case_key)))
            invalid(d.file_name, 'MAPPING_INVALID', [{ line: 1, column: 1, testKey: old.test_key, reason: 'Completion cannot delete or remap a source skeleton test' }]);
        }
      }
    }
    const current = await head(documentId), max = await one('SELECT COALESCE(MAX(version_no),0) AS n FROM document_versions WHERE document_id=?', [documentId]);
    if (expectedHead !== undefined && (current?.id ?? null) !== expectedHead)
      fail(409, 'VERSION_CONFLICT', 'Document head changed; the submitted version was not saved');
    const manifestJson = manifest ? JSON.stringify(manifest) : null;
    const version = insert('document_versions', { id: versionId, document_id: documentId, version_no: Number(max.n) + 1, raw_text: raw, raw_sha256: hash, parser_name: parserName, parser_version: parserVersion, projection_schema_version: 1,
      source_gherkin_version_id: sourceId, test_stage: testStage, source_skeleton_version_id: skeletonId, test_manifest_json: manifestJson, test_manifest_sha256: manifestJson ? sha256(manifestJson) : null,
      execution_config_json: JSON.stringify(payload.executionConfig ?? {}), created_at: new Date().toISOString() });
    const transaction = [...(newDocument ? [insert('documents', newDocument)] : []), version, ...commands];
    for (const [index, action] of (payload.actions ?? []).entries()) transaction.push(insert('recording_actions', { spec_version_id: versionId, ordinal: index + 1, page_key: String(action.pageKey ?? action.pageId ?? 'page-1'), action_kind: String(action.kind ?? action.type ?? 'unknown'), locator_json: action.locator ? JSON.stringify(action.locator) : null, payload_json: JSON.stringify(action) }));
    if (r && d.purpose !== 'recording' && d.purpose !== 'integration') transaction.push(...invalidation(r.id, d.kind), stageGuard(r.id, r.stage));
    if (expectedHead !== undefined) transaction.push({ sql: 'SELECT document_id FROM document_heads WHERE document_id=?' + (expectedHead === null ? '' : ' AND version_id=?'), params: expectedHead === null ? [documentId] : [documentId, expectedHead], mode: 'all', expectRows: expectedHead === null ? 0 : 1 });
    if (current) transaction.push({ sql: 'UPDATE document_heads SET version_id=? WHERE document_id=? AND version_id=?', params: [versionId, documentId, current.id], expectChanges: 1 });
    else transaction.push(insert('document_heads', { document_id: documentId, version_id: versionId }));
    await store.batch(transaction);
    return { ...await getVersion(documentId, versionId), savedVersionId: versionId };
  }
  async function structure(documentId: string, versionId: string) {
    const v = await getVersion(documentId, versionId);
    const [scenarios, stepGroups, steps, exampleTables, exampleColumns, sourceCases, exampleCells, testDefinitions, mappings] = await Promise.all([
      store.all('SELECT s.id,s.scenario_key,sv.* FROM scenario_versions sv JOIN scenarios s ON s.id=sv.scenario_id WHERE sv.gherkin_version_id=? ORDER BY sv.ordinal', [versionId]),
      store.all('SELECT * FROM step_groups WHERE gherkin_version_id=? ORDER BY owner_key', [versionId]),
      store.all('SELECT st.* FROM steps st JOIN step_groups g ON g.id=st.group_id WHERE g.gherkin_version_id=? ORDER BY g.owner_key,st.ordinal', [versionId]),
      store.all('SELECT * FROM example_tables WHERE gherkin_version_id=? ORDER BY ordinal', [versionId]),
      store.all('SELECT c.* FROM example_columns c JOIN example_tables e ON e.id=c.table_id WHERE e.gherkin_version_id=? ORDER BY c.table_id,c.ordinal', [versionId]),
      store.all('SELECT * FROM source_cases WHERE gherkin_version_id=? ORDER BY scenario_id,row_ordinal', [versionId]),
      store.all('SELECT e.* FROM example_cells e JOIN source_cases c ON c.id=e.source_case_id WHERE c.gherkin_version_id=? ORDER BY c.id,e.column_ordinal', [versionId]),
      store.all('SELECT * FROM test_definitions WHERE spec_version_id=? ORDER BY source_line', [versionId]),
      store.all('SELECT m.*,c.case_key,c.gherkin_version_id,c.scenario_id,s.scenario_key,t.test_key FROM test_case_mappings m JOIN test_definitions t ON t.id=m.test_definition_id JOIN source_cases c ON c.id=m.source_case_id JOIN scenarios s ON s.id=c.scenario_id WHERE t.spec_version_id=? ORDER BY t.test_key', [versionId]),
    ]);
    const camel = (row: Row): Row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), value]));
    return { documentId, versionId, rawSha256: v.rawSha256, scenarios: scenarios.map(camel), stepGroups: stepGroups.map(camel), steps: steps.map(camel), exampleTables: exampleTables.map(camel), exampleColumns: exampleColumns.map(camel), sourceCases: sourceCases.map(camel), exampleCells: exampleCells.map(camel), testDefinitions: testDefinitions.map(camel), mappings: mappings.map(camel) };
  }
  async function confirmUnsafe(requirementId: string, kind: 'gherkin' | 'sd', body: { versionId: string; rawSha256: string }) {
    if (!['gherkin', 'sd'].includes(kind)) fail(400, 'INVALID_KIND', 'Unknown confirmation kind');
    const r = await requirement(requirementId), expectedStage = kind === 'gherkin' ? 'GHERKIN' : 'SD';
    if (r.stage !== expectedStage) fail(409, 'ARTIFACT_LOCKED_IN_STAGE', '此階段不可修改該產物');
    const d = await one("SELECT * FROM documents WHERE requirement_id=? AND kind=? AND purpose='requirement'", [requirementId, kind], 'Document'), v = await head(d.id);
    if (!v || v.id !== body.versionId || v.raw_sha256 !== body.rawSha256) fail(409, 'CONFIRMATION_VERSION_MISMATCH', 'Confirmation must bind the current version and exact raw SHA-256');
    const commands: SqlCommand[] = [];
    if (kind === 'sd') {
      const source = (await store.all("SELECT c.*,h.version_id AS current_id,v.raw_sha256 AS current_hash FROM confirmations c JOIN document_versions v ON v.id=c.version_id JOIN document_heads h ON h.document_id=v.document_id WHERE c.requirement_id=? AND c.kind='gherkin'", [requirementId]))[0];
      if (!source || source.current_id !== source.version_id || source.current_hash !== source.raw_sha256 || v!.source_gherkin_version_id !== source.version_id) fail(409, 'GHERKIN_NOT_CONFIRMED', 'SD must reference the currently confirmed Gherkin');
      commands.push({ sql: "SELECT version_id FROM confirmations WHERE requirement_id=? AND kind='gherkin' AND version_id=? AND raw_sha256=?", params: [requirementId, source.version_id, source.raw_sha256], mode: 'all', expectRows: 1 });
    }
    commands.push({ sql: 'SELECT version_id FROM document_heads WHERE document_id=? AND version_id=?', params: [d.id, body.versionId], mode: 'all', expectRows: 1 },
      { sql: 'INSERT INTO confirmations(requirement_id,kind,version_id,raw_sha256,confirmed_at) VALUES(?,?,?,?,?) ON CONFLICT(requirement_id,kind) DO UPDATE SET version_id=excluded.version_id,raw_sha256=excluded.raw_sha256,confirmed_at=excluded.confirmed_at', params: [requirementId, kind, body.versionId, body.rawSha256, new Date().toISOString()], expectChanges: 1 },
      { sql: 'UPDATE requirements SET stage=? WHERE id=? AND stage=?', params: [kind === 'gherkin' ? 'SD' : 'TESTS', requirementId, expectedStage], expectChanges: 1 });
    await store.batch(commands); return getRequirement(requirementId);
  }
  async function scenarioTests(requirementId: string, query: ScenarioTestsQuery = {}) {
    const r = await getRequirement(requirementId);
    let specVersionId = query.specVersionId ?? query.skeletonVersionId ?? r.documents.spec?.versionId;
    let sourceId = query.gherkinVersionId ?? r.confirmations.gherkin?.versionId ?? r.documents.gherkin?.versionId;
    if (query.testBaselineId) {
      await one("SELECT id FROM baselines WHERE id=? AND requirement_id=? AND kind='tests'", [query.testBaselineId, requirementId], 'Baseline');
      const versions = await store.all('SELECT v.*,d.kind FROM baseline_documents bd JOIN document_versions v ON v.id=bd.document_version_id JOIN documents d ON d.id=v.document_id WHERE bd.baseline_id=?', [query.testBaselineId]);
      specVersionId = versions.find(v => v.kind === 'spec')?.id; sourceId = versions.find(v => v.kind === 'gherkin')?.id;
    }
    if (!sourceId) return { requirementId, gherkinVersionId: null, specVersionId: null, testBaselineId: r.baseline?.id ?? null, scenarios: [], cases: [] };
    await one("SELECT v.id FROM document_versions v JOIN documents d ON d.id=v.document_id WHERE v.id=? AND d.requirement_id=? AND d.kind='gherkin'", [sourceId, requirementId], 'Source Gherkin');
    const spec = specVersionId ? await one("SELECT v.* FROM document_versions v JOIN documents d ON d.id=v.document_id WHERE v.id=? AND d.requirement_id=? AND d.kind='spec'", [specVersionId, requirementId], 'Spec') : undefined;
    if (spec && spec.source_gherkin_version_id !== sourceId) fail(409, 'SOURCE_VERSION_MISMATCH', 'Spec snapshot references a different Gherkin version');
    if (query.runId) await one('SELECT id FROM runs WHERE id=? AND requirement_id=?', [query.runId, requirementId], 'Run');
    const cases = await store.all('SELECT c.*,s.scenario_key,sv.title,sv.ordinal,sv.scenario_kind FROM source_cases c JOIN scenarios s ON s.id=c.scenario_id JOIN scenario_versions sv ON sv.gherkin_version_id=c.gherkin_version_id AND sv.scenario_id=c.scenario_id WHERE c.gherkin_version_id=? ORDER BY sv.ordinal,c.row_ordinal', [sourceId]);
    const allTests = specVersionId ? await store.all('SELECT t.*,m.source_case_id FROM test_definitions t JOIN test_case_mappings m ON m.test_definition_id=t.id WHERE t.spec_version_id=? ORDER BY t.test_key', [specVersionId]) : [];
    const readiness = spec?.test_stage === 'COMPLETED' ? 'COMPLETED' : 'PENDING_COMPLETION';
    const rendered: Row[] = [];
    for (const c of cases) {
      const tests = [];
      for (const t of allTests.filter(t => t.source_case_id === c.id)) {
        const result = query.runId ? (await store.all('SELECT * FROM case_results WHERE run_id=? AND test_definition_id=?', [query.runId, t.id]))[0] : undefined;
        tests.push({ id: t.id, testDefinitionId: t.id, testKey: t.test_key, title: t.title, status: result?.status ?? 'NOT_RUN', executionStatus: result?.status ?? 'NOT_RUN', caseResultId: result?.id ?? null });
      }
      const values = await store.all('SELECT col.name,e.value FROM example_cells e JOIN example_columns col ON col.table_id=e.example_table_id AND col.ordinal=e.column_ordinal WHERE e.source_case_id=? ORDER BY col.ordinal', [c.id]);
      const selected = query.runId ? !!(await store.all('SELECT source_case_id FROM run_source_cases WHERE run_id=? AND source_case_id=?', [query.runId, c.id])).length : false;
      const statuses = tests.map(t => t.status);
      const status = statuses.includes('FAILED') ? 'FAILED' : statuses.includes('INVALID') ? 'INVALID' : statuses.includes('RUNNING') ? 'RUNNING' : tests.length && statuses.every(s => s === 'PASSED') ? 'PASSED' : statuses.includes('INCOMPLETE') ? 'INCOMPLETE' : 'NOT_RUN';
      rendered.push({ id: c.id, sourceCaseId: c.id, scenarioId: c.scenario_key, scenarioEntityId: c.scenario_id, caseId: c.case_key, caseKey: c.case_key, title: c.title, scenarioKind: c.scenario_kind, values: Object.fromEntries(values.map(row => [row.name, row.value])), tests, testIds: tests.map(t => t.testKey), testKeys: tests.map(t => t.testKey), readiness, executionStatus: status, status, selected });
    }
    return { requirementId, gherkinVersionId: sourceId, specVersionId: specVersionId ?? null, testBaselineId: query.testBaselineId ?? r.baseline?.id ?? null, readiness,
      scenarios: [...new Set(rendered.map(c => c.scenarioId))].map(id => ({ scenarioId: id, title: rendered.find(c => c.scenarioId === id)!.title, cases: rendered.filter(c => c.scenarioId === id) })), cases: rendered };
  }
  return {
    store, sqliteVersion: store.sqliteVersion,
    async listProjects() { return (await store.all('SELECT * FROM projects ORDER BY rowid')).map(p => ({ id: p.id, name: p.name, workspaceRef: p.workspace_ref })); },
    createProject(input: { name: string; workspaceRef: string }) { return mutation(async () => {
      if (!input.name?.trim() || !input.workspaceRef?.trim()) fail(400, 'INVALID_PROJECT', 'name and workspaceRef are required');
      const id = randomUUID(); await store.batch([insert('projects', { id, name: input.name, workspace_ref: input.workspaceRef })]);
      return { id, name: input.name, workspaceRef: input.workspaceRef };
    }); },
    async listRequirements(projectId: string) { await one('SELECT id FROM projects WHERE id=?', [projectId], 'Project'); return Promise.all((await store.all('SELECT id FROM requirements WHERE project_id=? ORDER BY rowid', [projectId])).map(r => getRequirement(r.id))); },
    createRequirement(projectId: string, input: { requirementKey: string }) { return mutation(async () => {
      await one('SELECT id FROM projects WHERE id=?', [projectId], 'Project');
      if (!input.requirementKey?.trim()) fail(400, 'INVALID_REQUIREMENT', 'requirementKey is required');
      if ((await store.all('SELECT id FROM requirements WHERE project_id=? AND requirement_key=?', [projectId, input.requirementKey])).length) fail(409, 'REQUIREMENT_EXISTS', 'requirementKey already exists in this project');
      const id = randomUUID(), commands = [insert('requirements', { id, project_id: projectId, requirement_key: input.requirementKey, stage: 'GHERKIN' })];
      for (const kind of ['gherkin', 'sd', 'spec']) commands.push(insert('documents', { id: randomUUID(), project_id: projectId, requirement_id: id, kind, purpose: kind === 'spec' ? 'target_ci' : 'requirement', file_name: kind === 'gherkin' ? `${input.requirementKey}.feature` : kind === 'sd' ? 'SD.md' : `${input.requirementKey}.spec.ts` }));
      await store.batch(commands); return getRequirement(id);
    }); },
    getRequirement, getVersion, structure, scenarioTests,
    saveVersion(documentId: string, payload: SaveVersionInput) { return mutation(() => saveVersionUnsafe(documentId, payload)); },
    createScript(input: { projectId: string; requirementId?: string | null; purpose: 'recording' | 'integration'; rawText: string; actions?: Record<string, any>[]; sourceGherkinVersionId?: string | null; mappings?: Record<string, any>[]; executionConfig?: Record<string, unknown>; fileName?: string }) { return mutation(async () => {
      await one('SELECT id FROM projects WHERE id=?', [input.projectId], 'Project');
      if (!['recording', 'integration'].includes(input.purpose)) fail(400, 'INVALID_PURPOSE', 'Script purpose must be recording or integration');
      if (input.requirementId) await one('SELECT id FROM requirements WHERE id=? AND project_id=?', [input.requirementId, input.projectId], 'Requirement');
      if (!input.requirementId && (input.sourceGherkinVersionId || input.mappings?.length)) invalid(input.fileName ?? 'script.spec.ts', 'MAPPING_INVALID', [{ line: 1, column: 1, reason: 'Source mappings require an actual requirement association' }]);
      const id = randomUUID(), d = { id, project_id: input.projectId, requirement_id: input.requirementId ?? null, kind: 'spec', purpose: input.purpose, file_name: input.fileName ?? `${input.purpose}.spec.ts` };
      const result = await saveVersionUnsafe(id, { rawText: input.rawText, sourceGherkinVersionId: input.sourceGherkinVersionId, actions: input.actions, executionConfig: input.executionConfig,
        manifest: input.mappings?.length ? { sourceGherkinVersionId: input.sourceGherkinVersionId, specSha256: sha256(input.rawText), mappings: input.mappings } : null }, d);
      return { ...result, id };
    }); },
    confirm(requirementId: string, kind: 'gherkin' | 'sd', body: { versionId: string; rawSha256: string }) { return mutation(() => confirmUnsafe(requirementId, kind, body)); },
    returnTo(requirementId: string, artifactKind: string) { return mutation(async () => {
      const r = await requirement(requirementId);
      const kind = ({ Gherkin: 'gherkin', SD: 'sd', 'spec.ts': 'spec', '測試': 'spec', '測試基線': 'spec', '產品程式': 'source', implementation: 'source', tests: 'spec' } as Record<string, string>)[artifactKind] ?? artifactKind;
      const target = ({ gherkin: 'GHERKIN', sd: 'SD', spec: 'TESTS', source: 'IMPLEMENTATION' } as Record<string, string>)[kind];
      if (!target) fail(400, 'INVALID_ARTIFACT', 'Unknown artifact kind');
      const order = ['GHERKIN', 'SD', 'TESTS', 'IMPLEMENTATION', 'VERIFICATION', 'VERIFIED'];
      if (order.indexOf(target) > order.indexOf(r.stage)) fail(409, 'INVALID_STAGE_TRANSITION', 'Return cannot skip forward over workflow gates');
      await store.batch([...invalidation(requirementId, kind), { sql: 'UPDATE requirements SET stage=? WHERE id=? AND stage=?', params: [target, requirementId, r.stage], expectChanges: 1 }]);
      return getRequirement(requirementId);
    }); },
    startDevelopment(requirementId: string, expectations: StartDevelopmentExpectations = {}) { return mutation(async () => {
      const r = await getRequirement(requirementId);
      if (r.stage !== 'TESTS' || !r.confirmations.gherkin || !r.confirmations.sd) fail(409, 'WORKFLOW_GATE_NOT_MET', 'Gherkin and SD must be confirmed before development');
      if (expectations.expectedSpecVersionId !== undefined && expectations.expectedSpecVersionId !== r.documents.spec?.versionId || expectations.expectedSpecSha256 !== undefined && expectations.expectedSpecSha256 !== r.documents.spec?.rawSha256)
        fail(409, 'VERSION_CONFLICT', 'The validated test snapshot version/hash changed before development');
      for (const [kind, versionId, rawSha256] of [['gherkin', expectations.expectedConfirmedGherkinVersionId, expectations.expectedConfirmedGherkinSha256], ['sd', expectations.expectedConfirmedSdVersionId, expectations.expectedConfirmedSdSha256]] as const)
        if (versionId !== undefined && versionId !== r.confirmations[kind].versionId || rawSha256 !== undefined && rawSha256 !== r.confirmations[kind].rawSha256)
          fail(409, 'SOURCE_VERSION_MISMATCH', `The validated ${kind} confirmation version/hash changed before development`);
      for (const kind of ['gherkin', 'sd']) if (r.documents[kind]?.versionId !== r.confirmations[kind].versionId || r.documents[kind]?.rawSha256 !== r.confirmations[kind].rawSha256)
        fail(409, 'CONFIRMATION_VERSION_MISMATCH', 'Development must use current confirmed document heads');
      const spec = r.documents.spec;
      if (!spec?.versionId || spec.testStage !== 'COMPLETED') fail(409, 'TESTS_PENDING_COMPLETION', 'Tests are pending completion');
      if (spec.sourceGherkinVersionId !== r.confirmations.gherkin.versionId || r.documents.sd.sourceGherkinVersionId !== r.confirmations.gherkin.versionId) fail(409, 'SOURCE_VERSION_MISMATCH', 'Completed baseline must reference current confirmed documents');
      if (spec.manifest?.sdVersionId ? spec.manifest.sdVersionId !== r.confirmations.sd.versionId : Number(r.documents.sd.versionNo) > 1)
        fail(409, 'REGENERATE_SKELETON_REQUIRED', 'Completed tests are not bound to this confirmed SD version; regenerate and complete tests');
      const tests = await store.all('SELECT t.*,m.source_case_id FROM test_definitions t JOIN test_case_mappings m ON m.test_definition_id=t.id WHERE t.spec_version_id=? ORDER BY t.test_key', [spec.versionId]);
      if (!tests.length) fail(409, 'MAPPING_INVALID', 'Cannot create an empty test baseline');
      const baselineId = randomUUID(), manifest = { gherkinVersionId: r.confirmations.gherkin.versionId, gherkinSha256: r.confirmations.gherkin.rawSha256, sdVersionId: r.confirmations.sd.versionId, sdSha256: r.confirmations.sd.rawSha256, specVersionId: spec.versionId, specSha256: spec.rawSha256, tests: tests.map(t => ({ testDefinitionId: t.id, testKey: t.test_key, sourceCaseId: t.source_case_id })) }, json = JSON.stringify(manifest);
      const commands: SqlCommand[] = [stageGuard(requirementId, 'TESTS'), { sql: "UPDATE baselines SET valid=0 WHERE requirement_id=? AND kind='tests'", params: [requirementId] }, insert('baselines', { id: baselineId, requirement_id: requirementId, kind: 'tests', manifest_json: json, sha256: sha256(json), valid: 1 })];
      for (const kind of ['gherkin', 'sd']) commands.push({ sql: 'SELECT c.version_id FROM confirmations c JOIN document_versions v ON v.id=c.version_id JOIN document_heads h ON h.document_id=v.document_id AND h.version_id=v.id WHERE c.requirement_id=? AND c.kind=? AND c.version_id=? AND c.raw_sha256=? AND v.raw_sha256=c.raw_sha256', params: [requirementId, kind, r.confirmations[kind].versionId, r.confirmations[kind].rawSha256], mode: 'all', expectRows: 1 });
      commands.push({ sql: 'SELECT h.version_id FROM document_heads h JOIN document_versions v ON v.id=h.version_id WHERE h.document_id=? AND h.version_id=? AND v.raw_sha256=?', params: [spec.id, spec.versionId, spec.rawSha256], mode: 'all', expectRows: 1 });
      for (const versionId of [r.confirmations.gherkin.versionId, r.confirmations.sd.versionId, spec.versionId]) commands.push(insert('baseline_documents', { baseline_id: baselineId, document_version_id: versionId }));
      commands.push({ sql: "UPDATE requirements SET stage='IMPLEMENTATION' WHERE id=? AND stage='TESTS'", params: [requirementId], expectChanges: 1 });
      await store.batch(commands); return getRequirement(requirementId);
    }); },
    async close() { await serial; await store.close(); },
  };
}
export type Core = Awaited<ReturnType<typeof createCore>>;
