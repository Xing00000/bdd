import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fixture, git, repository, toolkitRoot, commitAll, approve } from './helpers.mjs';
import { createWorkstation } from '../../packages/workstation/service.mjs';
import { digest, readJson, writeJson, exists, identity } from '../../packages/contracts/index.mjs';
import { prepareRun } from '../../packages/spec-toolkit/engine.mjs';
import { ensureInstallation } from '../../packages/workstation/flows.mjs';

async function setup(t,{product=true,prepare=true}={}) {
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
  if(prepare)await job('repository.prepare');
  return {...f,source,productRemote,root,service,job,setupInput};
}

test('single setup saves bindings to SQLite without cloning, pushing or installing',async t=>{
  const f=await setup(t,{prepare:false}),d=await f.service.detail('SPEC-flow');assert.equal(await exists(f.root),false);assert.equal(d.authoring.storage,'sqlite');assert.equal(d.preferences.configured,true);assert.equal(d.state.clean,true);assert.equal(d.modules.length,1);
  assert.equal(d.dependencies.installed,false);assert.equal((await git.command(undefined,['--git-dir',f.remote,'show-ref'],{allowFailure:true})).exitCode,1);
  const before=d.state.head;await f.job('repository.setup',f.setupInput);assert.equal((await f.service.detail('SPEC-flow')).state.head,before);
});
test('source save writes SQLite only; later export preserves unrelated staging',async t=>{
  const f=await setup(t);await f.job('workflow.create',{requirementId:'REQ-001',featureId:'login',title:'Login',projectIds:['product']});
  const relative='spec/REQ-001/login/login.sd.md',bytes=Buffer.from((await f.service.readFile('SPEC-flow',relative)).content);
  await writeFile(path.join(f.root,'external.txt'),'not selected');await git.command(f.root,['add','external.txt']);
  await f.job('repository.save',{kind:'source',path:relative,expectedHash:digest(bytes),content:'New human design'});
  assert.equal((await f.service.readFile('SPEC-flow',relative)).content,'New human design');
  assert.equal(await exists(path.join(f.root,relative)),false,'Save does not write the checkout');
  await f.job('repository.prepare');
  assert.equal((await git.command(f.root,['show',`HEAD:${relative}`])).stdout,'New human design');
  assert.equal((await git.command(f.root,['cat-file','-e','HEAD:external.txt'],{allowFailure:true})).exitCode,128);
  assert.equal((await git.command(f.root,['show',':external.txt'])).stdout,'not selected');
  const conflicting=await f.job('repository.save',{kind:'source',path:relative,expectedHash:digest(bytes),content:'stale'}, {fail:true});assert.equal(conflicting.error.code,'CONTENT_CHANGED');
  assert.equal(await readFile(path.join(f.root,relative),'utf8'),'New human design');
});
test('saving detached product uses SQLite, and explicit projection creates its Git version',async t=>{
  const f=await setup(t),target=path.join(f.root,'projects/product'),before=(await git.modules(f.root))[0].commit;
  assert.equal((await git.inspect(target)).branch,null);
  await f.job('repository.save',{kind:'project',projectId:'product',path:'message.txt',expectedHash:digest('before'),content:'after'});
  assert.equal((await git.modules(f.root))[0].commit,before,'Save must not alter gitlinks');
  assert.equal((await f.service.readProjectFile('SPEC-flow','product','message.txt')).content,'after');
  await f.job('repository.prepare');
  const after=(await git.modules(f.root))[0];assert.notEqual(after.commit,before);assert.equal(after.actual,after.commit);assert.equal(after.dirty,false);assert.equal((await git.inspect(f.root)).clean,true);
  assert.equal((await git.command(undefined,['--git-dir',f.productRemote,'show','main:message.txt'])).stdout,'before');
  assert.equal((await git.command(undefined,['--git-dir',f.remote,'show-ref'],{allowFailure:true})).exitCode,1);
});
test('formal candidate can clone an unpushed product version without a remote sync',async t=>{
  const f=await setup(t);await f.job('workflow.create',{requirementId:'REQ-001',featureId:'login',title:'Login',projectIds:['product']});
  await f.job('repository.save',{kind:'project',projectId:'product',path:'message.txt',expectedHash:digest('before'),content:'local-only'});
  await f.job('repository.prepare');
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
  await f.job('repository.prepare');
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
  const f=await setup(t);await f.job('workflow.create',{requirementId:'REQ-001',featureId:'login',title:'Login',guided:true,acceptance:'成功登入'});
  let d=await f.service.detail('SPEC-flow'),feature=d.spec.features[0];
  await f.job('workflow.review',{requirementId:'REQ-001',featureId:'login',stage:'gherkin',expectedDigest:feature.review.hashes.gherkin});
  d=await f.service.detail('SPEC-flow');assert.equal(d.spec.features[0].review.stage,'SD');assert.equal(d.state.clean,true);
  const result=await f.job('workflow.verify',{requirementId:'REQ-001',featureId:'login'}, {fail:true});assert.equal(result.error.code,'REVIEWS_REQUIRED');
  await assert.rejects(ensureInstallation({root:f.root,options:{home:f.home,enableExecution:false},request:{input:{}},git}),{code:'EXECUTION_DISABLED'});
});

// Regression: ordinary setup is allowed while other source files are still drafts.
test('reconfigure after editing unrelated files keeps staged and unstaged work intact', async t => {
  const f = await setup(t);
  await writeFile(path.join(f.root, 'draft.txt'), 'my ongoing draft');
  await writeFile(path.join(f.root, 'staged.txt'), 'already staged');
  await git.command(f.root, ['add', '--', 'staged.txt']);
  const before = await git.inspect(f.root);
  const result = await f.job('repository.setup', { ...f.setupInput, reviewer: 'Changed Reviewer' });
  assert.equal(result.result.ready, true);
  const after = await git.inspect(f.root);
  assert.deepEqual(after.changes, before.changes);
  assert.equal(await readFile(path.join(f.root, 'draft.txt'), 'utf8'), 'my ongoing draft');
  assert.equal((await git.command(f.root, ['show', ':staged.txt'])).stdout, 'already staged');
  assert.equal((await f.service.detail('SPEC-flow')).preferences.reviewer, 'Changed Reviewer');
});

test('adding a product after starting work does not discard unrelated drafts or staged changes', async t => {
  const f = await setup(t, { product: false });
  const productRoot = path.join(f.base, 'new-product'), url = path.join(f.base, 'new-product.git');
  await repository(productRoot, { 'src/feature.ts': 'export const ready = true;\n' });
  await git.command(undefined, ['init', '--bare', '--initial-branch', 'main', url]);
  await git.command(productRoot, ['remote', 'add', 'origin', url]);
  await git.push(productRoot, {}, await git.inspect(productRoot));
  await writeFile(path.join(f.root, 'draft.md'), 'human draft');
  await writeFile(path.join(f.root, 'staged.md'), 'preexisting staged');
  await git.command(f.root, ['add', '--', 'staged.md']);
  const result = await f.job('repository.setup', { reviewer: 'Human', projects: [{id:'myproduct', url}] });
  assert.equal(result.result.ready, true);
  assert.equal((await f.service.detail('SPEC-flow')).modules[0].id, 'myproduct');
  await f.job('repository.prepare');
  assert.equal((await git.modules(f.root))[0].id, 'myproduct');
  const after = await git.inspect(f.root);
  assert.deepEqual(after.changes.map(x => x.path).sort(), ['draft.md', 'staged.md']);
  assert.equal((await git.command(f.root, ['show', 'HEAD:staged.md'], {allowFailure:true})).exitCode, 128);
  assert.equal((await git.command(f.root, ['show', ':staged.md'])).stdout, 'preexisting staged');
});

test('reviewer-only settings do not modify or commit an unrelated configuration draft', async t => {
  const f = await setup(t, { product: false });
  const file = path.join(f.root, 'workbench.yaml');
  const before = await readFile(file, 'utf8');
  // A manual edit in the config must remain a draft when only the reviewer changes.
  await writeFile(file, before.replace('"timeoutMs": 180000', '"timeoutMs": 190000'));
  const local = await git.inspect(f.root);
  await f.job('repository.setup', { reviewer: 'New reviewer', projects: [] });
  assert.deepEqual((await git.inspect(f.root)).changes, local.changes);
  assert.equal(await readFile(file, 'utf8'), before.replace('"timeoutMs": 180000', '"timeoutMs": 190000'));
  assert.equal((await f.service.detail('SPEC-flow')).preferences.reviewer, 'New reviewer');
});

test('SQLite settings save accepts a new binding; export detects overlapping checkout edits', async t => {
  const f = await setup(t, { product: false });
  const file = path.join(f.root, 'workbench.yaml'), before = await readFile(file, 'utf8');
  await writeFile(file, before.replace('"timeoutMs": 180000', '"timeoutMs": 210000'));
  const productRoot = path.join(f.base, 'target'), url = path.join(f.base, 'target.git');
  await repository(productRoot, { 'src/main.js': 'console.log("hi")\n' });
  await git.command(undefined, ['init', '--bare', '--initial-branch', 'main', url]);
  await git.command(productRoot, ['remote', 'add', 'origin', url]);
  await git.push(productRoot, {}, await git.inspect(productRoot));
  const saved = await f.job('repository.setup', { reviewer: 'Human', projects: [{ id: 'target', url }] });
  assert.equal(saved.result.storage,'sqlite');
  const result = await f.job('repository.prepare', {}, { fail: true });
  assert.equal(result.error.code, 'EXPORT_CONFLICT');
  assert.equal((await git.modules(f.root)).length, 0);
  assert.equal(await readFile(file, 'utf8'), before.replace('"timeoutMs": 180000', '"timeoutMs": 210000'));
});

test('submodule registration respects an externally edited gitmodules file without clobbering it', async t => {
  const f = await setup(t, { product: false });
  await writeFile(path.join(f.root, '.gitmodules'), '# pending external edit\n');
  const target = path.join(f.base, 'product-extra');
  const head = await repository(target, { 'README.md': 'sample' });
  const before = await git.inspect(f.root);
  await f.job('repository.setup', { reviewer: 'Human', projects: [{ id: 'extra', url: target }] });
  const result = await f.job('repository.prepare', {}, { fail: true });
  assert.equal(result.error.code, 'SUBMODULE_SETTINGS_CONFLICT');
  assert.deepEqual(await git.inspect(f.root), before);
  assert.equal(await readFile(path.join(f.root, '.gitmodules'), 'utf8'), '# pending external edit\n');
});

test('plain-language requirement creates stable IDs and multiple Gherkin cases without requiring technical fields', async t => {
  const f=await setup(t,{product:false});
  const result=(await f.job('workflow.create',{title:'使用者登入',goal:'已有帳號的人希望登入',acceptance:'輸入正確密碼，能看到個人頁面\n- 密碼錯誤時顯示提示',guided:true})).result;
  assert.equal(result.key,'REQ-001/feature');
  const file=(await f.service.readFile('SPEC-flow','spec/REQ-001/feature/feature.feature')).content;
  assert.match(file,/Feature: 使用者登入/);assert.match(file,/目標：已有帳號的人希望登入/);
  assert.match(file,/@case:CASE-001/);assert.match(file,/@case:CASE-002/);
  assert.match(file,/Then 輸入正確密碼，能看到個人頁面/);
  assert.match(file,/Then 密碼錯誤時顯示提示/);
  const metadata=JSON.parse((await f.service.readFile('SPEC-flow','spec/REQ-001/feature/feature.yaml')).content);
  assert.deepEqual(metadata.caseIds,['CASE-001','CASE-002']);
  const requirement=JSON.parse((await f.service.readFile('SPEC-flow','spec/REQ-001/requirement.yaml')).content);
  assert.equal(requirement.title,'使用者登入');
  const next=(await f.job('workflow.create',{title:'退出登入',acceptance:'按下退出後進入未登入狀態',guided:true})).result;
  assert.equal(next.key,'REQ-002/feature');
  assert.equal((await git.inspect(f.root)).clean,true);
});

test('guided requirement revisions are saved locally and remain editable without Git knowledge', async t => {
  const f=await setup(t,{product:false});
  await f.job('workflow.create',{title:'會員登入',acceptance:'能顯示登入頁',guided:true});
  const pathname='spec/REQ-001/feature/feature.feature';
  const before=Buffer.from((await f.service.readFile('SPEC-flow',pathname)).content);
  const review=await f.job('workflow.draft',{requirementId:'REQ-001',featureId:'feature',title:'會員登入',goal:'使用者想登入',acceptance:'能進入首頁\n錯誤密碼顯示原因',expectedHash:digest(before)});
  assert.equal(review.result.saved,true);
  const meta=JSON.parse((await f.service.readFile('SPEC-flow','spec/REQ-001/feature/feature.yaml')).content);
  assert.deepEqual(meta.caseIds,['CASE-001','CASE-002']);
  assert.match((await f.service.readFile('SPEC-flow',pathname)).content,/Given 系統已準備好讓使用者操作 會員登入/);
  assert.equal((await git.inspect(f.root)).clean,true);
  assert.equal((await git.command(undefined,['--git-dir',f.remote,'show-ref'],{allowFailure:true})).exitCode,1);
  const stale=await f.job('workflow.draft',{requirementId:'REQ-001',featureId:'feature',title:'衝突覆寫',acceptance:'覆寫',expectedHash:digest(before)},{fail:true});
  assert.equal(stale.error.code,'CONTENT_CHANGED');
});

test('incomplete plain-language acceptance stays a draft and cannot be approved',async t=>{
  const f=await setup(t,{product:false});
  await f.job('workflow.create',{title:'搜尋',guided:true});
  const d=await f.service.detail('SPEC-flow'),feature=d.spec.features[0];
  const approved=await f.job('workflow.review',{requirementId:'REQ-001',featureId:'feature',stage:'gherkin',expectedDigest:feature.review.hashes.gherkin},{fail:true});
  assert.equal(approved.error.code,'ACCEPTANCE_REQUIRED');
  assert.equal((await f.service.detail('SPEC-flow')).spec.features[0].review.confirmed.gherkin,false);
});

test('editing a real Gherkin file disables guided overwrite protection',async t=>{
  const f=await setup(t,{product:false});await f.job('workflow.create',{title:'會員登入',acceptance:'能顯示登入頁',guided:true});
  const pathname='spec/REQ-001/feature/feature.feature';let old=Buffer.from((await f.service.readFile('SPEC-flow',pathname)).content);
  await f.job('repository.save',{kind:'source',path:pathname,content:'Feature: customized\n  Scenario: custom\n    Given I wrote my own steps\n',expectedHash:digest(old)});
  const result=await f.job('workflow.draft',{requirementId:'REQ-001',featureId:'feature',title:'不能覆蓋',acceptance:'xxx',expectedHash:digest(Buffer.from((await f.service.readFile('SPEC-flow',pathname)).content))},{fail:true});
  assert.equal(result.error.code,'ADVANCED_GHERKIN');
  assert.match((await f.service.readFile('SPEC-flow',pathname)).content,/customized/);
});
