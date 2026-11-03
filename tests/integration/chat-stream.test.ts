import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {createCore} from '../../src/application/core.ts';
import {createChatService} from '../../src/application/chat.ts';
import {defaultChatSettings} from '../../src/adapters/runtime/chat-settings.ts';
import {openChatStream} from '../../src/http/chat-stream.ts';
import type {ChatRuntime} from '../../src/ports/chat.ts';

test('SSE delivers before completion, resumes a partial answer and replaces it with persisted completion or failure', {timeout:15000},async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'bdd-chat-stream-'));
 const core=await createCore(path.join(directory,'metadata.sqlite'));
 // A gated runtime tests transport ordering, not inference quality.
 let delta:((text:string)=>void)|undefined,finish:((text:string)=>void)|undefined,fail:((error:Error)=>void)|undefined;
 const runtime:ChatRuntime={async models(){throw Error('Model discovery is not part of this streaming transport test');},reply:async input=>new Promise<string>((resolve,reject)=>{delta=input.onDelta;finish=resolve;fail=reject;}),async compact(){throw Error('Not used by this transport test');},async close(){fail?.(Error('Runtime closed'));}};
 const chat=await createChatService(core.store,runtime,defaultChatSettings());
 const room=await chat.create({});
 const server=createServer((_request,response)=>{void openChatStream(chat,response,room.id).catch(error=>response.destroy(error));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();assert(address&&typeof address==='object');
 const controllers:AbortController[]=[];
 async function connect(){
  const controller=new AbortController();controllers.push(controller);
  const response=await fetch(`http://127.0.0.1:${(address as {port:number}).port}`,{signal:controller.signal});
  assert.match(response.headers.get('content-type')!,/text\/event-stream/);
  const reader=response.body!.getReader(),decoder=new TextDecoder();let buffer='';
  return async()=>{
   while(!buffer.includes('\n\n')){const part=await reader.read();if(part.done)return null;buffer+=decoder.decode(part.value,{stream:true});}
   const end=buffer.indexOf('\n\n'),line=buffer.slice(0,end);buffer=buffer.slice(end+2);return JSON.parse(line.slice('data: '.length));
  };
 }
 try{
  const next=await connect();assert.equal((await next()).room.messages.length,0);
  await chat.send(room.id,{content:'transport test'});
  assert.equal((await next()).room.messages[0].status,'pending');
  assert(delta&&finish);delta('first');
  const early=await next();assert.equal(early.type,'delta');assert.equal(early.delta,'first');assert.equal(early.offset,0);
  assert.equal((await chat.detail(room.id)).messages.length,1,'No fabricated completed assistant before runtime completion');
  const resumed=await connect();const snapshot=await resumed();assert.equal(snapshot.room.streaming.text,'first');
  delta(' second');assert.equal((await next()).delta,' second');const continued=await resumed();assert.equal(continued.delta,' second');assert.equal(continued.offset,'first'.length);
  finish('first second');const completed=await next();assert.equal(completed.type,'snapshot');assert.equal(completed.room.streaming,null);assert.deepEqual(completed.room.messages.map((m:any)=>[m.role,m.status,m.content]),[['user','completed','transport test'],['assistant','completed','first second']]);
  await chat.send(room.id,{content:'fail after partial output'});await next();delta!('unfinished');await next();fail!(Error('Inference disconnected'));
  const failure=await next();assert.equal(failure.room.streaming,null);assert.equal(failure.room.messages.at(-1).status,'failed');assert.equal(failure.room.messages.filter((m:any)=>m.role==='assistant').length,1);
  await chat.close();assert.equal(await next(),null,'Shutdown closes SSE clients');
 }finally{
  for(const controller of controllers)controller.abort();await chat.close();server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await core.close();
 }
});
