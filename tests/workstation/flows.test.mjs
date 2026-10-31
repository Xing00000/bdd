import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fixture, git, repository, toolkitRoot, commitAll, approve } from './helpers.mjs';
import { createWorkstation } from '../../packages/workstation/service.mjs';
import { digest, readJson, writeJson, exists, identity } from '../../packages/contracts/index.mjs';
import { prepareRun } from '../../packages/spec-toolkit/engine.mjs';
import { ensureInstallation } from '../../packages/workstation/flows.mjs';

async function setup(t,{product=true}={}) {
  const f=await fixture(t);await git.command(undefined,['init','--bare','--initial-branch','main',f.remote]);
  const source=path.join(f.base,'product'),productRemote=path.join(f.base,'product.git');
  if(product){await repository(source,{'message.txt':'before'});await git.command(undefined,['init','--bare','--initial-branch','main',productRemote]);await git.command(source,['remote','add','origin',productRemote]);await git.push(source,{},await git.inspect(source));}
  const service=await createWorkstation({home:f.home,toolkitRoot,allowLocal:true});t.after(()=>service.close());
  service.register({id:'SPEC-flow',title:'Flow',remoteUrl:f.remote});
  let sequence=0;
  async function job(operation,input={}, {fail=false}={}) {
    const detail=await service.detail('SPEC-flow');const request={schemaVersion:1,repositoryId:'SPEC-flow',operationId:`OP-${++sequence}`,operation,input,expected:typeof detail.state==='object'?detail.state:{head:null}};
    service.enqueue(request);const result=await service.wait(request.operationId);if(!fail)assert.equal(result.status,'SUCCEEDED',JSON.stringify(result.error));return result;
  }
  const setupInput={reviewer:'Human',projects:product?[{id:'product',url:productRemote}]:[]};
  await job('repository.setup',setupInput);
  const root=path.join(f.home,'repositories/SPEC-flow/repo');
  return {...f,source,productRemote,root,service,job,setupInput};
}

test('single setup clones initializes saves and binds products without pushing or installing',async t=>{
  const f=await setup(t),d=await f.service.detail('SPEC-flow');assert.equal(d.preferences.configured,true);assert.equal(d.state.clean,true);assert.equal(d.modules.length,1);
  assert.equal(d.dependencies.installed,false);assert.equal((await git.command(undefined,['--git-dir',f.remote,'show-ref'],{allowFailure:true})).exitCode,1);
  const before=d.state.head;await f.job('repository.setup',f.setupInput);assert.equal((await f.service.detail('SPEC-flow')).state.head,before);
});
test('source save automatically versions only the selected file and keeps unrelated staging intact',async t=>{
  const f=await setup(t);await f.job('workflow.create',{requirementId:'REQ-001',featureId:'login',title:'Login',projectIds:['product']});
  const relative='spec/REQ-001/login/login.sd.md',bytes=await readFile(path.join(f.root,relative));
  await writeFile(path.join(f.root,'external.txt'),'not selected');await git.command(f.root,['add','external.txt']);
  await f.job('repository.save',{kind:'source',path:relative,expectedHash:digest(bytes),content:'New human design'});
  assert.equal((await git.command(f.root,['show',`HEAD:${relative}`])).stdout,'New human design');
  assert.equal((await git.command(f.root,['cat-file','-e','HEAD:external.txt'],{allowFailure:true})).exitCode,128);
  assert.equal((await git.command(f.root,['show',':external.txt'])).stdout,'not selected');
  const conflicting=await f.job('repository.save',{kind:'source',path:relative,expectedHash:digest(bytes),content:'stale'}, {fail:true});assert.equal(conflicting.error.code,'CONTENT_CHANGED');
  assert.equal(await readFile(path.join(f.root,relative),'utf8'),'New human design');
});
test('saving detached product automatically records its version and parent gitlink, entirely offline',async t=>{
  const f=await setup(t),target=path.join(f.root,'projects/product'),before=(await git.modules(f.root))[0].commit;
  assert.equal((await git.inspect(target)).branch,null);
  await f.job('repository.save',{kind:'project',projectId:'product',path:'message.txt',expectedHash:digest('before'),content:'after'});
  const after=(await git.modules(f.root))[0];assert.notEqual(after.commit,before);assert.equal(after.actual,after.commit);assert.equal(after.dirty,false);assert.equal((await git.inspect(f.root)).clean,true);
  assert.equal((await git.command(undefined,['--git-dir',f.productRemote,'show','main:message.txt'])).stdout,'before');
  assert.equal((await git.command(undefined,['--git-dir',f.remote,'show-ref'],{allowFailure:true})).exitCode,1);
});
test('formal candidate can clone an unpushed product version without a remote sync',async t=>{
  const f=await setup(t);await f.job('workflow.create',{requirementId:'REQ-001',featureId:'login',title:'Login',projectIds:['product']});
  await f.job('repository.save',{kind:'project',projectId:'product',path:'message.txt',expectedHash:digest('before'),content:'local-only'});
  await writeJson(path.join(f.root,'package-lock.json'),{lockfileVersion:3,packages:{}});await approve(f.root);
  const candidate=await prepareRun({root:f.root,home:f.home,repositoryId:'SPEC-flow',git,input:{requirementId:'REQ-001',featureId:'login',expected:await git.inspect(f.root)}});
  assert.equal(await readFile(path.join(f.home,'executions',candidate.runId,'repo/projects/product/message.txt'),'utf8'),'local-only');
  assert.equal((await git.command(undefined,['--git-dir',f.productRemote,'show','main:message.txt'])).stdout,'before');
});
test('one remote sync publishes saved products before specification references and is repeatable',async t=>{
  const f=await setup(t);await f.job('repository.save',{kind:'project',projectId:'product',path:'message.txt',expectedHash:digest('before'),content:'synchronized'});
  const result=(await f.job('repository.sync')).result;assert.equal(result.status,'SYNCED');assert.deepEqual(result.completed.map(x=>x.kind),['project','spec']);
  const pinned=(await git.modules(f.root))[0].commit;
  assert.equal((await git.command(undefined,['--git-dir',f.productRemote,'rev-parse','main'])).stdout.trim(),pinned);
  assert.match((await git.command(undefined,['--git-dir',f.remote,'ls-tree','main','projects/product'])).stdout,new RegExp(pinned));
  const sha=await git.resolve(f.root);await f.job('repository.sync');assert.equal(await git.resolve(f.root),sha);
});
test('sync conflicts preserve local and remote histories and perform no product push',async t=>{
  const f=await setup(t);await f.job('repository.sync');const other=path.join(f.base,'other');await git.clone(f.remote,other);
  await writeFile(path.join(other,'remote-change.txt'),'remote');await commitAll(other);await git.push(other,{},await git.inspect(other));
  await f.job('workflow.create',{requirementId:'REQ-001',featureId:'login',title:'Local',projectIds:['product']});
  await f.job('repository.save',{kind:'project',projectId:'product',path:'message.txt',expectedHash:digest('before'),content:'local'});
  const before=await git.inspect(f.root),remote=(await git.command(undefined,['--git-dir',f.remote,'rev-parse','main'])).stdout.trim();
  const result=await f.job('repository.sync',{}, {fail:true});assert.equal(result.error.code,'SYNC_CONFLICT');assert.equal(result.error.details.sync.completed.length,0);
  assert.deepEqual(await git.inspect(f.root),before);assert.equal((await git.command(undefined,['--git-dir',f.remote,'rev-parse','main'])).stdout.trim(),remote);
  assert.equal((await git.command(undefined,['--git-dir',f.productRemote,'show','main:message.txt'])).stdout,'before');
});
test('sync never adopts a changed push destination without a new setup',async t=>{
  const f=await setup(t),evil=path.join(f.base,'other.git');await git.command(undefined,['init','--bare',evil]);await git.command(f.root,['remote','set-url','--push','origin',evil]);
  const result=await f.job('repository.sync',{}, {fail:true});assert.equal(result.error.code,'SYNC_DESTINATION_CHANGED');assert.equal((await git.command(undefined,['--git-dir',evil,'show-ref'],{allowFailure:true})).exitCode,1);
});
test('uncontested incoming versions synchronize without exposing Git steps',async t=>{
  const f=await setup(t,{product:false});await f.job('repository.sync');const other=path.join(f.base,'other');await git.clone(f.remote,other);
  await writeFile(path.join(other,'README.md'),'Incoming');await commitAll(other);await git.push(other,{},await git.inspect(other));
  await f.job('repository.sync');assert.equal(await readFile(path.join(f.root,'README.md'),'utf8'),'Incoming');
});
test('dependency plan is one consent for required packages and browsers and rejects stale consent before installation',async t=>{
  const f=await setup(t);const options={home:f.home,enableExecution:true,browserRoot:path.join(f.home,'browsers')};const request={repositoryId:'SPEC-flow',input:{}};
  let prompt;
  try{await ensureInstallation({root:f.root,options,request,profiles:['chromium','firefox'],git});assert.fail('expected consent');}catch(error){assert.equal(error.code,'INSTALL_REQUIRED');prompt=error.details.install;}
  assert.deepEqual(prompt.browsers,['chromium','firefox']);assert.equal(prompt.lifecycleScripts,false);assert.ok(prompt.packages['playwright-bdd']);
  assert.equal(await exists(path.join(f.root,'node_modules')),false);assert.equal(await exists(path.join(f.root,'package-lock.json')),false);
  const pkg=await readJson(path.join(f.root,'package.json'));pkg.version='2.0.0';await writeJson(path.join(f.root,'package.json'),pkg);
  await assert.rejects(ensureInstallation({root:f.root,options,request:{...request,input:{installConsent:prompt.digest}},git}),{code:'INSTALL_REQUIRED'});
  assert.equal(await exists(path.join(f.root,'node_modules')),false);
});
test('recorded installation is reused, but missing browsers request a single new repair consent',async t=>{
  const f=await setup(t),browserRoot=path.join(f.home,'browsers');await mkdir(browserRoot);const executable=path.join(browserRoot,'chromium');await writeFile(executable,'fixture only');
  await mkdir(path.join(f.root,'node_modules/.bin'),{recursive:true});for(const name of ['bddgen','playwright'])await writeFile(path.join(f.root,'node_modules/.bin',name),'fixture only');
  const definition={packageHash:digest(await readFile(path.join(f.root,'package.json'))),lock:null,profiles:['chromium'],browserRoot,runtime:process.versions.node.split('.')[0]};
  await writeJson(path.join(f.root,'.runtime/flow-installation.json'),{digest:identity(definition),browserFiles:[executable]});
  const context={root:f.root,options:{home:f.home,enableExecution:true,browserRoot},request:{repositoryId:'SPEC-flow',input:{}},git};assert.deepEqual(await ensureInstallation(context),{installed:false});
  await rm(executable);await assert.rejects(ensureInstallation(context),{code:'INSTALL_REQUIRED'});
});
test('review progresses only on human content confirmation; execution remains opt-in',async t=>{
  const f=await setup(t);await f.job('workflow.create',{requirementId:'REQ-001',featureId:'login',title:'Login'});
  let d=await f.service.detail('SPEC-flow'),feature=d.spec.features[0];
  await f.job('workflow.review',{requirementId:'REQ-001',featureId:'login',stage:'gherkin',expectedDigest:feature.review.hashes.gherkin});
  d=await f.service.detail('SPEC-flow');assert.equal(d.spec.features[0].review.stage,'SD');assert.equal(d.state.clean,true);
  const result=await f.job('workflow.verify',{requirementId:'REQ-001',featureId:'login'}, {fail:true});assert.equal(result.error.code,'REVIEWS_REQUIRED');
  await assert.rejects(ensureInstallation({root:f.root,options:{home:f.home,enableExecution:false},request:{input:{}},git}),{code:'EXECUTION_DISABLED'});
});
