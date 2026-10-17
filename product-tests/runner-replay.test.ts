import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ReplayCapture} from '../src/adapters/runner/replay-fixture.ts';
import {createCore} from '../src/application/core.ts';
import {createRuns} from '../src/application/runs.ts';
import {createPlaywrightRunner} from '../src/adapters/runner/playwright.ts';
import type {BrowserRuntimePort} from '../src/ports/runtime.ts';
import type {TestRunnerPort} from '../src/ports/runner.ts';

test('replay evidence wraps frame locators and keyboard/mouse methods using explicit page doubles', async () => {
  const events: any[] = [], actualCalls: string[] = [];
  let seq = 0;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZQAAAABJRU5ErkJggg==', 'base64');
  const locator: any = {frameLocator() {return locator;}, contentFrame() {return locator;}, owner() {return locator;}, getByTestId() {return locator;}, locator() {return locator;}, async fill() {actualCalls.push('fill');}, async click() {actualCalls.push('click');}};
  const page: any = {frameLocator() {return locator;}, locator() {return locator;}, async screenshot() {return png;}, keyboard: {async insertText() {actualCalls.push('insertText');}, async down() {actualCalls.push('down');}, async up() {actualCalls.push('up');}}, mouse: {async move() {actualCalls.push('move');}, async wheel() {actualCalls.push('wheel');}, async down() {actualCalls.push('down');}, async up() {actualCalls.push('up');}}};
  const capture = new ReplayCapture(page, {runId: 'unit-run', testKey: 'unit-key', testDefinitionId: 'unit-definition', sourceCaseId: 'script:unit', app: {sessionId: 'unit-session', contextRef: 'unit-context', pageId: 'unit-page', playwrightEndpoint: 'unit://not-a-browser'}}, {
    async post(_url: string, options: any) {events.push(options.data); return {ok: () => true, json: async () => options.data.type === 'run.browserBound' ? {bindingSeq: ++seq} : {accepted: true}};},
  } as any, {status: 'passed', async attach() {}} as any);
  const wrapped: any = capture.wrap(page);
  await wrapped.frameLocator('#frame').getByTestId('field').fill('actual');
  await wrapped.locator('#frame').contentFrame().getByTestId('button').click();
  await wrapped.keyboard.insertText('text'); await wrapped.keyboard.down('Shift'); await wrapped.keyboard.up('Shift');
  await wrapped.mouse.move(1, 2); await wrapped.mouse.wheel(0, 1); await wrapped.mouse.down(); await wrapped.mouse.up();
  await capture.flush();
  const steps = events.filter(event => event.type === 'run.stepFinished');
  assert.equal(steps.length, actualCalls.length); assert.equal(steps.length, 9);
  assert.deepEqual(steps.map(event => event.payload.actionIndex), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.ok(steps.every(event => event.sessionId === 'unit-session' && event.pageId === 'unit-page' && event.payload.screenshot.base64));
});

test('independent replay uses its saved URL without a DB and rejects mismatched project targets', async t => {
  const root = resolve(process.cwd()), dir = await mkdtemp(join(tmpdir(), 'workbench-independent-target-')), core = await createCore(join(dir, 'metadata.sqlite'));
  const project = await core.createProject({name: 'independent target', workspaceRef: dir});
  const script = await core.createScript({projectId: project.id, purpose: 'recording', rawText: "import {test,expect} from '@playwright/test';\ntest('browser-only',async({page})=>{await page.goto('http://127.0.0.1:9/');await expect(page).toHaveURL('http://127.0.0.1:9/');});\n", executionConfig: {targetUrl: 'http://127.0.0.1:9/'}});
  const discovery = createPlaywrightRunner({root, artifactRoot: dir, baseUrl: 'http://127.0.0.1:1'});
  let release!: () => void; const gate = new Promise<void>(resolveGate => {release = resolveGate;});
  const runner: TestRunnerPort = {prepare: discovery.prepare, async execute() {await gate; return {code: 2, stdout: '', stderr: 'explicit unit runner double: no execution'};}, async close() {release(); await discovery.close();}};
  const created: any[] = [];
  const browser: BrowserRuntimePort = {
    async create(input) {created.push(input); const id = randomUUID(); return {id, sessionId: id, contextRef: 'context', pageId: 'page', playwrightEndpoint: 'unit://not-a-browser'};}, attachment() {throw Error('unused');}, async input() {}, subscribe() {return () => {};}, async startRecording() {throw Error('unused');}, async stopRecording() {throw Error('unused');}, async addAssertion() {}, async closeSession() {}, async close() {},
  };
  const runs = createRuns({store: core.store, browser, runner, artifactRoot: dir, root, baseUrl: 'http://127.0.0.1:1', async resolveSource() {throw Error('Independent replay must not require Git');}, emit() {}});
  t.after(async () => {await runs.close(); await core.close(); await rm(dir, {recursive: true, force: true});});
  const replay = await runs.replay(script.id, script.versionId!);
  const context = await runs.executionContext(replay.runId, 'browser-only');
  assert.equal(created.length, 1); assert.equal(created[0].targetUrl, 'http://127.0.0.1:9/'); assert.equal(context.db, undefined); assert.equal(context.dbUiUrl, null);
  await core.store.run('INSERT INTO target_connections(id,project_id,sqlite_file_ref,environment_label,app_base_url) VALUES(?,?,?,?,?)', ['other-url', project.id, join(dir, 'target.sqlite'), 'unit', 'http://127.0.0.1:10/']);
  await assert.rejects(runs.replay(script.id, script.versionId!, {targetUrl: 'http://127.0.0.1:9/'}), (error: any) => error.code === 'TARGET_CONNECTION_MISMATCH');
  await assert.rejects(runs.replay(script.id, script.versionId!, {projectId: 'other-project'}), (error: any) => error.code === 'PROJECT_MISMATCH');
  release(); const report = await runs.wait(replay.runId); assert.equal(report.status, 'INCOMPLETE'); assert.equal(report.environment.targetUrl, 'http://127.0.0.1:9/');
});
