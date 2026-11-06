import {agentOperations} from './agent-catalog.mjs';
import { repositoryPath, changeLocation } from './locations.mjs';
export { repositoryPath } from './locations.mjs';
import { acquireRepository, moreReportHistory } from './catalog.mjs';
import { runRegression } from './regression.mjs';
import { workflowStatus, persistWorkflowState } from './workflow.mjs';
import { localAuthoring, editDraft, ensureDraft, sourceFiles } from './authoring.mjs';
import { prepareProjection, checkpointProjection, captureExecutionFiles } from './projection.mjs';
import { flowNames, advanceWorkflow, synchronizeRepository } from './flows.mjs';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createGit } from '../git-core/index.mjs';
import { id, version, invariant, safePath, exists, writeJson, readJson, digest, identity } from '../contracts/index.mjs';
import { initialize, createFeature, validate, configuration, confirm, saveFile, scan, reviewState } from '../spec-toolkit/index.mjs';
import { projectRoot, saveProjectFile, configureFeature, configureExecution, installDependencies, installBrowsers, checkTests } from './repository-actions.mjs';
import { planUpgrade } from './upgrades.mjs';
import { planLegacyImport, backupLegacySelection } from './legacy.mjs';
import { publicPlan, applyPlan, resumePlan } from './transactions.mjs';
import { reindexReports } from './reports.mjs';
import { prepareRun, executeRun, publishRun } from '../spec-toolkit/engine.mjs';

import { validateContract } from '../contracts/schemas.mjs';

import { runDevelopment } from './development.mjs';
import { generateTestPlan } from './test-plan.mjs';
import {generateDesign} from './design-generation.mjs';
import {generateGherkin} from './gherkin-generation.mjs';
import { generateTestSkeleton } from './test-plan-codegen.mjs';
import {readAcceptance} from './acceptance.mjs';
import {readFeedback} from './feedback.mjs';
import {requirementText} from './requirements.mjs';
import { prepareRepositoryTools } from './repository-tools.mjs';

export const operationNames = Object.freeze([
  ...flowNames, 'repository.tools.prepare', 'workflow.gherkin.generate', 'workflow.design.generate', 'workflow.tests.generate', 'workflow.tests.complete', 'workflow.develop', 'workflow.next', 'repository.location', 'repository.acquire', 'repository.history.more', 'regression.start',
  'repository.clone', 'repository.initialize', 'repository.validate',
  'repository.upgrade.preview', 'repository.upgrade.apply', 'repository.transaction.resume',
  'legacy.preview', 'legacy.import', 'reports.reindex',
  'spec.feature.create', 'spec.feature.configure', 'spec.execution.configure', 'spec.file.save', 'spec.review.confirm',
  'repository.dependencies.install', 'repository.browsers.install', 'spec.tests.check', 'project.file.save', 'git.remote',
  'git.fetch', 'git.branch', 'git.commit', 'git.push',
  'submodule.add', 'submodule.restore', 'submodule.pin', 'submodule.remove',
  'run.prepare', 'run.execute', 'run.publish'
]);
export function validateRequest(request) {
  version(request); id(request.operationId, 'operationId'); id(request.repositoryId, 'repositoryId');
  invariant(operationNames.includes(request.operation), 'OPERATION_NOT_ALLOWED', 'Choose a documented workstation operation', 400);
  invariant(request.input && typeof request.input === 'object' && !Array.isArray(request.input), 'INVALID_INPUT', 'input must be an object', 400);
  invariant(!Object.keys(request).some(k => !['schemaVersion', 'operationId', 'repositoryId', 'operation', 'expected', 'input', 'target','interactionType'].includes(k)), 'UNKNOWN_REQUEST_FIELD', 'Unknown operation request field', 400);
  if (request.target) {
    invariant(['spec', 'project'].includes(request.target.kind), 'INVALID_TARGET', 'Target kind must be spec or project');
    if (request.target.kind === 'project') id(request.target.projectId);
  }
  validateContract('operation', request);
  return request;
}
export async function executeOperation(options, store, request) {
  validateRequest(request);
  if(agentOperations[request.operation]&&request.input.agentSelection&&!request.input.agentSnapshot)request={...request,input:{...request.input,agentSnapshot:store.resolveAgent(request.repositoryId,agentOperations[request.operation],request.input.agentSelection)}};
  const { home, toolkitRoot, allowLocal = false, hosts = ['github.com'], enableExecution = false } = options;
  const workspace = store.repository(request.repositoryId), root = await repositoryPath(home, workspace.id, store);
  const git = createGit({ allowLocal, hosts }), input = request.input;
  if(request.operation==='repository.upgrade.preview') {
    const {ensureDraft,inDraftView}=await import('./authoring.mjs');
    const snapshot=await ensureDraft({root,options,store,repositoryId:request.repositoryId});
    return inDraftView(snapshot,async view=>publicPlan(await planUpgrade(view,toolkitRoot)));
  }
  if(request.operation==='repository.upgrade.apply')return editDraft({root,options,store,request,git});
  if(request.operation==='repository.tools.prepare')return prepareRepositoryTools({root,options,store,request,git});
  if(request.operation==='workflow.design.generate')return generateDesign({root,options,store,request,git});
  if(request.operation==='workflow.gherkin.generate')return generateGherkin({root,options,store,request,git});
  if(request.operation==='workflow.tests.generate')return generateTestSkeleton({root,options,store,request,git});
  if(request.operation==='workflow.tests.complete')return generateTestPlan({root,options,store,request,git});
  if(request.operation==='workflow.review'&&input.stage==='sd') {
    await editDraft({root,options,store,request,git});
    return generateTestSkeleton({root,options,store,request,git});
  }
  if(request.operation==='repository.location') return changeLocation({root,options,store,request,git});
  if(request.operation==='repository.acquire') {const result=await acquireRepository({root,options,store,request,git});await persistWorkflowState({root,options,store,request,git});return result;}
  if(request.operation==='repository.history.more') return moreReportHistory({root,options,store,request,git});
  if(request.operation==='regression.start') {const result=await runRegression({root,options,store,request,git});await persistWorkflowState({root,options,store,request,git});return result;}
  if(request.operation==='workflow.develop') return runDevelopment({root,options,store,request,git}, verificationInput => executeOperation(options,store,{...request,operation:'workflow.verify',input:verificationInput}));
  if(request.operation==='workflow.next') {
    const selection=`${id(input.requirementId)}/${id(input.featureId)}`;
    const status=await workflowStatus({root,options,store,request,git},selection);
    invariant(status.configured,'SETUP_REQUIRED','請先儲存一次性設定。');
    const workflow=status.workflows[0];
    if(workflow.status!=='READY_TO_RUN')return {...workflow,advanced:false};
    return executeOperation(options,store,{...request,operation:'workflow.verify'});
  }
  if (flowNames.includes(request.operation)) {
    const context = { root, options, store, request, git };
    const createsFeature = request.operation === 'workflow.create' || request.operation === 'workflow.requirement.save' && !input.requirementId && !input.featureId;
    if (createsFeature || request.operation === 'workflow.accept') {
      const creationEditorKey=createsFeature?(input.editorKey??(input.requirementId&&input.featureId?`feature:${input.requirementId}/${input.featureId}`:null)):null;
      const pendingCreation=creationEditorKey?store.creationReceipt(request.repositoryId,creationEditorKey):null;
      if(pendingCreation&&store.projection(request.repositoryId)?.checkpointRevision>=pendingCreation.revision) {
        invariant(pendingCreation.creationInputDigest===identity(input),'CREATION_ALREADY_EXISTS','此編輯草稿已建立功能；請開啟原功能繼續編輯。',409);
        const checkpoint=store.projection(request.repositoryId);
        return {...pendingCreation,checkpoint:{revision:checkpoint.checkpointRevision,head:checkpoint.head},creationRetry:true};
      }
      if (createsFeature && (store.connection(request.repositoryId)?.validatedPath !== root || !await exists(root))) {
        const snapshot=await ensureDraft({...context,repositoryId:request.repositoryId});
        invariant(snapshot.settings.configured,'SETUP_REQUIRED','請先儲存基本設定；不需要先連線遠端。');
        // Save the unallocated creation input before importing remote IDs. Durable
        // jobs already retain the complete request; composer text is also available
        // through the existing proposal history when acquisition fails.
        let saved=Boolean(store.get(request.operationId)), proposal;
        if(request.operation==='workflow.requirement.save') {
          const description=requirementText(input.description,'需求描述'),gherkin=requirementText(input.gherkin,'Gherkin');
          invariant(description.trim()||gherkin.trim(),'EMPTY_REQUIREMENT','請先填寫需求描述或 Gherkin。');
          invariant(input.expectedToken===null,'CONTENT_CHANGED','新需求尚未儲存，請重新讀取編輯畫面。',409);
          const editorKey=input.editorKey??`new-${request.operationId}`;
          invariant(/^new-[A-Za-z0-9-]+$/.test(editorKey)&&editorKey.length<=180,'INVALID_EDITOR','新需求編輯識別無效。');
          proposal={editorKey,...store.saveRequirementProposal(request.repositoryId,{editorKey,description,previousGherkin:gherkin,gherkin,creationOperationId:request.operationId})};
          saved=true;
        }
        try { await acquireRepository({ ...context, lifecycleBoundary: 'CREATE_FEATURE' }); }
        catch(error) { error.details={...error.details,saved,...(saved?{storage:'sqlite',draftOperationId:request.operationId}:{}),creationPending:true,...proposal};throw error; }
      }
      let result;
      if(pendingCreation&&request.operation==='workflow.create') {
        invariant(pendingCreation.creationInputDigest===identity(input),'CREATION_ALREADY_EXISTS','此建立操作已有已儲存草稿；請以相同內容重試初始化，再開啟原功能編輯。',409);
        result=pendingCreation;
      } else {
        const editingContext=pendingCreation?{...context,creationInput:{...input,requirementId:pendingCreation.requirementId,featureId:pendingCreation.featureId,expectedToken:pendingCreation.token}}:context;
        result=await editDraft({...editingContext,...(creationEditorKey?{creationEditorKey,creationInputDigest:identity(input)}:{})});
      }
      try {
      const acceptedRun = request.operation === 'workflow.accept' ? store.runs(request.repositoryId).find(run => run.id === input.runId && run.state === 'SEALED') : undefined;
      const acceptedManifest = request.operation === 'workflow.accept' ? acceptedRun?.result ?? store.reports(request.repositoryId).find(report => report.runId === input.runId && report.requirementId === input.requirementId && report.featureId === input.featureId)?.manifest : undefined;
      const snapshot = await checkpointProjection({ ...context, expectedRevision: result.revision, ...(request.operation === 'workflow.accept' ? { acceptance: result.acceptance, acceptedManifest } : {}) }), checkpoint = store.projection(request.repositoryId);
      let publication;
      if (request.operation === 'workflow.accept') {
        if (acceptedRun) {
          const planFile = await safePath(home, `executions/${id(input.runId)}/plan.json`), plan = await readJson(planFile);
          if (plan.sourceKind === 'WORKSPACE') await writeJson(planFile, { ...plan, acceptedSpecCommit: checkpoint.head });
          publication = await publishRun({ root, home, repositoryId: request.repositoryId, runId: input.runId, git, push: false });
        }
        store.completeAcceptanceCheckpoint(request.repositoryId, snapshot.revision, result.acceptance.id);
      }
      return { ...result, ...(request.operation === 'workflow.accept' ? { status: 'COMPLETE', nextStage: 'VERIFIED' } : {}), revision: snapshot.revision, checkpoint: { revision: checkpoint.checkpointRevision, head: checkpoint.head }, ...(publication ? { publication } : {}) };
      } catch(error) {
        if(createsFeature)error.details={...error.details,saved:true,storage:'sqlite',creationPending:true,featureCreated:true,key:result.key,
          requirementId:result.requirementId??result.key?.split('/')[0],featureId:result.featureId??result.key?.split('/')[1],editorKey:input.editorKey,revision:result.revision};
        throw error;
      }
    }
    if (localAuthoring(request)) {
      for(let attempt=0;;attempt++) {
        try { return await editDraft(context); }
        catch(error) { if(error.code!=='DRAFT_REVISION_CHANGED'||attempt>=2)throw error; }
      }
    }
    // Intermediate review and execution materialize saved files without invoking Git.
    if (request.operation === 'workflow.verify' || request.operation === 'workflow.review') {
      const { ensureDraft, inDraftView } = await import('./authoring.mjs');
      const snapshot = await ensureDraft({ ...context, repositoryId: request.repositoryId });
      if (request.operation === 'workflow.verify') await inDraftView(snapshot, async view => {
        const review = await reviewState(view,input.requirementId,input.featureId);
        invariant(Object.values(review.confirmed).every(Boolean),'REVIEWS_REQUIRED','請先確認需求、設計與測試。',409);
      });
      invariant(enableExecution,'EXECUTION_DISABLED','內容已儲存；主機尚未啟用測試執行。',403);
    }
    if (request.operation === 'repository.sync') {
      const checkpoint = store.projection(request.repositoryId), draft = store.draft(request.repositoryId);
      invariant(checkpoint?.checkpointKind === 'ACCEPTED' && checkpoint.checkpointRevision === draft?.revision, 'ACCEPTANCE_CHECKPOINT_REQUIRED', '目前有尚未完成驗收的變更；請完成驗收後再同步。草稿已保留，未建立 Git 版本。', 409);
      const receipt = await synchronizeRepository({ ...context, request: { ...request, expected: { head: checkpoint.head, branch: checkpoint.branch } } });
      receipt.sourceRevision = checkpoint.checkpointRevision; store.setSyncReceipt(request.repositoryId, receipt); return receipt;
    }
    const snapshot = await prepareProjection(context);
    if (request.operation === 'repository.prepare') return { prepared: true, revision: snapshot.revision };
    let output, failure;
    try { output = await advanceWorkflow(context); } catch (error) { failure = error; }
    try { await captureExecutionFiles(context,snapshot); } catch(error) { failure ??= error; }
    if(!failure)await persistWorkflowState(context);
    if(failure) { failure.details = { ...failure.details, saved: true, storage: 'sqlite' }; throw failure; }
    return output;
  }
  if (request.operation === 'repository.clone') {
    const state = await git.clone(workspace.remoteUrl, root, workspace.branch ?? undefined);
    store.setProjection(request.repositoryId, { ...store.projection(request.repositoryId), head: state.head, branch: state.branch });
    return state;
  }
  const fileOnly = ['project.file.save','spec.file.save','spec.review.confirm','spec.feature.configure','spec.execution.configure','repository.dependencies.install','repository.browsers.install','spec.tests.check'].includes(request.operation);
  if (!fileOnly) await git.root(root);
  if (request.operation === 'project.file.save') return saveProjectFile(root, input);
  let target = root;
  if (request.target?.kind === 'project') {
    const config = await configuration(root), project = config.projects.find(x => x.id === request.target.projectId);
    invariant(project && (await git.modules(root)).some(x => x.id === project.id && x.actual), 'PROJECT_NOT_INITIALIZED', 'Select an initialized registered project');
    target = await safePath(root, project.path);
    invariant(request.operation.startsWith('git.'), 'TARGET_NOT_ALLOWED', 'Project targets only accept Git operations');
  }
  if (!fileOnly && !['repository.validate', 'run.execute', 'run.publish', 'reports.reindex', 'repository.upgrade.preview', 'legacy.preview'].includes(request.operation)) await git.expect(target, request.expected);
  switch (request.operation) {
    case 'repository.transaction.resume': {
      const state = await git.inspect(root);
      return resumePlan({ root, home, repositoryId: workspace.id, transactionId: input.transactionId, sourceHead: state.head });
    }
    case 'legacy.preview': return publicPlan((await planLegacyImport(root, options, input.requirementIds)).plan);
    case 'legacy.import': {
      invariant(input.acknowledgeUnverified === true, 'LEGACY_ACK_REQUIRED', 'Acknowledge that archived tests and reports are not current verification');
      const state = await git.expect(root, request.expected, { clean: true });
      const { plan, snapshot } = await planLegacyImport(root, options, input.requirementIds);
      invariant(plan.digest === input.planDigest, 'PLAN_CHANGED', 'Legacy source or destination changed after preview', 409);
      await backupLegacySelection(home, snapshot);
      return applyPlan({ root, home, repositoryId: workspace.id, transactionId: request.operationId, plan, expectedDigest: input.planDigest, sourceHead: state.head });
    }
    case 'reports.reindex': {const result=await reindexReports({ root, home, repositoryId: workspace.id, git, store, refs: input.refs });await persistWorkflowState({root,options,store,request,git});return result;}
    case 'repository.initialize': {
      const result = await initialize(root, { specRepositoryId: input.specRepositoryId ?? workspace.id,
        toolkitRoot: path.join(toolkitRoot, 'packages'), templateRoot: path.join(toolkitRoot, 'templates/spec-repo/v1') });
      await mirrorLegacySources({root,options,store,request}); return result;
    }
    case 'repository.validate': return validate(root, git, { pinned: Boolean(input.pinned) });
    case 'repository.browsers.install': return installBrowsers(root, enableExecution, options.browserRoot ?? process.env.PLAYWRIGHT_BROWSERS_PATH);
    case 'repository.dependencies.install': return installDependencies(root, enableExecution);
    case 'spec.tests.check': return checkTests(root, input, store, workspace.id, enableExecution);
    case 'spec.feature.configure': return configureFeature(root, input);
    case 'spec.execution.configure': return configureExecution(root, input);
    case 'spec.feature.create': {const result=await createFeature(root,input);await mirrorLegacySources({root,options,store,request});return result;}
    case 'spec.file.save': {const result=await saveFile(root,input);await mirrorLegacySources({root,options,store,request});return result;}
    case 'spec.review.confirm': {
      if (input.stage === 'tests') {
        const review = await reviewState(root, input.requirementId, input.featureId);
        const check = store.check(workspace.id, `${input.requirementId}/${input.featureId}`);
        invariant(check?.status === 'CHECKED' && check.digest === review.hashes.tests, 'TEST_CHECK_REQUIRED', 'Run test discovery for the current inputs before confirming tests', 409);
      }
      const result = await confirm(root, input); await mirrorLegacySources({root,options,store,request}); return result;
    }
    case 'git.remote': {
      const result = await git.configureRemote(target, input, request.expected);
      if (target === root && input.name === 'origin' && input.action !== 'remove') store.updateOrigin(workspace.id, input.url);
      return result;
    }
    case 'git.fetch': return git.fetch(target, input);
    case 'git.branch': {const state=await git.branch(target,input,request.expected);if(target===root)store.setProjection(workspace.id,{...store.projection(workspace.id),head:state.head,branch:state.branch});return state;}
    case 'git.commit': {const state=await git.commitSelected(target,input,request.expected);if(target===root)store.setProjection(workspace.id,{...store.projection(workspace.id),head:state.head,branch:state.branch});return state;}
    case 'git.push': return git.push(target, input, request.expected);
    case 'submodule.restore': return git.restore(root, request.expected);
    case 'submodule.add': {
      const config = await configuration(root);
      invariant(!config.projects.some(x => x.id === input.projectId), 'PROJECT_EXISTS', 'Project already exists', 409);
      const commit = input.commit || await git.remoteHead(input.url, input.ref ?? 'main');
      const modules = await git.addModule(root, { ...input, commit }, request.expected);
      config.projects.push({ id: input.projectId, path: `projects/${input.projectId}` });
      await writeJson(await safePath(root, 'workbench.yaml'), config);
      return { modules, committed: false, paths: ['.gitmodules', 'workbench.yaml', `projects/${input.projectId}`] };
    }
    case 'submodule.pin': {
      const commit = input.commit || await git.resolve(await projectRoot(root, input.projectId, git));
      return git.pin(root, { ...input, commit }, request.expected);
    }
    case 'submodule.remove': {
      const projectId = id(input.projectId), data = await scan(root);
      invariant(!data.features.some(f => f.projectIds.includes(projectId)), 'PROJECT_IN_USE', 'A feature still references this project', 409);
      const project = (await git.modules(root)).find(x => x.id === projectId);
      invariant(project, 'PROJECT_NOT_FOUND', 'Unknown project', 404);
      await git.expect(root, request.expected, { clean: true });
      invariant(!project.dirty && (!project.actual || project.actual === project.commit), 'DIRTY_SUBMODULE', 'Project must be clean at its pinned commit');
      await git.command(root, ['rm', '--', project.path]);
      data.config.projects = data.config.projects.filter(x => x.id !== projectId);
      await writeJson(await safePath(root, 'workbench.yaml'), data.config);
      return { removed: projectId, committed: false, remoteDeleted: false };
    }
    case 'run.prepare': {
      const result = await prepareRun({ root, home, repositoryId: workspace.id, input: { ...input, expected: request.expected }, git });
      store.recordRun(workspace.id, result, 'PREPARED'); return result;
    }
    case 'run.execute': {
      const result = await executeRun({ home, repositoryId: workspace.id, runId: input.runId, git, enabled: enableExecution });
      store.recordRun(workspace.id, result, 'SEALED'); return result;
    }
    case 'run.publish': {
      invariant(input.push === undefined || typeof input.push === 'boolean', 'INVALID_PUSH', 'push must be boolean');
      const result = await publishRun({ root, home, repositoryId: workspace.id, runId: input.runId, git, push: input.push === true });
      return result;
    }
  }
}
/** Explicit legacy file APIs update the same read model without Git during reads. */
async function mirrorLegacySources(context) {
  const { root, store, request } = context, snapshot = await ensureDraft({ ...context, repositoryId: request.repositoryId });
  const files = (await sourceFiles(root)).filter(file => !snapshot.files.some(previous => previous.target === file.target && previous.path === file.path && previous.sha256 === digest(file.content)));
  if (files.length) store.saveDraft(request.repositoryId, { expectedRevision: snapshot.revision, files,
    operationId: `legacy-${request.operationId}`, request: { operation: request.operation, sourceRevision: snapshot.revision }, result: { imported: true } });
}
export async function repositoryDetail(options, workspace) {
  const root = await repositoryPath(options.home, workspace.id, workspace), git = createGit(options);
  if (!await exists(root)) return { ...workspace, state: 'NOT_CLONED', initialized: false };
  const state = await git.inspect(root), remotes = await git.remotes(root);
  if (!await exists(await safePath(root, 'workbench.yaml'))) return { ...workspace, state, remotes, initialized: false };
  let spec, specError;
  try {
    spec = await scan(root);
    spec.features = await Promise.all(spec.features.map(async feature => ({ ...feature, review: await reviewState(root, feature.requirementId, feature.id),feedback:await readFeedback(root,feature.key),acceptance:await readAcceptance(root,feature.requirementId,feature.id) })));
  } catch (error) { specError = { code: error.code, message: error.message }; }
  let modules = [], moduleError;
  try { modules = await git.modules(root); } catch (error) { moduleError = { code: error.code, message: error.message }; }
  return { ...workspace, state, remotes, initialized: true, spec, specError, modules, moduleError, dependencies: { installed: await exists(path.join(root, 'node_modules/.bin/bddgen')), locked: await exists(path.join(root, 'package-lock.json')) } };
}
export async function readRepositoryFile(home, repositoryId, relative, record) {
  invariant(/^(spec|tests)\//.test(relative) || ['workbench.yaml', 'bdd.config.ts', 'playwright.config.ts', 'package.json', 'package-lock.json'].includes(relative), 'FILE_NOT_READABLE', 'Only source/configuration files are exposed', 403);
  const root = await repositoryPath(home, repositoryId, record), file = await safePath(root, relative, { missing: false }), bytes = await readFile(file);
  invariant(bytes.length <= 2 * 1024 * 1024, 'FILE_TOO_LARGE', 'Editor limit is 2 MiB');
  return { path: relative, content: bytes.toString('utf8'), sha256: digest(bytes) };
}
