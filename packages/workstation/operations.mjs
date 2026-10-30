import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createGit, remoteUrl } from '../git-core/index.mjs';
import { id, version, invariant, safePath, exists, writeJson, readJson, digest } from '../contracts/index.mjs';
import { initialize, createFeature, validate, configuration, confirm, saveFile, scan, reviewState } from '../spec-toolkit/index.mjs';
import { prepareRun, executeRun, publishRun } from '../spec-toolkit/engine.mjs';

import { validateContract } from '../contracts/schemas.mjs';

export const operationNames = Object.freeze([
  'workspace.clone', 'workspace.initialize', 'workspace.validate',
  'spec.feature.create', 'spec.file.save', 'spec.review.confirm',
  'git.fetch', 'git.branch', 'git.commit', 'git.push',
  'submodule.add', 'submodule.restore', 'submodule.pin', 'submodule.remove',
  'run.prepare', 'run.execute', 'run.publish'
]);
export function validateRequest(request) {
  version(request); id(request.operationId, 'operationId'); id(request.workspaceId, 'workspaceId');
  invariant(operationNames.includes(request.operation), 'OPERATION_NOT_ALLOWED', 'Choose a documented workstation operation', 400);
  invariant(request.input && typeof request.input === 'object' && !Array.isArray(request.input), 'INVALID_INPUT', 'input must be an object', 400);
  invariant(!Object.keys(request).some(k => !['schemaVersion', 'operationId', 'workspaceId', 'operation', 'expected', 'input', 'target'].includes(k)), 'UNKNOWN_REQUEST_FIELD', 'Unknown operation request field', 400);
  if (request.target) {
    invariant(['spec', 'project'].includes(request.target.kind), 'INVALID_TARGET', 'Target kind must be spec or project');
    if (request.target.kind === 'project') id(request.target.projectId);
  }
  validateContract('operation', request);
  return request;
}
export async function repositoryPath(home, workspaceId) { return safePath(home, `workspaces/${id(workspaceId)}/repo`); }
export async function executeOperation(options, store, request) {
  validateRequest(request);
  const { home, toolkitRoot, allowLocal = false, hosts = ['github.com'], enableExecution = false } = options;
  const workspace = store.workspace(request.workspaceId), root = await repositoryPath(home, workspace.id);
  const git = createGit({ allowLocal, hosts }), input = request.input;
  if (request.operation === 'workspace.clone') return git.clone(workspace.remoteUrl, root, workspace.branch ?? undefined);
  await git.root(root);
  let target = root;
  if (request.target?.kind === 'project') {
    const config = await configuration(root), project = config.projects.find(x => x.id === request.target.projectId);
    invariant(project && (await git.modules(root)).some(x => x.id === project.id && x.actual), 'PROJECT_NOT_INITIALIZED', 'Select an initialized registered project');
    target = await safePath(root, project.path);
    invariant(request.operation.startsWith('git.'), 'TARGET_NOT_ALLOWED', 'Project targets only accept Git operations');
  }
  if (!['workspace.validate', 'run.execute', 'run.publish'].includes(request.operation)) await git.expect(target, request.expected);
  switch (request.operation) {
    case 'workspace.initialize':
      return initialize(root, { specRepositoryId: input.specRepositoryId ?? workspace.id,
        toolkitRoot: path.join(toolkitRoot, 'packages'), templateRoot: path.join(toolkitRoot, 'templates/spec-repo/v1') });
    case 'workspace.validate': return validate(root, git, { pinned: Boolean(input.pinned) });
    case 'spec.feature.create': return createFeature(root, input);
    case 'spec.file.save': return saveFile(root, input);
    case 'spec.review.confirm': return confirm(root, input);
    case 'git.fetch': return git.fetch(target);
    case 'git.branch': return git.branch(target, input, request.expected);
    case 'git.commit': return git.commitSelected(target, input, request.expected);
    case 'git.push': return git.push(target, input, request.expected);
    case 'submodule.restore': return git.restore(root, request.expected);
    case 'submodule.add': {
      const config = await configuration(root);
      invariant(!config.projects.some(x => x.id === input.projectId), 'PROJECT_EXISTS', 'Project already exists', 409);
      const modules = await git.addModule(root, input, request.expected);
      config.projects.push({ id: input.projectId, path: `projects/${input.projectId}` });
      await writeJson(await safePath(root, 'workbench.yaml'), config);
      return { modules, committed: false, paths: ['.gitmodules', 'workbench.yaml', `projects/${input.projectId}`] };
    }
    case 'submodule.pin': return git.pin(root, input, request.expected);
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
      const result = await prepareRun({ root, home, workspaceId: workspace.id, input: { ...input, expected: request.expected }, git });
      store.recordRun(workspace.id, result, 'PREPARED'); return result;
    }
    case 'run.execute': {
      const result = await executeRun({ home, workspaceId: workspace.id, runId: input.runId, git, enabled: enableExecution });
      store.recordRun(workspace.id, result, 'SEALED'); return result;
    }
    case 'run.publish': {
      invariant(input.push === undefined || typeof input.push === 'boolean', 'INVALID_PUSH', 'push must be boolean');
      const result = await publishRun({ root, home, workspaceId: workspace.id, runId: input.runId, git, push: input.push === true });
      return result;
    }
  }
}
export async function workspaceDetail(options, workspace) {
  const root = await repositoryPath(options.home, workspace.id), git = createGit(options);
  if (!await exists(root)) return { ...workspace, state: 'NOT_CLONED', initialized: false };
  const state = await git.inspect(root);
  if (!await exists(await safePath(root, 'workbench.yaml'))) return { ...workspace, state, initialized: false };
  let spec, specError;
  try {
    spec = await scan(root);
    spec.features = await Promise.all(spec.features.map(async feature => ({ ...feature, review: await reviewState(root, feature.requirementId, feature.id) })));
  } catch (error) { specError = { code: error.code, message: error.message }; }
  let modules = [], moduleError;
  try { modules = await git.modules(root); } catch (error) { moduleError = { code: error.code, message: error.message }; }
  return { ...workspace, state, initialized: true, spec, specError, modules, moduleError };
}
export async function readWorkspaceFile(home, workspaceId, relative) {
  invariant(/^(spec|tests)\//.test(relative) || ['workbench.yaml', 'bdd.config.ts', 'playwright.config.ts', 'package.json', 'package-lock.json'].includes(relative), 'FILE_NOT_READABLE', 'Only source/configuration files are exposed', 403);
  const root = await repositoryPath(home, workspaceId), file = await safePath(root, relative, { missing: false }), bytes = await readFile(file);
  invariant(bytes.length <= 2 * 1024 * 1024, 'FILE_TOO_LARGE', 'Editor limit is 2 MiB');
  return { path: relative, content: bytes.toString('utf8'), sha256: digest(bytes) };
}
