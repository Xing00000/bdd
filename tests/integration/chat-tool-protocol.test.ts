import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {conversationInput,workstationTools,formatInferencePrompt,parseInferenceCompletion} from '../../src/adapters/runtime/chat-tool-protocol.ts';
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

test('ACP inference translates tool proposals with zero MCP servers while refusing every tool execution or permission request',async t=>{
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
 for(const session of created)assert.deepEqual(session.params.mcpServers,[],'Copilot ACP never receives any MCP server');
 const firstPrompt=trace.find(event=>event.method==='session/prompt')?.params.prompt[0].text;
 const embeddedCatalog=JSON.parse(firstPrompt.split('\n').slice(1).join('\n')).tools;
 assert.deepEqual(embeddedCatalog.map((item:any)=>item.name),[tool.name]);
 assert.equal(trace.filter(event=>event.method==='session/cancel').length,2);
 assert.equal(trace.filter(event=>event.method==='session/close').length,5);
 assert(!trace.some(event=>event.type==='mcp'),'No MCP HTTP bridge is ever contacted by Copilot ACP');
 for(const response of trace.filter(event=>event.type==='client-response'))assert.deepEqual(response.result,{outcome:{outcome:'cancelled'}},'Permission requests are always cancelled');
 assert.equal(trace.filter(event=>event.type==='spawn').length,1);
});

test('pure protocol translation preserves Chinese UTF-8 arguments and strips vendor disabled-tools startup notices',()=>{
 const formatted=formatInferencePrompt('Continue\n{"instructions":null,"input":[]}',[tool]);
 const payload=JSON.parse(formatted.split('\n')[1]);
 assert.equal(payload.tools[0].name,tool.name);
 const raw='Info: Disabled tools: bash, view, editInfo: Unknown tool name in the tool allowlist: "__bdd_no_tools__"{"type":"tool_calls","calls":[{"id":"call-utf8","name":"workbench_list_repositories","arguments":{"note":"漢字內容"}}]}';
 const parsed=parseInferenceCompletion(raw,[tool]);
 assert.equal(parsed.text,'');
 assert.deepEqual(parsed.calls,[{toolCallId:'call-utf8',mcpServerName:'codex_handoff',mcpToolName:tool.name,arguments:{note:'漢字內容'}}]);
});

test('pure protocol translation strictly validates tool JSON schema, argument whitelist, and envelope structure',()=>{
 const strictTool={
  name:'workbench_generate_requirement',
  namespace:'mcp__workbench',
  description:'Generate requirement proposal',
  parameters:{
   type:'object',
   properties:{
    repositoryId:{type:'string',minLength:1},
    editorKey:{type:'string'},
    description:{type:'string'},
   },
   required:['repositoryId','editorKey','description'],
   additionalProperties:false,
  },
 };
 for(const invalidRaw of [
  '{"type":"tool_calls","calls":[{"name":"workbench_generate_requirement","arguments":{"repositoryId":"SPEC-1","editorKey":"new-1"}}]}',
  '{"type":"tool_calls","calls":[{"name":"workbench_generate_requirement","arguments":{"repositoryId":"SPEC-1","editorKey":"new-1","description":"ok","extra":true}}]}',
  '{"type":"tool_calls","calls":[{"name":"workbench_generate_requirement","arguments":{"repositoryId":123,"editorKey":"new-1","description":"ok"}}]}',
  '{"type":"tool_calls","calls":[{"name":"workbench_generate_requirement","arguments":{"repositoryId":"SPEC-1","editorKey":"new-1","description":"ok"},"extraKey":1}]}',
  '{"type":"tool_calls","extraEnvelope":1,"calls":[{"name":"workbench_generate_requirement","arguments":{"repositoryId":"SPEC-1","editorKey":"new-1","description":"ok"}}]}',
  '{"type":"tool_calls","calls":',
  '{"type":"unknown_type","text":"hello"}',
 ]){
  assert.throws(()=>parseInferenceCompletion(invalidRaw,[strictTool]),/未授權或無效的工具提案/);
 }
});

test('prompt normalization preserves security boundaries, Git prohibitions, and permissions instructions verbatim',()=>{
 const securityInstruction='Git is owned by the workstation feature-creation and human-acceptance checkpoints. Do not invoke Git, including read-only Git commands.';
 const permissionsInstruction='<permissions instructions>\nFilesystem sandboxing defines which files can be read or written. approval_policy is never.\n</permissions instructions>';
 const boilerplate='You are a coding agent running in the Codex CLI, a terminal-based coding assistant.\n# How you work\n Long built-in boilerplate';
 const prompt='Continue\n'+JSON.stringify({
  instructions:null,
  input:[
   {type:'message',role:'developer',content:[{type:'input_text',text:boilerplate}]},
   {type:'message',role:'developer',content:[{type:'input_text',text:permissionsInstruction}]},
   {type:'message',role:'developer',content:[{type:'input_text',text:securityInstruction}]},
   {type:'message',role:'user',content:[{type:'input_text',text:'請檢查專案'}]},
  ],
 });
 const formatted=formatInferencePrompt(prompt,[tool]);
 const payload=JSON.parse(formatted.split('\n')[1]);
 const devTexts=payload.normalizedHistory.filter((item:any)=>item.role==='developer').map((item:any)=>item.content[0].text);
 assert.ok(devTexts.includes(securityInstruction),'security/Git prohibition developer instructions must be preserved');
 assert.ok(devTexts.includes(permissionsInstruction),'permissions instructions must be preserved');
 assert.ok(!devTexts.includes(boilerplate),'only conflicting built-in Codex CLI boilerplate is filtered');
});
