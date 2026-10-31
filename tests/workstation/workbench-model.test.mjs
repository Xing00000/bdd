import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fixture, git, repository, specRepository, commitAll, toolkitRoot } from './helpers.mjs';
import { createWorkstation } from '../../packages/workstation/service.mjs';
import { createStandaloneServer } from '../../packages/workstation/http.mjs';
import { openStore } from '../../packages/workstation/store.mjs';
import { projectFiles, readProjectFile, saveProjectFile, configureFeature, installDependencies } from '../../packages/workstation/repository-actions.mjs';
import { digest, identity, writeJson, readJson, exists } from '../../packages/contracts/index.mjs';
import { remoteName } from '../../packages/git-core/index.mjs';

async function setupProduct(root, product, projectId='product') {
  await specRepository(root);const commit=await repository(product,{'message.txt':'Original\n','.env':'private fixture value'});
  await git.addModule(root,{projectId,url:product,commit},await git.inspect(root));
  const config=await readJson(path.join(root,'workbench.yaml'));config.projects=[{id:projectId,path:`projects/${projectId}`}];await writeJson(path.join(root,'workbench.yaml'),config);await commitAll(root);
}
test('primary entry serves the workstation, not old requirements or global projects',async t=>{
  const f=await fixture(t),app=await createStandaloneServer({autoAcquire:false,home:f.home,toolkitRoot,allowLocal:true});t.after(()=>app.close());await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${app.server.address().port}`;
  const page=await fetch(origin);assert.equal(page.status,200);const html=await page.text();assert.match(html,/工作台 → Spec Repo → Project/);assert.ok(!html.includes('既有工作台'));assert.ok(!html.includes('舊版工作區'));
  for(const route of ['/requirements','/projects','/repository-api/v1/workspaces'])assert.equal((await fetch(origin+route)).status,404,route);
  const model=await (await fetch(origin+'/repository-api/v1/workbench')).json();assert.equal(model.model,'workbench/spec-repositories/projects');
  const pkg=await readJson(path.join(toolkitRoot,'package.json'));assert.equal(pkg.scripts.start,'node scripts/workstation.mjs serve');
});
test('schema 2 bindings become SpecRepositories without losing IDs, receipts or unfinished operations',async t=>{
  const f=await fixture(t);await mkdir(f.home);
  const db=new DatabaseSync(path.join(f.home,'metadata.sqlite'));
  db.exec(`PRAGMA foreign_keys=ON;CREATE TABLE workspaces(id TEXT PRIMARY KEY,title TEXT,remote_url TEXT,branch TEXT,created_at TEXT);
    CREATE TABLE operations(id TEXT PRIMARY KEY,workspace_id TEXT REFERENCES workspaces(id),request_hash TEXT,request_json TEXT,status TEXT,worker_pid INTEGER,result_json TEXT,error_json TEXT,created_at TEXT,started_at TEXT,finished_at TEXT);
    CREATE TABLE runs(id TEXT PRIMARY KEY,workspace_id TEXT REFERENCES workspaces(id),state TEXT,result_json TEXT,updated_at TEXT);
    CREATE TABLE report_index(workspace_id TEXT REFERENCES workspaces(id),report_key TEXT,run_id TEXT,requirement_id TEXT,feature_id TEXT,manifest_hash TEXT,entry_json TEXT,invalid_reason TEXT,indexed_at TEXT,PRIMARY KEY(workspace_id,report_key));PRAGMA user_version=2;`);
  const original={schemaVersion:1,operationId:'OP-old',workspaceId:'WS-old',operation:'workspace.validate',input:{}};
  db.prepare('INSERT INTO workspaces VALUES(?,?,?,?,?)').run('WS-old','Existing Spec','/fixture.git','main','2025-01-01');
  db.prepare('INSERT INTO operations(id,workspace_id,request_hash,request_json,status,created_at) VALUES(?,?,?,?,?,?)').run('OP-old','WS-old',identity(original),JSON.stringify(original),'FAILED','2025-01-01');
  db.prepare('INSERT INTO runs VALUES(?,?,?,?,?)').run('RUN-old','WS-old','SEALED',JSON.stringify({runId:'RUN-old',testedSpecCommit:'a'.repeat(40)}),'2025-01-01');db.close();
  const store=openStore(f.home);t.after(()=>store.close());assert.equal(store.repository('WS-old').title,'Existing Spec');assert.equal(store.get('OP-old').request.repositoryId,'WS-old');assert.equal(store.get('OP-old').request.operation,'repository.validate');assert.equal(store.get('OP-old').request.workspaceId,undefined);assert.equal(store.runs('WS-old')[0].id,'RUN-old');assert.ok(await exists(path.join(f.home,'before-repository-model-v3.sqlite')));
  const verify=new DatabaseSync(path.join(f.home,'metadata.sqlite'));assert.equal(verify.prepare('PRAGMA user_version').get().user_version,8);assert.equal(verify.prepare("SELECT name FROM sqlite_schema WHERE name='workspaces'").get(),undefined);assert.deepEqual(JSON.parse(verify.prepare('SELECT original_request_json FROM operations').get().original_request_json),original);verify.close();
});
test('old checkout directories move once and conflicting copies are never merged or overwritten',async t=>{
  const f=await fixture(t);await mkdir(path.join(f.home,'workspaces','WS-old','repo'),{recursive:true});await writeFile(path.join(f.home,'workspaces','WS-old','repo','draft.txt'),'unsaved');
  const service=await createWorkstation({autoAcquire:false,home:f.home,toolkitRoot,allowLocal:true});await service.close();assert.equal(await readFile(path.join(f.home,'repositories','WS-old','repo','draft.txt'),'utf8'),'unsaved');assert.equal(await exists(path.join(f.home,'workspaces')),false);
  await mkdir(path.join(f.home,'workspaces'));await assert.rejects(createWorkstation({autoAcquire:false,home:f.home,toolkitRoot,allowLocal:true}),{code:'CHECKOUT_MIGRATION_CONFLICT'});
});
test('same Project ID under different Spec repos never shares file writes',async t=>{
  const f=await fixture(t),a=path.join(f.base,'alpha'),b=path.join(f.base,'beta');await setupProduct(a,path.join(f.base,'source-a'));await setupProduct(b,path.join(f.base,'source-b'));
  await git.branch(path.join(a,'projects/product'),{name:'development',create:true},await git.inspect(path.join(a,'projects/product')));
  const before=await readProjectFile(a,'product','message.txt',git);
  await saveProjectFile(a,{projectId:'product',path:'message.txt',content:'Alpha only',expectedHash:before.sha256},git,await git.inspect(path.join(a,'projects/product')));
  assert.equal((await readProjectFile(a,'product','message.txt',git)).content,'Alpha only');assert.equal((await readProjectFile(b,'product','message.txt',git)).content,'Original\n');
  await assert.rejects(readProjectFile(b,'nonexistent','message.txt',git),{code:'PROJECT_NOT_INITIALIZED'});
});
test('project editing rejects detached HEAD, stale content and secret paths',async t=>{
  const f=await fixture(t);await setupProduct(f.repo,path.join(f.base,'source'));const target=path.join(f.repo,'projects/product');
  const file=await readProjectFile(f.repo,'product','message.txt',git);
  await assert.rejects(saveProjectFile(f.repo,{projectId:'product',path:'message.txt',content:'x',expectedHash:file.sha256},git,await git.inspect(target)),{code:'DETACHED_HEAD'});
  await git.branch(target,{name:'fix',create:true},await git.inspect(target));await writeFile(path.join(target,'message.txt'),'concurrent');
  await assert.rejects(saveProjectFile(f.repo,{projectId:'product',path:'message.txt',content:'x',expectedHash:file.sha256},git,await git.inspect(target)),{code:'CONTENT_CHANGED'});
  await assert.rejects(readProjectFile(f.repo,'product','.env',git),{code:'SOURCE_PATH_DENIED'});assert.ok(!(await projectFiles(f.repo,'product',git)).files.includes('.env'));
});
test('feature configuration refuses Projects owned by another repo',async t=>{
  const f=await fixture(t);await specRepository(f.repo);const file=await readFile(path.join(f.repo,'spec/REQ-001/login/feature.yaml'));
  await assert.rejects(configureFeature(f.repo,{requirementId:'REQ-001',featureId:'login',expectedHash:digest(file),projectIds:['foreign'],caseIds:['CASE-001'],profiles:['chromium']}),{code:'UNKNOWN_PROJECT'});assert.deepEqual(await readFile(path.join(f.repo,'spec/REQ-001/login/feature.yaml')),file);
});
test('named remote pushes use the selected destination and compare previous settings',async t=>{
  const f=await fixture(t);await repository(f.repo);const remoteA=path.join(f.base,'a.git'),remoteB=path.join(f.base,'b.git');for(const r of [remoteA,remoteB])await git.command(undefined,['init','--bare','--initial-branch','main',r]);
  await git.configureRemote(f.repo,{action:'add',name:'origin',url:remoteA},await git.inspect(f.repo));await git.configureRemote(f.repo,{action:'add',name:'backup',url:remoteA,pushUrl:remoteB},await git.inspect(f.repo));
  const receipt=await git.push(f.repo,{remote:'backup',branch:'main'},await git.inspect(f.repo));assert.equal(receipt.remoteUrl,remoteB);assert.equal((await git.command(undefined,['--git-dir',remoteB,'rev-parse','main'])).stdout.trim(),receipt.localCommit);assert.equal((await git.command(undefined,['--git-dir',remoteA,'show-ref'],{allowFailure:true})).exitCode,1);
  await assert.rejects(git.configureRemote(f.repo,{action:'update',name:'backup',url:remoteA,previous:{}},await git.inspect(f.repo)),{code:'REMOTE_CHANGED'});
  const backup=(await git.remotes(f.repo)).find(x=>x.name==='backup');await git.configureRemote(f.repo,{action:'remove',name:'backup',previous:backup},await git.inspect(f.repo));assert.equal((await git.remotes(f.repo)).length,1);
});
test('remote branch resolution pins an actual commit and invalid names cannot become Git options',async t=>{
  const f=await fixture(t);const commit=await repository(f.repo);assert.equal(await git.remoteHead(f.repo,'main'),commit);for(const name of ['-c','a/b','x y','../a'])assert.throws(()=>remoteName(name));
  await assert.rejects(git.remoteHead(f.repo,'missing'));
});
test('browser cannot confirm tests without a check receipt for the current input digest',async t=>{
  const f=await fixture(t);const service=await createWorkstation({autoAcquire:false,home:f.home,toolkitRoot,allowLocal:true});t.after(()=>service.close());service.register({id:'SPEC-test',title:'Spec',remoteUrl:f.remote});const root=path.join(f.home,'repositories','SPEC-test','repo');await specRepository(root);
  const {reviewState,confirm}=await import('../../packages/spec-toolkit/index.mjs');for(const stage of ['gherkin','sd']){const r=await reviewState(root,'REQ-001','login');await confirm(root,{requirementId:'REQ-001',featureId:'login',stage,expectedDigest:r.hashes[stage],confirmedBy:'Unit policy fixture'});}
  const review=await reviewState(root,'REQ-001','login');service.enqueue({schemaVersion:1,operationId:'OP-check-required',repositoryId:'SPEC-test',operation:'spec.review.confirm',expected:await git.inspect(root),input:{requirementId:'REQ-001',featureId:'login',stage:'tests',expectedDigest:review.hashes.tests,confirmedBy:'Reviewer'}});
  const result=await service.wait('OP-check-required');assert.equal(result.status,'FAILED');assert.equal(result.error.code,'TEST_CHECK_REQUIRED');assert.equal((await reviewState(root,'REQ-001','login')).confirmed.tests,false);
});
test('dependency installation is never implicitly enabled by UI configuration',async t=>{
  const f=await fixture(t);await specRepository(f.repo);await assert.rejects(installDependencies(f.repo,false),{code:'EXECUTION_DISABLED'});
});
