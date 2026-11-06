import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {TestContext} from 'node:test';
import {createChatProvider} from '../../src/adapters/runtime/chat-provider.ts';
import {defaultChatSettings} from '../../src/adapters/runtime/chat-settings.ts';
import {copilotChatPeer} from '../helpers/copilot-chat-peer.ts';

async function fixture(t:TestContext,toolsEnabled=false){
 const directory=await mkdtemp(path.join(tmpdir(),'bdd-provider-reuse-'));
 const peer=await copilotChatPeer(directory),provider=await createChatProvider(directory,toolsEnabled);
 t.after(async()=>{await provider.close();await rm(directory,{recursive:true,force:true});});
 const settings={...defaultChatSettings(),copilotExecutable:peer.copilotExecutable,copilotArgs:peer.copilotArgs};
 const trace=async()=>{try{return (await readFile(peer.tracePath,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}};
 const waitFor=async(predicate:(events:any[])=>boolean)=>{const deadline=Date.now()+5000;while(!predicate(await trace())){if(Date.now()>deadline)assert.fail('Protocol peer did not reach the required lifecycle event');await new Promise(resolve=>setTimeout(resolve,10));}};
 const post=(token:string,content:string,options:{tools?:object[];signal?:AbortSignal}={})=>fetch(provider.url+'/responses',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},signal:options.signal,body:JSON.stringify({input:[{type:'message',role:'user',content:[{type:'input_text',text:content}]}],tools:options.tools})});
 const events=(body:string)=>body.split('\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6)));
 return {provider,settings,trace,waitFor,post,events};
}

test('persistent provider credential only permits requests during its current turn',async t=>{
 const provider=await createChatProvider(process.cwd());t.after(()=>provider.close());
 const registration=provider.register({...defaultChatSettings(),copilotExecutable:'must-not-be-spawned'});t.after(()=>registration.close());
 const call=()=>fetch(provider.url+'/responses',{method:'POST',headers:{authorization:'Bearer '+registration.token,'content-type':'application/json'},body:JSON.stringify({input:[{type:'function_call',name:'shell',arguments:'{}'}]})});
 const inactive=await call();assert.equal(inactive.status,409);await inactive.text();
 const first=new AbortController();registration.activate(first.signal);
 assert.throws(()=>registration.activate(new AbortController().signal),/尚未結束/);
 const active=await call();assert.equal(active.status,502);assert.match((await active.json()).error.message,/不支援工具/);
 registration.deactivate();const ended=await call();assert.equal(ended.status,409);await ended.text();
 registration.activate(new AbortController().signal);first.abort();
 const next=await call();assert.equal(next.status,502);await next.text();
 registration.close();const closed=await call();assert.equal(closed.status,401);await closed.text();
 assert.throws(()=>registration.activate(new AbortController().signal),/已關閉/);
});

test('deactivating a turn closes a request still uploading its body',{timeout:5000},async t=>{
 const provider=await createChatProvider(process.cwd());t.after(()=>provider.close());
 const registration=provider.register({...defaultChatSettings(),copilotExecutable:'must-not-be-spawned'},new AbortController().signal);t.after(()=>registration.close());
 const request=http.request(provider.url+'/responses',{method:'POST',headers:{authorization:'Bearer '+registration.token,'content-type':'application/json','transfer-encoding':'chunked'}});
 request.on('error',()=>{});t.after(()=>request.destroy());
 const closed=new Promise<void>(resolve=>request.once('close',resolve));
 request.flushHeaders();await once(request,'socket');
 request.write('{"input":');
 // An independent request establishes that the server is accepting traffic;
 // the unfinished upload itself must never reach the inference backend.
 const check=await fetch(provider.url+'/unrelated',{headers:{authorization:'Bearer '+registration.token}});assert.equal(check.status,404);await check.text();
 registration.deactivate();await closed;
});

test('provider close is idempotent and rejects later registrations and model queries',async()=>{
 const provider=await createChatProvider(process.cwd());
 await Promise.all([provider.close(),provider.close()]);
 assert.throws(()=>provider.register(defaultChatSettings()),/已關閉/);
 await assert.rejects(provider.models(defaultChatSettings(),new AbortController().signal),/已關閉/);
});

test('HTTP provider reuses one Copilot process for multiple turns, models and tool handoff',{timeout:15000},async t=>{
 const f=await fixture(t,true),registration=f.provider.register(f.settings);
 for(const content of ['first turn','second turn']){
  registration.activate(new AbortController().signal);
  const response=await f.post(registration.token,content);assert.equal(response.status,200);
  const events=f.events(await response.text()),deltas=events.filter(event=>event.type==='response.output_text.delta');
  assert.equal(deltas.length,2);assert.equal(deltas.map(event=>event.delta).join(''),'Protocol peer text response');
  assert.equal(events.at(-1).type,'response.completed');registration.deactivate();
 }
 await f.provider.models(f.settings,new AbortController().signal);
 registration.activate(new AbortController().signal);
 const tool={type:'function',name:'workbench_list_repositories',description:'Read repositories',parameters:{type:'object',properties:{}}};
 const response=await f.post(registration.token,'[[tool]]',{tools:[{type:'namespace',name:'mcp__workbench',tools:[tool]}]});
 const events=f.events(await response.text()),completed=events.at(-1);
 assert.equal(completed.type,'response.completed');assert.equal(completed.response.output.length,1);
 assert.equal(completed.response.output[0].type,'function_call');assert.equal(completed.response.output[0].name,tool.name);
 assert.equal(completed.response.output[0].namespace,'mcp__workbench');registration.deactivate();
 const trace=await f.trace();assert.equal(trace.filter(event=>event.type==='spawn').length,1);
 assert.equal(trace.filter(event=>event.type==='request'&&event.method==='initialize').length,1);
 assert.equal(trace.filter(event=>event.method==='session/new').length,4,'Three inferences plus one model catalog session');
 assert.equal(new Set(trace.filter(event=>event.type==='session-created').map(event=>event.sessionId)).size,4);
 assert.equal(trace.filter(event=>event.method==='session/close').length,4);
 assert(!trace.some(event=>event.method==='models.list'));
 assert(!trace.some(event=>event.method==='session.toolCall'),'Copilot must not execute or acknowledge a workbench action');
});

test('cancelling one room leaves another room and the shared Copilot process usable',{timeout:15000},async t=>{
 const f=await fixture(t),first=f.provider.register(f.settings,new AbortController().signal),second=f.provider.register(f.settings,new AbortController().signal);
 const pending=await f.post(first.token,'[[hang]]'),cancelled=assert.rejects(()=>pending.text());
 await f.waitFor(trace=>trace.some(event=>event.method==='session/prompt'&&event.params.prompt[0].text.includes('[[hang]]')));
 const reply=await f.post(second.token,'other room');assert.equal(f.events(await reply.text()).at(-1).type,'response.completed');
 first.deactivate();await cancelled;
 await f.waitFor(trace=>trace.filter(event=>event.method==='session/close').length===2);
 const next=await f.post(second.token,'same room, next model round');assert.equal(f.events(await next.text()).at(-1).type,'response.completed');
 const trace=await f.trace();assert.equal(trace.filter(event=>event.type==='spawn').length,1);
 assert.equal(trace.filter(event=>event.method==='session/new').length,3);
});

test('disconnecting an HTTP response cancels only that inference session',{timeout:15000},async t=>{
 const f=await fixture(t),registration=f.provider.register(f.settings,new AbortController().signal),request=new AbortController();
 const pending=await f.post(registration.token,'[[hang]]',{signal:request.signal}),cancelled=assert.rejects(()=>pending.text());
 await f.waitFor(trace=>trace.some(event=>event.method==='session/prompt'));
 request.abort();await cancelled;
 await f.waitFor(trace=>trace.some(event=>event.method==='session/close'));
 const next=await f.post(registration.token,'still active');assert.equal(f.events(await next.text()).at(-1).type,'response.completed');
 assert.equal((await f.trace()).filter(event=>event.type==='spawn').length,1);
});
