import {createInterface} from 'node:readline';
import {spawnChatProcess} from './chat-process.ts';

function deferred<T>(){
 let resolve!:(value:T)=>void,reject!:(error:Error)=>void;
 const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});
 // A notification may arrive before the corresponding RPC acknowledgement.
 void promise.catch(()=>{});
 return {promise,resolve,reject};
}
export function withChatSignal<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
 if(signal.aborted){void promise.catch(()=>{});return Promise.reject(signal.reason);}
 return new Promise<T>((resolve,reject)=>{
  const abort=()=>{signal.removeEventListener('abort',abort);reject(signal.reason);};signal.addEventListener('abort',abort,{once:true});
  void promise.then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
 });
}
async function bounded<T>(promise:Promise<T>,timeoutMs:number):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Codex 中斷確認逾時')),timeoutMs);})]);}
 finally{clearTimeout(timer);}
}
type Turn={
 id?:string;answer:string;terminal:boolean;acknowledged:boolean;compact:boolean;early:any[];
 complete:ReturnType<typeof deferred<string>>;ended:ReturnType<typeof deferred<void>>;
 acknowledgedSignal:ReturnType<typeof deferred<void>>;onDelta?:(delta:string)=>void;
};

/** One app-server owns one room. Protocol fields match Codex CLI 0.166.0's
 * `app-server generate-ts`: turn/interrupt requires both threadId and turnId;
 * compact/start returns {}, so its turn id comes from turn/started. */
export class CodexChatWorker {
 private readonly lifetime=new AbortController();
 private readonly child:ReturnType<typeof spawnChatProcess>;
 private readonly lines:ReturnType<typeof createInterface>;
 private readonly pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();
 private readonly retiredTurns=new Set<string>();
 private next=0;
 private failure?:Error;
 private disposal?:Promise<void>;
 private turn?:Turn;
 threadId?:string;

 constructor(options:{executable:string;args:string[];cwd:string;env:NodeJS.ProcessEnv}){
  this.child=spawnChatProcess(options.executable,options.args,{cwd:options.cwd,env:options.env,signal:this.lifetime.signal});
  this.child.stderr.resume();
  void this.child.finished.catch(()=>{});
  this.child.on('error',error=>this.fail(Error(`無法執行 Codex：${error.message}`)));
  this.child.stdin.on('error',error=>this.fail(error));
  this.child.on('close',code=>this.fail(Error(`Codex 已結束（exit ${code}）`)));
  this.lines=createInterface({input:this.child.stdout});
  this.lines.on('line',line=>{try{this.receive(JSON.parse(line));}catch(error){this.fail(error instanceof Error?error:Error(String(error)));}});
 }
 get alive(){return !this.failure&&!this.disposal&&this.child.exitCode===null&&this.child.signalCode===null;}
 private fail(error:Error){
  if(this.failure)return;
  this.failure=error;
  for(const entry of this.pending.values())entry.reject(error);this.pending.clear();
  this.turn?.complete.reject(error);this.turn?.ended.reject(error);this.turn?.acknowledgedSignal.reject(error);
  this.lifetime.abort();
 }
 private rpc(method:string,params:object):Promise<any>{
  if(this.failure)return Promise.reject(this.failure);
  return new Promise((resolve,reject)=>{
   const id=this.next++;this.pending.set(id,{resolve,reject});
   this.child.stdin.write(JSON.stringify({id,method,params})+'\n');
  });
 }
 private identify(turn:Turn,id:unknown){
  if(typeof id!=='string'||!id)throw Error('Codex 回合識別格式錯誤');
  if(turn.id&&turn.id!==id)throw Error('Codex 回合識別不一致');
  if(this.retiredTurns.has(id))throw Error('Codex 重用了已完成的回合識別');
  turn.id=id;
 }
 private receive(message:any){
  if(!message||typeof message!=='object')throw Error('Codex 訊息格式錯誤');
  if(message.id!==undefined){
   // Server requests must never be mistaken for a response with the same id.
   if(message.method!==undefined)throw Error('聊天不支援此操作批准或外部工具請求');
   const entry=this.pending.get(message.id);if(!entry)throw Error('Codex 回應識別不存在');
   this.pending.delete(message.id);
   if(message.error)entry.reject(Error(message.error.message??'Codex 請求失敗'));else entry.resolve(message.result);
   return;
  }
  const turn=this.turn,params=message.params;
  if(!turn||turn.terminal||params?.threadId!==this.threadId)return;
  if(message.method==='turn/started'){
   const id=params.turn?.id;if(this.retiredTurns.has(id))return;
   this.identify(turn,id);return;
  }
  if(!['item/agentMessage/delta','item/completed','turn/completed'].includes(message.method))return;
  const id=message.method==='turn/completed'?params.turn?.id:params.turnId;
  if(this.retiredTurns.has(id))return;
  if(!turn.acknowledged){
   if(turn.early.length>=1024)throw Error('Codex 回合確認前的事件過多');
   turn.early.push(message);return;
  }
  if(!turn.id||id!==turn.id)return;
  if(message.method==='item/agentMessage/delta'){
   if(typeof params.delta!=='string')throw Error('Codex 增量格式錯誤');
   if(!turn.compact)turn.onDelta?.(params.delta);
  }else if(message.method==='item/completed'&&params.item?.type==='agentMessage'){
   if(typeof params.item.text!=='string')throw Error('Codex 回覆格式錯誤');
   if(!turn.compact)turn.answer+=params.item.text;
  }else if(message.method==='turn/completed'){
   if(!['completed','interrupted','failed'].includes(params.turn?.status))throw Error('Codex 完成狀態格式錯誤');
   turn.terminal=true;turn.ended.resolve();
   if(params.turn.status==='completed')turn.complete.resolve(turn.answer);
   else turn.complete.reject(Error(params.turn.error?.message??`Codex 回覆狀態：${params.turn.status}`));
  }
 }
 async initialize(threadId:string|null,params:object){
  await this.rpc('initialize',{clientInfo:{name:'bdd_workbench_chat',version:'0.1.0'}});
  this.child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
  const result=await this.rpc(threadId?'thread/resume':'thread/start',threadId?{...params,threadId}:params);
  const received=result?.thread?.id;
  if(typeof received!=='string'||!received||(threadId&&received!==threadId))throw Error('Codex 對話識別不一致');
  this.threadId=received;
 }
 async execute(input:{text?:string;compact?:boolean;onDelta?:(delta:string)=>void}):Promise<string>{
  if(this.failure)throw this.failure;
  if(!this.threadId||this.turn)throw Error('Codex 工作程序尚未就緒或正在回覆');
  const turn:Turn={answer:'',terminal:false,acknowledged:false,compact:Boolean(input.compact),early:[],complete:deferred<string>(),ended:deferred<void>(),acknowledgedSignal:deferred<void>(),onDelta:input.onDelta};
  this.turn=turn;
  try{
   const result=await this.rpc(input.compact?'thread/compact/start':'turn/start',input.compact?{threadId:this.threadId}:{threadId:this.threadId,input:[{type:'text',text:input.text}]});
   if(!input.compact)this.identify(turn,result?.turn?.id);
   turn.acknowledged=true;turn.acknowledgedSignal.resolve();
   for(const message of turn.early)this.receive(message);turn.early=[];
   return await turn.complete.promise;
  }catch(error){turn.acknowledgedSignal.reject(error instanceof Error?error:Error(String(error)));throw error;}
 }
 async interrupt(timeoutMs:number):Promise<boolean>{
  const turn=this.turn;
  if(!this.alive||!turn)return false;
  turn.onDelta=undefined;
  // No id means initialize/start never completed. Do not guess an interrupt id.
  if(!turn.id)return false;
  if(turn.terminal&&turn.acknowledged)return true;
  try{
   await bounded(Promise.all([this.rpc('turn/interrupt',{threadId:this.threadId,turnId:turn.id}),turn.ended.promise,turn.acknowledgedSignal.promise]),timeoutMs);
   return this.alive&&turn.terminal;
  }catch{return false;}
 }
 releaseTurn(){
  const turn=this.turn;
  if(turn?.id){this.retiredTurns.add(turn.id);if(this.retiredTurns.size>64)this.retiredTurns.delete(this.retiredTurns.values().next().value!);}
  this.turn=undefined;
 }
 dispose():Promise<void>{
  return this.disposal??=(async()=>{
   this.fail(Error('Codex 工作程序已關閉'));this.lines.close();
   await this.child.finished;
  })();
 }
}
