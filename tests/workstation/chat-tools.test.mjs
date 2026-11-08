import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createWorkstation} from '../../packages/workstation/service.mjs';
import {openChatTools} from '../../packages/workstation/chat-tools.mjs';
import {fixture,git,toolkitRoot} from './helpers.mjs';
import {exists} from '../../packages/contracts/index.mjs';

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
  assert(names.includes('workbench_get_node'));assert(names.includes('workbench_submit_node'));assert(!names.includes('workbench_create_requirement'));assert(!names.includes('workbench_confirm_stage'));
  for(const [name,args] of [['shell',{cmd:'pwd'}],['workbench_get_node',{nodeId:23}],['workbench_get_node',{nodeId:'invalid',approve:true}],['workbench_get_node',{nodeId:'../bad'}],['workbench_get_job_progress',{repositoryId:repository.id,jobId:'missing'}]]){
   assert((await rpc('tools/call',{name,arguments:args})).error,`${name} must reject invalid arguments`);
  }
  const description='需求原文\n登入後顯示帳戶頁面',input={repositoryId:repository.id,editorKey:'new-mcp',description};
  const generated=service.generateRequirement(repository.id,{editorKey:input.editorKey,description});
  assert(generated.proposalId);assert(generated.interactionId);assert.equal(generated.draft,true);
  let rows=service.requirementProposals(repository.id,input.editorKey);assert.equal(rows.length,1);assert.equal(rows[0].description,description);
  const db=new DatabaseSync(path.join(home,'metadata.sqlite'),{readOnly:true});
  try{assert.equal(db.prepare('SELECT description FROM requirement_proposals WHERE id=?').get(generated.proposalId).description,description);assert.equal(service.operation(generated.interactionId).status,'SUCCEEDED');}
  finally{db.close();}
  await mcp.close();await service.close();service=await createWorkstation(options);mcp=await openChatTools(service);
  rows=service.requirementProposals(repository.id,input.editorKey);
  assert.equal(rows[0].id,generated.proposalId);assert.equal(rows[0].description,description);
 }finally{await mcp.close();await service.close();}
});

test('legacy proposal save uses the canonical feature workflow after repository setup',async t=>{
 const f=await fixture(t),home=f.home;
 await git.command(undefined,['init','--bare','--initial-branch','main',f.remote]);
 const options={home,toolkitRoot,allowLocal:true};let service=await createWorkstation(options),mcp=await openChatTools(service),next=0;
 const rpc=async(method,params)=>{const r=await fetch(mcp.url,{method:'POST',headers:{authorization:`Bearer ${mcp.token}`,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++next,method,params})});assert.equal(r.status,200);return r.json();};
 try{
  // Register repository with remote URL (no local Git needed for proposal generation)
  const repository=service.register({id:'SPEC-save',title:'Save feature test',remoteUrl:f.remote});
  await rpc('initialize',{protocolVersion:'2025-06-18'});
  // Setup the repository first (this only saves settings to SQLite, no Git)
  let opN=0;const job=async(operation,input)=>{const request={schemaVersion:1,operationId:`OP-${++opN}`,repositoryId:repository.id,operation,input};service.enqueue(request);const out=await service.wait(request.operationId);assert.equal(out.status,'SUCCEEDED',JSON.stringify(out.error));return out;};
  await job('repository.setup',{reviewer:'Test',projects:[]});
  // Generate a proposal
  const description='需求：登入後顯示首頁',input={repositoryId:repository.id,editorKey:'new-save-test',description};
  const generated=service.generateRequirement(repository.id,{editorKey:input.editorKey,description});
  assert(generated.proposalId);
  // Verify tool is listed
  const tools=(await rpc('tools/list')).result.tools.map(t=>t.name);
  assert(!tools.includes('workbench_save_feature'),'chat exposes generic node submission instead of dedicated save tools');
  // Reject missing proposal
  await assert.rejects(()=>service.saveFeature(repository.id,{proposalId:'not-exist'}),{code:'PROPOSAL_NOT_FOUND'});
  // Verify proposal exists in store
  const {openStore}=await import('../../packages/workstation/store.mjs'),store=openStore(home);
  let proposal;try{proposal=store.requirementProposal(repository.id,generated.proposalId);}finally{store.close();}
  assert(proposal,'Proposal should exist');assert.equal(proposal.description,description);
  const saved=await service.saveFeature(repository.id,{proposalId:generated.proposalId});
  assert.equal(saved.key,`${saved.requirementId}/${saved.featureId}`);
  assert.equal(service.operation(saved.operationId).status,'SUCCEEDED');
  const feature=await service.requirement(repository.id,saved.requirementId,saved.featureId);
  assert.equal(feature.description,description);assert.equal(feature.gherkin,proposal.generatedGherkin);
  assert.equal(await exists(service.list().find(r=>r.id===repository.id).localPath),false);
  await mcp.close();await service.close();service=await createWorkstation(options);mcp=await openChatTools(service);
  const persisted=await service.requirement(repository.id,saved.requirementId,saved.featureId);
  assert.equal(persisted.description,description);assert.equal(persisted.gherkin,proposal.generatedGherkin);
 }finally{await mcp.close();await service.close();}
});

test('chat proposals preserve supplied Gherkin and reject invalid documents without a formatting fallback',async t=>{
 const f=await fixture(t),service=await createWorkstation({home:f.home}),mcp=await openChatTools(service);
 t.after(async()=>{await mcp.close();await service.close();});
 const repository=service.register({title:'Authored Gherkin',remoteUrl:'https://github.com/openai/codex'});
 const description='登入\n登入成功後顯示帳戶名稱。';
 const gherkin='Feature: Account name\n  @case:account-name\n  Scenario: Show account name after login\n    Given an account with the name Ada exists\n    When Ada signs in successfully\n    Then the account page displays Ada\n';
 const call=async content=>service.generateRequirement(repository.id,{editorKey:'new-authored',description,gherkin:content});
 const valid=await call(gherkin);assert.equal(valid.method,'supplied-gherkin');
 const before=service.requirementProposals(repository.id,'new-authored');
 assert.equal(before.length,1);assert.equal(before[0].description,description);assert.equal(before[0].generatedGherkin,gherkin);
 await assert.rejects(()=>call('Feature: Missing scenarios'),{code:'INVALID_GHERKIN'});
 assert.deepEqual(service.requirementProposals(repository.id,'new-authored'),before);
});
