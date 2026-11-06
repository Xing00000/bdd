import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {toolkitRoot} from './helpers.mjs';
import {createWorkstation} from '../../packages/workstation/service.mjs';
import {sdkShutdownGraceMs,sdkWorkerShutdownGraceMs,sdkServiceShutdownGraceMs} from '../../packages/workstation/agent-lifecycle.mjs';
import {chatLimits} from '../../dist/src/domain/chat.js';

const pause=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
function alive(pid){try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}}

// The real SDK, worker, PTY host, Responses bridge and ACP process supervisor
// run here. Only model executables are controlled peers; no inference is claimed.
async function shutdownFixture(t,timeoutMs) {
  const base=await mkdtemp(path.join(os.tmpdir(),'sdk-shutdown-'));
  const f={base,home:path.join(base,'home'),remote:'https://github.com/example/sdk-shutdown.git'},traceFile=path.join(f.base,'acp-process.jsonl');
  const copilot=path.join(f.base,'stubborn-acp.mjs'),codex=path.join(f.base,'sdk-provider-client.mjs');
  await writeFile(copilot,`import{appendFileSync}from'node:fs';import{createInterface}from'node:readline';
const trace=event=>appendFileSync(${JSON.stringify(traceFile)},JSON.stringify({event,pid:process.pid})+'\\n');
process.on('SIGTERM',()=>trace('ignored-term'));setInterval(()=>{},1000);trace('started');
const send=(id,result)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\\n');let prompt;
createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line);
 if(q.method==='initialize')send(q.id,{protocolVersion:1,agentCapabilities:{mcpCapabilities:{http:true},sessionCapabilities:{close:{}}}});
 else if(q.method==='session/new')send(q.id,{sessionId:'stubborn-session'});
 else if(q.method==='session/prompt'){prompt=q;trace('inferencing');}
 else if(q.method==='session/cancel'&&prompt){send(prompt.id,{stopReason:'cancelled'});prompt=null;}
 else if(q.method==='session/close')send(q.id,{});
});\n`);
  await writeFile(codex,`#!${process.execPath}
for await(const chunk of process.stdin){}
console.log(JSON.stringify({type:'thread.started',thread_id:'controlled-sdk-thread'}));
const prefix='model_providers.workstation_copilot.base_url=',setting=process.argv.find(arg=>arg.startsWith(prefix));
const url=JSON.parse(setting.slice(prefix.length));
try{const response=await fetch(url+'/responses',{method:'POST',headers:{authorization:'Bearer '+process.env.WB_CODEX_PROVIDER_TOKEN,'content-type':'application/json'},body:JSON.stringify({model:'auto',input:[{type:'message',role:'user',content:[{type:'input_text',text:'Wait until cancelled'}]}],tools:[],stream:true})});if(!response.ok)throw Error(await response.text());for await(const chunk of response.body){}process.exit(3);}catch(error){process.stderr.write(error.message+'\\n');process.exit(2);}\n`,{mode:0o755});
  const service=await createWorkstation({home:f.home,toolkitRoot,allowLocal:true,autoAcquire:false,enableExecution:true});
  const ownedPids=new Set();
  const trace=async()=>{try{const events=(await readFile(traceFile,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));for(const event of events)ownedPids.add(event.pid);return events;}catch(error){if(error.code==='ENOENT')return [];throw error;}};
  t.after(async()=>{
    try{await service.close();}finally{
      await trace();for(const pid of ownedPids)if(alive(pid))try{process.kill(-pid,'SIGKILL');}catch{}
      await rm(base,{recursive:true,force:true});
    }
  });
  service.register({id:'SPEC-cleanup',title:'SDK cleanup',remoteUrl:f.remote});
  let sequence=0;
  const start=(operation,input)=>{const operationId=`OP-cleanup-${++sequence}`;service.enqueue({schemaVersion:1,operationId,repositoryId:'SPEC-cleanup',operation,input});return operationId;};
  const configured=await service.wait(start('repository.setup',{reviewer:'Human',projects:[],agent:{runtime:'codex-sdk',model:'auto',timeoutMs}}));
  assert.equal(configured.status,'SUCCEEDED',JSON.stringify(configured.error));
  const db=new DatabaseSync(path.join(f.home,'metadata.sqlite'));
  db.exec('CREATE TABLE IF NOT EXISTS chat_settings(id INTEGER PRIMARY KEY,value_json TEXT NOT NULL)');
  db.prepare('INSERT INTO chat_settings VALUES(1,?)').run(JSON.stringify({codexExecutable:codex,copilotExecutable:process.execPath,copilotArgs:[copilot],model:'auto',timeoutMs:15000}));db.close();
  const source={editorKey:'new-cleanup',description:'Feature 名稱為清理測試，取消時結束所有程序。',previousGherkin:''};
  const input={...source,...await service.agentPreview('SPEC-cleanup',{purpose:'gherkin',...source})};
  const operationId=start('workflow.gherkin.generate',input);
  const deadline=Date.now()+6000;
  while(!(await trace()).some(event=>event.event==='inferencing')) {
    assert.ok(Date.now()<deadline,'The controlled ACP inference did not start');
    const operation=service.operation(operationId);assert.ok(['QUEUED','RUNNING'].includes(operation.status),JSON.stringify(operation.error));
    await pause(20);
  }
  return {...f,service,operationId,trace};
}

test('SDK timeout lets production ACP escalation reap an agent that ignores SIGTERM',{timeout:18000},async t=>{
  assert.ok(sdkShutdownGraceMs>chatLimits.shutdownGraceMs*2,'The SDK host must outlive both ACP termination and post-kill observation');
  assert.ok(sdkWorkerShutdownGraceMs>sdkShutdownGraceMs);assert.ok(sdkServiceShutdownGraceMs>sdkWorkerShutdownGraceMs);
  const f=await shutdownFixture(t,1800);
  const operation=await f.service.wait(f.operationId,12000);
  assert.equal(operation.status,'FAILED');
  assert.equal((await f.service.terminal(f.operationId)).latestExit.timedOut,true);
  const events=await f.trace();assert.ok(events.some(event=>event.event==='ignored-term'));
  for(const pid of new Set(events.map(event=>event.pid)))assert.equal(alive(pid),false,'The detached ACP process must be gone before parent completion');
});

test('user cancellation keeps SDK host and worker alive until a stubborn ACP process is reaped',{timeout:18000},async t=>{
  const f=await shutdownFixture(t,15000);
  f.service.cancel(f.operationId);
  const operation=await f.service.wait(f.operationId,12000);
  assert.equal(operation.status,'CANCELLED');
  const events=await f.trace();assert.ok(events.some(event=>event.event==='ignored-term'));
  for(const pid of new Set(events.map(event=>event.pid)))assert.equal(alive(pid),false,'User cancellation must not orphan the ACP process');
});
