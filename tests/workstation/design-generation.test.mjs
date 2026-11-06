import {writeDesignDecisions} from '../../packages/spec-toolkit/design-decisions.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {writeFile} from 'node:fs/promises';
import {fixture,git,toolkitRoot} from './helpers.mjs';
import {createWorkstation} from '../../packages/workstation/service.mjs';
import {configureSdkPeer,readSdkPeerCalls} from './sdk-peer.mjs';

const document=writeDesignDecisions('# 系統設計\n\n## 責任\n依已確認需求呈現文件。\n\n## 驗證\n使用正式介面驗證情境結果。\n',{schemaVersion:1,items:[]});
async function setup(t,body){
  const f=await fixture(t),release=path.join(f.base,'release-first-turn');
  await git.command(undefined,['init','--bare','--initial-branch','main',f.remote]);
  const agent=await configureSdkPeer({home:f.home,directory:f.base,source:`import {writeFile,access} from 'node:fs/promises';const release=${JSON.stringify(release)};${body}`});
  const service=await createWorkstation({home:f.home,toolkitRoot,autoAcquire:false,allowLocal:true,enableExecution:true});t.after(()=>service.close());
  const repositoryId='SPEC-design';service.register({id:repositoryId,title:'Design',remoteUrl:f.remote});let sequence=0;
  const start=(operation,input={})=>{const operationId=`OP-design-${++sequence}`;service.enqueue({schemaVersion:1,operationId,repositoryId,operation,input});return operationId;};
  const job=async(operation,input)=>{const result=await service.wait(start(operation,input));assert.equal(result.status,'SUCCEEDED',JSON.stringify(result.error));return result;};
  await job('repository.setup',{reviewer:'Human',projects:[],agent:{runtime:'codex-sdk',timeoutMs:15000}});
  const ids={requirementId:'REQ-001',featureId:'reader'};await job('workflow.create',{...ids,title:'Reader'});
  const feature=(await service.detail(repositoryId)).spec.features[0];await job('workflow.review',{...ids,stage:'gherkin',expectedDigest:feature.review.hashes.gherkin});
  const file=await service.readFile(repositoryId,'spec/REQ-001/reader/reader.sd.md');
  const source={...ids,previousDesign:file.content};
  return {...f,service,start,job,repositoryId,file,source,agent,release,async input(){return {...source,...await service.agentPreview(repositoryId,{purpose:'design',...source})};}};
}
test('system design generation uses SDK follow-up turns, preserves unsaved input and stores only SD-stage interactions',async t=>{
  const f=await setup(t,`if(process.stdin.isTTY)throw Error('Official SDK must supply the approved prompt through its input pipe');if(task.purpose!=='design'||!Object.keys(artifacts).some(p=>p.endsWith('.feature')))throw Error('Missing approved requirement');if(!isResume){console.log('DESIGN_READY');const deadline=Date.now()+10000;while(true){try{await access(release);break;}catch(error){if(error.code!=='ENOENT'||Date.now()>deadline)throw error;await new Promise(resolve=>setTimeout(resolve,10));}}}else{await writeFile(task.output,${JSON.stringify(document)});console.log('DESIGN_DONE');}`);
  const input=await f.input(),id=f.start('workflow.design.generate',input),deadline=Date.now()+10000;
  while(!(await f.service.terminal(id)).output.includes('DESIGN_READY')){assert.ok(Date.now()<deadline,'SDK readiness');await new Promise(r=>setTimeout(r,25));}
  const message='繼續\n保留這一段\r\n設計補充',receipt=f.service.terminalInput(id,{message});await writeFile(f.release,'ready');
  const result=await f.service.wait(id);assert.equal(result.status,'SUCCEEDED',JSON.stringify(result.error));assert.equal(result.result.content,document);
  assert.equal((await f.service.readFile(f.repositoryId,f.file.path)).content,f.file.content,'Original design is unchanged until user saves');
  assert.equal(f.service.interactions(f.repositoryId,{type:'SD'}).entries.length,2);assert.equal(f.service.interactions(f.repositoryId,{type:'GHERKIN'}).entries.length,0);
  const interaction=f.service.operation(receipt.interactions[0].id);assert.equal(interaction.status,'SUCCEEDED');assert.equal(interaction.result.reason,'SDK_TURN_COMPLETED');assert.match((await f.service.terminal(id)).output,/DESIGN_DONE/);
  const calls=await readSdkPeerCalls(f.agent);assert.equal(calls.length,2);assert.equal(calls[0].sdkOriginator,'codex_sdk_ts');assert.equal(calls[1].prompt,message);assert.equal(calls[1].isResume,true);assert.equal(calls[1].threadId,calls[0].threadId);assert.equal(interaction.result.threadId,calls[0].threadId);
  assert.equal((await f.service.detail(f.repositoryId)).spec.features[0].review.confirmed.sd,false);
});
test('changed design input after preview cannot dispatch the SDK',async t=>{
  const f=await setup(t,"throw Error('Unexpected dispatch');"),input=await f.input();input.previousDesign+='Changed';
  const result=await f.service.wait(f.start('workflow.design.generate',input));assert.equal(result.status,'FAILED');assert.equal(result.error.code,'PROMPT_CHANGED');assert.deepEqual(await readSdkPeerCalls(f.agent),[]);
});
test('invalid design output fails without overwriting the document',async t=>{
  const f=await setup(t,"await writeFile(task.output,'not a Markdown document');"),result=await f.service.wait(f.start('workflow.design.generate',await f.input()));
  assert.equal(result.status,'FAILED');assert.equal(result.error.code,'INVALID_DESIGN_OUTPUT');assert.equal((await f.service.readFile(f.repositoryId,f.file.path)).content,f.file.content);
});

test('new generated designs must explicitly contain structured decisions, even when there are none',async t=>{
 const f=await setup(t,"await writeFile(task.output,'# Valid Markdown without decision contract');"),result=await f.service.wait(f.start('workflow.design.generate',await f.input()));assert.equal(result.status,'FAILED');assert.equal(result.error.code,'INVALID_DESIGN_DECISIONS');assert.equal((await f.service.readFile(f.repositoryId,f.file.path)).content,f.file.content);
});
