import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { runInNewContext } from 'node:vm';
import { SqliteTargetAdapter } from '../../src/adapters/runtime/target-db.js';
import { PtyTerminalAdapter } from '../../src/adapters/runtime/terminal.js';
import { PlaywrightBrowserAdapter } from '../../src/adapters/runtime/browser.js';
import { ActionRecorder, decodeDomAction, emitRecording, installDomRecorder } from '../../src/adapters/runtime/recorder.js';
import { quoteIdentifier, singleStatement, splitStatements } from '../../src/adapters/runtime/sql.js';

test('target SQLite executes actual DDL, bound DML, schema introspection and transactions in a worker', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'bdd-runtime-db-'));
  const file = join(root, 'target.sqlite');
  new DatabaseSync(file).close();
  const adapter = new SqliteTargetAdapter(root);
  t.after(async () => { await adapter.close(); await rm(root, { recursive: true, force: true }); });
  await adapter.query(file, 'CREATE TABLE "strange""table" (id INTEGER PRIMARY KEY, content TEXT NOT NULL)');
  const text = "Robert'); DROP TABLE other; --";
  assert.equal((await adapter.query(file, 'INSERT INTO "strange""table"(content) VALUES (?)', [text])).changes, 1);
  const result = await adapter.query(file, 'SELECT id,content FROM "strange""table"');
  assert.deepEqual(result, { columns: ['id', 'content'], rows: [{ id: 1, content: text }] });
  const schema = await adapter.schema(file) as { name: string; columns: { name: string }[] }[];
  assert.equal(schema[0].name, 'strange"table');
  assert.deepEqual(schema[0].columns.map((c) => c.name), ['id', 'content']);
  await adapter.query(file, 'BEGIN');
  await adapter.query(file, 'UPDATE "strange""table" SET content=? WHERE id=?', ['changed', 1]);
  await adapter.query(file, 'ROLLBACK');
  assert.equal((await adapter.query(file, 'SELECT content FROM "strange""table"')).rows[0].content, text);
  await assert.rejects(adapter.query(file, "ATTACH DATABASE ':memory:' AS outside"), /not authorized/i);
  const multi = await adapter.query(file, 'UPDATE "strange""table" SET content=\'script;value\'; SELECT content FROM "strange""table";');
  assert.equal(multi.rows[0].content, 'script;value');
  await assert.rejects(adapter.query(file, 'SELECT ?; SELECT ?', [1]), { code: 'AMBIGUOUS_SQL_PARAMETERS' });
  await assert.rejects(adapter.query(file, 'UPDATE "strange""table" SET content=\'partial\'; SELECT * FROM missing_table;'), /Statement 2\/2 failed; preceding statements may be committed/);
  assert.equal((await adapter.query(file, 'SELECT content FROM "strange""table"')).rows[0].content, 'partial');
  await assert.rejects(adapter.query(file, 'SELECT ?', [{}]), { code: 'INVALID_RUNTIME_INPUT' });
});

test('target SQLite long native query does not block the API event loop', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'bdd-runtime-loop-'));
  const file = join(root, 'target.sqlite'); new DatabaseSync(file).close();
  const adapter = new SqliteTargetAdapter(root);
  t.after(async () => { await adapter.close(); await rm(root, { recursive: true, force: true }); });
  await adapter.query(file, 'SELECT 1');
  let heartbeats = 0;
  const interval = setInterval(() => { heartbeats++; }, 2);
  try {
    const result = await adapter.query(file, 'WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000000) SELECT sum(x) AS total FROM n');
    assert.equal(result.rows[0].total, 500000500000);
    assert.ok(heartbeats > 0, 'API event loop must remain responsive during native SQLite work');
  } finally { clearInterval(interval); }
});

test('target/PTY paths must resolve inside their supplied existing workspace', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'bdd-runtime-path-'));
  const outside = await mkdtemp(join(tmpdir(), 'bdd-runtime-outside-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); });
  await symlink(outside, join(root, 'link'));
  const terminal = new PtyTerminalAdapter(root);
  await assert.rejects(terminal.create({ workspaceRef: join(root, 'link') }), { code: 'INVALID_WORKSPACE_PATH' });
  await assert.rejects(terminal.create({ workspaceRef: '.' }), { code: 'INVALID_WORKSPACE_PATH' });
  terminal.close();
});

test('node-pty creates a real TTY and returns decoded process output rather than command echo', { timeout: 15000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'bdd-runtime-pty-'));
  const terminal = new PtyTerminalAdapter(root);
  t.after(async () => { terminal.close(); await rm(root, { recursive: true, force: true }); });
  const { id } = await terminal.create({ workspaceRef: root, cols: 100, rows: 30 });
  terminal.resize(id, 90, 25);
  const marker = 'REAL_PTY_' + randomUUID();
  const encoded = Buffer.from(marker).toString('base64');
  let output = '';
  const finished = new Promise<void>((resolve, reject) => {
    terminal.subscribe(id, (event) => {
      if (event.data) output += event.data;
      if (event.type === 'terminal.exited') {
        try { assert.equal(event.exitCode, 0); assert.ok(output.includes(marker), output); resolve(); } catch (error) { reject(error); }
      }
    });
  });
  terminal.input(id, `node -e "process.stdout.write(process.stdout.isTTY?Buffer.from('${encoded}','base64').toString():'NOT_A_TTY')"\rexit\r`);
  await finished;
});

test('semantic recorder merges fill events, preserves boundaries and never saves sensitive literal values', () => {
  const recorder = new ActionRecorder();
  recorder.append({ kind: 'navigate', pageId: 'p1', url: 'https://example.test/' });
  for (const value of ['a', 'ab', 'abc']) recorder.append(decodeDomAction({ kind: 'fill', documentId: 'd1', locator: { kind: 'testId', value: 'title' }, sensitive: false, value: { kind: 'literal', value } }, 'p1', []));
  recorder.append(decodeDomAction({ kind: 'fill', documentId: 'd1', locator: { kind: 'testId', value: 'password' }, sensitive: true, value: { kind: 'secretRef', key: 'WB_SECRET_1' } }, 'p1', []));
  recorder.append({ kind: 'assertion', pageId: 'p1', locator: { kind: 'testId', value: 'title' }, assertionType: 'value', expected: 'abc' });
  assert.equal(recorder.actions().length, 4);
  assert.deepEqual(recorder.actions()[1].value, { kind: 'literal', value: 'abc' });
  assert.match(recorder.script(), /getByTestId\("title"\)\.fill\("abc"\)/);
  assert.match(recorder.script(), /\.fill\(secret\("WB_SECRET_1"\)\)/);
  assert.match(recorder.script(), /toHaveValue\("abc"\)/);
  assert.throws(() => decodeDomAction({ kind: 'fill', documentId: 'd1', locator: { kind: 'css', value: '#password' }, sensitive: true, value: { kind: 'literal', value: 'do-not-save' } }, 'p1', []), { code: 'INVALID_RUNTIME_INPUT' });
  assert.throws(() => decodeDomAction({ kind: 'shell', documentId: 'd1', command: 'echo forbidden' }, 'p1', []), { code: 'INVALID_RUNTIME_INPUT' });
  assert.throws(() => decodeDomAction({ kind: 'fill', documentId: 'd1', locator: { kind: 'css', value: '#password' }, sensitive: true, value: { kind: 'secretRef', key: 'AWS_SECRET_ACCESS_KEY' } }, 'p1', []), { code: 'INVALID_RUNTIME_INPUT' });
  assert.ok(!JSON.stringify(recorder.actions()).includes('do-not-save'));
});

test('recording emitter uses structured data for frame locators and declares unresolved actions as errors', () => {
  const script = emitRecording([
    { kind: 'navigate', pageId: 'p1', url: 'https://example.test/' },
    { kind: 'click', pageId: 'p1', framePath: ['iframe[name="outer"]', '#inner'], locator: { kind: 'testId', value: 'open' } },
    { kind: 'popup', pageId: 'p2', openerPageId: 'p1' },
    { kind: 'assertion', pageId: 'p2', locator: { kind: 'css', value: 'h1' }, assertionType: 'text', expected: 'Hello' },
    { kind: 'unsupported', pageId: 'p2', reason: 'Closed shadow DOM needs a locator' },
  ]);
  assert.match(script, /frameLocator\(/);
  assert.match(script, /Promise\.all\(\[page\.waitForEvent\('popup'\)/);
  assert.match(script, /expect\(page2\.locator\("h1"\)\)\.toHaveText\("Hello"\)/);
  assert.match(script, /throw new Error\("Recording needs manual completion/);
  assert.equal(quoteIdentifier('odd"table'), '"odd""table"');
  assert.equal(singleStatement("SELECT ';' AS value; -- trailing comment"), "SELECT ';' AS value; -- trailing comment");
  assert.equal(splitStatements("SELECT ';'; /* ; */ SELECT 'a'';b'; -- ;").length, 2);
  const ambiguous = emitRecording([
    { kind: 'navigate', pageId: 'p1', url: 'https://example.test/' },
    { kind: 'click', pageId: 'p1', locator: { kind: 'testId', value: 'unrelated-earlier-click' } },
    { kind: 'assertion', pageId: 'p1', locator: { kind: 'testId', value: 'status' }, assertionType: 'text', expected: 'ready' },
    { kind: 'popup', pageId: 'p2', openerPageId: 'p1' },
  ]);
  assert.doesNotMatch(ambiguous, /waitForEvent\('popup'\)/);
  assert.match(ambiguous, /Recording needs manual completion: unresolved page p2/);
});

test('DOM recorder unit fixture retains editable-field clicks and avoids double-recording Enter activation', async () => {
  // Explicit DOM fixture, not browser integration evidence. The function under
  // test is the same self-contained function serialized by addInitScript.
  class ElementFixture {
    tagName = 'DIV'; id = ''; parentElement: ElementFixture | null = null; children: ElementFixture[] = [];
    attributes: Record<string, string> = {}; form: ElementFixture | null = null;
    getAttribute(name: string) { return this.attributes[name] ?? null; }
    closest(selector: string): ElementFixture | null { return selector === 'form' ? this.form : this; }
    matches(_selector: string) { return false; }
  }
  class HtmlFixture extends ElementFixture { isContentEditable = false; textContent = ''; }
  class InputFixture extends HtmlFixture { type = 'text'; value = ''; labels: never[] = []; }
  class TextareaFixture extends HtmlFixture { value = ''; labels: never[] = []; }
  class SelectFixture extends HtmlFixture { selectedOptions: never[] = []; }
  const listeners = new Map<string, ((event: unknown) => void)[]>(), captured: any[] = [];
  const documentFixture = { documentElement: new HtmlFixture(), addEventListener(name: string, callback: (event: unknown) => void) { listeners.set(name, [...listeners.get(name) ?? [], callback]); } };
  const sandbox = { document: documentFixture, crypto: { randomUUID: () => 'fixture-document' }, CSS: { escape: (value: string) => value },
    Element: ElementFixture, HTMLElement: HtmlFixture, HTMLInputElement: InputFixture, HTMLTextAreaElement: TextareaFixture, HTMLSelectElement: SelectFixture,
    capture: async (action: unknown) => { captured.push(action); } };
  runInNewContext(`(${installDomRecorder.toString()})({bindingName:'capture'})`, sandbox);
  const dispatch = (name: string, target: ElementFixture, extras: object = {}) => {
    for (const listener of listeners.get(name) ?? []) listener({ isTrusted: true, composedPath: () => [target], ...extras });
  };
  const textarea = new TextareaFixture(); textarea.tagName = 'TEXTAREA'; textarea.attributes['data-testid'] = 'document-content';
  dispatch('click', textarea, { detail: 1 });
  assert.equal(captured[0].kind, 'click');
  assert.equal(captured[0].locator.value, 'document-content');
  const form = new HtmlFixture(), input = new InputFixture(), submit = new HtmlFixture();
  input.attributes['data-testid'] = 'username'; input.form = form;
  submit.tagName = 'BUTTON'; submit.attributes['data-testid'] = 'login-submit'; submit.form = form;
  dispatch('keydown', input, { key: 'Enter' });
  dispatch('click', submit, { detail: 0 });
  dispatch('keyup', input, { key: 'Enter' });
  assert.deepEqual(captured.map(action => action.kind), ['click', 'press']);
  dispatch('click', submit, { detail: 1 });
  assert.equal(captured.at(-1).kind, 'click', 'a later genuine pointer click must remain recorded');
  dispatch('click', textarea, { detail: 1, isTrusted: false });
  assert.equal(captured.length, 3, 'script-dispatched events do not masquerade as human input');
  await (sandbox as typeof sandbox & { __workbenchRecorderFlush: () => Promise<unknown> }).__workbenchRecorderFlush();
});

test('recording lifecycle unit fixture drains an accepted popup and excludes late pre-start popup events', async () => {
  // Explicit Playwright contract doubles exercise recording boundaries only.
  // This test does not launch a browser, emit frames, or prove live recording.
  const browser = new PlaywrightBrowserAdapter();
  const internals = browser as unknown as { sessions: Map<string, any>; registerPage: (session: any, page: any) => Promise<{ id: string; ready: Promise<void> }> };
  const opener = { frames: () => [], url: () => 'https://example.test/' };
  const recorder = new ActionRecorder();
  recorder.append({ kind: 'navigate', pageId: 'opener', url: opener.url() });
  recorder.append({ kind: 'click', pageId: 'opener', locator: { kind: 'testId', value: 'popup-link' } });
  const session = {
    id: 'unit-lifecycle', contextRef: 'unit-context', endpoint: 'unit://not-a-browser', activePageId: 'opener',
    context: { close: async () => undefined }, pages: new Map([['opener', { id: 'opener', page: opener, ready: Promise.resolve() }]]),
    pageIds: new WeakMap<object, string>([[opener, 'opener']]), listeners: new Set(), frameSequence: 0, frameScheduled: false,
    inputTail: Promise.resolve(), recordTail: Promise.resolve(), recorder: recorder as ActionRecorder | undefined, closed: false,
  };
  internals.sessions.set(session.id, session);
  const popupFixture = (ready: Promise<void>) => ({
    addInitScript: () => ready, evaluate: async () => undefined, opener: async () => opener,
    on: () => undefined, screencast: { start: async () => undefined }, frames: () => [], url: () => 'https://example.test/popup',
  });
  try {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const accepted = await internals.registerPage(session, popupFixture(gate));
    let settled = false;
    const stopping = browser.stopRecording(session.id).then(result => { settled = true; return result; });
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false, 'stop must wait for page setup already accepted at its boundary');
    release();
    const stopped = await stopping;
    assert.ok(stopped.actions.some(action => (action as { kind: string; pageId: string }).kind === 'popup' && (action as { pageId: string }).pageId === accepted.id));
    let releaseBeforeStart!: () => void;
    const beforeStart = await internals.registerPage(session, popupFixture(new Promise<void>(resolve => { releaseBeforeStart = resolve; })));
    await browser.startRecording(session.id);
    releaseBeforeStart(); await beforeStart.ready;
    const next = await browser.stopRecording(session.id);
    assert.equal(next.actions.filter(action => (action as { kind: string }).kind === 'popup').length, 0, 'a page observed before start must not later masquerade as a newly recorded popup');
  } finally { await browser.close(); }
});

test('official sandboxed browser either supplies a real managed JPEG session or explicitly reports unavailable', { timeout: 60000 }, async (t) => {
  const browser = new PlaywrightBrowserAdapter();
  t.after(() => browser.close());
  let attachment;
  try { attachment = await browser.create({ projectId: 'runtime-capability-probe' }); }
  catch (error) {
    assert.equal((error as { code?: string }).code, 'BROWSER_UNAVAILABLE');
    t.diagnostic('BROWSER_UNAVAILABLE: real browser/frame/recording integration was NOT_RUN; no fallback or fake frame');
    return;
  }
  const { chromium } = await import('playwright');
  const connected = await chromium.connect(attachment.playwrightEndpoint);
  try {
    const matches = [];
    for (const context of connected.contexts()) for (const page of context.pages()) {
      const identity = await page.evaluate(() => (globalThis as typeof globalThis & { __workbenchManaged?: unknown }).__workbenchManaged);
      if (JSON.stringify(identity) === JSON.stringify({ sessionId: attachment.sessionId, contextRef: attachment.contextRef, pageId: attachment.pageId })) matches.push(page);
    }
    assert.equal(matches.length, 1);
    const frame = await new Promise<Buffer>((resolve) => { const unsubscribe = browser.subscribe(attachment.sessionId, (event) => { if (event.type === 'browser.frame' && event.image) { resolve(event.image); queueMicrotask(() => unsubscribe()); } }); });
    assert.equal(frame.readUInt16BE(0), 0xffd8, 'actual onFrame JPEG bytes are required');
    const second = await browser.create({ projectId: 'runtime-capability-probe' });
    assert.notEqual(second.contextRef, attachment.contextRef);
    assert.ok(connected.contexts().length >= 2);
  } finally { await connected.close(); }
});
