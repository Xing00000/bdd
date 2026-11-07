import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile, readFile, appendFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { Codex } from '@openai/codex-sdk';
import { fixture, toolkitRoot } from './helpers.mjs';
import { openStore } from '../../packages/workstation/store.mjs';
import { withProgress, currentProgress } from '../../packages/git-core/progress.mjs';
import { readProgress } from '../../packages/git-core/progress-store.mjs';
import { writeJson, readJson, digest } from '../../packages/contracts/index.mjs';
import { freezeCodexTransport, runCodexSdkSession, runCodexSdkAgent } from '../../packages/workstation/codex-sdk-agent.mjs';

/** The actual SDK drives a controlled executable: protocol evidence, not a model/E2E claim. */
async function sdkFixture(t,mode='complete') {
  const f=await fixture(t),directory=path.join(f.base,'job'),cwd=path.join(f.base,'workspace');
  await mkdir(directory);await mkdir(cwd);await mkdir(f.home);
  const capture=path.join(f.base,'sdk-calls.jsonl'),executable=path.join(f.base,'controlled-codex.mjs');
  await writeFile(executable,`#!${process.execPath}\nimport{appendFileSync}from'node:fs';\nlet prompt='';for await(const data of process.stdin)prompt+=data;\nconst args=process.argv.slice(2);appendFileSync(${JSON.stringify(capture)},JSON.stringify({args,prompt,env:{token:process.env.WB_CODEX_PROVIDER_TOKEN,apiKey:process.env.CODEX_API_KEY,secret:process.env.TEST_SERVICE_SECRET,originator:process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE,home:process.env.CODEX_HOME}})+'\\n');\nconst emit=value=>console.log(JSON.stringify(value));emit({type:'thread.started',thread_id:'thread-sdk-fixture'});\nif(${JSON.stringify(mode)}==='hang'){setInterval(()=>{},1000);}else if(${JSON.stringify(mode)}==='native-error'){process.stderr.write('native fixture diagnostic\\n');process.exitCode=7;}else{emit({type:'item.completed',item:{id:'message',type:'agent_message',text:'Controlled SDK response'}});if(${JSON.stringify(mode)}==='failed')emit({type:'turn.failed',error:{message:'structured turn failure'}});else if(${JSON.stringify(mode)}!=='incomplete')emit({type:'turn.completed',usage:{input_tokens:1,cached_input_tokens:0,output_tokens:1,reasoning_output_tokens:0}});}\n`,{mode:0o755});
  // A terminal event can precede process exit. Closing the SDK iterator then
  // aborting its old spawn signal used to raise an uncaught native AbortError.
  if(mode==='failed')await appendFile(executable,'\nsetTimeout(()=>{},75);\n');
  const settings={codexExecutable:executable,copilotExecutable:'not-invoked-by-controlled-peer',copilotArgs:[],model:'fixture-model',timeoutMs:5000};
  const task=path.join(directory,'task.json'),transportFile=path.join(directory,'transport.json');
  await writeJson(task,{task:{purpose:'development',workspace:cwd,writable:[cwd]},artifacts:{}});
  await writeJson(transportFile,{schemaVersion:1,operationId:'OP-sdk',repositoryId:'SPEC-sdk',settings});
  const job={schemaVersion:1,operationId:'OP-sdk',repositoryId:'SPEC-sdk',directory,cwd,task,transportFile,prompt:'  Approved user prompt\nKeep this exact text.  '};
  const lifecycle={activations:0,deactivations:0,registrationClosed:false,providerClosed:false,modes:[]};
  const createProvider=async(directory,mode)=>{
    lifecycle.modes.push(mode);assert.equal(directory,cwd);
    return {url:'http://127.0.0.1:1',register(value){assert.deepEqual(value,settings);return {token:'local-fixture-token',activate(signal){assert.equal(signal.aborted,false);lifecycle.activations++;},deactivate(){lifecycle.deactivations++;},close(){lifecycle.registrationClosed=true;}};},async close(){lifecycle.providerClosed=true;}};
  };
  const calls=async()=>{try{return(await readFile(capture,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch(error){if(error.code==='ENOENT')return[];throw error;}};
  return {...f,directory,cwd,settings,job,createProvider,lifecycle,calls};
}

test('the official SDK owns thread streaming, MCP config and sandboxed execution with the exact approved prompt',async t=>{
  const f=await sdkFixture(t),input=new PassThrough(),events=[];
  const previous=process.env.TEST_SERVICE_SECRET;process.env.TEST_SERVICE_SECRET='must-not-reach-codex';t.after(()=>{if(previous===undefined)delete process.env.TEST_SERVICE_SECRET;else process.env.TEST_SERVICE_SECRET=previous;});
  const session=await runCodexSdkSession(f.job,{Codex,createProvider:f.createProvider,input,output:line=>events.push(JSON.parse(line))});
  assert.equal(session.status,'COMPLETED');assert.equal(session.threadId,'thread-sdk-fixture');assert.equal(session.turns.length,1);
  const [call]=await f.calls();assert.equal(call.prompt,f.job.prompt);assert.equal(call.env.originator,'codex_sdk_ts');assert.equal(call.env.token,'local-fixture-token');assert.equal(call.env.secret,undefined);assert.equal(call.env.apiKey,undefined);
  assert.deepEqual(call.args.slice(0,2),['exec','--experimental-json']);assert.ok(call.args.includes('--skip-git-repo-check'));
  assert.equal(call.args[call.args.indexOf('--sandbox')+1],'workspace-write');assert.ok(call.args.includes('approval_policy="never"'));assert.ok(call.args.includes('web_search="disabled"'));
  assert.ok(call.args.includes('model_provider="workstation_copilot"'));assert.ok(call.args.some(arg=>arg.startsWith('mcp_servers.workbench_task.args=')&&arg.includes('mcp-agent-task.mjs')));
  assert.ok(call.args.some(arg=>arg.startsWith('mcp_servers.agent_supervisor.args=')&&arg.includes('mcp-agent-supervisor.mjs')));
  assert.ok(call.args.some(arg=>arg.startsWith('developer_instructions=')&&arg.includes('Do not invoke Git')));
  assert.ok(!call.args.some(arg=>/danger-full-access|bypass/.test(arg)));
  assert.ok(events.some(event=>event.type==='item.completed'&&event.item.text==='Controlled SDK response'));
  assert.deepEqual(f.lifecycle,{activations:1,deactivations:1,registrationClosed:true,providerClosed:true,modes:['codex']});
  assert.equal((await readJson(path.join(f.directory,'sdk-session.json'))).threadId,session.threadId);
});

test('SDK input frames preserve IDs, multiline, CRLF and backspace content and queue subsequent official SDK turns',async t=>{
  const f=await sdkFixture(t),input=new PassThrough();let sent=false;
  const messages=[{interactionId:'OP-lines',message:'first line\nsecond line'},{interactionId:'OP-crlf',message:'first\r\nsecond'},{interactionId:'OP-empty',message:''},{interactionId:'OP-backspace',message:'literal\bbackspace'},{interactionId:'OP-last',message:'last input'}];
  const session=await runCodexSdkSession(f.job,{Codex,createProvider:f.createProvider,input,output:line=>{
    const event=JSON.parse(line);
    if(event.type==='workstation.turn.started'&&!sent){sent=true;for(const [index,message] of messages.entries()){const frame=JSON.stringify({type:'workstation.sdk.input',...message})+(index%2?'\r\n':'\n');input.write(frame.slice(0,19));input.write(frame.slice(19));}input.write(JSON.stringify({type:'workstation.sdk.input',...messages[0]})+'\n');}
  }});
  assert.deepEqual((await f.calls()).map(call=>call.prompt),[f.job.prompt,...messages.filter(message=>message.message).map(message=>message.message)]);
  const calls=await f.calls();for(const call of calls.slice(1))assert.deepEqual(call.args.slice(call.args.indexOf('resume'),call.args.indexOf('resume')+2),['resume','thread-sdk-fixture']);
  assert.deepEqual(session.inputs.map(item=>[item.interactionId,item.inputDigest,item.status]),messages.map(message=>[message.interactionId,digest(message.message),message.message?'COMPLETED':'EMPTY']));
  assert.equal(session.turns.length,5);assert.equal(f.lifecycle.activations,5);assert.equal(f.lifecycle.deactivations,5);
});

test('zero exit without turn.completed and structured/native failures cannot become an SDK success',async t=>{
  for(const [mode,message] of [['incomplete','完整回合證明'],['failed','structured turn failure'],['native-error','native fixture diagnostic']])await t.test(mode,async child=>{
    const f=await sdkFixture(child,mode);
    await assert.rejects(runCodexSdkSession(f.job,{Codex,createProvider:f.createProvider,input:new PassThrough(),output(){}}),error=>{assert.ok(error.message.includes(message));return true;});
    const receipt=await readJson(path.join(f.directory,'sdk-session.json'));assert.equal(receipt.status,'FAILED');assert.equal(receipt.turns[0].status,'FAILED');assert.equal(f.lifecycle.providerClosed,true);
  });
});

test('transport settings freeze once for every retry and never modify shared chat settings',async t=>{
  const f=await sdkFixture(t),db=new DatabaseSync(path.join(f.home,'metadata.sqlite'));t.after(()=>db.close());
  db.exec('CREATE TABLE chat_settings(id INTEGER PRIMARY KEY,value_json TEXT NOT NULL)');db.prepare('INSERT INTO chat_settings VALUES(1,?)').run(JSON.stringify(f.settings));
  const context={options:{home:f.home},request:{operationId:'OP-sdk',repositoryId:'SPEC-sdk'}};
  const file=await freezeCodexTransport(context,{model:'task-model'});assert.equal((await readJson(file)).settings.model,'task-model');
  const changed={...f.settings,model:'later-global-model',codexExecutable:'later-executable'};db.prepare('UPDATE chat_settings SET value_json=? WHERE id=1').run(JSON.stringify(changed));
  assert.equal(await freezeCodexTransport(context,{model:'different-retry-model'}),file);assert.equal((await readJson(file)).settings.model,'task-model');assert.equal((await readJson(file)).settings.codexExecutable,f.settings.codexExecutable);
  assert.deepEqual(JSON.parse(db.prepare('SELECT value_json FROM chat_settings').get().value_json),changed);
});

test('SDK cancellation aborts the native child and closes provider activation without claiming a completed turn',async t=>{
  const f=await sdkFixture(t,'hang'),controller=new AbortController();
  const deadline=setTimeout(()=>controller.abort(new Error('cancellation deadline')),5000);t.after(()=>clearTimeout(deadline));
  await assert.rejects(runCodexSdkSession(f.job,{Codex,createProvider:f.createProvider,input:new PassThrough(),signal:controller.signal,output:line=>{
    if(JSON.parse(line).type==='thread.started')controller.abort(new Error('controlled SDK cancellation'));
  }}),/controlled SDK cancellation/);
  const receipt=await readJson(path.join(f.directory,'sdk-session.json'));assert.equal(receipt.status,'FAILED');assert.equal(receipt.turns[0].status,'FAILED');
  assert.equal(f.lifecycle.deactivations,1);assert.equal(f.lifecycle.registrationClosed,true);assert.equal(f.lifecycle.providerClosed,true);
});

async function supervisedContext(t,mode='complete') {
  const f=await sdkFixture(t,mode),store=openStore(f.home);t.after(()=>store.close());
  store.register({id:'SPEC-sdk',title:'SDK protocol fixture',remoteUrl:'/unused'});
  const request={schemaVersion:1,operationId:'OP-sdk',repositoryId:'SPEC-sdk',operation:'workflow.gherkin.generate',input:{}};store.enqueue(request);store.claim(request.operationId);
  const db=new DatabaseSync(path.join(f.home,'metadata.sqlite'));db.exec('CREATE TABLE IF NOT EXISTS chat_settings(id INTEGER PRIMARY KEY,value_json TEXT NOT NULL)');db.prepare('INSERT INTO chat_settings VALUES(1,?)').run(JSON.stringify(f.settings));db.close();
  return {...f,store,context:{options:{home:f.home,toolkitRoot},store,request}};
}
test('the supervised SDK host preserves long multiline frames and acknowledges the actual interaction ID after its turn',async t=>{
  const f=await supervisedContext(t),text='A multiline follow-up\n'+'需求內容'.repeat(2000)+'\nwith a final line',interactionId='OP-followup';let sent=false,log='';
  const pending=withProgress(f.home,'OP-sdk',()=>runCodexSdkAgent(f.context,{agent:{runtime:'codex-sdk',model:'auto',timeoutMs:8000},prompt:f.job.prompt,cwd:f.cwd,task:f.job.task,log:data=>{
    currentProgress().output(data);log+=data;
    if(!sent&&log.includes('workstation.input.ready')){sent=true;assert.equal(readProgress(f.home,'OP-sdk').state.phase,'RUNNING');f.store.enqueue({schemaVersion:1,operationId:interactionId,repositoryId:'SPEC-sdk',operation:'interaction.cli.input',input:{parentOperationId:'OP-sdk',message:text}});f.store.claim(interactionId);process.emit('message',{type:'development.input',interactionId});}
  }}));
  assert.equal(readProgress(f.home,'OP-sdk').state.phase,'STARTING');
  const outcome=await pending;
  assert.equal(outcome.exitCode,0);assert.equal(outcome.threadId,'thread-sdk-fixture');assert.equal(f.store.get(interactionId).status,'SUCCEEDED');assert.equal(f.store.get(interactionId).result.reason,'SDK_TURN_COMPLETED');
  assert.deepEqual((await f.calls()).map(call=>call.prompt),[f.job.prompt,text]);
  assert.equal(log.includes('A multiline follow-up'),false,'the private input frame must not be echoed by the PTY');
});

test('PTY output failure finalizes queued SDK input without falsely acknowledging an unconsumed turn',async t=>{
  const f=await supervisedContext(t,'hang'),interactionId='OP-pending';let sent=false,log='';
  await assert.rejects(withProgress(f.home,'OP-sdk',()=>runCodexSdkAgent(f.context,{agent:{runtime:'codex-sdk',model:'auto',timeoutMs:8000},prompt:f.job.prompt,cwd:f.cwd,task:f.job.task,log:data=>{
    currentProgress().output(data);log+=data;
    if(!sent&&log.includes('workstation.turn.started')){sent=true;f.store.enqueue({schemaVersion:1,operationId:interactionId,repositoryId:'SPEC-sdk',operation:'interaction.cli.input',input:{parentOperationId:'OP-sdk',message:'queued during initial turn'}});f.store.claim(interactionId);process.emit('message',{type:'development.input',interactionId});}
    if(log.includes('"type":"thread.started"'))throw Error('controlled output sink failure');
  }})),{code:'TERMINAL_OUTPUT_LIMIT'});
  const operation=f.store.get(interactionId);assert.equal(operation.status,'FAILED');assert.equal(operation.result.delivery,'not-delivered');assert.equal(operation.error.code,'SDK_INPUT_NOT_DELIVERED');
});
