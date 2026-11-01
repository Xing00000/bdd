import { repositoryPath, changeLocation } from './locations.mjs';
export { repositoryPath } from './locations.mjs';
import { acquireRepository, moreReportHistory } from './catalog.mjs';
import { runRegression } from './regression.mjs';
import { workflowStatus, persistWorkflowState } from './workflow.mjs';
import { localAuthoring, editDraft } from './authoring.mjs';
import { prepareProjection, captureExecutionFiles, captureSynchronized } from './projection.mjs';
import { flowNames, advanceWorkflow, synchronizeRepository } from './flows.mjs';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createGit } from '../git-core/index.mjs';
import { id, version, invariant, safePath, exists, writeJson, digest } from '../contracts/index.mjs';
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
import { generateTestSkeleton } from './test-plan-codegen.mjs';
import { prepareRepositoryTools } from './repository-tools.mjs';

export const operationNames = Object.freeze([
  ...flowNames, 'repository.tools.prepare', 'workflow.tests.generate', 'workflow.tests.complete', 'workflow.develop', 'workflow.next', 'repository.location', 'repository.acquire', 'repository.history.more', 'regression.start',
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
  invariant(!Object.keys(request).some(k => !['schemaVersion', 'operationId', 'repositoryId', 'operation', 'expected', 'input', 'target'].includes(k)), 'UNKNOWN_REQUEST_FIELD', 'Unknown operation request field', 400);
  if (request.target) {
    invariant(['spec', 'project'].includes(request.target.kind), 'INVALID_TARGET', 'Target kind must be spec or project');
    if (request.target.kind === 'project') id(request.target.projectId);
  }
  validateContract('operation', request);
  return request;
}
export async function executeOperation(options, store, request) {
  validateRequest(request);
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
    if (localAuthoring(request)) {
      for(let attempt=0;;attempt++) {
        try { return await editDraft(context); }
        catch(error) { if(error.code!=='DRAFT_REVISION_CHANGED'||attempt>=2)throw error; }
      }
    }
    // Saves are already durable. Only explicit reads/execution/sync need a Git projection.
    if (request.operation === 'workflow.verify' || request.operation === 'workflow.review') {
      const { ensureDraft, inDraftView } = await import('./authoring.mjs');
      const snapshot = await ensureDraft({ ...context, repositoryId: request.repositoryId });
      if (request.operation === 'workflow.verify') await inDraftView(snapshot, async view => {
        const review = await reviewState(view,input.requirementId,input.featureId);
        invariant(Object.values(review.confirmed).every(Boolean),'REVIEWS_REQUIRED','請先確認需求、設計與測試。',409);
      });
      invariant(enableExecution,'EXECUTION_DISABLED','內容已儲存；主機尚未啟用測試執行。',403);
    }
    if(request.operation==='repository.sync')await persistWorkflowState(context);
    const snapshot = await prepareProjection(context);
    if (request.operation === 'repository.prepare') return { prepared: true, revision: snapshot.revision };
    const projected = { ...context, request: { ...request, expected: await git.inspect(root) } };
    if (request.operation === 'repository.sync') {
      const receipt = await synchronizeRepository(projected);
      receipt.sourceRevision = await captureSynchronized(context,snapshot); store.setSyncReceipt(request.repositoryId,receipt);
      return receipt;
    }
    let output, failure;
    try { output = await advanceWorkflow(projected); } catch (error) { failure = error; }
    try { await captureExecutionFiles(context,snapshot); } catch(error) { failure ??= error; }
    if(!failure)await persistWorkflowState(context);
    if(failure) { failure.details = { ...failure.details, saved: true, storage: 'sqlite' }; throw failure; }
    return output;
  }
  if (request.operation === 'repository.clone') return git.clone(workspace.remoteUrl, root, workspace.branch ?? undefined);
  await git.root(root);
  if (request.operation === 'project.file.save') return saveProjectFile(root, input, git, request.expected);
  let target = root;
  if (request.target?.kind === 'project') {
    const config = await configuration(root), project = config.projects.find(x => x.id === request.target.projectId);
    invariant(project && (await git.modules(root)).some(x => x.id === project.id && x.actual), 'PROJECT_NOT_INITIALIZED', 'Select an initialized registered project');
    target = await safePath(root, project.path);
    invariant(request.operation.startsWith('git.'), 'TARGET_NOT_ALLOWED', 'Project targets only accept Git operations');
  }
  if (!['repository.validate', 'run.execute', 'run.publish', 'reports.reindex', 'repository.upgrade.preview', 'legacy.preview'].includes(request.operation)) await git.expect(target, request.expected);
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
    case 'repository.initialize':
      return initialize(root, { specRepositoryId: input.specRepositoryId ?? workspace.id,
        toolkitRoot: path.join(toolkitRoot, 'packages'), templateRoot: path.join(toolkitRoot, 'templates/spec-repo/v1') });
    case 'repository.validate': return validate(root, git, { pinned: Boolean(input.pinned) });
    case 'repository.browsers.install': return installBrowsers(root, enableExecution, options.browserRoot ?? process.env.PLAYWRIGHT_BROWSERS_PATH);
    case 'repository.dependencies.install': return installDependencies(root, enableExecution);
    case 'spec.tests.check': return checkTests(root, input, store, workspace.id, enableExecution);
    case 'spec.feature.configure': return configureFeature(root, input);
    case 'spec.execution.configure': return configureExecution(root, input);
    case 'spec.feature.create': return createFeature(root, input);
    case 'spec.file.save': return saveFile(root, input);
    case 'spec.review.confirm': {
      if (input.stage === 'tests') {
        const review = await reviewState(root, input.requirementId, input.featureId);
        const check = store.check(workspace.id, `${input.requirementId}/${input.featureId}`);
        invariant(check?.status === 'CHECKED' && check.digest === review.hashes.tests, 'TEST_CHECK_REQUIRED', 'Run test discovery for the current inputs before confirming tests', 409);
      }
      return confirm(root, input);
    }
    case 'git.remote': {
      const result = await git.configureRemote(target, input, request.expected);
      if (target === root && input.name === 'origin' && input.action !== 'remove') store.updateOrigin(workspace.id, input.url);
      return result;
    }
    case 'git.fetch': return git.fetch(target, input);
    case 'git.branch': return git.branch(target, input, request.expected);
    case 'git.commit': return git.commitSelected(target, input, request.expected);
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
export async function repositoryDetail(options, workspace) {
  const root = await repositoryPath(options.home, workspace.id, workspace), git = createGit(options);
  if (!await exists(root)) return { ...workspace, state: 'NOT_CLONED', initialized: false };
  const state = await git.inspect(root), remotes = await git.remotes(root);
  if (!await exists(await safePath(root, 'workbench.yaml'))) return { ...workspace, state, remotes, initialized: false };
  let spec, specError;
  try {
    spec = await scan(root);
    spec.features = await Promise.all(spec.features.map(async feature => ({ ...feature, review: await reviewState(root, feature.requirementId, feature.id) })));
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
