/** Codex SDK owns implementation; the local provider only supplies ACP inference. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { terminalRuntime, runPty } from './development.mjs';
import { sdkShutdownGraceMs } from './agent-lifecycle.mjs';
import { currentProgress } from '../git-core/progress.mjs';
import { readProgress, saveProgressPhase } from '../git-core/progress-store.mjs';
import { WorkstationError, invariant, id, version, exists, safePath, readJson, writeJson, digest } from '../contracts/index.mjs';

const hostScript=fileURLToPath(new URL('../../scripts/codex-sdk-agent.mjs',import.meta.url));
const taskServer=fileURLToPath(new URL('../../scripts/mcp-agent-task.mjs',import.meta.url));
const supervisorServer=fileURLToPath(new URL('../../scripts/mcp-agent-supervisor.mjs',import.meta.url));
const eventLimit=4*1024*1024;

async function builtRuntime() {
  try {
    const [{defaultChatSettings},{validateChatSettings}]=await Promise.all([
      import('../../dist/src/adapters/runtime/chat-settings.js'),import('../../dist/src/application/chat.js')
    ]);
    return {defaultChatSettings,validateChatSettings};
  } catch(error) {
    if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;
    throw new WorkstationError('CODEX_SDK_BUILD_REQUIRED','Codex SDK 派工需要先執行 npm run build。',503);
  }
}

/** Freeze the transport once per durable operation, including every development retry. */
export async function freezeCodexTransport(context,agent) {
  const {options,request}=context;
  const directory=await safePath(options.home,`sdk-operations/${id(request.operationId)}`),file=path.join(directory,'transport.json');
  await mkdir(directory,{recursive:true,mode:0o700});
  if(await exists(file))return file;
  const {defaultChatSettings,validateChatSettings}=await builtRuntime();
  let settings;
  const databaseFile=path.join(options.home,'metadata.sqlite');
  if(await exists(databaseFile)) {
    const db=new DatabaseSync(databaseFile,{readOnly:true});
    try {
      if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='chat_settings'").get()) {
        const row=db.prepare('SELECT value_json FROM chat_settings WHERE id=1').get();
        if(row)settings=JSON.parse(row.value_json);
      }
    } finally {db.close();}
  }
  settings=validateChatSettings(settings??defaultChatSettings());
  if(agent.model&&agent.model!=='auto')settings=validateChatSettings({...settings,model:agent.model});
  // Neither command paths nor arguments are terminal output. They may include
  // user-owned runtime configuration and are held in this private local file.
  const snapshot={schemaVersion:1,operationId:request.operationId,repositoryId:request.repositoryId,settings,createdAt:new Date().toISOString()};
  try {await writeFile(file,JSON.stringify(snapshot,null,2)+'\n',{flag:'wx',mode:0o600});}
  catch(error){if(error.code!=='EEXIST')throw error;}
  return file;
}

function sdkEnvironment(directory,token) {
  const env={};
  for(const name of ['PATH','HOME','USERPROFILE','SYSTEMROOT','USER','TMPDIR','LANG','TERM'])if(process.env[name])env[name]=process.env[name];
  return {...env,CODEX_HOME:path.join(directory,'codex-home'),WB_CODEX_PROVIDER_TOKEN:token};
}

/** Keys below were checked against the pinned 0.166.0 `codex features list`. */
export function codexSdkOptions(job,settings,provider,token) {
  return {
    codexPathOverride:settings.codexExecutable,
    env:sdkEnvironment(job.directory,token),
    config:{
      model_provider:'workstation_copilot',
      model_providers:{workstation_copilot:{name:'GitHub Copilot ACP',base_url:provider.url,wire_api:'responses',requires_openai_auth:false,env_key:'WB_CODEX_PROVIDER_TOKEN',supports_websockets:false,request_max_retries:0,stream_max_retries:0}},
      mcp_servers:{
        workbench_task:{command:process.execPath,args:[taskServer,job.task],enabled:true,required:true},
        agent_supervisor:{
          command:process.execPath,
          args:[supervisorServer,job.home??path.dirname(job.directory),job.repositoryId,job.operationId,job.cwd],
          enabled:true,
          required:true,
          tools:{
            agent_start:{approval_mode:'approve'},
            agent_send:{approval_mode:'approve'},
            agent_events:{approval_mode:'approve'},
            agent_list:{approval_mode:'approve'},
            agent_cancel:{approval_mode:'approve'},
            agent_stop:{approval_mode:'approve'},
          }
        }
      },
      developer_instructions:'Git is owned by the workstation feature-creation and human-acceptance checkpoints. Do not invoke Git, including read-only Git commands. Read and edit the task files directly; leave all Git actions to the workstation.',
      shell_environment_policy:{exclude:['WB_CODEX_PROVIDER_TOKEN']},
      features:{code_mode:false,code_mode_host:false,code_mode_only:false,code_mode_tool_search:false,incremental_tools:false,apps:false,plugins:false,skill_search:false,tool_suggest:false,multi_agent:false,browser_use:false,computer_use:false,image_generation:false,shell_snapshot:false}
    }
  };
}

export function codexThreadOptions(job,settings) {
  return {model:settings.model,workingDirectory:job.cwd,skipGitRepoCheck:true,sandboxMode:'workspace-write',approvalPolicy:'never',networkAccessEnabled:false,webSearchMode:'disabled'};
}

/** One SDK thread; terminal input becomes a subsequent run only after the current turn. */
export async function runCodexSdkSession(job,{Codex,createProvider,input=process.stdin,output=text=>process.stdout.write(text),signal}={}) {
  version(job);id(job.operationId);id(job.repositoryId);
  invariant(path.isAbsolute(job.cwd)&&path.isAbsolute(job.task)&&path.dirname(job.task)===job.directory,'INVALID_SDK_JOB','SDK 任務路徑無效。');
  invariant(typeof job.prompt==='string'&&job.prompt.trim()&&Buffer.byteLength(job.prompt)<=65536,'INVALID_SDK_PROMPT','SDK 任務需要原始已確認 Prompt。');
  invariant(typeof Codex==='function','CODEX_SDK_REQUIRED','缺少正式 Codex SDK。');
  const transport=version(await readJson(job.transportFile));
  invariant(transport.operationId===job.operationId&&transport.repositoryId===job.repositoryId,'SDK_TRANSPORT_MISMATCH','SDK 執行設定不屬於此派工。',409);
  if(!createProvider)({createChatProvider:createProvider}=await import('../../dist/src/adapters/runtime/chat-provider.js'));
  const settings=transport.settings,controller=new AbortController();
  const activeSignal=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  const sessionFile=path.join(job.directory,'sdk-session.json'),eventsFile=path.join(job.directory,'sdk-events.jsonl');
  await mkdir(path.join(job.directory,'codex-home'),{recursive:true,mode:0o700});
  await writeFile(eventsFile,'',{mode:0o600});
  const session={schemaVersion:1,operationId:job.operationId,repositoryId:job.repositoryId,runtime:'codex-sdk',model:settings.model,threadId:null,status:'RUNNING',inputs:[],turns:[],startedAt:new Date().toISOString()};
  const persist=()=>writeJson(sessionFile,session);
  let bytes=0,accepting=true,queuedBytes=0,sequence=0,provider,registration,reader,restoreRawMode,providerClose,sessionFailure;
  const closeProvider=()=>providerClose??=(async()=>{registration?.close();await provider?.close();})();
  const abortProvider=()=>{void closeProvider().catch(()=>{});};
  const queue=[];
  const emit=event=>{
    const line=JSON.stringify(event)+'\n';bytes+=Buffer.byteLength(line);
    invariant(bytes<=eventLimit,'SDK_OUTPUT_LIMIT','Codex SDK 事件超過 4 MiB，派工已停止。');
    appendFileSync(eventsFile,line,{mode:0o600});output(line);
  };
  try {
    await persist();activeSignal.throwIfAborted();
    provider=await createProvider(job.cwd,'codex');registration=provider.register(settings);
    activeSignal.addEventListener('abort',abortProvider,{once:true});
    if(activeSignal.aborted){abortProvider();activeSignal.throwIfAborted();}
    const client=new Codex(codexSdkOptions(job,settings,provider,registration.token));
    const thread=client.startThread(codexThreadOptions(job,settings));
    // PTY canonical input truncates long lines (commonly at 4 KiB). Frames must
    // reach readline intact and must not echo their complete message to the log.
    if(input.isTTY&&typeof input.setRawMode==='function'){restoreRawMode=Boolean(input.isRaw);input.setRawMode(true);}
    reader=createInterface({input,terminal:false,crlfDelay:Infinity});
    reader.on('line',line=>{
      if(!accepting)return;
      try {
        const message=JSON.parse(line);
        invariant(message.type==='workstation.sdk.input'&&typeof message.message==='string','INVALID_SDK_INPUT','SDK 輸入封包無效。');
        const interactionId=id(message.interactionId),text=message.message;
        const previous=session.inputs.find(item=>item.interactionId===interactionId);
        if(previous){invariant(previous.inputDigest===digest(text),'SDK_INPUT_ID_CONFLICT','SDK 輸入識別已被不同內容使用。');return;}
        const item={sequence:++sequence,interactionId,text};queuedBytes+=Buffer.byteLength(text);
        invariant(sequence<=50&&queuedBytes<=1024*1024&&Buffer.byteLength(text)<=65536,'SDK_INPUT_LIMIT','SDK 後續輸入超過佇列上限。');
        const receipt={sequence:item.sequence,interactionId,inputDigest:digest(text),status:text.trim()?'QUEUED':'EMPTY'};
        session.inputs.push(receipt);if(text.trim())queue.push(item);
        emit({type:'workstation.input.queued',interactionId,accepted:Boolean(text.trim()),delivery:'next-turn'});
      } catch(error) {controller.abort(error);}
    });
    emit({type:'workstation.input.ready',operationId:job.operationId});
    const run=async entry=>{
      activeSignal.throwIfAborted();
      const receipt={number:session.turns.length+1,inputInteractionId:entry.interactionId??null,inputDigest:digest(entry.text),status:'RUNNING',startedAt:new Date().toISOString()};
      session.turns.push(receipt);
      const incoming=entry.interactionId?session.inputs.find(item=>item.interactionId===entry.interactionId):null;if(incoming)incoming.status='RUNNING';
      await persist();emit({type:'workstation.turn.started',turn:receipt.number,interactionId:receipt.inputInteractionId});
      registration.activate(activeSignal);
      const turnController=new AbortController();
      const abortTurn=()=>turnController.abort(activeSignal.reason);
      const detachTurn=()=>activeSignal.removeEventListener('abort',abortTurn);
      activeSignal.addEventListener('abort',abortTurn,{once:true});
      if(activeSignal.aborted)abortTurn();
      let pendingFailure;
      try {
        let completed=false;
        // The approved prompt is passed unchanged. Task artifacts are exposed by MCP.
        const {events}=await thread.runStreamed(entry.text,{signal:turnController.signal});
        for await(const event of events) {
          try {
            activeSignal.throwIfAborted();emit(event);
            if(event.type==='thread.started') {session.threadId=thread.id??event.thread_id;await persist();}
            if(event.type==='item.completed'&&event.item?.type==='agent_message')session.finalResponse=event.item.text;
            if(event.type==='turn.failed')pendingFailure??=new WorkstationError('CODEX_SDK_TURN_FAILED',event.error?.message??'Codex SDK 回合失敗。',422);
            if(event.type==='error')pendingFailure??=new WorkstationError('CODEX_SDK_STREAM_FAILED',event.message??'Codex SDK 事件串流失敗。',422);
            if(event.type==='turn.completed'){completed=true;receipt.usage=event.usage;}
          } catch(error) {detachTurn();throw error;}
        }
        // Drain a structured failure to the child's natural exit before throwing.
        // The SDK otherwise closes its error listeners while that child can live on.
        detachTurn();if(pendingFailure)throw pendingFailure;
        invariant(completed&&typeof thread.id==='string'&&thread.id,'CODEX_SDK_INCOMPLETE','Codex SDK 未回傳完整回合證明。',422);
        session.threadId=thread.id;receipt.status='COMPLETED';receipt.finishedAt=new Date().toISOString();if(incoming)incoming.status='COMPLETED';
        await persist();emit({type:'workstation.turn.completed',turn:receipt.number,interactionId:receipt.inputInteractionId});
      } catch(error) {const failure=activeSignal.aborted?activeSignal.reason:error;receipt.status='FAILED';receipt.error={code:failure.code??'CODEX_SDK_FAILED',message:failure.message};if(incoming)incoming.status='FAILED';throw failure;}
      finally {detachTurn();registration.deactivate();}
    };
    await run({text:job.prompt});
    // Drain already received input at turn boundaries. The SDK has no mid-turn steer API.
    await new Promise(resolve=>setImmediate(resolve));
    while(queue.length){const item=queue.shift();queuedBytes-=Buffer.byteLength(item.text);await run(item);await new Promise(resolve=>setImmediate(resolve));}
    accepting=false;session.status='COMPLETED';session.finishedAt=new Date().toISOString();await persist();return session;
  } catch(error) {
    const failure=activeSignal.aborted?activeSignal.reason:error;
    sessionFailure=failure;
    session.status='FAILED';session.error={code:failure.code??'CODEX_SDK_FAILED',message:failure.message??String(failure)};session.finishedAt=new Date().toISOString();
    await persist();throw failure;
  } finally {
    accepting=false;reader?.close();if(restoreRawMode!==undefined)input.setRawMode(restoreRawMode);input.pause?.();
    // SDK 0.166.0 removes its child error listeners as the iterator closes.
    // Aborting that already-finished signal can emit an unhandled AbortError
    // before the native child has exited. Revoke the provider independently.
    activeSignal.removeEventListener('abort',abortProvider);
    try{await closeProvider();}catch(error){if(sessionFailure)sessionFailure.message+=`\nSDK provider cleanup: ${error.message}`;else throw error;}
  }
}

function finishSdkInputs(store,parentId,interactionIds,session) {
  for(const interactionId of interactionIds) {
    const receipt=session?.inputs?.find(item=>item.interactionId===interactionId),operation=store.get(interactionId);
    const consumed=receipt&&['COMPLETED','FAILED','RUNNING'].includes(receipt.status)&&receipt.inputDigest===digest(operation?.request?.input?.message??'');
    if(consumed)store.acknowledgeInput(parentId,interactionId);
    if(consumed&&receipt.status==='COMPLETED')store.finish(interactionId,'SUCCEEDED',{delivery:'sent',reason:'SDK_TURN_COMPLETED',threadId:session.threadId});
    else store.finish(interactionId,'FAILED',{delivery:consumed?'sent':'not-delivered',reason:consumed?'SDK_TURN_FAILED':'NOT_DELIVERED'},
      {code:consumed?'SDK_INPUT_TURN_FAILED':'SDK_INPUT_NOT_DELIVERED',message:consumed?'SDK 後續回合未完成。':'輸入未進入 SDK 後續回合。'});
  }
}

/** The PTY supervises a Node SDK host; it never implements the Codex CLI protocol. */
export async function runCodexSdkAgent(context,{agent,prompt,cwd,task,timeoutMs=agent.timeoutMs,log}) {
  const {options,store,request}=context,progress=currentProgress();
  invariant(progress,'PROGRESS_REQUIRED','SDK 派工需要持久化進度紀錄。');
  saveProgressPhase(options.home,request.operationId,{phase:'STARTING',runtime:'codex-sdk',inputDelivery:'next-turn'});
  const directory=path.dirname(task),transportFile=await freezeCodexTransport(context,agent);
  const job={schemaVersion:1,operationId:request.operationId,repositoryId:request.repositoryId,home:options.home,directory,cwd,task,prompt,transportFile};
  const jobFile=path.join(directory,'codex-sdk-job.json');await writeJson(jobFile,job);
  const pty=await terminalRuntime(context),interactionIds=[];
  let inputReady=false,startupBuffer='';
  const record=data=>{
    if(!inputReady) {
      startupBuffer+=data;
      let newline;
      while(!inputReady&&(newline=startupBuffer.indexOf('\n'))>=0) {
        const line=startupBuffer.slice(0,newline).replace(/\r$/,'');startupBuffer=startupBuffer.slice(newline+1);
        let event;try{event=JSON.parse(line);}catch{continue;}
        if(event.type==='workstation.input.ready'&&event.operationId===request.operationId) {
          inputReady=true;startupBuffer='';
          saveProgressPhase(options.home,request.operationId,{phase:'RUNNING',runtime:'codex-sdk',inputDelivery:'next-turn'});
        }
      }
      if(startupBuffer.length>65536)startupBuffer=startupBuffer.slice(-65536);
    }
    (log??(text=>progress.output(text)))(data);
  };
  let outcome,session,failure;
  try {
    outcome=await runPty(pty,process.execPath,[hostScript,jobFile],cwd,{timeoutMs,shutdownGraceMs:sdkShutdownGraceMs,routeInputs:false,log:record,
      encodeInput:message=>{
        if(!message.interactionId)return null;
        invariant(inputReady,'SDK_INPUT_NOT_READY','SDK 輸入尚未就緒，請等待派工開始後重試。',409);
        const interaction=store.get(message.interactionId);
        invariant(interaction?.request?.operation==='interaction.cli.input'&&interaction.request.input.parentOperationId===request.operationId,'INVALID_SDK_INPUT','SDK 輸入不屬於此派工。');
        return JSON.stringify({type:'workstation.sdk.input',interactionId:message.interactionId,message:interaction.request.input.message})+'\n';
      },onInputDelivered:interactionId=>{if(!interactionIds.includes(interactionId))interactionIds.push(interactionId);}});
  } catch(error) {failure=error;}
  try {
    try{session=await readJson(path.join(directory,'sdk-session.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
    if(session)invariant(session.operationId===request.operationId&&session.repositoryId===request.repositoryId,'SDK_SESSION_MISMATCH','SDK 回執不屬於此派工。');
    finishSdkInputs(store,request.operationId,interactionIds,session);
  } catch(error) {failure??=error;}
  if(failure)throw failure;
  const completed=session?.status==='COMPLETED'&&session.turns?.length&&session.turns.every(turn=>turn.status==='COMPLETED');
  if(outcome.exitCode===0&&!completed){outcome.exitCode=1;progress.output('\n[SDK] CODEX_SDK_INCOMPLETE: 程序結束但沒有完整 SDK 回合證明。\n');}
  saveProgressPhase(options.home,request.operationId,{phase:'CHECKING',runtime:'codex-sdk',threadId:session?.threadId??null});
  return {...outcome,threadId:session?.threadId??null,output:readProgress(options.home,request.operationId)?.output.toString()??''};
}
