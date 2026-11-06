import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';

export interface CopilotPeerOptions {
 authenticated?:boolean;
 models?:unknown;
 modelConfigOptions?:unknown;
 legacyModels?:boolean;
 capabilities?:Record<string,unknown>;
 responseText?:string;
 delayMs?:number;
 hangMethods?:string[];
 methodDelayMs?:Record<string,number>;
 protocolVersion?:number;
 latePermissionMs?:number;
 reuseSessionId?:boolean;
 toolArguments?:Record<string,unknown>;
 toolIndex?:number;
}

/** ACP subprocess fixture. It exercises the real local proposal MCP bridge, never a model. */
export async function copilotChatPeer(directory:string,options:CopilotPeerOptions={}){
 const suffix=randomUUID(),file=path.join(directory,`copilot-chat-peer-${suffix}.mjs`),tracePath=path.join(directory,`copilot-chat-trace-${suffix}.jsonl`);
 await writeFile(file,`
import {appendFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
const options=${JSON.stringify(options)},tracePath=${JSON.stringify(tracePath)};
const trace=value=>appendFileSync(tracePath,JSON.stringify({pid:process.pid,...value})+'\\n');
trace({type:'spawn',args:process.argv.slice(2)});
const sessions=new Map(),timers=new Map(),prompts=new Map();let buffer='',sharedSessionId;
const send=message=>process.stdout.write(JSON.stringify(message)+'\\n');
const event=(sessionId,update)=>send({jsonrpc:'2.0',method:'session/update',params:{sessionId,update}});
const stop=sessionId=>{for(const timer of timers.get(sessionId)??[])clearTimeout(timer);timers.delete(sessionId);};
const later=(sessionId,fn,delay)=>{const timer=setTimeout(()=>Promise.resolve(fn()).catch(error=>{const q=prompts.get(sessionId);if(q)fail(q,error.message);}),delay);timers.set(sessionId,[...(timers.get(sessionId)??[]),timer]);};
const fail=(q,message)=>send({jsonrpc:'2.0',id:q.id,error:{code:-32000,message}});
function respond(q,result){const reply=()=>send({jsonrpc:'2.0',id:q.id,result});if(options.methodDelayMs?.[q.method])setTimeout(reply,options.methodDelayMs[q.method]);else reply();}
function modelState(model){
 const models=options.models??[{id:'fixture-model',name:'Protocol fixture model'}];
 if(options.legacyModels)return {models:{currentModelId:model??models[0]?.id,availableModels:Array.isArray(models)?models.map(item=>({modelId:item.id,name:item.name})):models}};
 return {configOptions:options.modelConfigOptions??[{id:'model',category:'model',type:'select',name:'Model',currentValue:model??models[0]?.id,options:Array.isArray(models)?models.map(item=>({value:item.id,name:item.name})):models}]};
}
async function mcp(server,method,params={}){
 const response=await fetch(server.url,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',...Object.fromEntries(server.headers.map(header=>[header.name,header.value]))},body:JSON.stringify({jsonrpc:'2.0',id:randomUUID(),method,params})});
 const result=await response.json();trace({type:'mcp',method,status:response.status,result:result.result,error:result.error});if(result.error)throw Error(result.error.message);return result.result;
}
async function request(q){
 trace({type:q.method?'request':'client-response',id:q.id,method:q.method,params:q.params,result:q.result,error:q.error});
 if(!q.method)return;
 if(options.hangMethods?.includes(q.method))return;
 const p=q.params??{};
 if(q.method==='initialize')return respond(q,{protocolVersion:options.protocolVersion??1,agentCapabilities:options.capabilities??{mcpCapabilities:{http:true},sessionCapabilities:{close:{}}},agentInfo:{name:'protocol-fixture',version:'1'}});
 if(q.method==='session/new'){
  if(options.authenticated===false)return fail(q,'Authentication required');
  const sessionId=options.reuseSessionId?(sharedSessionId??='fixture-'+randomUUID()):'fixture-'+randomUUID(),session={...p,model:undefined,tools:[],mcp:p.mcpServers?.[0]};
  if(session.mcp){await mcp(session.mcp,'initialize',{protocolVersion:'2025-06-18',clientInfo:{name:'fixture',version:'1'},capabilities:{}});session.tools=(await mcp(session.mcp,'tools/list')).tools;}
  sessions.set(sessionId,session);trace({type:'session-created',sessionId});event(sessionId,{sessionUpdate:'available_commands_update',availableCommands:[]});
  return respond(q,{sessionId,...modelState()});
 }
 if(q.method==='session/set_config_option'||q.method==='session/set_model'){
  const session=sessions.get(p.sessionId);if(!session)return fail(q,'Session missing');session.model=p.value??p.modelId;
  return respond(q,q.method==='session/set_config_option'?modelState(session.model):{});
 }
 if(q.method==='session/cancel'){
  stop(p.sessionId);const prompt=prompts.get(p.sessionId);if(prompt){prompts.delete(p.sessionId);respond(prompt,{stopReason:'cancelled'});}return;
 }
 if(q.method==='session/close'||q.method==='session/delete'){stop(p.sessionId);sessions.delete(p.sessionId);if(options.latePermissionMs)setTimeout(()=>send({jsonrpc:'2.0',id:'late-'+p.sessionId,method:'session/request_permission',params:{sessionId:p.sessionId,toolCall:{toolCallId:'retired-call',title:'bash',rawInput:{}},options:[]}}),options.latePermissionMs);return respond(q,{});}
 if(q.method==='session/prompt'){
  const session=sessions.get(p.sessionId);if(!session)return fail(q,'Session missing');
  prompts.set(p.sessionId,q);const prompt=p.prompt.map(part=>part.text).join('');
  if(prompt.includes('[[orphan-exit]]')){const descendant=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore',process.stdout,process.stderr]});trace({type:'descendant',childPid:descendant.pid});return process.exit(92);}
  if(prompt.includes('[[crash]]'))return process.exit(91);
  if(prompt.includes('[[invalid-rpc]]'))return process.stdout.write('{invalid-json\\n');
  if(prompt.includes('[[oversized-rpc]]'))return process.stdout.write(' '.repeat(2*1024*1024+1));
  if(prompt.includes('[[hang]]'))return;
  const finish=result=>{prompts.delete(p.sessionId);respond(q,result);};
  const run=async()=>{
   const toolCallId='call-'+p.sessionId;
   if(prompt.includes('[[builtin]]'))return event(p.sessionId,{sessionUpdate:'tool_call',toolCallId,title:'bash',kind:'execute',status:'in_progress',rawInput:{command:'false'}});
   if(prompt.includes('[[permission]]')||prompt.includes('[[rpc-permission]]')||prompt.includes('[[fs-request]]')||prompt.includes('[[terminal-request]]'))return send({jsonrpc:'2.0',id:'permission-'+p.sessionId,method:prompt.includes('[[fs-request]]')?'fs/read_text_file':prompt.includes('[[terminal-request]]')?'terminal/create':'session/request_permission',params:{sessionId:p.sessionId,toolCall:{toolCallId,title:'bash',rawInput:{command:'false'}},options:[{optionId:'allow',kind:'allow_once',name:'Allow'}]}});
   if(['tool','tool-http','bad-tool','tool-executed','invalid-tool-type','mismatch'].some(marker=>prompt.includes('[['+marker+']]'))){
    const name=prompt.includes('[[bad-tool]]')?'shell':session.tools[options.toolIndex??0]?.name;
    const args=prompt.includes('[[invalid-tool-type]]')?[]:options.toolArguments??{};
    event(p.sessionId,{sessionUpdate:'tool_call',toolCallId,title:session.mcp.name+'-'+name,kind:'other',status:'in_progress',rawInput:args});
    if(prompt.includes('[[mismatch]]'))return event(p.sessionId,{sessionUpdate:'tool_call_update',toolCallId,rawInput:{changed:true}});
    if(prompt.includes('[[tool-executed]]'))return event(p.sessionId,{sessionUpdate:'tool_call_update',toolCallId,status:'completed'});
    if(prompt.includes('[[tool-http]]')){void mcp(session.mcp,'tools/call',{name,arguments:args}).catch(()=>{});return;}
    send({jsonrpc:'2.0',id:'permission-'+p.sessionId,method:'session/request_permission',params:{sessionId:p.sessionId,toolCall:{toolCallId,title:name,rawInput:args},options:[{optionId:'allow',kind:'allow_once',name:'Allow'},{optionId:'reject',kind:'reject_once',name:'Reject'}]}});return;
   }
   if(prompt.includes('[[error]]')){prompts.delete(p.sessionId);return fail(q,'Protocol fixture failure');}
   if(prompt.includes('[[empty]]'))return finish({stopReason:'end_turn'});
   if(prompt.includes('[[non-text]]')){event(p.sessionId,{sessionUpdate:'agent_message_chunk',content:{type:'image',data:'',mimeType:'image/png'}});return finish({stopReason:'end_turn'});}
   const text=prompt.includes('[[echo]]')?prompt:options.responseText??'Protocol peer text response',split=Math.ceil(text.length/2);
   event(p.sessionId,{sessionUpdate:'agent_message_chunk',content:{type:'text',text:text.slice(0,split)}});
   event(p.sessionId,{sessionUpdate:'agent_message_chunk',content:{type:'text',text:text.slice(split)}});
   finish({stopReason:prompt.includes('[[truncated]]')?'max_tokens':'end_turn'});
  };
  later(p.sessionId,run,options.delayMs??5);return;
 }
 send({jsonrpc:'2.0',id:q.id,error:{code:-32601,message:'Unsupported fixture method '+q.method}});
}
process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{buffer+=chunk;while(true){const at=buffer.indexOf('\\n');if(at<0)return;const line=buffer.slice(0,at);buffer=buffer.slice(at+1);if(line.trim())void request(JSON.parse(line)).catch(error=>{process.stderr.write(error.message);process.exitCode=1;});}});
`);
 return {copilotExecutable:process.execPath,copilotArgs:[file],tracePath};
}
