import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture,toolkitRoot,specRepository} from './helpers.mjs';
import {createWorkstation} from '../../packages/workstation/service.mjs';
import {openStore} from '../../packages/workstation/store.mjs';
import {scan,deleteFeature,confirm,restartReview,reviewState} from '../../packages/spec-toolkit/index.mjs';
import {inDraftView} from '../../packages/workstation/authoring.mjs';

async function setup(t){
  const f=await fixture(t),service=await createWorkstation({home:f.home,toolkitRoot,allowLocal:true,autoAcquire:false});let closed=false;t.after(()=>{if(!closed)return service.close();});
  const repositoryId='SPEC-delete';service.register({id:repositoryId,title:'Delete requirements',remoteUrl:f.remote});let sequence=0;
  const start=(operation,input={})=>{const operationId=`OP-delete-${++sequence}`;service.enqueue({schemaVersion:1,operationId,repositoryId,operation,input});return operationId;};
  const job=async(operation,input)=>{const result=await service.wait(start(operation,input));assert.equal(result.status,'SUCCEEDED',JSON.stringify(result.error));return result;};
  await job('repository.setup',{reviewer:'Human',projects:[]});await job('workflow.create',{requirementId:'REQ-001',featureId:'first',title:'First'});await job('workflow.create',{requirementId:'REQ-001',featureId:'second',title:'Second'});
  const selection={requirementId:'REQ-001',featureId:'first',confirmedKey:'REQ-001/first'},metadata=()=>service.readFile(repositoryId,'spec/REQ-001/first/feature.yaml');
  return {...f,repositoryId,service,start,job,selection,metadata,async close(){await service.close();closed=true;}};
}
test('deletion is durable, preserves source/history and siblings, and exports a compatible toolkit',async t=>{
  const f=await setup(t),before=await f.service.readFile(f.repositoryId,'spec/REQ-001/first/first.feature'),metadata=await f.metadata();
  const result=await f.job('workflow.delete',{...f.selection,expectedRevision:metadata.revision});assert.equal(result.result.deleted,true);
  assert.deepEqual((await f.service.detail(f.repositoryId)).spec.features.map(f=>f.key),['REQ-001/second']);
  assert.equal((await f.service.readFile(f.repositoryId,before.path)).content,before.content);
  assert.ok(JSON.parse((await f.metadata()).content).deletedAt);
  await f.close();
  const service=await createWorkstation({home:f.home,toolkitRoot,allowLocal:true,autoAcquire:false});t.after(()=>service.close());assert.deepEqual((await service.detail(f.repositoryId)).spec.features.map(f=>f.key),['REQ-001/second']);
  const store=openStore(f.home);t.after(()=>store.close());await inDraftView(store.draft(f.repositoryId),async root=>{
    const {scan:portableScan}=await import(path.join(root,'.workbench-tools/spec-toolkit/index.mjs'));
    assert.deepEqual((await portableScan(root)).features.map(f=>f.key),['REQ-001/second']);
    assert.equal((await scan(root,{includeDeleted:true})).features.length,2);
  });
});
test('missing confirmation and stale deletion requests do not remove a requirement',async t=>{
  const f=await setup(t),metadata=await f.metadata();
  let r=await f.service.wait(f.start('workflow.delete',{...f.selection,confirmedKey:'wrong',expectedRevision:metadata.revision}));assert.equal(r.status,'FAILED');assert.equal(r.error.code,'CONFIRMATION_REQUIRED');
  await f.job('workflow.create',{requirementId:'REQ-002',featureId:'third',title:'Third'});
  r=await f.service.wait(f.start('workflow.delete',{...f.selection,expectedRevision:metadata.revision}));assert.equal(r.status,'FAILED');assert.equal(r.error.code,'DRAFT_REVISION_CHANGED');assert.equal((await f.service.detail(f.repositoryId)).spec.features.length,3);
});
test('deleted identifiers are reserved and stale editors cannot resurrect a requirement',async t=>{
  const f=await setup(t),metadata=await f.metadata(),before=await f.service.readFile(f.repositoryId,'spec/REQ-001/first/first.feature');
  await f.job('workflow.delete',{...f.selection,expectedRevision:metadata.revision});
  let r=await f.service.wait(f.start('repository.save',{kind:'source',path:before.path,content:before.content+'\n',expectedHash:before.sha256}));assert.equal(r.status,'FAILED');assert.equal(r.error.code,'FEATURE_DELETED');
  r=await f.job('workflow.create',{title:'New requirement'});assert.match(r.result.key,/^REQ-002\//);
});
test('deletion and long-running jobs exclude each other without blocking ordinary saves',async t=>{
  const f=await fixture(t);await mkdir(f.home,{recursive:true});const store=openStore(f.home);t.after(()=>store.close());store.register({id:'SPEC-lock',title:'Lock',remoteUrl:f.remote});
  const request=(operationId,operation)=>({schemaVersion:1,operationId,repositoryId:'SPEC-lock',operation,input:{}});
  store.enqueue(request('OP-long','workflow.develop'));assert.throws(()=>store.enqueue(request('OP-delete','workflow.delete')),{code:'REPOSITORY_BUSY'});store.enqueue(request('OP-save','repository.save'));
  store.finish('OP-long','SUCCEEDED',{});store.enqueue(request('OP-delete','workflow.delete'));assert.throws(()=>store.enqueue(request('OP-long-two','workflow.verify')),{code:'REPOSITORY_BUSY'});
});
test('deleted requirements reject restart and approval without clearing preserved tests or changing review bytes',async t=>{
  const f=await fixture(t);await specRepository(f.repo);
  const file=path.join(f.repo,'tests/REQ-001/login/login.steps.ts'),review=path.join(f.repo,'spec/REQ-001/review.json');
  const content='export const originalTest = Symbol("original test source");\n';await writeFile(file,content);
  await deleteFeature(f.repo,{requirementId:'REQ-001',featureId:'login',confirmedKey:'REQ-001/login'});
  const before=await readFile(review,'utf8'),state=await reviewState(f.repo,'REQ-001','login');
  await assert.rejects(restartReview(f.repo,{requirementId:'REQ-001',featureId:'login',stage:'gherkin',expectedDigest:state.hashes.tests}),{code:'FEATURE_DELETED'});
  await assert.rejects(confirm(f.repo,{requirementId:'REQ-001',featureId:'login',stage:'gherkin',expectedDigest:state.hashes.gherkin,confirmedBy:'Human'}),{code:'FEATURE_DELETED'});
  assert.equal(await readFile(file,'utf8'),content);assert.equal(await readFile(review,'utf8'),before);
});
