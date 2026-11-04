import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {conversationInput,workstationTools} from '../../src/adapters/runtime/chat-tool-protocol.ts';
import {createCopilotRuntime} from '../../src/adapters/runtime/copilot-chat.ts';
import {defaultChatSettings} from '../../src/adapters/runtime/chat-settings.ts';
import {copilotChatPeer} from '../helpers/copilot-chat-peer.ts';

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

test('native external declarations hand off to Codex without executing or acknowledging a tool',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'bdd-copilot-protocol-')),peer=await copilotChatPeer(directory),runtime=createCopilotRuntime(directory);
 t.after(async()=>{await runtime.close();await rm(directory,{recursive:true,force:true});});
 const settings={...defaultChatSettings(),...peer},signal=new AbortController().signal;
 const answer=await runtime.completion(settings,'[[tool]]',signal,[tool]);
 assert.equal(answer.text,'');assert.equal(answer.calls.length,1);
 assert.deepEqual(answer.calls[0],{toolCallId:answer.calls[0].toolCallId,mcpServerName:'codex_handoff',mcpToolName:tool.name,arguments:{}});
 for(const [prompt,error] of [['[[bad-tool]]',/未授權/],['[[builtin]]',/不得執行/],['[[permission]]',/不得執行/]] as const)await assert.rejects(runtime.completion(settings,prompt,signal,[tool]),error);
 assert.deepEqual(await runtime.completion(settings,'text only',signal,[]),{text:'Protocol peer text response',calls:[]});
 const trace=(await readFile(peer.tracePath,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
 const created=trace.filter(event=>event.method==='session.create');assert.equal(created.length,5);
 assert.deepEqual(created[0].params.availableTools,[tool.name]);assert.deepEqual(created.at(-1).params.availableTools,[]);
 assert.deepEqual(created.at(-1).params.mcpServers,{});assert.equal(created[0].params.requestPermission,true);
 assert.equal(created[0].params.enableFileHooks,false);assert.equal(created[0].params.enableSkills,false);
 assert.equal(trace.filter(event=>event.method==='session.abort').length,5);
 assert.equal(trace.filter(event=>event.method==='session.delete').length,5);
 assert(!trace.some(event=>event.method?.includes('toolCall')||event.type==='client-response'),'No external-tool handler or successful acknowledgement is installed');
 assert.equal(trace.filter(event=>event.type==='spawn').length,1);
});
