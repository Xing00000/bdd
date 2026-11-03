/** Real local CLI agent PTY. A zero agent exit is never an acceptance result. */
import path from 'node:path';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import {readProgress,saveProgressPhase} from '../git-core/progress-store.mjs';
import { currentProgress } from '../git-core/progress.mjs';
import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { WorkstationError, id, invariant, safePath, exists, digest, identity, writeJson } from '../contracts/index.mjs';
import { execute, processEnvironment, trackChild, terminateSpawnedPty } from '../git-core/index.mjs';
import { scan, reviewState } from '../spec-toolkit/index.mjs';
import { ensureDraft, inDraftView } from './authoring.mjs';
import { prepareProjection } from './projection.mjs';
import { ensureInstallation, savePaths } from './flows.mjs';
import { sourcePath } from './repository-actions.mjs';
import { readFeedback } from './feedback.mjs';
import { workflowStatus } from './workflow.mjs';

export { validateAgentSettings } from './agent-settings.mjs';
import { validateAgentSettings } from './agent-settings.mjs';
import { approvedAgentPrompt, writeAgentTask, agentArguments } from './agent-task.mjs';
export async function agentExecutable(command) {
  const candidates=path.isAbsolute(command)?[command]:(process.env.PATH??'').split(path.delimiter).filter(Boolean).map(p=>path.join(p,command));
  for(const file of candidates)try{await access(file,constants.X_OK);return file;}catch{/* next PATH entry */}
  throw new WorkstationError('AGENT_NOT_INSTALLED','找不到 CLI Agent；請在設定中指定已安裝並登入的執行檔。',409);
}
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
export async function runPty(pty,command,args,cwd,{log,timeoutMs,onInputDelivered}) {
  // The host CLI reads its existing login from HOME. Do not inherit unrelated service credentials.
  const env={PATH:process.env.PATH,HOME:process.env.HOME,LANG:process.env.LANG??'en_US.UTF-8',TERM:'xterm-256color'};
  for(const k of ['USERPROFILE','SYSTEMROOT','USER','TMPDIR'])if(process.env[k])env[k]=process.env[k];
  const progress=currentProgress(); progress?.record(`\r\n[start PTY] ${command}\r\n`);
  const child=pty.spawn(command,args,{cwd,env,name:'xterm-256color',cols:100,rows:30});
  let commandId;
  try { commandId=progress?.startProcess(command,'agent',child.pid); } catch(error) { terminateSpawnedPty(child); throw error; }
  const tracked=new EventEmitter();tracked.pid=child.pid;tracked.kill=signal=>child.kill(signal);trackChild(tracked);
  return new Promise((resolve,reject)=>{
    let ended=false,timedOut=false,limit=false,terminating=false,killTimer,inputFailure=null;
    const terminate=()=>{if(terminating||ended)return;terminating=true;try{process.platform!=='win32'?process.kill(-child.pid,'SIGTERM'):child.kill();}catch{}killTimer=setTimeout(()=>{try{process.platform!=='win32'?process.kill(-child.pid,'SIGKILL'):child.kill();}catch{}},1000);};
    const timer=setTimeout(()=>{timedOut=true;terminate();},timeoutMs);
    const message=m=>{if(m?.type!=='development.input'||ended)return;try{const previous=m.interactionId?progress?.routeInput(m.interactionId):null;if(typeof m.data==='string')child.write(m.data);else child.resize(m.cols,m.rows);if(m.interactionId)onInputDelivered?.(m.interactionId,previous);}catch(error){inputFailure=error;terminate();}};
    process.on('message',message);
    child.onData(data=>{try{log(data);}catch{limit=true;terminate();}});
    child.onExit(({exitCode,signal})=>{progress?.record(`\r\n[exit] code=${exitCode} signal=${signal ?? 'none'} timeout=${timedOut}\r\n`);progress?.finishProcess(commandId,{exitCode,signal,timedOut});progress?.exit({exitCode,signal,timedOut});ended=true;clearTimeout(timer);clearTimeout(killTimer);process.off('message',message);tracked.emit('close');if(inputFailure)reject(inputFailure);else if(limit)reject(new WorkstationError('TERMINAL_OUTPUT_LIMIT','終端輸出超過上限，開發已停止。'));else resolve({exitCode,signal,timedOut});});
  });
}
/** Import only product files from this explicit development session. Never replace concurrent SQL edits. */
export async function captureAgentProducts(context,snapshot,initialModules) {
  const {root,git,store,request}=context,repositoryId=request.repositoryId;
  invariant(store.draft(repositoryId).revision===snapshot.revision,'CONTENT_CHANGED','開發期間內容已更新；Agent 修改已保留，未覆蓋新草稿。',409);
  const files=[],deleteFiles=[],plans=[];
  for(const module of initialModules) {
    const directory=await safePath(root,module.path,{missing:false}),state=await git.inspect(directory);
    const changes=(await git.command(directory,['diff','--name-only','--no-renames',module.actual,'--'])).stdout.split('\n').filter(Boolean);
    invariant(!context.allowedProjects||context.allowedProjects.includes(module.id)||(!changes.length&&state.clean&&state.head===module.actual),'AGENT_CHANGED_UNRELATED_PROJECT','其他產品在開發期間有變更；原檔已保留，未自動合併。',409);
    const paths=[...new Set([...changes,...state.changes.flatMap(c=>[c.path,...(c.originalPath?[c.originalPath]:[])])])];
    invariant(paths.length<=10000,'AGENT_CHANGE_LIMIT','Agent 變更檔案數量超過上限。');
    for(const relative of paths) {
      sourcePath(relative);const file=await safePath(directory,relative),target=`project:${module.id}`;
      if(!await exists(file)){deleteFiles.push({target,path:relative});continue;}
      const bytes=await readFile(file);
      invariant(bytes.length<=4*1024*1024&&!bytes.includes(0)&&Buffer.from(bytes.toString('utf8')).equals(bytes),'AGENT_UNSUPPORTED_FILE','Agent 產生了不支援的二進位或過大檔案；原檔已保留。',409);
      files.push({target,path:relative,content:bytes.toString('utf8'),baseHash:digest(bytes)});
    }
    plans.push({directory,paths,state,module});
  }
  if(files.length||deleteFiles.length)store.saveDraft(repositoryId,{expectedRevision:snapshot.revision,files,deleteFiles,operationId:`agent-${request.operationId}-${snapshot.revision}`,request:{operation:'development.capture',revision:snapshot.revision},result:{agentChanges:true}});
  // The reviewed product changes already exist on disk; record them as the new export baseline.
  const prior=store.projection(repositoryId),changed=[...files,...deleteFiles];
  store.setProjection(repositoryId,{...prior,files:[...(prior?.files??[]).filter(f=>!changed.some(x=>x.target===f.target&&x.path===f.path)),...files.map(f=>({target:f.target,path:f.path,sha256:digest(f.content)}))]});
  for(const plan of plans) {
    await git.expect(plan.directory,plan.state);
    if(plan.paths.length)await savePaths(plan.directory,plan.paths,git,repositoryId,`Save agent development ${request.operationId}`);
  }
  await savePaths(root,initialModules.map(p=>p.path),git,repositoryId,'Record developed product versions');
  store.setProjection(repositoryId,{...store.projection(repositoryId),head:await git.resolve(root),modules:await git.modules(root)});
  return {files:files.length,deleted:deleteFiles.length};
}
export function createDevelopmentLog(logfile) {
  let bytes=0;
  return text=>{bytes+=Buffer.byteLength(text);invariant(bytes<=4*1024*1024,'OUTPUT_LIMIT','Terminal output limit');const progress=currentProgress();invariant(progress,'PROGRESS_REQUIRED','CLI execution requires a durable progress session');progress.output(text);};
}
export async function runDevelopment(context,verify) {
  const {root,options,store,request,git}=context,input=request.input,key=`${id(input.requirementId)}/${id(input.featureId)}`;
  invariant(options.enableExecution,'EXECUTION_DISABLED','此主機已停用執行。',403);
  let snapshot=await ensureDraft({...context,repositoryId:request.repositoryId});
  await inDraftView(snapshot,async view=>invariant(Object.values((await reviewState(view,input.requirementId,input.featureId)).confirmed).every(Boolean),'REVIEWS_REQUIRED','請先確認需求、設計與測試。',409));
  const workflow=(await workflowStatus({...context,repositoryId:request.repositoryId},key)).workflows[0];
  invariant(workflow.status!=='COMPLETE','STAGE_READ_ONLY','本階段已完成；請先從驗收回報問題，再進入開發。',409);
  const prompt=approvedAgentPrompt(snapshot,context,'development');
  const agent=validateAgentSettings(snapshot.settings.agent),command=await agentExecutable(agent.command),pty=await terminalRuntime(context);
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
      const modules=await git.modules(root),selected=modules.filter(m=>related.includes(m.id));
      invariant(selected.length===related.length&&modules.every(m=>m.actual&&!m.dirty),'UNSAVED_PRODUCT','產品有外部未儲存的變更；原稿已保留。',409);
      const reviewed=await reviewState(root,input.requirementId,input.featureId);
      invariant(Object.values(reviewed.confirmed).every(Boolean),'REVIEWS_REQUIRED','規格已變更，請重新確認。',409);
      const task=await writeAgentTask(path.join(directory,`attempt-${attempt}`),snapshot,{purpose:'development',requirementId:input.requirementId,featureId:input.featureId,workspace:root,
        products:selected.map(p=>path.join(root,p.path)),feedback:feedback.items,previousFailure});
      await writeFile(path.join(directory,'prompt.txt'),prompt,{mode:0o600});
      const cwd=selected.length===1?path.join(root,selected[0].path):root;
      const args=agentArguments(agent,{prompt,spec:root,project:cwd,task});
      log(`\r\n[開發 ${attempt}/${agent.maxAttempts}] ${agent.command}\r\n`);await phase('RUNNING',{attempt});
      const outcome=await runPty(pty,command,args,cwd,{log,timeoutMs:agent.timeoutMs,onInputDelivered:(interactionId,previousId)=>store.acknowledgeInput(request.operationId,interactionId,previousId)});
      log(`\r\n[CLI exit] code=${outcome.exitCode} signal=${outcome.signal ?? 'none'} timeout=${outcome.timedOut}\r\n`);
      invariant(!outcome.timedOut&&outcome.exitCode===0&&!outcome.signal,'AGENT_FAILED',outcome.timedOut?'CLI Agent 執行逾時；修改已保留。':(outcome.signal?'CLI Agent 已停止；修改已保留。':`CLI Agent 結束碼 ${outcome.exitCode}；修改已保留。`),422);
      const after=await reviewState(root,input.requirementId,input.featureId);
      invariant(identity(after.hashes)===identity(reviewed.hashes)&&Object.values(after.confirmed).every(Boolean),'AGENT_CHANGED_SPEC','Agent 修改了已確認的規格或測試；未自動批准。',409);
      await captureAgentProducts({...context,allowedProjects:related},snapshot,modules);
      await phase('CHECKING',{attempt});log('\r\n[BDD] 執行全部案例\r\n');
      result=await verify({requirementId:input.requirementId,featureId:input.featureId});
      log(`[BDD] ${result.testOutcome} / ${result.verification}\r\n`);
      if(result.verification==='VERIFIED'&&result.testOutcome==='PASSED'){await phase('COMPLETED',{attempt,runId:result.runId});return {...result,development:{operationId:request.operationId,attempt}};}
      previousFailure=`Last independent BDD result: ${JSON.stringify({failure:result.failure,reasons:result.reasons,cases:result.cases?.filter(c=>c.status!=='passed').map(c=>({title:c.title,steps:c.steps,errors:c.errors}))})}`;
      previousFailure=previousFailure.slice(0,16000);log(previousFailure+'\r\n');
    }
    await phase('FAILED',{runId:result?.runId});return {...result,development:{operationId:request.operationId},nextStage:'IMPLEMENTATION'};
  } catch(error){await phase('FAILED',{error:{code:error.code,message:error.message}});if(error.code!=='TERMINAL_OUTPUT_LIMIT')log('\r\n'+error.message+'\r\n');throw error;}
}
