import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFile,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createServer,type ServerResponse} from 'node:http';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {promisify} from 'node:util';
import path from 'node:path';
import {Codex} from '@openai/codex-sdk';
import {createCopilotRuntime} from '../../src/adapters/runtime/copilot-chat.ts';
import {createChatProvider} from '../../src/adapters/runtime/chat-provider.ts';

// These are the installed vendor CLIs, not protocol peers or model fixtures.
// The first two checks send lifecycle RPCs only: their local model endpoints
// reject and count every call, and success requires zero inference requests.
// The remaining checks supply local model fixtures for wire compatibility.
const require=createRequire(import.meta.url);
const codexLoader=path.join(path.dirname(require.resolve('@openai/codex/package.json')),'bin/codex.js');
const copilotLoader=path.join(path.dirname(require.resolve('@github/copilot/package.json')),'npm-loader.js');
const codexVersion=require('@openai/codex/package.json').version as string;
const copilotVersion=require('@github/copilot/package.json').version as string;
const requestTimeoutMs=15000;

class NativeCli {
 readonly child:ChildProcessWithoutNullStreams;
 readonly notifications:any[]=[];
 readonly methods:string[]=[];
 private buffer:Buffer=Buffer.alloc(0);
 private stderr='';
 private next=0;
 private failure:Error|undefined;
 private pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 private exited:Promise<{code:number|null;signal:NodeJS.Signals|null}>;
 private framing:'jsonl'|'acp';
 onRequest:((message:any)=>object)|undefined;
 constructor(loader:string,args:string[],cwd:string,env:NodeJS.ProcessEnv,framing:'jsonl'|'acp'){
  this.framing=framing;
  this.child=spawn(process.execPath,[loader,...args],{cwd,env,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});
  this.child.stderr.on('data',chunk=>{this.stderr=(this.stderr+String(chunk)).slice(-8192);});
  this.child.on('error',error=>this.fail(error));
  this.child.stdin.on('error',error=>this.fail(error));
  this.exited=new Promise(resolve=>this.child.once('close',(code,signal)=>{
   this.fail(Error(`Native CLI exited (${code??signal})\n${this.stderr}`));resolve({code,signal});
  }));
  this.child.stdout.on('data',(chunk:Buffer)=>{
   try{
    this.buffer=Buffer.concat([this.buffer,chunk]);assert(this.buffer.length<=2*1024*1024,'CLI protocol buffer is bounded');
    while(true){
     const boundary=this.buffer.indexOf('\n');if(boundary<0)return;
     const body=this.buffer.subarray(0,boundary);this.buffer=this.buffer.subarray(boundary+1);if(!body.length)continue;
     const message=JSON.parse(body.toString());
     if(this.framing==='acp')assert.equal(message.jsonrpc,'2.0','ACP uses NDJSON JSON-RPC 2.0');
     if(message.method){
      if(message.id!==undefined){
       assert(this.onRequest,'A lifecycle smoke must not request a client tool or permission');
       this.send({jsonrpc:'2.0',id:message.id,result:this.onRequest(message)});
      }else this.notifications.push(message);
      continue;
     }
     const entry=this.pending.get(message.id);assert(entry,`Unexpected RPC response ${message.id}`);
     this.pending.delete(message.id);clearTimeout(entry.timer);
     if(message.error)entry.reject(Error(`Native RPC failed: ${message.error.message}`));else entry.resolve(message.result);
    }
   }catch(error){this.fail(error instanceof Error?error:Error(String(error)));}
  });
 }
 private fail(error:Error){
  this.failure??=error;
  for(const entry of this.pending.values()){clearTimeout(entry.timer);entry.reject(this.failure);}
  this.pending.clear();
 }
 private send(message:object){
  const body=JSON.stringify(message);
  this.child.stdin.write(body+'\n');
 }
 request(method:string,params:object={}):Promise<any>{
  if(this.failure)return Promise.reject(this.failure);
  this.methods.push(method);
  return new Promise((resolve,reject)=>{
   const id=++this.next;
   const timer=setTimeout(()=>this.fail(Error(`Native ${method} timed out\n${this.stderr}`)),requestTimeoutMs);
   this.pending.set(id,{resolve,reject,timer});this.send({...(this.framing==='acp'?{jsonrpc:'2.0'}:{}),id,method,params});
  });
 }
 notify(method:string,params:object={}){this.methods.push(method);this.send({...(this.framing==='acp'?{jsonrpc:'2.0'}:{}),method,params});}
 updates(sessionId:string,type:string){return this.notifications.filter(value=>value.method==='session/update'&&value.params?.sessionId===sessionId&&value.params.update?.sessionUpdate===type).map(value=>value.params.update);}
 async finish(){
  if(this.failure)throw this.failure;
  this.child.stdin.end();
  const result=await this.waitForExit(5000);assert.deepEqual(result,{code:0,signal:null},this.stderr);
 }
 private waitForExit(timeoutMs:number){
  let timer:ReturnType<typeof setTimeout>;
  return Promise.race([this.exited,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(Error(`Native CLI did not shut down\n${this.stderr}`)),timeoutMs);})]).finally(()=>clearTimeout(timer));
 }
 async dispose(){
  if(this.child.exitCode!==null||this.child.signalCode!==null)return;
  try{if(this.child.pid&&process.platform!=='win32')process.kill(-this.child.pid,'SIGKILL');else this.child.kill('SIGKILL');}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}
  await this.waitForExit(5000);
 }
}

async function fixture(respond?:(body:any,index:number,res:ServerResponse)=>void){
 const directory=await mkdtemp(path.join(tmpdir(),'bdd-native-chat-smoke-'));
 const workspace=path.join(directory,'workspace'),qaHome=path.join(directory,'home'),codexHome=path.join(directory,'codex'),copilotHome=path.join(directory,'copilot'),temporary=path.join(directory,'tmp');
 await Promise.all([workspace,qaHome,codexHome,copilotHome,temporary].map(dir=>mkdir(dir,{recursive:true})));
 const inferenceRequests:string[]=[],providerErrors:unknown[]=[];
 const server=createServer(async(req,res)=>{
  const index=inferenceRequests.push(`${req.method} ${req.url}`)-1;
  if(!respond){res.writeHead(503);res.end('Inference is forbidden in the native lifecycle smoke');return;}
  try{let raw='';for await(const chunk of req)raw+=String(chunk);respond(JSON.parse(raw),index,res);}
  catch(error){providerErrors.push(error);if(!res.headersSent)res.writeHead(503);res.end();}
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const address=server.address();assert(address&&typeof address==='object');
 // No inherited authentication, provider overrides, user configuration, hooks,
 // telemetry settings or GitHub CLI state. Never read a real user's login.
 const env:NodeJS.ProcessEnv={PATH:process.env.PATH,LANG:'C.UTF-8',TMPDIR:temporary,HOME:qaHome,USERPROFILE:qaHome,SYSTEMROOT:process.env.SYSTEMROOT,CODEX_HOME:codexHome,COPILOT_HOME:copilotHome,COPILOT_DISABLE_KEYTAR:'1',XDG_CONFIG_HOME:path.join(directory,'xdg'),XDG_CACHE_HOME:path.join(directory,'cache')};
 const processes:NativeCli[]=[];
 return {workspace,env,copilotHome,inferenceRequests,providerErrors,url:`http://127.0.0.1:${address.port}/v1`,
  start(loader:string,args:string[],framing:'jsonl'|'acp'){const cli=new NativeCli(loader,args,workspace,env,framing);processes.push(cli);return cli;},
  async close(){try{await Promise.all(processes.map(cli=>cli.dispose()));}finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await rm(directory,{recursive:true,force:true});}},
 };
}

const copilotArgs=['--acp','--stdio','--no-auto-update','--no-auto-login','--disable-builtin-mcps','--no-custom-instructions','--no-ask-user','--disable-client-telemetry'];
function configureCopilotProvider(f:{env:NodeJS.ProcessEnv;url:string}){
 // ACP receives provider configuration at process startup, not through the
 // private headless session.create protocol. All inference stays on loopback.
 Object.assign(f.env,{COPILOT_PROVIDER_BASE_URL:f.url,COPILOT_PROVIDER_TYPE:'openai',COPILOT_PROVIDER_WIRE_API:'completions',COPILOT_MODEL:'protocol-smoke'});
}
async function initializeCopilot(cli:NativeCli){
 const result=await cli.request('initialize',{protocolVersion:1,clientCapabilities:{},clientInfo:{name:'bdd-native-acp-smoke',version:'1.0.0'}});
 assert.equal(result.protocolVersion,1);assert.equal(result.agentInfo.version,copilotVersion);
 assert.deepEqual(result.agentCapabilities.sessionCapabilities.close,{});
 assert.equal(result.agentCapabilities.mcpCapabilities.http,true);
 return result;
}

test('installed Codex reuses one app-server for unauthenticated in-memory thread lifecycle without inference',{timeout:60000},async t=>{
 const f=await fixture();t.after(()=>f.close());
 const version=await promisify(execFile)(process.execPath,[codexLoader,'--version'],{cwd:f.workspace,env:f.env,timeout:requestTimeoutMs});
 assert.equal(version.stdout.trim(),`codex-cli ${codexVersion}`);
 const cli=f.start(codexLoader,['app-server','--listen','stdio://','-c','model_provider="smoke"','-c',`model_providers.smoke={name="No-inference smoke",base_url=${JSON.stringify(f.url)},wire_api="responses",requires_openai_auth=false}`],'jsonl');
 const pid=cli.child.pid;assert(pid);
 const initialized=await cli.request('initialize',{clientInfo:{name:'bdd_native_lifecycle_smoke',version:'1.0.0'}});
 assert.equal(typeof initialized.userAgent,'string');assert(initialized.userAgent.trim());cli.notify('initialized');
 const account=await cli.request('account/read',{refreshToken:false});assert.equal(account.account,null);assert.equal(account.requiresOpenaiAuth,false);
 const params={model:'protocol-smoke',cwd:f.workspace,approvalPolicy:'never',sandbox:'read-only',baseInstructions:'No inference is permitted in this lifecycle smoke.'};
 const first=await cli.request('thread/start',params),second=await cli.request('thread/start',params);
 assert.equal(typeof first.thread.id,'string');assert.equal(typeof second.thread.id,'string');assert.notEqual(first.thread.id,second.thread.id);
 // A new thread without a submitted turn has no durable rollout to resume.
 // This no-inference check verifies only the threads loaded in this process.
 const loaded=await cli.request('thread/loaded/list',{});assert.equal(loaded.data.length,2);assert.deepEqual(new Set(loaded.data),new Set([first.thread.id,second.thread.id]));
 assert.equal(cli.child.pid,pid);assert.equal(cli.child.exitCode,null);
 assert.equal(cli.methods.filter(method=>method==='initialize').length,1);
 assert.equal(cli.methods.filter(method=>method==='thread/start').length,2);
 assert(!cli.methods.some(method=>method==='turn/start'||method==='thread/compact/start'));
 await cli.finish();assert.deepEqual(f.inferenceRequests,[],'No model HTTP request was made');
});

test('installed Copilot reuses one ACP process for isolated session lifecycles without login or inference',{timeout:60000},async t=>{
 const f=await fixture();t.after(()=>f.close());
 configureCopilotProvider(f);
 const cli=f.start(copilotLoader,[...copilotArgs,'--available-tools=__bdd_no_tools__'],'acp');
 const pid=cli.child.pid;assert(pid);
 await initializeCopilot(cli);
 const first=await cli.request('session/new',{cwd:f.workspace,mcpServers:[]});
 const second=await cli.request('session/new',{cwd:f.workspace,mcpServers:[]});
 assert.equal(typeof first.sessionId,'string');assert(first.sessionId);assert.equal(typeof second.sessionId,'string');assert(second.sessionId);
 assert.notEqual(first.sessionId,second.sessionId);
 for(const created of [first,second]){
  assert.equal(created.configOptions.find((option:any)=>option.id==='allow_all').currentValue,'off','ACP does not enable unrestricted execution');
 }
 assert.deepEqual(await cli.request('session/close',{sessionId:first.sessionId}),{});
 const unchanged=await cli.request('session/set_config_option',{sessionId:second.sessionId,configId:'allow_all',value:'off'});
 assert.equal(unchanged.configOptions.find((option:any)=>option.id==='allow_all').currentValue,'off','Closing one session leaves the other available');
 assert.deepEqual(await cli.request('session/close',{sessionId:second.sessionId}),{});
 assert.equal(cli.child.pid,pid);assert.equal(cli.child.exitCode,null);
 assert.equal(cli.methods.filter(method=>method==='initialize').length,1);assert(!cli.methods.includes('session/prompt'));
 assert(!cli.methods.some(method=>['connect','session.create','session.send','session.delete'].includes(method)),'No private headless RPC is used');
 await cli.finish();assert.deepEqual(f.inferenceRequests,[],'No model HTTP request was made');
});

test('installed Copilot ACP streams local fixture text and hands a restricted MCP proposal back without executing it',{timeout:60000},async t=>{
 // The real vendor binary connects to local OpenAI and MCP protocol fixtures.
 // Permission refusal plus session/cancel prevents a second model turn and
 // leaves execution of the proposed workstation action with Codex.
 const mcpName='bdd_native_codex_handoff',toolName='workbench_probe',fullToolName=`${mcpName}-${toolName}`;
 const f=await fixture((body,index,res)=>{
  assert(index<2,'Each session requests exactly one local fixture completion');
  assert.equal(body.model,'protocol-smoke');assert.equal(body.stream,true);
  const names=(body.tools??[]).map((tool:any)=>tool.function.name);
  assert.deepEqual(names,index===0?[]:[fullToolName],'Only this session\'s declared MCP tools reach the model; built-in tools are absent');
  const delta=index===0?{role:'assistant',content:'Native protocol fixture'}:{role:'assistant',content:'',tool_calls:[{index:0,id:'native-fixture-call',type:'function',function:{name:fullToolName,arguments:'{"note":"proposal only"}'}}]};
  const chunk={id:'fixture-response-'+index,object:'chat.completion.chunk',created:1,model:'protocol-smoke'};
  res.writeHead(200,{'content-type':'text/event-stream'});
  res.write('data: '+JSON.stringify({...chunk,choices:[{index:0,delta,finish_reason:null}]})+'\n\n');
  res.write('data: '+JSON.stringify({...chunk,choices:[{index:0,delta:{},finish_reason:index===0?'stop':'tool_calls'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}})+'\n\n');
  res.end('data: [DONE]\n\n');
 });t.after(()=>f.close());
 configureCopilotProvider(f);
 const mcpMethods:string[]=[],mcpErrors:unknown[]=[],permissions:any[]=[],proposals:any[]=[];
 const mcp=createServer(async(req,res)=>{
  try{
   assert.equal(req.headers.authorization,'Bearer local-native-mcp-fixture','ACP passes the scoped MCP authorization header');
   if(req.method!=='POST'){res.writeHead(405);res.end();return;}
   let raw='';for await(const chunk of req)raw+=String(chunk);const message=JSON.parse(raw);mcpMethods.push(message.method);
   if(message.id===undefined){res.writeHead(202);res.end();return;}
   let result:object|undefined;
   if(message.method==='initialize')result={protocolVersion:message.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'bdd-native-proposal-fixture',version:'1.0.0'}};
   if(message.method==='tools/list')result={tools:[{name:toolName,description:'Request a proposal only. Codex owns actual execution.',inputSchema:{type:'object',properties:{note:{type:'string'}},required:['note']}}]};
   assert.notEqual(message.method,'tools/call','Refused ACP permissions must not invoke the MCP tool');
   res.writeHead(200,{'content-type':'application/json'});
   res.end(JSON.stringify({jsonrpc:'2.0',id:message.id,...(result?{result}:{error:{code:-32601,message:'Unsupported fixture method'}})}));
  }catch(error){mcpErrors.push(error);if(!res.headersSent)res.writeHead(503);res.end();}
 });
 await new Promise<void>((resolve,reject)=>{mcp.once('error',reject);mcp.listen(0,'127.0.0.1',resolve);});
 t.after(async()=>{mcp.closeAllConnections();await new Promise<void>((resolve,reject)=>mcp.close(error=>error?reject(error):resolve()));});
 const address=mcp.address();assert(address&&typeof address==='object');
 const cli=f.start(copilotLoader,[...copilotArgs,`--available-tools=${mcpName}/*`],'acp'),pid=cli.child.pid;
 await initializeCopilot(cli);
 const {sessionId:textSession}=await cli.request('session/new',{cwd:f.workspace,mcpServers:[]});
 const textReply=await cli.request('session/prompt',{sessionId:textSession,prompt:[{type:'text',text:'Protocol fixture only'}]});
 assert.equal(textReply.stopReason,'end_turn');
 const chunks=cli.updates(textSession,'agent_message_chunk').map(update=>update.content.text);
 // 1.0.105 also emits its disabled-tool notice as an untagged message chunk.
 // Keep that vendor notice observable; never strip arbitrary model text.
 assert.equal(chunks.at(-1),'Native protocol fixture');assert.equal(chunks.filter(chunk=>chunk==='Native protocol fixture').length,1);
 assert.deepEqual(await cli.request('session/close',{sessionId:textSession}),{});
 const {sessionId:toolSession}=await cli.request('session/new',{cwd:f.workspace,mcpServers:[{type:'http',name:mcpName,url:`http://127.0.0.1:${address.port}/mcp`,headers:[{name:'Authorization',value:'Bearer local-native-mcp-fixture'}]}]});
 cli.onRequest=message=>{
  assert.equal(message.method,'session/request_permission');assert.equal(message.params.sessionId,toolSession);permissions.push(message.params);
  const requested=message.params.toolCall;
  const announced=cli.updates(toolSession,'tool_call').find(update=>update.toolCallId===requested.toolCallId);
  assert(announced);assert.equal(announced.title,fullToolName);assert.equal(announced.kind,'other');
  assert.equal(requested.title,toolName);assert.deepEqual(requested.rawInput,announced.rawInput);assert.deepEqual(requested.rawInput,{note:'proposal only'});
  proposals.push({toolCallId:requested.toolCallId,name:toolName,arguments:requested.rawInput});
  cli.notify('session/cancel',{sessionId:toolSession});
  return {outcome:{outcome:'cancelled'}};
 };
 const toolReply=await cli.request('session/prompt',{sessionId:toolSession,prompt:[{type:'text',text:'Protocol fixture only'}]});
 assert.equal(toolReply.stopReason,'cancelled');
 assert.deepEqual(proposals,[{toolCallId:'native-fixture-call',name:toolName,arguments:{note:'proposal only'}}]);
 assert.equal(permissions.length,1);assert(mcpMethods.includes('initialize'));assert(mcpMethods.includes('tools/list'));assert(!mcpMethods.includes('tools/call'));
 assert.deepEqual(await cli.request('session/close',{sessionId:toolSession}),{});
 assert.equal(cli.child.pid,pid);assert.equal(cli.child.exitCode,null);assert.equal(cli.methods.filter(method=>method==='initialize').length,1);
 assert(!cli.methods.some(method=>['connect','session.create','session.send','session.delete'].includes(method)),'The text and tool paths remain entirely on ACP');
 await cli.finish();assert.deepEqual(f.providerErrors,[]);assert.deepEqual(f.inferenceRequests,['POST /v1/chat/completions','POST /v1/chat/completions']);
 assert.deepEqual(mcpErrors,[]);
});

test('the production ACP adapter reuses installed Copilot for streaming, catalog and a Codex tool proposal',{timeout:60000},async t=>{
 const toolName='workbench_get_requirement_proposals';
 const observedTools:string[][]=[];
 const f=await fixture((body,index,res)=>{
  assert(index<3,'No second inference may execute a proposed tool');assert.equal(body.model,'protocol-smoke');
  const names=(body.tools??[]).map((tool:any)=>tool.function.name);observedTools.push(names);
  if(index===1){assert.equal(names.length,1);assert.match(names[0],/^bdd_[a-f0-9]{24}-workbench_get_requirement_proposals$/);assert(names[0].length<=64,'The longest workstation tool keeps its exact name');}
  else assert.deepEqual(names,[],'No builtin or inherited tool is exposed to inference');
  const delta=index===1?{role:'assistant',content:'',tool_calls:[{index:0,id:'adapter-proposal',type:'function',function:{name:names[0],arguments:'{"note":"only a proposal"}'}}]}:{role:'assistant',content:`Native adapter reply ${index}`};
  const chunk={id:'adapter-fixture-'+index,object:'chat.completion.chunk',created:1,model:'protocol-smoke'};
  res.writeHead(200,{'content-type':'text/event-stream'});
  res.write('data: '+JSON.stringify({...chunk,choices:[{index:0,delta,finish_reason:null}]})+'\n\n');
  res.write('data: '+JSON.stringify({...chunk,choices:[{index:0,delta:{},finish_reason:index===1?'tool_calls':'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}})+'\n\n');
  res.end('data: [DONE]\n\n');
 });
 let runtime:ReturnType<typeof createCopilotRuntime>|undefined;
 t.after(async()=>{try{await runtime?.close();}finally{await f.close();}});
 configureCopilotProvider(f);
 const wrapper=path.join(f.workspace,'copilot-wrapper.mjs'),tracePath=path.join(f.workspace,'copilot-spawns.jsonl');
 await writeFile(wrapper,`
import {spawn} from 'node:child_process';
import {appendFileSync} from 'node:fs';
appendFileSync(${JSON.stringify(tracePath)},JSON.stringify({pid:process.pid,args:process.argv.slice(2)})+'\\n');
const child=spawn(process.execPath,[${JSON.stringify(copilotLoader)},...process.argv.slice(2)],{env:${JSON.stringify(f.env)},stdio:'inherit'});
child.on('error',error=>{process.stderr.write(error.message);process.exitCode=1;});child.on('close',code=>{process.exitCode=code??1;});
`);
 runtime=createCopilotRuntime(f.workspace);
 const settings={codexExecutable:'unused',copilotExecutable:process.execPath,copilotArgs:[wrapper],model:'auto',timeoutMs:20000},signal=new AbortController().signal;
 assert.deepEqual(await runtime.models(settings,signal),[],'The BYOK ACP agent supplies no invented model catalog');
 const deltas:string[]=[];let finished=false;
 const first=await runtime.completion(settings,'Local fixture only',signal,[],delta=>{assert.equal(finished,false);deltas.push(delta);});finished=true;
 assert(first.text.endsWith('Native adapter reply 0'));assert.equal(deltas.join(''),first.text);assert.deepEqual(first.calls,[]);
 const proposal=await runtime.completion(settings,'Request a proposal only',signal,[{name:toolName,namespace:'mcp__workbench',description:'Only Codex may execute this action.',parameters:{type:'object',properties:{note:{type:'string'}},required:['note']}}]);
 assert.deepEqual(f.providerErrors,[],JSON.stringify({observedTools,proposal}));
 assert.deepEqual(proposal.calls,[{toolCallId:'adapter-proposal',mcpServerName:'codex_handoff',mcpToolName:toolName,arguments:{note:'only a proposal'}}]);
 const third=await runtime.completion(settings,'Another isolated inference',signal,[]);assert(third.text.endsWith('Native adapter reply 2'));assert.deepEqual(third.calls,[]);
 const spawns=(await readFile(tracePath,'utf8')).trim().split('\n').map(line=>JSON.parse(line));assert.equal(spawns.length,1,'One installed ACP process serves catalog, text and tool proposals');
 assert(spawns[0].args.includes('--acp'));assert(!spawns[0].args.includes('--headless'));
 assert.equal(observedTools.length,3);assert.deepEqual(f.providerErrors,[]);
 await runtime.close();
});

test('the real SDK and an exec protocol peer preserve Codex function and custom calls through installed Copilot ACP',{timeout:60000},async t=>{
 // Codex's native sandbox cannot run on every test host. This check uses the
 // real SDK with an explicitly controlled exec peer; it tests the API bridge,
 // not native Codex execution, sandboxing, file changes or model intelligence.
 const patch='*** Begin Patch\n*** Add File: 漢字.txt\n+literal {"value":"unchanged"} \\ slash\n*** End Patch\n';
 const tools=[{type:'namespace',name:'functions',tools:[
  {type:'function',name:'exec_command',description:'Propose a Codex command',parameters:{type:'object',properties:{cmd:{type:'string'}},required:['cmd'],additionalProperties:false}},
  {type:'custom',name:'apply_patch',description:'Propose a Codex patch',format:{type:'grammar',syntax:'lark',definition:'start: "*** Begin Patch" /[\\s\\S]*/ "*** End Patch"'}},
 ]},{type:'namespace',name:'mcp__workbench_task',tools:[{type:'function',name:'workbench_get_task',description:'Read the Codex task',parameters:{type:'object',properties:{},additionalProperties:false}}]}];
 const observed:string[][]=[];
 const f=await fixture((body,index,res)=>{
  assert(index<4,'Only the exec peer starts the next inference after a handoff');
  const catalog=body.tools??[],names=catalog.map((tool:any)=>tool.function.name);observed.push(names);
  assert.equal(names.length,3);assert(names.every((name:string)=>/^bdd_[a-f0-9]{24}-codex_tool_000[0-2]$/.test(name)),'Only declared proposal aliases reach Copilot');
  if(index>0)assert(JSON.stringify(body.messages).includes('Protocol fixture result only; no tool was executed'), 'Codex-owned tool results survive the next model request');
  const selected=index<3?catalog.find((tool:any)=>tool.function.name.endsWith('-codex_tool_000'+index)):undefined;
  const argumentsByStep=[{cmd:'printf protocol-fixture'},{input:patch},{}];
  const delta=selected?{role:'assistant',content:'',tool_calls:[{index:0,id:'sdk-proposal-'+index,type:'function',function:{name:selected.function.name,arguments:JSON.stringify(argumentsByStep[index])}}]}:{role:'assistant',content:'SDK bridge fixture complete'};
  const chunk={id:'sdk-model-fixture-'+index,object:'chat.completion.chunk',created:1,model:'protocol-smoke'};
  res.writeHead(200,{'content-type':'text/event-stream'});
  res.write('data: '+JSON.stringify({...chunk,choices:[{index:0,delta,finish_reason:null}]})+'\n\n');
  res.write('data: '+JSON.stringify({...chunk,choices:[{index:0,delta:{},finish_reason:selected?'tool_calls':'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}})+'\n\n');res.end('data: [DONE]\n\n');
 });
 let provider:Awaited<ReturnType<typeof createChatProvider>>|undefined;
 t.after(async()=>{try{await provider?.close();}finally{await f.close();}});
 configureCopilotProvider(f);
 const wrapper=path.join(f.workspace,'sdk-copilot-wrapper.mjs'),copilotSpawns=path.join(f.workspace,'sdk-copilot-spawns.jsonl'),execPeer=path.join(f.workspace,'sdk-exec-peer.mjs'),callsPath=path.join(f.workspace,'sdk-proposals.json');
 await writeFile(wrapper,`
import {spawn} from 'node:child_process';import {appendFileSync,readdirSync} from 'node:fs';
appendFileSync(${JSON.stringify(copilotSpawns)},JSON.stringify({pid:process.pid,args:process.argv.slice(2),cwd:process.cwd(),entries:readdirSync(process.cwd())})+'\\n');
const child=spawn(process.execPath,[${JSON.stringify(copilotLoader)},...process.argv.slice(2)],{env:${JSON.stringify(f.env)},stdio:'inherit'});
child.on('error',error=>{process.stderr.write(error.message);process.exitCode=1;});child.on('close',code=>{process.exitCode=code??1;});
`);
 await writeFile(execPeer,`#!/usr/bin/env node
import assert from 'node:assert/strict';import {writeFile} from 'node:fs/promises';
const args=process.argv.slice(2);assert.equal(args[0],'exec');assert(args.includes('--experimental-json'));
const config=[];for(let i=0;i<args.length;i++)if(args[i]==='--config')config.push(args[++i]);
const value=key=>JSON.parse(config.find(entry=>entry.startsWith(key+'=')).slice(key.length+1));
assert.equal(value('model_provider'),'sdk_fixture');assert.equal(value('model_providers.sdk_fixture.wire_api'),'responses');
const url=value('model_providers.sdk_fixture.base_url'),token=process.env.WB_SDK_PROVIDER_TOKEN;assert(token);
let prompt='';for await(const chunk of process.stdin)prompt+=chunk;
const history=[{type:'message',role:'user',content:[{type:'input_text',text:prompt}]}],tools=${JSON.stringify(tools)},calls=[];
const emit=value=>process.stdout.write(JSON.stringify(value)+'\\n');emit({type:'thread.started',thread_id:'sdk-protocol-thread'});emit({type:'turn.started'});
for(let step=0;step<4;step++){
 const response=await fetch(url+'/responses',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({input:history,tools,stream:true})});assert.equal(response.status,200);
 const events=(await response.text()).split('\\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6))),completed=events.find(event=>event.type==='response.completed');assert(completed);
 history.push(...completed.response.output);
 const proposal=completed.response.output.filter(item=>['function_call','custom_tool_call'].includes(item.type));
 if(step<3){
  assert.equal(proposal.length,1);const call=proposal[0];calls.push(call);
  assert.equal(call.name,['exec_command','apply_patch','workbench_get_task'][step]);assert.equal(call.namespace,step===2?'mcp__workbench_task':'functions');
  if(step===1){assert.equal(call.type,'custom_tool_call');assert.equal(call.input,${JSON.stringify(patch)});assert.equal(call.arguments,undefined);}
  else {assert.equal(call.type,'function_call');assert.deepEqual(JSON.parse(call.arguments),step===0?{cmd:'printf protocol-fixture'}:{});}
  history.push({type:call.type==='custom_tool_call'?'custom_tool_call_output':'function_call_output',call_id:call.call_id,output:'Protocol fixture result only; no tool was executed'});
 }else{assert.equal(proposal.length,0);const text=completed.response.output.filter(item=>item.type==='message').flatMap(item=>item.content).map(part=>part.text).join('');assert(text.endsWith('SDK bridge fixture complete'));emit({type:'item.completed',item:{id:'message',type:'agent_message',text}});}
}
await writeFile(${JSON.stringify(callsPath)},JSON.stringify(calls));emit({type:'turn.completed',usage:{input_tokens:4,cached_input_tokens:0,output_tokens:4,reasoning_output_tokens:0}});
`,{mode:0o700});
 provider=await createChatProvider(f.workspace,'codex');
 const signal=AbortSignal.timeout(40000),registration=provider.register({codexExecutable:execPeer,copilotExecutable:process.execPath,copilotArgs:[wrapper],model:'auto',timeoutMs:20000},signal);
 const env=Object.fromEntries(Object.entries(f.env).filter((entry):entry is [string,string]=>typeof entry[1]==='string'));
 const sdk=new Codex({codexPathOverride:execPeer,env:{...env,WB_SDK_PROVIDER_TOKEN:registration.token},config:{model_provider:'sdk_fixture',model_providers:{sdk_fixture:{name:'Copilot ACP fixture',base_url:provider.url,wire_api:'responses',requires_openai_auth:false,env_key:'WB_SDK_PROVIDER_TOKEN',supports_websockets:false,request_max_retries:0,stream_max_retries:0}}}});
 const thread=sdk.startThread({workingDirectory:f.workspace,sandboxMode:'read-only',approvalPolicy:'never',skipGitRepoCheck:true,webSearchMode:'disabled'}),events=[];
 for await(const event of (await thread.runStreamed('Exercise the declared proposal bridge only.',{signal})).events)events.push(event);
 registration.close();assert.equal(thread.id,'sdk-protocol-thread');assert.equal(events.at(-1)?.type,'turn.completed');
 const calls=JSON.parse(await readFile(callsPath,'utf8'));assert.equal(calls.length,3);assert.equal(calls[1].input,patch);
 const spawns=(await readFile(copilotSpawns,'utf8')).trim().split('\n').map(line=>JSON.parse(line));assert.equal(spawns.length,1);assert(spawns[0].args.includes('--acp'));assert(!spawns[0].args.includes('--headless'));
 assert.notEqual(spawns[0].cwd,f.workspace);assert(!spawns[0].cwd.startsWith(f.workspace+path.sep));assert.deepEqual(spawns[0].entries,[],'The installed Copilot agent starts without the coding checkout as implicit context');
 assert.equal(observed.length,4);assert.deepEqual(f.providerErrors,[]);
});
