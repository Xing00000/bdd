import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { execute, processEnvironment } from '../../packages/git-core/index.mjs';
import { createWorkstation } from '../../packages/workstation/service.mjs';
import { fileURLToPath } from 'node:url';

function environment(t, values) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test('child commands use the configured temporary directory without inheriting unrelated secrets', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bdd-env-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  environment(t, { TMPDIR: root, TMP: root, TEMP: root, BDD_ENV_TEST_SECRET: 'must-not-be-inherited' });
  const result = await execute(process.execPath, ['--input-type=module', '-e', `
    import os from 'node:os';
    import path from 'node:path';
    import { mkdtemp, rm } from 'node:fs/promises';
    const directory = await mkdtemp(path.join(os.tmpdir(), 'child-'));
    console.log(JSON.stringify({ directory, secret: process.env.BDD_ENV_TEST_SECRET }));
    await rm(directory, { recursive: true });
  `], { env: processEnvironment(), progress: false });
  assert.equal(result.exitCode, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(path.dirname(output.directory), root);
  assert.equal(output.secret, undefined);
  for (const key of ['TMPDIR', 'TMP', 'TEMP']) assert.equal(processEnvironment()[key], root);
});

test('explicit isolated temporary directories take precedence over host defaults', t => {
  environment(t, { TMPDIR: '/host/tmp', TMP: '/host/tmp', TEMP: '/host/tmp' });
  const extra = { TMPDIR: '/isolated/tmp', TMP: '/isolated/tmp', TEMP: '/isolated/tmp' };
  for (const git of [false, true]) {
    const result = processEnvironment(extra, { git });
    for (const key of Object.keys(extra)) assert.equal(result[key], extra[key]);
  }
});

test('SQLite authoring workers preserve a configured temporary directory', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bdd-worker-env-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const temporary = path.join(root, 'temporary');
  await mkdir(temporary);
  environment(t, { TMPDIR: temporary, TMP: temporary, TEMP: temporary });
  const home = path.join(root, 'home');
  const service = await createWorkstation({
    home, toolkitRoot: fileURLToPath(new URL('../..', import.meta.url)), allowLocal: true, autoAcquire: false
  });
  t.after(() => service.close());
  service.register({ id: 'SPEC-temp', title: 'Temporary directory', remoteUrl: path.join(root, 'offline.git') });
  service.enqueue({ schemaVersion: 1, repositoryId: 'SPEC-temp', operationId: 'OP-temp',
    operation: 'repository.setup', input: { reviewer: 'Temporary directory test', projects: [] } });
  const result = await service.wait('OP-temp');
  assert.equal(result.status, 'SUCCEEDED', JSON.stringify(result.error));
  assert.equal(result.result.storage, 'sqlite');
  assert.equal((await service.detail('SPEC-temp')).preferences.reviewer, 'Temporary directory test');
});
