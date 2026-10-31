import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fixture, git, toolkitRoot } from './helpers.mjs';
import { createWorkstation } from '../../packages/workstation/service.mjs';
import { createStandaloneServer } from '../../packages/workstation/http.mjs';
import { openStore } from '../../packages/workstation/store.mjs';

async function setup(t) {
  const f = await fixture(t); await git.command(undefined, ['init', '--bare', '--initial-branch', 'main', f.remote]);
  const service = await createWorkstation({ home: f.home, toolkitRoot, allowLocal: true }); t.after(() => service.close());
  service.register({ id: 'WS-one', title: 'Fixture', remoteUrl: f.remote }); return { ...f, service };
}
function request(operationId, operation, input = {}, expected = { head: null }) { return { schemaVersion: 1, operationId, repositoryId: 'WS-one', operation, input, expected }; }
async function perform(service, value) { service.enqueue(value); const result = await service.wait(value.operationId); assert.equal(result.status, 'SUCCEEDED', JSON.stringify(result.error)); return result.result; }

test('worker clones and initializes an empty repository through durable jobs', async t => {
  const f = await setup(t); await perform(f.service, request('OP-clone', 'repository.clone')); await perform(f.service, request('OP-init', 'repository.initialize'));
  const detail = await f.service.detail('WS-one'); assert.equal(detail.initialized, true); assert.equal(detail.state.head, null);
  await perform(f.service, request('OP-feature', 'spec.feature.create', { requirementId: 'REQ-001', featureId: 'login', title: 'Login' }));
  assert.equal((await f.service.detail('WS-one')).spec.features[0].key, 'REQ-001/login');
});
test('operation IDs are idempotent but cannot be reused for different inputs', async t => {
  const f = await setup(t), value = request('OP-clone', 'repository.clone'); const first = await perform(f.service, value);
  assert.equal(f.service.enqueue(value).status, 'SUCCEEDED'); assert.deepEqual(f.service.operation(value.operationId).result, first);
  assert.throws(() => f.service.enqueue({ ...value, input: { different: true } }), { code: 'OPERATION_ID_CONFLICT' });
});
test('a workspace cannot run competing writes concurrently', async t => {
  const f = await setup(t); f.service.enqueue(request('OP-first', 'repository.clone'));
  assert.throws(() => f.service.enqueue(request('OP-second', 'repository.clone')), { code: 'REPOSITORY_BUSY' });
  await f.service.wait('OP-first');
});
test('unknown commands, traversal IDs and arbitrary root paths are rejected', async t => {
  const f = await setup(t);
  assert.throws(() => f.service.enqueue(request('OP-bad', 'shell.exec', { command: 'id' })), { code: 'OPERATION_NOT_ALLOWED' });
  assert.throws(() => f.service.enqueue({ ...request('OP-bad', 'repository.clone'), cwd: '/etc' }), { code: 'UNKNOWN_REQUEST_FIELD' });
  assert.throws(() => f.service.enqueue({ ...request('OP-bad', 'repository.clone'), repositoryId: '../escape' }), { code: 'INVALID_ID' });
});
test('worker failures are durable and do not silently become success', async t => {
  const f = await setup(t); f.service.enqueue(request('OP-missing', 'repository.validate'));
  const operation = await f.service.wait('OP-missing'); assert.equal(operation.status, 'FAILED'); assert.ok(operation.error.message);
});
test('dead running operations are marked interrupted on recovery', async t => {
  const f = await fixture(t); await mkdir(f.home); const store = openStore(f.home);
  store.register({ id: 'WS-one', title: 'fixture', remoteUrl: '/unused' }); store.enqueue(request('OP-dead', 'repository.clone')); store.claim('OP-dead'); store.close();
  const db = new DatabaseSync(path.join(f.home, 'metadata.sqlite')); db.prepare('UPDATE operations SET worker_pid=?').run(2147483647); db.close();
  const service = await createWorkstation({ home: f.home, toolkitRoot, allowLocal: true }); t.after(() => service.close());
  assert.equal(service.operation('OP-dead').status, 'INTERRUPTED');
});
test('real HTTP API serves the management UI and requires protected write headers', async t => {
  const f = await fixture(t), app = await createStandaloneServer({ home: f.home, toolkitRoot, allowLocal: true }); t.after(() => app.close());
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); const origin = `http://127.0.0.1:${app.server.address().port}`;
  const page = await fetch(origin + '/repositories'); assert.equal(page.status, 200); assert.match(await page.text(), /規格與驗收工作台/); assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const denied = await fetch(origin + '/repository-api/v1/spec-repositories', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); assert.equal(denied.status, 403);
  const cross = await fetch(origin + '/repository-api/v1/spec-repositories', { method: 'POST', headers: { 'content-type': 'application/json', 'x-workbench-request': '1', origin: 'https://evil.example' }, body: '{}' }); assert.equal(cross.status, 403);
  const created = await fetch(origin + '/repository-api/v1/spec-repositories', { method: 'POST', headers: { 'content-type': 'application/json', 'x-workbench-request': '1', origin }, body: JSON.stringify({ id: 'WS-http', title: '<script>not executable</script>', remoteUrl: path.join(f.base, 'remote') }) });
  assert.equal(created.status, 201); const list = await (await fetch(origin + '/repository-api/v1/spec-repositories')).json(); assert.equal(list.length, 1);
});
test('HTTP returns 202 for a real background clone and exposes its final receipt', async t => {
  const f = await fixture(t); await git.command(undefined, ['init', '--bare', '--initial-branch', 'main', f.remote]);
  const app = await createStandaloneServer({ home: f.home, toolkitRoot, allowLocal: true }); t.after(() => app.close());
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); const origin = `http://127.0.0.1:${app.server.address().port}`;
  app.service.register({ id: 'WS-one', title: 'HTTP fixture', remoteUrl: f.remote });
  const response = await fetch(origin + '/repository-api/v1/operations', { method: 'POST', headers: { 'content-type': 'application/json', 'x-workbench-request': '1' }, body: JSON.stringify(request('OP-http', 'repository.clone')) });
  assert.equal(response.status, 202); await app.service.wait('OP-http');
  const result = await (await fetch(origin + '/repository-api/v1/operations/OP-http')).json(); assert.equal(result.status, 'SUCCEEDED');
});
