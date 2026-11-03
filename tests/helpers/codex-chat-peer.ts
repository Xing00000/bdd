import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';

/** A real child-process protocol peer, not a model or inference benchmark. */
export async function codexChatPeer(directory:string,options:{hangInitialize?:boolean;compactWithoutTurn?:boolean}={}){
 const executable=path.join(directory,'codex-chat-peer.mjs'),log=path.join(directory,'codex-peer.jsonl'),release=path.join(directory,'release-peer');
 const interpreter=path.isAbsolute(process.execPath)?process.execPath:'/usr/bin/env node';
 await writeFile(executable,`#!${interpreter}\n`+String.raw`
import {createInterface} from 'node:readline';
import {appendFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const config=`+JSON.stringify({log,release,...options})+String.raw`;
const record=(event,extra={})=>appendFileSync(config.log,JSON.stringify({event,pid:process.pid,...extra})+'\n');
const send=message=>process.stdout.write(JSON.stringify(message)+'\n');
const reply=(id,result)=>send({id,result});
const notify=(method,params)=>send({method,params});
const tokenHash=createHash('sha256').update(process.env.WB_CHAT_PROVIDER_TOKEN??'').digest('hex');
record('spawn',{tokenHash});
process.on('SIGTERM',()=>{record('terminated');process.exit(0);});
process.stdin.on('end',()=>process.exit(0));
let threadId,sequence=0,current,previous;
const turn=(id,status)=>({id,status,items:[],error:null});
function complete(value,status='completed'){
 if(current!==value)return;
 if(status==='completed'&&!value.compact){
  notify('item/agentMessage/delta',{threadId,turnId:value.id,itemId:'message-'+value.id,delta:'reply: '+value.text});
  notify('item/completed',{threadId,turnId:value.id,item:{id:'message-'+value.id,type:'agentMessage',text:'Peer reply: '+value.text},completedAtMs:Date.now()});
 }
 notify('turn/completed',{threadId,turn:turn(value.id,status)});record('completed',{threadId,turnId:value.id,status});previous=value;current=undefined;
}
createInterface({input:process.stdin}).on('line',line=>{
 const message=JSON.parse(line),p=message.params??{};
 if(message.id===undefined){record(message.method);return;}
 record(message.method,{threadId:p.threadId,turnId:p.turnId,model:p.model,text:p.input?.[0]?.text});
 if(message.method==='initialize'){if(!config.hangInitialize)reply(message.id,{});return;}
 if(message.method==='thread/start'||message.method==='thread/resume'){
  threadId=p.threadId??'peer-thread-'+process.pid;reply(message.id,{thread:{id:threadId}});return;
 }
 if(message.method==='turn/interrupt'){
  if(!current||current.id!==p.turnId||p.threadId!==threadId){send({id:message.id,error:{message:'Wrong interrupt target'}});return;}
  if(current.text.includes('[ignore-interrupt]'))return;
  reply(message.id,{});if(!current.text.includes('[ack-only]'))complete(current,'interrupted');return;
 }
 if(message.method!=='turn/start'&&message.method!=='thread/compact/start'){send({id:message.id,error:{message:'Unsupported peer method'}});return;}
 const compact=message.method==='thread/compact/start';
 if(compact&&config.compactWithoutTurn){reply(message.id,{});return;}
 const value={id:'peer-turn-'+process.pid+'-'+(++sequence),text:p.input?.[0]?.text??'',compact};current=value;
 if(previous){
  notify('turn/started',{threadId,turn:turn(previous.id,'inProgress')});
  notify('item/agentMessage/delta',{threadId,turnId:previous.id,itemId:'stale',delta:'STALE'});
  notify('item/completed',{threadId,turnId:previous.id,item:{type:'agentMessage',text:'STALE'}});
  notify('turn/completed',{threadId,turn:turn(previous.id,'completed')});
 }
 notify('turn/started',{threadId,turn:turn(value.id,'inProgress')});
 notify('item/agentMessage/delta',{threadId:'unrelated-thread',turnId:value.id,itemId:'wrong-thread',delta:'WRONG THREAD'});
 notify('item/agentMessage/delta',{threadId,turnId:'unrelated-turn',itemId:'wrong-turn',delta:'WRONG TURN'});
 notify('turn/completed',{threadId:'unrelated-thread',turn:turn(value.id,'completed')});
 if(value.text.includes('[crash]')){record('crash');process.exit(17);}
 if(value.text.includes('[server-request]')){send({id:message.id,method:'item/commandExecution/requestApproval',params:{}});return;}
 if(value.text.includes('[malformed]')){notify('item/agentMessage/delta',{threadId,turnId:value.id,itemId:'bad',delta:123});reply(message.id,{turn:turn(value.id,'inProgress')});return;}
 if(value.text.includes('[hang]')||value.text.includes('[ignore-interrupt]')||value.text.includes('[ack-only]')){reply(message.id,{turn:turn(value.id,'inProgress')});return;}
 if(!compact)notify('item/agentMessage/delta',{threadId,turnId:value.id,itemId:'message-'+value.id,delta:'Peer '});
 if(value.text.includes('[gated-ack]')){
  record('before-ack',{threadId,turnId:value.id});
  const timer=setInterval(()=>{if(existsSync(config.release)){clearInterval(timer);complete(value);reply(message.id,{turn:turn(value.id,'inProgress')});}},10);return;
 }
 if(value.text.includes('[gated]')){
  reply(message.id,{turn:turn(value.id,'inProgress')});record('streaming',{threadId,turnId:value.id});
  const timer=setInterval(()=>{if(existsSync(config.release)){clearInterval(timer);complete(value);}},10);return;
 }
 // Exercise notifications, including completion, arriving before the RPC reply.
 complete(value);reply(message.id,compact?{}:{turn:turn(value.text.includes('[wrong-ack]')?'mismatched-turn':value.id,'inProgress')});
});
`,{mode:0o700});
 const events=async():Promise<any[]>=>{
  try{return (await readFile(log,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
 };
 async function waitFor(predicate:(events:any[])=>boolean,timeoutMs=5000){
  const deadline=Date.now()+timeoutMs;
  while(true){const entries=await events();if(predicate(entries))return entries;if(Date.now()>=deadline)throw Error('Codex protocol peer condition timed out');await new Promise(resolve=>setTimeout(resolve,10));}
 }
 return {executable,events,waitFor,release:()=>writeFile(release,'release')};
}
