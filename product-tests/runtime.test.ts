import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { SqliteTargetAdapter } from '../src/adapters/runtime/target-db.js';
import { PtyTerminalAdapter } from '../src/adapters/runtime/terminal.js';
import { PlaywrightBrowserAdapter } from '../src/adapters/runtime/browser.js';
import { ActionRecorder, decodeDomAction, emitRecording } from '../src/adapters/runtime/recorder.js';
import { quoteIdentifier, singleStatement, splitStatements } from '../src/adapters/runtime/sql.js';

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
