import { canonicalLocation } from './locations.mjs';
/** Authoring does not invoke Git, create branches, download repositories or execute repository code. */
import path from 'node:path';
import { saveComposer, requirementDiagnostics } from './requirements.mjs';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, readdir, rm, lstat } from 'node:fs/promises';
import { id, invariant, digest, identity, safePath, exists, walk, atomicWrite, writeJson, readJson } from '../contracts/index.mjs';
import { remoteUrl } from '../git-core/index.mjs';
import { initialize, configuration, createFeature, scan, saveFile, buildGuidedFeature, parseGuidedFeature, reviewState, confirm } from '../spec-toolkit/index.mjs';
import { configureFeature, configureExecution, sourcePath } from './repository-actions.mjs';

const topFiles = ['workbench.yaml','package.json','package-lock.json','bdd.config.ts','playwright.config.ts','.gitignore','.gitattributes','README.md'];
const sourceFolders = ['spec','tests','.workbench-tools'];
export { isLocalSave as localAuthoring } from './draft-store.mjs';
const fileKey = f => `${f.target}\0${f.path}`;
export async function inDraftView(snapshot, fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bdd-authoring-'));
  try {
    for (const file of snapshot.files.filter(x => x.target === 'spec')) await atomicWrite(await safePath(root,file.path),file.content);
    return await fn(root);
  } finally { await rm(root,{recursive:true,force:true}); }
}
export async function sourceFiles(root) {
  const paths = [];
  for (const file of topFiles) if (await exists(await safePath(root,file))) paths.push(file);
  for (const folder of sourceFolders) if (await exists(await safePath(root,folder)))
    for (const file of await walk(await safePath(root,folder))) paths.push(`${folder}/${file}`);
  invariant(paths.length <= 10000,'AUTHORING_SIZE_LIMIT','規格檔案數量超過上限，尚未修改原始檔案。');
  const files = []; let total = 0;
  for (const relative of paths) {
    const file = await safePath(root,relative,{missing:false}), size = (await lstat(file)).size;
    invariant(size <= 4*1024*1024 && (total += size) <= 64*1024*1024,'AUTHORING_SIZE_LIMIT','規格文字超過匯入上限，原始檔案已保留。');
    const bytes = await readFile(file);
    invariant(!bytes.includes(0) && Buffer.from(bytes.toString('utf8')).equals(bytes),'BINARY_FILE',`規格文字不支援二進位內容：${relative}`);
    files.push({target:'spec',path:relative,content:bytes.toString('utf8'),baseHash:digest(bytes)});
  }
  return files;
}
/** Import an existing local checkout read-only, once. No clean-status/HEAD check. */
export async function ensureDraft({ root, options, store, repositoryId }) {
  const current = store.draft(repositoryId); if (current) return current;
  const temporary = await mkdtemp(path.join(os.tmpdir(),'bdd-authoring-seed-'));
  try {
    await initialize(temporary,{specRepositoryId:repositoryId,templateRoot:path.join(options.toolkitRoot,'templates/spec-repo/v1'),toolkitRoot:path.join(options.toolkitRoot,'packages')});
    const files = (await sourceFiles(temporary)).map(f => ({...f,baseHash:null}));
    const binding=store.repository(repositoryId);
    let allowCheckout=!binding.localPath;
    try { allowCheckout ||= store.connection(repositoryId)?.validatedPath===binding.localPath && canonicalLocation(root)===root; } catch { /* SQL bootstrap remains available when a disk is missing. */ }
    if (allowCheckout && await exists(root)) for (const f of await sourceFiles(root)) {
      const bases=store.connection(repositoryId)?.checkoutBases??{};
      if(Object.hasOwn(bases,f.path))f.baseHash=bases[f.path];
      f.origin='checkout';
      const index = files.findIndex(x=>x.path === f.path); if (index >= 0) files[index]=f; else files.push(f);
    }
    const prior = store.preferences(repositoryId), configFile=files.find(f=>f.path==='workbench.yaml');
    let config; try { config=JSON.parse(configFile.content); } catch { /* Preserve malformed original in history; setup may repair its structured form. */ }
    const projects = prior?.projects ?? prior?.sync?.projects?.map(p=>({id:p.id,url:p.url})) ?? [];
    // Recover binding URLs from the existing .gitmodules text without running Git.
    if(allowCheckout && await exists(path.join(root,'.gitmodules'))) {
      const text=await readFile(await safePath(root,'.gitmodules'),'utf8');
      for(const section of text.split(/(?=^\[submodule )/m)) {
        const p=/^\s*path\s*=\s*projects\/([A-Za-z0-9_-]+)\s*$/m.exec(section)?.[1], url=/^\s*url\s*=\s*(.+?)\s*$/m.exec(section)?.[1];
        if(p&&url&&!projects.some(x=>x.id===p))projects.push({id:p,url});
      }
    }
    const settings={...prior,schemaVersion:1,reviewer:prior?.reviewer??'',configured:Boolean(prior?.configured),projects,
      ...(config?.execution?.service ? {execution:{projectId:config.execution.service.projectId,baseUrl:config.execution.environment?.WB_TARGET_BASE_URL,healthUrl:config.execution.service.healthUrl,command:config.execution.service.command}} : {})};
    try { store.saveDraft(repositoryId,{expectedRevision:null,settings,files,operationId:'sqlite-bootstrap-v5',request:{bootstrap:5},result:{imported:true,previousSettingsToken:identity(prior)}}); }
    catch(error) { if(error.code!=='DRAFT_REVISION_CHANGED'&&error.code!=='OPERATION_ID_CONFLICT')throw error; }
    return store.draft(repositoryId);
  } finally { await rm(temporary,{recursive:true,force:true}); }
}
export async function draftDetail(context) {
  const repositoryId=context.repository.id;
  const snapshot=await ensureDraft({...context,repositoryId}), projection=context.store.projection(repositoryId);
  let spec,specError;
  await inDraftView(snapshot,async root=>{
    try { spec=await scan(root); for(const f of spec.features) f.review=await reviewState(root,f.requirementId,f.id); }
    catch(error){specError={code:error.code,message:error.message};}
  });
  const modules=(snapshot.settings.projects??[]).map(p=>({id:p.id,path:`projects/${p.id}`,url:p.url,
    ...projection?.modules?.find(x=>x.id===p.id),
    dirty:snapshot.files.some(f=>f.target===`project:${p.id}`&&!projection?.files?.some(m=>m.target===f.target&&m.path===f.path&&m.sha256===f.sha256))}));
  return {...context.repository,initialized:true,state:{head:projection?.head??null,branch:projection?.branch??null,clean:true,changes:[]},
    spec,specError,modules,dependencies:{installed:false},preferences:snapshot.settings,
    authoring:{storage:'sqlite',revision:snapshot.revision,projectedRevision:projection?.revision??null,updatedAt:snapshot.updatedAt},projection};
}
export async function readDraftFile(context, relative, target='spec', project=false) {
  const snapshot=await ensureDraft(context);
  if(project) {
    id(target);sourcePath(relative);
    invariant(snapshot.settings.projects?.some(p=>p.id===target),'UNKNOWN_PROJECT','這個產品不屬於所選規格庫。',404);
  } else invariant(/^(spec|tests)\//.test(relative)||topFiles.includes(relative),'FILE_NOT_READABLE','只能開啟規格、測試及設定檔。',403);
  const storageTarget=project?`project:${target}`:'spec';
  const item=snapshot.files.find(f=>f.target===storageTarget&&f.path===relative);
  if(item)return {path:relative,...(project?{projectId:target}:{}),content:item.content,sha256:item.sha256,revision:snapshot.revision,storage:'sqlite'};
  const binding=context.store.repository(context.repositoryId);
  if(binding.localPath) invariant(context.store.connection(context.repositoryId)?.validatedPath===binding.localPath && canonicalLocation(context.root)===context.root,'LOCAL_CONTENT_UNAVAILABLE','本地內容尚未安全載入；SQLite 已儲存內容不受影響。',409);
  const base=!project?context.root:await safePath(context.root,`projects/${target}`,{missing:false});
  const file=await safePath(base,relative,{missing:false});
  invariant((await lstat(file)).size<=2*1024*1024,'FILE_TOO_LARGE','編輯器只接受 2 MiB 內的文字檔。');
  const bytes=await readFile(file);invariant(!bytes.includes(0)&&Buffer.from(bytes.toString('utf8')).equals(bytes),'BINARY_FILE','編輯器只接受 UTF-8 文字。');
  return {path:relative,...(project?{projectId:target}:{}),content:bytes.toString('utf8'),sha256:digest(bytes),storage:'checkout',revision:snapshot.revision};
}
export async function draftProjectFiles(context, projectId) {
  const snapshot=await ensureDraft(context);id(projectId);
  invariant(snapshot.settings.projects?.some(p=>p.id===projectId),'UNKNOWN_PROJECT','未知產品。',404);
  const files=new Set(snapshot.files.filter(f=>f.target===`project:${projectId}`).map(f=>f.path));
  const root=path.join(context.root,'projects',projectId);
  const binding=context.store.repository(context.repositoryId);
  if((!binding.localPath || context.store.connection(context.repositoryId)?.validatedPath===binding.localPath) && await exists(root)) {
    const visit=async directory=>{
      for(const item of await readdir(directory,{withFileTypes:true})) {
        const relative=path.relative(root,path.join(directory,item.name)).split(path.sep).join('/');
        try{sourcePath(relative);}catch{continue;}
        if(item.isSymbolicLink())continue;
        if(item.isDirectory())await visit(path.join(root,relative));
        else if(item.isFile()&&(await lstat(path.join(root,relative))).size<=2*1024*1024)files.add(relative);
        invariant(files.size<=10000,'PROJECT_SIZE_LIMIT','產品檔案過多，請縮小編輯範圍。');
      }
    };await visit(root);
  }
  return {projectId,files:[...files].sort(),available:await exists(root),storage:'sqlite'};
}
export async function editDraft(context) {
  const {store,request,options}=context,repositoryId=request.repositoryId,input=request.input;
  const prior=store.draftReceipt(repositoryId,request.operationId,request);if(prior)return prior;
  const snapshot=await ensureDraft({...context,repositoryId}),settings={...snapshot.settings};
  let extra=[],result={};
  return inDraftView(snapshot,async root=>{
    if(request.operation==='repository.setup') {
      invariant(typeof input.reviewer==='string'&&input.reviewer.trim()&&input.reviewer.length<=120,'REVIEWER_REQUIRED','請填寫需求確認者。');
      invariant(Array.isArray(input.projects??[])&&(input.projects??[]).length<=20,'INVALID_PROJECTS','最多可綁定 20 個產品。');
      if(input.expectedSettings!==undefined) {
        const bootstrap=snapshot.revision===1 ? store.draftReceipt(repositoryId,'sqlite-bootstrap-v5',{bootstrap:5}) : null;
        invariant(identity(settings)===input.expectedSettings||bootstrap?.previousSettingsToken===input.expectedSettings,'SETTINGS_CHANGED','設定已由另一個操作更新，請重新開啟。',409);
      }
      const projects=[...(settings.projects??[])];
      for(const p of input.projects??[]){id(p.id);remoteUrl(p.url,options);const previous=projects.find(x=>x.id===p.id);invariant(!previous||previous.url===p.url,'PROJECT_SOURCE_CHANGED','不能默默替換既有產品的來源。',409);if(!previous)projects.push({id:p.id,url:p.url});}
      invariant(new Set((input.projects??[]).map(p=>p.id)).size===(input.projects??[]).length,'DUPLICATE_PROJECT','產品代號不能重複。');
      let config;try{config=await configuration(root);}catch{config=JSON.parse(await readFile(path.join(options.toolkitRoot,'templates/spec-repo/v1/workbench.yaml'),'utf8'));config.specRepositoryId=repositoryId;}
      config.projects=projects.map(p=>({id:p.id,path:`projects/${p.id}`}));await writeJson(path.join(root,'workbench.yaml'),config);
      if(input.execution)await configureExecution(root,{...input.execution,expectedHash:digest(await readFile(path.join(root,'workbench.yaml')))});
      Object.assign(settings,{schemaVersion:1,reviewer:input.reviewer.trim(),configured:true,projects,...(input.execution?{execution:input.execution}:{}),updatedAt:new Date().toISOString()});
      result={ready:true,settings,connection:'NOT_CHECKED'};
    } else {
      invariant(settings.configured,'SETUP_REQUIRED','請先儲存基本設定；不需要先連線遠端。');
      if(request.operation==='workflow.requirement.save') {
        result=await saveComposer(root,input);
      } else if(request.operation==='repository.save') {
        if(input.kind==='scope'){await configureFeature(root,input);}
        else if(input.kind==='project') {
          id(input.projectId);sourcePath(input.path);invariant(settings.projects.some(p=>p.id===input.projectId),'UNKNOWN_PROJECT','產品不屬於此規格庫。',404);
          invariant(typeof input.content==='string'&&!input.content.includes('\0')&&Buffer.byteLength(input.content)<=2*1024*1024,'INVALID_CONTENT','請使用 2 MiB 內的文字內容。');
          let old;try{old=await readDraftFile({...context,repositoryId},input.path,input.projectId,true);}catch(error){if(error.code!=='ENOENT')throw error;}
          invariant(Object.hasOwn(input,'expectedHash')&&(old?.sha256??null)===input.expectedHash,'CONTENT_CHANGED','產品內容已變更；畫面草稿未被覆蓋，請先重新讀取。',409);
          extra.push({target:`project:${input.projectId}`,path:input.path,content:input.content,baseHash:old?.sha256??null});result={path:input.path,projectId:input.projectId,sha256:digest(input.content)};
        }else{invariant(input.kind==='source','INVALID_SAVE_TARGET','請選擇規格或產品。');result=await saveFile(root,input);}
      } else if(request.operation==='workflow.create') {
        const existing=(await scan(root)).features;let requirementId=input.requirementId?.trim(),featureId=input.featureId?.trim();
        if(!requirementId){let n=1;while(existing.some(f=>f.requirementId===`REQ-${String(n).padStart(3,'0')}`))n++;requirementId=`REQ-${String(n).padStart(3,'0')}`;}
        if(!featureId){const prefix=String(input.title??'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,45)||'feature';featureId=prefix;let n=1;while(existing.some(f=>f.requirementId===requirementId&&f.id===featureId))featureId=`${prefix}-${String(++n).padStart(3,'0')}`;}
        result=await createFeature(root,{...input,requirementId,featureId,guided:Boolean(input.guided||input.goal||input.acceptance)});
      } else if(request.operation==='workflow.draft') {
        const key=`${id(input.requirementId)}/${id(input.featureId)}`,file=`spec/${key}/${input.featureId}.feature`;
        const old=await readFile(await safePath(root,file,{missing:false}),'utf8');
        invariant(digest(old)===input.expectedHash,'CONTENT_CHANGED','需求已變更；畫面草稿未被覆蓋，請重新讀取。',409);
        invariant(parseGuidedFeature(old),'ADVANCED_GHERKIN','手動編輯過的 Gherkin 不會被簡易表單覆蓋。',409);
        const draft=buildGuidedFeature(input),metaFile=`spec/${key}/feature.yaml`,meta=await readJson(await safePath(root,metaFile));
        if(input.expectedMetadataHash)invariant(digest(JSON.stringify(meta))===input.expectedMetadataHash,'CONTENT_CHANGED','驗收範圍已變更。',409);
        await atomicWrite(await safePath(root,file),draft.featureText);await writeJson(await safePath(root,metaFile),{...meta,title:draft.title,caseIds:draft.caseIds});
        result={key,sha256:digest(draft.featureText)};
      } else {
        invariant(request.operation==='workflow.review'&&['gherkin','sd'].includes(input.stage),'INVALID_STAGE','此操作需要執行驗收環境。');
        if(input.stage==='gherkin'){const text=await readFile(await safePath(root,`spec/${id(input.requirementId)}/${id(input.featureId)}/${input.featureId}.feature`),'utf8');const diagnostics=requirementDiagnostics(text);invariant(!diagnostics.length,'GHERKIN_INVALID',diagnostics.map(d=>`第 ${d.line} 行：${d.message}`).join(' '));}
        result={...await confirm(root,{...input,confirmedBy:settings.reviewer}),nextStage:input.stage==='gherkin'?'SD':'TESTS'};
      }
    }
    const after=await sourceFiles(root),changes=after.filter(f=>!snapshot.files.some(x=>fileKey(x)===fileKey(f)&&x.sha256===digest(f.content))).map(f=>({...f,baseHash:snapshot.files.find(x=>fileKey(x)===fileKey(f))?.baseHash??null}));
    return store.saveDraft(repositoryId,{expectedRevision:snapshot.revision,files:[...changes,...extra],settings,operationId:request.operationId,request,result,proposalKey:request.operation==='workflow.requirement.save'?input.editorKey:undefined});
  });
}
