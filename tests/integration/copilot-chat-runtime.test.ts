import test from 'node:test';
import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createCopilotRuntime} from '../../src/adapters/runtime/copilot-chat.ts';
import {defaultChatSettings} from '../../src/adapters/runtime/chat-settings.ts';
import {copilotChatPeer,type CopilotPeerOptions} from '../helpers/copilot-chat-peer.ts';

const signal=()=>new AbortController().signal;
const tool={name:'workbench_list_repositories',namespace:'mcp__workbench',description:'Read repositories',parameters:{type:'object',properties:{}}};
async function fixture(t:TestContext,peerOptions:CopilotPeerOptions={},runtimeOptions:Parameters<typeof createCopilotRuntime>[1]={}){
 const directory=await mkdtemp(path.join(tmpdir(),'bdd-copilot-runtime-')),peer=await copilotChatPeer(directory,peerOptions),runtime=createCopilotRuntime(directory,runtimeOptions);
 const settings={...defaultChatSettings(),...peer,timeoutMs:5000};
 t.after(async()=>{try{await runtime.close();}finally{await rm(directory,{recursive:true,force:true});}});
 const trace=async()=>{try{return (await readFile(peer.tracePath,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}};
 const waitFor=async(predicate:(events:any[])=>boolean)=>{const deadline=Date.now()+3000;while(!predicate(await trace())){if(Date.now()>deadline)assert.fail('Copilot peer did not reach the required event');await new Promise(resolve=>setTimeout(resolve,5));}};
 return {runtime,settings,trace,waitFor,directory};
}

test('Copilot reuses one server for models and turns while keeping each full history isolated',async t=>{
 const f=await fixture(t),deltas:string[]=[];
 assert.deepEqual(await f.runtime.models(f.settings,signal()),[{id:'fixture-model',name:'Protocol fixture model',selectable:true}]);
 const first=await f.runtime.completion({...f.settings,model:'one'},'first complete history [[echo]]',signal(),[],delta=>deltas.push(delta));
 const second=await f.runtime.completion({...f.settings,model:'two'},'second complete history [[echo]]',signal(),[]);
 assert.equal(first.text,'first complete history [[echo]]');assert.equal(deltas.join(''),first.text);assert.equal(second.text,'second complete history [[echo]]');
 const trace=await f.trace(),created=trace.filter(event=>event.method==='session.create');
 assert.equal(trace.filter(event=>event.type==='spawn').length,1);assert.equal(trace.filter(event=>event.method==='connect').length,1);
 assert.deepEqual(created.map(event=>event.params.model),['one','two']);assert.equal(new Set(created.map(event=>event.params.sessionId)).size,2);
 assert.equal(trace.filter(event=>event.method==='session.send').length,2);assert.equal(trace.filter(event=>event.method==='session.destroy').length,2);assert.equal(trace.filter(event=>event.method==='session.delete').length,2);
 for(const event of created){assert.deepEqual(event.params.availableTools,[]);assert.deepEqual(event.params.mcpServers,{});assert.deepEqual(event.params.infiniteSessions,{enabled:false});assert.equal(event.params.configDir,undefined,'Existing CLI login/config sources must remain available');}
});

test('concurrent room responses and cancellation stay scoped to their ephemeral sessions',async t=>{
 const f=await fixture(t,{delayMs:15}),controller=new AbortController();
 const pending=f.runtime.completion(f.settings,'room A [[hang]]',controller.signal,[]),cancelled=assert.rejects(pending,/取消或逾時/);
 await f.waitFor(trace=>trace.some(event=>event.method==='session.send'));
 const [second,third]=await Promise.all(['room B [[echo]]','room C [[echo]]'].map(prompt=>f.runtime.completion(f.settings,prompt,signal(),[])));
 assert.equal(second.text,'room B [[echo]]');assert.equal(third.text,'room C [[echo]]');controller.abort();await cancelled;
 assert.equal((await f.runtime.completion(f.settings,'room D [[echo]]',signal(),[])).text,'room D [[echo]]');
 const trace=await f.trace();assert.equal(trace.filter(event=>event.type==='spawn').length,1);assert.equal(trace.filter(event=>event.method==='session.delete').length,4);
});

test('inference timeout aborts and deletes its session without killing a healthy shared server',async t=>{
 const f=await fixture(t);
 await f.runtime.models(f.settings,signal());
 await assert.rejects(f.runtime.completion({...f.settings,timeoutMs:40},'[[hang]]',signal(),[]),/取消或逾時/);
 assert.equal((await f.runtime.completion(f.settings,'next',signal(),[])).text,'Protocol peer text response');
 const trace=await f.trace();assert.equal(trace.filter(event=>event.type==='spawn').length,1);assert.equal(trace.filter(event=>event.method==='session.abort').length,2);
});

test('already cancelled requests never spawn a Copilot process',async t=>{
 const f=await fixture(t),controller=new AbortController();controller.abort();
 await assert.rejects(f.runtime.completion(f.settings,'never start',controller.signal,[]),/取消或逾時/);
 await assert.rejects(f.runtime.models(f.settings,controller.signal),/取消或逾時/);assert.deepEqual(await f.trace(),[]);
});

test('close interrupts sessions and model queries and is idempotent',async t=>{
 const f=await fixture(t,{hangMethods:['models.list']});
 const completion=f.runtime.completion(f.settings,'[[hang]]',signal(),[]),models=f.runtime.models(f.settings,signal());
 const rejected=Promise.all([assert.rejects(completion,/已關閉|取消或逾時|已結束/),assert.rejects(models,/已關閉|取消或逾時|已結束/)]);
 await f.waitFor(trace=>trace.some(event=>event.method==='session.send')&&trace.some(event=>event.method==='models.list'));
 await Promise.all([f.runtime.close(),f.runtime.close()]);await rejected;
 await assert.rejects(f.runtime.completion(f.settings,'closed',signal(),[]),/已關閉/);await assert.rejects(f.runtime.models(f.settings,signal()),/已關閉/);
 const pid=(await f.trace()).find(event=>event.type==='spawn').pid;assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
});

test('a dead server fails current rooms promptly and the next request gets a fresh server',async t=>{
 const f=await fixture(t);
 const hanging=f.runtime.completion(f.settings,'[[hang]]',signal(),[]),failed=assert.rejects(hanging,/已結束/);
 await f.waitFor(trace=>trace.some(event=>event.method==='session.send'));
 await assert.rejects(f.runtime.completion(f.settings,'[[crash]]',signal(),[]),/已結束/);await failed;
 assert.equal((await f.runtime.completion(f.settings,'recovered',signal(),[])).text,'Protocol peer text response');
 assert.equal((await f.trace()).filter(event=>event.type==='spawn').length,2);
});

test('malformed server framing fails the connection and recovers on the next request',async t=>{
 const f=await fixture(t);
 await assert.rejects(f.runtime.completion(f.settings,'[[invalid-rpc]]',signal(),[]),/JSON|property name|Unexpected/i);
 await f.runtime.models(f.settings,signal());assert.equal((await f.trace()).filter(event=>event.type==='spawn').length,2);
});

test('a parent exit rejects inference even when its descendant holds stdout open',{skip:process.platform==='win32',timeout:8000},async t=>{
 const f=await fixture(t),before=Date.now();
 await assert.rejects(f.runtime.completion({...f.settings,timeoutMs:120000},'[[orphan-exit]]',signal(),[]),/已結束/);
 assert(Date.now()-before<2000,'Parent exit must fail before waiting for inherited stdio or the inference timeout');
 await f.runtime.close();
 const descendant=(await f.trace()).find(event=>event.type==='descendant');assert(descendant);assert.throws(()=>process.kill(descendant.childPid,0),{code:'ESRCH'});
});

test('idle servers are reaped and lazily recreated',async t=>{
 const f=await fixture(t,{}, {idleMs:30});
 await f.runtime.models(f.settings,signal());const pid=(await f.trace()).find(event=>event.type==='spawn').pid;
 const deadline=Date.now()+2000;while(true){try{process.kill(pid,0);}catch(error){assert.equal((error as NodeJS.ErrnoException).code,'ESRCH');break;}if(Date.now()>deadline)assert.fail('Idle Copilot process was not reaped');await new Promise(resolve=>setTimeout(resolve,5));}
 await f.runtime.models(f.settings,signal());assert.equal((await f.trace()).filter(event=>event.type==='spawn').length,2);
});

test('a hung cleanup RPC retires the server within the cleanup deadline',async t=>{
 const f=await fixture(t,{hangMethods:['session.abort']},{cleanupTimeoutMs:35});
 const before=Date.now();await assert.rejects(f.runtime.completion(f.settings,'reply then cleanup',signal(),[]),/session.abort.*取消或逾時/);assert(Date.now()-before<2000);
 await f.runtime.models(f.settings,signal());assert.equal((await f.trace()).filter(event=>event.type==='spawn').length,2);
});

test('a callback failure cancels only that session and preserves the original error',async t=>{
 const f=await fixture(t),sentinel=Error('consumer disconnected');
 await assert.rejects(f.runtime.completion(f.settings,'callback failure',signal(),[],()=>{throw sentinel;}),error=>error===sentinel);
 await f.runtime.completion(f.settings,'next',signal(),[]);
 const trace=await f.trace();assert.equal(trace.filter(event=>event.type==='spawn').length,1);assert.equal(trace.filter(event=>event.method==='session.delete').length,2);
});

for(const [marker,error] of [['mismatch',/不一致/],['empty',/未完成/],['error',/fixture failure/],['tool-executed',/不得執行/],['invalid-tool-type',/未授權/]] as const)test('invalid completion fails closed: '+marker,async t=>{
 const f=await fixture(t);
 await assert.rejects(f.runtime.completion(f.settings,`[[${marker}]]`,signal(),[tool]),error);
 await f.runtime.completion(f.settings,'next healthy turn',signal(),[]);assert.equal((await f.trace()).filter(event=>event.type==='spawn').length,1);
});

test('server permission callbacks receive a method-denied error, never an approval or tool result',async t=>{
 const f=await fixture(t);
 await assert.rejects(f.runtime.completion(f.settings,'[[rpc-permission]]',signal(),[tool]),/不得執行/);
 const response=(await f.trace()).find(event=>event.type==='client-response');assert.equal(response.error.code,-32601);assert.equal(response.result,undefined);
 await f.runtime.models(f.settings,signal());assert.equal((await f.trace()).filter(event=>event.type==='spawn').length,1);
});

test('a request snapshots model, executable arguments and tool declarations before asynchronous startup',async t=>{
 const f=await fixture(t,{methodDelayMs:{connect:40}}),settings={...f.settings,copilotArgs:[...f.settings.copilotArgs],model:'original'},tools=[structuredClone(tool)];
 const pending=f.runtime.completion(settings,'[[tool]]',signal(),tools);settings.model='mutated';settings.copilotArgs.push('must-not-reach-child');tools[0].name='workbench_mutated';
 const answer=await pending;assert.equal(answer.calls[0].mcpToolName,tool.name);
 const trace=await f.trace();assert.equal(trace.find(event=>event.method==='session.create').params.model,'original');assert(!trace.find(event=>event.type==='spawn').args.includes('must-not-reach-child'));
});

test('late replies from a cancelled RPC do not poison the server or another session',async t=>{
 const f=await fixture(t,{methodDelayMs:{'session.create':80}});await f.runtime.models(f.settings,signal());
 await assert.rejects(f.runtime.completion({...f.settings,timeoutMs:25},'cancel creating',signal(),[]),/取消或逾時/);
 assert.equal((await f.runtime.completion(f.settings,'next turn',signal(),[])).text,'Protocol peer text response');
 assert.equal((await f.trace()).filter(event=>event.type==='spawn').length,1);
});

test('startup timeout is bounded and an incompatible protocol fails before creating sessions',async t=>{
 const hanging=await fixture(t,{hangMethods:['connect']},{startupTimeoutMs:35});
 await assert.rejects(hanging.runtime.models(hanging.settings,signal()),/connect.*取消或逾時/);
 const incompatible=await fixture(t,{protocolVersion:99});
 await assert.rejects(incompatible.runtime.completion(incompatible.settings,'never infer',signal(),[]),/版本不相容/);
 assert(!(await incompatible.trace()).some(event=>event.method==='session.create'));
});

test('logged-out completion fails before creating a session',async t=>{
 const f=await fixture(t,{authenticated:false});await assert.rejects(f.runtime.completion(f.settings,'never infer',signal(),[]),/尚未登入/);
 assert(!(await f.trace()).some(event=>event.method==='session.create'));
});
