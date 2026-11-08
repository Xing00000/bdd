import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture,git,toolkitRoot} from './helpers.mjs';
import {createWorkstation} from '../../packages/workstation/service.mjs';
import {workflowNodes} from '../../src/domain/workflow-nodes.ts';
import {dispatch} from '../../packages/workstation/http.mjs';
import {DatabaseSync} from 'node:sqlite';
import {openStore} from '../../packages/workstation/store.mjs';
import {exists} from '../../packages/contracts/index.mjs';

const document='Feature: Account\n  @case:ACCOUNT-001\n  Scenario: Show account name\n    Given Ada has an account\n    When Ada signs in\n    Then Ada sees her account name\n';
async function setup(t){
  const f=await fixture(t);await git.command(undefined,['init','--bare','--initial-branch','main',f.remote]);
  const options={home:f.home,toolkitRoot,allowLocal:true};const service=await createWorkstation(options);
  t.after(()=>service.close());
  const repository=service.register({id:'SPEC-nodes',title:'Nodes',remoteUrl:f.remote});
  const request={schemaVersion:1,operationId:'OP-setup',repositoryId:repository.id,operation:'repository.setup',input:{reviewer:'Node contract verification',projects:[]}};
  service.enqueue(request);assert.equal((await service.wait(request.operationId)).status,'SUCCEEDED');
  return {f,service,repository,options};
}

test('node contracts preserve stage identity, validate replies and CAS, persist keys, and replay idempotently',async t=>{
  const {service,repository,options}=await setup(t);
  const detail=await service.detail(repository.id);
  const node=await service.readNode(detail.creationNodeId);
  assert.deepEqual(service.nodeDefinitions,workflowNodes);assert.equal(node.stage,'GHERKIN');
  for(const response of [{description:'x'}, {description:'x',gherkin:document,approve:true},{description:'x',gherkin:'Feature: Broken'}, {description:'x',gherkin:'# language: zh-TW\n'+document}]){
    await assert.rejects(()=>service.submitNode(node.key,response));
    assert.equal((await service.detail(repository.id)).spec.features.length,0);
  }
  const stale=await service.readNode(detail.creationNodeId);
  const response={description:'Original source\nKeep every line',gherkin:document};
  const receipt=await service.submitNode(node.key,response);
  assert.equal(receipt.status,'SUCCEEDED');assert.equal(receipt.saved,true);
  assert.deepEqual(await service.submitNode(node.key,response),receipt);
  await assert.rejects(()=>service.submitNode(node.key,{...response,description:'other'}),{code:'NODE_KEY_CONSUMED'});
  await assert.rejects(()=>service.submitNode(stale.key,response),{code:'NODE_REVISION_CHANGED'});
  const updated=await service.detail(repository.id),feature=updated.spec.features[0];
  assert.deepEqual(feature.nodes.map(node=>node.key),workflowNodes.map(node=>node.key));
  assert.deepEqual(feature.review.confirmed,{gherkin:false,sd:false,tests:false});
  const restored=await createWorkstation(options);
  try{assert.deepEqual(await restored.submitNode(node.key,response),receipt);}finally{await restored.close();}
  const sd=await service.readNode(feature.nodes.find(node=>node.key==='SD').nodeId);
  await assert.rejects(()=>service.submitNode(sd.key,{path:'spec/other/foreign.sd.md',content:'illegal'}),{code:'OUTPUT_CONTRACT_VIOLATION'});
  const design=await service.submitNode(sd.key,{path:sd.context.files[0].path,content:'# Design'});
  assert.equal(design.saved,true);
  const tests=await service.readNode(feature.nodes.find(node=>node.key==='TESTS').nodeId);
  const testContent="export const scenarioName='Account name';\n";
  await assert.rejects(()=>service.submitNode(tests.key,{path:tests.context.files[0].path,content:testContent}),{code:'UPSTREAM_NOT_CONFIRMED'});
  const implementation=await service.readNode(feature.nodes.find(node=>node.key==='IMPLEMENTATION').nodeId);
  assert(implementation.context.executionPreview.promptDigest);assert(implementation.context.executionPreview.agentSelection.agentRevisionId);
  await assert.rejects(()=>service.submitNode(implementation.key,{prompt:'Implement the reviewed account behavior'}),{code:'EXECUTION_DISABLED'});
  const verification=await service.readNode(feature.nodes.find(node=>node.key==='VERIFICATION').nodeId);
  await assert.rejects(()=>service.submitNode(verification.key,{run:true}),{code:'REVIEWS_REQUIRED'});
  assert.equal((await service.detail(repository.id)).spec.features[0].review.confirmed.gherkin,false);
});

test('Git conflicts only fail explicit export; node persistence and durable change events survive restart',async t=>{
  const {service,repository}=await setup(t),chat=await service.chat();
  let node=await service.readNode((await service.detail(repository.id)).creationNodeId);
  assert.equal((await service.submitNode(node.key,{description:'First',gherkin:document})).status,'SUCCEEDED');
  for(const operation of ['repository.acquire','repository.prepare']){
    const operationId=`OP-${operation.replaceAll('.','-')}`;service.enqueue({schemaVersion:1,operationId,repositoryId:repository.id,operation,input:{}});
    assert.equal((await service.wait(operationId)).status,'SUCCEEDED');
  }
  const detail=await service.detail(repository.id);
  await writeFile(path.join(detail.localPath,'README.md'),'External user modification\n');
  node=await service.readNode(detail.creationNodeId);
  const response={description:'Second source',gherkin:document.replace('Account','Notifications')};
  const receipt=await service.submitNode(node.key,response);
  assert.equal(receipt.status,'SUCCEEDED');assert.equal(receipt.saved,true);assert.equal(receipt.error,null);
  service.enqueue({schemaVersion:1,operationId:'OP-export-conflict',repositoryId:repository.id,operation:'repository.prepare',input:{}});
  const exported=await service.wait('OP-export-conflict');assert.equal(exported.status,'FAILED');assert.equal(exported.error.code,'EXPORT_CONFLICT');
  // Worker exit notification is asynchronous relative to the wait receipt.
  await new Promise((resolve,reject)=>{
    const check=async()=>{const snapshot=await chat.snapshot();if(snapshot.nodeChanges.some(change=>change.operationId===receipt.operationId))resolve();};
    const unsubscribe=chat.subscribe(()=>void check());
    const timer=setTimeout(()=>{unsubscribe();reject(Error('Missing persisted node event'));},10000);
    void check();t.after(()=>{unsubscribe();clearTimeout(timer);});
  });
  const change=(await chat.snapshot()).nodeChanges.find(change=>change.operationId===receipt.operationId);
  assert.equal(change.key,receipt.key);assert.equal(change.error,null);
  assert.equal((await service.detail(repository.id)).spec.features.length,2);
  assert.deepEqual(await service.submitNode(node.key,response),receipt);
});

test('HTTP exposes the same generic contracts and requires same-origin write authorization',async t=>{
  const {service,repository}=await setup(t),detail=await service.detail(repository.id);
  const node=(await dispatch(service,{method:'GET',url:`/repository-api/v1/nodes/${detail.creationNodeId}`,headers:{}})).body;
  assert(node.responseSchema);assert.equal(node.nodeId,detail.creationNodeId);
  await assert.rejects(()=>dispatch(service,{method:'POST',url:'/repository-api/v1/node-responses',headers:{},body:{key:node.key,response:{description:'x',gherkin:document}}}),{code:'REQUEST_HEADER_REQUIRED'});
  const saved=await dispatch(service,{method:'POST',url:'/repository-api/v1/node-responses',headers:{'x-workbench-request':'1'},body:{key:node.key,response:{description:'x',gherkin:document}}});
  assert.equal(saved.body.saved,true);assert.equal(saved.body.status,'SUCCEEDED');
});

test('schema 12 migration retains registry rows and foreign keys while enabling database-only workspaces',async t=>{
  const f=await fixture(t);await (await import('node:fs/promises')).mkdir(f.home,{recursive:true});
  const db=new DatabaseSync(path.join(f.home,'metadata.sqlite'));
  db.exec(`CREATE TABLE spec_repositories(id TEXT PRIMARY KEY,title TEXT NOT NULL,remote_url TEXT NOT NULL,branch TEXT,created_at TEXT NOT NULL,local_path TEXT);
    INSERT INTO spec_repositories VALUES('legacy','Original registry','https://github.com/example/legacy',NULL,'2026-01-01',NULL);
    CREATE TABLE authoring_state(repository_id TEXT PRIMARY KEY REFERENCES spec_repositories(id),revision INTEGER NOT NULL,settings_json TEXT NOT NULL,updated_at TEXT NOT NULL);
    INSERT INTO authoring_state VALUES('legacy',7,'{}','2026-01-01');
    PRAGMA user_version=12;`);db.close();
  const store=openStore(f.home);
  try{assert.equal(store.repository('legacy').title,'Original registry');assert.equal(store.draft('legacy').revision,7);assert.equal(store.register({id:'local',title:'Database only'}).remoteUrl,null);}finally{store.close();}
  const reopened=new DatabaseSync(path.join(f.home,'metadata.sqlite'));
  try{assert.equal(reopened.prepare('PRAGMA user_version').get().user_version,13);assert.deepEqual(reopened.prepare('PRAGMA foreign_key_check').all(),[]);}finally{reopened.close();}
});

test('a workspace without Git saves nodes and durable events across service restart',async t=>{
  const f=await fixture(t),options={home:f.home,toolkitRoot};let service=await createWorkstation(options);t.after(()=>service.close());
  const repository=service.register({id:'local',title:'Database truth'});
  service.enqueue({schemaVersion:1,operationId:'OP-setup',repositoryId:repository.id,operation:'repository.setup',input:{reviewer:'Database reviewer',projects:[]}});
  assert.equal((await service.wait('OP-setup')).status,'SUCCEEDED');
  const node=await service.readNode((await service.detail(repository.id)).creationNodeId);
  const saved=await service.submitNode(node.key,{description:'Original source',gherkin:document});
  assert.equal(saved.status,'SUCCEEDED');assert.equal(saved.saved,true);assert.equal(await exists(service.list()[0].localPath),false);
  await service.close();service=await createWorkstation(options);
  const content=await service.requirement(repository.id,saved.result.requirementId,saved.result.featureId);assert.equal(content.gherkin,document);
  const change=(await (await service.chat()).snapshot()).nodeChanges.find(change=>change.operationId===saved.operationId);
  assert.equal(change.key,saved.key);assert.equal(change.revision,saved.revision);
});
