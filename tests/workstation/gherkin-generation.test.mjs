import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {writeFile} from 'node:fs/promises';
import {fixture,toolkitRoot} from './helpers.mjs';
import {createWorkstation} from '../../packages/workstation/service.mjs';

const gherkin='Feature: 購物車\n  顧客可以確認加入的商品。\n\n  @case:CASE-001\n  Scenario: 加入商品\n    Given 顧客正在查看商品\n    When 顧客加入商品\n    Then 購物車包含該商品\n';
async function setup(t,body){
  const f=await fixture(t),agent=path.join(f.base,'protocol-peer.mjs');
  // Controlled CLI peers test transport and persistence, not model inference.
  await writeFile(agent,`import {readFile,writeFile} from 'node:fs/promises';\nconst {task,artifacts}=JSON.parse(await readFile(process.argv[2],'utf8'));\n${body}\n`);
  const service=await createWorkstation({home:f.home,toolkitRoot,allowLocal:true,autoAcquire:false,enableExecution:true});t.after(()=>service.close());
  service.register({id:'SPEC-gherkin',title:'Gherkin',remoteUrl:f.remote});let sequence=0;
  const start=(operation,input)=>{const operationId=`OP-generation-${++sequence}`;service.enqueue({schemaVersion:1,operationId,repositoryId:'SPEC-gherkin',operation,input});return operationId;};
  const configured=await service.wait(start('repository.setup',{reviewer:'Human',projects:[],agent:{runtime:'custom-cli',command:process.execPath,args:[agent,'{task}'],timeoutMs:15000}}));assert.equal(configured.status,'SUCCEEDED',JSON.stringify(configured.error));
  const source={editorKey:'new-generation',description:'Feature 名稱為購物車，使用者可以加入商品。',previousGherkin:'Feature: 原稿\n  Scenario: 保留\n    Given 原始內容\n'};
  return {...f,service,start,source,async input(){return {...source,...await service.agentPreview('SPEC-gherkin',{purpose:'gherkin',...source})};}};
}
test('Gherkin CLI uses a real PTY and each Enter gets its own stage-scoped log before saving a proposal',{timeout:25000},async t=>{
  const f=await setup(t,`console.log('PTY_READY');const {createInterface}=await import('node:readline');const lines=createInterface({input:process.stdin});await new Promise(resolve=>lines.once('line',resolve));lines.close();await writeFile(task.output,${JSON.stringify(gherkin)});console.log('GENERATED_GHERKIN');`);
  const id=f.start('workflow.gherkin.generate',await f.input());
  const deadline=Date.now()+10000;while(!(await f.service.terminal(id)).output.includes('PTY_READY')){assert.ok(Date.now()<deadline,'PTY did not become ready');await new Promise(r=>setTimeout(r,25));}
  const receipt=f.service.terminalInput(id,{data:'請繼續\r'});assert.equal(receipt.interactions.length,1);
  const result=await f.service.wait(id);assert.equal(result.status,'SUCCEEDED',JSON.stringify(result.error));assert.equal(result.result.gherkin,gherkin);
  const child=receipt.interactions[0];assert.equal(f.service.operation(child.id).status,'SUCCEEDED');assert.match((await f.service.terminal(child.id)).output,/GENERATED_GHERKIN/);
  const history=f.service.interactions('SPEC-gherkin',{type:'GHERKIN'});assert.equal(history.entries.length,2);assert.ok(history.entries.every(e=>e.interactionType==='GHERKIN'));assert.equal(history.entries[0].id,child.id);
  const proposals=f.service.requirementProposals('SPEC-gherkin',f.source.editorKey);assert.equal(proposals.length,1);assert.equal(proposals[0].generatedGherkin,gherkin);assert.equal(proposals[0].originalGherkin,f.source.previousGherkin);
  assert.equal((await f.service.detail('SPEC-gherkin')).spec.features.length,0,'Generating a proposal must not create or approve a feature');
});
test('invalid CLI output fails and preserves the previous draft without adding a successful proposal',async t=>{
  const f=await setup(t,"await writeFile(task.output,'not Gherkin');");
  const result=await f.service.wait(f.start('workflow.gherkin.generate',await f.input()));assert.equal(result.status,'FAILED');assert.equal(result.error.code,'GHERKIN_INVALID');assert.equal(f.service.requirementProposals('SPEC-gherkin',f.source.editorKey).length,0);
});
test('changing an input after prompt preview prevents CLI dispatch',async t=>{
  const f=await setup(t,"throw Error('Must not run');");const input=await f.input();input.description='Changed after preview';
  const id=f.start('workflow.gherkin.generate',input),result=await f.service.wait(id);assert.equal(result.status,'FAILED');assert.equal(result.error.code,'PROMPT_CHANGED');assert.doesNotMatch((await f.service.terminal(id)).output,/Must not run/);
});
