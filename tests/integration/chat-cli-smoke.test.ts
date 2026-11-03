import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFile,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createServer,type ServerResponse} from 'node:http';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {promisify} from 'node:util';
import path from 'node:path';

// These are the installed vendor CLIs, not protocol peers or model fixtures.
// The first two checks send lifecycle RPCs only: their local model endpoints
// reject and count every call, and success requires zero inference requests.
// The third check supplies explicit local model fixtures for wire compatibility.
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
 private framing:'jsonl'|'content-length';
 constructor(loader:string,args:string[],cwd:string,env:NodeJS.ProcessEnv,framing:'jsonl'|'content-length'){
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
     let body:Buffer;
     if(this.framing==='jsonl'){
      const boundary=this.buffer.indexOf('\n');if(boundary<0)return;
      body=this.buffer.subarray(0,boundary);this.buffer=this.buffer.subarray(boundary+1);if(!body.length)continue;
     }else{
      const boundary=this.buffer.indexOf('\r\n\r\n');if(boundary<0)return;
      const match=/^Content-Length: (\d+)$/im.exec(this.buffer.subarray(0,boundary).toString());assert(match,'Valid Content-Length header');
      const length=Number(match[1]);assert(Number.isSafeInteger(length)&&length>0&&length<=2*1024*1024,'Valid frame size');
      if(this.buffer.length<boundary+4+length)return;
      body=this.buffer.subarray(boundary+4,boundary+4+length);this.buffer=this.buffer.subarray(boundary+4+length);
     }
     const message=JSON.parse(body.toString());
     if(this.framing==='content-length')assert.equal(message.jsonrpc,'2.0');
     if(message.method){assert.equal(message.id,undefined,'A lifecycle smoke must not request a client tool or permission');this.notifications.push(message);continue;}
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
  this.child.stdin.write(this.framing==='jsonl'?body+'\n':`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
 }
 request(method:string,params:object={}):Promise<any>{
  if(this.failure)return Promise.reject(this.failure);
  this.methods.push(method);
  return new Promise((resolve,reject)=>{
   const id=++this.next;
   const timer=setTimeout(()=>this.fail(Error(`Native ${method} timed out\n${this.stderr}`)),requestTimeoutMs);
   this.pending.set(id,{resolve,reject,timer});this.send({...(this.framing==='content-length'?{jsonrpc:'2.0'}:{}),id,method,params});
  });
 }
 notify(method:string,params:object={}){this.methods.push(method);this.send({method,params});}
 async event(sessionId:string,type:string){
  const deadline=Date.now()+requestTimeoutMs;
  while(true){
   if(this.failure)throw this.failure;
   const notification=this.notifications.find(value=>value.method==='session.event'&&value.params?.sessionId===sessionId&&value.params.event?.type===type);
   if(notification)return notification.params.event;
   if(Date.now()>=deadline)throw Error(`Native session ${sessionId} never emitted ${type}\n${this.stderr}`);
   await new Promise(resolve=>setTimeout(resolve,10));
  }
 }
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
  start(loader:string,args:string[],framing:'jsonl'|'content-length'){const cli=new NativeCli(loader,args,workspace,env,framing);processes.push(cli);return cli;},
  async close(){try{await Promise.all(processes.map(cli=>cli.dispose()));}finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await rm(directory,{recursive:true,force:true});}},
 };
}

const copilotArgs=['--headless','--stdio','--no-auto-update','--no-auto-login','--disable-builtin-mcps','--no-custom-instructions','--no-ask-user','--disable-client-telemetry'];
function sessionOptions(f:{workspace:string;url:string;copilotHome:string},sessionId:string,tools:{name:string;description:string;parameters:object;skipPermission:boolean}[]=[]){
 return {sessionId,model:'protocol-smoke',clientName:'bdd-native-lifecycle-smoke',workingDirectory:f.workspace,provider:{type:'openai',wireApi:'completions',baseUrl:f.url,apiKey:'local-smoke-no-credential'},availableTools:tools.map(tool=>tool.name),toolFilterPrecedence:'excluded',tools,mcpServers:{},requestPermission:true,requestUserInput:false,streaming:true,enableConfigDiscovery:false,enableSkills:false,enableFileHooks:false,enableHostGitOperations:false,enableSessionStore:false,skipEmbeddingRetrieval:true,infiniteSessions:{enabled:false},memory:{enabled:false},configDir:f.copilotHome};
}
const restrictedOptions={skipCustomInstructions:true,installedPlugins:[],includedBuiltinSkills:[],coauthorEnabled:false,manageScheduleEnabled:false};

test('installed Codex reuses one app-server for unauthenticated thread lifecycle without inference',{timeout:60000},async t=>{
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
 const resumed=await cli.request('thread/resume',{...params,threadId:first.thread.id,excludeTurns:true});assert.equal(resumed.thread.id,first.thread.id);
 const loaded=await cli.request('thread/loaded/list',{});assert.deepEqual(new Set(loaded.data),new Set([first.thread.id,second.thread.id]));
 assert.equal(cli.child.pid,pid);assert.equal(cli.child.exitCode,null);
 assert.equal(cli.methods.filter(method=>method==='initialize').length,1);
 assert(!cli.methods.some(method=>method==='turn/start'||method==='thread/compact/start'));
 await cli.finish();assert.deepEqual(f.inferenceRequests,[],'No model HTTP request was made');
});

test('installed Copilot reuses one unauthenticated headless process for isolated session lifecycles without inference',{timeout:60000},async t=>{
 const f=await fixture();t.after(()=>f.close());
 const cli=f.start(copilotLoader,copilotArgs,'content-length');
 const pid=cli.child.pid;assert(pid);
 const connected=await cli.request('connect');assert.equal(connected.ok,true);assert.equal(connected.protocolVersion,3);assert.equal(connected.version,copilotVersion);
 assert.equal((await cli.request('auth.getStatus')).isAuthenticated,false);
 const ids=[randomUUID(),randomUUID()];
 for(const sessionId of ids){
  const created=await cli.request('session.create',sessionOptions(f,sessionId));
  assert.equal(created.sessionId,sessionId);
  assert.equal((await cli.request('session.options.update',{sessionId,...restrictedOptions})).success,true);
 }
 assert.equal((await cli.request('session.abort',{sessionId:ids[0]})).success,true);
 assert.equal((await cli.request('session.destroy',{sessionId:ids[0]})).success,true);
 assert.equal((await cli.request('session.delete',{sessionId:ids[0]})).success,true);
 assert.equal((await cli.request('session.options.update',{sessionId:ids[1],skipCustomInstructions:true})).success,true,'Destroying one session does not destroy the other');
 assert.equal((await cli.request('session.abort',{sessionId:ids[1]})).success,true);
 assert.equal((await cli.request('session.destroy',{sessionId:ids[1]})).success,true);
 assert.equal((await cli.request('session.delete',{sessionId:ids[1]})).success,true);
 assert.equal((await cli.request('auth.getStatus')).isAuthenticated,false);
 assert.equal(cli.child.pid,pid);assert.equal(cli.child.exitCode,null);
 assert.equal(cli.methods.filter(method=>method==='connect').length,1);assert(!cli.methods.includes('session.send'));
 await cli.finish();assert.deepEqual(f.inferenceRequests,[],'No model HTTP request was made');
});

test('installed Copilot streams local fixture text and exposes native tool handoff without a tool executor',{timeout:60000},async t=>{
 // This local OpenAI-compatible fixture tests the installed CLI's wire format,
 // streaming and external-tool handoff. It is not live model inference evidence.
 const f=await fixture((body,index,res)=>{
  assert(index<2,'Each session requests exactly one local fixture completion');
  assert.equal(body.model,'protocol-smoke');assert.equal(body.stream,true);
  const names=(body.tools??[]).map((tool:any)=>tool.function.name);
  assert.deepEqual(names,index===0?[]:['workbench_probe'],'Only explicitly advertised tools reach the provider');
  const delta=index===0?{role:'assistant',content:'Native protocol fixture'}:{role:'assistant',content:'',tool_calls:[{index:0,id:'native-fixture-call',type:'function',function:{name:'workbench_probe',arguments:'{}'}}]};
  const chunk={id:'fixture-response-'+index,object:'chat.completion.chunk',created:1,model:'protocol-smoke'};
  res.writeHead(200,{'content-type':'text/event-stream'});
  res.write('data: '+JSON.stringify({...chunk,choices:[{index:0,delta,finish_reason:null}]})+'\n\n');
  res.write('data: '+JSON.stringify({...chunk,choices:[{index:0,delta:{},finish_reason:index===0?'stop':'tool_calls'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}})+'\n\n');
  res.end('data: [DONE]\n\n');
 });t.after(()=>f.close());
 const cli=f.start(copilotLoader,copilotArgs,'content-length'),pid=cli.child.pid;
 assert.equal((await cli.request('connect')).ok,true);assert.equal((await cli.request('auth.getStatus')).isAuthenticated,false);
 const textSession=randomUUID();assert.equal((await cli.request('session.create',sessionOptions(f,textSession))).sessionId,textSession);
 await cli.request('session.options.update',{sessionId:textSession,...restrictedOptions});
 const sent=await cli.request('session.send',{sessionId:textSession,prompt:'Protocol fixture only'});assert.equal(typeof sent.messageId,'string');
 await cli.event(textSession,'session.idle');
 const textMessage=await cli.event(textSession,'assistant.message');assert.equal(textMessage.data.content,'Native protocol fixture');assert.deepEqual(textMessage.data.toolRequests,[]);
 const deltas=cli.notifications.filter(value=>value.method==='session.event'&&value.params?.sessionId===textSession&&value.params.event?.type==='assistant.message_delta').map(value=>value.params.event.data.deltaContent);
 assert.equal(deltas.join(''),'Native protocol fixture','Native streaming deltas match the final message');
 for(const method of ['session.abort','session.destroy','session.delete'])assert.equal((await cli.request(method,{sessionId:textSession})).success,true);
 const toolSession=randomUUID(),tools=[{name:'workbench_probe',description:'Protocol-only declaration. No tool handler exists.',parameters:{type:'object',properties:{}},skipPermission:true}];
 assert.equal((await cli.request('session.create',sessionOptions(f,toolSession,tools))).sessionId,toolSession);
 await cli.request('session.options.update',{sessionId:toolSession,...restrictedOptions});
 assert.equal(typeof (await cli.request('session.send',{sessionId:toolSession,prompt:'Protocol fixture only'})).messageId,'string');
 const external=await cli.event(toolSession,'external_tool.requested');
 const toolMessage=await cli.event(toolSession,'assistant.message');
 assert.deepEqual(toolMessage.data.toolRequests,[{toolCallId:'native-fixture-call',name:'workbench_probe',arguments:{},type:'function'}]);
 const started=await cli.event(toolSession,'tool.execution_start');
 assert.equal(started.data.toolCallId,'native-fixture-call');assert.equal(started.data.toolName,'workbench_probe');assert.deepEqual(started.data.arguments,{});assert.equal(started.data.mcpServerName,undefined);
 assert.equal(external.data.toolCallId,'native-fixture-call');assert.equal(external.data.toolName,'workbench_probe');assert.deepEqual(external.data.arguments,{});
 assert.equal(cli.notifications.some(value=>value.method==='session.event'&&value.params?.sessionId===toolSession&&value.params.event?.type==='tool.execution_complete'),false,'No handler executed the advertised tool');
 for(const method of ['session.abort','session.destroy','session.delete'])assert.equal((await cli.request(method,{sessionId:toolSession})).success,true);
 assert.equal(cli.child.pid,pid);assert.equal(cli.child.exitCode,null);assert.equal(cli.methods.filter(method=>method==='connect').length,1);
 await cli.finish();assert.deepEqual(f.providerErrors,[]);assert.deepEqual(f.inferenceRequests,['POST /v1/chat/completions','POST /v1/chat/completions']);
});
