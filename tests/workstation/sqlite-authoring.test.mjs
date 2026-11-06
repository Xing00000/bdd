import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir,readFile,writeFile,rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { fixture,git,toolkitRoot,repository,specRepository } from './helpers.mjs';
import { createWorkstation } from '../../packages/workstation/service.mjs';
import { openStore } from '../../packages/workstation/store.mjs';
import { digest,exists } from '../../packages/contracts/index.mjs';

async function scenario(t,{existing=false}={}) {
  const f=await fixture(t),root=path.join(f.home,'repositories','SPEC-sql','repo');
  if(existing)await specRepository(root);
  const options={autoAcquire:false,home:f.home,toolkitRoot,allowLocal:true};let service=await createWorkstation(options);
  t.after(()=>service.close());service.register({id:'SPEC-sql',title:'SQLite',remoteUrl:path.join(f.base,'unreachable.git')});
  let n=0;
  const job=async(operation,input={},fail=false)=>{
    const request={schemaVersion:1,repositoryId:'SPEC-sql',operationId:`SQL-${++n}`,operation,input,expected:{head:'f'.repeat(40)}};
    service.enqueue(request);const result=await service.wait(request.operationId);if(!fail)assert.equal(result.status,'SUCCEEDED',JSON.stringify(result.error));return result;
  };
  return {...f,root,job,get service(){return service;},async restart(){await service.close();service=await createWorkstation(options);return service;}};
}
const input={reviewer:'Xing',projects:[]};
async function createOfflineFeature(f,values) {
  // Feature creation is the Git boundary; subsequent authoring is deliberately offline.
  const remote=path.join(f.base,'unreachable.git');
  await git.command(undefined,['init','--bare','--initial-branch','main',remote]);
  const result=await f.job('workflow.create',values);
  await rm(remote,{recursive:true,force:true});
  return result;
}
test('settings defer the checkout and repeated offline saves preserve the creation checkpoint',async t=>{
  const f=await scenario(t);const setup=await f.job('repository.setup',input);assert.equal(setup.result.storage,'sqlite');assert.equal(await exists(f.root),false);
  const created=await createOfflineFeature(f,{title:'可以離線儲存',acceptance:'重啟後仍保留',guided:true});assert.equal(created.result.storage,'sqlite');const checkpoint=await git.inspect(f.root);
  const file='spec/REQ-001/feature/feature.feature',before=await f.service.readFile('SPEC-sql',file);
  await f.job('workflow.draft',{requirementId:'REQ-001',featureId:'feature',title:'可以離線儲存',acceptance:'重啟後仍保留\n斷線也能編輯',expectedHash:before.sha256});
  assert.deepEqual(await git.inspect(f.root),checkpoint);
  const db=new DatabaseSync(path.join(f.home,'metadata.sqlite'),{readOnly:true});
  assert.match(db.prepare('SELECT content FROM authoring_files WHERE repository_id=? AND path=?').get('SPEC-sql',file).content,/斷線也能編輯/);db.close();
  await f.restart();assert.match((await f.service.readFile('SPEC-sql',file)).content,/斷線也能編輯/);
  assert.equal((await f.service.detail('SPEC-sql')).preferences.reviewer,'Xing');
  assert.deepEqual(await git.inspect(f.root),checkpoint);
});
test('failed synchronization does not invalidate saving or lose prior content',async t=>{
  const f=await scenario(t);await f.job('repository.setup',input);await createOfflineFeature(f,{title:'保留需求',acceptance:'不遺失',guided:true});
  assert.equal((await f.job('repository.sync',{},true)).error.code,'ACCEPTANCE_CHECKPOINT_REQUIRED');
  const file='spec/REQ-001/feature/feature.sd.md',old=await f.service.readFile('SPEC-sql',file);
  const saved=await f.job('repository.save',{kind:'source',path:file,expectedHash:old.sha256,content:'# 同步失敗仍能儲存'});
  assert.equal(saved.result.saved,true);assert.match((await f.service.readFile('SPEC-sql',file)).content,/仍能儲存/);
});
test('legacy uncommitted setup files import once without requiring Git or clobbering staged data',async t=>{
  const f=await scenario(t,{existing:true}),cfg=path.join(f.root,'workbench.yaml');
  const original=await readFile(cfg,'utf8'),dirty=original.replace('180000','210000');await writeFile(cfg,dirty);
  await writeFile(path.join(f.root,'human.txt'),'staged draft');await git.command(f.root,['add','human.txt']);
  const before=await git.inspect(f.root);
  await f.job('repository.setup',{reviewer:'Xing',projects:[{id:'bdd',url:path.join(f.base,'missing-product.git')}]});
  assert.deepEqual(await git.inspect(f.root),before);assert.equal(await readFile(cfg,'utf8'),dirty);
  assert.match((await f.service.readFile('SPEC-sql','workbench.yaml')).content,/projects\/bdd/);
  assert.equal((await f.service.detail('SPEC-sql')).modules[0].id,'bdd');
});
test('same-file stale saves fail with a content conflict, not Git errors; history retains old versions',async t=>{
  const f=await scenario(t);await f.job('repository.setup',input);await createOfflineFeature(f,{title:'編輯',acceptance:'成功',guided:true});
  const file='spec/REQ-001/feature/feature.sd.md',old=await f.service.readFile('SPEC-sql',file);
  await f.job('repository.save',{kind:'source',path:file,expectedHash:old.sha256,content:'first'});
  const stale=await f.job('repository.save',{kind:'source',path:file,expectedHash:old.sha256,content:'stale'},true);
  assert.equal(stale.error.code,'CONTENT_CHANGED');assert.equal((await f.service.readFile('SPEC-sql',file)).content,'first');
  const db=new DatabaseSync(path.join(f.home,'metadata.sqlite'),{readOnly:true});assert.ok(db.prepare('SELECT count(*) n FROM authoring_history').get().n>=4);db.close();
});
test('human approvals persist in SQLite and do not need Git connectivity',async t=>{
  const f=await scenario(t);await f.job('repository.setup',input);await createOfflineFeature(f,{title:'確認需求',acceptance:'成功',guided:true});const checkpoint=await git.inspect(f.root);
  const feature=(await f.service.detail('SPEC-sql')).spec.features[0];
  await f.job('workflow.review',{requirementId:feature.requirementId,featureId:feature.id,stage:'gherkin',expectedDigest:feature.review.hashes.gherkin});
  await f.restart();assert.equal((await f.service.detail('SPEC-sql')).spec.features[0].review.stage,'SD');assert.deepEqual(await git.inspect(f.root),checkpoint);
});
test('save survives an unrelated running repository job',async t=>{
  const f=await scenario(t);await f.job('repository.setup',input);await createOfflineFeature(f,{title:'不被同步阻擋',acceptance:'儲存成功',guided:true});
  const store=openStore(f.home);store.enqueue({schemaVersion:1,operationId:'long-running',repositoryId:'SPEC-sql',operation:'repository.sync',input:{}});store.claim('long-running');
  const file='spec/REQ-001/feature/feature.sd.md',old=await f.service.readFile('SPEC-sql',file);
  await f.job('repository.save',{kind:'source',path:file,expectedHash:old.sha256,content:'# 儲存不被同步阻擋'});
  assert.equal((await f.service.readFile('SPEC-sql',file)).content,'# 儲存不被同步阻擋');
  assert.equal(store.get('long-running').status,'RUNNING');store.finish('long-running','SUCCEEDED',{});store.close();
});
test('durable save receipt is idempotent after restart; duplicate operation cannot create another version',async t=>{
  const f=await scenario(t);await f.job('repository.setup',input);
  const store=openStore(f.home),snapshot=store.draft('SPEC-sql'),request={operation:'fixture-save'};
  const args={expectedRevision:snapshot.revision,files:[{target:'spec',path:'tests/receipt.txt',content:'durable'}],operationId:'receipt-save',request};
  const first=store.saveDraft('SPEC-sql',args);store.close();const reopened=openStore(f.home);
  assert.deepEqual(reopened.saveDraft('SPEC-sql',args),first);assert.equal(reopened.draft('SPEC-sql').revision,first.revision);reopened.close();
});
test('failed multi-file SQLite transaction rolls back settings, files and revision together',async t=>{
  const f=await scenario(t);await f.job('repository.setup',input);const store=openStore(f.home),snapshot=store.draft('SPEC-sql');
  assert.throws(()=>store.saveDraft('SPEC-sql',{expectedRevision:snapshot.revision,settings:{reviewer:'wrong'},files:[{target:'spec',path:'tests/rollback.txt',content:'must rollback'},{target:'spec',path:'tests/bad.txt',content:'bad\0'}],operationId:'failed-save',request:{}}));
  assert.deepEqual(store.draft('SPEC-sql'),snapshot);store.close();
});
test('binding an existing Spec repo imports documents only on explicit acquisition',async t=>{
  const f=await scenario(t),source=path.join(f.base,'source');await specRepository(source);
  await git.command(undefined,['clone','--bare',source,path.join(f.base,'unreachable.git')]);
  await f.job('repository.setup',input);assert.equal((await f.service.detail('SPEC-sql')).spec.features.length,0);
  assert.equal((await f.job('repository.sync',{},true)).error.code,'ACCEPTANCE_CHECKPOINT_REQUIRED');assert.equal(await exists(f.root),false);
  await f.job('repository.acquire');assert.equal((await f.service.detail('SPEC-sql')).spec.features[0].key,'REQ-001/login');
  assert.equal((await f.job('repository.sync',{},true)).error.code,'ACCEPTANCE_CHECKPOINT_REQUIRED');
});
test('explicit incoming acquisition updates SQLite and sync cannot export an unaccepted draft',async t=>{
  const f=await scenario(t),source=path.join(f.base,'source'),remote=path.join(f.base,'unreachable.git');await specRepository(source);await git.command(undefined,['clone','--bare',source,remote]);
  await f.job('repository.setup',input);await f.job('repository.acquire');
  const relative='spec/REQ-001/login/login.sd.md',other=path.join(f.base,'other');await git.clone(remote,other);await writeFile(path.join(other,relative),'# Remote design update');
  await git.commitSelected(other,{paths:[relative],message:'remote update'},await git.inspect(other));await git.push(other,{},await git.inspect(other));
  const remoteHead=await git.resolve(other),localHead=await git.resolve(f.root);
  await f.job('repository.acquire');assert.equal((await f.service.readFile('SPEC-sql',relative)).content,'# Remote design update');
  assert.equal((await f.job('repository.sync',{},true)).error.code,'ACCEPTANCE_CHECKPOINT_REQUIRED');
  await f.job('repository.acquire');assert.equal((await f.service.readFile('SPEC-sql',relative)).content,'# Remote design update');
  assert.equal(await git.resolve(f.root),localHead);assert.equal((await git.command(undefined,['--git-dir',remote,'rev-parse','main'])).stdout.trim(),remoteHead);
});
test('a Project named spec cannot overwrite the Spec repository authoring namespace',async t=>{
  const f=await scenario(t);await f.job('repository.setup',{reviewer:'Xing',projects:[{id:'spec',url:path.join(f.base,'product.git')}]});
  const before=await f.service.readFile('SPEC-sql','package.json');
  await f.job('repository.save',{kind:'project',projectId:'spec',path:'package.json',expectedHash:null,content:'{"name":"product-only"}'});
  assert.equal((await f.service.readFile('SPEC-sql','package.json')).content,before.content);
  assert.equal((await f.service.readProjectFile('SPEC-sql','spec','package.json')).content,'{"name":"product-only"}');
});
test('restart recovers a committed SQLite save receipt even when the job completion record was interrupted',async t=>{
  const f=await scenario(t);await f.job('repository.setup',input);
  const store=openStore(f.home),request={schemaVersion:1,repositoryId:'SPEC-sql',operationId:'crash-after-commit',operation:'repository.save',input:{}};
  store.enqueue(request);store.claim(request.operationId);
  const snap=store.draft('SPEC-sql');const receipt=store.saveDraft('SPEC-sql',{expectedRevision:snap.revision,files:[{target:'spec',path:'tests/crash.txt',content:'committed'}],operationId:request.operationId,request});store.close();
  await f.restart();assert.equal(f.service.operation(request.operationId).status,'SUCCEEDED');assert.deepEqual(f.service.operation(request.operationId).result,receipt);
});

test('the first upgraded settings save accepts the token of the form actually shown before SQLite import',async t=>{
  const f=await scenario(t,{existing:true});
  const store=openStore(f.home);store.setPreferences('SPEC-sql',{reviewer:'Previous',configured:true,schemaVersion:1});store.close();
  const shown=await f.service.detail('SPEC-sql');
  const saved=await f.job('repository.setup',{...input,expectedSettings:shown.settingsToken});
  assert.equal(saved.result.storage,'sqlite');assert.equal((await f.service.detail('SPEC-sql')).preferences.reviewer,'Xing');
  const stale=await f.job('repository.setup',{...input,reviewer:'Stale',expectedSettings:shown.settingsToken},true);
  assert.equal(stale.error.code,'SETTINGS_CHANGED');assert.equal((await f.service.detail('SPEC-sql')).preferences.reviewer,'Xing');
});
test('an unconfigured legacy checkout can save its first SQLite settings from the existing form',async t=>{
  const f=await scenario(t,{existing:true}),shown=await f.service.detail('SPEC-sql');
  await f.job('repository.setup',{...input,expectedSettings:shown.settingsToken});
  assert.equal((await f.service.detail('SPEC-sql')).preferences.configured,true);
});

test('optional Playwright timeout validates, persists without a service, and clears atomically',async t=>{
  const f=await scenario(t);await f.job('repository.setup',input);
  const config=async()=>JSON.parse((await f.service.readFile('SPEC-sql','workbench.yaml')).content);
  const before=await config();assert.equal(before.execution.globalTimeoutMs,undefined);
  for(const value of [999,600001,1000.5,'1000']) {
    const failed=await f.job('repository.setup',{...input,globalTimeoutMs:value},true);assert.equal(failed.error.code,'INVALID_GLOBAL_TIMEOUT');
    assert.deepEqual(await config(),before);
  }
  await f.job('repository.setup',{...input,globalTimeoutMs:1000});await f.restart();
  assert.equal((await f.service.detail('SPEC-sql')).preferences.globalTimeoutMs,1000);assert.equal((await config()).execution.globalTimeoutMs,1000);
  await f.job('repository.setup',{...input,globalTimeoutMs:600000});assert.equal((await config()).execution.globalTimeoutMs,600000);
  await f.job('repository.setup',{...input,globalTimeoutMs:null});assert.deepEqual(await config(),before);
});
