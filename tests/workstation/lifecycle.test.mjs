import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execute, processEnvironment } from '../../packages/git-core/index.mjs';
import { writeJson, exists } from '../../packages/contracts/index.mjs';
import { createWorkstation } from '../../packages/workstation/service.mjs';
import { prepareRun, executeRun, verifyBundle, runBddCommand, testProcessTimeout } from '../../packages/spec-toolkit/engine.mjs';
import { fixture, git, toolkitRoot, specRepository, approve } from './helpers.mjs';

async function eventually(check, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  assert.fail('Expected condition did not occur');
}
async function executionFixture(t, command) {
  const f = await fixture(t); await mkdir(f.home);
  const repo = path.join(f.home, 'repositories/WS-one/repo'); await specRepository(repo);
  const config = JSON.parse(await readFile(path.join(repo, 'workbench.yaml'), 'utf8'));
  config.execution.install = command; await writeJson(path.join(repo, 'workbench.yaml'), config); await approve(repo);
  return { ...f, repo };
}

test('real command timeout escalates to SIGKILL for a process ignoring SIGTERM', async () => {
  const started = Date.now();
  const result = await execute(process.execPath, ['-e', "process.on('SIGTERM',()=>{}); console.log('ready'); setInterval(()=>{},1000)"], { env: processEnvironment(), timeoutMs: 200 });
  assert.match(result.stdout, /ready/); assert.equal(result.timedOut, true); assert.notEqual(result.exitCode, 0);
  assert.ok(Date.now() - started < 5000);
});
test('real excessive command output is terminated instead of consuming unlimited memory', async () => {
  const result = await execute(process.execPath, ['-e', "setInterval(()=>process.stdout.write('x'.repeat(4096)),1)"], { env: processEnvironment(), maxBytes: 1024 });
  assert.equal(result.overflow, true); assert.ok(result.stdout.length <= 1024); assert.notEqual(result.exitCode, 0);
});
test('CLI and thin Git scripts share persisted state and structured output', async t => {
  const f = await fixture(t); await git.command(undefined, ['init', '--bare', '--initial-branch', 'main', f.remote]);
  const env = { ...process.env, WB_HOME: f.home, WB_ALLOW_LOCAL_GIT: '1' };
  async function cli(script, args, input) {
    const result = await execute(process.execPath, [path.join(toolkitRoot, script), ...args], { cwd: toolkitRoot, env, input: JSON.stringify(input) });
    assert.equal(result.exitCode, 0, result.stderr + result.stdout); return JSON.parse(result.stdout);
  }
  await cli('scripts/workstation.mjs', ['register'], { id: 'WS-cli', title: 'CLI fixture', remoteUrl: f.remote });
  const inspected = await cli('scripts/git/inspect.mjs', [], { repositoryId: 'WS-cli' }); assert.match(inspected.state.head, /^[a-f0-9]{40,64}$/); assert.equal(inspected.state.clean, true);
  assert.equal((await git.command(undefined, ['--git-dir', f.remote, 'show-ref'], { allowFailure: true })).exitCode, 1, 'Binding must not upload');
  // Registration now creates the local checkout and initializes the empty specification.
  const detail = await cli('scripts/workstation.mjs', ['detail'], { repositoryId: 'WS-cli' }); assert.equal(detail.initialized, true);
});
test('a real failed preparation command seals NOT_RUN evidence without reporting product success', async t => {
  const f = await executionFixture(t, [process.execPath, '-e', "console.error('intentional fixture failure'); process.exit(3)"]);
  const plan = await prepareRun({ root: f.repo, home: f.home, repositoryId: 'WS-one', input: { requirementId: 'REQ-001', featureId: 'login', expected: await git.inspect(f.repo) }, git });
  const result = await executeRun({ home: f.home, runId: plan.runId, repositoryId: 'WS-one', git, enabled: true });
  assert.equal(result.testOutcome, 'NOT_RUN'); assert.equal(result.verification, 'NOT_VERIFIED'); assert.equal(result.failure.code, 'EXECUTION_COMMAND_FAILED');
  assert.ok(result.artifacts.some(x => x.path === 'logs/1.json'));
  const verified = await verifyBundle(path.join(f.home, 'executions', plan.runId, 'evidence')); assert.equal(verified.testedSpecCommit, plan.testedSpecCommit);
  assert.deepEqual(await executeRun({ home: f.home, runId: plan.runId, repositoryId: 'WS-one', git, enabled: true }), result);
});
test('cancellation holds the workspace lock until the real worker and child stop', async t => {
  const f = await executionFixture(t, [process.execPath, '-e', "require('node:fs').writeFileSync('install.pid',String(process.pid)); process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)"]);
  const service = await createWorkstation({autoAcquire:false, home: f.home, toolkitRoot, allowLocal: true, enableExecution: true }); t.after(() => service.close());
  service.register({ id: 'WS-one', title: 'Cancellation fixture', remoteUrl: f.remote });
  const request = (operationId, operation, input, expected) => ({ schemaVersion: 1, operationId, repositoryId: 'WS-one', operation, input, ...(expected ? { expected } : {}) });
  service.enqueue(request('OP-prepare', 'run.prepare', { requirementId: 'REQ-001', featureId: 'login' }, await git.inspect(f.repo)));
  const prepared = await service.wait('OP-prepare'); assert.equal(prepared.status, 'SUCCEEDED', JSON.stringify(prepared.error));
  service.enqueue(request('OP-execute', 'run.execute', { runId: prepared.result.runId }));
  const pidFile = path.join(f.home, 'executions', prepared.result.runId, 'repo/install.pid'); await eventually(() => exists(pidFile));
  const childPid = Number(await readFile(pidFile, 'utf8'));
  assert.equal(service.cancel('OP-execute').status, 'CANCELLING');
  assert.throws(() => service.enqueue(request('OP-conflict', 'repository.validate', {})), { code: 'REPOSITORY_BUSY' });
  const stopped = await service.wait('OP-execute'); assert.equal(stopped.status, 'CANCELLED');
  await eventually(async () => { try { process.kill(childPid, 0); return false; } catch { return true; } });
  service.enqueue(request('OP-after', 'repository.validate', {})); assert.equal((await service.wait('OP-after')).status, 'SUCCEEDED');
});

test('Playwright global timeout affects only test argv and adds bounded cleanup grace', async t => {
  const { mkdtemp, mkdir, writeFile, chmod, rm } = await import('node:fs/promises');
  const os = await import('node:os');
  const root = await mkdtemp(path.join(os.tmpdir(), 'bdd-timeout-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeJson(path.join(root,'spec/REQ-1/feature/feature.yaml'),{schemaVersion:1,id:'feature',requirementId:'REQ-1',title:'Timeout dispatch',projectIds:[],caseIds:['CASE-001'],profiles:['chromium']});
  const bin = path.join(root, 'node_modules', '.bin'); await mkdir(bin, { recursive: true });
  for (const name of ['playwright', 'bddgen']) {
    const file = path.join(bin, name);
    await writeFile(file, '#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)))\n'); await chmod(file, 0o755);
  }
  const args = async (mode, options = {}) => { const r = await runBddCommand(root, mode, 'REQ-1', 'feature', options); assert.equal(r.exitCode, 0); return JSON.parse(r.stdout); };
  assert.deepEqual(await args('test'), ['test', '--config', 'playwright.config.ts']);
  assert.deepEqual(await args('test', { globalTimeoutMs: 1000 }), ['test', '--config', 'playwright.config.ts', '--global-timeout', '1000']);
  assert.deepEqual(await args('list', { globalTimeoutMs: 1000 }), ['test', '--config', 'playwright.config.ts', '--list']);
  assert.deepEqual(await args('generate', { globalTimeoutMs: 1000 }), ['--config', 'bdd.config.ts']);
  assert.equal(testProcessTimeout(180000, undefined), 180000);
  assert.equal(testProcessTimeout(180000, 1000), 180000);
  assert.equal(testProcessTimeout(180000, 600000), 605000);
});
