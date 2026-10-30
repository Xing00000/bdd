import { spawn } from 'node:child_process';
import { mkdir, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { invariant, id, version } from '../contracts/index.mjs';
import { createGit, remoteUrl, branchName, processEnvironment } from '../git-core/index.mjs';
import { openStore } from './store.mjs';
import { validateRequest, workspaceDetail, repositoryPath, readWorkspaceFile } from './operations.mjs';

export async function createWorkstation(configuration) {
  await mkdir(configuration.home, { recursive: true, mode: 0o700 });
  const options = { allowLocal: false, hosts: ['github.com'], enableExecution: false, ...configuration, home: await realpath(configuration.home) };
  const store = openStore(options.home), children = new Map(); let closing = false;
  function launch(operationId) {
    if (closing || children.has(operationId) || store.get(operationId)?.status !== 'QUEUED') return;
    const child = spawn(process.execPath, [fileURLToPath(new URL('./worker.mjs', import.meta.url)), JSON.stringify(options), operationId], {
      env: { ...processEnvironment({}, { git: true }), ...(process.env.PLAYWRIGHT_BROWSERS_PATH ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH } : {}) },
      detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'pipe']
    });
    children.set(operationId, child); let stderr = '';
    child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-32768); });
    child.once('error', error => store.finish(operationId, 'FAILED', undefined, error));
    child.once('close', () => {
      children.delete(operationId);
      const current = store.get(operationId);
      if (current?.status === 'CANCELLING')
        store.finish(operationId, 'CANCELLED', undefined, { code: 'OPERATION_CANCELLED', message: 'Worker stopped; inspect partial Git changes before retrying' });
      else if (current && ['QUEUED', 'RUNNING'].includes(current.status))
        store.finish(operationId, 'INTERRUPTED', undefined, { code: 'WORKER_INTERRUPTED', message: stderr || 'Worker exited without a completion receipt; inspect before retrying' });
    });
  }
  for (const operationId of store.recover()) launch(operationId);
  const service = {
    options,
    list() { return store.workspaces(); },
    register(input) {
      const workspaceId = id(input.id ?? `WS-${randomUUID()}`);
      remoteUrl(input.remoteUrl, options); if (input.branch) branchName(input.branch);
      invariant(typeof input.title === 'string' && input.title.trim() && input.title.length <= 200, 'INVALID_TITLE', 'Repository title is required');
      return store.register({ ...input, id: workspaceId });
    },
    async detail(workspaceId) { const workspace = store.workspace(id(workspaceId)); return { ...(await workspaceDetail(options, workspace)), runs: store.runs(workspaceId), operations: store.operations(workspaceId) }; },
    readFile(workspaceId, relative) { store.workspace(id(workspaceId)); return readWorkspaceFile(options.home, workspaceId, relative); },
    async inspect(workspaceId, projectId) {
      store.workspace(id(workspaceId)); const git = createGit(options), root = await repositoryPath(options.home, workspaceId);
      if (!projectId) return git.diff(root);
      const module = (await git.modules(root)).find(x => x.id === id(projectId));
      invariant(module?.actual, 'PROJECT_NOT_INITIALIZED', 'Project must be initialized');
      return git.diff(`${root}/${module.path}`);
    },
    enqueue(request) {
      invariant(!closing, 'WORKSTATION_CLOSING', 'Workstation is shutting down', 503);
      validateRequest(request); store.workspace(request.workspaceId);
      const operation = store.enqueue(request); launch(operation.id); return operation;
    },
    operation(operationId) { const value = store.get(id(operationId)); invariant(value, 'OPERATION_NOT_FOUND', 'Operation not found', 404); return value; },
    async wait(operationId, timeoutMs = 60000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const operation = this.operation(operationId);
        if (!['QUEUED', 'RUNNING', 'CANCELLING'].includes(operation.status)) return operation;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error('Operation wait timed out; the durable job may still be running');
    },
    cancel(operationId) {
      const operation = this.operation(operationId), child = children.get(operation.id);
      invariant(operation.status === 'QUEUED' || operation.status === 'RUNNING', 'OPERATION_FINISHED', 'Operation already finished', 409);
      invariant(operation.status === 'QUEUED' || child, 'WORKER_NOT_OWNED', 'This process does not own the worker; do not signal an unverified PID', 409);
      if (child) store.requestCancellation(operationId);
      if (child?.pid) { try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM'); else child.kill('SIGTERM'); } catch {} }
      if (child) {
        const timer = setTimeout(() => { try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {} }, 2000);
        child.once('close', () => clearTimeout(timer));
        return this.operation(operationId);
      }
      return store.finish(operationId, 'CANCELLED', undefined, { code: 'OPERATION_CANCELLED', message: 'Cancelled before worker startup' });
    },
    async close() {
      closing = true;
      const active = [...children.entries()];
      for (const [operationId] of active) {
        const operation = this.operation(operationId);
        if (['QUEUED', 'RUNNING'].includes(operation.status)) this.cancel(operationId);
      }
      await Promise.all(active.map(([, child]) => new Promise(resolve => {
        if (child.exitCode !== null || child.signalCode) return resolve();
        const timer = setTimeout(() => { try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {} }, 1500);
        child.once('close', () => { clearTimeout(timer); resolve(); });
      })));
      store.close();
    }
  };
  return service;
}
