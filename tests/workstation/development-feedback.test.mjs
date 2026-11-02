import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile,writeFile,unlink,mkdir } from 'node:fs/promises';
import { fixture,git,toolkitRoot,specRepository,approve,commitAll,sealedBundle,repository } from './helpers.mjs';
import { createWorkstation } from '../../packages/workstation/service.mjs';
import { openStore } from '../../packages/workstation/store.mjs';
import { reviewState } from '../../packages/spec-toolkit/index.mjs';
import { validateAgentSettings,agentExecutable,captureAgentProducts,readTerminal } from '../../packages/workstation/development.mjs';
import { workflowState } from '../../packages/workstation/workflow-state.mjs';
import { digest } from '../../packages/contracts/index.mjs';

async function job(service,operation,input={},repositoryId='SPEC-one') {
 const operationId=`OP-${crypto.randomUUID()}`;service.enqueue({schemaVersion:1,operationId,repositoryId,operation,input});return service.wait(operationId);
}
async function setup(t) {
 const f=await fixture(t);await specRepository(f.repo);await approve(f.repo);
 const baseline=(await reviewState(f.repo,'REQ-001','login')).hashes.tests;
 await sealedBundle(path.join(f.repo,'reports/REQ-001/login/RUN-history'),{runId:'RUN-history',specRepositoryId:'fixture-spec',requirementId:'REQ-001',featureId:'login',testedSpecCommit:await git.resolve(f.repo),baseline,projects:[],scope:'ALL_CASES',testOutcome:'PASSED',verification:'VERIFIED',coverageComplete:true,evidenceComplete:true,startedAt:'2026-01-01T00:00:00Z',finishedAt:'2026-01-01T00:00:10Z'});
 await commitAll(f.repo);const service=await createWorkstation({home:f.home,toolkitRoot,allowLocal:true});t.after(()=>service.close());
 const r=service.register({id:'SPEC-one',title:'Spec',remoteUrl:f.repo});assert.equal((await service.wait(r.connection.operationId)).status,'SUCCEEDED');
 assert.equal((await job(service,'repository.setup',{reviewer:'Reviewer',projects:[]})).status,'SUCCEEDED');return {...f,service};
}
test('feedback saves report identity in SQLite, preserves evidence, returns to development and survives restart',async t=>{
 const f=await setup(t),before=(await f.service.detail('SPEC-one')).spec.features[0];assert.equal(before.workflow.stage,'VERIFIED');
 const r=await job(f.service,'workflow.feedback',{requirementId:'REQ-001',featureId:'login',runId:'RUN-history',message:'登入後版面錯位'});assert.equal(r.status,'SUCCEEDED',JSON.stringify(r.error));assert.equal(r.result.nextStage,'IMPLEMENTATION');
 const after=(await f.service.detail('SPEC-one')).spec.features[0];assert.equal(after.workflow.stage,'IMPLEMENTATION');assert.notEqual(after.verification.status,'VERIFIED');assert.deepEqual(after.review.hashes,before.review.hashes);assert.deepEqual(after.review.confirmed,before.review.confirmed);assert.equal(after.workflow.reports.length,1);
 const reopened=await createWorkstation({home:f.home,toolkitRoot,allowLocal:true});t.after(()=>reopened.close());
 const wf=(await reopened.workflow('SPEC-one','REQ-001/login')).workflows[0];assert.equal(wf.stage,'IMPLEMENTATION');assert.equal(wf.feedback[0].message,'登入後版面錯位');
 const saved=JSON.parse((await reopened.readFile('SPEC-one','spec/REQ-001/login/feedback.json')).content);assert.equal(saved.items[0].runId,'RUN-history');
});
test('feedback refuses another feature report and cannot be forged through the source editor',async t=>{
 const f=await setup(t);let r=await job(f.service,'workflow.feedback',{requirementId:'REQ-001',featureId:'login',runId:'RUN-other',message:'wrong'});assert.equal(r.status,'FAILED');assert.equal(r.error.code,'REPORT_NOT_FOUND');
 r=await job(f.service,'repository.save',{kind:'source',path:'spec/REQ-001/login/feedback.json',expectedHash:null,content:'{"items":[]}'});assert.equal(r.error.code,'FILE_NOT_EDITABLE');
 assert.equal((await f.service.workflow('SPEC-one')).workflows[0].stage,'VERIFIED');
});
test('a completed development stage cannot launch another agent before acceptance feedback reopens it',async t=>{
 const f=await setup(t),service=await createWorkstation({home:f.home,toolkitRoot,allowLocal:true,enableExecution:true,autoAcquire:false});t.after(()=>service.close());
 const result=await job(service,'workflow.develop',{requirementId:'REQ-001',featureId:'login'});
 assert.equal(result.status,'FAILED');assert.equal(result.error.code,'STAGE_READ_ONLY');
 assert.equal((await service.workflow('SPEC-one','REQ-001/login')).workflows[0].stage,'VERIFIED');
});
test('only a newer genuine passing run clears feedback; an old success or a newer failed run does not',()=>{
 const feature={key:'REQ-001/login',requirementId:'REQ-001',id:'login',review:{confirmed:{gherkin:true,sd:true,tests:true},hashes:{gherkin:'g',sd:'s',tests:'t'}},feedback:{items:[{message:'bug',createdAt:'2026-01-02T00:00:00Z'}]}};
 const manifest={runId:'RUN-a',requirementId:'REQ-001',featureId:'login',baseline:'t',projects:[],testOutcome:'PASSED',verification:'VERIFIED',scope:'ALL_CASES',coverageComplete:true,evidenceComplete:true,startedAt:'2026-01-01T00:00:00Z',finishedAt:'2026-01-01T00:00:01Z'};
 const state=m=>workflowState(feature,[],[{id:m.runId,state:'SEALED',result:m}],[],'spec');
 assert.equal(state(manifest).stage,'IMPLEMENTATION');assert.equal(state({...manifest,startedAt:'2026-01-03T00:00:00Z'}).stage,'VERIFIED');
 assert.equal(state({...manifest,testOutcome:'FAILED',startedAt:'2026-01-03T00:00:00Z'}).stage,'IMPLEMENTATION');
});
test('development settings use executable and argument arrays, never a shell command or approval bypass',async()=>{
 assert.deepEqual(validateAgentSettings().args,['exec','--model','gpt-6.1-sol','--sandbox','workspace-write','{mcp}','{prompt}']);
 assert.equal(await agentExecutable(process.execPath),process.execPath);
 for(const value of [{command:''},{command:'x\nrm'},{args:'rm -rf'},{maxAttempts:10},{timeoutMs:0}])assert.throws(()=>validateAgentSettings(value),{code:'INVALID_AGENT'});
 await assert.rejects(()=>agentExecutable('bdd-agent-certainly-absent-123'),{code:'AGENT_NOT_INSTALLED'});
});
test('compact UI contains none of the removed instructional blocks and confirmation shares the Gherkin toolbar',async()=>{
 const html=await readFile(path.join(toolkitRoot,'packages/workstation/public/index.html'),'utf8');
 const app=await readFile(path.join(toolkitRoot,'packages/workstation/public/app.js'),'utf8');
 for(const text of ['規格庫管理需求與產品','已儲存至 SQLite，尚未遠端同步','系統會自動檢查測試接線；','儲存直接寫入 SQLite；','只確認內容，不處理版本操作','內容由人決定，版本與流程由系統處理。','由你確認需求意圖。','在這裡直接編輯正式規格。','準備、執行、報告，一次完成','再次驗收'])assert.ok(!(html+app).includes(text),text);
 assert.match(html, /id="requirement-buttons"[^]*id="save-requirement"[^]*id="advance"/);
 assert.ok(html.indexOf('id="binding-status"')>html.indexOf('id="settings-view"'));
 assert.ok(!html.includes('class="next-action'));
 const dev=html.slice(html.indexOf('<section id="implementation-panel"'),html.indexOf('<section id="verification-panel"'));
 assert.ok(dev.includes('確認開發'));assert.ok(html.includes('CLI Agent 終端')); assert.ok(!dev.includes('產品原始碼'));assert.ok(!dev.includes('驗收範圍'));
});
test('development cannot start without existing human approvals and input cannot target a different operation',async t=>{
 const f=await fixture(t),s=await createWorkstation({home:f.home,toolkitRoot,allowLocal:true,autoAcquire:false,enableExecution:true});t.after(()=>s.close());
 s.register({id:'SPEC-one',title:'Spec',remoteUrl:f.remote});await job(s,'repository.setup',{reviewer:'Reviewer',projects:[]});await job(s,'workflow.create',{title:'Login',guided:true});
 const r=await job(s,'workflow.develop',{requirementId:'REQ-001',featureId:'login'});assert.equal(r.status,'FAILED');assert.equal(r.error.code,'REVIEWS_REQUIRED');
 const op=await job(s,'repository.setup',{reviewer:'Reviewer',projects:[]});const terminal=await s.terminal(op.id);assert.equal(terminal.status,op.status);assert.equal(typeof terminal.output,'string');assert.throws(()=>s.terminalInput(op.id,{data:'input'}),{code:'TERMINAL_UNAVAILABLE'});await assert.rejects(()=>s.terminal('OP-missing'),{code:'OPERATION_NOT_FOUND'});
});

async function captureFixture(t) {
 const f=await fixture(t);await repository(f.repo,{'README.md':'Spec fixture'});const source=path.join(f.base,'product');const productHead=await repository(source,{'old.txt':'old','remove.txt':'remove'});
 await git.addModule(f.repo,{projectId:'product',url:source,commit:productHead},await git.inspect(f.repo));await commitAll(f.repo);
 await mkdir(f.home,{recursive:true});const store=openStore(f.home);t.after(()=>store.close());store.register({id:'SPEC-one',title:'Spec',remoteUrl:f.repo});
 store.saveDraft('SPEC-one',{expectedRevision:null,operationId:'seed',request:{},settings:{configured:true,projects:[{id:'product',url:source}]},files:[{target:'project:product',path:'remove.txt',content:'remove',baseHash:digest('remove')}],result:{}});
 store.setProjection('SPEC-one',{files:[],modules:await git.modules(f.repo)});
 return {...f,store,product:path.join(f.repo,'projects/product'),snapshot:store.draft('SPEC-one'),modules:await git.modules(f.repo),context:{root:f.repo,store,git,request:{repositoryId:'SPEC-one',operationId:'OP-capture'}}};
}
test('actual agent product edits and deletions are saved once to SQLite and exact local versions',async t=>{
 const f=await captureFixture(t);await writeFile(path.join(f.product,'old.txt'),'edited');await writeFile(path.join(f.product,'new.txt'),'created');await unlink(path.join(f.product,'remove.txt'));
 const r=await captureAgentProducts(f.context,f.snapshot,f.modules);assert.deepEqual(r,{files:2,deleted:1});
 const saved=f.store.draft('SPEC-one');assert.equal(saved.files.find(x=>x.path==='old.txt').content,'edited');assert.equal(saved.files.find(x=>x.path==='new.txt').content,'created');assert.ok(!saved.files.some(x=>x.path==='remove.txt'));
 assert.equal((await git.inspect(f.product)).clean,true);assert.equal((await git.modules(f.repo))[0].actual,(await git.modules(f.repo))[0].commit);assert.equal((await git.command(f.product,['show','HEAD:old.txt'])).stdout,'edited');
});
test('concurrent SQLite saves block agent import without erasing either new draft or on-disk work',async t=>{
 const f=await captureFixture(t);await writeFile(path.join(f.product,'old.txt'),'agent work');const before=await git.resolve(f.product);
 f.store.saveDraft('SPEC-one',{expectedRevision:f.snapshot.revision,operationId:'human-save',request:{},files:[{target:'project:product',path:'old.txt',content:'human work'}],result:{}});
 await assert.rejects(()=>captureAgentProducts(f.context,f.snapshot,f.modules),{code:'CONTENT_CHANGED'});assert.equal(await readFile(path.join(f.product,'old.txt'),'utf8'),'agent work');assert.equal(f.store.draft('SPEC-one').files.find(x=>x.path==='old.txt').content,'human work');assert.equal(await git.resolve(f.product),before);
});
test('terminal paging drains the final bounded chunk after process completion',async t=>{
 const f=await fixture(t);const {mkdir}=await import('node:fs/promises');const root=path.join(f.home,'development/OP-one');await mkdir(root,{recursive:true});await writeFile(path.join(root,'terminal.log'),'x'.repeat(70000));await writeFile(path.join(root,'state.json'),JSON.stringify({phase:'COMPLETED'}));
 const first=await readTerminal(f.home,'OP-one');assert.equal(first.output.length,65536);assert.equal(first.hasMore,true);const last=await readTerminal(f.home,'OP-one',first.nextOffset);assert.equal(last.output.length,4464);assert.equal(last.hasMore,false);assert.equal(last.nextOffset,70000);
});

test('native report route serves only sealed native artifacts inside a sandbox without same-origin privileges',async t=>{
 const f=await fixture(t),dir=path.join(f.base,'report');const {writeJson}=await import('../../packages/contracts/index.mjs');const {dispatch}=await import('../../packages/workstation/http.mjs');
 const manifest=await sealedBundle(dir,{runId:'RUN-html',requirementId:'REQ-001',featureId:'login',testedSpecCommit:'a'.repeat(40)});await mkdir(path.join(dir,'native'));const html='<!doctype html><script>parent.document.body.textContent="unsafe"</script>';await writeFile(path.join(dir,'native/index.html'),html);
 manifest.artifacts.push({path:'native/index.html',size:Buffer.byteLength(html),sha256:digest(html)});await writeJson(path.join(dir,'manifest.json'),manifest);await writeJson(path.join(dir,'seal.json'),{schemaVersion:1,manifestSha256:digest(await readFile(path.join(dir,'manifest.json')))});
 const service={artifactDirectory:async(repo,run)=>{assert.equal(repo,'SPEC-one');assert.equal(run,'RUN-html');return dir;}};
 const r=await dispatch(service,{method:'GET',url:'/repository-api/v1/spec-repositories/SPEC-one/runs/RUN-html/report/native/index.html',headers:{}});
 assert.equal(r.status,200);assert.match(r.headers['content-security-policy'],/sandbox allow-scripts;/);assert.ok(!r.headers['content-security-policy'].includes('allow-same-origin'));assert.match(r.headers['content-security-policy'],/form-action 'none'/);
 await assert.rejects(()=>dispatch(service,{method:'GET',url:'/repository-api/v1/spec-repositories/SPEC-one/runs/RUN-html/report/native/not-recorded.html',headers:{}}),{code:'ARTIFACT_NOT_FOUND'});
 await writeFile(path.join(dir,'native/index.html'),'modified');await assert.rejects(()=>dispatch(service,{method:'GET',url:'/repository-api/v1/spec-repositories/SPEC-one/runs/RUN-html/report/native/index.html',headers:{}}));
});
