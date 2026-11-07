#!/usr/bin/env node
/** Task/node/generation scoped MCP. Never accepts arbitrary command, argv,
 * environment, cwd or a different task's worker identifier from the model.
 */
import readline from 'node:readline';
import {readFile} from 'node:fs/promises';
import {SessionManager} from '../packages/workstation/session-management/core.mjs';
import {createAgentSupervisor} from '../packages/workstation/agent-supervisor.mjs';
import {negotiateProtocolVersion} from '../packages/workstation/mcp-protocol.mjs';

const cap=JSON.parse(await readFile(process.argv[2],'utf8'));
const manager=new SessionManager(cap.database,{workstationId:cap.workstationId,worktreeRoot:cap.worktreeRoot});
const supervisor=await createAgentSupervisor({
  home:cap.home,defaultCwd:cap.worktree,allowedRoots:[cap.worktree],
  defaultRepositoryId:cap.taskId,defaultOperationId:cap.nodeId
});
const fail=(code,message)=>({code,message});
const tools=[
  {name:'sm_read_context',description:'Read the exact authorized node context, dependencies, memory, worker status and unread task conversation.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {name:'sm_agent_start',description:'Reserve quota and start a real, persistent interactive ACP CLI worker; returns session and worker IDs.',inputSchema:{type:'object',properties:{profile:{type:'string'},task:{type:'string'}},required:['profile','task'],additionalProperties:false}},
  {name:'sm_agent_send',description:'Send a follow-up to this node worker; counts against turn limit.',inputSchema:{type:'object',properties:{workerId:{type:'string'},message:{type:'string'},wait:{type:'boolean'},mode:{type:'string',enum:['queue','interrupt']}},required:['workerId','message'],additionalProperties:false}},
  {name:'sm_agent_events',description:'Read this node worker events after a cursor.',inputSchema:{type:'object',properties:{workerId:{type:'string'},afterSeq:{type:'integer',minimum:0}},required:['workerId'],additionalProperties:false}},
  {name:'sm_agent_cancel',description:'Cancel one worker turn, retaining its session.',inputSchema:{type:'object',properties:{workerId:{type:'string'}},required:['workerId'],additionalProperties:false}},
  {name:'sm_agent_stop',description:'Stop this node worker and record a verified stop receipt.',inputSchema:{type:'object',properties:{workerId:{type:'string'}},required:['workerId'],additionalProperties:false}}
].map(t=>({...t,annotations:{readOnlyHint:t.name.endsWith('context')||t.name.endsWith('events'),destructiveHint:false,openWorldHint:false}}));
function ensure(){
  const node=manager.node(cap.nodeId),session=manager.session(cap.logicalSessionId);
  if(node.task_id!==cap.taskId||node.bot_id!==cap.botId||node.state!=='RUNNING'||session.generation!==cap.generation||session.active_node_id!==node.id)throw Error('Scoped MCP capability expired or changed');
  return {node,session,actor:{kind:'bot',id:node.bot_id,taskId:cap.taskId,nodeId:cap.nodeId,generation:cap.generation}};
}
function workerFor(id,node){
  const worker=manager.worker(id);
  if(worker.node_id!==node.id||worker.task_id!==node.task_id)throw Error('Worker belongs to another node');
  if(!worker.external_id)throw Error('Worker is not attached to a confirmed CLI session');
  return worker;
}
async function call(name,args){
  const {node,actor}=ensure();
  if(name==='sm_read_context'){
    if(Object.keys(args).length)throw Error('No arguments accepted');
    return manager.context(node.id);
  }
  if(name==='sm_agent_start'){
    // The existing generic Supervisor has no OS-enforced no-Git worker sandbox.
    // Do not expose writable CLI workers until a verified isolated launcher
    // supplies a controller-owned receipt. A model cannot override this gate.
    if(cap.workerIsolationVerified!==true)throw Error('WORKER_SANDBOX_REQUIRED: isolated no-Git launcher is not configured');
    if(typeof args.task!=='string'||!args.task.trim()||args.task.length>16384)throw Error('Invalid worker task');
    if(!node.config.cliPolicy.allowedProfiles.includes(args.profile))throw Error('Worker profile not allowed');
    const reserved=manager.command('worker.reserve',{nodeId:node.id,profile:args.profile,writeAccess:true},{actor});
    try{
      const started=await supervisor.start({agentProfile:args.profile,protocol:'acp',cwd:cap.worktree,task:args.task,wait:false,fromMcp:true,repositoryId:cap.taskId,operationId:cap.nodeId});
      const sessionId=started.sessionId;
      if(typeof sessionId!=='string'||!sessionId)throw Error('Supervisor did not return a real sessionId');
      manager.command('worker.receipt',{workerId:reserved.id,state:'RUNNING',externalId:sessionId,confirmed:true},{actor:{kind:'system',id:'scoped-supervisor'}});
      return {workerId:reserved.id,sessionId,state:'RUNNING'};
    }catch(e){
      // Starting may have produced an external process before acknowledgement.
      // UNKNOWN continues consuming the reserved slot until reconciled.
      manager.command('worker.receipt',{workerId:reserved.id,state:'UNKNOWN',confirmed:false},{actor:{kind:'system',id:'scoped-supervisor'}});
      throw e;
    }
  }
  if(!['sm_agent_send','sm_agent_events','sm_agent_cancel','sm_agent_stop'].includes(name))throw Error('Unknown tool');
  const worker=workerFor(args.workerId,node);
  if(name==='sm_agent_events'){
    const afterSeq=args.afterSeq??0;
    if(!Number.isSafeInteger(afterSeq)||afterSeq<0)throw Error('Invalid cursor');
    return supervisor.events(worker.external_id,{afterSeq,limit:200});
  }
  if(name==='sm_agent_send'){
    if(worker.state!=='RUNNING')throw Error('Worker is not running');
    if(typeof args.message!=='string'||!args.message.trim()||args.message.length>16384)throw Error('Invalid message');
    manager.command('worker.turn',{workerId:worker.id},{actor:{kind:'system',id:'scoped-supervisor'}});
    return await supervisor.send(worker.external_id,{message:args.message,mode:args.mode??'queue',wait:args.wait??false,actor:'codex'});
  }
  if(name==='sm_agent_cancel')return supervisor.cancel(worker.external_id,{actor:'codex'});
  const result=await supervisor.stop(worker.external_id,{actor:'codex'});
  if(!result.stopped)throw Error('Supervisor did not confirm process shutdown');
  manager.command('worker.receipt',{workerId:worker.id,state:'STOPPED',confirmed:true},{actor:{kind:'system',id:'scoped-supervisor'}});
  return {workerId:worker.id,stopped:true,sessionId:worker.external_id};
}
async function rpc(request){
  const reply=(result,error)=>({jsonrpc:'2.0',id:request?.id??null,...(error?{error}:{result})});
  if(!request||request.jsonrpc!=='2.0'||typeof request.method!=='string')return reply(null,fail(-32600,'Invalid Request'));
  if(request.id===undefined)return null;
  if(request.method==='initialize')return reply({protocolVersion:negotiateProtocolVersion(request.params?.protocolVersion),capabilities:{tools:{}},serverInfo:{name:'bdd-scoped-node',version:'1.0.0'}});
  if(request.method==='ping')return reply({});
  if(request.method==='tools/list')return reply({tools});
  if(request.method!=='tools/call')return reply(null,fail(-32601,'Method not found'));
  const {name,arguments:args={}}=request.params??{};
  if(!args||typeof args!=='object'||Array.isArray(args))return reply(null,fail(-32602,'Invalid arguments'));
  try{
    if(!tools.some(t=>t.name===name))throw Error('Unknown tool');
    const result=await call(name,args);
    return reply({structuredContent:result,content:[{type:'text',text:JSON.stringify(result)}]});
  }catch(e){return reply({isError:true,content:[{type:'text',text:e?.message??String(e)}]});}
}
try{
  for await(const line of readline.createInterface({input:process.stdin,crlfDelay:Infinity})){
    if(!line.trim())continue;
    let response;
    try{response=await rpc(JSON.parse(line));}
    catch(e){response={jsonrpc:'2.0',id:null,error:fail(-32700,e.message??String(e))};}
    if(response)process.stdout.write(JSON.stringify(response)+'\n');
  }
}finally{manager.close();await supervisor.close();}
