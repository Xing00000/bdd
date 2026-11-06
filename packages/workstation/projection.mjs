import { canonicalLocation, checkRepositoryIdentity, remoteIdentity } from './locations.mjs';
/** Working files are a SQLite projection. Only explicit lifecycle boundaries commit. */
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { invariant, digest, identity, exists, safePath, atomicWrite } from '../contracts/index.mjs';
import { ensureDraft, sourceFiles, inDraftView } from './authoring.mjs';
import { configuration, reviewState } from '../spec-toolkit/index.mjs';
import { configureExecution } from './repository-actions.mjs';
import { savePaths, attached, defaultBranch, targetFor } from './flows.mjs';
import { workspaceModules, workspaceEntries, workspaceSpecSourceDigest, specSourcePath, specSourceDigest } from '../spec-toolkit/workspace.mjs';
import { specCheckpointDigest } from '../spec-toolkit/source-checkpoint.mjs';
import { liveWorkflowSpecSourceDigest } from './workflow-state.mjs';

const key = f => `${f.target}\0${f.path}`;
async function fileHash(root, relative) {
  const file=await safePath(root,relative);
  return await exists(file)?digest(await readFile(file)):null;
}
export async function prepareProjection(context) {
  const { root, store, request } = context, repositoryId = request.repositoryId;
  const snapshot = await ensureDraft({ ...context, repositoryId }), prior = store.projection(repositoryId);
  invariant(snapshot.settings.configured, 'SETUP_REQUIRED', '請先儲存基本設定。');
  invariant(canonicalLocation(root) === root && await exists(root), 'FEATURE_INITIALIZATION_REQUIRED', '請先建立功能以初始化工作目錄；編輯與執行不會自動操作 Git。', 409);
  const targets = [{ target: 'spec', directory: root }, ...(snapshot.settings.projects ?? []).map(project => ({ target: `project:${project.id}`, directory: path.join(root, 'projects', project.id) }))];
  // All files are checked before writing any of them. External edits remain on disk.
  for (const target of targets) {
    invariant(await exists(target.directory), 'FEATURE_INITIALIZATION_REQUIRED', '產品原始碼尚未初始化；請在建立功能時取得產品。', 409);
    for (const file of snapshot.files.filter(file => file.target === target.target)) {
      const current = await fileHash(target.directory, file.path), old = prior?.files?.find(previous => key(previous) === key(file))?.sha256 ?? file.baseHash;
      invariant(current === file.sha256 || current === old || current === null && old === null, 'EXPORT_CONFLICT',
        `內容已存入 SQLite；工作目錄中的 ${file.path} 另有修改，原檔已保留。請先處理內容差異。`, 409);
    }
  }
  for (const target of targets) for (const file of snapshot.files.filter(file => file.target === target.target))
    if (await fileHash(target.directory, file.path) !== file.sha256) await atomicWrite(await safePath(target.directory, file.path), file.content);
  const modules = await workspaceModules(root, snapshot.settings.projects ?? []);
  store.setProjection(repositoryId, { ...prior, status: 'MATERIALIZED', revision: snapshot.revision,
    files: snapshot.files.map(({ target, path, sha256 }) => ({ target, path, sha256 })),
    modules: modules.map(module => { const previous = prior?.modules?.find(item => item.id === module.id); return { ...previous, ...module, dirty: Boolean(previous?.checkpointDigest && previous.checkpointDigest !== module.contentDigest) }; }) });
  return snapshot;
}

/** Feature creation and completed human acceptance are the only automatic Git boundaries. */
export async function checkpointProjection(context) {
  const {root,store,options,request,git}=context,repositoryId=request.repositoryId;
  invariant(request.operation === 'workflow.create' || request.operation === 'workflow.accept'
    || request.operation === 'workflow.requirement.save' && !request.input.requirementId && !request.input.featureId,
  'GIT_BOUNDARY_REQUIRED', '只有建立功能與完成人工驗收可以建立 Git 版本。', 409);
  store.repairImportBaselines(repositoryId);
  let snapshot=await ensureDraft({...context,repositoryId});
  if (context.expectedRevision !== undefined) invariant(snapshot.revision === context.expectedRevision, 'CONTENT_CHANGED', '驗收期間已儲存新草稿；原確認已保留，未把新草稿一起提交。', 409);
  if (context.acceptance) {
    const review = await inDraftView(snapshot, view => reviewState(view, request.input.requirementId, request.input.featureId));
    invariant(identity(context.acceptance.sourceDigests) === identity({ gherkin: review.hashes.gherkin, sd: review.hashes.sd, tests: review.hashes.tests }), 'CONTENT_CHANGED', '驗收來源已改變；請重新驗證。', 409);
    invariant(context.acceptedManifest, 'REPORT_CHANGED', '找不到這次人工驗收的完整報告。', 409);
    if (context.acceptedManifest.sourceKind === 'WORKSPACE') invariant(typeof context.acceptedManifest.specSourceDigest === 'string'
      && await liveWorkflowSpecSourceDigest(context, snapshot) === context.acceptedManifest.specSourceDigest,
    'CONTENT_CHANGED', '驗收報告與目前規格來源不同；請重新驗證。', 409);
  }
  const record=store.repository(repositoryId),prior=store.projection(repositoryId);
  invariant(snapshot.settings.configured,'SETUP_REQUIRED','請先儲存基本設定。');
  const receipt={...(prior??{}),status:'PREPARING',sourceRevision:snapshot.revision};
  try {
    const fresh=!await exists(root);
    if(fresh) {
      await git.clone(record.remoteUrl,root,record.branch??undefined);
      if(await exists(path.join(root,'workbench.yaml')))snapshot=await importBoundRepository(context,snapshot);
    }
    await checkRepositoryIdentity(root,record,git);
    // A repository configuration error is an export/sync error, not a save error.
    const specFiles=snapshot.files.filter(f=>f.target==='spec');
    const preflight=async(target,files)=>{
      for(const file of files) {
        const current=await fileHash(target,file.path),old=prior?.files?.find(m=>key(m)===key(file))?.sha256??file.baseHash;
        invariant(current===null&&(old===null||fresh)||current===file.sha256||current===old,'EXPORT_CONFLICT',
          `內容已存入 SQLite；Repo 中的 ${file.path} 另有修改，暫停輸出以免覆蓋。可繼續編輯與儲存，請先處理同步差異。`,409);
      }
    };
    await preflight(root,specFiles);
    const modules=await git.modules(root); let commitManagedGitmodules=false;
    if(snapshot.settings.projects.some(p=>!modules.some(m=>m.id===p.id))) {
      const state=await git.inspect(root);
      const managed = store.connection(repositoryId)?.managedGitmodulesHash;
      invariant(!state.changes.some(c=>c.path==='.gitmodules') || managed && await fileHash(root,'.gitmodules')===managed,'SUBMODULE_SETTINGS_CONFLICT','產品連結檔另有修改；設定已存 SQLite，尚未覆寫 Repo。',409);
      commitManagedGitmodules = state.changes.some(c=>c.path==='.gitmodules') && Boolean(managed);
    }
    // Check all existing products before changing any source file.
    for(const p of snapshot.settings.projects??[]) {
      const module=modules.find(m=>m.id===p.id);
      invariant(!module||remoteIdentity(module.url)===remoteIdentity(p.url),'PROJECT_SOURCE_CHANGED','已保存設定，但既有產品連結來源不同，未覆寫。',409);
      if(module?.actual)await preflight(path.join(root,module.path),snapshot.files.filter(f=>f.target===`project:${p.id}`));
    }
    for(const file of specFiles)if(await fileHash(root,file.path)!==file.sha256)await atomicWrite(await safePath(root,file.path),file.content);
    const acceptedSourcePaths = [];
    if (context.acceptedManifest?.sourceKind === 'WORKSPACE') {
      const entries = await workspaceEntries(root, { spec: true });
      invariant(specSourceDigest(entries) === context.acceptedManifest.specSourceDigest, 'CONTENT_CHANGED', '驗收期間規格來源已改變；沒有提交未驗證的來源。', 409);
      acceptedSourcePaths.push(...entries.map(entry => entry.path));
      // SQL owns its editor paths; the verified snapshot also owns external
      // helpers and their deletions at this explicit acceptance checkpoint.
      const changes = (await git.inspect(root)).changes;
      for (const relative of new Set(changes.flatMap(change => [change.path, ...(change.originalPath ? [change.originalPath] : [])])))
        if (specSourcePath(relative) && !await exists(await safePath(root, relative))) acceptedSourcePaths.push(relative);
    }
    await savePaths(root,[...specFiles.map(f=>f.path),...acceptedSourcePaths,...(commitManagedGitmodules?['.gitmodules']:[])],git,repositoryId,`Export SQLite revision ${snapshot.revision}`);
    // The receipt is a recoverable projection checkpoint. It never advances the saved revision.
    receipt.files=specFiles.map(({target,path,sha256})=>({target,path,sha256}));store.setProjection(repositoryId,receipt);
    if((await git.modules(root)).some(m=>!m.actual))await git.restore(root,await git.inspect(root));
    const destinations=[];
    for(const p of snapshot.settings.projects??[]) {
      let module=(await git.modules(root)).find(m=>m.id===p.id);
      const branch=prior?.destinations?.projects?.find(m=>m.id===p.id)?.branch ?? snapshot.settings.sync?.projects?.find(m=>m.id===p.id)?.branch ?? await defaultBranch(p.url,git);
      if(!module) {
        const commit=await git.remoteHead(p.url,branch);
        await git.addModule(root,{projectId:p.id,url:p.url,commit},await git.inspect(root));
        await savePaths(root,['.gitmodules',`projects/${p.id}`],git,repositoryId,`Bind saved product ${p.id}`);
        module=(await git.modules(root)).find(m=>m.id===p.id);
      }
      const target=path.join(root,module.path),files=snapshot.files.filter(f=>f.target===`project:${p.id}`);
      const deleted=(prior?.deletedFiles??[]).filter(file=>file.target===`project:${p.id}`);
      await preflight(target,files);
      for (const file of deleted) invariant(!await exists(await safePath(target,file.path)), 'EXPORT_CONFLICT', `產品 ${file.path} 已重新出現，未自動提交刪除。`, 409);
      for(const file of files)if(await fileHash(target,file.path)!==file.sha256)await atomicWrite(await safePath(target,file.path),file.content);
      if(files.length||deleted.length) {
        await savePaths(target,[...files,...deleted].map(f=>f.path),git,repositoryId,`Export product SQLite revision ${snapshot.revision}`);
        await savePaths(root,[module.path],git,repositoryId,`Record saved product ${p.id}`);
      }
      destinations.push({id:p.id,...await targetFor(target,git,branch)});
      receipt.files.push(...files.map(({target,path,sha256})=>({target,path,sha256})));store.setProjection(repositoryId,receipt);
    }
    const state=await attached(root,git,repositoryId);
    const destination=await targetFor(root,git,prior?.destinations?.spec?.branch??snapshot.settings.sync?.spec?.branch??state.branch);
    const expected=prior?.destinations??snapshot.settings.sync;
    if(expected)invariant(identity(expected.spec)===identity(destination)&&destinations.every(p=>{
      const old=expected.projects?.find(x=>x.id===p.id);return !old||identity(old)===identity(p);
    }),'SYNC_DESTINATION_CHANGED','同步來源被外部程式修改；SQLite 內容已保存，系統未上傳至新位置。',409);
    const fingerprints = await workspaceModules(root, snapshot.settings.projects ?? []);
    const checkpointModules = (await git.modules(root)).map(module => { const contentDigest = fingerprints.find(item => item.id === module.id)?.contentDigest; return { ...module, initialized: true, contentDigest, checkpointDigest: contentDigest }; });
    invariant(checkpointModules.every(module => !module.dirty && module.actual === module.commit), 'ACCEPTANCE_CHECKPOINT_CHANGED', '提交期間產品又有修改；人類確認已保留，請處理差異後重試。', 409);
    if (context.acceptedManifest) invariant(context.acceptedManifest.projects.length === checkpointModules.length && checkpointModules.every(module => context.acceptedManifest.projects.some(project => project.id === module.id && (project.contentDigest ? project.contentDigest === module.contentDigest : project.commit === module.actual))), 'CONTENT_CHANGED', '驗收報告與提交的產品來源不同；沒有標記驗收完成。', 409);
    if (context.acceptedManifest?.sourceKind === 'WORKSPACE') invariant(await specCheckpointDigest(root, git, state.head) === context.acceptedManifest.specSourceDigest
      && await workspaceSpecSourceDigest(root) === context.acceptedManifest.specSourceDigest,
    'CONTENT_CHANGED', '驗收期間規格來源又有修改，或提交內容與報告不同；沒有標記驗收完成。', 409);
    invariant(store.draft(repositoryId).revision === snapshot.revision, 'CONTENT_CHANGED', '驗收期間已儲存新草稿；原確認已保留，未標記新草稿已驗收。', 409);
    Object.assign(receipt,{status:'PREPARED',revision:snapshot.revision,checkpointRevision:snapshot.revision,checkpointKind:context.acceptance?'ACCEPTANCE_PENDING':'CREATED',deletedFiles:[],head:state.head,branch:state.branch,modules:checkpointModules,destinations:{spec:destination,projects:destinations}});
    store.setProjection(repositoryId,receipt);
    store.setPreferences(repositoryId,{...store.draft(repositoryId).settings,sync:receipt.destinations});
    store.setConnection(repositoryId,{...store.connection(repositoryId),status:'READY',localPath:root,validatedPath:root,managedGitmodulesHash:null,updatedAt:new Date().toISOString()});
    return snapshot;
  } catch(error) {
    store.setProjection(repositoryId,{...receipt,status:'FAILED',error:{code:error.code,message:error.message}});
    error.details={...error.details,saved:true,storage:'sqlite',revision:snapshot.revision};throw error;
  }
}
/** Only runner-owned derived files may return to authoring; do not overwrite concurrent drafts. */
export async function captureExecutionFiles(context,snapshot) {
  const {root,store,request}=context,paths=['package-lock.json'];
  if(request.operation==='workflow.review')paths.push(`spec/${request.input.requirementId}/review.json`);
  const files=[];
  for(const relative of paths) {
    if(!await exists(path.join(root,relative)))continue;
    const content=await readFile(await safePath(root,relative),'utf8');
    if(snapshot.files.some(f=>f.target==='spec'&&f.path===relative&&f.sha256===digest(content)))continue;
    files.push({target:'spec',path:relative,content,baseHash:digest(content)});
  }
  if(files.length) {
    invariant(store.draft(request.repositoryId).revision===snapshot.revision,'CONTENT_CHANGED','執行期間已儲存新內容；舊版本的檢查或確認不會覆蓋新草稿。',409);
    store.saveDraft(request.repositoryId,{expectedRevision:snapshot.revision,files,operationId:`derived-${request.operationId}`,request:{operation:request.operation,sourceRevision:snapshot.revision},result:{derived:true}});
  }
  const current=store.draft(request.repositoryId),prior=store.projection(request.repositoryId);
  const modules = await workspaceModules(root, current.settings.projects ?? []);
  store.setProjection(request.repositoryId,{...prior,revision:files.length ? current.revision : snapshot.revision,modules:modules.map(module=>({...prior?.modules?.find(item=>item.id===module.id),...module})),
    files:[...(prior?.files??[]).filter(f=>!files.some(m=>key(m)===key(f))),...files.map(f=>({target:f.target,path:f.path,sha256:digest(f.content)}))]});
}

/** A newly bound, existing Spec repo is imported without replacing authored local drafts. */
export async function importBoundRepository(context,snapshot) {
  const initialSnapshot = snapshot;
  // Binding and local saves intentionally run concurrently. A different SQL
  // revision is not itself a content conflict: re-read and repeat the merge
  // checks against the new snapshot before retrying the compare-and-swap.
  for(let attempt=0;attempt<4;attempt++) {
    try { return await importBoundSnapshot({...context, initialSnapshot},snapshot); }
    catch(error) {
      if(error.code!=='DRAFT_REVISION_CHANGED'||attempt===3)throw error;
      snapshot=context.store.draft(context.request.repositoryId);
    }
  }
}
async function importBoundSnapshot(context,snapshot) {
  const {root,store,request,git}=context,repositoryId=request.repositoryId;
  const config=await configuration(root),incoming=await sourceFiles(root),seed=store.draftSeed(repositoryId);
  for(const file of incoming) {
    file.origin='checkout';
    if(Object.hasOwn(context.checkoutBases??{},file.path))file.baseHash=context.checkoutBases[file.path];
  }
  const settings={...snapshot.settings,projects:[...(snapshot.settings.projects??[])]};
  for(const module of await git.modules(root)) {
    const binding=settings.projects.find(p=>p.id===module.id);
    invariant(!binding||remoteIdentity(binding.url)===remoteIdentity(module.url),'BINDING_CONFLICT','綁定來源中的產品代號與本機設定衝突；SQLite 內容已保留。',409);
    if(!binding)settings.projects.push({id:module.id,url:module.url});
  }
  config.projects=settings.projects.map(p=>({id:p.id,path:`projects/${p.id}`}));
  if(Object.hasOwn(settings,'globalTimeoutMs')) {
    if(settings.globalTimeoutMs===null) delete config.execution.globalTimeoutMs;
    else config.execution.globalTimeoutMs=settings.globalTimeoutMs;
  } else settings.globalTimeoutMs=config.execution.globalTimeoutMs??null;
  const changes=[];
  for(const file of incoming) {
    const current=snapshot.files.find(f=>key(f)===key(file));
    if(file.path==='workbench.yaml') {
      if(current && current.sha256!==current.baseHash && !seed.some(f=>f.origin!=='checkout'&&!f.baseHash&&key(f)===key(current)&&digest(f.content)===current.sha256)) {
        // Preserve the saved edit, but learn the unchanged checkout baseline on
        // first acquisition. A prior non-null base is retained by saveDraft, so
        // subsequent external edits still conflict instead of being overwritten.
        changes.push({...file,content:current.content});continue;
      }
      let content=JSON.stringify(config,null,2)+'\n';
      if(settings.execution)await inDraftView({files:[{target:'spec',path:'workbench.yaml',content}]},async view=>{
        await configureExecution(view,{...settings.execution,expectedHash:digest(content)});
        content=await readFile(path.join(view,'workbench.yaml'),'utf8');
      });
      else if(config.execution.service)settings.execution={projectId:config.execution.service.projectId,baseUrl:config.execution.environment?.WB_TARGET_BASE_URL,healthUrl:config.execution.service.healthUrl,command:config.execution.service.command};
      changes.push({...file,content});continue;
    }
    // Derived progress is recomputed from accepted sources/reviews/evidence; its
    // cached timestamp or last-run pointer must not veto an otherwise safe import.
    if(/^spec\/[^/]+\/[^/]+\/workflow\.json$/.test(file.path)){changes.push(file);continue;}
    // A local draft can coexist with an unchanged incoming base: preserve it.
    if (current && current.baseHash && current.sha256 !== current.baseHash && digest(file.content) === current.baseHash && context.initialSnapshot.files.find(f=>key(f)===key(current))?.sha256 === current.sha256) { changes.push({...file, content:current.content}); continue; }
    invariant(!current||current.sha256===digest(file.content)||current.sha256===current.baseHash||seed.some(f=>f.origin!=='checkout'&&!f.baseHash&&key(f)===key(current)&&digest(f.content)===current.sha256),
      'IMPORT_CONFLICT',`遠端的 ${file.path} 與 SQLite 草稿不同，兩份內容都保留，未自動覆蓋。`,409);
    changes.push(file);
  }
  store.saveDraft(repositoryId,{expectedRevision:snapshot.revision,settings,files:changes,acceptIncomingBases:true,operationId:`import-${request.operationId}`,request:{head:(await git.inspect(root)).head,sourceRevision:snapshot.revision},result:{imported:true}});
  const projection=store.projection(repositoryId);
  if(projection) {
    const accepted=new Map(changes.map(file=>[key(file),file.baseHash]));
    store.setProjection(repositoryId,{...projection,revision:store.draft(repositoryId).revision,
      files:[...(projection.files??[]).filter(file=>!accepted.has(key(file))),...changes.map(file=>({target:file.target,path:file.path,sha256:file.baseHash}))]});
  }
  return store.draft(repositoryId);
}
export async function captureSynchronized(context,snapshot) {
  const {root,store,request,git}=context,repositoryId=request.repositoryId;
  if(store.draft(repositoryId).revision!==snapshot.revision)return snapshot.revision;
  const files=await sourceFiles(root);
  for(const entry of snapshot.files.filter(f=>f.target!=='spec')) {
    const file=await safePath(path.join(root,'projects',entry.target.slice('project:'.length)),entry.path);
    if(await exists(file))files.push({...entry,content:await readFile(file,'utf8')});
  }
  const changes=files.filter(f=>!snapshot.files.some(x=>key(x)===key(f)&&x.sha256===digest(f.content)));
  if(changes.length)store.saveDraft(repositoryId,{expectedRevision:snapshot.revision,files:changes,operationId:`sync-${request.operationId}`,request:{sourceRevision:snapshot.revision},result:{receivedRemote:true}});
  const draft=store.draft(repositoryId),projection=store.projection(repositoryId);
  store.setProjection(repositoryId,{...projection,revision:draft.revision,head:await git.resolve(root),modules:await git.modules(root),files:files.map(f=>({target:f.target,path:f.path,sha256:digest(f.content)}))});
  return draft.revision;
}
