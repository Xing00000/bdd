import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createCodexChatRuntime} from '../../src/adapters/runtime/codex-chat.ts';
import type {ChatSettings} from '../../src/ports/chat.ts';
import {codexChatPeer} from '../helpers/codex-chat-peer.ts';

async function fixture(t:TestContext,options:Parameters<typeof createCodexChatRuntime>[2]={},peerOptions:Parameters<typeof codexChatPeer>[1]={}){
 const directory=await mkdtemp(path.join(tmpdir(),'bdd-codex-runtime-')),peer=await codexChatPeer(directory,peerOptions);
 const runtime=await createCodexChatRuntime(directory,undefined,{interruptTimeoutMs:100,...options});
 const settings:ChatSettings={codexExecutable:peer.executable,copilotExecutable:process.execPath,copilotArgs:['unused-protocol-fixture'],model:'fixture-model',timeoutMs:3000};
 const threads=new Map<string,string>();
 t.after(async()=>{try{await runtime.close();}finally{await rm(directory,{recursive:true,force:true});}});
 const reply=(roomId:string,text:string,config=settings,onDelta?:(delta:string)=>void)=>runtime.reply({roomId,text,settings:config,threadId:threads.get(roomId)??null,onThread:async id=>{threads.set(roomId,id);},onDelta});
 return {runtime,settings,threads,peer,reply};
}
function gone(pid:number){try{process.kill(pid,0);return false;}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return true;throw error;}}
function exited(pid:number){assert.equal(gone(pid),true,'Child process was reaped');}
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}

test('Codex reuses one initialized thread for replies and compact, streams early, and ignores stale or unrelated turn events',async t=>{
 const f=await fixture(t),first:string[]=[],second:string[]=[];
 assert.equal(await f.reply('one','first',f.settings,delta=>first.push(delta)),'Peer reply: first');
 assert.deepEqual(first,['Peer ','reply: first']);
 let settled=false;const pending=f.reply('one','[gated] second',f.settings,delta=>second.push(delta)).finally(()=>{settled=true;});
 await f.peer.waitFor(events=>events.some(e=>e.event==='streaming'));
 assert.deepEqual(second,['Peer ']);assert.equal(settled,false,'Deltas arrive before completion');
 await f.peer.release();assert.equal(await pending,'Peer reply: [gated] second');
 await f.runtime.compact({roomId:'one',threadId:f.threads.get('one')!,settings:f.settings});
 assert.equal(await f.reply('one','after compact'),'Peer reply: after compact');
 const events=await f.peer.events();
 for(const method of ['spawn','initialize','initialized','thread/start'])assert.equal(events.filter(e=>e.event===method).length,1,method);
 assert.equal(events.filter(e=>e.event==='thread/resume').length,0);
 assert.equal(events.filter(e=>e.event==='turn/start').length,3);assert.equal(events.filter(e=>e.event==='thread/compact/start').length,1);
 assert.equal(events.filter(e=>e.event==='terminated').length,0,'Normal completion keeps the process alive');
 await f.runtime.close();exited(events[0].pid);
});

test('Codex keeps concurrent rooms and credentials isolated and rejects overlapping turns in one room',async t=>{
 const f=await fixture(t),a:string[]=[],b:string[]=[];
 const pending=f.reply('room-a','[gated] A',f.settings,delta=>a.push(delta));
 await f.peer.waitFor(events=>events.some(e=>e.event==='streaming'));
 await assert.rejects(()=>f.reply('room-a','overlap'),/正在回覆/);
 assert.equal(await f.reply('room-b','B',f.settings,delta=>b.push(delta)),'Peer reply: B');
 assert.deepEqual(a,['Peer ']);assert.deepEqual(b,['Peer ','reply: B']);assert.notEqual(f.threads.get('room-a'),f.threads.get('room-b'));
 const spawns=(await f.peer.events()).filter(e=>e.event==='spawn');assert.equal(spawns.length,2);assert.notEqual(spawns[0].tokenHash,spawns[1].tokenHash);
 await f.peer.release();assert.equal(await pending,'Peer reply: [gated] A');
 assert.equal((await f.peer.events()).filter(e=>e.text==='overlap').length,0);
});

test('Codex buffers early deltas until the turn/start acknowledgement confirms their identity',async t=>{
 const f=await fixture(t),deltas:string[]=[];
 const pending=f.reply('room','[gated-ack]',f.settings,delta=>deltas.push(delta));
 await f.peer.waitFor(events=>events.some(e=>e.event==='before-ack'));
 assert.deepEqual(deltas,[],'Unacknowledged text is not sent to the browser');
 await f.peer.release();assert.equal(await pending,'Peer reply: [gated-ack]');assert.deepEqual(deltas,['Peer ','reply: [gated-ack]']);
});

test('Codex never exposes early text when the turn/start response identifies a different turn',async t=>{
 const f=await fixture(t),deltas:string[]=[];
 await assert.rejects(()=>f.reply('room','[wrong-ack]',f.settings,delta=>deltas.push(delta)),/回合識別不一致/);
 assert.deepEqual(deltas,[]);exited((await f.peer.events())[0].pid);
});

test('Codex timeout interrupts the precise turn, preserves the timeout, and reuses a confirmed idle worker without replay',async t=>{
 const f=await fixture(t),settings={...f.settings,timeoutMs:1000};
 await assert.rejects(()=>f.reply('room','[hang]',settings),/聊天超過設定的 1000 毫秒/);
 assert.equal(await f.reply('room','after timeout',settings),'Peer reply: after timeout');
 const events=await f.peer.events(),interrupt=events.find(e=>e.event==='turn/interrupt');
 assert(interrupt);assert.equal(interrupt.threadId,f.threads.get('room'));assert.equal(interrupt.turnId,events.find(e=>e.event==='completed').turnId);
 assert.equal(events.filter(e=>e.event==='spawn').length,1);assert.equal(events.filter(e=>e.text==='[hang]').length,1);
});

for(const text of ['[ignore-interrupt]','[ack-only]'])test('Codex discards a timed-out worker without confirmed interrupt completion: '+text,async t=>{
 const f=await fixture(t),settings={...f.settings,timeoutMs:1000};
 await assert.rejects(()=>f.reply('room',text,settings),/聊天超過設定的 1000 毫秒/);
 const before=await f.peer.events();exited(before.find(e=>e.event==='spawn').pid);
 assert.equal(await f.reply('room','recovered',settings),'Peer reply: recovered');
 const events=await f.peer.events();assert.equal(events.filter(e=>e.event==='spawn').length,2);assert.equal(events.filter(e=>e.event==='thread/resume').length,1);assert.equal(events.filter(e=>e.text===text).length,1);
 assert.equal(events.find(e=>e.event==='thread/resume').threadId,f.threads.get('room'));
});

test('Codex crash fails the submitted turn once and resumes its thread on the next explicit reply',async t=>{
 const f=await fixture(t);
 await assert.rejects(()=>f.reply('room','[crash]'),/已結束.*17/);
 const original=f.threads.get('room');assert(original);
 assert.equal(await f.reply('room','after crash'),'Peer reply: after crash');assert.equal(f.threads.get('room'),original);
 const events=await f.peer.events();assert.equal(events.filter(e=>e.event==='spawn').length,2);assert.equal(events.filter(e=>e.text==='[crash]').length,1);assert.equal(events.find(e=>e.event==='thread/resume').threadId,original);
});

test('Codex settings changes rebuild provider credentials and resume the same persisted conversation',async t=>{
 const f=await fixture(t);await f.reply('room','initial');const thread=f.threads.get('room');
 const model={...f.settings,model:'other-model'};await f.reply('room','changed model',model);
 const provider={...model,copilotArgs:['changed-provider-arguments']};await f.reply('room','changed provider',provider);await f.reply('room','same settings',provider);
 const events=await f.peer.events(),spawns=events.filter(e=>e.event==='spawn'),resumes=events.filter(e=>e.event==='thread/resume');
 assert.equal(spawns.length,3);assert.equal(new Set(spawns.map(e=>e.tokenHash)).size,3);assert.equal(resumes.length,2);assert(resumes.every(e=>e.threadId===thread&&e.model==='other-model'));
 for(const spawn of spawns.slice(0,-1))exited(spawn.pid);
});

test('Codex idle expiry releases its process and later resumes the persisted thread',async t=>{
 const f=await fixture(t,{idleTimeoutMs:80});await f.reply('room','before idle');const thread=f.threads.get('room');
 const expired=await f.peer.waitFor(events=>events.some(e=>e.event==='terminated'&&gone(e.pid)));exited(expired[0].pid);
 await f.reply('room','after idle');assert.equal(f.threads.get('room'),thread);
 const events=await f.peer.events();assert.equal(events.filter(e=>e.event==='spawn').length,2);assert.equal(events.find(e=>e.event==='thread/resume').threadId,thread);
});

test('Codex bounds idle workers with LRU eviction and never evicts an active room',async t=>{
 const f=await fixture(t,{maxIdleWorkers:1}),active=f.reply('active','[gated] active');
 await f.peer.waitFor(events=>events.some(e=>e.event==='streaming'));await f.reply('older','old');await f.reply('newer','new');
 const events=await f.peer.waitFor(entries=>entries.some(e=>e.event==='terminated'&&gone(e.pid)));
 const pid=(text:string)=>events.find(e=>e.event==='turn/start'&&e.text===text).pid;
 exited(pid('old'));assert.doesNotThrow(()=>process.kill(pid('[gated] active'),0));assert.doesNotThrow(()=>process.kill(pid('new'),0));
 await f.peer.release();assert.equal(await active,'Peer reply: [gated] active');
});

test('Codex close reaps idle and active workers even when compact never supplies a turn id',async t=>{
 const f=await fixture(t,{}, {compactWithoutTurn:true});await f.reply('idle','finished');
 const pending=f.runtime.compact({roomId:'active',threadId:'persisted-compact-thread',settings:{...f.settings,timeoutMs:120000}}),rejected=assert.rejects(()=>pending,/已關閉/);
 await f.peer.waitFor(events=>events.some(e=>e.event==='thread/compact/start'));
 await f.runtime.close();await rejected;await f.runtime.close();
 const events=await f.peer.events();assert.equal(events.filter(e=>e.event==='spawn').length,2);for(const spawn of events.filter(e=>e.event==='spawn'))exited(spawn.pid);
 await assert.rejects(()=>f.reply('idle','closed'),/已關閉/);
});

test('Codex shutdown cancels initialization instead of leaving a pending RPC or process',async t=>{
 const f=await fixture(t,{}, {hangInitialize:true});
 const pending=f.reply('room','never starts'),rejected=assert.rejects(()=>pending,/已關閉/);
 await f.peer.waitFor(events=>events.some(e=>e.event==='initialize'));await f.runtime.close();await rejected;
 const events=await f.peer.events();exited(events[0].pid);assert.equal(events.filter(e=>e.event==='turn/start').length,0);
});

for(const [text,error] of [['[server-request]',/不支援此操作批准/],['[malformed]',/增量格式錯誤/]] as const)test('Codex rejects invalid protocol without leaking a reusable worker: '+text,async t=>{
 const f=await fixture(t);await assert.rejects(()=>f.reply('room',text),error);
 exited((await f.peer.events())[0].pid);assert.equal(await f.reply('room','valid after failure'),'Peer reply: valid after failure');
 assert.equal((await f.peer.events()).filter(e=>e.event==='spawn').length,2);
});

test('Codex never starts a turn if persisting the thread mapping fails',async t=>{
 const f=await fixture(t);
 await assert.rejects(()=>f.runtime.reply({roomId:'room',threadId:null,text:'not submitted',settings:f.settings,onThread:async()=>{throw Error('Persistence unavailable');}}),/Persistence unavailable/);
 const events=await f.peer.events();assert.equal(events.filter(e=>e.event==='turn/start').length,0);exited(events[0].pid);
});

test('Codex timeout keeps the room locked until an already-started thread mapping write settles',async t=>{
 const f=await fixture(t),entered=deferred(),gate=deferred();
 let persisted:string|null=null;
 const pending=f.runtime.reply({roomId:'room',threadId:null,text:'timed out before write',settings:{...f.settings,timeoutMs:1000},onThread:async id=>{entered.resolve();await gate.promise;persisted=id;}});
 const rejected=assert.rejects(()=>pending,/聊天超過設定的 1000 毫秒/);await entered.promise;
 await new Promise(resolve=>setTimeout(resolve,1100));
 await assert.rejects(()=>f.reply('room','overlapping write'),/正在回覆/);
 gate.resolve();await rejected;assert(persisted);
 assert.equal((await f.peer.events()).filter(e=>e.event==='turn/start').length,0);
 assert.equal(await f.runtime.reply({roomId:'room',threadId:persisted,text:'after write',settings:f.settings,onThread:async id=>{assert.equal(id,persisted);}}),'Peer reply: after write');
});

test('Codex close waits for a committed thread mapping callback after reaping its process',async t=>{
 const f=await fixture(t),entered=deferred(),gate=deferred();let written=false,closed=false;
 const pending=f.runtime.reply({roomId:'room',threadId:null,text:'never sent',settings:f.settings,onThread:async()=>{entered.resolve();await gate.promise;written=true;}});
 const rejected=assert.rejects(()=>pending,/已關閉/);await entered.promise;
 const closing=f.runtime.close().then(()=>{closed=true;});await f.peer.waitFor(events=>events.some(e=>e.event==='terminated'));
 assert.equal(closed,false);assert.equal(written,false);gate.resolve();await closing;await rejected;assert.equal(written,true);
 assert.equal((await f.peer.events()).filter(e=>e.event==='turn/start').length,0);
});
