import type {ChatSettings} from '../../ports/chat.ts';
import {chatLimits} from '../../domain/chat.ts';
import {spawnChatProcess} from './chat-process.ts';

type Pending={resolve:(value:any)=>void;reject:(error:Error)=>void};
type Listeners={event:(sessionId:string,event:any)=>void;request:(sessionId:string|undefined)=>void;failure:(error:Error)=>void};
export const copilotCancelled=()=>Error('Copilot 請求已取消或逾時');
export const asError=(error:unknown)=>error instanceof Error?error:Error(String(error));

// Content-Length framed JSON-RPC, as used by the official Copilot SDK (v3).
// Verified with the pinned @github/copilot 1.0.105 native headless server.
export function createCopilotConnection(settings:ChatSettings,cwd:string,listeners:Listeners){
 const controller=new AbortController();
 const child=spawnChatProcess(settings.copilotExecutable,[...settings.copilotArgs,'--headless','--stdio','--no-auto-update','--disable-builtin-mcps','--no-custom-instructions','--no-ask-user'],{cwd,signal:controller.signal});
 child.stderr.resume();
 const pending=new Map<number,Pending>();let buffer:Buffer=Buffer.alloc(0),next=0,failure:Error|undefined,closing:Promise<void>|undefined;
 const fail=(error:Error)=>{
  if(failure)return;failure=error;
  for(const entry of pending.values())entry.reject(error);pending.clear();
  listeners.failure(error);child.terminate();
 };
 const send=(message:object)=>{
  if(failure)throw failure;
  const body=JSON.stringify(message);if(Buffer.byteLength(body)>chatLimits.providerRequest)throw Error('Copilot 請求超過大小限制');
  child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
 };
 child.on('error',error=>fail(Error(`無法執行 Copilot：${error.message}`)));
 child.stdin.on('error',error=>fail(error));
 // A failed loader can leave a descendant holding stdout open. Reject its
 // waiters on exit immediately, then terminate the owned process group.
 child.once('exit',code=>fail(Error(`Copilot 程序已結束（exit ${code}）`)));
 child.on('close',code=>fail(Error(`Copilot 程序已結束（exit ${code}）`)));
 void child.finished.catch(error=>fail(asError(error)));
 child.stdout.on('data',(chunk:Buffer)=>{
  if(failure)return;
  try{
   buffer=Buffer.concat([buffer,chunk]);
   while(true){
    const boundary=buffer.indexOf('\r\n\r\n');
    if(boundary<0){if(buffer.length>8192)throw Error('Copilot 協定標頭超過大小限制');return;}
    if(boundary>8192)throw Error('Copilot 協定標頭超過大小限制');
    const headers=buffer.subarray(0,boundary).toString().split('\r\n'),lengths=headers.filter(header=>/^Content-Length:/i.test(header));
    const length=Number(/^Content-Length:\s*(\d+)\s*$/i.exec(lengths[0]??'')?.[1]);
    if(lengths.length!==1||!Number.isSafeInteger(length)||length<=0||length>chatLimits.providerRequest)throw Error('Copilot 協定格式錯誤');
    if(buffer.length<boundary+4+length)return;
    const message=JSON.parse(buffer.subarray(boundary+4,boundary+4+length).toString());buffer=buffer.subarray(boundary+4+length);
    if(message?.jsonrpc!=='2.0')throw Error('Copilot JSON-RPC 版本錯誤');
    if(typeof message.method==='string'){
     if(message.id!==undefined){
      // No permission, shell, hook, or external-tool implementation is exposed.
      send({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Copilot is inference-only; client execution is unavailable'}});
      listeners.request(typeof message.params?.sessionId==='string'?message.params.sessionId:undefined);
     }else if(message.method==='session.event'){
      if(typeof message.params?.sessionId!=='string'||typeof message.params.event?.type!=='string')throw Error('Copilot 工作階段事件格式錯誤');
      listeners.event(message.params.sessionId,message.params.event);
     }
     continue;
    }
    if(!Number.isSafeInteger(message.id)||message.id<1||message.id>next)throw Error('Copilot 回應識別錯誤');
    const entry=pending.get(message.id);
    // RPC cancellation removes its waiter. Its eventual reply must not abort
    // another room that is still using this same server.
    if(!entry)continue;
    if(message.error)entry.reject(Error(typeof message.error.message==='string'?message.error.message:'Copilot RPC 失敗'));
    else if(Object.hasOwn(message,'result'))entry.resolve(message.result);
    else throw Error('Copilot RPC 缺少回應內容');
   }
  }catch(error){fail(asError(error));}
 });
 return {
  get usable(){return !failure;},
  fail,
  rpc(method:string,params:object={},signal?:AbortSignal,timeoutMs=10000):Promise<any>{
   if(failure)return Promise.reject(failure);
   if(signal?.aborted)return Promise.reject(copilotCancelled());
   return new Promise((resolve,reject)=>{
    const id=++next;
    const finish=(error?:Error,value?:any)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);pending.delete(id);if(error)reject(error);else resolve(value);};
    const abort=()=>finish(copilotCancelled());
    const timer=setTimeout(()=>finish(Error(`Copilot ${method} 已取消或逾時`)),timeoutMs);
    pending.set(id,{resolve:value=>finish(undefined,value),reject:error=>finish(error)});
    signal?.addEventListener('abort',abort,{once:true});
    try{send({jsonrpc:'2.0',id,method,params});}catch(error){finish(asError(error));}
   });
  },
  close(){return closing??=(async()=>{fail(Error('Copilot runtime 已關閉'));await child.finished;})();},
 };
}
