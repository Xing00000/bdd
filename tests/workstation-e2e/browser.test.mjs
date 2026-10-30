import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { createGit, execute } from '../../packages/git-core/index.mjs';
import { initialize, createFeature } from '../../packages/spec-toolkit/index.mjs';
import { createStandaloneServer } from '../../packages/workstation/http.mjs';
import { readJson, writeJson, exists } from '../../packages/contracts/index.mjs';
import { commitAll, approve, toolkitRoot } from '../workstation/helpers.mjs';

async function port() {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value;
}
// This test installs the real pinned dependencies and launches a real sandboxed Chromium.
// It is deliberately outside the dependency-free unit/integration test glob: missing prerequisites fail, not skip.
test('repository UI → immutable candidate → real BDD browser actions → sealed screenshots → independent report commit', { timeout: 600000 }, async t => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'workstation-browser-')), home = path.join(base, 'home');
  const repo = path.join(home, 'workspaces/WS-e2e/repo'), product = path.join(base, 'product');
  const git = createGit({ allowLocal: true }), targetPort = await port(), origin = `http://127.0.0.1:${targetPort}`;
  const evidenceOutput = process.env.WB_E2E_ARTIFACTS ? path.resolve(process.env.WB_E2E_ARTIFACTS) : path.join(base, 'artifacts');
  await mkdir(home, { recursive: true }); await mkdir(evidenceOutput, { recursive: true });
  let app, browser;
  t.after(async () => {
    await browser?.close(); await app?.close();
    const executions = path.join(home, 'executions');
    if (await exists(executions)) await cp(executions, path.join(evidenceOutput, 'executions'), { recursive: true,
      filter: source => !path.relative(executions, source).split(path.sep).some(part => ['repo', 'home', 'tmp'].includes(part)) });
    if (process.env.WB_E2E_ARTIFACTS) await rm(base, { recursive: true, force: true });
  });
  await git.init(product);
  await writeFile(path.join(product, 'server.mjs'), `import http from 'node:http';
const server = http.createServer((request,response) => {
  if(request.url === '/health'){ response.setHeader('content-type','application/json'); response.end(JSON.stringify({commit:process.env.WB_SOURCE_COMMIT})); return; }
  response.setHeader('content-type','text/html; charset=utf-8');
  response.end('<!doctype html><html><title>Acceptance fixture</title><button onclick="document.querySelector(\\'output\\').textContent=\\'Signed in\\'">Sign in</button><output role="status">Signed out</output></html>');
});
server.listen(Number(process.argv[2]),'127.0.0.1');
process.on('SIGTERM',()=>server.close());\n`);
  await commitAll(product); const productCommit = await git.resolve(product);
  await git.init(repo);
  await initialize(repo, { specRepositoryId: 'browser-acceptance', toolkitRoot: path.join(toolkitRoot, 'packages'), templateRoot: path.join(toolkitRoot, 'templates/spec-repo/v1') });
  await commitAll(repo);
  await git.addModule(repo, { projectId: 'product', url: product, commit: productCommit }, await git.inspect(repo));
  const config = await readJson(path.join(repo, 'workbench.yaml'));
  config.projects = [{ id: 'product', path: 'projects/product' }];
  config.execution.install = ['npm', 'ci', '--ignore-scripts']; config.execution.environment = { WB_TARGET_BASE_URL: origin };
  config.execution.service = { projectId: 'product', command: [process.execPath, 'server.mjs', String(targetPort)], healthUrl: `${origin}/health` };
  await writeJson(path.join(repo, 'workbench.yaml'), config);
  await createFeature(repo, { requirementId: 'REQ-001', featureId: 'login', title: 'Real browser login', projectIds: ['product'] });
  await writeFile(path.join(repo, 'spec/REQ-001/login/login.feature'), `Feature: Real browser acceptance
  @case:CASE-001
  Scenario: Sign in using the actual page
    Given the sample website is open
    When I sign in
    Then the page confirms I signed in
`);
  await writeFile(path.join(repo, 'tests/REQ-001/login/login.steps.ts'), `import { Given, When, Then } from '../../_shared/bdd';
import { expect } from '@playwright/test';
Given('the sample website is open', async ({ page }) => { await page.goto('/'); });
When('I sign in', async ({ page }) => { await page.getByRole('button', { name: 'Sign in' }).click(); });
Then('the page confirms I signed in', async ({ page }) => { await expect(page.getByRole('status')).toHaveText('Signed in'); });
`);
  async function command(executable, args, label) {
    const result = await execute(executable, args, { cwd: repo, env: { ...process.env }, timeoutMs: 240000, maxBytes: 16 * 1024 * 1024 });
    await writeJson(path.join(evidenceOutput, `${label}.json`), result); assert.equal(result.exitCode, 0, result.stderr + result.stdout); assert.equal(result.timedOut, false);
  }
  await command('npm', ['install', '--ignore-scripts'], 'install');
  await command(path.join(repo, 'node_modules/.bin/playwright'), ['install', '--with-deps', 'chromium'], 'browser-install');
  await cp(path.join(repo, 'package-lock.json'), path.join(evidenceOutput, 'package-lock.json'));
  await approve(repo); const state = await git.inspect(repo); assert.equal(state.clean, true);
  app = await createStandaloneServer({ home, toolkitRoot, allowLocal: true, enableExecution: true });
  app.service.register({ id: 'WS-e2e', title: 'Browser acceptance', remoteUrl: repo });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); const site = `http://127.0.0.1:${app.server.address().port}`;
  async function operation(operationId, operation, input, expected) {
    const response = await fetch(`${site}/repository-api/v1/operations`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-workbench-request': '1' },
      body: JSON.stringify({ schemaVersion: 1, operationId, workspaceId: 'WS-e2e', operation, input, ...(expected ? { expected } : {}) }) });
    assert.equal(response.status, 202, await response.text());
    const result = await app.service.wait(operationId, 480000); assert.equal(result.status, 'SUCCEEDED', JSON.stringify(result.error)); return result.result;
  }
  const plan = await operation('OP-prepare', 'run.prepare', { requirementId: 'REQ-001', featureId: 'login' }, state);
  const result = await operation('OP-run', 'run.execute', { runId: plan.runId }); await writeJson(path.join(evidenceOutput, 'manifest.json'), result);
  assert.equal(result.testOutcome, 'PASSED', JSON.stringify(result)); assert.equal(result.verification, 'VERIFIED', JSON.stringify(result));
  assert.equal(result.testedSpecCommit, state.head); assert.ok(result.artifacts.filter(x => x.path.startsWith('screenshots/')).length >= 3);
  const publication = await operation('OP-publish', 'run.publish', { runId: plan.runId, push: false });
  assert.notEqual(publication.reportCommit, state.head); assert.equal(publication.testedSpecCommit, state.head); assert.equal(await git.resolve(repo), state.head);
  const { chromium } = createRequire(path.join(repo, 'package.json'))('@playwright/test');
  browser = await chromium.launch({ chromiumSandbox: true }); const page = await browser.newPage();
  const browserErrors = []; page.on('pageerror', error => browserErrors.push(error.message));
  await page.goto(`${site}/repositories`); await page.getByRole('button', { name: 'Browser acceptance', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#feature-stage')?.textContent.includes('驗收：VERIFIED'));
  await page.getByRole('button', { name: 'Runs / Reports', exact: true }).click();
  await page.getByRole('button', { name: '檢視報告與截圖', exact: true }).click();
  await page.locator('.gallery').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => [...document.querySelectorAll('.gallery img')].length >= 3 && [...document.querySelectorAll('.gallery img')].every(x => x.complete && x.naturalWidth > 0));
  await page.screenshot({ path: path.join(evidenceOutput, 'management-reports.png'), fullPage: true }); assert.deepEqual(browserErrors, []);
});
