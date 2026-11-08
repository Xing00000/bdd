import { checkRepositoryIdentity } from './locations.mjs';
/** Read-only acquisition of a bound repository. Never installs packages or discards drafts. */
import path from 'node:path';
import { mkdir, rename, rm, readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { id, invariant, exists, safePath, identity, digest, errorResult } from '../contracts/index.mjs';
import { remoteUrl, commitId, branchName } from '../git-core/index.mjs';
import { initialize, scan } from '../spec-toolkit/index.mjs';
import { ensureDraft } from './authoring.mjs';
import { importBoundRepository } from './projection.mjs';
import { workspaceModules } from '../spec-toolkit/workspace.mjs';
import { reindexReports } from './reports.mjs';

export async function revisionOptions(root, git) {
  const raw = (await git.command(root, ['for-each-ref', '--format=%(refname)\t%(objectname)', 'refs/remotes/origin/', 'refs/tags/'])).stdout;
  const versions = [];
  for (const line of raw.trim().split('\n').filter(Boolean)) {
    const [ref] = line.split('\t');
    if (ref.endsWith('/HEAD')) continue;
    versions.push({ ref, label: ref.replace(/^refs\/remotes\/origin\//, '').replace(/^refs\/tags\//, ''), kind: ref.startsWith('refs/tags/') ? 'tag' : 'branch', commit: await git.resolve(root, ref) });
  }
  const state = await git.inspect(root);
  if (state.head) versions.unshift({ ref: state.head, label: '本地已取得版本', kind: 'commit', commit: state.head });
  return versions;
}
/** No free-form revision expressions: choose a known branch/tag or a full commit. */
export async function selectedCommit(root, ref, git) {
  invariant(typeof ref === 'string', 'VERSION_REQUIRED', '請選擇規格版本。');
  if (/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(ref)) return git.resolve(root, commitId(ref));
  if (ref.startsWith('refs/remotes/origin/') || ref.startsWith('refs/tags/')) {
    const choices = await revisionOptions(root, git);
    invariant(choices.some(x => x.ref === ref), 'VERSION_NOT_FOUND', '找不到所選版本；請重新取得版本清單。', 404);
    return git.resolve(root, ref);
  }
  branchName(ref);
  const options = (await revisionOptions(root, git)).filter(x => x.label === ref);
  invariant(options.length === 1, 'VERSION_NOT_FOUND', '版本不存在或分支與標籤同名，請從清單選擇。', 404);
  return options[0].commit;
}
export async function snapshotRepository({ root, options, repositoryId, git }, ref) {
  const commit = await selectedCommit(root, ref, git);
  const destination = await safePath(options.home, `catalogs/${id(repositoryId)}/${commit}/repo`);
  if (!await exists(destination)) {
    const temporary = `${destination}.pending-${randomUUID()}`;
    try {
      await git.cloneCandidate(root, temporary, commit);
      await mkdir(path.dirname(destination), { recursive: true });
      await rename(temporary, destination);
    } catch (error) {
      if (!await exists(destination)) throw error;
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
  invariant(await git.resolve(destination) === commit && (await git.inspect(destination)).clean, 'CATALOG_CHANGED', '唯讀版本快照已被外部修改，停止讀取。', 409);
  return { root: destination, commit };
}
export async function readVersion(context, ref) {
  const snapshot = await snapshotRepository(context, ref);
  const spec = await scan(snapshot.root), projects = await context.git.modules(snapshot.root);
  return { commit: snapshot.commit, spec, projects: projects.map(({ id, path, url, commit }) => ({ id, path, url, commit })) };
}
export async function readVersionFile(context, ref, relative) {
  invariant(typeof relative === 'string' && /^(spec|tests)\//.test(relative), 'FILE_NOT_READABLE', '只能查看所選版本的需求、設計與測試。', 403);
  const snapshot = await snapshotRepository(context, ref);
  const content = await readFile(await safePath(snapshot.root, relative, { missing: false }), 'utf8');
  invariant(Buffer.byteLength(content) <= 2 * 1024 * 1024, 'FILE_TOO_LARGE', '檔案超過顯示上限。');
  return { path: relative, content, commit: snapshot.commit, readOnly: true };
}
async function initializeMissingProducts(root, git) {
  for (const project of await git.modules(root)) {
    if (project.actual) continue; // never switch a user's product branch or erase its edits
    remoteUrl(project.url, git.policy);
    await git.command(root, ['submodule', 'sync', '--', project.path]);
    await git.command(root, ['submodule', 'update', '--init', '--checkout', '--', project.path]);
    const directory = await safePath(root, project.path);
    invariant(await git.resolve(directory) === project.commit, 'SUBMODULE_VERSION_MISMATCH', project.id);
    invariant(!await exists(path.join(directory, '.gitmodules')), 'NESTED_SUBMODULE_UNSUPPORTED', '巢狀產品引用尚未支援；原始內容已保留。');
  }
}
export async function acquireRepository(context) {
  const { root, options, store, request, git } = context, repositoryId = request.repositoryId;
  const record = store.repository(repositoryId), previous = store.connection(repositoryId);
  invariant(record.remoteUrl,'GIT_NOT_CONFIGURED','此工作區未設定 Git 來源；資料庫內容仍可編輯。',409);
  const status = { ...previous, status: 'LOADING', operationId: request.operationId, localPath: root, startedAt: new Date().toISOString(), error: null };
  store.setConnection(repositoryId, status);
  await mkdir(path.dirname(root), { recursive: true });
  try {
    const acquisitionWarnings=[];
    if (!await exists(root) || (await readdir(root)).length===0) {
      const staging = `${root}.acquire-${randomUUID()}`;
      try {
        await git.clone(record.remoteUrl, staging, record.branch ?? undefined);
        invariant(!await exists(root)||(await readdir(root)).length===0,'LOCAL_PATH_NOT_EMPTY','取得內容期間目錄新增了檔案，未覆寫；請確認資料夾後重試。',409);
        await rename(staging, root);
      } finally { await rm(staging, {recursive:true,force:true}); }
    } else {
      await checkRepositoryIdentity(root,record,git);
      try { await git.fetch(root); }
      catch(error) { acquisitionWarnings.push({code:'REMOTE_UNAVAILABLE',message:'已載入本地內容，但尚未取得遠端更新：'+error.message}); }
    }
    await checkRepositoryIdentity(root,record,git);
    let state = await git.inspect(root);
    const sourceChanges=state.changes.filter(c=>/^(spec\/|tests\/|workbench\.yaml$|bdd\.config\.ts$|playwright\.config\.ts$|package(?:-lock)?\.json$)/.test(c.path));
    const checkoutBases={};
    for(const change of sourceChanges) {
      const old=state.head?await git.command(root,['show',`${state.head}:${change.path}`],{allowFailure:true,binaryOutput:true,maxBytes:4*1024*1024}):null;
      checkoutBases[change.path]=old?.exitCode===0?digest(old.stdout):null;
    }
    status.validatedPath=root;status.checkoutBases=checkoutBases;store.setConnection(repositoryId,status);
    if (!state.head && !await exists(path.join(root, 'workbench.yaml'))) {
      await initialize(root, { specRepositoryId: repositoryId, templateRoot: path.join(options.toolkitRoot, 'templates/spec-repo/v1'), toolkitRoot: path.join(options.toolkitRoot, 'packages') });
      status.managedGitmodulesHash = digest(await readFile(path.join(root, '.gitmodules'))); store.setConnection(repositoryId, status);
      // Initialization owns these exact new template files. Record the local baseline
      // here, not during SQLite saves, so our own empty .gitmodules is not mistaken
      // for a user's conflicting external edit on the first product preparation.
      state = await git.inspect(root);
    }
    let draft = await ensureDraft({ ...context, repositoryId });
    const refs = await revisionOptions(root, git);
    // Import the bound branch's immutable remote revision, not a random editing branch.
    const branch = record.branch ?? state.branch;
    const incoming = refs.find(x => x.ref === `refs/remotes/origin/${branch}`)?.commit ?? state.head;
    const catalogRoot = incoming ? (await snapshotRepository({ ...context, repositoryId }, incoming)).root : root;
    const catalog = await scan(catalogRoot), catalogModules = await git.modules(catalogRoot);
    status.catalog = { commit: incoming, features: catalog.features, projects: catalogModules.map(({ id, path, url, commit }) => ({ id, path, url, commit })) };
    status.versions = refs;
    const warnings = [...acquisitionWarnings];
    if (incoming || await exists(path.join(root, 'workbench.yaml'))) {
      try { draft = await importBoundRepository({ ...context, root: sourceChanges.length?root:catalogRoot, checkoutBases:sourceChanges.length?checkoutBases:{} }, draft); }
      catch (error) { if (!['IMPORT_CONFLICT', 'BINDING_CONFLICT', 'DRAFT_REVISION_CHANGED'].includes(error.code)) throw error; warnings.push(errorResult(error)); }
    }
    try { await initializeMissingProducts(root, git); }
    catch (error) { warnings.push(errorResult(error)); }
    const projection = store.projection(repositoryId);
    if (!warnings.length && !projection) {
      const fingerprints = await workspaceModules(root, draft.settings.projects ?? []);
      const modules = (await git.modules(root)).map(module => { const contentDigest = fingerprints.find(item => item.id === module.id)?.contentDigest; return { ...module, initialized: Boolean(module.actual), contentDigest, checkpointDigest: module.dirty ? null : contentDigest }; });
      const completedAcceptances = draft.files.filter(file => /\/acceptance\.json$/.test(file.path) && file.sha256 === file.baseHash).flatMap(file => { try { return JSON.parse(file.content).items.map(item => item.id); } catch { return []; } });
      store.setProjection(repositoryId, { status: 'IMPORTED', revision: draft.revision, head: state.head, branch: state.branch, modules, completedAcceptances,
        files: draft.files.filter(f => f.baseHash).map(({ target, path, baseHash }) => ({ target, path, sha256: baseHash })) });
    }
    let history = { indexed: [], errors: [] };
    if (state.head) {
      // Include earlier report commits even when reports were deleted from the branch tip.
      const commits = (await git.command(root, ['log', '--all', '--format=%H', '--max-count=201', '--', 'reports/'])).stdout.trim().split('\n').filter(Boolean);
      history = await reindexReports({ root, home: options.home, repositoryId, git, store, refs: [...new Set(['HEAD', ...refs.filter(x => x.label.startsWith('evidence/')).map(x => x.ref), ...commits.slice(0, 190)])].slice(0, 200) });
      status.nextHistoryOffset=commits.length>190?190:null;
      if (commits.length > 190) warnings.push({ code: 'HISTORY_PAGINATED', message: '歷史報告超過首批索引範圍，可在歷史頁載入更早紀錄。' });
      warnings.push(...history.errors);
    }
    Object.assign(status, { status: warnings.length ? 'READY_WITH_WARNINGS' : 'READY', warnings, indexedReports: store.reports(repositoryId).length, updatedAt: new Date().toISOString() });
    store.setConnection(repositoryId, status);
    return { ...status, bindingSaved: true, sourceRevision: draft.revision };
  } catch (error) {
    Object.assign(status, { status: 'FAILED', error: errorResult(error), updatedAt: new Date().toISOString() });
    store.setConnection(repositoryId, status);
    error.details = { ...error.details, bindingSaved: true, localPath: root }; throw error;
  }
}
/** Product versions are cached separately; browsing never changes a product checkout. */
export async function productCache(context, project, refresh = false) {
  remoteUrl(project.url, context.git.policy);
  const folder = await safePath(context.options.home, `version-products/${id(context.repositoryId)}/${identity(project.url)}/repo`);
  if (!await exists(folder)) await context.git.clone(project.url, folder);
  else if (refresh) await context.git.fetch(folder);
  return folder;
}
export async function versionCatalog(context, ref, refresh = false) {
  const version = await readVersion(context, ref), projects = [];
  for (const p of version.projects) {
    try { const cache = await productCache(context, p, refresh); projects.push({ ...p, versions: await revisionOptions(cache, context.git) }); }
    catch (error) { projects.push({ ...p, versions: [], error: errorResult(error) }); }
  }
  return { ...version, projects };
}

export async function moreReportHistory(context) {
  const {root,store,options,request,git}=context, repositoryId=request.repositoryId;
  const current=store.connection(repositoryId);
  invariant(Number.isInteger(current?.nextHistoryOffset),'HISTORY_COMPLETE','已載入全部可取得的報告歷史。');
  const rows=(await git.command(root,['log','--all','--format=%H',`--skip=${current.nextHistoryOffset}`,'--max-count=191','--','reports/'])).stdout.trim().split('\n').filter(Boolean);
  const result=rows.length?await reindexReports({root,home:options.home,repositoryId,git,store,refs:rows.slice(0,190)}):{indexed:[],errors:[]};
  store.setConnection(repositoryId,{...current,nextHistoryOffset:rows.length>190?current.nextHistoryOffset+190:null,
    indexedReports:store.reports(repositoryId).length,warnings:[...(current.warnings??[]).filter(x=>x.code!=='HISTORY_PAGINATED'),...result.errors]});
  return result;
}
