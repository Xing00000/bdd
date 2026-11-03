import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';

export interface CopilotPeerOptions {
 authenticated?:boolean;
 models?:unknown;
 responseText?:string;
 delayMs?:number;
 hangMethods?:string[];
 methodDelayMs?:Record<string,number>;
 protocolVersion?:number;
}

/** Deterministic subprocess protocol fixture, not evidence of model inference. */
export async function copilotChatPeer(directory:string,options:CopilotPeerOptions={}){
 const suffix=randomUUID(),file=path.join(directory,`copilot-chat-peer-${suffix}.mjs`),tracePath=path.join(directory,`copilot-chat-trace-${suffix}.jsonl`);
 await writeFile(file,`
import {appendFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
const options=${JSON.stringify(options)},tracePath=${JSON.stringify(tracePath)};
const trace=value=>appendFileSync(tracePath,JSON.stringify({pid:process.pid,...value})+'\\n');
trace({type:'spawn',args:process.argv.slice(2)});
const sessions=new Map(),timers=new Map();let buffer=Buffer.alloc(0);
const send=message=>{const body=JSON.stringify(message);process.stdout.write('Content-Length: '+Buffer.byteLength(body)+'\\r\\n\\r\\n'+body);};
const event=(sessionId,type,data={})=>send({jsonrpc:'2.0',method:'session.event',params:{sessionId,event:{type,data}}});
const stop=sessionId=>{for(const timer of timers.get(sessionId)??[])clearTimeout(timer);timers.delete(sessionId);};
const later=(sessionId,fn,delay)=>{const timer=setTimeout(fn,delay);timers.set(sessionId,[...(timers.get(sessionId)??[]),timer]);};
function respond(q,result){const reply=()=>send({jsonrpc:'2.0',id:q.id,result});if(options.methodDelayMs?.[q.method])setTimeout(reply,options.methodDelayMs[q.method]);else reply();}
function request(q){
 trace({type:q.method?'request':'client-response',method:q.method,params:q.params,result:q.result,error:q.error});
 if(!q.method)return;
 if(options.hangMethods?.includes(q.method))return;
 const p=q.params??{};
 if(q.method==='connect')return respond(q,{ok:true,protocolVersion:options.protocolVersion??3,version:'protocol-fixture'});
 if(q.method==='auth.getStatus')return respond(q,{isAuthenticated:options.authenticated!==false});
 if(q.method==='models.list')return respond(q,{models:options.models??[{id:'fixture-model',name:'Protocol fixture model'}]});
 if(q.method==='session.create'){sessions.set(p.sessionId,p);event(p.sessionId,'session.start');return respond(q,{sessionId:p.sessionId});}
 if(q.method==='session.options.update')return respond(q,{success:true});
 if(['session.abort','session.destroy','session.delete'].includes(q.method)){stop(p.sessionId);if(q.method!=='session.abort')sessions.delete(p.sessionId);return respond(q,{success:true});}
 if(q.method==='session.send'){
  const session=sessions.get(p.sessionId);if(!session)return send({jsonrpc:'2.0',id:q.id,error:{code:-32000,message:'Session missing'}});
  respond(q,{messageId:'user-'+p.sessionId});
  if(p.prompt.includes('[[orphan-exit]]')){const descendant=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore',process.stdout,process.stderr]});trace({type:'descendant',childPid:descendant.pid});return process.exit(92);}
  if(p.prompt.includes('[[crash]]'))return process.exit(91);
  if(p.prompt.includes('[[invalid-rpc]]'))return process.stdout.write('Content-Length: 1\\r\\n\\r\\n{');
  if(p.prompt.includes('[[hang]]'))return;
  const run=()=>{
   const messageId='assistant-'+p.sessionId;
   if(p.prompt.includes('[[builtin]]'))return event(p.sessionId,'tool.execution_start',{toolName:'shell',toolCallId:'forbidden'});
   if(p.prompt.includes('[[permission]]'))return event(p.sessionId,'permission.requested',{requestId:'permission-one',permissionRequest:{kind:'shell',command:'false'}});
   if(p.prompt.includes('[[rpc-permission]]'))return send({jsonrpc:'2.0',id:'request-permission',method:'permission.request',params:{sessionId:p.sessionId,permissionRequest:{kind:'shell'}}});
   if(p.prompt.includes('[[tool]]')||p.prompt.includes('[[bad-tool]]')||p.prompt.includes('[[tool-executed]]')||p.prompt.includes('[[invalid-tool-type]]')){
    const name=p.prompt.includes('[[bad-tool]]')?'shell':session.tools?.[0]?.name;
    const call={toolCallId:'call-'+p.sessionId,name,arguments:{},type:p.prompt.includes('[[invalid-tool-type]]')?'custom':'function'};
    event(p.sessionId,'assistant.message',{messageId,content:'',toolRequests:[call]});
    event(p.sessionId,'tool.execution_start',{toolCallId:call.toolCallId,toolName:name,arguments:{}});
    event(p.sessionId,'external_tool.requested',{sessionId:p.sessionId,requestId:'request-'+p.sessionId,toolCallId:call.toolCallId,toolName:name,arguments:{}});
    if(p.prompt.includes('[[tool-executed]]'))event(p.sessionId,'tool.execution_complete',{toolCallId:call.toolCallId,success:true});return;
   }
   if(p.prompt.includes('[[error]]'))return event(p.sessionId,'session.error',{message:'Protocol fixture failure'});
   if(p.prompt.includes('[[empty]]'))return event(p.sessionId,'session.idle');
   const text=p.prompt.includes('[[echo]]')?p.prompt:options.responseText??'Protocol peer text response',split=Math.ceil(text.length/2);
   event(p.sessionId,'assistant.message_delta',{messageId,deltaContent:text.slice(0,split)});
   event(p.sessionId,'assistant.message_delta',{messageId,deltaContent:text.slice(split)});
   event(p.sessionId,'assistant.message',{messageId,content:p.prompt.includes('[[mismatch]]')?'Mismatched completion':text,toolRequests:[]});
   event(p.sessionId,'session.idle');
  };
  later(p.sessionId,run,options.delayMs??5);return;
 }
 send({jsonrpc:'2.0',id:q.id,error:{code:-32601,message:'Unsupported fixture method '+q.method}});
}
process.stdin.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);while(true){const at=buffer.indexOf('\\r\\n\\r\\n');if(at<0)return;const length=Number(/Content-Length:\\s*(\\d+)/i.exec(buffer.subarray(0,at).toString())?.[1]);if(!length||buffer.length<at+4+length)return;const q=JSON.parse(buffer.subarray(at+4,at+4+length));buffer=buffer.subarray(at+4+length);request(q);}});
`);
 return {copilotExecutable:process.execPath,copilotArgs:[file],tracePath};
}
