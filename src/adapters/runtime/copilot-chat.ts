import type {ChatModel,ChatSettings} from '../../ports/chat.ts';
import {automaticChatModel,chatLimits} from '../../domain/chat.ts';
import {createCopilotConnection,asError,copilotCancelled,validateCopilotArgs,validateKiroArgs} from './copilot-rpc.ts';
import {modelConfigOption,parseCopilotModels} from './copilot-models.ts';
import {workstationNamespace,agentSupervisorNamespace,codexProposalNamespace,formatInferencePrompt,parseInferenceCompletion,type ProviderTool,type CopilotTool,type CopilotCompletion} from './chat-tool-protocol.ts';

interface RuntimeOptions {idleMs?:number;startupTimeoutMs?:number;cleanupTimeoutMs?:number;toolPolicy?:'workstation'|'codex';prewarm?:boolean}
type Collector=ReturnType<typeof collectCompletion>;
type Connection=ReturnType<typeof createCopilotConnection>;
type Server={key:string;isKiro:boolean;unclosed:number;connection:Connection;ready:Promise<any>;warmSession?:Promise<any>;sessions:Map<string,Collector>;owned:Set<string>;active:number;reusable:boolean;idle?:ReturnType<typeof setTimeout>;closing?:Promise<void>};

/** Reuse the ACP server; each inference receives one isolated Codex-owned history with zero MCP servers. */
export function createCopilotRuntime(cwd:string,options:RuntimeOptions={}){
 const idleMs=options.idleMs??300000,cleanupMs=options.cleanupTimeoutMs??2000,startupMs=options.startupTimeoutMs??10000;
 const servers=new Map<string,Server>(),allServers=new Set<Server>(),jobs=new Set<Promise<unknown>>(),controllers=new Set<AbortController>();
 const shutdownFailures:Error[]=[];
 let closed=false,closing:Promise<void>|undefined;

 function retire(server:Server){
  if(server.closing)return server.closing;
  clearTimeout(server.idle);if(servers.get(server.key)===server)servers.delete(server.key);
  server.warmSession=undefined;
  server.closing=(async()=>{try{await server.connection.close();}finally{allServers.delete(server);}})();
  void server.closing.catch(error=>{shutdownFailures.push(asError(error));});return server.closing;
 }
 function scheduleWarmSession(server:Server){
  if(!options.prewarm||closed||!server.reusable||!server.connection.usable||server.warmSession)return;
  const p=(async()=>{
   await server.ready;
   if(closed||!server.reusable||!server.connection.usable)return undefined;
   return await server.connection.rpc('session/new',{cwd,mcpServers:[]},undefined,startupMs);
  })();
  server.warmSession=p;
  void p.catch(()=>{if(server.warmSession===p)server.warmSession=undefined;});
 }
 function acquire(settings:ChatSettings){
  const isKiro=settings.acpProvider==='kiro';
  if(isKiro)validateKiroArgs(settings.kiroArgs??[]);
  else validateCopilotArgs(settings.copilotArgs);
  const key=JSON.stringify(isKiro?['kiro',settings.kiroExecutable,settings.kiroArgs??[]]:[settings.copilotExecutable,settings.copilotArgs]);let server=servers.get(key);
  if(server&&(!server.connection.usable||!server.reusable)){if(server.active===0)void retire(server);server=undefined;}
  if(!server){
   for(const previous of servers.values())if(previous.active===0)void retire(previous);
   if(allServers.size>=4)throw Error('Copilot 同時使用的執行設定過多，請稍後再試');
   const sessions=new Map<string,Collector>();
   const connection=createCopilotConnection(settings,cwd,{
    event:(id,event)=>sessions.get(id)?.event(event),
    request:(id,method,params)=>{
     const collector=id?sessions.get(id):undefined;
     // The transport refuses every client request. Late requests from a
     // closed session must not cancel a different room on this shared server.
     collector?.request(method,params);
    },
    failure:error=>{for(const session of sessions.values())session.fail(error);},
   });
   const ready=(async()=>{
    try{
     const result=await connection.rpc('initialize',{protocolVersion:1,clientInfo:{name:'bdd-codex-inference',version:'1.0.0'},clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false}},undefined,startupMs);
     if(result?.protocolVersion!==1)throw Error('Copilot ACP 協定版本不相容（需要 v1）');
     return result.agentCapabilities??{};
    }catch(error){connection.fail(asError(error));throw error;}
   })();
   server={key,isKiro,unclosed:0,connection,ready,sessions,owned:new Set(),active:0,reusable:true};servers.set(key,server);allServers.add(server);
   void ready.catch(()=>{void retire(server!);});
   scheduleWarmSession(server);
  }
  clearTimeout(server.idle);server.active++;return server;
 }
 function release(server:Server){
  server.active--;
  if(server.active===0&&!server.closing){
   if(!server.reusable){void retire(server);return;}
   server.idle=setTimeout(()=>{void retire(server);},idleMs);server.idle.unref();
  }
 }
 function run<T>(settings:ChatSettings,signal:AbortSignal,operation:(server:Server,signal:AbortSignal,snapshot:ChatSettings)=>Promise<T>):Promise<T>{
  if(closed)return Promise.reject(Error('Copilot runtime 已關閉'));
  if(signal.aborted)return Promise.reject(copilotCancelled());
  if(jobs.size>=64)return Promise.reject(Error('Copilot 同時處理的請求過多，請稍後再試'));
  const snapshot={...settings,copilotArgs:[...settings.copilotArgs],...(settings.kiroArgs?{kiroArgs:[...settings.kiroArgs]}:{})},controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]);
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
 async function closeSession(server:Server,sessionId:string){
  server.sessions.delete(sessionId);server.owned.delete(sessionId);
  if(!server.connection.usable)return;
  const capabilities=await server.ready;
  const method=capabilities.sessionCapabilities?.close?'session/close':capabilities.sessionCapabilities?.delete?'session/delete':undefined;
  if(!method){
   server.unclosed++;
   // Kiro CLI ACP routes state purely by sessionId and does not expose session/close.
   // Keep the Kiro process warm across turns and drain only after a bounded pool size.
   if(!server.isKiro||server.unclosed>=32){
    server.reusable=false;if(servers.get(server.key)===server)servers.delete(server.key);
   }
   return;
  }
  try{await server.connection.rpc(method,{sessionId},undefined,cleanupMs);}
  catch(error){server.connection.fail(asError(error));await retire(server);throw error;}
 }
 async function session<T>(server:Server,current:AbortSignal,snapshot:ChatSettings,operation:(created:any)=>Promise<T>):Promise<T>{
  let sessionId:string|undefined,error:unknown;
  const adopt=(response:any)=>{
   if(typeof response?.sessionId!=='string'||!response.sessionId||server.owned.has(response.sessionId)){
    server.reusable=false;if(servers.get(server.key)===server)servers.delete(server.key);
    throw Error('Copilot ACP 回傳了無效或重複的工作階段');
   }
   if(server.isKiro&&typeof response?.modes?.currentModeId==='string'&&response.modes.currentModeId!=='bdd_inference'){
    server.reusable=false;if(servers.get(server.key)===server)servers.delete(server.key);
    throw Error(`Kiro ACP 未處於零工具與零 MCP 隔離模式（目前為 ${response.modes.currentModeId}）`);
   }
   sessionId=response.sessionId;server.owned.add(sessionId!);
  };
  const warm=server.warmSession;
  if(warm)server.warmSession=undefined;
  const created=warm?warm.then(res=>res??server.connection.rpc('session/new',{cwd,mcpServers:[]},undefined,snapshot.timeoutMs+cleanupMs),()=>server.connection.rpc('session/new',{cwd,mcpServers:[]},undefined,snapshot.timeoutMs+cleanupMs)):server.connection.rpc('session/new',{cwd,mcpServers:[]},undefined,snapshot.timeoutMs+cleanupMs);
  if(warm)scheduleWarmSession(server);
  try{
   let response:any;
   try{response=await cancellable(created,current);}
   catch(reason){
    // A cancelled session/new may still create a session. Receive its id and
    // close it; if the agent never answers, retire that process within a bound.
    if(current.aborted&&server.connection.usable){
     try{response=await bounded(created,cleanupMs,'session/new 取消後未完成');}
     catch(cleanup){server.connection.fail(asError(cleanup));await retire(server);}
     // Never close another room's session if a broken agent reuses its id.
     // Drain the server after its existing rooms finish instead.
     if(response)try{adopt(response);}catch{ /* Preserve the original cancellation. */ }
    }
    throw reason;
   }
   adopt(response);
   if(current.aborted)throw copilotCancelled();
   return await operation(response);
  }catch(reason){error=reason;throw reason;}
  finally{if(sessionId)try{await closeSession(server,sessionId);}catch(cleanup){if(!error)throw cleanup;}}
 }
 return {
  warmup(settings:ChatSettings):Promise<void>{
   if(!options.prewarm||closed)return Promise.resolve();
   return run(settings,new AbortController().signal,async server=>{
    scheduleWarmSession(server);
    if(server.warmSession)await server.warmSession;
   }).catch(()=>{});
  },
  models(settings:ChatSettings,signal:AbortSignal):Promise<ChatModel[]>{
   return run(settings,signal,(server,current,snapshot)=>session(server,current,snapshot,async created=>parseCopilotModels(created)));
  },
  completion(settings:ChatSettings,prompt:string,signal:AbortSignal,tools:CopilotTool[],onDelta?:(delta:string)=>void):Promise<CopilotCompletion>{
   let declared:ProviderTool[];try{declared=validateTools(tools,options.toolPolicy??'workstation');}catch(error){return Promise.reject(error);}
   const formattedPrompt=formatInferencePrompt(prompt,declared);
   return run(settings,signal,async(server,current,snapshot)=>{
    let sessionId:string|undefined,running=false,settled=false,cancelled=false;
    const cancel=()=>{if(running&&!settled&&!cancelled&&server.connection.usable&&sessionId){cancelled=true;server.connection.notify('session/cancel',{sessionId});}};
    const collector=collectCompletion(declared,onDelta,cancel);
    return await session(server,current,snapshot,async created=>{
     sessionId=created.sessionId;server.sessions.set(sessionId!,collector);
     await selectModel(server.connection,created,snapshot.model,current,snapshot.timeoutMs);
     if(current.aborted)throw copilotCancelled();
     const pending=server.connection.rpc('session/prompt',{sessionId,prompt:[{type:'text',text:formattedPrompt}]},undefined,snapshot.timeoutMs+cleanupMs);
     running=true;void pending.then(()=>{settled=true;},()=>{settled=true;});
     try{
      const response=await cancellable(pending,current);
      if(collector.failure)throw collector.failure;
      if(response?.stopReason!=='end_turn')throw Error(response?.stopReason==='cancelled'?'Copilot 請求已取消或逾時':`Copilot ACP 回覆未完成（${String(response?.stopReason)}）`);
      if(current.aborted)throw copilotCancelled();
      return collector.finish();
     }catch(reason){
      const error=collector.failure??asError(reason);cancel();
      if(!settled&&server.connection.usable){
       try{await bounded(pending,cleanupMs,'session/prompt 取消後未完成');}
       catch(cleanup){server.connection.fail(asError(cleanup));await retire(server);}
      }
      throw error;
     }finally{running=false;}
    });
   });
  },
  close(){return closing??=(async()=>{
   closed=true;for(const controller of controllers)controller.abort();
   const stopped=Promise.allSettled([...allServers].map(retire));await Promise.allSettled(jobs);await stopped;
   if(shutdownFailures.length)throw shutdownFailures[0];
  })();},
 };
}

async function selectModel(connection:Connection,created:any,model:string,signal:AbortSignal,timeoutMs:number){
 const models=parseCopilotModels(created),option=modelConfigOption(created);
 if(model===automaticChatModel&&!models.some(candidate=>candidate.id===model))return;
 if(!models.some(candidate=>candidate.id===model))throw Error(`Copilot ACP 未提供模型「${model}」，請重新取得模型清單`);
 if(option){
  if(option.currentValue===model)return;
  const changed=await connection.rpc('session/set_config_option',{sessionId:created.sessionId,configId:option.id,value:model},signal,timeoutMs);
  if(modelConfigOption(changed)?.currentValue!==model)throw Error('Copilot ACP 未套用選取的模型');
 }else{
  if(created.models?.currentModelId===model)return;
  await connection.rpc('session/set_model',{sessionId:created.sessionId,modelId:model},signal,timeoutMs);
 }
}
function cancellable<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
 if(signal.aborted)return Promise.reject(copilotCancelled());
 return new Promise((resolve,reject)=>{
  const abort=()=>reject(copilotCancelled());signal.addEventListener('abort',abort,{once:true});
  promise.then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
 });
}
function bounded<T>(promise:Promise<T>,timeoutMs:number,message:string):Promise<T>{
 let timer:ReturnType<typeof setTimeout>;
 return Promise.race([promise,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(Error(`Copilot ACP ${message}（取消或逾時）`)),timeoutMs);})]).finally(()=>clearTimeout(timer));
}
function validateTools(tools:ProviderTool[],policy:'workstation'|'codex'):ProviderTool[]{
 const validTool=(tool:ProviderTool)=>{
  if(typeof tool?.description!=='string'||tool.parameters?.type!=='object'||typeof tool.name!=='string'||tool.name.length>35)return false;
  if(policy==='codex')return tool.namespace===codexProposalNamespace&&/^codex_tool_[0-9]+$/.test(tool.name);
  if(tool.namespace===workstationNamespace)return /^workbench_[a-zA-Z0-9_]+$/.test(tool.name);
  if(tool.namespace===agentSupervisorNamespace)return /^agent_(?:start|send|events|list|cancel|stop)$/.test(tool.name);
  return false;
 };
 if(!Array.isArray(tools)||tools.some(tool=>!validTool(tool))||new Set(tools.map(tool=>`${tool.namespace}:${tool.name}`)).size!==tools.length)throw Error('Copilot 工具宣告未授權或無效（工具名稱最多 35 字元）');
 return tools.map(tool=>({...tool,...(tool.source?{source:{...tool.source}}:{}),parameters:structuredClone(tool.parameters)}));
}
const copilotNoticeChunk=/^Info: (?:Disabled tools: |Unknown tool name in the tool allowlist: )/;
const streamingMessagePrefix=/^(?:Info: (?:Disabled tools: [^\n{]*|Unknown tool name in the tool allowlist: "[^"]*")\s*)*\s*(?:```(?:json)?\s*)?\{\s*"type"\s*:\s*"message"\s*,\s*"text"\s*:\s*"/;
function extractStreamingMessageText(raw:string):string|undefined{
 const match=streamingMessagePrefix.exec(raw);
 if(!match)return undefined;
 let i=match[0].length,safeEnd=i;
 while(i<raw.length){
  const ch=raw[i];
  if(ch==='"')break;
  if(ch==='\\'){
   if(i+1>=raw.length)break;
   if(raw[i+1]==='u'){
    if(i+6>raw.length||!/^[0-9a-fA-F]{4}$/.test(raw.slice(i+2,i+6)))break;
    i+=6;safeEnd=i;continue;
   }
   i+=2;safeEnd=i;continue;
  }
  i++;safeEnd=i;
 }
 try{return JSON.parse(`"${raw.slice(match[0].length,safeEnd)}"`);}catch{return undefined;}
}
function collectCompletion(tools:ProviderTool[],onDelta:((delta:string)=>void)|undefined,onCancel:()=>void){
 let text='',bytes=0,streamed='',failure:Error|undefined,finished=false;
 const fail=(error:Error)=>{if(failure||finished)return;failure=error;onCancel();};
 return {fail,get failure(){return failure;},
  finish(){
   if(failure)throw failure;
   const result=parseInferenceCompletion(text,tools);
   if(tools.length&&result.text){
    const tail=result.text.startsWith(streamed)?result.text.slice(streamed.length):result.text;
    if(tail)onDelta?.(tail);
   }
   finished=true;return result;
  },
  request(_method:string,_params:any){
   fail(Error('Copilot 不得執行工作站工具或要求客戶端權限'));
  },
  event(update:any){
   if(failure||finished)return;
   try{
    if(update.sessionUpdate==='agent_message_chunk'){
     if(update.content?.type!=='text'||typeof update.content.text!=='string')throw Error('Copilot ACP 文字增量格式錯誤');
     if(tools.length&&!text&&copilotNoticeChunk.test(update.content.text))return;
     bytes+=Buffer.byteLength(update.content.text);if(bytes>chatLimits.providerRequest)throw Error('Copilot 回覆超過大小限制');
     text+=update.content.text;
     if(!tools.length){
      onDelta?.(update.content.text);
     }else if(onDelta){
      const decoded=extractStreamingMessageText(text);
      if(decoded&&decoded.length>streamed.length){
       const delta=decoded.slice(streamed.length);
       streamed=decoded;
       onDelta(delta);
      }
     }
    }
    if(update.sessionUpdate==='tool_call'||update.sessionUpdate==='tool_call_update'){
     throw Error('Copilot 不得執行工作站工具');
    }
   }catch(error){fail(asError(error));}
  },
 };
}
