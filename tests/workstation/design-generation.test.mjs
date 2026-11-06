import {writeDesignDecisions} from '../../packages/spec-toolkit/design-decisions.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {writeFile} from 'node:fs/promises';
import {fixture,git,toolkitRoot} from './helpers.mjs';
import {createWorkstation} from '../../packages/workstation/service.mjs';

const document=writeDesignDecisions('# 系統設計\n\n## 責任\n依已確認需求呈現文件。\n\n## 驗證\n使用正式介面驗證情境結果。\n',{schemaVersion:1,items:[]});
async function setup(t,body){
  const f=await fixture(t),agent=path.join(f.base,'design-peer.mjs');
  await git.command(undefined,['init','--bare','--initial-branch','main',f.remote]);
  // Controlled CLI peer verifies PTY, frozen input and persistence; not model inference.
  await writeFile(agent,`import {readFile,writeFile} from 'node:fs/promises';const {task,artifacts}=JSON.parse(await readFile(process.argv[2],'utf8'));${body}`);
  const service=await createWorkstation({home:f.home,toolkitRoot,autoAcquire:false,allowLocal:true,enableExecution:true});t.after(()=>service.close());
  const repositoryId='SPEC-design';service.register({id:repositoryId,title:'Design',remoteUrl:f.remote});let sequence=0;
  const start=(operation,input={})=>{const operationId=`OP-design-${++sequence}`;service.enqueue({schemaVersion:1,operationId,repositoryId,operation,input});return operationId;};
  const job=async(operation,input)=>{const result=await service.wait(start(operation,input));assert.equal(result.status,'SUCCEEDED',JSON.stringify(result.error));return result;};
  await job('repository.setup',{reviewer:'Human',projects:[],agent:{runtime:'custom-cli',command:process.execPath,args:[agent,'{task}'],timeoutMs:15000}});
  const ids={requirementId:'REQ-001',featureId:'reader'};await job('workflow.create',{...ids,title:'Reader'});
  const feature=(await service.detail(repositoryId)).spec.features[0];await job('workflow.review',{...ids,stage:'gherkin',expectedDigest:feature.review.hashes.gherkin});
  const file=await service.readFile(repositoryId,'spec/REQ-001/reader/reader.sd.md');
  const source={...ids,previousDesign:file.content};
  return {...f,service,start,job,repositoryId,file,source,async input(){return {...source,...await service.agentPreview(repositoryId,{purpose:'design',...source})};}};
}
test('system design generation uses a PTY, preserves unsaved input and stores only SD-stage interactions',async t=>{
  const f=await setup(t,`if(!process.stdin.isTTY)throw Error('PTY required');if(task.purpose!=='design'||!Object.keys(artifacts).some(p=>p.endsWith('.feature')))throw Error('Missing approved requirement');console.log('DESIGN_READY');const {createInterface}=await import('node:readline');const lines=createInterface({input:process.stdin});await new Promise(resolve=>lines.once('line',resolve));lines.close();await writeFile(task.output,${JSON.stringify(document)});console.log('DESIGN_DONE');`);
  const input=await f.input(),id=f.start('workflow.design.generate',input),deadline=Date.now()+10000;
  while(!(await f.service.terminal(id)).output.includes('DESIGN_READY')){assert.ok(Date.now()<deadline,'PTY readiness');await new Promise(r=>setTimeout(r,25));}
  const receipt=f.service.terminalInput(id,{data:'繼續\r'}),result=await f.service.wait(id);assert.equal(result.status,'SUCCEEDED',JSON.stringify(result.error));assert.equal(result.result.content,document);
  assert.equal((await f.service.readFile(f.repositoryId,f.file.path)).content,f.file.content,'Original design is unchanged until user saves');
  assert.equal(f.service.interactions(f.repositoryId,{type:'SD'}).entries.length,2);assert.equal(f.service.interactions(f.repositoryId,{type:'GHERKIN'}).entries.length,0);
  assert.equal(f.service.operation(receipt.interactions[0].id).status,'SUCCEEDED');assert.match((await f.service.terminal(receipt.interactions[0].id)).output,/DESIGN_DONE/);
  assert.equal((await f.service.detail(f.repositoryId)).spec.features[0].review.confirmed.sd,false);
});
test('changed design input after preview cannot dispatch the CLI',async t=>{
  const f=await setup(t,"throw Error('Unexpected dispatch');"),input=await f.input();input.previousDesign+='Changed';
  const result=await f.service.wait(f.start('workflow.design.generate',input));assert.equal(result.status,'FAILED');assert.equal(result.error.code,'PROMPT_CHANGED');
});
test('invalid design output fails without overwriting the document',async t=>{
  const f=await setup(t,"await writeFile(task.output,'not a Markdown document');"),result=await f.service.wait(f.start('workflow.design.generate',await f.input()));
  assert.equal(result.status,'FAILED');assert.equal(result.error.code,'INVALID_DESIGN_OUTPUT');assert.equal((await f.service.readFile(f.repositoryId,f.file.path)).content,f.file.content);
});

test('new generated designs must explicitly contain structured decisions, even when there are none',async t=>{
 const f=await setup(t,"await writeFile(task.output,'# Valid Markdown without decision contract');"),result=await f.service.wait(f.start('workflow.design.generate',await f.input()));assert.equal(result.status,'FAILED');assert.equal(result.error.code,'INVALID_DESIGN_DECISIONS');assert.equal((await f.service.readFile(f.repositoryId,f.file.path)).content,f.file.content);
});
