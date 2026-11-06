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

test('ACP reuses one server for models and turns, with server-issued sessions and per-session model selection',async t=>{
 const f=await fixture(t,{models:[{id:'one',name:'One'},{id:'two',name:'Two'}]}),deltas:string[]=[];
 assert.deepEqual(await f.runtime.models(f.settings,signal()),[{id:'one',name:'One',selectable:true},{id:'two',name:'Two',selectable:true}]);
 const first=await f.runtime.completion({...f.settings,model:'one'},'first complete history [[echo]]',signal(),[],delta=>deltas.push(delta));
 const second=await f.runtime.completion({...f.settings,model:'two'},'second complete history [[echo]]',signal(),[]);
 assert.equal(first.text,'first complete history [[echo]]');assert.equal(deltas.join(''),first.text);assert.equal(second.text,'second complete history [[echo]]');
 const trace=await f.trace(),created=trace.filter(event=>event.method==='session/new');
 assert.equal(trace.filter(event=>event.type==='spawn').length,1);assert.equal(trace.filter(event=>event.method==='initialize').length,1);
 assert.equal(created.length,3);assert.equal(new Set(trace.filter(event=>event.type==='session-created').map(event=>event.sessionId)).size,3);
 assert.equal(trace.filter(event=>event.method==='session/prompt').length,2);assert.equal(trace.filter(event=>event.method==='session/close').length,3);
 assert.deepEqual(trace.filter(event=>event.method==='session/set_config_option').map(event=>event.params.value),['two']);
 assert(!trace.some(event=>['connect','models.list','session.create','session.send','session.delete'].includes(event.method)));
 for(const event of created){assert.deepEqual(event.params.mcpServers,[]);assert.equal(event.params.cwd,f.directory);assert.equal(event.params.sessionId,undefined);}
 const args=trace.find(event=>event.type==='spawn').args;assert(args.includes('--acp'));assert(args.includes('--stdio'));assert(!args.includes('--headless'));
 assert(args.some((arg:string)=>/^--available-tools=bdd_[a-f0-9]{24}\/\*$/.test(arg)),'Only the private proposal MCP namespace is available');
});

test('concurrent room responses and cancellation stay scoped to their ephemeral ACP sessions',async t=>{
 const f=await fixture(t,{delayMs:15}),controller=new AbortController();
 const pending=f.runtime.completion(f.settings,'room A [[hang]]',controller.signal,[]),cancelled=assert.rejects(pending,/取消或逾時/);
 await f.waitFor(trace=>trace.some(event=>event.method==='session/prompt'));
 const [second,third]=await Promise.all(['room B [[echo]]','room C [[echo]]'].map(prompt=>f.runtime.completion(f.settings,prompt,signal(),[])));
 assert.equal(second.text,'room B [[echo]]');assert.equal(third.text,'room C [[echo]]');controller.abort();await cancelled;
 assert.equal((await f.runtime.completion(f.settings,'room D [[echo]]',signal(),[])).text,'room D [[echo]]');
 const trace=await f.trace();assert.equal(trace.filter(event=>event.type==='spawn').length,1);assert.equal(trace.filter(event=>event.method==='session/close').length,4);
 const cancellations=trace.filter(event=>event.method==='session/cancel');assert.equal(cancellations.length,1);assert.equal(cancellations[0].id,undefined,'ACP cancel is a notification, never a request');
});

test('inference timeout cancels the pending prompt and closes its session without killing a healthy server',async t=>{
 const f=await fixture(t);await f.runtime.models(f.settings,signal());
 await assert.rejects(f.runtime.completion({...f.settings,timeoutMs:40},'[[hang]]',signal(),[]),/取消或逾時/);
 assert.equal((await f.runtime.completion(f.settings,'next',signal(),[])).text,'Protocol peer text response');
 const trace=await f.trace();assert.equal(trace.filter(event=>event.type==='spawn').length,1);assert.equal(trace.filter(event=>event.method==='session/cancel').length,1);
});

test('already cancelled requests never spawn a Copilot process',async t=>{
 const f=await fixture(t),controller=new AbortController();controller.abort();
 await assert.rejects(f.runtime.completion(f.settings,'never start',controller.signal,[]),/取消或逾時/);
 await assert.rejects(f.runtime.models(f.settings,controller.signal),/取消或逾時/);assert.deepEqual(await f.trace(),[]);
});

test('close interrupts pending session creation for inference and model discovery and is idempotent',async t=>{
 const f=await fixture(t,{hangMethods:['session/new']});
 const completion=f.runtime.completion(f.settings,'[[hang]]',signal(),[]),models=f.runtime.models(f.settings,signal());
 const rejected=Promise.all([assert.rejects(completion,/已關閉|取消或逾時|已結束/),assert.rejects(models,/已關閉|取消或逾時|已結束/)]);
 await f.waitFor(trace=>trace.filter(event=>event.method==='session/new').length===2);
 await Promise.all([f.runtime.close(),f.runtime.close()]);await rejected;
 await assert.rejects(f.runtime.completion(f.settings,'closed',signal(),[]),/已關閉/);await assert.rejects(f.runtime.models(f.settings,signal()),/已關閉/);
 const pid=(await f.trace()).find(event=>event.type==='spawn').pid;assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
});

test('a dead server fails current rooms promptly and the next request gets a fresh server',async t=>{
 const f=await fixture(t);
 const hanging=f.runtime.completion(f.settings,'[[hang]]',signal(),[]),failed=assert.rejects(hanging,/已結束/);
 await f.waitFor(trace=>trace.some(event=>event.method==='session/prompt'));
 await assert.rejects(f.runtime.completion(f.settings,'[[crash]]',signal(),[]),/已結束/);await failed;
 assert.equal((await f.runtime.completion(f.settings,'recovered',signal(),[])).text,'Protocol peer text response');
 assert.equal((await f.trace()).filter(event=>event.type==='spawn').length,2);
});

for(const marker of ['invalid-rpc','oversized-rpc'])test('malformed ACP framing retires the connection: '+marker,async t=>{
 const f=await fixture(t);
 await assert.rejects(f.runtime.completion(f.settings,`[[${marker}]]`,signal(),[]),/JSON|property name|Unexpected|大小限制/i);
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

test('an ignored cancel retires the server within the cleanup deadline',async t=>{
 const f=await fixture(t,{hangMethods:['session/cancel']},{cleanupTimeoutMs:35});
 await f.runtime.models(f.settings,signal());
 const before=Date.now();await assert.rejects(f.runtime.completion({...f.settings,timeoutMs:40},'[[hang]]',signal(),[]),/取消或逾時/);assert(Date.now()-before<2000);
 await f.runtime.models(f.settings,signal());assert.equal((await f.trace()).filter(event=>event.type==='spawn').length,2);
});

test('a hung session close retires its server rather than leaving an abandoned session',async t=>{
 const f=await fixture(t,{hangMethods:['session/close']},{cleanupTimeoutMs:35});
 await assert.rejects(f.runtime.completion(f.settings,'reply then cleanup',signal(),[]),/session\/close.*取消或逾時/);
 await assert.rejects(f.runtime.models(f.settings,signal()),/session\/close.*取消或逾時/);assert.equal((await f.trace()).filter(event=>event.type==='spawn').length,2);
});

test('a callback failure cancels only that session and preserves the original error',async t=>{
 const f=await fixture(t),sentinel=Error('consumer disconnected');
 await assert.rejects(f.runtime.completion(f.settings,'callback failure',signal(),[],()=>{throw sentinel;}),error=>error===sentinel);
 await f.runtime.completion(f.settings,'next',signal(),[]);
 const trace=await f.trace();assert.equal(trace.filter(event=>event.type==='spawn').length,1);assert.equal(trace.filter(event=>event.method==='session/close').length,2);
});

for(const [marker,error] of [['mismatch',/不一致/],['empty',/未完成/],['error',/fixture failure/],['tool-executed',/不得執行/],['invalid-tool-type',/未授權/],['non-text',/格式錯誤/],['truncated',/未完成/]] as const)test('invalid completion fails closed: '+marker,async t=>{
 const f=await fixture(t);
 await assert.rejects(f.runtime.completion(f.settings,`[[${marker}]]`,signal(),[tool]),error);
 await f.runtime.completion(f.settings,'next healthy turn',signal(),[]);assert.equal((await f.trace()).filter(event=>event.type==='spawn').length,1);
});

for(const marker of ['rpc-permission','fs-request','terminal-request'])test('undeclared ACP client requests are refused: '+marker,async t=>{
 const f=await fixture(t);
 await assert.rejects(f.runtime.completion(f.settings,`[[${marker}]]`,signal(),[tool]),/不得執行/);
 const response=(await f.trace()).find(event=>event.type==='client-response');
 if(marker==='rpc-permission')assert.deepEqual(response.result,{outcome:{outcome:'cancelled'}});
 else{assert.equal(response.error.code,-32601);assert.equal(response.result,undefined);}
 await f.runtime.models(f.settings,signal());assert.equal((await f.trace()).filter(event=>event.type==='spawn').length,1);
});

test('a request snapshots model, executable arguments and tools before asynchronous startup',async t=>{
 const f=await fixture(t,{models:[{id:'default',name:'Default'},{id:'original',name:'Original'}],methodDelayMs:{initialize:40}}),settings={...f.settings,copilotArgs:[...f.settings.copilotArgs],model:'original'},tools=[structuredClone(tool)];
 const pending=f.runtime.completion(settings,'[[tool]]',signal(),tools);settings.model='mutated';settings.copilotArgs.push('must-not-reach-child');tools[0].name='workbench_mutated';
 const answer=await pending;assert.equal(answer.calls[0].mcpToolName,tool.name);
 const trace=await f.trace();assert.equal(trace.find(event=>event.method==='session/set_config_option').params.value,'original');assert(!trace.find(event=>event.type==='spawn').args.includes('must-not-reach-child'));
});

test('a cancelled session/new receives and closes the late session instead of leaking it',async t=>{
 const f=await fixture(t,{methodDelayMs:{'session/new':80}});await f.runtime.models(f.settings,signal());
 await assert.rejects(f.runtime.completion({...f.settings,timeoutMs:25},'cancel creating',signal(),[]),/取消或逾時/);
 assert.equal((await f.runtime.completion(f.settings,'next turn',signal(),[])).text,'Protocol peer text response');
 const trace=await f.trace();assert.equal(trace.filter(event=>event.type==='spawn').length,1);assert.equal(trace.filter(event=>event.method==='session/close').length,3);assert.equal(trace.filter(event=>event.method==='session/prompt').length,1);
});

test('a late permission request from a closed session is cancelled without failing another room',async t=>{
 const f=await fixture(t,{latePermissionMs:15,delayMs:80});
 await f.runtime.completion(f.settings,'first room',signal(),[]);
 assert.equal((await f.runtime.completion(f.settings,'second room [[echo]]',signal(),[])).text,'second room [[echo]]');
 const trace=await f.trace(),late=trace.find(event=>event.type==='client-response'&&event.id?.startsWith('late-'));
 assert(late);assert.deepEqual(late.result,{outcome:{outcome:'cancelled'}});assert.equal(trace.filter(event=>event.type==='spawn').length,1);
});

test('late duplicate session ids cannot close an existing room during cancellation cleanup',async t=>{
 const f=await fixture(t,{reuseSessionId:true,methodDelayMs:{'session/new':60}}),controller=new AbortController();
 const pending=f.runtime.completion(f.settings,'active room [[hang]]',controller.signal,[]),cancelled=assert.rejects(pending,/取消或逾時/);
 await f.waitFor(trace=>trace.some(event=>event.method==='session/prompt'));
 await assert.rejects(f.runtime.models({...f.settings,timeoutMs:10},signal()),/取消或逾時/);
 assert.equal((await f.trace()).filter(event=>event.method==='session/close').length,0,'A duplicate late id is not owned by the cancelled creation');
 controller.abort();await cancelled;
 assert.equal((await f.trace()).filter(event=>event.method==='session/close').length,1);
});

test('startup timeout is bounded and an incompatible protocol fails before creating sessions',async t=>{
 const hanging=await fixture(t,{hangMethods:['initialize']},{startupTimeoutMs:35});
 await assert.rejects(hanging.runtime.models(hanging.settings,signal()),/initialize.*取消或逾時/);
 const incompatible=await fixture(t,{protocolVersion:99});
 await assert.rejects(incompatible.runtime.completion(incompatible.settings,'never infer',signal(),[]),/版本不相容/);
 assert(!(await incompatible.trace()).some(event=>event.method==='session/new'));
});

test('authentication failures are reported by ACP before inference begins',async t=>{
 const f=await fixture(t,{authenticated:false});await assert.rejects(f.runtime.completion(f.settings,'never infer',signal(),[]),/尚未登入/);
 assert(!(await f.trace()).some(event=>event.method==='session/prompt'));
});

test('servers without session close capability drain rather than accumulating private sessions',async t=>{
 const f=await fixture(t,{capabilities:{mcpCapabilities:{http:true}}});
 await f.runtime.completion(f.settings,'first',signal(),[]);await f.runtime.completion(f.settings,'second',signal(),[]);
 const trace=await f.trace();assert.equal(trace.filter(event=>event.type==='spawn').length,2);assert(!trace.some(event=>event.method==='session/close'||event.method==='session/delete'));
});

test('missing HTTP MCP capability fails before starting a tool-enabled inference',async t=>{
 const f=await fixture(t,{capabilities:{sessionCapabilities:{close:{}}}});
 await assert.rejects(f.runtime.completion(f.settings,'[[tool]]',signal(),[tool]),/不支援 HTTP MCP/);
 assert(!(await f.trace()).some(event=>event.method==='session/new'));
});

test('persisted CLI and permission overrides fail before spawning instead of falling back from ACP',async t=>{
 const f=await fixture(t);
 for(const arg of ['--headless','-p','-phello','--prompt=hello','--allow-all','--yolo','--available-tools=*','--additional-mcp-config={}','--model=uncontrolled','--']){
  await assert.rejects(f.runtime.completion({...f.settings,copilotArgs:[...f.settings.copilotArgs,arg]},'must not start',signal(),[]),/ACP 啟動參數不相容/);
 }
 assert.deepEqual(await f.trace(),[]);
});
