import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from '../../src/http/server.ts';
import {spawnChatProcess} from '../../src/adapters/runtime/chat-process.ts';
import {createChatProvider} from '../../src/adapters/runtime/chat-provider.ts';
import {once} from 'node:events';

test('chat persists rooms and failed messages across restart without fabricating an answer',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'bdd-chat-contract-'));
 const options={root:process.cwd(),metadataFile:path.join(directory,'metadata.sqlite'),dataRoot:path.join(directory,'data'),baseUrl:'http://127.0.0.1:1'};
 let server=await createServer(options);
 const call=async(method:'GET'|'POST'|'PUT',url:string,payload?:any,status=200)=>{const response=await server.app.inject({method,url,payload});assert.equal(response.statusCode,status,response.body);return response.json();};
 try{
  const settings=await call('GET','/chat-settings');
  await call('PUT','/chat-settings',{...settings,codexExecutable:path.join(directory,'missing-codex')});
  const room=await call('POST','/chat-rooms',{title:'持久化的聊天室'},201);
  await call('POST',`/chat-rooms/${room.id}/messages`,{content:'<script>alert(1)</script>'},202);
  await call('POST','/chat-rooms',{title:'   '},400);
  await call('GET','/chat-rooms/missing',undefined,404);
  await server.app.close();server=await createServer(options);
  const detail=await call('GET',`/chat-rooms/${room.id}`);
  assert.equal(detail.title,'持久化的聊天室');assert.equal(detail.messages.length,1);
  assert.equal(detail.messages[0].content,'<script>alert(1)</script>');
  assert(['failed','interrupted'].includes(detail.messages[0].status));assert(detail.messages[0].error);
  const rooms=await call('GET','/chat-rooms');assert.equal(rooms[0].pending,0);
  assert.equal((await call('GET','/chat-settings')).codexExecutable,path.join(directory,'missing-codex'));
 }finally{await server.app.close();}
});

test('chat provider rejects tool items before invoking a CLI',async()=>{
 const provider=await createChatProvider(process.cwd()),controller=new AbortController();
 const registration=provider.register({codexExecutable:'codex',copilotExecutable:'not-invoked',copilotArgs:[],model:'auto',timeoutMs:1000},controller.signal);
 try{const response=await fetch(provider.url+'/responses',{method:'POST',headers:{authorization:'Bearer '+registration.token,'content-type':'application/json'},body:JSON.stringify({input:[{type:'function_call',name:'shell',arguments:'{}'}]})});assert.equal(response.status,502);assert.match((await response.json()).error.message,/不支援工具/);}
 finally{registration.close();await provider.close();}
});

test('HTTP shutdown aborts an in-flight compact request before waiting for connections to drain',{timeout:15000},async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'bdd-chat-shutdown-')),ready=path.join(directory,'compacting');
 // A protocol peer deliberately never completes compaction. This verifies
 // cancellation ordering, not model inference or a successful chat response.
 const executable=path.join(directory,'protocol-peer.mjs');
 await writeFile(executable,`#!${process.execPath}\nimport {createInterface} from 'node:readline';import {writeFileSync} from 'node:fs';
 createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;if(m.method==='thread/compact/start')writeFileSync(${JSON.stringify(ready)},'ready');console.log(JSON.stringify({id:m.id,result:m.method==='thread/resume'?{thread:{id:'shutdown-thread'}}:{}}));});\n`,{mode:0o700});
 const server=await createServer({root:process.cwd(),metadataFile:path.join(directory,'metadata.sqlite'),dataRoot:path.join(directory,'data'),baseUrl:'http://127.0.0.1:1'});
 try{
  const url=await server.app.listen({host:'127.0.0.1',port:0});
  const settings=(await server.app.inject({method:'GET',url:'/chat-settings'})).json();
  assert.equal((await server.app.inject({method:'PUT',url:'/chat-settings',payload:{...settings,codexExecutable:executable,timeoutMs:300000}})).statusCode,200);
  const room=(await server.app.inject({method:'POST',url:'/chat-rooms',payload:{}})).json();
  await server.core.store.run('UPDATE chat_rooms SET thread_id=? WHERE id=?',['shutdown-thread',room.id]);
  const pending=fetch(`${url}/chat-rooms/${room.id}/compact`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  const deadline=Date.now()+5000;while(true){try{await access(ready);break;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT'||Date.now()>=deadline)throw error;await new Promise(resolve=>setTimeout(resolve,10));}}
  await server.app.close();assert.equal((await pending).status,500);
 }finally{await server.app.close();}
});

test('chat cancellation reaps a process group even when its parent exits before a SIGTERM-ignoring grandchild',async()=>{
 const controller=new AbortController();
 const program=`const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000)"],{stdio:['ignore','ignore','ignore','ipc']});child.on('message',()=>console.log(child.pid));setInterval(()=>{},1000);`;
 const child=spawnChatProcess(process.execPath,['-e',program],{cwd:process.cwd(),signal:controller.signal});child.on('error',error=>{assert.equal(error.name,'AbortError');});
 const [ready]=await once(child.stdout,'data'),grandchild=Number(String(ready).trim());assert(Number.isInteger(grandchild));
 controller.abort();await child.finished;
 assert.throws(()=>process.kill(grandchild,0),(error:any)=>error.code==='ESRCH');
});
