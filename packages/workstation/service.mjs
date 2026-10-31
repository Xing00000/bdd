import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { revisionOptions, versionCatalog, readVersionFile } from './catalog.mjs';
import { draftDetail, readDraftFile, draftProjectFiles, ensureDraft, inDraftView } from './authoring.mjs';
import { readComposer, generateRequirement, requirementText } from './requirements.mjs';
import { importRequirementDocument } from './requirement-documents.mjs';
import { spawn } from 'node:child_process';
import { mkdir, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { invariant, id, exists, readJson, safePath, identity } from '../contracts/index.mjs';
import { createGit, remoteUrl, branchName, processEnvironment } from '../git-core/index.mjs';
import { artifactDirectory, currentVerification } from './reports.mjs';
import { projectFiles, readProjectFile } from './repository-actions.mjs';
import { migrateCheckoutDirectory } from './migrate.mjs';
import { listTransactions } from './transactions.mjs';
import { openStore } from './store.mjs';
import { validateRequest, repositoryDetail, repositoryPath, readRepositoryFile } from './operations.mjs';

export async function createWorkstation(configuration) {
  await mkdir(configuration.home, { recursive: true, mode: 0o700 });
  const options = { autoAcquire: true, allowLocal: false, hosts: ['github.com'], enableExecution: false, ...configuration, home: await realpath(configuration.home) };
  const store = openStore(options.home);
  try { await migrateCheckoutDirectory(options.home); } catch (error) { store.close(); throw error; }
  const children = new Map(); let closing = false;
  function launch(operationId) {
    if (closing || children.has(operationId) || store.get(operationId)?.status !== 'QUEUED') return;
    const child = spawn(process.execPath, [fileURLToPath(new URL('./worker.mjs', import.meta.url)), JSON.stringify(options), operationId], {
      env: { ...processEnvironment({}, { git: true }), ...((options.browserRoot ?? process.env.PLAYWRIGHT_BROWSERS_PATH) ? { PLAYWRIGHT_BROWSERS_PATH: options.browserRoot ?? process.env.PLAYWRIGHT_BROWSERS_PATH } : {}) },
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
    async requirement(repositoryId, requirementId, featureId) {
      store.repository(id(repositoryId));
      const root=await repositoryPath(options.home,repositoryId);
      const snapshot=await ensureDraft({root,options,store,repositoryId});
      const result=await inDraftView(snapshot,view=>readComposer(view,requirementId,featureId));
      return {...result,proposals:store.requirementProposals(repositoryId,result.key)};
    },
    generateRequirement(repositoryId,input) {
      store.repository(id(repositoryId));
      invariant(typeof input.editorKey==='string'&&/^(?:new-[A-Za-z0-9-]+|[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+)$/.test(input.editorKey)&&input.editorKey.length<=180,'INVALID_EDITOR','需求編輯識別無效。');
      requirementText(input.previousGherkin??'','Gherkin');
      const generated=generateRequirement(input.description);
      const receipt=store.saveRequirementProposal(repositoryId,{...input,previousGherkin:input.previousGherkin??'',gherkin:generated.gherkin});
      return {...generated,...receipt};
    },
    requirementProposals(repositoryId,key) {store.repository(id(repositoryId));return store.requirementProposals(repositoryId,key);},
    importRequirementDocument(repositoryId,input) {store.repository(id(repositoryId));return importRequirementDocument(input);},
    list() { return store.repositories().map(r=>({...r,connection:store.connection(r.id)})); },
    register(input) {
      const repositoryId = id(input.id ?? `SPEC-${randomUUID()}`);
      remoteUrl(input.remoteUrl, options);
      invariant(!store.repositories().some(r => r.remoteUrl === input.remoteUrl), 'REPOSITORY_ALREADY_BOUND', 'This Git remote is already bound to the workbench', 409);
      if (input.branch) branchName(input.branch);
      invariant(typeof input.title === 'string' && input.title.trim() && input.title.length <= 200, 'INVALID_TITLE', 'Repository title is required');
      const record=store.register({ ...input, id: repositoryId });
      mkdirSync(path.join(options.home,'repositories',repositoryId),{recursive:true,mode:0o700});
      if(options.autoAcquire) {
        const operationId=`OP-${randomUUID()}`;
        store.setConnection(repositoryId,{status:'QUEUED',operationId,localPath:path.join(options.home,'repositories',repositoryId,'repo')});
        store.enqueue({schemaVersion:1,operationId,repositoryId,operation:'repository.acquire',input:{}});launch(operationId);
      }
      return {...record,connection:store.connection(repositoryId)};
    },
    async detail(repositoryId) {
      const repository = store.repository(id(repositoryId)), context = { root: await repositoryPath(options.home, repositoryId), repository, repositoryId, options, store };
      let connection=store.connection(repositoryId);
      if(connection?.operationId && ['QUEUED','LOADING'].includes(connection.status)) {const op=store.get(connection.operationId);if(op&&['FAILED','CANCELLED','INTERRUPTED'].includes(op.status)){connection={...connection,status:'FAILED',error:op.error};store.setConnection(repositoryId,connection);}}
      const detail = store.draft(repositoryId) ? await draftDetail(context) : await repositoryDetail(options, repository);
      const runs = store.runs(repositoryId), reports = store.reports(repositoryId);
      for (const run of runs) {
        const publication = await safePath(options.home, `executions/${run.id}/publication.json`);
        if (await exists(publication)) run.publication = await readJson(publication);
        else if(run.result.batchId)run.publication=store.regression(repositoryId,run.result.batchId)?.publication;
      }
      const evidence = [...reports, ...runs.filter(x => x.state === 'SEALED').map(x => ({ manifest: x.result }))];
      for (const feature of detail.spec?.features ?? []) {
        feature.tooling = store.check(repositoryId, feature.key);
        feature.verification = currentVerification(feature, detail.modules ?? [], evidence);
        if (feature.verification.status === 'VERIFIED') feature.review.stage = 'VERIFIED';
        else if (feature.review.stage === 'IMPLEMENTATION' && runs.some(r => r.result.requirementId === feature.requirementId && r.result.featureId === feature.id && r.result.baseline === feature.review.hashes.tests && r.result.testedSpecCommit === detail.state?.head)) feature.review.stage = 'VERIFICATION';
      }
      return { ...detail, connection:store.connection(repositoryId), regressions:store.regressions(repositoryId), settingsToken: identity(detail.preferences ?? store.preferences(repositoryId)), preferences: detail.preferences ?? store.preferences(repositoryId), sync: store.syncReceipt(repositoryId), runs, reports, transactions: await listTransactions(options.home, repositoryId), operations: store.operations(repositoryId) };
    },
    async versions(repositoryId, specRef) {
      store.repository(id(repositoryId));const root=await repositoryPath(options.home,repositoryId),git=createGit(options);
      const versions=await revisionOptions(root,git);
      return {versions,...(specRef?await versionCatalog({root,options,repositoryId,git},specRef):{})};
    },
    async versionFile(repositoryId, specRef, relative) {
      store.repository(id(repositoryId));return readVersionFile({root:await repositoryPath(options.home,repositoryId),options,repositoryId,git:createGit(options)},specRef,relative);
    },
    artifactDirectory(repositoryId, runId, reportKey) {
      store.repository(id(repositoryId)); return artifactDirectory({ home: options.home, store, repositoryId, runId, reportKey });
    },
    async projectFiles(repositoryId, projectId) {
      store.repository(id(repositoryId)); const root=await repositoryPath(options.home,repositoryId);
      return store.draft(repositoryId) ? draftProjectFiles({root,options,store,repositoryId},projectId) : projectFiles(root,projectId,createGit(options));
    },
    async readProjectFile(repositoryId, projectId, relative) {
      store.repository(id(repositoryId)); const root=await repositoryPath(options.home,repositoryId);
      return store.draft(repositoryId) ? readDraftFile({root,options,store,repositoryId},relative,projectId,true) : readProjectFile(root,projectId,relative,createGit(options));
    },
    async readFile(repositoryId, relative) { store.repository(id(repositoryId));
      return store.draft(repositoryId) ? readDraftFile({root:await repositoryPath(options.home,repositoryId),options,store,repositoryId},relative) : readRepositoryFile(options.home,repositoryId,relative); },
    async inspect(repositoryId, projectId) {
      store.repository(id(repositoryId)); const git = createGit(options), root = await repositoryPath(options.home, repositoryId);
      if (!projectId) return { ...(await git.diff(root)), remotes: await git.remotes(root) };
      const module = (await git.modules(root)).find(x => x.id === id(projectId));
      invariant(module?.actual, 'PROJECT_NOT_INITIALIZED', 'Project must be initialized');
      return { ...(await git.diff(`${root}/${module.path}`)), remotes: await git.remotes(`${root}/${module.path}`) };
    },
    enqueue(request) {
      invariant(!closing, 'WORKSTATION_CLOSING', 'Workstation is shutting down', 503);
      validateRequest(request); store.repository(request.repositoryId);
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
