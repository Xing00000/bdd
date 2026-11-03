import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createCore} from '../../src/application/core.ts';
import {createChatService} from '../../src/application/chat.ts';
import {defaultChatSettings} from '../../src/adapters/runtime/chat-settings.ts';
import type {ChatRuntime} from '../../src/ports/chat.ts';
import type {Store} from '../../src/ports/store.ts';

function deferred<T=void>(){
 let resolve!:(value:T)=>void,reject!:(error:Error)=>void;
 const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});void promise.catch(()=>{});
 return {promise,resolve,reject};
}
const isClosed=(error:any)=>error.code==='CHAT_CLOSED';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
type ChatStore=Pick<Store,'all'|'run'|'batch'>;
async function fixture(t:TestContext,decorate:(store:ChatStore)=>ChatStore=store=>store,release=()=>{}){
 const directory=await mkdtemp(path.join(tmpdir(),'bdd-chat-service-lifecycle-'));
 const core=await createCore(path.join(directory,'metadata.sqlite'));
 const reply=deferred<string>(),compaction=deferred(),replyEntered=deferred(),compactEntered=deferred(),closeCalled=deferred();
 const calls={reply:0,compact:0,afterClose:0,close:0};let closed=false;
 // A gated runtime verifies admission and persistence ordering, not inference.
 const runtime:ChatRuntime={
  async models(){throw Error('Model discovery is outside these lifecycle checks');},
  async reply(){calls.reply++;if(closed)calls.afterClose++;replyEntered.resolve();return reply.promise;},
  async compact(){calls.compact++;if(closed)calls.afterClose++;compactEntered.resolve();await compaction.promise;},
  async close(){closed=true;calls.close++;closeCalled.resolve();reply.reject(Error('Runtime closed'));compaction.reject(Error('Runtime closed'));},
 };
 const chat=await createChatService(decorate(core.store),runtime,defaultChatSettings());
 t.after(async()=>{release();try{await chat.close();}finally{await core.close();await rm(directory,{recursive:true,force:true});}});
 return {chat,store:core.store,calls,replyEntered,compactEntered,closeCalled};
}

test('shutdown waits for a send reading settings and rejects it before inserting or starting inference',{timeout:10000},async t=>{
 const entered=deferred(),gate=deferred();let blocked=false;
 const f=await fixture(t,store=>({...store,all:async(sql,params)=>{
  const rows=await store.all(sql,params);
  if(blocked&&sql==='SELECT value_json FROM chat_settings WHERE id=1'){entered.resolve();await gate.promise;}
  return rows as any;
 }}),()=>gate.resolve());
 const room=await f.chat.create({});blocked=true;
 const sending=f.chat.send(room.id,{content:'Not admitted before shutdown'}),rejected=assert.rejects(sending,isClosed);
 await entered.promise;
 let finished=false;const closing=f.chat.close();void closing.then(()=>{finished=true;},()=>{finished=true;});
 await f.closeCalled.promise;await tick();assert.equal(finished,false,'Storage cannot close while the accepted API call is still reading it');
 gate.resolve();await rejected;await closing;
 assert.equal(f.calls.reply,0);assert.equal(f.calls.afterClose,0);assert.deepEqual((await f.chat.detail(room.id)).messages,[]);
 await assert.rejects(()=>f.chat.send(room.id,{content:'After shutdown'}),isClosed);assert.equal(f.calls.close,1);
});

for(const boundary of ['before commit','after commit'] as const)test('shutdown preserves an admitted user message when pending INSERT is delayed '+boundary,{timeout:10000},async t=>{
 const entered=deferred(),gate=deferred();
 const f=await fixture(t,store=>({...store,batch:async commands=>{
  const inserting=commands.some(command=>command.sql.startsWith('INSERT INTO chat_messages'));
  if(inserting&&boundary==='before commit'){entered.resolve();await gate.promise;}
  const result=await store.batch(commands);
  if(inserting&&boundary==='after commit'){entered.resolve();await gate.promise;}
  return result;
 }}),()=>gate.resolve());
 const room=await f.chat.create({}),original='  Preserve the exact original message.\n';
 const sending=f.chat.send(room.id,{content:original});await entered.promise;
 assert.equal((await f.chat.detail(room.id)).messages.length,boundary==='after commit'?1:0);
 let finished=false;const closing=f.chat.close();void closing.then(()=>{finished=true;},()=>{finished=true;});
 await f.closeCalled.promise;await tick();assert.equal(finished,false);
 gate.resolve();const accepted=await sending;await closing;
 const detail=await f.chat.detail(room.id);assert.equal(detail.messages.length,1);assert.equal(detail.messages[0].id,accepted.messageId);
 assert.equal(detail.messages[0].content,original);assert.equal(detail.messages[0].role,'user');assert.equal(detail.messages[0].status,'interrupted');assert(detail.messages[0].error);
 assert.equal(detail.streaming,null);assert.equal((await f.chat.list())[0].pending,0);assert.equal(f.calls.reply,0);assert.equal(f.calls.afterClose,0);
});

for(const read of ['SELECT * FROM chat_rooms WHERE id=?','SELECT value_json FROM chat_settings WHERE id=1'])test('shutdown drains compact admission blocked in '+read,{timeout:10000},async t=>{
 const entered=deferred(),gate=deferred();let blocked=false;
 const f=await fixture(t,store=>({...store,all:async(sql,params)=>{
  const rows=await store.all(sql,params);if(blocked&&sql===read){entered.resolve();await gate.promise;}return rows as any;
 }}),()=>gate.resolve());
 const room=await f.chat.create({});await f.store.run('UPDATE chat_rooms SET thread_id=? WHERE id=?',['persisted-thread',room.id]);blocked=true;
 const compacting=f.chat.compact(room.id),rejected=assert.rejects(compacting,isClosed);await entered.promise;
 let finished=false;const closing=f.chat.close();void closing.then(()=>{finished=true;},()=>{finished=true;});
 await f.closeCalled.promise;await tick();assert.equal(finished,false);
 gate.resolve();await rejected;await closing;
 assert.equal(f.calls.compact,0);assert.equal(f.calls.afterClose,0);assert.equal((await f.store.all('SELECT thread_id FROM chat_rooms WHERE id=?',[room.id]))[0].thread_id,'persisted-thread');
 await assert.rejects(()=>f.chat.compact(room.id),isClosed);
});

test('shutdown cancels active inference before waiting for its final interrupted-message write',{timeout:10000},async t=>{
 const entered=deferred(),gate=deferred();
 const f=await fixture(t,store=>({...store,run:async(sql,params)=>{
  if(sql==="UPDATE chat_messages SET status=?,error=? WHERE id=? AND status='pending'"){entered.resolve();await gate.promise;}
  return store.run(sql,params);
 }}),()=>gate.resolve());
 const room=await f.chat.create({});await f.chat.send(room.id,{content:'Active during shutdown'});await f.replyEntered.promise;
 let finished=false;const closing=f.chat.close();void closing.then(()=>{finished=true;},()=>{finished=true;});
 await f.closeCalled.promise;await entered.promise;await tick();assert.equal(finished,false);
 assert.equal((await f.chat.detail(room.id)).messages[0].status,'pending');
 gate.resolve();await closing;
 const detail=await f.chat.detail(room.id);assert.equal(detail.messages.length,1);assert.equal(detail.messages[0].status,'interrupted');assert.equal(detail.streaming,null);
 assert.equal(f.calls.reply,1);assert.equal(f.calls.afterClose,0);
});

test('shutdown cancels an already running compact before awaiting its admitted request',{timeout:10000},async t=>{
 const f=await fixture(t),room=await f.chat.create({});await f.store.run('UPDATE chat_rooms SET thread_id=? WHERE id=?',['persisted-thread',room.id]);
 const compacting=f.chat.compact(room.id),rejected=assert.rejects(compacting,/Runtime closed/);await f.compactEntered.promise;
 await f.chat.close();await rejected;
 assert.equal(f.calls.compact,1);assert.equal(f.calls.afterClose,0);assert.equal(f.calls.close,1);
});
