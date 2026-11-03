import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {conversationInput,workstationTools} from '../../src/adapters/runtime/chat-tool-protocol.ts';
import {createCopilotCatalog} from '../../src/adapters/runtime/copilot-catalog.ts';
import {copilotCompletion} from '../../src/adapters/runtime/copilot-chat.ts';

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

test('Copilot catalog requires its private credential and cannot execute advertised tools',async()=>{
 const catalog=await createCopilotCatalog([tool]),server=catalog.config.mcpServers.codex_handoff;
 const call=(method:string,headers:Record<string,string>)=>fetch(server.url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:{protocolVersion:'2025-06-18',name:tool.name,arguments:{}}})});
 try{
  assert.equal((await call('tools/list',{})).status,403);
  assert.equal((await call('tools/list',{...server.headers,origin:'http://evil.example'})).status,403);
  assert.equal((await (await call('initialize',server.headers)).json()).result.protocolVersion,'2025-06-18');
  const tools=(await (await call('tools/list',server.headers)).json()).result.tools;assert.equal(tools.length,1);assert.equal(tools[0].name,tool.name);
  assert.equal((await (await call('tools/call',server.headers)).json()).error.code,-32601);
 }finally{await catalog.close();}
});

test('Copilot native tool handoff validates its catalog and never accepts a shell execution event',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'bdd-copilot-protocol-')),peer=path.join(directory,'peer.mjs');
 // A deterministic protocol peer checks event validation/cancellation only;
 // successful model inference is covered by the real external Playwright case.
 await writeFile(peer,`process.stdin.resume();
 const index=process.argv.indexOf('--additional-mcp-config');if(index<0)throw Error('Private catalog override is required even without tools');
 const server=JSON.parse(process.argv[index+1]).mcpServers.codex_handoff;
 const response=await fetch(server.url,{method:'POST',headers:{...server.headers,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});
 if(!response.ok||!(await response.json()).result.tools)throw Error('Private catalog unavailable');
 const event=JSON.parse(process.argv[2]);console.log(JSON.stringify(event));
 if(event.type==='assistant.message'&&!event.data.toolRequests?.length)console.log(JSON.stringify({type:'result',exitCode:0}));else setInterval(()=>{},1000);
 `);
 const controller=new AbortController();
 const run=(event:object,tools=[tool])=>copilotCompletion({codexExecutable:'unused',copilotExecutable:process.execPath,copilotArgs:[peer,JSON.stringify(event)],model:'auto',timeoutMs:1000},'prompt',directory,controller.signal,tools);
 const call={toolCallId:'native-call',mcpServerName:'codex_handoff',mcpToolName:tool.name,arguments:{}};
 const answer=await run({type:'assistant.message',data:{content:'',toolRequests:[call]}});assert.deepEqual(answer.calls,[call]);
 await assert.rejects(run({type:'assistant.message',data:{content:'',toolRequests:[{...call,mcpToolName:'shell'}]}}),/未授權/);
 await assert.rejects(run({type:'tool.execution_start',data:{toolName:'shell'}}),/不得執行/);
 const textOnly=await run({type:'assistant.message',data:{content:'Protocol peer text response'}},[]);assert.deepEqual(textOnly,{text:'Protocol peer text response',calls:[]});
});
