import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { Store, Row, SqlCommand } from '../ports/store.ts';
import type { BrowserRuntimePort, BrowserAttachment } from '../ports/runtime.ts';
import { CoreError } from '../domain/errors.ts';
import type {TestRunnerPort, PreparedRun} from '../ports/runner.ts';
import {requiredRecordingSecretAliases,resolveRecordingSecrets,type RecordingSecretResolver} from '../domain/recording-secrets.js';

interface Options {store: Store; browser: BrowserRuntimePort; runner: TestRunnerPort; artifactRoot: string; root: string; baseUrl: string; emit: (event: Record<string, any>) => void | Promise<void>;
  resolveSource: (projectId: string, sourceRef: string) => Promise<{sourceRef: string; resolvedCommit: string; repositoryRef?: string; [key: string]: unknown}>;
  resolveRecordingSecret?: RecordingSecretResolver;
  executeCi?: (input: {runId: string; prepared: PreparedRun; env: NodeJS.ProcessEnv}) => Promise<{code: number; stdout: string; stderr: string}>}
interface Definition {id: string; testKey: string; sourceCaseId: string; scenarioId: string | null; scenarioEntityId: string | null; caseId: string | null; specVersionId: string}
interface Snapshot {gherkinVersionId: string | null; versions: string[]; definitions: Definition[]; required: Definition[]; sourceCases: Row[]; materializations: PreparedRun['materializations']; discovery: unknown; createdAt: string}
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const asJson = (value: unknown) => JSON.stringify(value ?? null);
const insert = (table: string, fields: Record<string, any>): SqlCommand => ({sql: `INSERT INTO ${table}(${Object.keys(fields).join(',')}) VALUES(${Object.keys(fields).map(() => '?').join(',')})`, params: Object.values(fields)});
const terminalStatus = new Set(['PASSED', 'FAILED', 'INCOMPLETE', 'INVALID']);
function fail(status: number, code: string, message: string): never { throw new CoreError(status, code, message); }

export function createRuns(options: Options) {
  const {store, browser, artifactRoot, emit} = options;
  const runner = options.runner;
  const contexts = new Map<string, {app: BrowserAttachment; db?: BrowserAttachment; sourceSteps: Record<string, string>}>();
  const eventIds = new Set<string>();
  const runnerCompletions = new Map<string, any>();
  const started = new Set<string>();
  const bindingSequences = new Map<string, number>();
  const completion = new Map<string, Promise<void>>();
  const recordingSecretValues=new Map<string,string[]>();
  function redact(value:any,secrets:string[]):any {if(typeof value==='string'){for(const secret of secrets)if(secret)value=value.replaceAll(secret,'[REDACTED]');return value;}if(Array.isArray(value))return value.map(item=>redact(item,secrets));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,redact(item,secrets)]));return value;}
  let writes: Promise<unknown> = Promise.resolve();
  function mutation<T>(body: () => Promise<T>): Promise<T> { const task = writes.then(body, body); writes = task.then(() => undefined, () => undefined); return task; }
  async function one(sql: string, params: any[] = [], label = 'Resource'): Promise<Row> { const row = (await store.all(sql, params))[0]; if (!row) fail(404, 'NOT_FOUND', label + ' not found'); return row; }
  const snapshot = (run: Row) => JSON.parse(run.definition_snapshot_json) as Snapshot;
  const definitions = async (runId: string) => snapshot(await one('SELECT * FROM runs WHERE id=?', [runId], 'Run'));
  async function publish(run: Row, event: Record<string, any>) { await emit({eventId: randomUUID(), projectId: run.project_id, requirementId: run.requirement_id, runId: run.id, ...event}); }
  async function applicableSteps(gherkinVersionId: string | null, scenarioId: string | null) {
    const groups = await store.all('SELECT * FROM step_groups WHERE gherkin_version_id=?', [gherkinVersionId]);
    const scenario = groups.find(group => group.scenario_id === scenarioId && group.scope === 'scenario');
    const ids = groups.filter(group => group.scope === 'feature_background' || group.id === scenario?.id ||
      (group.scope === 'rule_background' && scenario?.owner_key.startsWith(group.owner_key.replace(/:[^:]+:background$/, '') + ':'))).map(group => group.id);
    if (!ids.length) return [];
    return store.all(`SELECT * FROM steps WHERE group_id IN (${ids.map(() => '?').join(',')}) ORDER BY source_line`, ids);
  }

  async function validateEvidence(run: Row, result: Row, definition: Definition) {
    const rows = await store.all('SELECT * FROM step_results WHERE case_result_id=? ORDER BY action_index', [result.id]);
    if (!rows.length) return {complete: false, failed: false};
    let complete = true, failed = result.status === 'FAILED', assertions = 0;
    for (const [index, step] of rows.entries()) {
      if (step.action_index !== index + 1 || !step.browser_session_id || !step.browser_context_ref || !step.browser_page_id || !step.binding_seq) complete = false;
      const expected = JSON.parse(step.expected_json ?? 'null');
      if (expected?.assertion === true) { assertions++; if (expected.assertionPassed !== true) failed ||= step.status === 'FAILED'; }
      if (step.status === 'FAILED') failed = true;
      if (!['PASSED', 'FAILED'].includes(step.status)) complete = false;
      const shots = await store.all('SELECT * FROM screenshots WHERE step_result_id=?', [step.id]);
      if (!shots.length || (step.status === 'FAILED' && !shots.some(shot => shot.moment === 'failure'))) complete = false;
      for (const shot of shots) { try { if (hash(await readFile(resolve(artifactRoot, shot.artifact_ref))) !== shot.sha256) complete = false; } catch { complete = false; } }
    }
    if (!assertions) complete = false;
    if (run.execution_scope !== 'INDEPENDENT') {
      const required = await applicableSteps(snapshot(run).gherkinVersionId, definition.scenarioEntityId);
      if (!required.length || required.some(step => !rows.some(row => row.source_step_id === step.id))) complete = false;
    }
    return {complete, failed};
  }

  async function finalize(runId: string, processResult: {code: number; stdout: string; stderr: string} | null, executionError?: unknown) {
    await mutation(async () => {
      const run = await one('SELECT * FROM runs WHERE id=?', [runId]);
      if (run.status === 'INVALID') return;
      const data = snapshot(run), results = await store.all('SELECT * FROM case_results WHERE run_id=?', [runId]);
      const receipt = runnerCompletions.get(runId);
      let incomplete = !receipt || results.length !== data.definitions.length || !!executionError;
      let failed = false;
      const updates: SqlCommand[] = [];
      for (const definition of data.definitions) {
        const result = results.find(row => row.runtime_test_key === definition.testKey);
        if (!result || !started.has(runId + '\0' + definition.testKey)) { incomplete = true; continue; }
        const evidence = await validateEvidence(run, result, definition);
        const status = evidence.failed ? 'FAILED' : evidence.complete && result.status === 'PASSED' ? 'PASSED' : 'INCOMPLETE';
        failed ||= status === 'FAILED'; incomplete ||= status === 'INCOMPLETE';
        updates.push({sql: 'UPDATE case_results SET status=? WHERE id=?', params: [status, result.id]});
      }
      if (receipt?.errors?.length) incomplete = true;
      if (processResult && processResult.code !== 0 && !failed) incomplete = true;
      const status = failed ? 'FAILED' : incomplete ? 'INCOMPLETE' : 'PASSED';
      const environment = JSON.parse(run.environment_snapshot_json);
      environment.execution = {status, exitCode: processResult?.code ?? null, error: executionError ? redact(String(executionError),recordingSecretValues.get(runId)??[]) : null,
        stderr: redact(processResult?.stderr.slice(-16_000) ?? null,recordingSecretValues.get(runId)??[]), reporter: receipt ?? null, finishedAt: new Date().toISOString()};
      updates.push({sql: "UPDATE runs SET status=?,environment_snapshot_json=? WHERE id=? AND status!='INVALID'", params: [status, JSON.stringify(environment), runId]});
      if (run.requirement_id) {
        const verified = status === 'PASSED' && run.execution_scope === 'ALL_REQUIRED' && data.required.length > 0 && data.required.length === data.definitions.length;
        updates.push({sql: "UPDATE requirements SET stage=? WHERE id=? AND stage IN ('VERIFICATION','VERIFIED') AND EXISTS(SELECT 1 FROM baselines WHERE id=? AND valid=1)", params: [verified ? 'VERIFIED' : 'VERIFICATION', run.requirement_id, run.baseline_id]});
      }
      await store.batch(updates);
      await publish(run, {type: 'run.completed', payload: {status}});
    });
    const report = await reportRun(runId);
    const directory = join(artifactRoot, 'runs', runId);
    await mkdir(directory, {recursive: true});
    await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2));
  }
  function launch(runId: string, prepared: PreparedRun, executor?: string, recordingSecrets:Record<string,string>={}) {
    recordingSecretValues.set(runId,Object.values(recordingSecrets));
    const task = (async () => {
      try {
        const token = randomUUID();
        const result = executor === 'target_ci'
          ? options.executeCi ? await options.executeCi({runId, prepared, env: {WB_BASE_URL: options.baseUrl, WB_RUN_ID: runId, WB_RUN_EVENT_TOKEN: token}}) : (() => {throw new CoreError(503, 'CI_EXECUTOR_UNCONFIGURED', 'Target CI executor is not configured');})()
          : await runner.execute(runId, prepared, token,recordingSecrets);
        await finalize(runId, result);
      }
      catch (error) { await finalize(runId, null, error); }
      finally {
        const matching = [...contexts.entries()].filter(([key]) => key.startsWith(runId + '\0'));
        const sessions = new Set(matching.flatMap(([, context]) => [context.app.sessionId, ...(context.db ? [context.db.sessionId] : [])]));
        await Promise.allSettled([...sessions].map(id => browser.closeSession(id)));
        for (const [key] of matching) contexts.delete(key);
        recordingSecretValues.delete(runId);
      }
    })().catch(error => { console.error('Run finalization failed:', runId, String(error)); });
    completion.set(runId, task);
  }

  async function verify(requirementId: string, body: any) {
    const requirement = await one('SELECT * FROM requirements WHERE id=?', [requirementId], 'Requirement');
    const currentSpecs = await store.all("SELECT v.test_stage FROM document_heads h JOIN document_versions v ON v.id=h.version_id JOIN documents d ON d.id=h.document_id WHERE d.requirement_id=? AND d.purpose='target_ci'", [requirementId]);
    if (!currentSpecs.length || currentSpecs.some(spec => spec.test_stage !== 'COMPLETED')) fail(409, 'TESTS_PENDING_COMPLETION', 'Tests are pending completion');
    if (!['IMPLEMENTATION', 'VERIFICATION', 'VERIFIED'].includes(requirement.stage)) fail(409, 'WORKFLOW_GATE_NOT_MET', 'Verification requires a fixed completed test baseline');
    const baseline = await one("SELECT * FROM baselines WHERE id=? AND requirement_id=? AND kind='tests'", [body.testBaselineId ?? '', requirementId], 'Test baseline');
    if (!baseline.valid || hash(baseline.manifest_json) !== baseline.sha256 || (body.hash && body.hash !== baseline.sha256) || (body.testBaselineHash && body.testBaselineHash !== baseline.sha256)) fail(409, 'BASELINE_INVALID', 'Test baseline is invalid or its hash does not match');
    if (typeof body.sourceRef !== 'string' || !body.sourceRef.trim()) fail(422, 'SOURCE_REF_REQUIRED', 'Pin a source revision before verification');
    const sourceSnapshot = await options.resolveSource(requirement.project_id, body.sourceRef);
    if (!sourceSnapshot || !/^[0-9a-f]{40,64}$/.test(sourceSnapshot.resolvedCommit)) fail(422, 'INVALID_SOURCE_REF', 'Source must resolve to a real immutable Git commit');
    const sourceBaselines = await store.all("SELECT * FROM baselines WHERE requirement_id=? AND kind='source' AND valid=1 ORDER BY rowid DESC", [requirementId]);
    if (sourceBaselines.length && !sourceBaselines.some(row => { const value = JSON.parse(row.manifest_json); return hash(row.manifest_json) === row.sha256 && value.resolvedCommit === sourceSnapshot.resolvedCommit; })) fail(409, 'SOURCE_VERSION_MISMATCH', 'Requested source does not match the pinned source baseline');
    const versions = await store.all('SELECT v.*,d.kind,d.file_name FROM baseline_documents bd JOIN document_versions v ON v.id=bd.document_version_id JOIN documents d ON d.id=v.document_id WHERE bd.baseline_id=?', [baseline.id]);
    const gherkin = versions.find(version => version.kind === 'gherkin'), sd = versions.find(version => version.kind === 'sd'), specs = versions.filter(version => version.kind === 'spec');
    if (!gherkin || !sd || !specs.length || specs.some(spec => spec.test_stage !== 'COMPLETED')) fail(409, 'BASELINE_INVALID', 'Baseline must fix Gherkin, SD and completed tests');
    for (const version of versions) if (hash(version.raw_text) !== version.raw_sha256) fail(409, 'DOCUMENT_HASH_MISMATCH', 'Baseline document hash mismatch');
    const confirmations = await store.all('SELECT * FROM confirmations WHERE requirement_id=?', [requirementId]);
    if (![gherkin, sd].every(version => confirmations.some(confirmation => confirmation.version_id === version.id && confirmation.raw_sha256 === version.raw_sha256))) fail(409, 'CONFIRMATION_INVALID', 'Baseline must match the current confirmed document versions and hashes');
    if (sd.source_gherkin_version_id !== gherkin.id || specs.some(spec => spec.source_gherkin_version_id !== gherkin.id)) fail(409, 'SOURCE_VERSION_MISMATCH', 'Baseline source Gherkin mismatch');
    const sourceCases = await store.all('SELECT c.*,s.scenario_key FROM source_cases c JOIN scenarios s ON s.id=c.scenario_id WHERE c.gherkin_version_id=? ORDER BY c.scenario_id,c.row_ordinal', [gherkin.id]);
    const rawDefinitions = await store.all('SELECT t.*,c.id AS source_case_id,c.scenario_id,c.case_key,s.scenario_key FROM baseline_documents bd JOIN test_definitions t ON t.spec_version_id=bd.document_version_id LEFT JOIN test_case_mappings m ON m.test_definition_id=t.id LEFT JOIN source_cases c ON c.id=m.source_case_id LEFT JOIN scenarios s ON s.id=c.scenario_id WHERE bd.baseline_id=? ORDER BY t.test_key', [baseline.id]);
    if (!rawDefinitions.length || rawDefinitions.some(test => !test.source_case_id || !sourceCases.some(row => row.id === test.source_case_id))) fail(422, 'MAPPING_INVALID', 'Baseline has missing or different-version mappings');
    if (sourceCases.some(row => !rawDefinitions.some(test => test.source_case_id === row.id))) fail(422, 'MAPPING_INVALID', 'Baseline does not cover every source case');
    const mode = body.selection?.mode;
    if (!['SELECTED_CASES', 'ALL_REQUIRED'].includes(mode)) fail(422, 'SELECTION_INVALID', 'Choose SELECTED_CASES or ALL_REQUIRED explicitly');
    const selectedCases: string[] = mode === 'ALL_REQUIRED' ? sourceCases.map(row => row.id) : body.selection.sourceCaseIds;
    if (!Array.isArray(selectedCases) || !selectedCases.length || new Set(selectedCases).size !== selectedCases.length || selectedCases.some(id => !sourceCases.some(row => row.id === id))) fail(422, 'SELECTION_INVALID', 'Selected cases must be unique cases from this baseline');
    const selectedRows = rawDefinitions.filter(test => selectedCases.includes(test.source_case_id));
    if (!selectedRows.length) fail(422, 'MAPPING_INVALID', 'Selected cases have no tests');
    if (selectedRows.some(test => rawDefinitions.some(other => other.id === test.id && !selectedCases.includes(other.source_case_id)))) fail(422, 'MAPPING_AMBIGUOUS', 'One test covers both selected and unselected cases; split its mapping before execution');
    const toDefinition = (test: Row): Definition => ({id: test.id, testKey: test.test_key, sourceCaseId: test.source_case_id, scenarioId: test.scenario_key, scenarioEntityId: test.scenario_id, caseId: test.case_key, specVersionId: test.spec_version_id});
    const unique = (rows: Row[]) => [...new Map(rows.map(row => [row.id, toDefinition(row)])).values()];
    const required = unique(rawDefinitions), selected = unique(selectedRows);
    if (new Set(required.map(test => test.testKey)).size !== required.length) fail(422, 'MAPPING_AMBIGUOUS', 'Stable test keys must be unique across the baseline');
    const runId = randomUUID(), prepared = await runner.prepare(runId, specs as any, selected.map(test => test.testKey));
    // Every definition must still resolve, including the unselected tests. Filtering only changes execution.
    if (JSON.stringify(prepared.tests.map(test => test.testKey).sort()) !== JSON.stringify(required.map(test => test.testKey).sort())) fail(422, 'DISCOVERY_BASELINE_MISMATCH', 'Runner discovery differs from the fixed baseline test collection');
    const definition: Snapshot = {gherkinVersionId: gherkin.id, versions: versions.map(version => version.id), definitions: selected, required,
      sourceCases, materializations: prepared.materializations, discovery: prepared.selected, createdAt: new Date().toISOString()};
    const connection = (await store.all('SELECT * FROM target_connections WHERE project_id=? ORDER BY rowid LIMIT 1', [requirement.project_id]))[0];
    await mutation(async () => {
      const commands: SqlCommand[] = [{sql: 'SELECT id FROM requirements WHERE id=? AND stage=?', params: [requirementId, requirement.stage], mode: 'all', expectRows: 1},
        {sql: 'SELECT id FROM baselines WHERE id=? AND valid=1 AND sha256=?', params: [baseline.id, baseline.sha256], mode: 'all', expectRows: 1},
        insert('runs', {id: runId, project_id: requirement.project_id, requirement_id: requirementId, origin: 'target_ci', execution_scope: mode, baseline_id: baseline.id, connection_id: connection?.id ?? null,
          source_ref: sourceSnapshot.resolvedCommit, definition_snapshot_json: JSON.stringify(definition), environment_snapshot_json: JSON.stringify({runner: 'Playwright', version: '1.64.1', baseUrl: options.baseUrl, targetUrl: connection?.app_base_url ?? null, sourceRef: body.sourceRef, sourceSnapshot, testBaselineHash: baseline.sha256, checks: {parser: 'PASSED', mapping: 'PASSED', discovery: 'PASSED', typecheck: 'NOT_RUN', execution: 'NOT_RUN'}}), status: 'RUNNING'})];
      for (const id of selectedCases) commands.push(insert('run_source_cases', {run_id: runId, source_case_id: id}));
      for (const test of selected) commands.push(insert('run_test_selection', {run_id: runId, test_definition_id: test.id}));
      commands.push({sql: 'UPDATE requirements SET stage=? WHERE id=?', params: ['VERIFICATION', requirementId]});
      await store.batch(commands);
    });
    launch(runId, prepared, body.executor);
    return {runId, scope: mode, expectedTestKeys: selected.map(test => test.testKey), expectedTestDefinitionIds: selected.map(test => test.id)};
  }

  async function executionContext(runId: string, testKey: string) {
    const run = await one('SELECT * FROM runs WHERE id=?', [runId], 'Run');
    if (run.status !== 'RUNNING') fail(409, 'RUN_NOT_ACTIVE', 'Run is not active');
    const data = snapshot(run), test = data.definitions.find(definition => definition.testKey === testKey);
    if (!test) fail(403, 'TEST_NOT_SELECTED', 'Test is not in this run selection');
    const key = runId + '\0' + testKey;
    if (!contexts.has(key)) {
      const project = await one('SELECT * FROM projects WHERE id=?', [run.project_id]);
      const connection = run.connection_id ? await one('SELECT * FROM target_connections WHERE id=? AND project_id=?', [run.connection_id, run.project_id]) : null;
      if (!connection && run.execution_scope !== 'INDEPENDENT') fail(409, 'TARGET_CONNECTION_REQUIRED', 'Configure the real target application database connection');
      const environment = JSON.parse(run.environment_snapshot_json);
      const app = await browser.create({projectId: run.project_id, workspaceRef: project.workspace_ref, targetUrl: environment.targetUrl ?? connection?.app_base_url ?? undefined});
      let db: BrowserAttachment | undefined;
      try {if (connection) db = await browser.create({projectId: run.project_id, workspaceRef: project.workspace_ref, targetUrl: new URL('/projects/' + run.project_id + '/db/' + connection.id, options.baseUrl).href});}
      catch (error) { await browser.closeSession(app.sessionId); throw error; }
      let sourceSteps: Record<string, string>;
      if (run.execution_scope === 'INDEPENDENT') sourceSteps = {'4': 'recording:4', '5': 'recording:5', '6': 'recording:6'};
      else {
        const rows = await applicableSteps(data.gherkinVersionId, test.scenarioEntityId);
        sourceSteps = Object.fromEntries(rows.map(step => [String(step.source_line), step.id]));
      }
      contexts.set(key, {app, db, sourceSteps});
    }
    const managed = contexts.get(key)!;
    return {runId, testDefinitionId: test.id, sourceCaseId: test.sourceCaseId, testKey,
      sourceSteps: managed.sourceSteps, app: managed.app, db: managed.db, dbUiUrl: run.connection_id ? new URL('/projects/' + run.project_id + '/db/' + run.connection_id, options.baseUrl).href : null};
  }

  async function binding(runId: string) {
    const run = await one('SELECT id,status FROM runs WHERE id=?', [runId], 'Run');
    if (run.status !== 'RUNNING') return {runId, bound: false, ended: true};
    const row = (await store.all('SELECT b.*,c.test_definition_id,c.runtime_test_key FROM run_browser_bindings b JOIN case_results c ON c.id=b.case_result_id WHERE b.run_id=?', [runId]))[0];
    if (!row) return {runId, bound: false};
    const data = await definitions(runId), test = data.definitions.find(definition => definition.testKey === row.runtime_test_key);
    return {runId, bound: true, testKey: row.runtime_test_key, testDefinitionId: row.test_definition_id ?? test?.id, caseResultId: row.case_result_id,
      sessionId: row.session_id, contextRef: row.context_ref, pageId: row.page_id, bindingSeq: row.binding_seq};
  }

  async function ingest(runId: string, event: any) {
    return mutation(async () => {
      const run = await one('SELECT * FROM runs WHERE id=?', [runId], 'Run');
      if (event.runId !== runId || run.status !== 'RUNNING') fail(409, 'RUN_EVENT_INVALID', 'Event does not belong to an active run');
      if (!event.eventId || typeof event.eventId !== 'string' || eventIds.has(event.eventId)) fail(409, 'EVENT_DUPLICATED', 'Event ID must be unique');
      const data = snapshot(run),secrets=recordingSecretValues.get(runId)??[];
      const original=event.payload??{},payload=secrets.length?{...redact(Object.fromEntries(Object.entries(original).filter(([key])=>key!=='screenshot')),secrets),...(original.screenshot?{screenshot:original.screenshot}:{})}:original;
      event={...event,payload};
      if (event.type === 'run.completed') {
        runnerCompletions.set(runId, payload); eventIds.add(event.eventId); return {accepted: true};
      }
      const test = data.definitions.find(definition => definition.testKey === event.testKey);
      if (!test || (event.testDefinitionId && event.testDefinitionId !== test.id) || (event.sourceCaseId && event.sourceCaseId !== test.sourceCaseId)) fail(403, 'TEST_NOT_SELECTED', 'Event identity does not match the fixed run selection');
      let result = (await store.all('SELECT * FROM case_results WHERE run_id=? AND runtime_test_key=?', [runId, test.testKey]))[0];
      if (!result) {
        const id = randomUUID();
        await store.batch([insert('case_results', {id, run_id: runId, test_definition_id: run.execution_scope === 'INDEPENDENT' ? null : test.id, runtime_test_key: test.testKey, status: 'NOT_RUN'})]);
        result = await one('SELECT * FROM case_results WHERE id=?', [id]);
      }
      if (event.type === 'run.testStarted') {
        if (started.has(runId + '\0' + test.testKey)) fail(409, 'TEST_DUPLICATED', 'Test started more than once');
        const previous = (await store.all('SELECT binding_seq FROM run_browser_bindings WHERE run_id=?', [runId]))[0];
        bindingSequences.set(runId, Math.max(bindingSequences.get(runId) ?? 0, previous?.binding_seq ?? 0));
        await store.batch([{sql: 'DELETE FROM run_browser_bindings WHERE run_id=? AND case_result_id<>?', params: [runId, result.id]}, {sql: 'UPDATE case_results SET status=? WHERE id=?', params: ['RUNNING', result.id]}]);
        started.add(runId + '\0' + test.testKey);
      } else if (event.type === 'run.testFinished') {
        if (!started.has(runId + '\0' + test.testKey)) fail(409, 'TEST_NOT_STARTED', 'Test finished without an actual start event');
        const unsupported = (payload.errors ?? []).some((error: unknown) => String(error).includes('UNSUPPORTED_MANAGED_PAGE'));
        const status = unsupported ? 'INCOMPLETE' : payload.runnerStatus === 'passed' && payload.expectedStatus === 'passed' ? 'PASSED' : payload.runnerStatus === 'failed' || payload.runnerStatus === 'timedOut' ? 'FAILED' : 'INCOMPLETE';
        const environment = JSON.parse(run.environment_snapshot_json);
        environment.tests ??= {};
        environment.tests[test.testKey] = {status, runnerStatus: payload.runnerStatus, errors: payload.errors ?? [], code: unsupported ? 'UNSUPPORTED_MANAGED_PAGE' : null};
        await store.batch([{sql: 'UPDATE case_results SET status=? WHERE id=?', params: [status, result.id]}, {sql: 'UPDATE runs SET environment_snapshot_json=? WHERE id=?', params: [JSON.stringify(environment), runId]}]);
      } else if (event.type === 'run.browserBound') {
        const managed = contexts.get(runId + '\0' + test.testKey);
        const identity = managed && [managed.app, managed.db].find(attachment => !!attachment && attachment.sessionId === event.sessionId && attachment.contextRef === event.contextRef && attachment.pageId === event.pageId);
        if (!identity) fail(403, 'BROWSER_BINDING_INVALID', 'Page is not a managed page belonging to this test');
        const previous = (await store.all('SELECT binding_seq FROM run_browser_bindings WHERE run_id=?', [runId]))[0];
        const seq = Math.max(previous?.binding_seq ?? 0, bindingSequences.get(runId) ?? 0) + 1;
        await store.run('INSERT INTO run_browser_bindings(run_id,case_result_id,session_id,context_ref,page_id,binding_seq) VALUES(?,?,?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET case_result_id=excluded.case_result_id,session_id=excluded.session_id,context_ref=excluded.context_ref,page_id=excluded.page_id,binding_seq=excluded.binding_seq', [runId, result.id, event.sessionId, event.contextRef, event.pageId, seq]);
        bindingSequences.set(runId, seq);
        eventIds.add(event.eventId);
        await publish(run, {...event, caseResultId: result.id, testDefinitionId: test.id, bindingSeq: seq});
        return {accepted: true, bindingSeq: seq};
      } else if (event.type === 'run.stepFinished') {
        const current = (await store.all('SELECT * FROM run_browser_bindings WHERE run_id=?', [runId]))[0];
        if (!current || current.case_result_id !== result.id || current.session_id !== event.sessionId || current.context_ref !== event.contextRef || current.page_id !== event.pageId || current.binding_seq !== event.bindingSeq) fail(409, 'BROWSER_BINDING_STALE', 'Step evidence does not match the currently bound page');
        const managed = contexts.get(runId + '\0' + test.testKey)!;
        const sourceStepId = payload.sourceStepId;
        if (!sourceStepId || (run.execution_scope === 'INDEPENDENT' ? !/^recording:[1-9]\d*$/.test(sourceStepId) : !Object.values(managed.sourceSteps).includes(sourceStepId))) fail(422, 'SOURCE_STEP_INVALID', 'Step is outside this source scenario');
        const count = (await store.all('SELECT COUNT(*) AS n FROM step_results WHERE case_result_id=?', [result.id]))[0].n;
        if (!Number.isInteger(payload.actionIndex) || payload.actionIndex !== count + 1) fail(422, 'ACTION_SEQUENCE_INVALID', 'Action indexes must be contiguous and unique');
        if (!['PASSED', 'FAILED', 'INCOMPLETE'].includes(payload.status) || typeof payload.assertion !== 'boolean') fail(422, 'STEP_STATUS_INVALID', 'Invalid step result status');
        if (payload.assertion && (typeof payload.assertionPassed !== 'boolean' || (payload.status === 'PASSED' && payload.assertionPassed !== true))) fail(422, 'ASSERTION_INVALID', 'Passing assertion must include its actual pass result');
        const stepId = randomUUID(), commands: SqlCommand[] = [insert('step_results', {id: stepId, case_result_id: result.id,
          source_step_id: run.execution_scope === 'INDEPENDENT' ? null : sourceStepId, browser_session_id: event.sessionId, browser_context_ref: event.contextRef, browser_page_id: event.pageId, binding_seq: event.bindingSeq,
          action_index: payload.actionIndex, expected_json: asJson({value: payload.expected ?? null, assertion: payload.assertion, assertionPassed: payload.assertionPassed ?? null, label: payload.label ?? ''}), actual_json: asJson({value: payload.actual ?? null}), status: payload.status, error_text: payload.error ?? null})];
        if (payload.screenshot) {
          const shot = payload.screenshot;
          if (shot.contentType !== 'image/png' || typeof shot.base64 !== 'string' || !['precondition', 'after_action', 'after_assertion', 'failure'].includes(shot.moment)) fail(422, 'SCREENSHOT_INVALID', 'Screenshot must be an actual PNG with a valid evidence moment');
          const bytes = Buffer.from(shot.base64, 'base64');
          if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || hash(bytes) !== shot.sha256) fail(422, 'SCREENSHOT_HASH_MISMATCH', 'Screenshot bytes/hash mismatch');
          const id = randomUUID(), artifactRef = join('runs', runId, 'screenshots', id + '.png');
          await mkdir(join(artifactRoot, 'runs', runId, 'screenshots'), {recursive: true});
          await writeFile(join(artifactRoot, artifactRef), bytes, {flag: 'wx'});
          commands.push(insert('screenshots', {id, step_result_id: stepId, moment: shot.moment, artifact_ref: artifactRef, sha256: shot.sha256}));
        }
        await store.batch(commands);
      } else fail(422, 'RUN_EVENT_UNSUPPORTED', 'Unsupported runner event type');
      eventIds.add(event.eventId);
      const publicPayload = {...payload};
      if (publicPayload.screenshot) {const {base64: _image, ...metadata} = publicPayload.screenshot; publicPayload.screenshot = metadata;}
      await publish(run, {...event, payload: publicPayload, testDefinitionId: test.id, caseResultId: result.id});
      return {accepted: true};
    });
  }

  async function reportRun(runId: string) {
    const run = await one('SELECT * FROM runs WHERE id=?', [runId], 'Run'), data = snapshot(run);
    const results = await store.all('SELECT * FROM case_results WHERE run_id=? ORDER BY rowid', [runId]);
    const environment = JSON.parse(run.environment_snapshot_json);
    const cases: any[] = [];
    for (const result of results) {
      const definition = data.definitions.find(test => test.testKey === result.runtime_test_key);
      const rows = await store.all('SELECT * FROM step_results WHERE case_result_id=? ORDER BY action_index', [result.id]);
      const steps: any[] = [];
      for (const step of rows) {
        const expected = JSON.parse(step.expected_json ?? 'null'), actual = JSON.parse(step.actual_json ?? 'null');
        const shots = await store.all('SELECT id,sha256,moment FROM screenshots WHERE step_result_id=? ORDER BY rowid', [step.id]);
        steps.push({runId, testDefinitionId: definition?.id ?? result.test_definition_id, sourceCaseId: definition?.sourceCaseId ?? null, sourceStepId: step.source_step_id, actionIndex: step.action_index, status: step.status,
          assertion: expected?.assertion === true, assertionPassed: expected?.assertionPassed ?? null, expected: expected?.value ?? null, actual: actual?.value ?? null, error: step.error_text,
          sessionId: step.browser_session_id, contextRef: step.browser_context_ref, pageId: step.browser_page_id, bindingSeq: step.binding_seq, screenshots: shots});
      }
      cases.push({runId, caseResultId: result.id, testKey: result.runtime_test_key, testDefinitionId: definition?.id ?? result.test_definition_id,
        scenarioId: definition?.scenarioId ?? null, caseId: definition?.caseId ?? null, sourceCaseId: definition?.sourceCaseId ?? null,
        executed: started.has(runId + '\0' + result.runtime_test_key) || terminalStatus.has(result.status), status: run.status === 'INVALID' ? 'INVALID' : result.status,
        errors: environment.tests?.[result.runtime_test_key]?.errors ?? [], code: environment.tests?.[result.runtime_test_key]?.code ?? null, steps});
    }
    const selectedCases = await store.all('SELECT source_case_id FROM run_source_cases WHERE run_id=?', [runId]);
    const sourceCases = data.sourceCases.map(source => {
      const selected = selectedCases.some(row => row.source_case_id === source.id), required = data.required.filter(test => test.sourceCaseId === source.id);
      const found = required.map(test => cases.find(result => result.testKey === test.testKey));
      let status = 'NOT_RUN';
      if (selected) status = run.status === 'INVALID' ? 'INVALID' : found.some(result => result?.status === 'FAILED') ? 'FAILED' : found.length && found.every(result => result?.status === 'PASSED') ? 'PASSED' : run.status === 'RUNNING' ? 'RUNNING' : 'INCOMPLETE';
      return {sourceCaseId: source.id, scenarioId: source.scenario_key, caseId: source.case_key, selected, status};
    });
    const executedTestKeys = cases.filter(result => result.executed).map(result => result.testKey), requiredKeys = data.required.map(test => test.testKey);
    return {runId, status: run.status, origin: run.origin, scope: run.execution_scope, sourceRef: run.source_ref, gherkinVersionId: data.gherkinVersionId,
      testBaselineId: run.baseline_id, scriptVersionId: run.script_version_id, candidateCommit: run.candidate_commit, testedCommit: run.tested_commit,
      coverageComplete: run.execution_scope === 'ALL_REQUIRED' && run.status === 'PASSED' && requiredKeys.length > 0 && requiredKeys.every(key => cases.some(result => result.testKey === key && result.executed && result.status === 'PASSED')),
      requiredTestCount: requiredKeys.length, executedTestKeys, unexecutedTestKeys: requiredKeys.filter(key => !executedTestKeys.includes(key)), sourceCases, cases,
      definitionSnapshot: data, environment};
  }

  async function replay(documentId: string, versionId: string, body: any = {}) {
    const version = await one("SELECT v.*,d.project_id,d.requirement_id,d.purpose,d.file_name FROM document_versions v JOIN documents d ON d.id=v.document_id WHERE v.id=? AND v.document_id=? AND d.kind='spec'", [versionId, documentId], 'Script version');
    if (!['recording', 'integration'].includes(version.purpose)) fail(409, 'SCRIPT_PURPOSE_INVALID', 'Use verify for standard target CI tests');
    if (body.projectId && body.projectId !== version.project_id) fail(422, 'PROJECT_MISMATCH', 'Script belongs to a different project');
    const savedConfig = JSON.parse(version.execution_config_json ?? '{}');
    const actions=(await store.all('SELECT payload_json FROM recording_actions WHERE spec_version_id=? ORDER BY ordinal',[versionId])).map(row=>JSON.parse(row.payload_json));
    const requiredAliases=requiredRecordingSecretAliases(version.raw_text,actions);
    const recordingSecrets=await resolveRecordingSecrets({projectId:version.project_id,requiredAliases,bindings:savedConfig.secretBindings,resolve:options.resolveRecordingSecret});
    const runId = randomUUID(), prepared = await runner.prepare(runId, [version as any], undefined, true);
    const runtimeDefinitions: Definition[] = prepared.selected.map(test => ({id: randomUUID(), testKey: test.testKey, sourceCaseId: 'script:' + versionId, scenarioId: null, scenarioEntityId: null, caseId: null, specVersionId: versionId}));
    const data: Snapshot = {gherkinVersionId: version.source_gherkin_version_id, versions: [version.id], definitions: runtimeDefinitions, required: runtimeDefinitions, sourceCases: [], materializations: prepared.materializations, discovery: prepared.selected, createdAt: new Date().toISOString()};
    function target(value: unknown): string | null {
      if (value === undefined || value === null || value === '') return null;
      try {if (typeof value !== 'string') throw Error(); const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error(); return url.href;}
      catch {fail(422, 'TARGET_URL_INVALID', 'Replay target must be a valid HTTP(S) URL without embedded credentials');}
    }
    const targetUrl = target(body.targetUrl || savedConfig.targetUrl);
    const connectionId = body.connectionId ?? savedConfig.connectionId;
    const connections = await store.all('SELECT * FROM target_connections WHERE project_id=? ORDER BY rowid', [version.project_id]);
    let connection: Row | undefined;
    if (connectionId) {
      connection = connections.find(row => row.id === connectionId);
      if (!connection) fail(422, 'PROJECT_MISMATCH', 'Replay connection does not belong to this script project');
      if (targetUrl && targetUrl !== target(connection.app_base_url)) fail(422, 'TARGET_CONNECTION_MISMATCH', 'Replay target URL differs from the selected connection');
    } else if (targetUrl && connections.length) {
      const matching = connections.filter(row => target(row.app_base_url) === targetUrl);
      if (matching.length !== 1) fail(422, 'TARGET_CONNECTION_MISMATCH', 'Replay target URL must match exactly one project connection');
      connection = matching[0];
    } else if (connections.length === 1) connection = connections[0];
    else if (connections.length > 1) fail(422, 'TARGET_CONNECTION_REQUIRED', 'Select the replay target explicitly when this project has multiple connections');
    await store.batch([insert('runs', {id: runId, project_id: version.project_id, requirement_id: null, origin: version.purpose, execution_scope: 'INDEPENDENT', script_version_id: versionId, connection_id: connection?.id ?? null,
      definition_snapshot_json: JSON.stringify(data), environment_snapshot_json: JSON.stringify({runner: 'Playwright', targetUrl: targetUrl ?? connection?.app_base_url ?? null, scriptSha256: version.raw_sha256, checks: {parser: 'PASSED', discovery: 'PASSED', execution: 'NOT_RUN'}}), status: 'RUNNING'})]);
    launch(runId, prepared,undefined,recordingSecrets);
    return {runId, scope: 'INDEPENDENT', scriptVersionId: versionId, expectedTestKeys: runtimeDefinitions.map(test => test.testKey)};
  }

  return {verify, report: reportRun, binding, executionContext, ingest, replay,
    async wait(runId: string) {await completion.get(runId); return reportRun(runId);},
    async close() {
    await runner.close();
    await Promise.all([...completion.values()]);
    await writes;
    const sessions = new Set([...contexts.values()].flatMap(value => [value.app.sessionId, ...(value.db ? [value.db.sessionId] : [])]));
    await Promise.allSettled([...sessions].map(id => browser.closeSession(id)));
    contexts.clear();
  }};
}
