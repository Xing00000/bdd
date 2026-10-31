import path from 'node:path';
import { readFile, mkdir, lstat } from 'node:fs/promises';
import { invariant, id, safePath, relativePath, exists, readJson, writeJson, atomicWrite, digest, identity } from '../contracts/index.mjs';
import { validateContract } from '../contracts/schemas.mjs';
import { configuration, scan, baseline, reviewState } from '../spec-toolkit/index.mjs';
import { runBddCommand } from '../spec-toolkit/engine.mjs';
import { execute, processEnvironment } from '../git-core/index.mjs';

export async function projectRoot(root, projectId, git) {
  id(projectId);
  const config = await configuration(root);
  const project = config.projects.find(x => x.id === projectId);
  invariant(project && (await git.modules(root)).some(x => x.id === projectId && x.actual), 'PROJECT_NOT_INITIALIZED', 'Project must belong to this Spec Repo and be initialized', 404);
  return safePath(root, project.path, { missing: false });
}
function sourcePath(relative) {
  relativePath(relative);
  invariant(!relative.split('/').some(x => ['node_modules', '.runtime', '.generated', '.workbench-tools'].includes(x) || /^\.env(?:\.|$)/.test(x))
    && !/\.(pem|key|p12|pfx)$/i.test(relative), 'SOURCE_PATH_DENIED', 'Private/runtime files are not exposed by the source editor', 403);
  return relative;
}
export async function projectFiles(root, projectId, git) {
  const target = await projectRoot(root, projectId, git);
  const list = (await git.command(target, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])).stdout.split('\0').filter(Boolean);
  const files = [];
  for (const relative of [...new Set(list)].sort()) {
    try {
      sourcePath(relative); const file = await safePath(target, relative, { missing: false });
      const stat = await lstat(file);
      if (stat.isFile() && stat.size <= 2 * 1024 * 1024) files.push(relative);
    } catch (error) { if (!['SOURCE_PATH_DENIED', 'SYMLINK_FORBIDDEN', 'ENOENT'].includes(error.code)) throw error; }
  }
  return { projectId, files, state: await git.inspect(target) };
}
export async function readProjectFile(root, projectId, relative, git) {
  const target = await projectRoot(root, projectId, git), file = await safePath(target, sourcePath(relative), { missing: false });
  invariant((await lstat(file)).size <= 2 * 1024 * 1024, 'FILE_TOO_LARGE', 'Editor limit is 2 MiB');
  const bytes = await readFile(file);
  invariant(!bytes.includes(0) && Buffer.from(bytes.toString('utf8')).equals(bytes), 'BINARY_FILE', 'The editor accepts UTF-8 source files only');
  return { projectId, path: relative, content: bytes.toString('utf8'), sha256: digest(bytes) };
}
export async function saveProjectFile(root, input, git, expected) {
  const target = await projectRoot(root, input.projectId, git);
  await git.expect(target, expected, { attached: true });
  const file = await safePath(target, sourcePath(input.path));
  const current = await exists(file) ? digest(await readFile(file)) : null;
  invariant(Object.hasOwn(input, 'expectedHash') && current === input.expectedHash, 'CONTENT_CHANGED', 'Source changed since the editor opened; your draft has not been overwritten', 409);
  invariant(typeof input.content === 'string' && Buffer.byteLength(input.content) <= 2 * 1024 * 1024 && !input.content.includes('\0'), 'INVALID_CONTENT', 'Expected UTF-8 source under 2 MiB');
  await atomicWrite(file, input.content);
  return { projectId: input.projectId, path: input.path, sha256: digest(input.content), committed: false };
}
export async function configureFeature(root, input) {
  const config = await configuration(root), req = id(input.requirementId), feature = id(input.featureId);
  const file = await safePath(root, `spec/${req}/${feature}/feature.yaml`, { missing: false });
  const previous = await readFile(file);
  invariant(digest(previous) === input.expectedHash, 'CONTENT_CHANGED', 'Feature configuration changed', 409);
  const value = { ...JSON.parse(previous), projectIds: input.projectIds, caseIds: input.caseIds, profiles: input.profiles };
  validateContract('feature', value);
  invariant(value.projectIds.every(p => config.projects.some(x => x.id === p)), 'UNKNOWN_PROJECT', 'Only Projects under this Spec Repo can be selected');
  await writeJson(file, value); return { feature: value, committed: false };
}
export async function configureExecution(root, input) {
  const file = await safePath(root, 'workbench.yaml', { missing: false }), previous = await readFile(file);
  invariant(digest(previous) === input.expectedHash, 'CONTENT_CHANGED', 'Execution configuration changed', 409);
  const config = JSON.parse(previous);
  const execution = { ...config.execution, environment: { WB_TARGET_BASE_URL: input.baseUrl },
    service: { projectId: input.projectId, command: input.command, healthUrl: input.healthUrl } };
  const updated = { ...config, execution }; validateContract('workbench', updated);
  invariant(config.projects.some(p => p.id === input.projectId), 'UNKNOWN_PROJECT', 'Service must be a Project under this Spec Repo');
  const url = new URL(input.baseUrl), health = new URL(input.healthUrl);
  invariant(url.origin === health.origin && url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'SERVICE_URL_NOT_LOCAL', 'Use one dedicated loopback origin for this managed product');
  await writeJson(file, updated); return { config: updated, committed: false };
}
export async function installDependencies(root, enabled) {
  invariant(enabled, 'EXECUTION_DISABLED', 'Enable a trusted execution worker before installing repository dependencies', 403);
  await configuration(root);
  const directory = await safePath(root, '.runtime/dependencies'); await mkdir(directory, { recursive: true });
  const locked = await exists(path.join(root, 'package-lock.json'));
  const result = await execute('npm', [locked ? 'ci' : 'install', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: root, env: { ...processEnvironment(), HOME: path.join(directory, 'home'), npm_config_cache: path.join(directory, 'cache') }, timeoutMs: 300000
  });
  await writeJson(path.join(directory, 'receipt.json'), result);
  invariant(result.exitCode === 0 && !result.timedOut && !result.overflow, 'DEPENDENCY_INSTALL_FAILED', (result.stderr || result.stdout || 'Dependency install failed').slice(-4000));
  return { installed: true, lockfileCreated: !locked, lockfileHash: digest(await readFile(path.join(root, 'package-lock.json'))), committed: false, command: locked ? 'npm ci --ignore-scripts' : 'npm install --ignore-scripts' };
}
export async function checkTests(root, input, store, repositoryId, enabled) {
  invariant(enabled, 'EXECUTION_DISABLED', 'Test configuration is executable code; enable the trusted worker first', 403);
  const data = await scan(root), key = `${id(input.requirementId)}/${id(input.featureId)}`;
  const feature = data.features.find(x => x.key === key); invariant(feature, 'FEATURE_NOT_FOUND', key, 404);
  const review = await reviewState(root, input.requirementId, input.featureId);
  invariant(review.confirmed.gherkin && review.confirmed.sd, 'UPSTREAM_NOT_CONFIRMED', 'Confirm Gherkin and design before checking tests');
  const before = review.hashes.tests;
  const output = await safePath(root, `.runtime/checks/${input.requirementId}/${input.featureId}`); await mkdir(output, { recursive: true });
  const generated = await runBddCommand(root, 'generate', input.requirementId, input.featureId, { output });
  invariant(generated.exitCode === 0 && !generated.timedOut && !generated.overflow, 'BDD_GENERATION_FAILED', (generated.stderr || generated.stdout).slice(-4000));
  const discovery = await runBddCommand(root, 'list', input.requirementId, input.featureId, { output });
  invariant(discovery.exitCode === 0 && !discovery.timedOut && !discovery.overflow, 'BDD_DISCOVERY_FAILED', (discovery.stderr || discovery.stdout).slice(-4000));
  const receipt = await readJson(path.join(output, 'discovery.json'));
  const keys = receipt.definitions?.map(x => `${x.caseId}/${x.profile}`).sort();
  invariant(Array.isArray(keys) && !receipt.errors?.length && identity(keys) === identity(feature.caseIds.flatMap(c => feature.profiles.map(p => `${c}/${p}`)).sort()), 'CASE_SET_MISMATCH', 'Discovered tests must match every configured case/browser exactly');
  invariant(before === (await baseline(root, input.requirementId, input.featureId)).tests, 'CONTENT_CHANGED', 'Inputs changed during discovery; check again', 409);
  const result = { digest: before, status: 'CHECKED', testOutcome: 'NOT_RUN', tests: keys.length, checkedAt: new Date().toISOString() };
  store.recordCheck(repositoryId, key, result); return result;
}

export async function installBrowsers(root, enabled, browserRoot) {
  invariant(enabled, 'EXECUTION_DISABLED', 'Enable the trusted worker before browser installation', 403);
  const config = await configuration(root);
  const executable = path.join(root, 'node_modules/.bin/playwright');
  invariant(await exists(executable), 'DEPENDENCIES_NOT_INSTALLED', 'Install test dependencies first');
  const directory = await safePath(root, '.runtime/browser-install'); await mkdir(directory, { recursive: true });
  const result = await execute(executable, ['install', 'chromium'], { cwd: root, env: { ...processEnvironment(), HOME: path.join(directory, 'home'), ...(browserRoot ? { PLAYWRIGHT_BROWSERS_PATH: browserRoot } : {}) }, timeoutMs: 300000 });
  await writeJson(path.join(directory, 'receipt.json'), result);
  invariant(result.exitCode === 0 && !result.timedOut && !result.overflow, 'BROWSER_INSTALL_FAILED', (result.stderr || result.stdout).slice(-4000));
  return { installed: ['chromium'], specRepositoryId: config.specRepositoryId, systemLibrariesManaged: false };
}
