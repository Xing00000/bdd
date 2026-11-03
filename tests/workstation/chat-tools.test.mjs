import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createWorkstation} from '../../packages/workstation/service.mjs';
import {openChatTools} from '../../packages/workstation/chat-tools.mjs';

test('chat MCP authenticates, reuses workstation proposals, rejects invalid tools and persists across restart',async()=>{
 const home=await mkdtemp(path.join(tmpdir(),'bdd-chat-tools-'));
 const options={home,autoAcquire:false};let service=await createWorkstation(options),mcp=await openChatTools(service),next=0;
 const request=(method,params={},headers={})=>fetch(mcp.url,{method:'POST',headers:{authorization:`Bearer ${mcp.token}`,'content-type':'application/json',...headers},body:JSON.stringify({jsonrpc:'2.0',id:++next,method,params})});
 const rpc=async(method,params)=>{const r=await request(method,params);assert.equal(r.status,200);return r.json();};
 try{
  const repository=service.register({title:'Real service fixture',remoteUrl:'https://github.com/openai/codex'});
  assert.equal((await request('tools/list',{}, {authorization:'Bearer invalid'})).status,403);
  assert.equal((await request('tools/list',{}, {origin:'http://evil.example'})).status,403);
  assert.equal((await rpc('initialize',{protocolVersion:'2025-06-18'})).result.protocolVersion,'2025-06-18');
  const names=(await rpc('tools/list')).result.tools.map(t=>t.name);
  assert(names.includes('workbench_generate_requirement'));assert(!names.includes('workbench_confirm_stage'));
  for(const [name,args] of [['shell',{cmd:'pwd'}],['workbench_generate_requirement',{repositoryId:repository.id,editorKey:'new-mcp',description:23}],['workbench_generate_requirement',{repositoryId:repository.id,editorKey:'new-mcp',description:'hello',approve:true}],['workbench_generate_requirement',{repositoryId:repository.id,editorKey:'../bad',description:'hello'}],['workbench_get_job_progress',{repositoryId:repository.id,jobId:'missing'}]]){
   assert((await rpc('tools/call',{name,arguments:args})).error,`${name} must reject invalid arguments`);
  }
  const description='需求原文\n登入後顯示帳戶頁面',input={repositoryId:repository.id,editorKey:'new-mcp',description};
  const generated=(await rpc('tools/call',{name:'workbench_generate_requirement',arguments:input})).result.structuredContent.value;
  assert(generated.proposalId);assert(generated.interactionId);assert.equal(generated.draft,true);
  let rows=service.requirementProposals(repository.id,input.editorKey);assert.equal(rows.length,1);assert.equal(rows[0].description,description);
  const db=new DatabaseSync(path.join(home,'metadata.sqlite'),{readOnly:true});
  try{assert.equal(db.prepare('SELECT description FROM requirement_proposals WHERE id=?').get(generated.proposalId).description,description);assert.equal(service.operation(generated.interactionId).status,'SUCCEEDED');}
  finally{db.close();}
  await mcp.close();await service.close();service=await createWorkstation(options);mcp=await openChatTools(service);
  rows=(await rpc('tools/call',{name:'workbench_get_requirement_proposals',arguments:{repositoryId:repository.id,editorKey:input.editorKey}})).result.structuredContent.value;
  assert.equal(rows[0].id,generated.proposalId);assert.equal(rows[0].description,description);
 }finally{await mcp.close();await service.close();}
});
