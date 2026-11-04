import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {ChatModel,ChatSettings} from '../../ports/chat.ts';
import {chatLimits} from '../../domain/chat.ts';
import {createCopilotConnection,asError,copilotCancelled} from './copilot-rpc.ts';
import {parseCopilotModels} from './copilot-models.ts';
import {workstationNamespace,type CopilotTool,type CopilotCall,type CopilotCompletion} from './chat-tool-protocol.ts';

interface RuntimeOptions {idleMs?:number;startupTimeoutMs?:number;cleanupTimeoutMs?:number}
type Collector={event:(event:any)=>void;fail:(error:Error)=>void};
type Connection=ReturnType<typeof createCopilotConnection>;
type Server={key:string;connection:Connection;ready:Promise<void>;sessions:Map<string,Collector>;active:number;idle?:ReturnType<typeof setTimeout>;closing?:Promise<void>};

/** One inference server, with isolated disposable sessions for Codex-owned history. */
export function createCopilotRuntime(cwd:string,options:RuntimeOptions={}){
 const idleMs=options.idleMs??300000,cleanupMs=options.cleanupTimeoutMs??2000,startupMs=options.startupTimeoutMs??10000;
 const servers=new Map<string,Server>(),allServers=new Set<Server>(),jobs=new Set<Promise<unknown>>(),controllers=new Set<AbortController>();
 const shutdownFailures:Error[]=[];
 let closed=false,closing:Promise<void>|undefined;

 function retire(server:Server){
  if(server.closing)return server.closing;
  clearTimeout(server.idle);if(servers.get(server.key)===server)servers.delete(server.key);
  server.closing=(async()=>{
   try{await server.connection.close();}finally{allServers.delete(server);}
  })();
  void server.closing.catch(error=>{shutdownFailures.push(asError(error));});return server.closing;
 }
 function acquire(settings:ChatSettings){
  const key=JSON.stringify([settings.copilotExecutable,settings.copilotArgs]);let server=servers.get(key);
  if(server&&!server.connection.usable){void retire(server);server=undefined;}
  if(!server){
   // Settings changes may overlap an active old turn, but cannot accumulate an
   // unbounded number of child processes. Idle configurations retire at once.
   for(const previous of servers.values())if(previous.active===0)void retire(previous);
   if(allServers.size>=4)throw Error('Copilot 同時使用的執行設定過多，請稍後再試');
   const sessions=new Map<string,Collector>();
   const connection=createCopilotConnection(settings,cwd,{
    event:(id,event)=>sessions.get(id)?.event(event),
    request:id=>{const error=Error('Copilot 不得執行工作站工具或要求客戶端權限');if(id&&sessions.has(id))sessions.get(id)!.fail(error);else connection.fail(error);},
    failure:error=>{for(const session of sessions.values())session.fail(error);},
   });
   const ready=(async()=>{
    try{const result=await connection.rpc('connect',{},undefined,startupMs);if(result?.ok!==true||result.protocolVersion!==3)throw Error('Copilot headless 協定版本不相容（需要 v3）');}
    catch(error){connection.fail(asError(error));throw error;}
   })();
   server={key,connection,ready,sessions,active:0};servers.set(key,server);allServers.add(server);
   void ready.catch(()=>{void retire(server!);});
  }
  clearTimeout(server.idle);server.active++;return server;
 }
 function release(server:Server){
  server.active--;
  if(server.active===0&&!server.closing){server.idle=setTimeout(()=>{void retire(server);},idleMs);server.idle.unref();}
 }
 function run<T>(settings:ChatSettings,signal:AbortSignal,operation:(server:Server,signal:AbortSignal,snapshot:ChatSettings)=>Promise<T>):Promise<T>{
  if(closed)return Promise.reject(Error('Copilot runtime 已關閉'));
  if(signal.aborted)return Promise.reject(copilotCancelled());
  if(jobs.size>=64)return Promise.reject(Error('Copilot 同時處理的請求過多，請稍後再試'));
  const snapshot={...settings,copilotArgs:[...settings.copilotArgs]},controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]);
  const timer=setTimeout(()=>controller.abort(),snapshot.timeoutMs);controllers.add(controller);
  const job=(async()=>{
   let server:Server|undefined;
   try{
    server=acquire(snapshot);await cancellable(server.ready,combined);
    if(combined.aborted)throw copilotCancelled();
    return await operation(server,combined,snapshot);
   }finally{clearTimeout(timer);controllers.delete(controller);if(server)release(server);}
  })();
  jobs.add(job);void job.then(()=>jobs.delete(job),()=>jobs.delete(job));return job;
 }
 return {
  models(settings:ChatSettings,signal:AbortSignal):Promise<ChatModel[]>{return run(settings,signal,async(server,current,snapshot)=>{
   await authenticated(server.connection,current,snapshot.timeoutMs);
   return parseCopilotModels(await server.connection.rpc('models.list',{},current,snapshot.timeoutMs));
  });},
  completion(settings:ChatSettings,prompt:string,signal:AbortSignal,tools:CopilotTool[],onDelta?:(delta:string)=>void):Promise<CopilotCompletion>{
   let declared:CopilotTool[];try{declared=validateTools(tools);}catch(error){return Promise.reject(error);}
   return run(settings,signal,async(server,requestSignal,snapshot)=>{
    const sessionId=randomUUID(),controller=new AbortController(),current=AbortSignal.any([requestSignal,controller.signal]);
    const collector=collectCompletion(declared,sessionId,onDelta,()=>controller.abort());server.sessions.set(sessionId,collector);
    const abort=()=>collector.fail(copilotCancelled());current.addEventListener('abort',abort,{once:true});
    let requested=false,result:CopilotCompletion|undefined,error:Error|undefined;
    try{
     if(current.aborted)throw copilotCancelled();
     await authenticated(server.connection,current,snapshot.timeoutMs);
     if(current.aborted)throw copilotCancelled();
     requested=true;
     const created=await server.connection.rpc('session.create',{
      // Preserve the CLI's existing credential/config directory. Explicit
      // feature restrictions isolate execution without changing login lookup.
      sessionId,model:snapshot.model,clientName:'bdd-codex-inference',workingDirectory:cwd,
      streaming:true,availableTools:declared.map(tool=>tool.name),toolFilterPrecedence:'excluded',
      tools:declared.map(({name,description,parameters})=>({name,description,parameters,skipPermission:true})),
      mcpServers:{},requestPermission:true,requestUserInput:false,requestElicitation:false,hooks:false,
      enableConfigDiscovery:false,enableOnDemandInstructionDiscovery:false,customAgents:[],customAgentsLocalOnly:true,
      enableSkills:false,enableFileHooks:false,enableHostGitOperations:false,enableSessionStore:false,enableSessionTelemetry:false,
      skipEmbeddingRetrieval:true,embeddingCacheStorage:'in-memory',mcpOAuthTokenStorage:'in-memory',
      infiniteSessions:{enabled:false},memory:{enabled:false},
     },current,snapshot.timeoutMs);
     if(created?.sessionId!==sessionId)throw Error('Copilot 回傳了錯誤的工作階段');
     await server.connection.rpc('session.options.update',{sessionId,skipCustomInstructions:true,customAgentsLocalOnly:true,coauthorEnabled:false,manageScheduleEnabled:false,installedPlugins:[],includedBuiltinSkills:[]},current,snapshot.timeoutMs);
     const sent=await server.connection.rpc('session.send',{sessionId,prompt},current,snapshot.timeoutMs);
     if(typeof sent?.messageId!=='string'||!sent.messageId)throw Error('Copilot 缺少訊息識別');
     result=await collector.result;
    }catch(reason){error=collector.failure??asError(reason);}
    finally{
     current.removeEventListener('abort',abort);
     if(requested&&server.connection.usable){
      try{
       // Never return an external-tool success to Copilot. Abort its pending
       // request, detach, and delete only our newly minted ephemeral session.
       for(const method of ['session.abort','session.destroy','session.delete']){
        const response=await server.connection.rpc(method,{sessionId},undefined,cleanupMs);
        if(response?.success!==true)throw Error(`Copilot ${method} 未完成`);
       }
      }catch(reason){error??=asError(reason);server.connection.fail(asError(reason));try{await retire(server);}catch(reason){error??=asError(reason);}}
     }
     server.sessions.delete(sessionId);
    }
    if(error)throw error;if(collector.failure)throw collector.failure;if(current.aborted)throw copilotCancelled();
    return result!;
   });
  },
  close(){return closing??=(async()=>{closed=true;for(const controller of controllers)controller.abort();const stopped=Promise.allSettled([...allServers].map(retire));await Promise.allSettled(jobs);await stopped;if(shutdownFailures.length)throw shutdownFailures[0];})();},
 };
}

async function authenticated(connection:Connection,signal:AbortSignal,timeout:number){
 const auth=await connection.rpc('auth.getStatus',{},signal,timeout);
 if(auth?.isAuthenticated!==true)throw Error('GitHub Copilot 尚未登入，請先執行 copilot login');
}
function cancellable<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
 if(signal.aborted)return Promise.reject(copilotCancelled());
 return new Promise((resolve,reject)=>{
  const abort=()=>reject(copilotCancelled());signal.addEventListener('abort',abort,{once:true});
  promise.then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
 });
}
function validateTools(tools:CopilotTool[]){
 if(!Array.isArray(tools)||tools.some(tool=>tool.namespace!==workstationNamespace||!/^workbench_[a-zA-Z0-9_]+$/.test(tool.name)||typeof tool.description!=='string'||tool.parameters?.type!=='object')||new Set(tools.map(tool=>tool.name)).size!==tools.length)throw Error('Copilot 工具宣告未授權或無效');
 return tools.map(tool=>({...tool,parameters:structuredClone(tool.parameters)}));
}
function collectCompletion(tools:CopilotTool[],sessionId:string,onDelta:((delta:string)=>void)|undefined,onFailure:()=>void){
 let text='',bytes=0,failure:Error|undefined,done=false,resolve!:(result:CopilotCompletion)=>void,reject!:(error:Error)=>void;
 const deltas=new Map<string,string>(),completed=new Set<string>(),calls:CopilotCall[]=[];
 const result=new Promise<CopilotCompletion>((yes,no)=>{resolve=yes;reject=no;});void result.catch(()=>{});
 const fail=(error:Error)=>{if(failure)return;failure=error;reject(error);onFailure();};
 const finish=()=>{done=true;resolve({text,calls});};
 const append=(delta:string)=>{bytes+=Buffer.byteLength(delta);if(bytes>chatLimits.providerRequest)throw Error('Copilot 回覆超過大小限制');onDelta?.(delta);};
 return {result,fail,get failure(){return failure;},event(event:any){
  if(failure)return;
  try{
   const data=event.data??{};
   if(event.type==='session.error')throw Error(typeof data.message==='string'?data.message:'Copilot 工作階段失敗');
   if(event.type==='permission.requested')throw Error('Copilot 不得執行工作站工具或要求權限');
   if(event.type==='tool.execution_start'||event.type==='external_tool.requested'){
    const call=calls.find(call=>call.toolCallId===data.toolCallId);
    if(!call||data.toolName!==call.mcpToolName||data.mcpServerName!==undefined||(data.sessionId!==undefined&&data.sessionId!==sessionId)||!isDeepStrictEqual(data.arguments,call.arguments))throw Error('Copilot 不得執行工作站工具');
    return;
   }
   if(event.type==='tool.execution_complete'){
    // The CLI may report an aborted external declaration while cleanup runs;
    // an actual completed execution is never accepted as a model reply.
    if(!done||!calls.some(call=>call.toolCallId===data.toolCallId)||data.success===true)throw Error('Copilot 不得執行工作站工具');
    return;
   }
   if(done)return;
   if(event.type==='assistant.message_delta'){
    if(typeof data.messageId!=='string'||!data.messageId||typeof data.deltaContent!=='string'||completed.has(data.messageId))throw Error('Copilot 增量格式錯誤');
    deltas.set(data.messageId,(deltas.get(data.messageId)??'')+data.deltaContent);append(data.deltaContent);
   }
   if(event.type==='assistant.message'){
    if(typeof data.messageId!=='string'||!data.messageId||typeof data.content!=='string'||completed.has(data.messageId))throw Error('Copilot 回覆格式錯誤');
    const streamed=deltas.get(data.messageId);
    if(streamed!==undefined&&streamed!==data.content)throw Error('Copilot 增量與完成訊息不一致');
    if(streamed===undefined&&data.content)append(data.content);
    deltas.delete(data.messageId);completed.add(data.messageId);text+=data.content;
    if(data.toolRequests!==undefined&&!Array.isArray(data.toolRequests))throw Error('Copilot 工具呼叫格式錯誤');
    for(const call of data.toolRequests??[]){
     if(call.type!=='function'||typeof call.toolCallId!=='string'||!call.toolCallId||calls.some(previous=>previous.toolCallId===call.toolCallId)||!tools.some(tool=>tool.name===call.name)||call.mcpServerName!==undefined||!call.arguments||typeof call.arguments!=='object'||Array.isArray(call.arguments))throw Error('Copilot 要求未授權或無效的工具呼叫');
     calls.push({toolCallId:call.toolCallId,mcpServerName:'codex_handoff',mcpToolName:call.name,arguments:call.arguments});
    }
    if(calls.length){if(deltas.size)throw Error('Copilot 訊息串流未完成');finish();}
   }
   if(event.type==='session.idle'){
    if(!completed.size||!text.trim()||deltas.size)throw Error('Copilot 未完成回覆');finish();
   }
  }catch(error){fail(asError(error));}
 }};
}
