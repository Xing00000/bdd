import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createWorkstation } from '../../packages/workstation/service.mjs';
import { createStandaloneServer } from '../../packages/workstation/http.mjs';
import { openStore } from '../../packages/workstation/store.mjs';
import { selectedCommit } from '../../packages/workstation/catalog.mjs';
import { prepareRegression, summarizeRegression, compareRegressions } from '../../packages/workstation/regression.mjs';
import { fixture, git, toolkitRoot, specRepository, repository, commitAll, sealedBundle } from './helpers.mjs';
import { readJson, writeJson, exists } from '../../packages/contracts/index.mjs';

async function bound(t,{empty=false, product=false}={}) {
  const f=await fixture(t), source=path.join(f.base,'spec-source');
  await git.command(undefined,['init','--bare','--initial-branch','main',f.remote]);
  let pinned;
  if(!empty) {
    await specRepository(source);
    if(product) {
      const target=path.join(f.base,'product');pinned=await repository(target,{'message.txt':'version one'});
      await git.addModule(source,{projectId:'product',url:target,commit:pinned},await git.inspect(source));
      const config=await readJson(path.join(source,'workbench.yaml'));config.projects=[{id:'product',path:'projects/product'}];await writeJson(path.join(source,'workbench.yaml'),config);await commitAll(source);
      await writeFile(path.join(target,'message.txt'),'version two');await commitAll(target);
    }
    await git.command(source,['remote','add','origin',f.remote]);await git.push(source,{},await git.inspect(source));
  }
  // These fixtures explicitly import historical commits and reports. Ordinary
  // registration stays deferred; acquisition is enabled only for this catalog fixture.
  const options={home:f.home,toolkitRoot,allowLocal:true,autoAcquire:true};const service=await createWorkstation(options);t.after(()=>service.close());
  const registered=service.register({id:'SPEC-bound',title:'Bound Spec',remoteUrl:f.remote});
  const result=await service.wait(registered.connection.operationId);
  assert.equal(result.status,'SUCCEEDED',JSON.stringify(result.error));
  const root=path.join(f.home,'repositories/SPEC-bound/repo');
  return {...f,source,root,service,options,pinned,registered};
}
async function job(f,operation,input={}) {
  const operationId=`OP-${crypto.randomUUID()}`;
  f.service.enqueue({schemaVersion:1,repositoryId:'SPEC-bound',operationId,operation,input});
  return f.service.wait(operationId);
}
test('explicit catalog acquisition imports the existing checkout, requirements and design',async t=>{
  const f=await bound(t);const d=await f.service.detail('SPEC-bound');
  assert.equal(d.connection.status,'READY');assert.equal(await exists(path.join(f.root,'.git')),true);
  assert.equal(d.spec.features.length,1);assert.equal(d.spec.features[0].key,'REQ-001/login');
  assert.match((await f.service.readFile('SPEC-bound','spec/REQ-001/login/login.sd.md')).content,/Fixture login/);
  assert.equal(d.connection.catalog.features.length,1);assert.ok(d.connection.localPath.endsWith('/repo'));
  assert.equal((await git.inspect(f.root)).clean,true);
});
test('binding restores the declared submodule version instead of its newer default branch',async t=>{
  const f=await bound(t,{product:true});const m=(await git.modules(f.root))[0];assert.equal(m.actual,f.pinned);assert.equal(m.commit,f.pinned);
  const d=await f.service.detail('SPEC-bound');assert.equal(d.preferences.projects[0].id,'product');
});
test('explicit acquisition initializes an empty workspace without committing or uploading',async t=>{
  const f=await bound(t,{empty:true});assert.equal(await exists(path.join(f.root,'workbench.yaml')),true);
  assert.equal((await git.inspect(f.root)).head,null);assert.equal((await git.inspect(f.root)).clean,false);assert.equal((await f.service.detail('SPEC-bound')).spec.features.length,0);
  assert.equal((await git.command(undefined,['--git-dir',f.remote,'show-ref'],{allowFailure:true})).exitCode,1);
});
test('a deferred binding survives a failed explicit acquisition with its settings and SQLite authoring',async t=>{
  const f=await fixture(t),service=await createWorkstation({home:f.home,toolkitRoot,allowLocal:true});t.after(()=>service.close());
  const r=service.register({id:'SPEC-bound',title:'Offline',remoteUrl:path.join(f.base,'missing.git')});
  assert.equal(await exists(path.join(f.home,'repositories/SPEC-bound')),true);
  assert.equal(r.connection.status,'DEFERRED');assert.equal(r.connection.operationId,undefined);
  assert.equal((await job({service},'repository.acquire')).status,'FAILED');
  assert.equal((await service.detail('SPEC-bound')).connection.status,'FAILED');
  const out=await job({service},'repository.setup',{reviewer:'Human',projects:[]});assert.equal(out.status,'SUCCEEDED');
  assert.equal((await service.detail('SPEC-bound')).preferences.reviewer,'Human');
});
test('binding auto-indexes evidence branches and older reports deleted from the current tip',async t=>{
  const f=await bound(t), testedSpecCommit=await git.resolve(f.source), runId='RUN-old';
  const prefix=path.join(f.source,'reports/REQ-001/login',runId);
  await sealedBundle(prefix,{runId,requirementId:'REQ-001',featureId:'login',testedSpecCommit});await commitAll(f.source);
  await rm(prefix,{recursive:true});await commitAll(f.source);await git.push(f.source,{},await git.inspect(f.source));
  const output=await job(f,'repository.acquire');assert.equal(output.status,'SUCCEEDED',JSON.stringify(output.error));
  const d=await f.service.detail('SPEC-bound');assert.ok(d.reports.some(x=>x.runId===runId));
  assert.equal(await exists(path.join(await f.service.artifactDirectory('SPEC-bound',runId),'report.json')),true);
});
test('read-only historical requirement/design browsing never changes HEAD, SQL drafts or staged content',async t=>{
  const f=await bound(t), old=await git.resolve(f.root);
  await writeFile(path.join(f.root,'draft.txt'),'keep');await git.command(f.root,['add','draft.txt']);
  const before=await git.inspect(f.root), db=new DatabaseSync(path.join(f.home,'metadata.sqlite'));
  const revision=db.prepare('SELECT revision FROM authoring_state').get().revision;db.close();
  const versions=await f.service.versions('SPEC-bound',old);assert.equal(versions.spec.features.length,1);
  const source=await f.service.versionFile('SPEC-bound',old,'spec/REQ-001/login/login.sd.md');assert.equal(source.readOnly,true);
  assert.deepEqual(await git.inspect(f.root),before);assert.equal((await f.service.detail('SPEC-bound')).authoring.revision,revision);
});
test('version selectors reject arbitrary revision expressions and project names outside the chosen spec',async t=>{
  const f=await bound(t);for(const ref of ['--help','HEAD~1','main^{tree}','main;id','../../secret'])await assert.rejects(selectedCommit(f.root,ref,git));
  const store=openStore(f.home);t.after(()=>store.close());
  await assert.rejects(prepareRegression({root:f.root,options:f.options,store,git,request:{repositoryId:'SPEC-bound',operationId:'OP-invalid',input:{specRef:'main',projects:{foreign:'main'}}}}),{code:'UNKNOWN_PROJECT'});
});
test('regression freezes all feature cases and project commits once; overrides do not change the bound checkout',async t=>{
  const f=await bound(t,{product:true});const before=await git.inspect(f.root),store=openStore(f.home);t.after(()=>store.close());
  const context={root:f.root,options:f.options,store,git,request:{repositoryId:'SPEC-bound',operationId:'OP-plan',input:{specRef:'main',projects:{product:'main'}}}};
  const batch=await prepareRegression(context);assert.equal(batch.features.length,1);assert.equal(batch.results[0].expectedCases,1);
  assert.notEqual(batch.projects[0].commit,f.pinned);assert.equal(batch.projects[0].recordedCommit,f.pinned);
  assert.deepEqual(await git.inspect(f.root),before);assert.equal((await git.modules(f.root))[0].actual,f.pinned);
  const resumed=await prepareRegression({...context,request:{...context.request,input:{...context.request.input,batchId:batch.batchId}}});assert.equal(resumed.testedSpecCommit,batch.testedSpecCommit);
  await assert.rejects(prepareRegression({...context,request:{...context.request,input:{specRef:'main',projects:{},batchId:batch.batchId}}}),{code:'REGRESSION_SELECTION_CHANGED'});
});
test('regression does not require historic human reviews and will not silently replace a missing lock',async t=>{
  const f=await bound(t),store=openStore(f.home);t.after(()=>store.close());
  const context={root:f.root,options:f.options,store,git,request:{repositoryId:'SPEC-bound',operationId:'OP-history',input:{specRef:'main'}}};
  assert.equal((await prepareRegression(context)).status,'PREPARED');
  await rm(path.join(f.source,'package-lock.json'));await commitAll(f.source);await git.push(f.source,{},await git.inspect(f.source));await git.fetch(f.root);
  await assert.rejects(prepareRegression(context),{code:'LOCKFILE_REQUIRED'});
});
test('whole-suite summary cannot pass zero, partial, cancelled, mismatched or errored features',()=>{
  for(const outcomes of [[],['PASSED','FAILED'],['PASSED','ERROR'],['PASSED','PENDING'],['PASSED','CANCELLED']])assert.notEqual(summarizeRegression(outcomes.map(outcome=>({outcome}))).outcome,'PASSED');
  assert.equal(summarizeRegression([{outcome:'PASSED'},{outcome:'PASSED'}]).outcome,'PASSED');
  assert.deepEqual(compareRegressions({results:[{key:'a',outcome:'FAILED'}]},{results:[{key:'a',outcome:'PASSED'}]}),[{key:'a',before:'PASSED',after:'FAILED'}]);
});
test('cancellation/interruption preserves partial batch outcomes and never grants an aggregate pass',async t=>{
  const f=await bound(t),store=openStore(f.home);t.after(()=>store.close());
  store.recordRegression('SPEC-bound',{batchId:'BATCH-fixture',operationId:'OP-fixture',status:'RUNNING',results:[{key:'a',outcome:'PASSED'},{key:'b',outcome:'RUNNING'},{key:'c',outcome:'PENDING'}]});
  store.interruptRegression('OP-fixture','CANCELLED');const r=store.regression('SPEC-bound','BATCH-fixture');assert.equal(r.outcome,'INCOMPLETE');assert.equal(r.results[0].outcome,'PASSED');assert.equal(r.results[2].outcome,'CANCELLED');
});
test('SQLite v6 migration preserves existing saved data while adding connection and suite indexes',async t=>{
  const f=await bound(t);const before=(await f.service.detail('SPEC-bound')).authoring.revision;
  const db=new DatabaseSync(path.join(f.home,'metadata.sqlite'));db.exec('PRAGMA user_version=6');db.close();
  const store=openStore(f.home);assert.equal(store.draft('SPEC-bound').revision,before);assert.equal(await exists(path.join(f.home,'before-catalog-regression-v7.sqlite')),true);store.close();
});
test('real HTTP defers registration and exposes history after explicit catalog acquisition',async t=>{
  const f=await fixture(t),source=path.join(f.base,'source');await specRepository(source);
  const app=await createStandaloneServer({home:f.home,toolkitRoot,allowLocal:true});t.after(()=>app.close());
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${app.server.address().port}`;
  const r=await fetch(origin+'/repository-api/v1/spec-repositories',{method:'POST',headers:{'content-type':'application/json','x-workbench-request':'1'},body:JSON.stringify({title:'Catalog',remoteUrl:source})});assert.equal(r.status,201);
  const record=await r.json();assert.equal(record.connection.status,'DEFERRED');assert.equal(record.connection.operationId,undefined);
  assert.equal(await exists(path.join(record.localPath,'.git')),false);
  const operationId=`OP-${crypto.randomUUID()}`;
  app.service.enqueue({schemaVersion:1,repositoryId:record.id,operationId,operation:'repository.acquire',input:{}});
  assert.equal((await app.service.wait(operationId)).status,'SUCCEEDED');
  const list=await (await fetch(`${origin}/repository-api/v1/spec-repositories/${record.id}/versions?ref=main`)).json();assert.equal(list.spec.features.length,1);
});

test('an explicitly acquired empty repository binds its saved product at feature creation',async t=>{
  const f=await bound(t,{empty:true}),target=path.join(f.base,'later-product');
  await repository(target,{'src/example.ts':'export const ready = true;\n'});
  const saved=await job(f,'repository.setup',{reviewer:'Human',projects:[{id:'product',url:target}]});assert.equal(saved.status,'SUCCEEDED',JSON.stringify(saved.error));
  const before=(await git.inspect(f.root)).head;
  const deferred=await job(f,'repository.prepare');assert.equal(deferred.error.code,'FEATURE_INITIALIZATION_REQUIRED');assert.equal((await git.inspect(f.root)).head,before);
  const prepared=await job(f,'workflow.create',{title:'Product binding',acceptance:'New product is initialized',guided:true,projectIds:['product']});assert.equal(prepared.status,'SUCCEEDED',JSON.stringify(prepared.error));
  assert.equal((await git.modules(f.root))[0].actual,await git.resolve(target));
  assert.equal((await git.command(undefined,['--git-dir',f.remote,'show-ref'],{allowFailure:true})).exitCode,1,'Preparing never uploads');
});
