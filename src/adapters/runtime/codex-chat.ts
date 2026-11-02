import {createInterface} from 'node:readline';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import type {ChatRuntime,ChatSettings} from '../../ports/chat.ts';
import {createChatProvider} from './chat-provider.ts';
import {spawnChatProcess} from './chat-process.ts';

export async function createCodexChatRuntime(directory:string):Promise<ChatRuntime>{
 const home=path.join(directory,'codex'),cwd=path.join(directory,'workspace');
 await mkdir(home,{recursive:true,mode:0o700});await mkdir(cwd,{recursive:true,mode:0o700});
 const provider=await createChatProvider(cwd),active=new Set<AbortController>();
 async function execute(input:{settings:ChatSettings;threadId:string|null;onThread?:(id:string)=>Promise<void>;text?:string;compact?:boolean}):Promise<string>{
  const controller=new AbortController();active.add(controller);
  const registration=provider.register(input.settings,controller.signal);
  const config={model_provider:'chat_copilot','model_providers.chat_copilot':{name:'GitHub Copilot CLI',base_url:provider.url,wire_api:'responses',requires_openai_auth:false,env_key:'WB_CHAT_PROVIDER_TOKEN',supports_websockets:false,request_max_retries:0,stream_max_retries:0}};
  const args=['app-server','--listen','stdio://',...Object.entries(config).flatMap(([key,value])=>['-c',`${key}=${typeof value==='object'?'{'+Object.entries(value).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join(',')+'}':JSON.stringify(value)}`])];
  const child=spawnChatProcess(input.settings.codexExecutable,args,{cwd,env:{...process.env,CODEX_HOME:home,WB_CHAT_PROVIDER_TOKEN:registration.token},signal:controller.signal});
  child.stderr.resume();
  let next=0,answer='',fatal:Error|undefined,turnResolve:((text:string)=>void)|undefined,turnReject:((error:Error)=>void)|undefined;
  const pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();
  function failed(error:Error){fatal=error;for(const entry of pending.values())entry.reject(error);pending.clear();turnReject?.(error);}
  child.on('error',error=>failed(Error(`無法執行 Codex：${error.message}`)));
  child.stdin.on('error',failed);
  child.on('close',code=>failed(Error(`Codex 已結束（exit ${code}）`)));
  const lines=createInterface({input:child.stdout});
  lines.on('line',line=>{
   try{
    const message=JSON.parse(line);
    if(message.id!==undefined&&pending.has(message.id)){const entry=pending.get(message.id)!;pending.delete(message.id);if(message.error)entry.reject(Error(message.error.message));else entry.resolve(message.result);}
    else if(message.id!==undefined){failed(Error('文字聊天不支援工具或操作批准請求'));controller.abort();}
    if(message.method==='item/completed'&&message.params?.item?.type==='agentMessage')answer+=message.params.item.text??'';
    if(message.method==='turn/completed'){
     const turn=message.params.turn;if(turn.status!=='completed')turnReject?.(Error(turn.error?.message??`Codex 回覆狀態：${turn.status}`));else turnResolve?.(answer);
    }
   }catch(error){failed(error instanceof Error?error:Error(String(error)));controller.abort();}
  });
  function rpc(method:string,params:object):Promise<any>{
   if(fatal)return Promise.reject(fatal);
   return new Promise((resolve,reject)=>{const id=next++;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
  }
  const timeout=setTimeout(()=>{failed(Error(`聊天超過設定的 ${input.settings.timeoutMs} 毫秒`));controller.abort();},input.settings.timeoutMs);
  try{
   await rpc('initialize',{clientInfo:{name:'bdd_workbench_chat',version:'0.1.0'}});
   child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
   const params={cwd,model:input.settings.model,approvalPolicy:'never',sandbox:'read-only',baseInstructions:'You are a helpful text conversation assistant. Do not call tools. Reply in the language the user uses.'};
   const result=input.threadId?await rpc('thread/resume',{...params,threadId:input.threadId}):await rpc('thread/start',params);
   const threadId=result.thread.id;await input.onThread?.(threadId);
   const completion=new Promise<string>((resolve,reject)=>{turnResolve=resolve;turnReject=reject;});
   // Install the completion handler before starting, including fast failures.
   const started=rpc(input.compact?'thread/compact/start':'turn/start',input.compact?{threadId}:{threadId,input:[{type:'text',text:input.text}]});
   const [,text]=await Promise.all([started,completion]);return text;
  }finally{
   clearTimeout(timeout);registration.close();controller.abort();lines.close();
   try{await child.finished;}finally{active.delete(controller);}
  }
 }
 return {reply:input=>execute(input),async compact(input){await execute({...input,compact:true});},async close(){for(const controller of active)controller.abort();await provider.close();}};
}
