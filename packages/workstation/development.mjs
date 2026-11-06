import {selectedAgent,selectedTaskSnapshot} from './agent-task.mjs';
/** Codex SDK implementation. Agent exit never grants acceptance. */
import path from 'node:path';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import {readProgress,saveProgressPhase} from '../git-core/progress-store.mjs';
import { currentProgress } from '../git-core/progress.mjs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { WorkstationError, id, invariant, safePath, exists, digest, identity, writeJson } from '../contracts/index.mjs';
import { execute, processEnvironment, trackChild, terminateSpawnedPty } from '../git-core/index.mjs';
import { scan, reviewState } from '../spec-toolkit/index.mjs';
import { ensureDraft, inDraftView, editDraft } from './authoring.mjs';
import { prepareProjection } from './projection.mjs';
import { ensureInstallation } from './flows.mjs';
import { workspaceModules, workspaceEntries, entriesDigest } from '../spec-toolkit/workspace.mjs';
import { sourcePath } from './repository-actions.mjs';
import { readFeedback } from './feedback.mjs';
import { workflowStatus } from './workflow.mjs';

export { validateAgentSettings } from './agent-settings.mjs';
import { validateAgentSettings } from './agent-settings.mjs';
import { approvedAgentPrompt, writeAgentTask } from './agent-task.mjs';
import { runAgentTask } from './agent-cli.mjs';
function runtimeCandidates(home) {return [createRequire(import.meta.url),createRequire(path.join(home,'runtime','terminal','package.json'))];}
export function terminalVendor(home,asset) {
  const names={'xterm.js':'@xterm/xterm/lib/xterm.js','xterm.css':'@xterm/xterm/css/xterm.css'};
  invariant(Object.hasOwn(names,asset),'NOT_FOUND','Unknown terminal asset',404);
  for(const req of runtimeCandidates(home))try{return req.resolve(names[asset]);}catch{/* not installed */}
  throw new WorkstationError('TERMINAL_RUNTIME_MISSING','終端元件尚未安裝。',409);
}
export async function terminalRuntime(context) {
  const {options,request}=context;
  for(const req of runtimeCandidates(options.home))try{const pty=req('node-pty');terminalVendor(options.home,'xterm.js');return pty;}catch{/* use approved private runtime */}
  const packages={'node-pty':'1.1.0','@xterm/xterm':'6.0.0'},plan=identity({packages,node:process.versions.node.split('.')[0],platform:process.platform,arch:process.arch});
  if(request.input.installConsent!==plan)throw new WorkstationError('INSTALL_REQUIRED','需要終端元件。',409,{install:{digest:plan,packages,browsers:[],purpose:'terminal',nativeBuild:true}});
  const cwd=path.join(options.home,'runtime','terminal');await mkdir(cwd,{recursive:true});
  await writeJson(path.join(cwd,'package.json'),{private:true,dependencies:packages});
  for(const args of [['install','--ignore-scripts','--no-audit','--no-fund'],['rebuild','node-pty']]) {
    const r=await execute('npm',args,{cwd,env:processEnvironment({HOME:process.env.HOME}),timeoutMs:300000});
    invariant(r.exitCode===0&&!r.timedOut&&!r.overflow,'TERMINAL_INSTALL_FAILED','終端元件安裝失敗；請檢查主機的 Node.js 與編譯工具。',422);
  }
  return createRequire(path.join(cwd,'package.json'))('node-pty');
}
export async function readTerminal(home,operationId,offset=0) {
  invariant(Number.isInteger(offset)&&offset>=0,'INVALID_OFFSET','終端位置無效。');
  const directory=await safePath(home,`development/${id(operationId)}`);
  const persisted=readProgress(home,id(operationId));
  const output=persisted?.output??Buffer.alloc(0),state=persisted?.state??{phase:'PREPARING'},latestExit=persisted?.latestExit??null,hasProgress=Boolean(persisted);
  let start=Math.min(offset,output.length);
  while(start<output.length&&(output[start]&0xc0)===0x80)start++;
  let nextOffset=Math.min(output.length,start+65536);
  while(nextOffset<output.length&&(output[nextOffset]&0xc0)===0x80)nextOffset--;
  return {...state,hasProgress,latestExit,output:output.subarray(start,nextOffset).toString('utf8'),nextOffset,hasMore:nextOffset<output.length};
}
export async function runPty(pty,command,args,cwd,{log,timeoutMs,onInputDelivered,routeInputs=true,encodeInput,shutdownGraceMs=1000}) {
  // The supervised host receives only the environment needed by the SDK runtime.
  const env={PATH:process.env.PATH,HOME:process.env.HOME,LANG:process.env.LANG??'en_US.UTF-8',TERM:'xterm-256color'};
  for(const k of ['USERPROFILE','SYSTEMROOT','USER','TMPDIR'])if(process.env[k])env[k]=process.env[k];
  const progress=currentProgress(); progress?.record(`\r\n[start PTY] ${command}\r\n`);
  const child=pty.spawn(command,args,{cwd,env,name:'xterm-256color',cols:100,rows:30});
  let commandId;
  try { commandId=progress?.startProcess(command,'agent',child.pid); } catch(error) { terminateSpawnedPty(child); throw error; }
  const tracked=new EventEmitter();tracked.pid=child.pid;tracked.kill=signal=>child.kill(signal);trackChild(tracked);
  return new Promise((resolve,reject)=>{
    let ended=false,timedOut=false,limit=false,terminating=false,killTimer,inputFailure=null;
    const terminate=()=>{if(terminating||ended)return;terminating=true;try{process.platform!=='win32'?process.kill(-child.pid,'SIGTERM'):child.kill();}catch{}killTimer=setTimeout(()=>{try{process.platform!=='win32'?process.kill(-child.pid,'SIGKILL'):child.kill();}catch{}},shutdownGraceMs);};
    const timer=setTimeout(()=>{timedOut=true;terminate();},timeoutMs);
    const message=m=>{
      if(m?.type!=='development.input'||ended)return;
      try {
        if(typeof m.data==='string'||m.interactionId&&typeof encodeInput==='function') {
          const data=typeof encodeInput==='function'?encodeInput(m):m.data;
          if(typeof data!=='string'||!data.length)return;
          const previous=m.interactionId&&routeInputs?progress?.routeInput(m.interactionId):null;
          child.write(data);
          if(m.interactionId)onInputDelivered?.(m.interactionId,previous);
        } else if(Number.isInteger(m.cols)&&Number.isInteger(m.rows))child.resize(m.cols,m.rows);
      }catch(error){inputFailure=error;terminate();}
    };
    process.on('message',message);
    child.onData(data=>{try{log(data);}catch{limit=true;terminate();}});
    child.onExit(({exitCode,signal})=>{progress?.record(`\r\n[exit] code=${exitCode} signal=${signal ?? 'none'} timeout=${timedOut}\r\n`);progress?.finishProcess(commandId,{exitCode,signal,timedOut});progress?.exit({exitCode,signal,timedOut});ended=true;clearTimeout(timer);clearTimeout(killTimer);process.off('message',message);tracked.emit('close');if(inputFailure)reject(inputFailure);else if(limit)reject(new WorkstationError('TERMINAL_OUTPUT_LIMIT','終端輸出超過上限，開發已停止。'));else resolve({exitCode,signal,timedOut});});
  });
}
/** Import only product files from this explicit development session. Never replace concurrent SQL edits. */
export async function captureAgentProducts(context,snapshot,initialModules) {
  const {root,store,request}=context,repositoryId=request.repositoryId;
  invariant(store.draft(repositoryId).revision===snapshot.revision,'CONTENT_CHANGED','開發期間內容已更新；Agent 修改已保留，未覆蓋新草稿。',409);
  const files=[],deleteFiles=[],plans=[];
  for(const module of initialModules) {
    const directory=await safePath(root,module.path,{missing:false});
    invariant(Array.isArray(module.entries),'PRODUCT_BASELINE_REQUIRED','缺少本次開發的產品來源快照；沒有自動儲存變更。',409);
    const after=await workspaceEntries(directory),before=new Map(module.entries.map(file=>[file.path,file]));
    const changed=after.filter(file=>file.sha256!==before.get(file.path)?.sha256||file.mode!==before.get(file.path)?.mode);
    const removed=module.entries.filter(file=>!after.some(current=>current.path===file.path));
    const paths=[...changed.map(file=>file.path),...removed.map(file=>file.path)];
    invariant(!context.allowedProjects||context.allowedProjects.includes(module.id)||!paths.length,'AGENT_CHANGED_UNRELATED_PROJECT','其他產品在開發期間有變更；原檔已保留，未自動合併。',409);
    invariant(paths.length<=10000,'AGENT_CHANGE_LIMIT','Agent 變更檔案數量超過上限。');
    for(const relative of paths) {
      sourcePath(relative);const file=await safePath(directory,relative),target=`project:${module.id}`;
      if(!await exists(file)){deleteFiles.push({target,path:relative});continue;}
      const bytes=await readFile(file);
      invariant(bytes.length<=4*1024*1024&&!bytes.includes(0)&&Buffer.from(bytes.toString('utf8')).equals(bytes),'AGENT_UNSUPPORTED_FILE','Agent 產生了不支援的二進位或過大檔案；原檔已保留。',409);
      files.push({target,path:relative,content:bytes.toString('utf8'),baseHash:digest(bytes)});
    }
    plans.push({...module,contentDigest:entriesDigest(after),entries:undefined});
  }
  if(files.length||deleteFiles.length)store.saveDraft(repositoryId,{expectedRevision:snapshot.revision,files,deleteFiles,operationId:`agent-${request.operationId}-${snapshot.revision}`,request:{operation:'development.capture',revision:snapshot.revision},result:{agentChanges:true}});
  // The reviewed product changes already exist on disk; record them as the new export baseline.
  const prior=store.projection(repositoryId),changed=[...files,...deleteFiles];
  store.setProjection(repositoryId,{...prior,revision:store.draft(repositoryId).revision,
    files:[...(prior?.files??[]).filter(f=>!changed.some(x=>x.target===f.target&&x.path===f.path)),...files.map(f=>({target:f.target,path:f.path,sha256:digest(f.content)}))],
    deletedFiles:[...(prior?.deletedFiles??[]).filter(f=>!changed.some(x=>x.target===f.target&&x.path===f.path)),...deleteFiles],
    modules:plans.map(module=>{const previous=prior?.modules?.find(item=>item.id===module.id);return {...previous,...module,dirty:previous?.checkpointDigest!==module.contentDigest};})});
  return {files:files.length,deleted:deleteFiles.length};
}
export function createDevelopmentLog(logfile) {
  let bytes=0;
  return text=>{bytes+=Buffer.byteLength(text);invariant(bytes<=4*1024*1024,'OUTPUT_LIMIT','Terminal output limit');const progress=currentProgress();invariant(progress,'PROGRESS_REQUIRED','SDK execution requires a durable progress session');progress.output(text);};
}
export async function runDevelopment(context,verify) {
  const {root,options,store,request,git}=context,input=request.input,key=`${id(input.requirementId)}/${id(input.featureId)}`;
  invariant(options.enableExecution,'EXECUTION_DISABLED','此主機已停用執行。',403);
  let snapshot=await ensureDraft({...context,repositoryId:request.repositoryId});
  await inDraftView(snapshot,async view=>invariant(Object.values((await reviewState(view,input.requirementId,input.featureId)).confirmed).every(Boolean),'REVIEWS_REQUIRED','請先確認需求、設計與測試。',409));
  const workflow=(await workflowStatus({...context,repositoryId:request.repositoryId},key)).workflows[0];
  invariant(workflow.status!=='COMPLETE','STAGE_READ_ONLY','本階段已完成人工驗收。',409);
  const prompt=approvedAgentPrompt(snapshot,context,'development');
  const agent=selectedAgent(snapshot,context);
  if(input.acceptanceFeedback){
    const feedback=input.acceptanceFeedback;
    invariant(feedback.message===input.prompt&&typeof feedback.expectedManifestDigest==='string','FEEDBACK_PROMPT_CHANGED','派工文字必須保留原始驗收意見與報告識別。',409);
    await editDraft({...context,request:{...request,operation:'workflow.feedback',input:{requirementId:input.requirementId,featureId:input.featureId,message:feedback.message,runId:feedback.runId,expectedManifestDigest:feedback.expectedManifestDigest,expectedRevision:snapshot.revision}}});
    snapshot=store.draft(request.repositoryId);
  }
  await prepareProjection(context);
  const feature=(await scan(root)).features.find(f=>f.key===key);
  invariant(feature,'FEATURE_NOT_FOUND','找不到需求。',404);
  await ensureInstallation({...context,profiles:feature.profiles});
  const directory=await safePath(options.home,`development/${request.operationId}`);await mkdir(directory,{recursive:true});
  const log=createDevelopmentLog(path.join(directory,'terminal.log'));
  const phase=(name,extra={})=>saveProgressPhase(options.home,request.operationId,{operationId:request.operationId,key,phase:name,...extra});
  const feedback=await readFeedback(root,key),related=feature.projectIds;
  invariant(related.length,'PROJECT_REQUIRED','請在設定中連結產品。',409);
  let previousFailure='',result;
  try {
    for(let attempt=1;attempt<=agent.maxAttempts;attempt++) {
      snapshot=store.draft(request.repositoryId);
      const modules=await workspaceModules(root,snapshot.settings.projects??[],{entries:true}),selected=modules.filter(m=>related.includes(m.id));
      invariant(selected.length===related.length&&modules.every(m=>m.initialized),'PROJECT_NOT_INITIALIZED','產品尚未初始化，請先建立功能。',409);
      const projection=store.projection(request.repositoryId);
      invariant(modules.every(module=>projection?.modules?.find(previous=>previous.id===module.id)?.contentDigest===module.contentDigest),'UNSAVED_PRODUCT','產品有外部未儲存的變更；原稿已保留。',409);
      const reviewed=await reviewState(root,input.requirementId,input.featureId);
      invariant(Object.values(reviewed.confirmed).every(Boolean),'REVIEWS_REQUIRED','規格已變更，請重新確認。',409);
      const task=await writeAgentTask(path.join(directory,`attempt-${attempt}`),selectedTaskSnapshot(snapshot,context),{purpose:'development',requirementId:input.requirementId,featureId:input.featureId,workspace:root,
        products:selected.map(p=>path.join(root,p.path)),feedback:feedback.items,previousFailure});
      await writeFile(path.join(directory,'prompt.txt'),prompt,{mode:0o600});
      const cwd=selected.length===1?path.join(root,selected[0].path):root;
      log(`\r\n[開發 ${attempt}/${agent.maxAttempts}] Codex SDK\r\n`);await phase('STARTING',{attempt});
      const outcome=await runAgentTask(context,{agent,prompt,cwd,task,log,timeoutMs:agent.timeoutMs});
      log(`\r\n[Agent exit] code=${outcome.exitCode} signal=${outcome.signal ?? 'none'} timeout=${outcome.timedOut}\r\n`);
      invariant(!outcome.timedOut&&outcome.exitCode===0&&!outcome.signal,'AGENT_FAILED',outcome.timedOut?'Agent 執行逾時；修改已保留。':(outcome.signal?'Agent 已停止；修改已保留。':`Agent 結束碼 ${outcome.exitCode}；修改已保留。`),422);
      const after=await reviewState(root,input.requirementId,input.featureId);
      invariant(identity(after.hashes)===identity(reviewed.hashes)&&Object.values(after.confirmed).every(Boolean),'AGENT_CHANGED_SPEC','Agent 修改了已確認的規格或測試；未自動批准。',409);
      await captureAgentProducts({...context,allowedProjects:related},snapshot,modules);
      await phase('CHECKING',{attempt});log('\r\n[BDD] 執行全部案例\r\n');
      result=await verify({requirementId:input.requirementId,featureId:input.featureId});
      log(`[BDD] ${result.testOutcome} / ${result.verification}\r\n`);
      if(result.verification==='VERIFIED'&&result.testOutcome==='PASSED'){await phase('COMPLETED',{attempt,runId:result.runId});return {...result,development:{operationId:request.operationId,attempt}};}
      previousFailure=`Last independent BDD result: ${JSON.stringify({failure:result.failure,reasons:result.reasons,evidenceIssues:result.evidenceIssues,cases:result.cases?.filter(c=>c.status!=='passed').map(c=>({title:c.title,steps:c.steps,errors:c.errors}))})}`;
      previousFailure=previousFailure.slice(0,16000);log(previousFailure+'\r\n');
    }
    await phase('FAILED',{runId:result?.runId});return {...result,development:{operationId:request.operationId},nextStage:'IMPLEMENTATION'};
  } catch(error){await phase('FAILED',{error:{code:error.code,message:error.message}});if(error.code!=='TERMINAL_OUTPUT_LIMIT')log('\r\n'+error.message+'\r\n');throw error;}
}
