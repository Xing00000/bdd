import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { toolkitRoot } from './helpers.mjs';

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function startAndInspect(t, override) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'bdd-default-start-'));
  const port = await unusedPort();
  const env = { ...process.env, WB_HOME: home, WB_PORT: String(port) };
  delete env.WB_ENABLE_TRUSTED_EXECUTION;
  if (override !== undefined) env.WB_ENABLE_TRUSTED_EXECUTION = override;
  // Test the exact user command, not an in-process service with custom options.
  const child = spawn('npm', ['start'], { cwd: toolkitRoot, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', bytes => { logs = (logs + bytes.toString()).slice(-8192); });
  child.stderr.on('data', bytes => { logs = (logs + bytes.toString()).slice(-8192); });
  t.after(async () => {
    try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM'); else child.kill('SIGTERM'); } catch { /* exited */ }
    await Promise.race([new Promise(resolve => { if (child.exitCode !== null || child.signalCode) resolve(); else child.once('exit', resolve); }), new Promise(resolve => setTimeout(resolve, 1500))]);
    try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* exited */ }
    await rm(home, { recursive: true, force: true });
  });
  const endpoint = `http://127.0.0.1:${port}/repository-api/v1/capabilities`;
  for (let attempt = 0; attempt < 200; attempt++) {
    if (child.exitCode !== null) assert.fail(`npm start unexpectedly exited: ${logs}`);
    try {
      const response = await fetch(endpoint);
      if (response.ok) return response.json();
    } catch { /* booting */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(`npm start did not expose capabilities: ${logs}`);
}

test('normal npm start enables test confirmation without an extra environment variable', { timeout: 20000 }, async t => {
  const pkg = JSON.parse(await readFile(path.join(toolkitRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.start, 'node scripts/workstation.mjs serve');
  const capabilities = await startAndInspect(t);
  assert.equal(capabilities.executionEnabled, true);
});

test('a deliberate execution opt-out remains available for untrusted repositories', { timeout: 20000 }, async t => {
  const capabilities = await startAndInspect(t, '0');
  assert.equal(capabilities.executionEnabled, false);
});
