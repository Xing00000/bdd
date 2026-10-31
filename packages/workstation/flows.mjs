/** User-facing transactions. Git plumbing stays behind save/sync, not in the UI. */
import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { WorkstationError, invariant, id, safePath, exists, readJson, writeJson, atomicWrite, digest, identity } from '../contracts/index.mjs';
import { branchName, remoteUrl, execute, processEnvironment } from '../git-core/index.mjs';
import { initialize, configuration, createFeature, buildGuidedFeature, parseGuidedFeature, scan, saveFile, reviewState, confirm } from '../spec-toolkit/index.mjs';
import { projectRoot, saveProjectFile, configureExecution, configureFeature, installDependencies, checkTests } from './repository-actions.mjs';
import { prepareRun, executeRun, publishRun } from '../spec-toolkit/engine.mjs';
import { reindexReports } from './reports.mjs';

export const flowNames = ['repository.setup', 'repository.save', 'repository.sync', 'workflow.create', 'workflow.draft', 'workflow.review', 'workflow.verify'];

async function attached(root, git, repositoryId) {
  const state = await git.inspect(root);
  if (state.branch) return state;
  // A product restored at a gitlink is normally detached. Retain its content and
  // create a private editing branch; do not force-switch somebody else's branch.
  const name = `workbench/${id(repositoryId)}-${state.head.slice(0, 12)}`;
  const found = await git.command(root, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`], { allowFailure: true });
  if (found.exitCode === 0) {
    invariant(await git.resolve(root, name) === state.head, 'LOCAL_HISTORY_CONFLICT', '本機版本與先前的編輯紀錄不同，已保留所有內容，請先處理差異。', 409);
    await git.command(root, ['switch', name]);
  } else await git.command(root, ['switch', '-c', name]);
  return git.inspect(root);
}
async function savePaths(root, paths, git, repositoryId, message) {
  const state = await attached(root, git, repositoryId);
  if (!paths.length) return { head: state.head, noChanges: true };
  return git.commitSelected(root, { paths: [...new Set(paths)], message }, state);
}
async function changedPaths(root, git) {
  const state = await git.inspect(root);
  return [...new Set(state.changes.flatMap(x => [x.path, ...(x.originalPath ? [x.originalPath] : [])]))];
}
async function pinSavedProducts(root, git, repositoryId) {
  const modules = await git.modules(root);
  for (const p of modules) {
    invariant(p.actual && !p.dirty, 'UNSAVED_PRODUCT', `產品 ${p.id} 尚有未儲存內容，請先儲存該產品再繼續。`, 409);
  }
  // commitSelected writes exact gitlink paths into an isolated index. It does not
  // detach an editing branch or include unrelated staged changes.
  return savePaths(root, modules.filter(p => p.commit !== p.actual).map(p => p.path), git, repositoryId, 'Save product version references');
}
async function defaultBranch(url, git) {
  remoteUrl(url, git.policy);
  const response = await git.command(undefined, ['ls-remote', '--symref', url, 'HEAD']);
  const name = /^ref: refs\/heads\/([^\t\n]+)\tHEAD$/m.exec(response.stdout)?.[1];
  if (name) return branchName(name);
  invariant(!response.stdout.trim(), 'REMOTE_DEFAULT_MISSING', '遠端未設定預設版本，請先由管理者設定預設分支。');
  return 'main'; // an empty remote has no version yet
}
async function targetFor(root, git, branch) {
  const remote = (await git.remotes(root)).find(x => x.name === 'origin');
  invariant(remote && remote.urls.length === 1 && remote.pushUrls.length === 1, 'SYNC_DESTINATION_REQUIRED', '請在集中設定中確認唯一的遠端同步位置。');
  remoteUrl(remote.url, git.policy); remoteUrl(remote.pushUrl, git.policy);
  return { remote: 'origin', url: remote.url, pushUrl: remote.pushUrl, branch: branchName(branch) };
}

/** Setup never installs or executes repository code. Settings are supplied once. */
export async function setupRepository({ root, options, store, request, git }) {
  const input = request.input, record = store.repository(request.repositoryId);
  invariant(typeof input.reviewer === 'string' && input.reviewer.trim() && input.reviewer.length <= 120, 'REVIEWER_REQUIRED', '請設定確認者名稱。');
  invariant(Array.isArray(input.projects ?? []) && (input.projects ?? []).length <= 20, 'INVALID_PROJECTS', '最多可設定 20 個產品。');
  const projects = input.projects ?? [];
  invariant(new Set(projects.map(p => p.id)).size === projects.length, 'DUPLICATE_PROJECT', '產品名稱不能重複。');
  for (const project of projects) { id(project.id); remoteUrl(project.url, git.policy); }
  const previous = store.preferences(record.id);
  if (previous && input.expectedSettings !== undefined) invariant(identity(previous) === input.expectedSettings, 'SETTINGS_CHANGED', '設定已被更新，請重新開啟設定。', 409);
  const hadCheckout = await exists(root);
  if (!hadCheckout) await git.clone(record.remoteUrl, root, record.branch ?? undefined);
  else await git.expect(root, request.expected);
  await git.root(root);
  if (!await exists(path.join(root, 'workbench.yaml'))) {
    await initialize(root, { specRepositoryId: record.id, templateRoot: path.join(options.toolkitRoot, 'templates/spec-repo/v1'), toolkitRoot: path.join(options.toolkitRoot, 'packages') });
    await savePaths(root, await changedPaths(root, git), git, record.id, 'Initialize specification repository');
  }
  // Setup may run after a human has started editing the specification.
  // Scope all writes to setup-owned files; leave other staged/unstaged drafts alone.
  // A concurrent edit of the configuration itself is an actual conflict.
  const setupState = await git.inspect(root);
  const installedModules = await git.modules(root);
  const modifiesConfig = Boolean(input.execution) || projects.some(p => !installedModules.some(m => m.id === p.id));
  if (modifiesConfig && setupState.changes.some(change => change.path === 'workbench.yaml'))
    throw new WorkstationError('SETTINGS_DRAFT_CONFLICT',
      '規格庫設定檔有尚未儲存的修改。系統已保留內容；請先儲存該設定，再重新執行設定。', 409);
  let config = await configuration(root);
  if ((await git.modules(root)).some(p => !p.actual)) await git.restore(root, await git.inspect(root));
  const destinations = [];
  for (const project of projects) {
    let module = (await git.modules(root)).find(p => p.id === project.id);
    const branch = previous?.sync?.projects?.find(p => p.id === project.id)?.branch ?? await defaultBranch(project.url, git);
    if (module) invariant(module.url === project.url, 'PROJECT_SOURCE_CHANGED', `產品 ${project.id} 的來源不能被默默替換。`, 409);
    else {
      const commit = await git.remoteHead(project.url, branch);
      await git.addModule(root, { projectId: project.id, url: project.url, commit }, await git.inspect(root));
      config.projects.push({ id: project.id, path: `projects/${project.id}` });
      await writeJson(path.join(root, 'workbench.yaml'), config);
      await savePaths(root, ['.gitmodules', `projects/${project.id}`, 'workbench.yaml'], git, record.id, `Save product binding ${project.id}`);
      module = (await git.modules(root)).find(p => p.id === project.id);
    }
    destinations.push({ id: project.id, ...await targetFor(path.join(root, module.path), git, branch) });
  }
  // Existing products are retained if not supplied; never delete them in setup.
  for (const module of await git.modules(root)) if (!destinations.some(p => p.id === module.id)) {
    const prior = previous?.sync?.projects?.find(p => p.id === module.id);
    destinations.push({ id: module.id, ...await targetFor(path.join(root, module.path), git, prior?.branch ?? await defaultBranch(module.url, git)) });
  }
  if (input.execution) {
    await configureExecution(root, { ...input.execution, expectedHash: digest(await readFile(path.join(root, 'workbench.yaml'))) });
    await savePaths(root, ['workbench.yaml'], git, record.id, 'Save verification environment');
  }
  const specState = await attached(root, git, record.id);
  const settings = { schemaVersion: 1, reviewer: input.reviewer.trim(), configured: true,
    sync: { spec: await targetFor(root, git, previous?.sync?.spec?.branch ?? specState.branch), projects: destinations },
    updatedAt: new Date().toISOString() };
  store.setPreferences(record.id, settings);
  return { ready: true, saved: true, synchronized: false, settings };
}

/** Durable save: explicit file → local history → parent product reference. No network. */
export async function saveRepository({ root, options, store, request, git }) {
  const input = request.input, repositoryId = request.repositoryId;
  invariant(store.preferences(repositoryId)?.configured, 'SETUP_REQUIRED', '請先完成一次性設定。');
  await git.expect(root, request.expected);
  if (input.kind === 'scope') {
    await configureFeature(root, input);
    await savePaths(root, [`spec/${id(input.requirementId)}/${id(input.featureId)}/feature.yaml`], git, repositoryId, 'Save acceptance scope');
    return { saved: true, synchronized: false };
  }
  const project = input.kind === 'project';
  invariant(project || input.kind === 'source', 'INVALID_SAVE_TARGET', '選擇規格或產品檔案。');
  const target = project ? await projectRoot(root, input.projectId, git) : root;
  // Save bytes must pass the same editor hash/secret/path constraints as low-level APIs.
  await attached(target, git, repositoryId);
  let result;
  if (project) result = await saveProjectFile(root, input, git, await git.inspect(target));
  else result = await saveFile(root, input);
  const saved = await savePaths(target, [input.path], git, repositoryId, `Save ${project ? 'product' : 'specification'} ${input.path}`);
  if (project) {
    // Do not demand unrelated product drafts be committed just to save this file.
    await savePaths(root, [`projects/${id(input.projectId)}`], git, repositoryId, `Save product version ${input.projectId}`);
  }
  const receipt = { ...result, saved: true, commit: saved.head, synchronized: false };
  await writeJson(await safePath(options.home, `save-receipts/${repositoryId}/${request.operationId}.json`), receipt);
  return receipt;
}

async function installationPlan(root, profiles, browserRoot) {
  const packageBytes = await readFile(await safePath(root, 'package.json', { missing: false }));
  const lock = await exists(path.join(root, 'package-lock.json')) ? digest(await readFile(path.join(root, 'package-lock.json'))) : null;
  const runtime = process.versions.node.split('.')[0];
  const definition = { packageHash: digest(packageBytes), lock, profiles: [...profiles].sort(), browserRoot, runtime };
  const receiptPath = await safePath(root, '.runtime/flow-installation.json');
  const receipt = await exists(receiptPath) ? await readJson(receiptPath) : null;
  const binaries = ['node_modules/.bin/bddgen', 'node_modules/.bin/playwright'];
  const ready = receipt?.digest === identity(definition) && (await Promise.all(binaries.map(x => exists(path.join(root, x))))).every(Boolean)
    && Array.isArray(receipt.browserFiles) && receipt.browserFiles.length >= profiles.length && (await Promise.all(receipt.browserFiles.map(x => exists(x)))).every(Boolean);
  const pkg = JSON.parse(packageBytes);
  return { digest: identity(definition), ready, definition, packages: { ...pkg.dependencies, ...pkg.devDependencies }, profiles };
}
export async function ensureInstallation({ root, options, request, profiles = ['chromium'], git }) {
  invariant(options.enableExecution, 'EXECUTION_DISABLED', '此主機尚未啟用受信任執行，請管理者啟用後再繼續。', 403);
  const browserRoot = options.browserRoot ?? process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(options.home, 'browsers');
  const plan = await installationPlan(root, profiles, browserRoot);
  if (plan.ready) return { installed: false };
  if (request.input.installConsent !== plan.digest) throw new WorkstationError('INSTALL_REQUIRED', '此步驟需要安裝測試套件與瀏覽器。只需一次確認，完成後會自動接續原流程。', 409,
    { install: { digest: plan.digest, packages: plan.packages, browsers: profiles, lifecycleScripts: false, systemChanges: false } });
  await installDependencies(root, true);
  const directory = await safePath(root, '.runtime/flow-install'); await mkdir(directory, { recursive: true });
  const env = { ...processEnvironment(), HOME: directory, PLAYWRIGHT_BROWSERS_PATH: browserRoot };
  const output = await execute(path.join(root, 'node_modules/.bin/playwright'), ['install', ...profiles], { cwd: root, env, timeoutMs: 300000 });
  await writeJson(path.join(directory, 'browsers.json'), output);
  invariant(output.exitCode === 0 && !output.timedOut && !output.overflow, 'INSTALL_FAILED', '瀏覽器安裝失敗，原流程尚未推進。請檢查網路與主機相依套件後重試。');
  // Only after consent/package installation may the versioned Playwright module load.
  const query = await execute(process.execPath, ['--input-type=module', '-e',
    `import {createRequire} from 'node:module'; const p=createRequire(process.cwd()+'/package.json')('playwright'); console.log(JSON.stringify(${JSON.stringify(profiles)}.map(x=>p[x].executablePath())));`], { cwd: root, env, timeoutMs: 15000 });
  invariant(query.exitCode === 0, 'BROWSER_PROBE_FAILED', '無法確認瀏覽器安裝位置。');
  const browserFiles = JSON.parse(query.stdout.trim());
  invariant((await Promise.all(browserFiles.map(x => exists(x)))).every(Boolean), 'BROWSER_MISSING', '必要瀏覽器尚未完整安裝。');
  const after = await installationPlan(root, profiles, browserRoot);
  invariant(after.definition.packageHash === plan.definition.packageHash, 'DEPENDENCIES_CHANGED', '套件定義在安裝期間改變，請重新確認。', 409);
  await writeJson(path.join(root, '.runtime/flow-installation.json'), { digest: after.digest, browserFiles, installedAt: new Date().toISOString() });
  await savePaths(root, ['package-lock.json'], git, request.repositoryId, 'Save resolved test dependencies');
  return { installed: true };
}

export async function advanceWorkflow(context) {
  const { root, options, store, request, git } = context;
  const settings = store.preferences(request.repositoryId);
  invariant(settings?.configured, 'SETUP_REQUIRED', '請先完成一次性設定。');
  await git.expect(root, request.expected);
  const input = request.input;
  if (request.operation === 'workflow.create') {
    const existing = (await scan(root)).features;
    const requirements = new Set(existing.map(f => f.requirementId));
    let requirementId = input.requirementId?.trim();
    if (!requirementId) { let i = 1; while (requirements.has(`REQ-${String(i).padStart(3, '0')}`)) i++; requirementId = `REQ-${String(i).padStart(3, '0')}`; }
    id(requirementId);
    let featureId = input.featureId?.trim();
    if (!featureId) {
      const slug = String(input.title ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 45);
      const prefix = slug || 'feature'; let index = 1; featureId = prefix;
      while (existing.some(f => f.requirementId === requirementId && f.id === featureId)) featureId = `${prefix}-${String(++index).padStart(3, '0')}`;
    }
    id(featureId);
    const guided = Boolean(input.guided || input.goal || input.acceptance);
    const result = await createFeature(root, { ...input, requirementId, featureId, guided });
    await savePaths(root, [...result.files, `spec/${requirementId}/requirement.yaml`, `spec/${requirementId}/review.json`], git, request.repositoryId, `Create ${result.key}`);
    return { ...result, saved: true };
  }
  const key = `${id(input.requirementId)}/${id(input.featureId)}`;
  const data = await scan(root), feature = data.features.find(x => x.key === key);
  invariant(feature, 'FEATURE_NOT_FOUND', '找不到此功能。', 404);
  if (request.operation === 'workflow.draft') {
    const filename = `spec/${key}/${id(input.featureId)}.feature`;
    const file = await safePath(root, filename, { missing: false });
    const old = await readFile(file, 'utf8');
    invariant(digest(old) === input.expectedHash, 'CONTENT_CHANGED', '草稿已由其他操作修改；已保留你的編輯，請重新讀取。', 409);
    invariant(parseGuidedFeature(old), 'ADVANCED_GHERKIN', '此需求已直接編輯 Gherkin；為保護情境，請使用進階編輯器修改。', 409);
    const draft = buildGuidedFeature(input);
    const metadataPath = `spec/${key}/feature.yaml`;
    const metadata = await readJson(await safePath(root, metadataPath, { missing: false }));
    invariant(digest(JSON.stringify(metadata)) === input.expectedMetadataHash || !input.expectedMetadataHash,
      'CONTENT_CHANGED', '驗收範圍已被修改，請先重新讀取。', 409);
    metadata.title = draft.title;
    metadata.caseIds = draft.caseIds;
    await atomicWrite(file, draft.featureText);
    await writeJson(await safePath(root, metadataPath), metadata);
    await savePaths(root, [filename, metadataPath], git, request.repositoryId, `Save guided requirement ${key}`);
    return { saved: true, key, sha256: digest(draft.featureText) };
  }
  let review = await reviewState(root, input.requirementId, input.featureId);
  if (request.operation === 'workflow.review') {
    invariant(['gherkin', 'sd', 'tests'].includes(input.stage), 'INVALID_STAGE', '只需確認需求、設計與驗收測試。');
    if (input.stage === 'gherkin') {
      const content = await readFile(await safePath(root, `spec/${key}/${id(input.featureId)}.feature`), 'utf8');
      invariant(!content.includes('Then 請補充可驗收的結果'), 'ACCEPTANCE_REQUIRED', '請先填寫可驗收的結果，再確認需求。');
    }
    // Check the human-reviewed source before installation; dependency resolution may
    // create the lockfile, but must never silently change the authored test code.
    invariant(review.hashes[input.stage] === input.expectedDigest, 'CONTENT_CHANGED', '內容已改變，請重新審閱。', 409);
    if (input.stage === 'tests') {
      invariant(review.confirmed.gherkin && review.confirmed.sd, 'UPSTREAM_NOT_CONFIRMED', '請先確認需求與設計。');
      const authored = review.hashes.files.filter(([file]) => file !== 'package-lock.json');
      await ensureInstallation({ ...context, profiles: feature.profiles });
      const installedReview = await reviewState(root, input.requirementId, input.featureId);
      invariant(identity(authored) === identity(installedReview.hashes.files.filter(([file]) => file !== 'package-lock.json')), 'CONTENT_CHANGED', '安裝期間來源已變更，請重新審閱；沒有自動批准修改後的內容。', 409);
      await checkTests(root, input, store, request.repositoryId, true);
      review = await reviewState(root, input.requirementId, input.featureId);
    }
    const result = await confirm(root, { ...input, expectedDigest: review.hashes[input.stage], confirmedBy: settings.reviewer });
    await savePaths(root, [`spec/${input.requirementId}/review.json`], git, request.repositoryId, `Confirm ${key} ${input.stage}`);
    return { ...result, saved: true, nextStage: { gherkin: 'SD', sd: 'TESTS', tests: 'IMPLEMENTATION' }[input.stage] };
  }
  invariant(Object.values(review.confirmed).every(Boolean), 'REVIEWS_REQUIRED', '需求、設計或測試已變更，請先完成必要的內容確認。', 409);
  await ensureInstallation({ ...context, profiles: feature.profiles });
  await pinSavedProducts(root, git, request.repositoryId);
  const candidate = await prepareRun({ root, home: options.home, repositoryId: request.repositoryId, input: { requirementId: input.requirementId, featureId: input.featureId, expected: await git.inspect(root) }, git });
  store.recordRun(request.repositoryId, candidate, 'PREPARED');
  const result = await executeRun({ home: options.home, repositoryId: request.repositoryId, runId: candidate.runId, git, enabled: true });
  store.recordRun(request.repositoryId, result, 'SEALED');
  // Local report history is automatic. Remote exposure still requires sync.
  const publication = await publishRun({ root, home: options.home, repositoryId: request.repositoryId, runId: candidate.runId, git, push: false });
  return { ...result, publication, saved: true, synchronized: false };
}

async function syncPreflight(root, destination, git, label) {
  const state = await git.inspect(root);
  invariant(state.clean, 'UNSAVED_CHANGES', `${label} 有尚未儲存的本機變更，請先儲存；系統不會捨棄這些內容。`, 409);
  const current = await targetFor(root, git, destination.branch);
  invariant(identity(current) === identity(destination), 'SYNC_DESTINATION_CHANGED', `${label} 的遠端位置已改變，請先確認集中設定。`, 409);
  const remote = await git.command(root, ['ls-remote', '--heads', destination.pushUrl, `refs/heads/${destination.branch}`]);
  const remoteSha = remote.stdout.trim().split(/\s/)[0] || null;
  if (!remoteSha || remoteSha === state.head) return { state, remoteSha, incoming: false };
  await git.command(root, ['fetch', '--no-tags', '--no-recurse-submodules', destination.pushUrl, `refs/heads/${destination.branch}`]);
  const sha = await git.resolve(root, 'FETCH_HEAD');
  invariant(sha === remoteSha, 'REMOTE_CHANGED', '遠端正在更新，請重試同步。', 409);
  const ancestor = async (a,b) => (await git.command(root, ['merge-base', '--is-ancestor', a, b], { allowFailure: true })).exitCode === 0;
  const incoming = await ancestor(state.head, sha);
  invariant(incoming || await ancestor(sha, state.head), 'SYNC_CONFLICT', `${label} 的遠端與本機有不同修改，已保留兩邊版本；未覆寫或強制同步。`, 409);
  return { state, remoteSha, incoming };
}
export async function synchronizeRepository(context) {
  const { root, options, store, request, git } = context, repositoryId = request.repositoryId;
  const settings = store.preferences(repositoryId);
  invariant(settings?.sync, 'SETUP_REQUIRED', '請先完成一次性設定。');
  await git.expect(root, request.expected, { clean: true });
  const journalPath = await safePath(options.home, `sync-receipts/${repositoryId}/${request.operationId}.json`);
  const receipt = { repositoryId, status: 'SYNCING', completed: [], startedAt: new Date().toISOString() };
  await writeJson(journalPath, receipt);
  try {
    let specPlan = await syncPreflight(root, settings.sync.spec, git, '規格庫');
    // Pull only an uncontested fast-forward. No automatic merge/conflict resolution.
    if (specPlan.incoming) {
      await git.command(root, ['merge', '--ff-only', specPlan.remoteSha]);
      await git.restore(root, await git.inspect(root));
      const config = await configuration(root);
      invariant(config.projects.every(p => settings.sync.projects.some(s => s.id === p.id)), 'SETUP_CHANGED', '遠端新增了產品，請在集中設定確認其同步來源。', 409);
    }
    const plans = [];
    for (const module of await git.modules(root)) {
      const target = settings.sync.projects.find(x => x.id === module.id);
      invariant(target, 'SETUP_CHANGED', '產品同步位置尚未設定。', 409);
      const directory = path.join(root, module.path), { id: ignored, ...destination } = target;
      plans.push({ directory, destination, id: ignored, ...await syncPreflight(directory, destination, git, `產品 ${module.id}`) });
    }
    // All destinations are checked before any push; a subsequent remote race is
    // still rejected by ordinary non-force push and recorded as partial progress.
    for (const plan of plans) {
      await attached(plan.directory, git, repositoryId);
      if (plan.incoming) await git.command(plan.directory, ['merge', '--ff-only', plan.remoteSha]);
      const result = await git.push(plan.directory, plan.destination, await git.inspect(plan.directory));
      receipt.completed.push({ kind: 'project', id: plan.id, ...result }); await writeJson(journalPath, receipt);
    }
    await pinSavedProducts(root, git, repositoryId);
    const result = await git.push(root, settings.sync.spec, await git.inspect(root));
    receipt.completed.push({ kind: 'spec', ...result }); await writeJson(journalPath, receipt);
    for (const run of store.runs(repositoryId).filter(x => x.state === 'SEALED')) {
      const publication = await publishRun({ root, home: options.home, repositoryId, runId: run.id, git, push: true });
      receipt.completed.push({ kind: 'report', runId: run.id, ...publication }); await writeJson(journalPath, receipt);
    }
    await git.fetch(root);
    const indexed = await reindexReports({ root, home: options.home, repositoryId, git, store });
    receipt.status = indexed.errors.length ? 'SYNCED_WITH_REPORT_WARNINGS' : 'SYNCED'; receipt.reportWarnings = indexed.errors;
    receipt.finishedAt = new Date().toISOString(); receipt.head = await git.resolve(root);
    await writeJson(journalPath, receipt); store.setSyncReceipt(repositoryId, receipt);
    return receipt;
  } catch (error) {
    receipt.status = 'PARTIAL'; receipt.error = { code: error.code, message: error.message }; await writeJson(journalPath, receipt); store.setSyncReceipt(repositoryId, receipt);
    error.details = { ...error.details, sync: receipt }; throw error;
  }
}
