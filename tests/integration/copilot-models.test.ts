import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {listCopilotModels} from '../../src/adapters/runtime/copilot-models.ts';
import {createCodexChatRuntime} from '../../src/adapters/runtime/codex-chat.ts';
import {defaultChatSettings} from '../../src/adapters/runtime/chat-settings.ts';
import {copilotModelPeer} from '../helpers/copilot-model-peer.ts';

for(const [name,models,error,authenticated] of [
 ['available catalog',[{id:'fixture-a',name:'協定測試 A'},{id:'fixture-b',name:'協定測試 B',policy:{state:'disabled'}}],null,true],
 ['empty catalog',[],null,true],
 ['invalid catalog',[{id:'fixture-a'}],/格式無效/,true],
 ['duplicate catalog',[{id:'fixture-a',name:'A'},{id:'fixture-a',name:'A'}],/重複/,true],
 ['logged out',[],/尚未登入/,false],
] as const)test('Copilot models protocol: '+name,async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'bdd-models-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const settings={...defaultChatSettings(),...await copilotModelPeer(directory,models,{authenticated})};
 const result=listCopilotModels(settings,directory,new AbortController().signal);
 if(error)await assert.rejects(()=>result,error);else assert.deepEqual(await result,models.map((m:any)=>({id:m.id,name:m.name,selectable:m.policy?.state!=='disabled'})));
});
test('Copilot model discovery observes timeout and runtime shutdown',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'bdd-model-cancel-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const settings={...defaultChatSettings(),...await copilotModelPeer(directory,[],{hang:true}),timeoutMs:1000};
 const runtime=await createCodexChatRuntime(directory);t.after(()=>runtime.close());
 await assert.rejects(()=>runtime.models(settings),/取消或逾時/);
 const query=runtime.models({...settings,timeoutMs:120000}),rejected=assert.rejects(()=>query,/取消或逾時|已結束/);await runtime.close();await rejected;
});

test('selected model reaches the next reply while SQLite history and context thread survive',async t=>{
 const {createCore}=await import('../../src/application/core.ts'),{createChatService}=await import('../../src/application/chat.ts');
 const directory=await mkdtemp(path.join(tmpdir(),'bdd-model-routing-')),core=await createCore(path.join(directory,'metadata.sqlite'));t.after(async()=>{await core.store.close();await rm(directory,{recursive:true,force:true});});
 const observed:{model:string;threadId:string|null}[]=[];
 // This runtime records routing and supplies test text; it is not an inference test.
 const chat=await createChatService(core.store,{
  async models(){return [{id:'fixture-a',name:'A',selectable:true},{id:'fixture-b',name:'B',selectable:true}];},
  async reply(input){observed.push({model:input.settings.model,threadId:input.threadId});await input.onThread('protocol-context-thread');return 'Protocol fixture reply';},
  async compact(){throw Error('This routing test does not compact');},async close(){},
 },{...defaultChatSettings(),model:'fixture-a'});t.after(()=>chat.close());
 const room=await chat.create({});
 async function send(content:string){await chat.send(room.id,{content});const deadline=Date.now()+5000;while((await chat.detail(room.id)).messages.some((m:any)=>m.status==='pending')){if(Date.now()>=deadline)assert.fail('Routing test did not finish');await new Promise(resolve=>setTimeout(resolve,10));}}
 await send('first message');await chat.saveSettings({...await chat.settings(),model:'fixture-b'});await send('second message');
 assert.deepEqual(observed,[{model:'fixture-a',threadId:null},{model:'fixture-b',threadId:'protocol-context-thread'}]);
 assert.deepEqual((await chat.detail(room.id)).messages.map((m:any)=>m.content),['first message','Protocol fixture reply','second message','Protocol fixture reply']);
 assert.equal(JSON.parse((await core.store.all('SELECT value_json FROM chat_settings WHERE id=1'))[0].value_json).model,'fixture-b');
});

test('model and advanced partial saves preserve both concurrent changes',async t=>{
 const {createCore}=await import('../../src/application/core.ts'),{createChatService}=await import('../../src/application/chat.ts');
 const directory=await mkdtemp(path.join(tmpdir(),'bdd-model-settings-')),core=await createCore(path.join(directory,'metadata.sqlite'));
 const runtime=await createCodexChatRuntime(directory),chat=await createChatService(core.store,runtime,defaultChatSettings());t.after(async()=>{await chat.close();await core.store.close();await rm(directory,{recursive:true,force:true});});
 const before=await chat.settings(),timeoutMs=before.timeoutMs+1;
 await Promise.all([chat.patchSettings({model:'fixture-b'}),chat.patchSettings({timeoutMs})]);const after=await chat.settings();assert.equal(after.model,'fixture-b');assert.equal(after.timeoutMs,timeoutMs);assert.equal(after.codexExecutable,before.codexExecutable);
 await assert.rejects(()=>chat.patchSettings({unknown:'invalid'}),(error:any)=>error.code==='INVALID_CHAT_SETTINGS');
});

test('shutdown during settings read cannot start model discovery after runtime close',async t=>{
 const {createCore}=await import('../../src/application/core.ts'),{createChatService}=await import('../../src/application/chat.ts');
 const directory=await mkdtemp(path.join(tmpdir(),'bdd-model-lifecycle-')),core=await createCore(path.join(directory,'metadata.sqlite'));t.after(async()=>{await core.store.close();await rm(directory,{recursive:true,force:true});});
 const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};};
 const gate=deferred(),entered=deferred();let blocked=false,started=false;
 const store:Pick<import('../../src/ports/store.ts').Store,'all'|'run'|'batch'>={...core.store,all:async(sql,params)=>{const rows=await core.store.all(sql,params);if(blocked&&sql==='SELECT value_json FROM chat_settings WHERE id=1'){entered.resolve();await gate.promise;}return rows as any;}};
 const runtime=await createCodexChatRuntime(directory),original=runtime.models.bind(runtime);runtime.models=settings=>{started=true;return original(settings);};
 const chat=await createChatService(store,runtime,defaultChatSettings());blocked=true;const query=chat.models(),rejected=assert.rejects(()=>query,(error:any)=>error.code==='CHAT_CLOSED');await entered.promise;await chat.close();gate.resolve();await rejected;assert.equal(started,false);
 await assert.rejects(()=>runtime.models(defaultChatSettings()),/已關閉/);
});
