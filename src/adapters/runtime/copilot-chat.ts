import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {ChatModel,ChatSettings} from '../../ports/chat.ts';
import {automaticChatModel,chatLimits} from '../../domain/chat.ts';
import {createCopilotConnection,asError,copilotCancelled,validateCopilotArgs} from './copilot-rpc.ts';
import {modelConfigOption,parseCopilotModels} from './copilot-models.ts';
import {createCopilotToolBridge} from './copilot-tools.ts';
import {workstationNamespace,codexProposalNamespace,type CopilotTool,type CopilotCall,type CopilotCompletion} from './chat-tool-protocol.ts';

interface RuntimeOptions {idleMs?:number;startupTimeoutMs?:number;cleanupTimeoutMs?:number;toolPolicy?:'workstation'|'codex'}
type Collector=ReturnType<typeof collectCompletion>;
type Connection=ReturnType<typeof createCopilotConnection>;
type Server={key:string;connection:Connection;ready:Promise<any>;sessions:Map<string,Collector>;owned:Set<string>;active:number;reusable:boolean;idle?:ReturnType<typeof setTimeout>;closing?:Promise<void>};

/** Reuse the ACP server; each inference receives one isolated Codex-owned history. */
export function createCopilotRuntime(cwd:string,options:RuntimeOptions={}){
 const idleMs=options.idleMs??300000,cleanupMs=options.cleanupTimeoutMs??2000,startupMs=options.startupTimeoutMs??10000;
 // Copilot truncates model-visible MCP names at 64 characters. Keep enough
 // space for every workstation name while retaining a private random prefix.
 const mcpName='bdd_'+randomUUID().replaceAll('-','').slice(0,24);
 const servers=new Map<string,Server>(),allServers=new Set<Server>(),jobs=new Set<Promise<unknown>>(),controllers=new Set<AbortController>();
 const shutdownFailures:Error[]=[];
 let closed=false,closing:Promise<void>|undefined,bridge:ReturnType<typeof createCopilotToolBridge>|undefined;

 function retire(server:Server){
  if(server.closing)return server.closing;
  clearTimeout(server.idle);if(servers.get(server.key)===server)servers.delete(server.key);
  server.closing=(async()=>{try{await server.connection.close();}finally{allServers.delete(server);}})();
  void server.closing.catch(error=>{shutdownFailures.push(asError(error));});return server.closing;
 }
 function acquire(settings:ChatSettings){
  validateCopilotArgs(settings.copilotArgs);
  const key=JSON.stringify([settings.copilotExecutable,settings.copilotArgs]);let server=servers.get(key);
  if(server&&(!server.connection.usable||!server.reusable)){if(server.active===0)void retire(server);server=undefined;}
  if(!server){
   for(const previous of servers.values())if(previous.active===0)void retire(previous);
   if(allServers.size>=4)throw Error('Copilot 同時使用的執行設定過多，請稍後再試');
   const sessions=new Map<string,Collector>();
   const connection=createCopilotConnection(settings,cwd,mcpName,{
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
   server={key,connection,ready,sessions,owned:new Set(),active:0,reusable:true};servers.set(key,server);allServers.add(server);
   void ready.catch(()=>{void retire(server!);});
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
 async function closeSession(server:Server,sessionId:string){
  server.sessions.delete(sessionId);server.owned.delete(sessionId);
  if(!server.connection.usable)return;
  const capabilities=await server.ready;
  const method=capabilities.sessionCapabilities?.close?'session/close':capabilities.sessionCapabilities?.delete?'session/delete':undefined;
  if(!method){
   // Older ACP servers cannot release sessions. Drain this process instead of
   // accumulating history indefinitely or falling back to a private protocol.
   server.reusable=false;if(servers.get(server.key)===server)servers.delete(server.key);return;
  }
  try{await server.connection.rpc(method,{sessionId},undefined,cleanupMs);}
  catch(error){server.connection.fail(asError(error));await retire(server);throw error;}
 }
 async function session<T>(server:Server,current:AbortSignal,snapshot:ChatSettings,mcpServers:object[],operation:(created:any)=>Promise<T>):Promise<T>{
  let sessionId:string|undefined,error:unknown;
  const adopt=(response:any)=>{
   if(typeof response?.sessionId!=='string'||!response.sessionId||server.owned.has(response.sessionId)){
    server.reusable=false;if(servers.get(server.key)===server)servers.delete(server.key);
    throw Error('Copilot ACP 回傳了無效或重複的工作階段');
   }
   sessionId=response.sessionId;server.owned.add(sessionId!);
  };
  const created=server.connection.rpc('session/new',{cwd,mcpServers},undefined,snapshot.timeoutMs+cleanupMs);
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
  models(settings:ChatSettings,signal:AbortSignal):Promise<ChatModel[]>{
   return run(settings,signal,(server,current,snapshot)=>session(server,current,snapshot,[],async created=>parseCopilotModels(created)));
  },
  completion(settings:ChatSettings,prompt:string,signal:AbortSignal,tools:CopilotTool[],onDelta?:(delta:string)=>void):Promise<CopilotCompletion>{
   let declared:CopilotTool[];try{declared=validateTools(tools,options.toolPolicy??'workstation');}catch(error){return Promise.reject(error);}
   return run(settings,signal,async(server,current,snapshot)=>{
    let sessionId:string|undefined,running=false,settled=false,cancelled=false;
    const cancel=()=>{if(running&&!settled&&!cancelled&&server.connection.usable&&sessionId){cancelled=true;server.connection.notify('session/cancel',{sessionId});}};
    const collector=collectCompletion(declared,mcpName,onDelta,cancel);
    let registration:ReturnType<Awaited<ReturnType<typeof createCopilotToolBridge>>['register']>|undefined;
    if(declared.length){
     const capabilities=await server.ready;
     if(capabilities.mcpCapabilities?.http!==true)throw Error('Copilot ACP 不支援 HTTP MCP 工具提案，請更新 Copilot');
     const toolBridge=await cancellable(bridge??=createCopilotToolBridge(mcpName),current);
     registration=toolBridge.register(declared,(name,args)=>collector.propose(name,args),error=>collector.fail(error));
    }
    try{return await session(server,current,snapshot,registration?[registration.server]:[],async created=>{
     sessionId=created.sessionId;server.sessions.set(sessionId!,collector);
     await selectModel(server.connection,created,snapshot.model,current,snapshot.timeoutMs);
     if(current.aborted)throw copilotCancelled();
     const pending=server.connection.rpc('session/prompt',{sessionId,prompt:[{type:'text',text:prompt}]},undefined,snapshot.timeoutMs+cleanupMs);
     running=true;void pending.then(()=>{settled=true;},()=>{settled=true;});
     try{
      const outcome=await cancellable(Promise.race([pending.then(response=>({kind:'response' as const,response})),collector.handoff.then(()=>({kind:'handoff' as const}))]),current);
      let response:any;
      if(outcome.kind==='handoff'){
       cancel();response=await bounded(pending,cleanupMs,'session/prompt 取消後未完成');
       if(!['cancelled','end_turn'].includes(response?.stopReason))throw Error('Copilot ACP 工具提案未完成取消');
      }else{
       response=outcome.response;
       if(response?.stopReason!=='end_turn')throw Error(response?.stopReason==='cancelled'?'Copilot 請求已取消或逾時':`Copilot ACP 回覆未完成（${String(response?.stopReason)}）`);
      }
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
    });}finally{registration?.close();}
   });
  },
  close(){return closing??=(async()=>{
   closed=true;for(const controller of controllers)controller.abort();
   const stopped=Promise.allSettled([...allServers].map(retire));await Promise.allSettled(jobs);await stopped;
   if(bridge)await (await bridge).close();if(shutdownFailures.length)throw shutdownFailures[0];
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
function validateTools(tools:CopilotTool[],policy:'workstation'|'codex'){
 const namespace=policy==='codex'?codexProposalNamespace:workstationNamespace,pattern=policy==='codex'?/^codex_tool_[0-9]+$/:/^workbench_[a-zA-Z0-9_]+$/;
 if(!Array.isArray(tools)||tools.some(tool=>tool.namespace!==namespace||!pattern.test(tool.name)||tool.name.length>35||typeof tool.description!=='string'||tool.parameters?.type!=='object')||new Set(tools.map(tool=>tool.name)).size!==tools.length)throw Error('Copilot 工具宣告未授權或無效（工具名稱最多 35 字元）');
 return tools.map(tool=>({...tool,parameters:structuredClone(tool.parameters)}));
}
function collectCompletion(tools:CopilotTool[],mcpName:string,onDelta:((delta:string)=>void)|undefined,onCancel:()=>void){
 let text='',bytes=0,failure:Error|undefined,handedOff=false,finished=false,resolve!:()=>void,reject!:(error:Error)=>void;
 const calls:CopilotCall[]=[],declared=new Map<string,{name:string;args:Record<string,unknown>}>();
 const handoff=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});void handoff.catch(()=>{});
 const fail=(error:Error)=>{if(failure||finished)return;failure=error;reject(error);onCancel();};
 const object=(value:any):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
 const propose=(name:string,args:Record<string,unknown>,toolCallId?:string)=>{
  if(failure||finished)return;
  try{
   if(!tools.some(tool=>tool.name===name)||!object(args))throw Error('Copilot 要求未授權或無效的工具提案');
   const previous=[...declared].find(([,call])=>call.name===name&&isDeepStrictEqual(call.args,args));
   const id=toolCallId??previous?.[0]??'call_'+randomUUID();
   if(!calls.some(call=>call.toolCallId===id))calls.push({toolCallId:id,mcpServerName:'codex_handoff',mcpToolName:name,arguments:structuredClone(args)});
   if(calls.length>32)throw Error('Copilot 工具提案超過數量限制');
   handedOff=true;onCancel();resolve();
  }catch(error){fail(asError(error));}
 };
 return {handoff,fail,propose,get failure(){return failure;},
  finish(){if(failure)throw failure;if(!text.trim()&&!calls.length)throw Error('Copilot 未完成回覆');finished=true;return {text,calls:structuredClone(calls)};},
  request(method:string,params:any){
   if(failure||finished)return;
   const call=params?.toolCall,known=declared.get(call?.toolCallId);
   if(method!=='session/request_permission'||!known||![known.name,`${mcpName}-${known.name}`].includes(call.title)||!isDeepStrictEqual(known.args,call.rawInput)){
    fail(Error('Copilot 不得執行工作站工具或要求客戶端權限'));return;
   }
   propose(known.name,known.args,call.toolCallId);
  },
  event(update:any){
   if(failure||finished)return;
   try{
    if(update.sessionUpdate==='agent_message_chunk'){
     if(update.content?.type!=='text'||typeof update.content.text!=='string')throw Error('Copilot ACP 文字增量格式錯誤');
     if(handedOff)return;
     bytes+=Buffer.byteLength(update.content.text);if(bytes>chatLimits.providerRequest)throw Error('Copilot 回覆超過大小限制');
     text+=update.content.text;onDelta?.(update.content.text);
    }
    if(update.sessionUpdate==='tool_call'){
     const tool=tools.find(tool=>`${mcpName}-${tool.name}`===update.title);
     if(!tool||typeof update.toolCallId!=='string'||!update.toolCallId||!object(update.rawInput))throw Error('Copilot 不得執行未授權的工作站工具');
     if(update.status==='completed')throw Error('Copilot 不得執行工作站工具');
     if(declared.has(update.toolCallId))throw Error('Copilot ACP 工具提案識別重複');
     declared.set(update.toolCallId,{name:tool.name,args:structuredClone(update.rawInput)});
    }
    if(update.sessionUpdate==='tool_call_update'){
     const known=declared.get(update.toolCallId);if(!known)throw Error('Copilot 不得執行未授權的工作站工具');
     if(update.rawInput!==undefined&&!isDeepStrictEqual(update.rawInput,known.args))throw Error('Copilot ACP 工具提案參數不一致');
     if(update.status==='completed')throw Error('Copilot 不得執行工作站工具');
    }
   }catch(error){fail(asError(error));}
  },
 };
}
