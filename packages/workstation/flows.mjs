import { publishRegression } from './regression-evidence.mjs';
/** User-facing transactions. Git plumbing stays behind save/sync, not in the UI. */
import path from 'node:path';
import { mkdir, readFile, mkdtemp, rename, rm } from 'node:fs/promises';
import { WorkstationError, invariant, id, safePath, exists, readJson, writeJson, digest, identity, atomicWrite } from '../contracts/index.mjs';
import { branchName, remoteUrl, execute, processEnvironment } from '../git-core/index.mjs';
import { configuration, scan, reviewState, confirm, defaultProfiles } from '../spec-toolkit/index.mjs';
import { installDependencies, checkTests } from './repository-actions.mjs';
import { prepareRun, executeRun, publishRun } from '../spec-toolkit/engine.mjs';
import { reindexReports } from './reports.mjs';
import { requirementDiagnostics } from './requirements.mjs';
import { currentProgress } from '../git-core/progress.mjs';
import { dependencyDefinition, dependencyInputs, installedDependencies, materializeDependencies, nodeRuntime, dependencyReceiptPath, specToolBinaries } from '../spec-toolkit/dependencies.mjs';

export const flowNames = ['repository.setup', 'repository.save', 'repository.sync', 'workflow.delete', 'workflow.create', 'workflow.draft', 'workflow.requirement.save', 'workflow.feedback', 'workflow.accept', 'workflow.restart', 'workflow.review', 'workflow.verify', 'repository.prepare'];

export async function attached(root, git, repositoryId) {
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
export async function savePaths(root, paths, git, repositoryId, message) {
  const state = await attached(root, git, repositoryId);
  if (!paths.length) return { head: state.head, noChanges: true };
  return git.commitSelected(root, { paths: [...new Set(paths)], message }, state);
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
export async function defaultBranch(url, git) {
  remoteUrl(url, git.policy);
  const response = await git.command(undefined, ['ls-remote', '--symref', url, 'HEAD']);
  const name = /^ref: refs\/heads\/([^\t\n]+)\tHEAD$/m.exec(response.stdout)?.[1];
  if (name) return branchName(name);
  invariant(!response.stdout.trim(), 'REMOTE_DEFAULT_MISSING', '遠端未設定預設版本，請先由管理者設定預設分支。');
  return 'main'; // an empty remote has no version yet
}
export async function targetFor(root, git, branch) {
  const remote = (await git.remotes(root)).find(x => x.name === 'origin');
  invariant(remote && remote.urls.length === 1 && remote.pushUrls.length === 1, 'SYNC_DESTINATION_REQUIRED', '請在集中設定中確認唯一的遠端同步位置。');
  remoteUrl(remote.url, git.policy); remoteUrl(remote.pushUrl, git.policy);
  return { remote: 'origin', url: remote.url, pushUrl: remote.pushUrl, branch: branchName(branch) };
}

export async function installationPlan(root, profiles, browserRoot) {
  const packageBytes = await readFile(await safePath(root, 'package.json', { missing: false }));
  const lock = await exists(path.join(root, 'package-lock.json')) ? digest(await readFile(path.join(root, 'package-lock.json'))) : null;
  const runtime = nodeRuntime();
  const definition = { packageHash: digest(packageBytes), lock, profiles: [...profiles].sort(), browserRoot, runtime,dependencyKey:identity(await dependencyDefinition(root)) };
  const receiptPath = await safePath(root, '.runtime/flow-installation.json');
  const receipt = await exists(receiptPath) ? await readJson(receiptPath) : null;
  const binaries = specToolBinaries.map(name=>`node_modules/.bin/${name}`);
  const ready = receipt?.digest === identity(definition) && (await Promise.all(binaries.map(x => exists(path.join(root, x))))).every(Boolean)
    && Array.isArray(receipt.browserFiles) && receipt.browserFiles.length >= profiles.length && (await Promise.all(receipt.browserFiles.map(x => exists(x)))).every(Boolean);
  const pkg = JSON.parse(packageBytes);
  return { digest: identity(definition), ready, definition, packages: { ...pkg.dependencies, ...pkg.devDependencies }, profiles,repositoryId:receipt?.repositoryId };
}
export const repositoryToolsPath = (home,repositoryId) => safePath(home,`repositories/${id(repositoryId)}/test-tools`);

export async function ensureInstallation({ root, options, request, profiles = defaultProfiles, git }) {
  invariant(options.enableExecution, 'EXECUTION_DISABLED', '此主機尚未啟用受信任執行，請管理者啟用後再繼續。', 403);
  const browserRoot = options.browserRoot ?? process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(options.home, 'browsers');
  const plan = await installationPlan(root, profiles, browserRoot);
  if (plan.ready&&plan.repositoryId===request.repositoryId) {
    const files=await installedBrowserFiles(root,profiles,browserRoot);
    if((await Promise.all(files.map(file=>exists(file)))).every(Boolean)) {
      currentProgress()?.record('\r\n[dependencies] Reusing installed Spec Repo tools\r\n');return { installed: false };
    }
  }
  const tools=await repositoryToolsPath(options.home,request.repositoryId),parent=path.dirname(tools);
  const requestedKey=identity(await dependencyDefinition(root));
  let cached=await exists(tools)?await installedDependencies(tools):null;
  const locked=await exists(path.join(root,'package-lock.json'));
  const reusable=Boolean(cached&&(cached.key===requestedKey||!locked&&cached.requestedKey===requestedKey));
  let browserFiles=reusable?await installedBrowserFiles(tools,profiles,browserRoot):[];
  const browsersReady=(profiles.length===0||browserFiles.length>0)&&(await Promise.all(browserFiles.map(file=>exists(file)))).every(Boolean);
  if ((!reusable||!browsersReady)&&request.input.installConsent !== plan.digest) throw new WorkstationError('INSTALL_REQUIRED', '此步驟需要安裝測試套件與瀏覽器。只需一次確認，完成後會自動接續原流程。', 409,
    { install: { digest: plan.digest, packages: plan.packages, browsers: profiles, lifecycleScripts: false, systemChanges: false } });
  if(!reusable) {
    currentProgress()?.record('\r\n[dependencies] Installing Spec Repo tools\r\n');
    if(await exists(tools))invariant(await exists(await safePath(tools,dependencyReceiptPath)),'DEPENDENCIES_UNMANAGED','Spec Repo 工具目錄不是受管理的安裝，未覆寫既有內容。',409);
    await mkdir(parent,{recursive:true});const staging=await mkdtemp(path.join(parent,'.test-tools-'));
    try {
      for(const file of await dependencyInputs(root))await writeDependencyInput(staging,file.path,file.content);
      await writeDependencyInput(staging,'workbench.yaml',await readFile(await safePath(root,'workbench.yaml',{missing:false})));
      await installDependencies(staging,true);
      // Installed environments are build artifacts. Each consumer receives its own copy.
      await rm(tools,{recursive:true,force:true});await rename(staging,tools);
    } finally {
      if(await exists(staging))for(const relative of ['node_modules','.runtime/dependencies/cache'])await rm(await safePath(staging,relative),{recursive:true,force:true});
    }
    cached=await installedDependencies(tools);invariant(cached,'DEPENDENCIES_CHANGED','Spec Repo 安裝結果與依賴設定不符。',409);
  }
  invariant(identity(await dependencyDefinition(root))===requestedKey,'DEPENDENCIES_CHANGED','安裝期間依賴設定已改變，未覆寫來源。',409);
  if(reusable)currentProgress()?.record('\r\n[dependencies] Reusing Spec Repo installation; preparing isolated tools\r\n');
  if(!locked)await writeDependencyInput(root,'package-lock.json',await readFile(await safePath(tools,'package-lock.json',{missing:false})));
  await rm(await safePath(root,'.runtime/flow-installation.json'),{force:true});
  await materializeDependencies(tools,root);
  const directory = await safePath(root, '.runtime/flow-install'); await mkdir(directory, { recursive: true });
  const env = { ...processEnvironment(), HOME: directory, PLAYWRIGHT_BROWSERS_PATH: browserRoot };
  if(profiles.length&&!browsersReady) {
    const output = await execute(path.join(root, 'node_modules/.bin/playwright'), ['install', ...profiles], { cwd: root, env, timeoutMs: 300000 });
    await writeJson(path.join(directory, 'browsers.json'), output);
    invariant(output.exitCode === 0 && !output.timedOut && !output.overflow, 'INSTALL_FAILED', '瀏覽器安裝失敗，原流程尚未推進。請檢查網路與主機相依套件後重試。');
  }
  // Only after consent/package installation may the versioned Playwright module load.
  browserFiles=await installedBrowserFiles(root,profiles,browserRoot);
  invariant((await Promise.all(browserFiles.map(x => exists(x)))).every(Boolean), 'BROWSER_MISSING', '必要瀏覽器尚未完整安裝。');
  const after = await installationPlan(root, profiles, browserRoot);
  invariant(after.definition.packageHash === plan.definition.packageHash, 'DEPENDENCIES_CHANGED', '套件定義在安裝期間改變，請重新確認。', 409);
  await writeJson(path.join(root, '.runtime/flow-installation.json'), { repositoryId:request.repositoryId,digest: after.digest, browserFiles, installedAt: new Date().toISOString() });
  if(git&&!locked)await savePaths(root, ['package-lock.json'], git, request.repositoryId, 'Save resolved test dependencies');
  return { installed: !reusable||!browsersReady };
}

async function writeDependencyInput(root,relative,content) {
  await atomicWrite(await safePath(root,relative),content);
}
async function installedBrowserFiles(root,profiles,browserRoot) {
  if(!profiles.length)return [];
  const query=await execute(process.execPath,['--input-type=module','-e',
    `import {createRequire} from 'node:module';import path from 'node:path';const require=createRequire(process.cwd()+'/package.json');const core=path.dirname(require.resolve('playwright-core/package.json'));const {registry:{registry}}=require(path.join(core,'lib/coreBundle.js'));console.log(JSON.stringify(registry.resolveBrowsers(${JSON.stringify(profiles)},{}).map(x=>x.executablePath())));`],{cwd:root,env:processEnvironment({PLAYWRIGHT_BROWSERS_PATH:browserRoot}),timeoutMs:15000});
  invariant(query.exitCode===0&&!query.timedOut&&!query.overflow,'BROWSER_PROBE_FAILED','無法確認瀏覽器安裝位置。');return JSON.parse(query.stdout.trim());
}

export async function advanceWorkflow(context) {
  const { root, options, store, request, git } = context;
  const settings = store.preferences(request.repositoryId);
  invariant(settings?.configured, 'SETUP_REQUIRED', '請先完成一次性設定。');
  await git.expect(root, request.expected);
  const input = request.input;
  const key = `${id(input.requirementId)}/${id(input.featureId)}`;
  const data = await scan(root), feature = data.features.find(x => x.key === key);
  invariant(feature, 'FEATURE_NOT_FOUND', '找不到此功能。', 404);
  let review = await reviewState(root, input.requirementId, input.featureId);
  if (request.operation === 'workflow.review') {
    invariant(['gherkin', 'sd', 'tests'].includes(input.stage), 'INVALID_STAGE', '只需確認需求、設計與驗收測試。');
    if (input.stage === 'gherkin') {
      const content = await readFile(await safePath(root, `spec/${key}/${id(input.featureId)}.feature`), 'utf8');
      const diagnostics = requirementDiagnostics(content);
      invariant(!diagnostics.length, 'GHERKIN_INVALID', diagnostics.map(d => `第 ${d.line} 行：${d.message}`).join(' '));
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
    for (const run of store.runs(repositoryId).filter(x => x.state === 'SEALED' && x.result.mode !== 'REGRESSION')) {
      const publication = await publishRun({ root, home: options.home, repositoryId, runId: run.id, git, push: true });
      receipt.completed.push({ kind: 'report', runId: run.id, ...publication }); await writeJson(journalPath, receipt);
    }
    for(const batch of store.regressions(repositoryId).filter(x=>x.status==='COMPLETED'&&!x.imported)) {
      const publication=await publishRegression({root,home:options.home,repositoryId,batch,git,push:true});
      store.recordRegression(repositoryId,{...batch,publication});receipt.completed.push({kind:'regression',...publication});await writeJson(journalPath,receipt);
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
