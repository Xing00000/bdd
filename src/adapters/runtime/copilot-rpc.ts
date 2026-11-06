import type {ChatSettings} from '../../ports/chat.ts';
import {chatLimits} from '../../domain/chat.ts';
import {spawnChatProcess} from './chat-process.ts';

type Pending={resolve:(value:any)=>void;reject:(error:Error)=>void};
type Listeners={event:(sessionId:string,update:any)=>void;request:(sessionId:string|undefined,method:string,params:any)=>void;failure:(error:Error)=>void};
export const copilotCancelled=()=>Error('Copilot 請求已取消或逾時');
export const asError=(error:unknown)=>error instanceof Error?error:Error(String(error));

/** The adapter owns transport, session and tool policy; saved arguments cannot override them. */
export function validateCopilotArgs(args:string[]){
 if(!Array.isArray(args)||args.some(value=>typeof value!=='string'))throw Error('Copilot ACP 啟動參數必須是文字陣列');
 const reserved=/^(?:--(?:acp|stdio|headless|prompt|interactive|output-format|stream|model|agent|mode|autopilot|plan|fleet|resume|continue|session-id|connect|host-environment|host-ahp|host-compute-id|port|http|allow(?:-.*)?|yolo|available-tools|excluded-tools|additional-mcp-config|enable-mcp-server|disable-mcp-server|enable-all-github-mcp-tools|add-github-mcp-toolset|add-github-mcp-tool|mcp-github-auth|plugin-dir|extension-sdk-path|add-dir|attachment|trust-folder|share|share-gist|enable-memory|assisted-approval|bash-env|config-dir|sync-session)(?:=|$)|-(?:p|i|r|C)(?:[^a-zA-Z]|$))/;
 for(const value of args)if(value==='--'||reserved.test(value)||/^-[pirC]/.test(value))throw Error(`Copilot ACP 啟動參數不相容：${value.split('=')[0]}。請移除舊 CLI／權限參數；傳輸、模型與工具由 ACP 工作階段管理。`);
}

/** Official ACP stdio transport: one JSON-RPC 2.0 message per UTF-8 line. */
export function createCopilotConnection(settings:ChatSettings,cwd:string,mcpServerName:string,listeners:Listeners){
 validateCopilotArgs(settings.copilotArgs);
 const controller=new AbortController();
 // A unique allowlist excludes builtin tools AND unrelated configured MCPs.
 // Empty --available-tools does not disable tools in Copilot 1.0.105.
 const args=[...settings.copilotArgs,'--acp','--stdio','--no-auto-update','--disable-builtin-mcps','--no-custom-instructions','--no-ask-user','--no-bash-env','--sync-session=off',`--available-tools=${mcpServerName}/*`];
 const env={...process.env,COPILOT_ALLOW_ALL:'false',COPILOT_ASSISTED_APPROVAL:'false'};
 const child=spawnChatProcess(settings.copilotExecutable,args,{cwd,signal:controller.signal,env});
 child.stderr.resume();
 const pending=new Map<number,Pending>();let buffer:Buffer=Buffer.alloc(0),next=0,failure:Error|undefined,closing:Promise<void>|undefined;
 const fail=(error:Error)=>{
  if(failure)return;failure=error;
  for(const entry of pending.values())entry.reject(error);pending.clear();
  listeners.failure(error);child.terminate();
 };
 const send=(message:object)=>{
  if(failure)throw failure;
  const body=JSON.stringify(message);if(Buffer.byteLength(body)>chatLimits.providerRequest)throw Error('Copilot ACP 請求超過大小限制');
  child.stdin.write(body+'\n');
 };
 child.on('error',error=>fail(Error(`無法啟動 Copilot ACP：${error.message}`)));
 child.stdin.on('error',error=>fail(error));
 // The npm loader may exit while a descendant still owns its stdio.
 child.once('exit',code=>fail(Error(`Copilot ACP 程序已結束（exit ${code}）`)));
 child.on('close',code=>fail(Error(`Copilot ACP 程序已結束（exit ${code}）`)));
 void child.finished.catch(error=>fail(asError(error)));
 child.stdout.on('data',(chunk:Buffer)=>{
  if(failure)return;
  try{
   buffer=Buffer.concat([buffer,chunk]);
   while(true){
    const boundary=buffer.indexOf('\n');
    if(boundary<0){if(buffer.length>chatLimits.providerRequest)throw Error('Copilot ACP 訊息超過大小限制');return;}
    if(boundary>chatLimits.providerRequest)throw Error('Copilot ACP 訊息超過大小限制');
    const line=buffer.subarray(0,boundary).toString('utf8');buffer=buffer.subarray(boundary+1);
    if(!line.trim())continue;
    const message=JSON.parse(line);
    if(message?.jsonrpc!=='2.0')throw Error('Copilot ACP JSON-RPC 版本錯誤');
    if(typeof message.method==='string'){
     if(message.id!==undefined){
      const sessionId=typeof message.params?.sessionId==='string'?message.params.sessionId:undefined;
      // ACP permissions are never approved here. A declared MCP proposal may
      // be handed to Codex, which remains the only real tool executor.
      listeners.request(sessionId,message.method,message.params);
      if(message.method==='session/request_permission')send({jsonrpc:'2.0',id:message.id,result:{outcome:{outcome:'cancelled'}}});
      else send({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Client filesystem, terminal and execution are unavailable'}});
     }else if(message.method==='session/update'){
      if(typeof message.params?.sessionId!=='string'||typeof message.params.update?.sessionUpdate!=='string')throw Error('Copilot ACP 工作階段更新格式錯誤');
      listeners.event(message.params.sessionId,message.params.update);
     }
     continue;
    }
    if(!Number.isSafeInteger(message.id)||message.id<1||message.id>next)throw Error('Copilot ACP 回應識別錯誤');
    const entry=pending.get(message.id);
    // A late response to an expired request must not poison another room.
    if(!entry)continue;
    if(message.error){
     const detail=typeof message.error.message==='string'?message.error.message:'RPC 失敗';
     entry.reject(Error(/authentication required|not authenticated|not logged in/i.test(detail)?'GitHub Copilot 尚未登入，請先執行 copilot login':`Copilot ACP：${detail}`));
    }else if(Object.hasOwn(message,'result'))entry.resolve(message.result);
    else throw Error('Copilot ACP 缺少回應內容');
   }
  }catch(error){fail(asError(error));}
 });
 return {
  get usable(){return !failure;},
  fail,
  notify(method:string,params:object={}){send({jsonrpc:'2.0',method,params});},
  rpc(method:string,params:object={},signal?:AbortSignal,timeoutMs=10000):Promise<any>{
   if(failure)return Promise.reject(failure);
   if(signal?.aborted)return Promise.reject(copilotCancelled());
   return new Promise((resolve,reject)=>{
    const id=++next;
    const finish=(error?:Error,value?:any)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);pending.delete(id);if(error)reject(error);else resolve(value);};
    const abort=()=>finish(copilotCancelled());
    const timer=setTimeout(()=>finish(Error(`Copilot ACP ${method} 已取消或逾時`)),timeoutMs);
    pending.set(id,{resolve:value=>finish(undefined,value),reject:error=>finish(error)});
    signal?.addEventListener('abort',abort,{once:true});
    try{send({jsonrpc:'2.0',id,method,params});}catch(error){finish(asError(error));}
   });
  },
  close(){return closing??=(async()=>{fail(Error('Copilot runtime 已關閉'));await child.finished;})();},
 };
}
