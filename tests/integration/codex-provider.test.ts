import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import type {TestContext} from 'node:test';
import {createChatProvider} from '../../src/adapters/runtime/chat-provider.ts';
import {createCopilotRuntime} from '../../src/adapters/runtime/copilot-chat.ts';
import {providerTools,providerConversationInput,responseToolCall,codexProposalNamespace} from '../../src/adapters/runtime/chat-tool-protocol.ts';
import {defaultChatSettings} from '../../src/adapters/runtime/chat-settings.ts';
import {copilotChatPeer,type CopilotPeerOptions} from '../helpers/copilot-chat-peer.ts';

const objectSchema={type:'object',properties:{command:{type:'string'}},required:['command'],additionalProperties:false};
const shell={type:'function',name:'exec_command',description:'Run a command in the Codex workspace',parameters:objectSchema};
const patch={type:'custom',name:'apply_patch',description:'Apply a workspace patch',format:{type:'grammar',syntax:'lark',definition:'start: "*** Begin Patch" /[\\s\\S]*/ "*** End Patch"'}};
const patchInput='*** Begin Patch\n*** Add File: 漢字.txt\n+literal {"key":"value"} \\ backslash\n*** End Patch\n';
const output=(body:string)=>body.split('\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6)));

test('coding catalog gives distinct short aliases to functions, raw custom inputs and equal names in different namespaces',()=>{
 const declared=[shell,{type:'namespace',name:'functions',description:'Codex tools',tools:[shell,patch]},{type:'namespace',name:'mcp__workbench_task',tools:[{...shell,name:'exec_command'}]}];
 const tools=providerTools(declared,'codex');
 assert.equal(new Set(tools.map(tool=>tool.name)).size,4);
 assert(tools.every(tool=>tool.namespace===codexProposalNamespace&&tool.name.length<35));
 assert.deepEqual(tools.map(tool=>tool.source),[
  {type:'function',name:'exec_command'},
  {type:'function',name:'exec_command',namespace:'functions'},
  {type:'custom',name:'apply_patch',namespace:'functions'},
  {type:'function',name:'exec_command',namespace:'mcp__workbench_task'},
 ]);
 assert.deepEqual(tools[0].parameters,objectSchema);assert.notEqual(tools[0].parameters,objectSchema);
 assert.deepEqual(tools[2].parameters.required,['input']);assert.equal(tools[2].parameters.additionalProperties,false);
 assert(tools[2].description.includes(JSON.stringify(patch.format)));
 const proposal=(index:number,args:Record<string,unknown>)=>responseToolCall({toolCallId:'call-one',mcpServerName:'codex_handoff',mcpToolName:tools[index].name,arguments:args},tools);
 assert.deepEqual(proposal(0,{command:'printf fixture'}),{type:'function_call',name:'exec_command',call_id:'call-one',arguments:'{"command":"printf fixture"}'});
 assert.equal(proposal(1,{}).namespace,'functions');assert.equal(proposal(3,{}).namespace,'mcp__workbench_task');
 assert.deepEqual(proposal(2,{input:patchInput}),{type:'custom_tool_call',namespace:'functions',name:'apply_patch',call_id:'call-one',input:patchInput});
 for(const args of [{},{input:{}},{input:patchInput,extra:'not an input'}])assert.throws(()=>proposal(2,args),/原始 input/);
 assert.throws(()=>responseToolCall({toolCallId:'call-one',mcpServerName:'codex_handoff',mcpToolName:'not-declared',arguments:{}},tools),/未宣告/);
});

test('coding catalog refuses unsupported tools and invalid declarations instead of dropping them',()=>{
 for(const tools of [
  [{type:'web_search'}],[{type:'tool_search'}],[{type:'local_shell'}],[{type:'apply_patch'}],
  [shell,{type:'unknown'}],[shell,shell],[{...shell,parameters:null}],[{...shell,parameters:{type:'array'}}],
  [{...patch,format:{type:'unknown'}}],[{...patch,format:{type:'grammar',syntax:'unknown',definition:'x'}}],
  [{type:'namespace',name:'functions',tools:[{type:'namespace',name:'nested',tools:[shell]}]}],
 ])assert.throws(()=>providerTools(tools,'codex'));
 assert.deepEqual(providerTools([shell,patch],false),[]);
 assert.deepEqual(providerTools([shell,patch,{type:'namespace',name:'mcp__workbench_task',tools:[shell]}],true),[],'Chat never inherits the coding policy');
});

test('coding history preserves function and custom identities, exact patch text and typed output pairs',()=>{
 const functionCall={type:'function_call',namespace:'functions',name:'exec_command',call_id:'shell-call',arguments:'{ "command": "printf fixture" }'};
 const customCall={type:'custom_tool_call',name:'apply_patch',namespace:'functions',call_id:'patch-call',input:patchInput};
 const functionOutput={type:'function_call_output',call_id:'shell-call',output:[{type:'input_text',text:'stdout: 漢字\n'},{type:'input_text',text:'stderr: none'}]};
 const customOutput={type:'custom_tool_call_output',call_id:'patch-call',output:'Patch rejected: fixture only'};
 const history=[{type:'message',role:'user',content:[{type:'input_text',text:'Implement this'}]},functionCall,functionOutput,customCall,customOutput];
 assert.deepEqual(providerConversationInput(history,'codex'),history);
 assert.deepEqual(providerConversationInput([{type:'reasoning',summary:[{type:'summary_text',text:'Visible prior summary'}],encrypted_content:null}],'codex'),[{type:'reasoning',summary:[{type:'summary_text',text:'Visible prior summary'}]}]);
 for(const invalid of [
  [functionOutput],[customCall,{...functionOutput,call_id:'patch-call'}],[functionCall,{...customOutput,call_id:'shell-call'}],
  [customCall,customOutput,customOutput],[functionCall,functionCall],
  [customCall,{...customOutput,output:[{type:'input_image',image_url:'data:image/png,...'}]}],
  [functionCall,{...functionOutput,name:'different'}],[{type:'reasoning',summary:[],encrypted_content:'opaque'}],
  [{type:'additional_tools',role:'developer',tools:[shell]}],[{type:'custom_tool_call',name:'apply_patch',call_id:'one',input:{patch:patchInput}}],
 ])assert.throws(()=>providerConversationInput(invalid,'codex'));
 assert.throws(()=>providerConversationInput([customCall],true));
});

async function fixture(t:TestContext,options:CopilotPeerOptions={},policy:boolean|'codex'='codex'){
 const directory=await mkdtemp(path.join(tmpdir(),'bdd-codex-provider-')),peer=await copilotChatPeer(directory,options),provider=await createChatProvider(directory,policy);
 t.after(async()=>{await provider.close();await rm(directory,{recursive:true,force:true});});
 const wrapper=path.join(directory,'observed-copilot-peer.mjs');
 await writeFile(wrapper,`import {appendFileSync,readdirSync} from 'node:fs';
appendFileSync(${JSON.stringify(peer.tracePath)},JSON.stringify({type:'cwd',cwd:process.cwd(),entries:readdirSync(process.cwd())})+'\\n');
await import(${JSON.stringify(pathToFileURL(peer.copilotArgs[0]).href)});\n`);
 const settings={...defaultChatSettings(),...peer,copilotArgs:[wrapper]},registration=provider.register(settings,new AbortController().signal);
 const post=(body:object)=>fetch(provider.url+'/responses',{method:'POST',headers:{authorization:'Bearer '+registration.token,'content-type':'application/json'},body:JSON.stringify(body)});
 const trace=async()=>{try{return (await readFile(peer.tracePath,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}};
 return {directory,provider,settings,post,trace};
}

const prompt=[{type:'message',role:'user',content:[{type:'input_text',text:'[[tool]]'}]}];
test('coding ACP starts and creates sessions in an owned empty directory, then removes only that directory',async t=>{
 const f=await fixture(t),marker=path.join(f.directory,'product-source.txt');await writeFile(marker,'The product workspace remains owned by Codex.\n');
 const response=await f.post({input:[{type:'message',role:'user',content:[{type:'input_text',text:'Inference context fixture'}]}]});
 assert.equal(output(await response.text()).at(-1).type,'response.completed');
 await f.provider.models(f.settings,new AbortController().signal);
 const trace=await f.trace(),started=trace.find(event=>event.type==='cwd');assert(started);
 assert.notEqual(started.cwd,f.directory);assert(!started.cwd.startsWith(f.directory+path.sep));assert.deepEqual(started.entries,[]);
 const sessions=trace.filter(event=>event.method==='session/new');assert.equal(sessions.length,2);assert(sessions.every(event=>event.params.cwd===started.cwd));
 await Promise.all([f.provider.close(),f.provider.close()]);
 await assert.rejects(readdir(started.cwd),{code:'ENOENT'});assert.equal(await readFile(marker,'utf8'),'The product workspace remains owned by Codex.\n');
});

test('coding provider cleans its owned inference directory after an ACP initialization failure',async t=>{
 const f=await fixture(t,{protocolVersion:99});
 await assert.rejects(f.provider.models(f.settings,new AbortController().signal),/協定版本不相容/);
 const started=(await f.trace()).find(event=>event.type==='cwd');assert(started);assert.notEqual(started.cwd,f.directory);
 await f.provider.close();await assert.rejects(readdir(started.cwd),{code:'ENOENT'});assert((await readdir(f.directory)).length>0);
});

test('chat provider retains its existing workspace and never removes caller-owned directories',async t=>{
 const f=await fixture(t,{},false);await f.provider.models(f.settings,new AbortController().signal);
 const trace=await f.trace(),started=trace.find(event=>event.type==='cwd');assert.equal(started.cwd,f.directory);
 assert(trace.filter(event=>event.method==='session/new').every(event=>event.params.cwd===f.directory));
 await f.provider.close();assert((await readdir(f.directory)).length>0);
});

test('coding HTTP provider returns raw custom calls through ACP and carries their real outputs into the next inference',async t=>{
 const f=await fixture(t,{toolArguments:{input:patchInput}});
 const request={input:prompt,tools:[{type:'namespace',name:'functions',tools:[patch]}]};
 const response=await f.post(request);assert.equal(response.status,200);
 const events=output(await response.text()),item=events.at(-1).response.output[0];
 assert.equal(item.type,'custom_tool_call');assert.equal(item.name,'apply_patch');assert.equal(item.namespace,'functions');assert.equal(item.input,patchInput);assert.equal(item.arguments,undefined);
 assert.equal(events.find(event=>event.type==='response.custom_tool_call_input.delta').delta,patchInput);
 assert.equal(events.find(event=>event.type==='response.custom_tool_call_input.done').input,patchInput);
 const result={type:'custom_tool_call_output',call_id:item.call_id,output:'Codex rejected this patch: fixture result only'};
 const next=await f.post({input:[{...prompt[0],content:[{type:'input_text',text:'Continue after Codex execution'}]},item,result],tools:request.tools});
 assert.equal(output(await next.text()).at(-1).type,'response.completed');
 const trace=await f.trace(),requests=trace.filter(event=>event.method==='session/prompt');
 const continued=JSON.parse(requests.at(-1).params.prompt[0].text.split('\n').slice(1).join('\n'));
 assert.equal(continued.input[1].input,patchInput);assert.deepEqual(continued.input[2],result);
 assert.equal(trace.filter(event=>event.type==='spawn').length,1);
 assert(trace.some(event=>event.type==='client-response'&&event.result?.outcome?.outcome==='cancelled'));
 assert(!trace.some(event=>event.type==='mcp'&&event.method==='tools/call'),'Copilot never executes an actual Codex tool');
});

test('coding HTTP provider restores the selected namespace when identical names appear in several catalogs',async t=>{
 const f=await fixture(t,{toolIndex:1,toolArguments:{command:'do not execute: proposal fixture'}});
 const response=await f.post({input:prompt,tools:[{type:'namespace',name:'functions',tools:[shell]},{type:'namespace',name:'mcp__workbench_task',tools:[shell]}]});
 const item=output(await response.text()).at(-1).response.output[0];
 assert.equal(item.type,'function_call');assert.equal(item.namespace,'mcp__workbench_task');assert.equal(item.name,'exec_command');assert.equal(JSON.parse(item.arguments).command,'do not execute: proposal fixture');
 const catalog=(await f.trace()).find(event=>event.type==='mcp'&&event.method==='tools/list').result.tools;
 assert.equal(catalog.length,2);assert.notEqual(catalog[0].name,catalog[1].name);
});

test('coding HTTP rejects unsupported declarations before starting Copilot',async t=>{
 const f=await fixture(t);
 const response=await f.post({input:prompt,tools:[shell,{type:'tool_search'}]});
 assert.equal(response.status,502);assert.match((await response.json()).error.message,/tool_search/);assert.deepEqual(await f.trace(),[]);
});

test('coding tool choice limits proposals and unsupported response contracts fail explicitly',async t=>{
 const f=await fixture(t,{toolArguments:{input:patchInput}});
 const tools=[{type:'namespace',name:'functions',tools:[shell,patch]}];
 const chosen=await f.post({input:prompt,tools,tool_choice:{type:'custom',name:'apply_patch',namespace:'functions'}});
 const item=output(await chosen.text()).at(-1).response.output[0];assert.equal(item.type,'custom_tool_call');assert.equal(item.input,patchInput);
 const catalog=(await f.trace()).find(event=>event.type==='mcp'&&event.method==='tools/list').result.tools;
 assert.equal(catalog.length,1);assert.equal(catalog[0].name,'codex_tool_0001');
 const none=await f.post({input:[{...prompt[0],content:[{type:'input_text',text:'Answer without tools'}]}],tools,tool_choice:'none'});
 assert(output(await none.text()).at(-1).response.output.every((item:any)=>item.type==='message'));
 const before=(await f.trace()).filter(event=>event.method==='session/new').length;
 for(const unsupported of [{tool_choice:{type:'allowed_tools',tools:[]}},{tool_choice:{type:'function',name:'missing'}},{text:{format:{type:'json_schema',schema:{type:'object'}}}}]){
  const response=await f.post({input:prompt,tools,...unsupported});assert.equal(response.status,502);await response.text();
 }
 assert.equal((await f.trace()).filter(event=>event.method==='session/new').length,before);
});

test('the ACP runtime requires explicit coding policy for coding aliases',async t=>{
 const f=await fixture(t),runtime=createCopilotRuntime(f.directory);t.after(()=>runtime.close());
 await assert.rejects(runtime.completion(f.settings,'fixture',new AbortController().signal,providerTools([shell],'codex')),/未授權/);
 assert.deepEqual(await f.trace(),[]);
});
