import type {ChatModel,ChatSettings} from '../../ports/chat.ts';
import {chatLimits} from '../../domain/chat.ts';
import {spawnChatProcess} from './chat-process.ts';

// Copilot SDK wire protocol: connect → auth.getStatus → models.list.
// https://github.com/github/copilot-sdk/blob/main/nodejs/src/client.ts
export async function listCopilotModels(settings:ChatSettings,cwd:string,signal:AbortSignal):Promise<ChatModel[]>{
 const child=spawnChatProcess(settings.copilotExecutable,[...settings.copilotArgs,'--headless','--stdio','--no-auto-update'],{cwd,signal});
 child.stderr.resume();
 let buffer:Buffer=Buffer.alloc(0),next=0;
 const pending=new Map<number,{resolve:(result:any)=>void;reject:(error:Error)=>void}>();
 let failure:Error|undefined;
 const failed=(error:Error)=>{failure??=error;for(const entry of pending.values())entry.reject(error);pending.clear();};
 const cancelled=()=>Error('Copilot 模型清單查詢已取消或逾時');
 child.on('error',error=>failed(signal.aborted?cancelled():Error(`無法取得 Copilot 模型：${error.message}`)));
 child.stdin.on('error',failed);
 child.on('close',code=>failed(Error(`Copilot 模型清單程序已結束（exit ${code}）`)));
 const send=(message:object)=>{const body=JSON.stringify(message);child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);};
 const rpc=(method:string)=>new Promise<any>((resolve,reject)=>{if(failure)return reject(failure);const id=++next;pending.set(id,{resolve,reject});send({jsonrpc:'2.0',id,method,params:{}});});
 child.stdout.on('data',(chunk:Buffer)=>{
  try{
   buffer=Buffer.concat([buffer,chunk]);
   if(buffer.length>chatLimits.providerRequest)throw Error('Copilot 模型清單超過大小限制');
   while(true){
    const boundary=buffer.indexOf('\r\n\r\n');if(boundary<0)return;
    const length=Number(/^Content-Length: (\d+)$/im.exec(buffer.subarray(0,boundary).toString())?.[1]);
    if(!Number.isSafeInteger(length)||length<=0||length>chatLimits.providerRequest)throw Error('Copilot 模型清單協定格式錯誤');
    if(buffer.length<boundary+4+length)return;
    const message=JSON.parse(buffer.subarray(boundary+4,boundary+4+length).toString());buffer=buffer.subarray(boundary+4+length);
    if(message.jsonrpc!=='2.0')throw Error('Copilot 模型清單 JSON-RPC 版本錯誤');
    if(message.method){if(message.id!==undefined)send({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Model discovery cannot execute client operations'}});continue;}
    const entry=pending.get(message.id);if(!entry)throw Error('Copilot 模型清單回應識別錯誤');pending.delete(message.id);
    if(message.error)entry.reject(Error(message.error.message));else entry.resolve(message.result);
   }
  }catch(error){failed(error instanceof Error?error:Error(String(error)));child.terminate();}
 });
 const aborted=()=>failed(cancelled());signal.addEventListener('abort',aborted,{once:true});
 try{
  const connected=await rpc('connect');if(!connected?.ok)throw Error('Copilot 模型清單連線未建立');
  const auth=await rpc('auth.getStatus');if(auth?.isAuthenticated!==true)throw Error('GitHub Copilot 尚未登入，請先執行 copilot login');
  const result=await rpc('models.list');
  if(!Array.isArray(result?.models)||!result.models.every((m:any)=>typeof m?.id==='string'&&m.id.trim()&&m.id.length<=160&&typeof m.name==='string'&&m.name.trim()))throw Error('Copilot 回傳的模型清單格式無效');
  if(new Set(result.models.map((m:any)=>m.id)).size!==result.models.length)throw Error('Copilot 模型識別重複');
  return result.models.map((m:any)=>({id:m.id,name:m.name,selectable:m.policy?.state!=='disabled'}));
 }finally{signal.removeEventListener('abort',aborted);child.terminate();await child.finished;}
}
