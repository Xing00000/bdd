import { checkRepositoryIdentity, remoteIdentity } from './locations.mjs';
/** Export a fixed SQLite revision only for repository preparation/synchronization/execution. */
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { invariant, digest, identity, exists, safePath, atomicWrite } from '../contracts/index.mjs';
import { ensureDraft, sourceFiles, inDraftView } from './authoring.mjs';
import { configuration } from '../spec-toolkit/index.mjs';
import { configureExecution } from './repository-actions.mjs';
import { savePaths, attached, defaultBranch, targetFor } from './flows.mjs';

const key = f => `${f.target}\0${f.path}`;
async function fileHash(root, relative) {
  const file=await safePath(root,relative);
  return await exists(file)?digest(await readFile(file)):null;
}
export async function prepareProjection(context) {
  const {root,store,options,request,git}=context,repositoryId=request.repositoryId;
  let snapshot=await ensureDraft({...context,repositoryId});
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
    const modules=await git.modules(root);
    if(snapshot.settings.projects.some(p=>!modules.some(m=>m.id===p.id))) {
      const state=await git.inspect(root);
      invariant(!state.changes.some(c=>c.path==='.gitmodules'),'SUBMODULE_SETTINGS_CONFLICT','產品連結檔另有修改；設定已存 SQLite，尚未覆寫 Repo。',409);
    }
    // Check all existing products before changing any source file.
    for(const p of snapshot.settings.projects??[]) {
      const module=modules.find(m=>m.id===p.id);
      invariant(!module||remoteIdentity(module.url)===remoteIdentity(p.url),'PROJECT_SOURCE_CHANGED','已保存設定，但既有產品連結來源不同，未覆寫。',409);
      if(module?.actual)await preflight(path.join(root,module.path),snapshot.files.filter(f=>f.target===`project:${p.id}`));
    }
    for(const file of specFiles)if(await fileHash(root,file.path)!==file.sha256)await atomicWrite(await safePath(root,file.path),file.content);
    await savePaths(root,specFiles.map(f=>f.path),git,repositoryId,`Export SQLite revision ${snapshot.revision}`);
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
      await preflight(target,files);
      for(const file of files)if(await fileHash(target,file.path)!==file.sha256)await atomicWrite(await safePath(target,file.path),file.content);
      if(files.length) {
        await savePaths(target,files.map(f=>f.path),git,repositoryId,`Export product SQLite revision ${snapshot.revision}`);
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
    Object.assign(receipt,{status:'PREPARED',revision:snapshot.revision,head:state.head,branch:state.branch,modules:await git.modules(root),destinations:{spec:destination,projects:destinations}});
    store.setProjection(repositoryId,receipt);
    store.setPreferences(repositoryId,{...store.draft(repositoryId).settings,sync:receipt.destinations});
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
  store.setProjection(request.repositoryId,{...prior,revision:files.length ? current.revision : snapshot.revision,head:await context.git.resolve(root),modules:await context.git.modules(root),
    files:[...(prior?.files??[]).filter(f=>!files.some(m=>key(m)===key(f))),...files.map(f=>({target:f.target,path:f.path,sha256:digest(f.content)}))]});
}

/** A newly bound, existing Spec repo is imported without replacing authored local drafts. */
export async function importBoundRepository(context,snapshot) {
  // Binding and local saves intentionally run concurrently. A different SQL
  // revision is not itself a content conflict: re-read and repeat the merge
  // checks against the new snapshot before retrying the compare-and-swap.
  for(let attempt=0;attempt<4;attempt++) {
    try { return await importBoundSnapshot(context,snapshot); }
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
    invariant(!current||current.sha256===digest(file.content)||current.sha256===current.baseHash||seed.some(f=>f.origin!=='checkout'&&!f.baseHash&&key(f)===key(current)&&digest(f.content)===current.sha256),
      'IMPORT_CONFLICT',`遠端的 ${file.path} 與 SQLite 草稿不同，兩份內容都保留，未自動覆蓋。`,409);
    changes.push(file);
  }
  store.saveDraft(repositoryId,{expectedRevision:snapshot.revision,settings,files:changes,operationId:`import-${request.operationId}`,request:{head:await git.resolve(root),sourceRevision:snapshot.revision},result:{imported:true}});
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
