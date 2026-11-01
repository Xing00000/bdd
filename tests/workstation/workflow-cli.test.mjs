import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fixture, git, toolkitRoot, specRepository, approve, commitAll, sealedBundle } from './helpers.mjs';
import { createWorkstation } from '../../packages/workstation/service.mjs';
import { createStandaloneServer } from '../../packages/workstation/http.mjs';
import { execute } from '../../packages/git-core/index.mjs';
import { writeJson } from '../../packages/contracts/index.mjs';
import { reviewState } from '../../packages/spec-toolkit/index.mjs';
import { parseWorkflowArgs, resolveRepository, workflowExitCode } from '../../packages/workstation/workflow-cli.mjs';
import { workflowState, featureReports, refreshWorkflowFiles } from '../../packages/workstation/workflow-state.mjs';

async function job(service, operation, input={}, repositoryId='SPEC-one') {
  const operationId=`OP-${crypto.randomUUID()}`;
  service.enqueue({schemaVersion:1,operationId,repositoryId,operation,input});
  const result=await service.wait(operationId);assert.equal(result.status,'SUCCEEDED',JSON.stringify(result.error));return result.result;
}
async function setup(t) {
  const f=await fixture(t),service=await createWorkstation({home:f.home,toolkitRoot,allowLocal:true,autoAcquire:false});t.after(()=>service.close());
  service.register({id:'SPEC-one',title:'BDD Spec',remoteUrl:f.remote});
  await job(service,'repository.setup',{reviewer:'Human fixture',projects:[]});
  await job(service,'workflow.create',{requirementId:'REQ-001',featureId:'login',title:'Login',guided:true,acceptance:'能登入'});
  return {...f,service};
}
async function cli(home,args) {
  const r=await execute(process.execPath,[path.join(toolkitRoot,'scripts/bdd.mjs'),'workflow',...args],
    {cwd:toolkitRoot,env:{...process.env,WB_HOME:home,WB_ALLOW_LOCAL_GIT:'1'},timeoutMs:30000});
  return {...r,value:JSON.parse(r.stdout)};
}

test('friendly CLI validates choices and never accepts an approval bypass',()=>{
  assert.deepEqual(parseWorkflowArgs(['regress','--repo','bdd-spec','--spec','release-v1','--project','product=main']).projects,{product:'main'});
  for(const args of [['next','--yes'],['next','--feature','../x'],['run','--timeout','0'],['regress'],['regress','--spec','main','--rerun','BATCH-x'],['regress','--spec','main','--project','p=a','--project','p=b']])assert.throws(()=>parseWorkflowArgs(args));
});
test('repository selection accepts URL/name/ID and refuses ambiguous automatic choices',()=>{
  const rows=[{id:'SPEC-a',title:'App specs',remoteUrl:'https://github.com/org/bdd-spec.git',localPath:'/tmp/spec-a'},{id:'SPEC-b',title:'Other',remoteUrl:'https://github.com/org/other.git',localPath:'/tmp/spec-b'}];
  for(const name of ['SPEC-a','App specs','bdd-spec','https://github.com/org/bdd-spec'])assert.equal(resolveRepository(rows,name).id,'SPEC-a');
  assert.equal(resolveRepository(rows,undefined,'/tmp/spec-a/tests').id,'SPEC-a');
  assert.throws(()=>resolveRepository(rows,undefined,'/elsewhere'),{code:'REPOSITORY_SELECTION_REQUIRED'});
});
test('automation exit codes distinguish human, installation, failed tests and unverified passing tests',()=>{
  assert.equal(workflowExitCode('next',{status:'AWAITING_REVIEW'}),2);
  assert.equal(workflowExitCode('run',null,{code:'INSTALL_REQUIRED'}),3);
  assert.equal(workflowExitCode('run',{testOutcome:'FAILED',verification:'NOT_VERIFIED'}),1);
  assert.equal(workflowExitCode('run',{testOutcome:'PASSED',verification:'NOT_VERIFIED'}),1);
  assert.equal(workflowExitCode('run',{testOutcome:'PASSED',verification:'VERIFIED'}),0);
  assert.equal(workflowExitCode('regress',{status:'COMPLETED',outcome:'FAILED'}),1);
  assert.equal(workflowExitCode('status',{status:'AWAITING_REVIEW'}),0);
});
test('real CLI status and next share SQLite state and do not sign a human review',async t=>{
  const f=await setup(t),before=(await f.service.detail('SPEC-one')).authoring.revision;
  const state=await cli(f.home,['status','--repo','SPEC-one','--feature','REQ-001/login']);
  assert.equal(state.exitCode,0,state.stderr);assert.equal(state.value.workflows[0].status,'AWAITING_REVIEW');assert.equal(state.value.workflows[0].requiredReview,'gherkin');
  const next=await cli(f.home,['next','--repo','SPEC-one','--feature','REQ-001/login']);
  assert.equal(next.exitCode,2,next.stdout);assert.equal(next.value.result.advanced,false);
  const after=await f.service.detail('SPEC-one');assert.equal(after.authoring.revision,before);assert.equal(after.spec.features[0].review.confirmed.gherkin,false);
  const feature=after.spec.features[0];await job(f.service,'workflow.review',{requirementId:'REQ-001',featureId:'login',stage:'gherkin',expectedDigest:feature.review.hashes.gherkin});
  const updated=await cli(f.home,['status','--repo','SPEC-one']);assert.equal(updated.value.workflows[0].stage,'SD');
  assert.equal((await cli(f.home,['next','--repo','SPEC-one'])).value.result.requiredReview,'sd');
});
test('CLI does not pretend run succeeded when human approval is missing',async t=>{
  const f=await setup(t),r=await cli(f.home,['run','--repo','SPEC-one','--feature','REQ-001/login']);
  assert.equal(r.exitCode,1);assert.equal(r.value.status,'FAILED');assert.equal(r.value.error.code,'REVIEWS_REQUIRED');
});
test('workflow files persist revisions in SQLite without needing a checkout',async t=>{
  const f=await setup(t),state=await f.service.readFile('SPEC-one','spec/REQ-001/login/workflow.json');
  const value=JSON.parse(state.content);assert.equal(value.stage,'GHERKIN');assert.equal(value.reviewPath,'spec/REQ-001/review.json');
  assert.ok(!state.content.includes(f.home));assert.ok(!Object.hasOwn(value,'repositoryId'));
  const feature=(await f.service.detail('SPEC-one')).spec.features[0];await job(f.service,'workflow.review',{requirementId:'REQ-001',featureId:'login',stage:'gherkin',expectedDigest:feature.review.hashes.gherkin});
  assert.equal(JSON.parse((await f.service.readFile('SPEC-one',state.path)).content).stage,'SD');
});
const feature={requirementId:'REQ-001',id:'login',key:'REQ-001/login',review:{confirmed:{gherkin:true,sd:true,tests:true},hashes:{gherkin:'g',sd:'s',tests:'t'}}};
function report(runId='RUN-one',extra={}) {return {key:`REQ-001/login/${runId}`,runId,ref:'refs/remotes/origin/evidence/example',reportCommit:'a'.repeat(40),manifest:{schemaVersion:1,specRepositoryId:'spec-one',runId,requirementId:'REQ-001',featureId:'login',baseline:'t',projects:[],testOutcome:'PASSED',verification:'VERIFIED',scope:'ALL_CASES',coverageComplete:true,evidenceComplete:true,finishedAt:'2026-01-01T00:00:00Z',...extra}};}
test('shared workflow derives progress from matching evidence, never from an editable status string',()=>{
  const pass=report();assert.equal(workflowState(feature,[],[],[pass],'spec-one').stage,'VERIFIED');
  const edited={...feature,review:{...feature.review,confirmed:{...feature.review.confirmed,gherkin:false},hashes:{...feature.review.hashes,tests:'changed'}}};
  assert.equal(workflowState(edited,[],[],[pass],'spec-one').stage,'GHERKIN');
  assert.equal(workflowState(edited,[],[],[pass],'spec-one').verification,'STALE');
  assert.equal(workflowState(feature,[],[],[report('RUN-partial',{scope:'SELECTED_CASES'})],'spec-one').stage,'IMPLEMENTATION');
  assert.equal(workflowState(feature,[],[],[report('RUN-other',{specRepositoryId:'other'})],'spec-one').reports.length,0);
});
test('newer failure for identical inputs supersedes an earlier passing result',()=>{
  const result=workflowState(feature,[],[],[report(),report('RUN-later',{finishedAt:'2026-01-02T00:00:00Z',testOutcome:'FAILED',verification:'NOT_VERIFIED'})],'spec-one');
  assert.equal(result.stage,'VERIFICATION');assert.equal(result.latestReport.runId,'RUN-later');assert.notEqual(result.verification,'VERIFIED');
});
test('report matching is feature-specific, de-duplicates local and repository evidence, and quarantines collisions',()=>{
  const shared=report(),local={id:shared.runId,state:'SEALED',result:shared.manifest};
  const history=featureReports(feature,[],[local],[shared,report('RUN-wrong',{featureId:'other'})],'spec-one');
  assert.equal(history.length,1);assert.equal(history[0].origin,'SPEC_REPO');assert.equal(history[0].reportKey,shared.key);
  const conflict=featureReports(feature,[],[{...local,result:{...local.result,testOutcome:'FAILED'}}],[shared],'spec-one');
  assert.equal(conflict[0].invalidReason,'REPORT_ID_CONFLICT');assert.equal(conflict[0].qualified,false);
});
test('changing products makes historical report visible but not current verification',()=>{
  const p=report('RUN-product',{projects:[{id:'product',commit:'old'}]});
  const state=workflowState(feature,[{id:'product',commit:'new',actual:'new',dirty:false}],[],[p],'spec-one');
  assert.equal(state.verification,'STALE');assert.equal(state.reports[0].applicability,'HISTORICAL');
});
test('synchronized workflow state and requirement reports reconstruct on a fresh workstation',async t=>{
  const f=await fixture(t);await specRepository(f.repo);await approve(f.repo);
  const baseline=(await reviewState(f.repo,'REQ-001','login')).hashes.tests,testedSpecCommit=await git.resolve(f.repo);
  await sealedBundle(path.join(f.repo,'reports/REQ-001/login/RUN-portable'),{runId:'RUN-portable',specRepositoryId:'fixture-spec',requirementId:'REQ-001',featureId:'login',testedSpecCommit,baseline,projects:[],testOutcome:'PASSED',verification:'VERIFIED',scope:'ALL_CASES',coverageComplete:true,evidenceComplete:true,finishedAt:'2026-01-01T00:00:00Z'});
  await commitAll(f.repo);await git.command(undefined,['init','--bare','--initial-branch','main',f.remote]);await git.command(f.repo,['remote','add','origin',f.remote]);await git.push(f.repo,{},await git.inspect(f.repo));
  const a=await createWorkstation({home:f.home,toolkitRoot,allowLocal:true});t.after(()=>a.close());
  const first=a.register({id:'SPEC-a',title:'portable',remoteUrl:f.remote});assert.equal((await a.wait(first.connection.operationId)).status,'SUCCEEDED');
  await job(a,'repository.setup',{reviewer:'Human',projects:[]},'SPEC-a');
  await job(a,'repository.sync',{},'SPEC-a');
  const raw=(await git.command(undefined,['--git-dir',f.remote,'show','main:spec/REQ-001/login/workflow.json'])).stdout;
  assert.equal(JSON.parse(raw).stage,'VERIFIED');assert.equal(JSON.parse(raw).latestReport.path,'reports/REQ-001/login/RUN-portable/manifest.json');
  assert.ok(!raw.includes(f.home));
  const b=await createWorkstation({home:path.join(f.base,'second-home'),toolkitRoot,allowLocal:true});t.after(()=>b.close());
  const second=b.register({id:'SPEC-b',title:'portable',remoteUrl:f.remote});assert.equal((await b.wait(second.connection.operationId)).status,'SUCCEEDED');
  const result=await b.workflow('SPEC-b','REQ-001/login');assert.equal(result.workflows[0].stage,'VERIFIED');assert.equal(result.workflows[0].reports.length,1);assert.equal(result.workflows[0].reports[0].origin,'SPEC_REPO');
  const same=await b.readFile('SPEC-b','spec/REQ-001/login/workflow.json');assert.equal(JSON.parse(same.content).specRepositoryId,'fixture-spec');
});
test('forged VERIFIED workflow without matching review/evidence is not accepted',async t=>{
  const f=await fixture(t);await specRepository(f.repo);
  await writeJson(path.join(f.repo,'spec/REQ-001/login/workflow.json'),{schemaVersion:1,specRepositoryId:'fixture-spec',requirementId:'REQ-001',featureId:'login',stage:'VERIFIED'});await commitAll(f.repo);
  await mkdir(f.home);const service=await createWorkstation({home:f.home,toolkitRoot,allowLocal:true});t.after(()=>service.close());
  const r=service.register({id:'SPEC-one',title:'forged',remoteUrl:f.repo});await service.wait(r.connection.operationId);
  assert.equal((await service.workflow('SPEC-one')).workflows[0].stage,'GHERKIN');
});
test('refreshing state does not invalidate its own source baseline or rewrite unchanged records',async t=>{
  const f=await fixture(t);await specRepository(f.repo);const before=await reviewState(f.repo,'REQ-001','login');
  assert.equal((await refreshWorkflowFiles(f.repo)).length,1);const raw=await readFile(path.join(f.repo,'spec/REQ-001/login/workflow.json'),'utf8');
  assert.equal((await refreshWorkflowFiles(f.repo)).length,0);assert.equal(await readFile(path.join(f.repo,'spec/REQ-001/login/workflow.json'),'utf8'),raw);
  assert.deepEqual((await reviewState(f.repo,'REQ-001','login')).hashes,before.hashes);
});
test('workflow API matches CLI and exposes only reports belonging to the selected feature',async t=>{
  const f=await setup(t),app=await createStandaloneServer({home:f.home,toolkitRoot,allowLocal:true,autoAcquire:false});t.after(()=>app.close());
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${app.server.address().port}`;
  const result=await(await fetch(origin+'/repository-api/v1/spec-repositories/SPEC-one/workflow?feature=REQ-001/login')).json();
  assert.equal(result.workflows[0].stage,'GHERKIN');assert.deepEqual(result,(await cli(f.home,['status','--repo','SPEC-one','--feature','REQ-001/login'])).value);
  assert.equal((await fetch(origin+'/repository-api/v1/spec-repositories/SPEC-one/workflow?feature=REQ-001/other')).status,404);
});

test('ordinary source save cannot forge workflow state or approve a review',async t=>{
  const f=await setup(t),file=await f.service.readFile('SPEC-one','spec/REQ-001/login/workflow.json');
  const operationId='OP-forge';f.service.enqueue({schemaVersion:1,operationId,repositoryId:'SPEC-one',operation:'repository.save',input:{kind:'source',path:file.path,expectedHash:file.sha256,content:JSON.stringify({stage:'VERIFIED'})}});
  const result=await f.service.wait(operationId);assert.equal(result.status,'FAILED');assert.equal(result.error.code,'FILE_NOT_EDITABLE');assert.equal((await f.service.workflow('SPEC-one')).workflows[0].stage,'GHERKIN');
});
