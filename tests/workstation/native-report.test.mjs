import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { renderNativeReport } from '../../packages/workstation/native-report.mjs';
import { dispatch } from '../../packages/workstation/http.mjs';
import { verifyBundle } from '../../packages/spec-toolkit/engine.mjs';
import { digest, writeJson } from '../../packages/contracts/index.mjs';
import { fixture, sealedBundle } from './helpers.mjs';

function documentStorage() {
  const window = {};
  for (const name of ['localStorage', 'sessionStorage'])
    Object.defineProperty(window, name, { configurable: true, get() { throw new Error('Origin storage accessed'); } });
  const original = Buffer.from('<!doctype html><html><head><script type="module">report()</script></head></html>');
  const rendered = renderNativeReport(original).toString();
  assert.equal(original.toString(), '<!doctype html><html><head><script type="module">report()</script></head></html>');
  assert.ok(rendered.startsWith('<!doctype html>'));
  assert.ok(rendered.endsWith('<script type="module">report()</script></head></html>'));
  const bootstrap = rendered.match(/<script>([\s\S]*?)<\/script>/)[1];
  runInNewContext(bootstrap, { window });
  return window;
}

test('sandbox report preferences support Playwright named properties and Storage methods without origin storage', () => {
  const { localStorage: storage } = documentStorage();
  assert.equal(storage.length, 0);
  assert.equal(storage.getItem('missing'), null);
  assert.equal(storage.missing, undefined);
  storage.theme = 'dark';
  storage.setItem('count', 3);
  assert.equal(storage.getItem('theme'), 'dark');
  assert.equal(storage.count, '3');
  assert.equal(storage.length, 2);
  assert.equal(storage.key(0), 'theme');
  assert.equal(storage.key(1), 'count');
  assert.equal(storage.key(2), null);
  assert.deepEqual(Object.keys(storage), ['theme', 'count']);
  assert.equal('theme' in storage, true);
  storage.removeItem('theme');
  assert.equal(storage.theme, undefined);
  delete storage.count;
  assert.equal(storage.length, 0);
  storage.filters = JSON.stringify({ status: 'passed' });
  assert.deepEqual(JSON.parse(storage.getItem('filters')), { status: 'passed' });
  storage.clear();
  assert.deepEqual(Object.keys(storage), []);
});

test('report preferences are isolated between storage areas, documents and reloads', () => {
  const first = documentStorage();
  first.localStorage.theme = 'dark';
  assert.equal(first.sessionStorage.getItem('theme'), null);
  const next = documentStorage();
  assert.equal(next.localStorage.getItem('theme'), null);
  next.localStorage.theme = 'light';
  assert.equal(first.localStorage.theme, 'dark');
});

test('native presentation adds storage without changing sealed HTML, raw downloads or isolation policy', async t => {
  const { base } = await fixture(t), directory = path.join(base, 'report');
  const manifest = await sealedBundle(directory, { runId: 'RUN-native', requirementId: 'REQ-002', featureId: 'feature', testedSpecCommit: 'a'.repeat(40) });
  const html = Buffer.from('<!doctype html><script>localStorage.theme = "dark";</script>');
  await mkdir(path.join(directory, 'native'));
  await writeFile(path.join(directory, 'native/index.html'), html);
  manifest.artifacts.push({ path: 'native/index.html', size: html.length, sha256: digest(html) });
  await writeJson(path.join(directory, 'manifest.json'), manifest);
  await writeJson(path.join(directory, 'seal.json'), { schemaVersion: 1, manifestSha256: digest(await readFile(path.join(directory, 'manifest.json'))) });
  const seal = await readFile(path.join(directory, 'seal.json'));
  const service = { artifactDirectory: async () => directory };
  const url = '/repository-api/v1/spec-repositories/SPEC-native/runs/RUN-native';
  const presented = await dispatch(service, { method: 'GET', url: `${url}/report/native/index.html`, headers: {} });
  assert.equal(presented.status, 200);
  assert.deepEqual(presented.body, renderNativeReport(html));
  assert.notDeepEqual(presented.body, html);
  const policy = presented.headers['content-security-policy'];
  assert.match(policy, /sandbox allow-scripts;/);
  assert.ok(!policy.includes('allow-same-origin'));
  assert.match(policy, /connect-src 'self' data: blob:;/);
  const raw = await dispatch(service, { method: 'GET', url: `${url}/artifact?path=native/index.html`, headers: {} });
  assert.deepEqual(raw.body, html);
  assert.deepEqual(await readFile(path.join(directory, 'native/index.html')), html);
  assert.deepEqual(await readFile(path.join(directory, 'seal.json')), seal);
  assert.deepEqual(await verifyBundle(directory), manifest);
  const key='REQ-002/feature/RUN-native';let requestedKey;
  const keyed=await dispatch({artifactDirectory:async(_repository,_run,reportKey)=>{requestedKey=reportKey;return directory;}},{method:'GET',url:`${url}/report/by-key/${encodeURIComponent(key)}/native/index.html`,headers:{}});
  assert.equal(requestedKey,key);assert.deepEqual(keyed.body,renderNativeReport(html));
});
