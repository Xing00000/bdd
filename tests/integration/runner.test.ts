import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import {execFileSync} from 'node:child_process';
import { createCore } from '../../src/application/core.ts';
import { createRuns } from '../../src/application/runs.ts';
import { createPlaywrightRunner, discoveredTests, exactSelection } from '../../src/adapters/runner/playwright.ts';
import type {BrowserRuntimePort} from '../../src/ports/runtime.ts';
import type {TestRunnerPort} from '../../src/ports/runner.ts';
import {createCompletionValidator} from '../../src/adapters/generation/validation.ts';
import {specText} from '../../spec/REQ-WB-001/workbench/testing/fixtures/content.ts';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const root = resolve(process.cwd());
const feature = 'Feature: selection\n  @AC-SELECT-001\n  Scenario Outline: values\n    Given value "<value>"\n    Then value is checked\n    Examples:\n      | case_id | value |\n      | a | 1 |\n      | b | 2 |\n';
const mappings = [{testKey: 'test-a', scenarioId: 'AC-SELECT-001', caseId: 'a'}, {testKey: 'test-a-extra', scenarioId: 'AC-SELECT-001', caseId: 'a'}, {testKey: 'test-b', scenarioId: 'AC-SELECT-001', caseId: 'b'}];
const raw = (skeleton = false) => "import {test,expect} from '@playwright/test';\n" + mappings.map(m => `test('${m.testKey}',{annotation:{type:'workbenchTestId',description:'${m.testKey}'}},async()=>{${skeleton ? "throw Error('UnimplementedStepError');" : 'expect(1+1).toBe(2);'}});`).join('\n');
const noBrowser: BrowserRuntimePort = {
  async create() {throw Error('Unit test intentionally has no browser');}, attachment() {throw Error('No browser');}, async input() {throw Error('No browser');}, subscribe() {return () => {};}, async startRecording() {throw Error('No browser');}, async stopRecording() {throw Error('No browser');}, async addAssertion() {throw Error('No browser');}, async closeSession() {}, async close() {},
};
async function setup(t: {after: (body: () => Promise<void>) => void}) {
  const dir = await mkdtemp(join(tmpdir(), 'workbench-runner-')), core = await createCore(join(dir, 'metadata.sqlite'));
  await writeFile(join(dir, 'app.ts'), 'export const version = 1;\n');
  execFileSync('git', ['init', '-b', 'main', dir], {stdio: 'pipe'});
  execFileSync('git', ['-C', dir, 'add', '--', 'app.ts'], {stdio: 'pipe'});
  execFileSync('git', ['-C', dir, '-c', 'user.name=Runner Fixture', '-c', 'user.email=runner@localhost', 'commit', '-m', 'Fixture source baseline'], {stdio: 'pipe'});
  const sourceRef = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
  async function resolveSource(_projectId: string, ref: string) {
    const resolvedCommit = execFileSync('git', ['-C', dir, 'rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
    return {sourceRef: ref, resolvedCommit, repositoryRef: dir};
  }
  const project = await core.createProject({name: 'runner product unit', workspaceRef: dir}), req = await core.createRequirement(project.id, {requirementKey: 'REQ-RUN-001'});
  const g = await core.saveVersion(req.documents.gherkin.id, {rawText: feature}); await core.confirm(req.id, 'gherkin', {versionId: g.versionId!, rawSha256: g.rawSha256!});
  const sd = await core.saveVersion(req.documents.sd.id, {rawText: '# SD\nDDL/DML\n', sourceGherkinVersionId: g.versionId}); await core.confirm(req.id, 'sd', {versionId: sd.versionId!, rawSha256: sd.rawSha256!});
  const sk = await core.saveVersion(req.documents.spec.id, {rawText: raw(true), sourceGherkinVersionId: g.versionId, testStage: 'SKELETON', manifest: {specSha256: sha(raw(true)), gherkinSha256: g.rawSha256, sdSha256: sd.rawSha256, mappings}});
  t.after(async () => {await core.close(); await rm(dir, {recursive: true, force: true});});
  return {dir, core, req, g, sd, sk, sourceRef, resolveSource, async completed() {
    await core.saveVersion(req.documents.spec.id, {rawText: raw(), sourceGherkinVersionId: g.versionId, sourceSkeletonVersionId: sk.versionId, testStage: 'COMPLETED', manifest: {specSha256: sha(raw()), sourceSkeletonSha256: sk.rawSha256, gherkinSha256: g.rawSha256, sdSha256: sd.rawSha256, mappings}});
    return core.startDevelopment(req.id);
  }};
}

test('runner selection resolves full nested titles and rejects duplicate stable IDs', () => {
  const tests = discoveredTests({suites: [{title: 'sample.spec.ts', specs: [], suites: [{title: 'suite', specs: [{title: 'case', file: 'sample.spec.ts', tests: [{projectName: 'workbench', expectedStatus: 'passed', annotations: [{type: 'workbenchTestId', description: 'stable'}]}]}]}]}]});
  assert.equal(tests[0].qualified, '[workbench] › sample.spec.ts › suite › case');
  assert.equal(exactSelection(tests, ['stable']).length, 1);
  assert.throws(() => exactSelection([...tests, ...tests], ['stable']), /resolves to 2/);
  assert.throws(() => exactSelection(tests, []), /empty/);
});

test('approved managed fixture spec typechecks and discovers through one repository Playwright registry', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'workbench-approved-fixture-check-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const rawText = specText('http://127.0.0.1:1', true);
  const validator = createCompletionValidator({root, artifactRoot: dir});
  const receipt = await validator.validateCompletion({rawText, manifest: {specPath: 'demo.spec.ts', mappings: ['test-a', 'test-b', 'test-a-extra'].map(testKey => ({testKey}))}});
  assert.equal(receipt.checks.typecheck, true, JSON.stringify(receipt.diagnostics));
  assert.equal(receipt.checks.discovery, true, JSON.stringify(receipt.diagnostics));
  assert.deepEqual(receipt.discoveredTestKeys.sort(), ['test-a', 'test-a-extra', 'test-b']);
  assert.equal(receipt.productE2E, 'NOT_RUN');
});

test('real Playwright discovery keeps bundle imports and selects both a tests without b', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'workbench-discovery-')), runner = createPlaywrightRunner({root, artifactRoot: dir, baseUrl: 'http://127.0.0.1:1'});
  t.after(async () => {await runner.close(); await rm(dir, {recursive: true, force: true});});
  const source = "import {test,expect} from '../support/fixture.ts';\n" + raw().split('\n').slice(1).join('\n');
  const prepared = await runner.prepare(randomUUID(), [{id: 'version', document_id: 'document', raw_text: source, raw_sha256: sha(source), test_manifest_json: JSON.stringify({specPath: 'generated/selected.spec.ts', bundleFiles: [{path: 'generated/selected.spec.ts', rawText: source}, {path: 'support/fixture.ts', rawText: "export {test,expect} from '@playwright/test';\n"}]})}], ['test-a', 'test-a-extra']);
  assert.deepEqual(prepared.tests.map(item => item.testKey).sort(), ['test-a', 'test-a-extra', 'test-b']);
  assert.deepEqual(prepared.selected.map(item => item.testKey).sort(), ['test-a', 'test-a-extra']);
  const list = await readFile(prepared.selection, 'utf8'); assert.match(list, /test-a-extra/); assert.doesNotMatch(list, /test-b/);
  assert.equal(prepared.materializations.length, 2);
  await writeFile(prepared.materializations[0].file, 'changed');
  await assert.rejects(runner.execute('unused', prepared, 'token'), /changed before execution/);
});

test('application rejects skeleton verification before creating any run', async t => {
  const env = await setup(t), runner = createPlaywrightRunner({root, artifactRoot: env.dir, baseUrl: 'http://127.0.0.1:1'});
  const runs = createRuns({store: env.core.store, browser: noBrowser, runner, root, artifactRoot: env.dir, baseUrl: 'http://127.0.0.1:1', resolveSource: env.resolveSource, emit() {}});
  t.after(() => runs.close());
  await assert.rejects(runs.verify(env.req.id, {testBaselineId: null, sourceRef: 'commit', selection: {mode: 'SELECTED_CASES', sourceCaseIds: ['a']}}), (error: any) => error.code === 'TESTS_PENDING_COMPLETION');
  assert.equal((await env.core.store.all('SELECT * FROM runs')).length, 0);
});

test('verification rejects an unknown Git revision before creating a run', async t => {
  const env = await setup(t), ready = await env.completed(), runner = createPlaywrightRunner({root, artifactRoot: env.dir, baseUrl: 'http://127.0.0.1:1'});
  const runs = createRuns({store: env.core.store, browser: noBrowser, runner, root, artifactRoot: env.dir, baseUrl: 'http://127.0.0.1:1', resolveSource: env.resolveSource, emit() {}});
  t.after(() => runs.close());
  await assert.rejects(runs.verify(env.req.id, {testBaselineId: ready.baseline!.id, sourceRef: 'nonexistent-source-revision', selection: {mode: 'ALL_REQUIRED', sourceCaseIds: []}}));
  assert.equal((await env.core.store.all('SELECT * FROM runs')).length, 0);
});

test('independent replay discovers managed fixture from an immutable saved raw script', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'workbench-replay-discovery-')), runner = createPlaywrightRunner({root, artifactRoot: dir, baseUrl: 'http://127.0.0.1:1'});
  t.after(async () => {await runner.close(); await rm(dir, {recursive: true, force: true});});
  const source = "import {test,expect} from '@playwright/test';\ntest('錄製腳本',async({page})=>{await page.goto('http://127.0.0.1:1');await expect(page.getByTestId('visible')).toBeVisible();});\n";
  const prepared = await runner.prepare(randomUUID(), [{id: 'recording-v1', document_id: 'recording', raw_text: source, raw_sha256: sha(source)}], undefined, true);
  assert.equal(prepared.tests[0].testKey, '錄製腳本');
  assert.equal(prepared.materializations[0].rawSha256, sha(source));
  assert.equal(prepared.materializations[0].transformation, 'managed-page-fixture-import');
  assert.notEqual(prepared.materializations[0].materializedSha256, sha(source));
  assert.match(await readFile(prepared.materializations[0].file, 'utf8'), /replay-fixture/);
});

test('real independent runner reporter publishes the same unannotated stable title discovered by the CLI', async t => {
  const events: any[] = [], server = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    events.push(JSON.parse(Buffer.concat(chunks).toString())); response.writeHead(200, {'content-type': 'application/json'}); response.end('{"accepted":true}');
  });
  await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const baseUrl = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
  const dir = await mkdtemp(join(tmpdir(), 'workbench-replay-reporter-')), runner = createPlaywrightRunner({root, artifactRoot: dir, baseUrl});
  t.after(async () => {await runner.close(); await new Promise<void>(resolveClose => server.close(() => resolveClose())); await rm(dir, {recursive: true, force: true});});
  const source = "import {test,expect} from '@playwright/test';\ntest('錄製腳本',async({},info)=>{console.log('TITLE_PATH='+JSON.stringify(info.titlePath));expect(2+2).toBe(4);});\n";
  const runId = randomUUID(), prepared = await runner.prepare(runId, [{id: 'recording-v1', document_id: 'recording', raw_text: source, raw_sha256: sha(source)}], undefined, true);
  const result = await runner.execute(runId, prepared, 'unit-only-token');
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(events.filter(event => event.type === 'run.testStarted').map(event => event.testKey), [prepared.tests[0].testKey]);
  assert.deepEqual(events.filter(event => event.type === 'run.testFinished').map(event => event.testKey), [prepared.tests[0].testKey]);
  const json = JSON.parse(await readFile(join(prepared.directory, 'execution.json'), 'utf8'));
  const stdout = json.suites[0].specs[0].tests[0].results[0].stdout.find((entry: any) => entry.text?.startsWith('TITLE_PATH='));
  assert.equal(JSON.parse(stdout.text.slice('TITLE_PATH='.length)).slice(1).join(' › '), prepared.tests[0].testKey);
});

test('independent replay refuses an unmanaged browser fixture before launching Chromium', async t => {
  const events: any[] = [], server = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    events.push(JSON.parse(Buffer.concat(chunks).toString())); response.writeHead(200, {'content-type': 'application/json'}); response.end('{"accepted":true}');
  });
  await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const baseUrl = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
  const dir = await mkdtemp(join(tmpdir(), 'workbench-replay-unsupported-')), runner = createPlaywrightRunner({root, artifactRoot: dir, baseUrl});
  t.after(async () => {await runner.close(); await new Promise<void>(resolveClose => server.close(() => resolveClose())); await rm(dir, {recursive: true, force: true});});
  const source = "import {test} from '@playwright/test';\ntest('unmanaged',async({browser})=>{await browser.newContext();});\n";
  const runId = randomUUID(), prepared = await runner.prepare(runId, [{id: 'recording-v1', document_id: 'recording', raw_text: source, raw_sha256: sha(source)}], undefined, true);
  const result = await runner.execute(runId, prepared, 'unit-only-token');
  assert.equal(result.code, 1);
  const finished = events.find(event => event.type === 'run.testFinished');
  assert.equal(finished.payload.runnerStatus, 'failed');
  assert.ok(finished.payload.errors.some((error: string) => error.includes('UNSUPPORTED_MANAGED_PAGE')));
});

test('actual passing Playwright process without required browser step evidence remains INCOMPLETE', async t => {
  const env = await setup(t), ready = await env.completed();
  let runs: ReturnType<typeof createRuns>;
  const server = createServer(async (request, response) => {
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const event = JSON.parse(Buffer.concat(chunks).toString());
      const result = await runs.ingest(event.runId, event); response.writeHead(200, {'content-type': 'application/json'}); response.end(JSON.stringify(result));
    } catch (error) {response.writeHead(500); response.end(String(error));}
  });
  await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const baseUrl = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
  const runner = createPlaywrightRunner({root, artifactRoot: env.dir, baseUrl});
  runs = createRuns({store: env.core.store, browser: noBrowser, runner, root, artifactRoot: env.dir, baseUrl, resolveSource: env.resolveSource, emit() {}});
  t.after(async () => {await runs.close(); await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));});
  const source = await env.core.store.all("SELECT id FROM source_cases WHERE gherkin_version_id=? AND case_key='a'", [env.g.versionId!]);
  const result = await runs.verify(env.req.id, {testBaselineId: ready.baseline!.id, sourceRef: env.sourceRef, selection: {mode: 'SELECTED_CASES', sourceCaseIds: [source[0].id]}});
  assert.deepEqual(result.expectedTestKeys.sort(), ['test-a', 'test-a-extra']);
  const selected = await env.core.store.all('SELECT t.test_key FROM run_test_selection s JOIN test_definitions t ON t.id=s.test_definition_id WHERE s.run_id=? ORDER BY t.test_key', [result.runId]);
  assert.deepEqual(selected.map(row => row.test_key), ['test-a', 'test-a-extra']);
  let report = await runs.report(result.runId);
  for (let attempt = 0; report.status === 'RUNNING' && attempt < 100; attempt++) {await new Promise(resolveWait => setTimeout(resolveWait, 100)); report = await runs.report(result.runId);}
  assert.equal(report.status, 'INCOMPLETE');
  assert.equal(report.environment.execution.exitCode, 0);
  assert.equal(report.environment.sourceSnapshot.resolvedCommit, env.sourceRef);
  assert.equal(report.environment.sourceSnapshot.repositoryRef, env.dir);
  assert.deepEqual(report.executedTestKeys.sort(), ['test-a', 'test-a-extra']);
  assert.deepEqual(report.unexecutedTestKeys, ['test-b']);
  assert.equal(report.coverageComplete, false);
  assert.deepEqual(report.sourceCases.find(item => item.caseId === 'b'), {sourceCaseId: (await env.core.store.all("SELECT id FROM source_cases WHERE gherkin_version_id=? AND case_key='b'", [env.g.versionId!]))[0].id, scenarioId: 'AC-SELECT-001', caseId: 'b', selected: false, status: 'NOT_RUN'});
  assert.equal((await env.core.getRequirement(env.req.id)).stage, 'VERIFICATION');
});

for (const mismatch of [false, true]) test(`application event validation with explicit adapter doubles preserves ${mismatch ? 'FAILED assertion' : 'selected PASSED without full coverage'}`, async t => {
  const env = await setup(t), ready = await env.completed();
  const realDiscovery = createPlaywrightRunner({root, artifactRoot: env.dir, baseUrl: 'http://127.0.0.1:1'});
  let release!: () => void;
  const gate = new Promise<void>(resolveGate => {release = resolveGate;});
  const runnerDouble: TestRunnerPort = {prepare: realDiscovery.prepare, async execute() {await gate; return {code: mismatch ? 1 : 0, stdout: '', stderr: ''};}, async close() {release(); await realDiscovery.close();}};
  const closed: string[] = [];
  const browserDouble: BrowserRuntimePort = {...noBrowser, async create() {const id = randomUUID(); return {id, sessionId: id, contextRef: 'context-' + id, pageId: 'page-' + id, playwrightEndpoint: 'unit://not-a-real-browser'};}, async closeSession(id) {closed.push(id);}};
  await env.core.store.run('INSERT INTO target_connections(id,project_id,sqlite_file_ref,environment_label,app_base_url) VALUES(?,?,?,?,?)', ['unit-connection', ready.projectId, join(env.dir, 'unused-target.sqlite'), 'unit-double', 'http://127.0.0.1:1']);
  const emitted: any[] = [], runs = createRuns({store: env.core.store, browser: browserDouble, runner: runnerDouble, root, artifactRoot: env.dir, baseUrl: 'http://127.0.0.1:1', resolveSource: env.resolveSource, emit(event) {emitted.push(event);}});
  t.after(() => runs.close());
  const source = (await env.core.store.all("SELECT id FROM source_cases WHERE gherkin_version_id=? AND case_key='a'", [env.g.versionId!]))[0];
  const selected = await runs.verify(env.req.id, {testBaselineId: ready.baseline!.id, sourceRef: env.sourceRef, selection: {mode: 'SELECTED_CASES', sourceCaseIds: [source.id]}});
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZQAAAABJRU5ErkJggg==', 'base64');
  let lastBindingSeq = 0;
  for (const testKey of selected.expectedTestKeys) {
    const context = await runs.executionContext(selected.runId, testKey);
    const send = (type: string, payload: any = {}, extra: any = {}) => runs.ingest(selected.runId, {eventId: randomUUID(), type, runId: selected.runId, testKey, testDefinitionId: context.testDefinitionId, sourceCaseId: context.sourceCaseId, ...context.app, ...extra, payload});
    await send('run.testStarted');
    assert.equal((await runs.binding(selected.runId)).bound, false, 'a new test must not expose the previous test page binding');
    const bound = await send('run.browserBound');
    assert.ok(bound.bindingSeq! > lastBindingSeq, 'binding sequence stays monotonic across test boundaries');
    lastBindingSeq = bound.bindingSeq!;
    await assert.rejects(send('run.stepFinished', {sourceStepId: 'foreign-step', actionIndex: 1, status: 'PASSED', assertion: false}, {bindingSeq: bound.bindingSeq}), (error: any) => error.code === 'SOURCE_STEP_INVALID');
    const steps = Object.values(context.sourceSteps);
    for (const [index, sourceStepId] of steps.entries()) {
      const current = index ? await send('run.browserBound') : bound;
      lastBindingSeq = current.bindingSeq!;
      const failed = mismatch && testKey === 'test-a' && index === steps.length - 1;
      const assertion = index === steps.length - 1;
      await send('run.stepFinished', {sourceStepId, actionIndex: index + 1, status: failed ? 'FAILED' : 'PASSED', assertion, assertionPassed: assertion ? !failed : null,
        expected: assertion ? 'A' : null, actual: assertion ? failed ? 'B' : 'A' : null, error: failed ? 'Expected A, received B' : null,
        screenshot: {moment: failed ? 'failure' : assertion ? 'after_assertion' : 'precondition', contentType: 'image/png', sha256: createHash('sha256').update(png).digest('hex'), base64: png.toString('base64')}}, {bindingSeq: current.bindingSeq});
    }
    await send('run.testFinished', {runnerStatus: mismatch && testKey === 'test-a' ? 'failed' : 'passed', expectedStatus: 'passed'});
  }
  await runs.ingest(selected.runId, {eventId: randomUUID(), type: 'run.completed', runId: selected.runId, payload: {runnerStatus: mismatch ? 'failed' : 'passed', errors: []}});
  release();
  const report = await runs.wait(selected.runId);
  assert.equal(report.status, mismatch ? 'FAILED' : 'PASSED'); assert.equal(report.coverageComplete, false);
  assert.equal(report.requiredTestCount, 3); assert.deepEqual(report.unexecutedTestKeys, ['test-b']);
  assert.equal((await env.core.getRequirement(env.req.id)).stage, 'VERIFICATION');
  assert.equal(closed.length, 4);
  assert.equal((await runs.binding(selected.runId)).bound, false);
  assert.ok(emitted.filter(event => event.type === 'run.stepFinished').every(event => !event.payload.screenshot.base64));
  if (mismatch) {
    const failed = report.cases.flatMap(row => row.steps).find(step => step.status === 'FAILED');
    assert.equal(failed.expected, 'A'); assert.equal(failed.actual, 'B'); assert.equal(failed.assertionPassed, false); assert.equal(failed.screenshots[0].moment, 'failure');
  }
});
