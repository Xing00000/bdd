import { validateLocation, managedLocation, checkRepositoryIdentity, remoteIdentity } from './locations.mjs';
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
import { artifactDirectory } from './reports.mjs';
import { projectFiles, readProjectFile } from './repository-actions.mjs';
import { migrateCheckoutDirectory } from './migrate.mjs';
import { listTransactions } from './transactions.mjs';
import { openStore } from './store.mjs';
import { workflowStatus } from './workflow.mjs';
import { workflowState, recordedWorkflow } from './workflow-state.mjs';
import { validateRequest, repositoryDetail, repositoryPath, readRepositoryFile } from './operations.mjs';

export async function createWorkstation(configuration) {
  await mkdir(configuration.home, { recursive: true, mode: 0o700 });
  const options = { autoAcquire: true, allowLocal: false, hosts: ['github.com'], enableExecution: false, ...configuration, home: await realpath(configuration.home) };
  const store = openStore(options.home);
  try { await migrateCheckoutDirectory(options.home); } catch (error) { store.close(); throw error; }
  const children = new Map(),terminalDrafts=new Map(); let closing = false;
  function recordInteraction(repositoryId,operation,input,action) {
    const operationId=`OP-${randomUUID()}`;
    store.enqueue({schemaVersion:1,operationId,repositoryId,operation,input});store.claim(operationId);
    try {const result=action();store.finish(operationId,'SUCCEEDED',result);return {...result,interactionId:operationId};}
    catch(error){store.finish(operationId,'FAILED',undefined,error);throw error;}
  }
  function launch(operationId) {
    if (closing || children.has(operationId) || store.get(operationId)?.status !== 'QUEUED') return;
    const child = spawn(process.execPath, [fileURLToPath(new URL('./worker.mjs', import.meta.url)), JSON.stringify(options), operationId], {
      env: { ...processEnvironment({}, { git: true }), ...((options.browserRoot ?? process.env.PLAYWRIGHT_BROWSERS_PATH) ? { PLAYWRIGHT_BROWSERS_PATH: options.browserRoot ?? process.env.PLAYWRIGHT_BROWSERS_PATH } : {}) },
      detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'pipe', 'ipc']
    });
    children.set(operationId, child); let stderr = '';
    child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-32768); });
    child.once('error', error => store.finish(operationId, 'FAILED', undefined, error));
    child.once('close', () => {
      children.delete(operationId);
      terminalDrafts.delete(operationId);
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
    async agentPreview(repositoryId,input) {
      store.repository(id(repositoryId));
      const root=await repositoryPath(options.home,repositoryId,store);
      const snapshot=await ensureDraft({root,options,store,repositoryId});
      const {previewAgentPrompt}=await import('./agent-task.mjs');
      return previewAgentPrompt(snapshot,repositoryId,root,input);
    },
    async mcpProgress(request) { const { handleProgress } = await import('./mcp-progress.mjs'); return handleProgress(store, options.home, request); },
    async terminal(operationId, offset=0) {
      const operation=this.operation(operationId);
      const { readTerminal }=await import('./development.mjs');
      return {...await readTerminal(options.home,operationId,offset),status:operation.status,result:operation.result,error:operation.error,submitted:operation.request.input};
    },
    terminalInput(operationId, input) {
      const operation=this.operation(operationId),child=children.get(operationId);
      invariant(operation.request.operation==='workflow.develop'&&operation.status==='RUNNING'&&child?.connected,'TERMINAL_UNAVAILABLE','終端已結束或不屬於這個服務。',409);
      invariant(typeof input.data==='string'&&Buffer.byteLength(input.data)<=4096 || input.data===undefined&&Number.isInteger(input.cols)&&input.cols>=20&&input.cols<=300&&Number.isInteger(input.rows)&&input.rows>=5&&input.rows<=150,'INVALID_TERMINAL_INPUT','終端輸入無效。');
      const interactions=[];
      if(typeof input.data==='string') {
        const draft=terminalDrafts.get(operationId)??{text:'',active:null,previousCR:false};let segment='';
        invariant(Buffer.byteLength(draft.text+input.data)<=64*1024,'TERMINAL_INPUT_LIMIT','尚未送出的終端輸入超過上限。');
        for(const char of input.data) {
          segment+=char;
          if(char==='\r'||char==='\n') {
            if(char==='\n'&&draft.previousCR){draft.previousCR=false;continue;}
            const interactionId=`OP-${randomUUID()}`;
            const accepted=store.enqueue({schemaVersion:1,operationId:interactionId,repositoryId:operation.repository_id,operation:'interaction.cli.input',input:{parentOperationId:operationId,message:draft.text}});
            store.claim(interactionId);draft.active=interactionId;draft.text='';draft.previousCR=char==='\r';
            child.send({type:'development.input',data:segment,interactionId},error=>{if(error)store.finish(interactionId,'FAILED',undefined,error);});segment='';interactions.push(accepted);
          } else {draft.previousCR=false;if(char==='\x7f'||char==='\b')draft.text=Array.from(draft.text).slice(0,-1).join('');else draft.text+=char;}
        }
        if(segment)child.send({type:'development.input',data:segment});terminalDrafts.set(operationId,draft);
      } else child.send({type:'development.input',cols:input.cols,rows:input.rows});
      return {sent:true,interactions:interactions.map(op=>store.get(op.id))};
    },
    async requirement(repositoryId, requirementId, featureId) {
      store.repository(id(repositoryId));
      const root=await repositoryPath(options.home,repositoryId,store);
      const snapshot=await ensureDraft({root,options,store,repositoryId});
      const result=await inDraftView(snapshot,view=>readComposer(view,requirementId,featureId));
      return {...result,proposals:store.requirementProposals(repositoryId,result.key)};
    },
    generateRequirement(repositoryId,input) {
      store.repository(id(repositoryId));
      return recordInteraction(repositoryId,'interaction.requirement.generate',input,()=>{
      invariant(typeof input.editorKey==='string'&&/^(?:new-[A-Za-z0-9-]+|[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+)$/.test(input.editorKey)&&input.editorKey.length<=180,'INVALID_EDITOR','需求編輯識別無效。');
      requirementText(input.previousGherkin??'','Gherkin');
      const generated=generateRequirement(input.description);
      const receipt=store.saveRequirementProposal(repositoryId,{...input,previousGherkin:input.previousGherkin??'',gherkin:generated.gherkin});
      return {...generated,...receipt};
      });
    },
    requirementProposals(repositoryId,key) {store.repository(id(repositoryId));return store.requirementProposals(repositoryId,key);},
    importRequirementDocument(repositoryId,input) {store.repository(id(repositoryId));return recordInteraction(repositoryId,'interaction.document.import',input,()=>importRequirementDocument(input));},
    list() { return store.repositories().map(r=>({...r,localPath:r.localPath??managedLocation(options.home,r.id),connection:store.connection(r.id)})); },
    register(input) {
      const repositoryId = id(input.id ?? `SPEC-${randomUUID()}`);
      remoteUrl(input.remoteUrl, options);
      invariant(!store.repositories().some(r => remoteIdentity(r.remoteUrl) === remoteIdentity(input.remoteUrl)), 'REPOSITORY_ALREADY_BOUND', '這個規格庫已綁定，請從左側開啟；本地目錄可在設定修改。', 409);
      if (input.branch) branchName(input.branch);
      invariant(typeof input.title === 'string' && input.title.trim() && input.title.length <= 200, 'INVALID_TITLE', 'Repository title is required');
      const selected=validateLocation(options,repositoryId,input.localPath,store.repositories());
      const record=store.register({ ...input, id: repositoryId,localPath:input.localPath?.trim()?selected:null });
      mkdirSync(path.join(options.home,'repositories',repositoryId),{recursive:true,mode:0o700});
      mkdirSync(path.dirname(selected),{recursive:true,mode:0o700});
      if(options.autoAcquire) {
        const operationId=`OP-${randomUUID()}`;
        store.setConnection(repositoryId,{status:'QUEUED',operationId,localPath:selected});
        store.enqueue({schemaVersion:1,operationId,repositoryId,operation:'repository.acquire',input:{}});launch(operationId);
      }
      return {...record,localPath:selected,connection:store.connection(repositoryId)};
    },
    async detail(repositoryId) {
      const repository = store.repository(id(repositoryId)), context = { root: await repositoryPath(options.home, repositoryId,store), repository, repositoryId, options, store };
      let connection=store.connection(repositoryId);
      if(connection?.operationId && ['QUEUED','LOADING'].includes(connection.status)) {const op=store.get(connection.operationId);if(op&&['FAILED','CANCELLED','INTERRUPTED'].includes(op.status)){connection={...connection,status:'FAILED',error:op.error};store.setConnection(repositoryId,connection);}}
      const detail = (store.draft(repositoryId)||repository.localPath) ? await draftDetail(context) : await repositoryDetail(options, repository);
      const runs = store.runs(repositoryId), reports = store.reports(repositoryId);
      for (const run of runs) {
        const publication = await safePath(options.home, `executions/${run.id}/publication.json`);
        if (await exists(publication)) run.publication = await readJson(publication);
        else if(run.result.batchId)run.publication=store.regression(repositoryId,run.result.batchId)?.publication;
      }
      for (const feature of detail.spec?.features ?? []) {
        feature.tooling = store.check(repositoryId, feature.key);
        feature.workflow=workflowState(feature,detail.modules??[],runs,reports,detail.spec.config.specRepositoryId);
        feature.workflow.portableState=await recordedWorkflow(context.root,feature,feature.workflow).catch(()=>({state:'NOT_EXPORTED'}));
        feature.verification={status:feature.workflow.verification,...(feature.workflow.latestReport?{runId:feature.workflow.latestReport.runId,testedSpecCommit:feature.workflow.latestReport.testedSpecCommit}:{})};
        feature.review.stage=feature.workflow.stage;
      }
      return { ...detail, localPath:context.root, connection:store.connection(repositoryId), regressions:store.regressions(repositoryId), settingsToken: identity(detail.preferences ?? store.preferences(repositoryId)), preferences: detail.preferences ?? store.preferences(repositoryId), sync: store.syncReceipt(repositoryId), runs, reports, transactions: await listTransactions(options.home, repositoryId), operations: store.operations(repositoryId) };
    },
    async workflow(repositoryId, selection) {
      store.repository(id(repositoryId));
      return workflowStatus({root:await repositoryPath(options.home,repositoryId,store),repositoryId,options,store},selection);
    },
    async versions(repositoryId, specRef) {
      store.repository(id(repositoryId));const root=await repositoryPath(options.home,repositoryId,store),git=createGit(options);
      await checkRepositoryIdentity(root,store.repository(repositoryId),git);
      const versions=await revisionOptions(root,git);
      return {versions,...(specRef?await versionCatalog({root,options,repositoryId,git},specRef):{})};
    },
    async versionFile(repositoryId, specRef, relative) {
      const record=store.repository(id(repositoryId)),root=await repositoryPath(options.home,repositoryId,store),git=createGit(options);
      await checkRepositoryIdentity(root,record,git);return readVersionFile({root,options,repositoryId,git},specRef,relative);
    },
    artifactDirectory(repositoryId, runId, reportKey) {
      store.repository(id(repositoryId)); return artifactDirectory({ home: options.home, store, repositoryId, runId, reportKey });
    },
    async projectFiles(repositoryId, projectId) {
      store.repository(id(repositoryId)); const root=await repositoryPath(options.home,repositoryId,store);
      return (store.draft(repositoryId)||store.repository(repositoryId).localPath) ? draftProjectFiles({root,options,store,repositoryId},projectId) : projectFiles(root,projectId,createGit(options));
    },
    async readProjectFile(repositoryId, projectId, relative) {
      store.repository(id(repositoryId)); const root=await repositoryPath(options.home,repositoryId,store);
      return (store.draft(repositoryId)||store.repository(repositoryId).localPath) ? readDraftFile({root,options,store,repositoryId},relative,projectId,true) : readProjectFile(root,projectId,relative,createGit(options));
    },
    async readFile(repositoryId, relative) { store.repository(id(repositoryId));
      return (store.draft(repositoryId)||store.repository(repositoryId).localPath) ? readDraftFile({root:await repositoryPath(options.home,repositoryId,store),options,store,repositoryId},relative) : readRepositoryFile(options.home,repositoryId,relative,store.repository(repositoryId)); },
    async inspect(repositoryId, projectId) {
      store.repository(id(repositoryId)); const git = createGit(options), root = await repositoryPath(options.home, repositoryId,store);
      await checkRepositoryIdentity(root,store.repository(repositoryId),git);
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
    interactions(repositoryId,query) {store.repository(id(repositoryId));return store.interactions(repositoryId,query);},
    interaction(operationId){return store.interaction(id(operationId));},
    async wait(operationId, timeoutMs = 60000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const operation = this.operation(operationId);
        if (!['QUEUED', 'RUNNING', 'CANCELLING'].includes(operation.status)) return operation;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error('Operation wait timed out; the durable job may still be running');
    },
    cancel(operationId,{record=true}={}) {
      const operation = this.operation(operationId), child = children.get(operation.id);
      if(record){const value=recordInteraction(operation.repository_id,'interaction.cancel',{parentOperationId:operationId,message:'停止作業'},()=>this.cancel(operationId,{record:false}));return {...value,interaction:store.get(value.interactionId)};}
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
        if (['QUEUED', 'RUNNING'].includes(operation.status)) this.cancel(operationId,{record:false});
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
