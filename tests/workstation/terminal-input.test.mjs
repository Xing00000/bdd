import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createWorkstation} from '../../packages/workstation/service.mjs';
import {openStore} from '../../packages/workstation/store.mjs';
import {runPty} from '../../packages/workstation/development.mjs';
import {saveProgressPhase,readProgress} from '../../packages/git-core/progress-store.mjs';
import {withProgress} from '../../packages/git-core/progress.mjs';
import {validateAgentSettings} from '../../packages/workstation/agent-settings.mjs';

// This transport fixture owns no agent process. It observes real service input
// validation, SQLite history and the IPC boundary independently of inference.
async function runningService(t,runtime='codex-sdk') {
  const home=await mkdtemp(path.join(os.tmpdir(),'terminal-input-'));
  const messages=[],child=Object.assign(new EventEmitter(),{connected:true,exitCode:null,signalCode:null,stderr:new EventEmitter(),send(message,callback){messages.push(message);callback?.(null);}});
  const spawn=t.mock.method(childProcess,'spawn',()=>child);syncBuiltinESMExports();
  let service,store;
  t.after(async()=>{
    child.exitCode=0;child.connected=false;child.emit('close');
    await service?.close();store?.close();spawn.mock.restore();syncBuiltinESMExports();
    await rm(home,{recursive:true,force:true});
  });
  service=await createWorkstation({home});
  service.register({id:'SPEC-input',title:'Input',remoteUrl:'https://github.com/example/input.git'});
  service.enqueue({schemaVersion:1,operationId:'OP-parent',repositoryId:'SPEC-input',operation:'workflow.gherkin.generate',input:{}});
  store=openStore(home);store.claim('OP-parent');
  saveProgressPhase(home,'OP-parent',{phase:'RUNNING',runtime});
  return {home,service,store,messages};
}

test('SDK submission persists one exact multiline message and sends only its interaction ID',async t=>{
  const f=await runningService(t);
  const message='  第一行\r\n第二行\n字元\b\x7f\x03\x00保留\n結尾  ';
  const receipt=f.service.terminalInput('OP-parent',{message});
  assert.equal(receipt.sent,true);assert.equal(receipt.interactions.length,1);
  const interaction=receipt.interactions[0];
  assert.equal(interaction.request.input.message,message);
  assert.equal(interaction.request.input.parentOperationId,'OP-parent');
  assert.equal(interaction.status,'RUNNING');assert.equal(interaction.result,null);
  assert.deepEqual(f.messages,[{type:'development.input',interactionId:interaction.id}]);
  assert.equal(f.service.interaction(interaction.id).message,message);
  assert.equal(f.service.interactions('SPEC-input').entries.length,2);
  // An IPC write is not evidence that the SDK consumed or completed a turn.
  f.store.finish('OP-parent','SUCCEEDED',{});
  assert.equal(f.service.operation(interaction.id).status,'FAILED');
  assert.equal(f.service.operation(interaction.id).result.reason,'NOT_DELIVERED');
});

test('structured SDK messages reject wrong runtime, raw keystrokes, invalid payloads and completed turns',async t=>{
  const f=await runningService(t,'custom-cli');
  assert.throws(()=>f.service.terminalInput('OP-parent',{message:'Hello'}),{code:'TERMINAL_RUNTIME_MISMATCH'});
  saveProgressPhase(f.home,'OP-parent',{phase:'RUNNING',runtime:'codex-sdk'});
  assert.throws(()=>f.service.terminalInput('OP-parent',{data:'Hello\r'}),{code:'INVALID_TERMINAL_INPUT'});
  for(const input of [{message:''},{message:'\r\n  '},{message:'Hello',data:'ignored'},{message:'x'.repeat(65537)},{message:12},null]) {
    assert.throws(()=>f.service.terminalInput('OP-parent',input),{code:'INVALID_TERMINAL_INPUT'});
  }
  for(const phase of ['STARTING','CHECKING']) {
    saveProgressPhase(f.home,'OP-parent',{phase,runtime:'codex-sdk'});
    assert.throws(()=>f.service.terminalInput('OP-parent',{message:'Hello'}),{code:'TERMINAL_UNAVAILABLE'});
  }
  assert.equal(f.messages.length,0);assert.equal(f.service.interactions('SPEC-input').entries.length,1);
});

test('historical CLI operations stay readable but accept neither messages nor raw terminal input',async t=>{
  const f=await runningService(t,'custom-cli');
  for(const input of [{message:'Hello'},{data:'abc\bD\r\n'},{cols:120,rows:40}])assert.throws(()=>f.service.terminalInput('OP-parent',input),{code:'TERMINAL_RUNTIME_MISMATCH'});
  assert.equal((await f.service.terminal('OP-parent')).status,'RUNNING');assert.equal(f.messages.length,0);
  saveProgressPhase(f.home,'OP-parent',{phase:'RUNNING',runtime:'codex-sdk'});
  assert.throws(()=>f.service.terminalInput('OP-parent',{cols:120,rows:40}),{code:'INVALID_TERMINAL_INPUT'});
  assert.equal(f.messages.length,0);
});

test('the queue refuses a frozen CLI contract and stale SDK selections before creating an operation',async t=>{
  const f=await runningService(t);f.store.ensureAgentDefaults('SPEC-input',validateAgentSettings());
  const selection=f.store.agentDefaults('SPEC-input').find(item=>item.purpose==='gherkin');
  const current=f.store.resolveAgent('SPEC-input','gherkin',selection);
  const submit=agentSnapshot=>f.service.enqueue({schemaVersion:1,operationId:'OP-rejected',repositoryId:'SPEC-input',operation:'workflow.gherkin.generate',input:{agentSelection:selection,agentSnapshot}});
  for(const settings of [{runtime:'custom-cli',command:'old-cli',args:['{task}']},{command:'old-cli',args:['{task}']}]) {
    assert.throws(()=>submit({...current,settings}),{code:'AGENT_PREVIEW_REQUIRED'});
  }
  assert.throws(()=>submit({...current,digest:'stale-sdk-preview'}),{code:'AGENT_PREVIEW_REQUIRED'});
  assert.throws(()=>f.service.operation('OP-rejected'),{code:'OPERATION_NOT_FOUND'});
});

test('SDK PTY input encoding accepts ID packets and acknowledges only actual writes',async t=>{
  const home=await mkdtemp(path.join(os.tmpdir(),'pty-encoded-input-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const writes=[],sizes=[],delivered=[];let finish;
  const pty={spawn(){return {pid:987654321,write:data=>writes.push(data),resize:(cols,rows)=>sizes.push([cols,rows]),onData(){},onExit(callback){finish=callback;}};}};
  const content='多行\r\n第二行\b\x03',packet=JSON.stringify({type:'workstation.sdk.input',interactionId:'OP-message',message:content})+'\n';
  await withProgress(home,'OP-parent',async()=>{
    const pending=runPty(pty,'sdk-host',[],home,{timeoutMs:2000,log(){},routeInputs:false,
      encodeInput:message=>message.interactionId==='OP-message'?packet:null,
      onInputDelivered:interactionId=>delivered.push(interactionId)});
    process.emit('message',{type:'development.input',interactionId:'OP-message'});
    process.emit('message',{type:'development.input',interactionId:'OP-no-write',data:'ignored'});
    process.emit('message',{type:'development.input',data:'unframed data'});
    process.emit('message',{type:'development.input',cols:110,rows:35});
    finish({exitCode:0,signal:null});await pending;
  });
  assert.deepEqual(writes,[packet]);assert.deepEqual(delivered,['OP-message']);assert.deepEqual(sizes,[[110,35]]);
  assert.equal(JSON.parse(writes[0]).message,content);
  assert.equal(readProgress(home,'OP-message'),null,'writing an SDK packet must not route output or assert turn consumption');
});
