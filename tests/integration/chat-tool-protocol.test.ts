import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {conversationInput,workstationTools} from '../../src/adapters/runtime/chat-tool-protocol.ts';
import {createCopilotRuntime} from '../../src/adapters/runtime/copilot-chat.ts';
import {defaultChatSettings} from '../../src/adapters/runtime/chat-settings.ts';
import {copilotChatPeer} from '../helpers/copilot-chat-peer.ts';
import {createCopilotToolBridge} from '../../src/adapters/runtime/copilot-tools.ts';
import http from 'node:http';

const tool={name:'workbench_list_repositories',namespace:'mcp__workbench',description:'Read repositories',parameters:{type:'object',properties:{}}};
test('workstation protocol preserves tool identity and text errors, rejects unrelated or unpaired results',()=>{
 const call={type:'function_call',namespace:tool.namespace,name:tool.name,call_id:'call-one',arguments:'{}'};
 const result={type:'function_call_output',call_id:call.call_id,output:[{type:'input_text',text:'An operation failed'},{type:'input_text',text:'Exact error'}]};
 assert.equal(conversationInput([call,result],true)[1].output,'An operation failed\nExact error');
 for(const items of [[call,result,result],[result],[{...call,namespace:'shell'}],[call,{...result,output:[{type:'input_image'}]}],[{...call,arguments:'[]'}],[{type:'reasoning'}]])assert.throws(()=>conversationInput(items,true));
 assert.throws(()=>conversationInput([call],false));
 const tools=workstationTools([{type:'function',name:'exec_command'},{type:'namespace',name:tool.namespace,tools:[{...tool,type:'function'}]}],true);
 assert.deepEqual(tools,[tool]);assert.deepEqual(workstationTools([],false),[]);
});

test('ACP MCP declarations hand off to Codex while every permission is cancelled and no action executes',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'bdd-copilot-protocol-')),peer=await copilotChatPeer(directory),runtime=createCopilotRuntime(directory);
 t.after(async()=>{await runtime.close();await rm(directory,{recursive:true,force:true});});
 const settings={...defaultChatSettings(),...peer},signal=new AbortController().signal;
 const answer=await runtime.completion(settings,'[[tool]]',signal,[tool]);
 assert.equal(answer.text,'');assert.equal(answer.calls.length,1);
 assert.deepEqual(answer.calls[0],{toolCallId:answer.calls[0].toolCallId,mcpServerName:'codex_handoff',mcpToolName:tool.name,arguments:{}});
 for(const [prompt,error] of [['[[bad-tool]]',/未授權/],['[[builtin]]',/不得執行/],['[[permission]]',/不得執行/]] as const)await assert.rejects(runtime.completion(settings,prompt,signal,[tool]),error);
 assert.deepEqual(await runtime.completion(settings,'text only',signal,[]),{text:'Protocol peer text response',calls:[]});
 const trace=(await readFile(peer.tracePath,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
 const created=trace.filter(event=>event.method==='session/new');assert.equal(created.length,5);
 assert.equal(created[0].params.mcpServers.length,1);assert.deepEqual(created.at(-1).params.mcpServers,[]);
 const catalog=trace.find(event=>event.type==='mcp'&&event.method==='tools/list');assert.deepEqual(catalog.result.tools.map((item:any)=>item.name),[tool.name]);
 assert.equal(trace.filter(event=>event.method==='session/cancel').length,4);
 assert.equal(trace.filter(event=>event.method==='session/close').length,5);
 assert(!trace.some(event=>event.type==='mcp'&&event.method==='tools/call'),'The real action never reaches an MCP executor');
 for(const response of trace.filter(event=>event.type==='client-response'))assert.deepEqual(response.result,{outcome:{outcome:'cancelled'}},'A proposal is never a permission approval or action result');
 assert.equal(trace.filter(event=>event.type==='spawn').length,1);
});

test('a server that skips permission for read-only MCPs still only produces a proposal',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'bdd-copilot-mcp-proposal-')),peer=await copilotChatPeer(directory),runtime=createCopilotRuntime(directory);
 t.after(async()=>{await runtime.close();await rm(directory,{recursive:true,force:true});});
 const answer=await runtime.completion({...defaultChatSettings(),...peer},'[[tool-http]]',new AbortController().signal,[tool]);
 assert.equal(answer.calls.length,1);assert.equal(answer.calls[0].mcpToolName,tool.name);assert.deepEqual(answer.calls[0].arguments,{});
 const trace=(await readFile(peer.tracePath,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
 assert.equal(trace.filter(event=>event.method==='session/cancel').length,1);assert.equal(trace.filter(event=>event.method==='session/close').length,1);
 assert(!trace.some(event=>event.type==='mcp'&&event.method==='tools/call'&&event.result),'The proposal inbox returns no successful workbench result');
});

test('closing a proposal registration aborts an upload already in progress and rejects later requests',async t=>{
 const bridge=await createCopilotToolBridge('closed-proposal-test');t.after(()=>bridge.close());
 const calls:any[]=[],failures:Error[]=[],registration=bridge.register([tool],(...args)=>calls.push(args),error=>failures.push(error));
 const headers=Object.fromEntries(registration.server.headers.map(header=>[header.name,header.value]));
 const request=http.request(registration.server.url,{method:'POST',headers:{...headers,'content-type':'application/json',expect:'100-continue','transfer-encoding':'chunked'}});
 request.on('error',()=>{});t.after(()=>request.destroy());
 const closed=new Promise<void>(resolve=>request.once('close',resolve));
 const ready=new Promise<void>(resolve=>request.once('continue',resolve));request.flushHeaders();await ready;
 request.write('{');registration.close();
 request.end(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:tool.name,arguments:{}}}).slice(1));await closed;
 const later=await fetch(registration.server.url,{method:'POST',headers,body:'{}'});assert.equal(later.status,401);await later.text();
 assert.deepEqual(calls,[]);assert.deepEqual(failures,[]);
});

test('MCP proposal arguments preserve Chinese text across UTF-8 network chunk boundaries',async t=>{
 const bridge=await createCopilotToolBridge('utf8-proposal-test');t.after(()=>bridge.close());
 let resolve!:(args:Record<string,unknown>)=>void;
 const proposed=new Promise<Record<string,unknown>>(done=>{resolve=done;}),registration=bridge.register([tool],(_name,args)=>resolve(args),error=>assert.fail(error.message));
 t.after(()=>registration.close());
 const headers=Object.fromEntries(registration.server.headers.map(header=>[header.name,header.value]));
 const request=http.request(registration.server.url,{method:'POST',headers:{...headers,'content-type':'application/json','transfer-encoding':'chunked'}});
 request.on('error',()=>{});t.after(()=>request.destroy());
 const payload=Buffer.from(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:tool.name,arguments:{note:'漢字內容'}}})),boundary=payload.indexOf(Buffer.from('漢'))+1;
 request.write(payload.subarray(0,boundary));await new Promise(resolve=>setTimeout(resolve,10));request.end(payload.subarray(boundary));
 assert.deepEqual(await proposed,{note:'漢字內容'});registration.close();
});
