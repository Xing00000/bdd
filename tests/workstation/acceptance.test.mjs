import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fixture,specRepository,approve,git,toolkitRoot,commitAll,sealedBundle} from './helpers.mjs';
import {reviewState} from '../../packages/spec-toolkit/index.mjs';
import {createWorkstation} from '../../packages/workstation/service.mjs';

async function job(service,operation,input){const operationId=`OP-${crypto.randomUUID()}`;service.enqueue({schemaVersion:1,operationId,repositoryId:'SPEC-one',operation,input});return service.wait(operationId);}
async function setup(t,extra={}){
 const f=await fixture(t);await specRepository(f.repo);await approve(f.repo);
 // A sealed report fixture tests human-review state/identity, not model or E2E execution.
 const baseline=(await reviewState(f.repo,'REQ-001','login')).hashes.tests;
 await sealedBundle(path.join(f.repo,'reports/REQ-001/login/RUN-one'),{runId:'RUN-one',specRepositoryId:'fixture-spec',requirementId:'REQ-001',featureId:'login',testedSpecCommit:await git.resolve(f.repo),baseline,projects:[],scope:'ALL_CASES',testOutcome:'PASSED',verification:'VERIFIED',coverageComplete:true,evidenceComplete:true,finishedAt:new Date().toISOString(),...extra});
 await commitAll(f.repo,'Report fixture');
 const options={home:f.home,toolkitRoot,allowLocal:true},service=await createWorkstation(options);t.after(()=>service.close());
 const r=service.register({id:'SPEC-one',title:'Human acceptance fixture',remoteUrl:f.repo});assert.equal((await service.wait(r.connection.operationId)).status,'SUCCEEDED');
 assert.equal((await job(service,'repository.setup',{reviewer:'Human reviewer',projects:[]})).status,'SUCCEEDED');
 const state=async()=> (await service.workflow('SPEC-one','REQ-001/login')).workflows[0];
 return {...f,service,options,state,input:()=>state().then(s=>({requirementId:'REQ-001',featureId:'login',runId:s.latestReport.runId,expectedManifestDigest:s.latestReport.manifestDigest}))};
}
test('passing tests wait for human acceptance; exact report acceptance is atomic and survives restart',async t=>{
 const f=await setup(t),before=await f.state();assert.equal(before.stage,'VERIFICATION');assert.equal(before.status,'AWAITING_ACCEPTANCE');assert.equal(before.verification,'VERIFIED');assert.equal(before.acceptance,null);
 const input=await f.input(),result=await job(f.service,'workflow.accept',input);assert.equal(result.status,'SUCCEEDED',JSON.stringify(result.error));
 const after=await f.state();assert.equal(after.status,'COMPLETE');assert.equal(after.stage,'VERIFIED');assert.equal(after.acceptance.runId,input.runId);assert.equal(after.acceptance.reviewer,'Human reviewer');assert.equal(after.acceptance.message,'');
 const saved=await f.service.readFile('SPEC-one','spec/REQ-001/login/acceptance.json');assert.equal(JSON.parse(saved.content).items.length,1);
 const duplicate=await job(f.service,'workflow.accept',input);assert.equal(duplicate.status,'FAILED');assert.equal(duplicate.error.code,'ACCEPTANCE_NOT_READY');
 const second=await createWorkstation({...f.options,autoAcquire:false});t.after(()=>second.close());assert.equal((await second.workflow('SPEC-one','REQ-001/login')).workflows[0].status,'COMPLETE');
 const feedback=await job(second,'workflow.feedback',{requirementId:'REQ-001',featureId:'login',runId:input.runId,message:'需要修改'});assert.equal(feedback.status,'SUCCEEDED');
 const reopened=(await second.workflow('SPEC-one','REQ-001/login')).workflows[0];assert.equal(reopened.status,'READY_TO_RUN');assert.equal(reopened.acceptance,null);assert.equal(JSON.parse((await second.readFile('SPEC-one','spec/REQ-001/login/acceptance.json')).content).items.length,1);
});
test('acceptance refuses stale identities and source-editor forgeries without saving any confirmation',async t=>{
 const f=await setup(t),input=await f.input();
 for(const delta of [{runId:'RUN-other'},{expectedManifestDigest:'0'.repeat(64)}]){const result=await job(f.service,'workflow.accept',{...input,...delta});assert.equal(result.status,'FAILED');assert.equal(result.error.code,'REPORT_CHANGED');}
 const invalidMessage=await job(f.service,'workflow.accept',{...input,message:null});assert.equal(invalidMessage.error.code,'INVALID_FEEDBACK');
 const forged=await job(f.service,'repository.save',{kind:'source',path:'spec/REQ-001/login/acceptance.json',expectedHash:null,content:'{"schemaVersion":1,"items":[]}'});assert.equal(forged.error.code,'FILE_NOT_EDITABLE');
 assert.equal((await f.state()).status,'AWAITING_ACCEPTANCE');
 await assert.rejects(f.service.readFile('SPEC-one','spec/REQ-001/login/acceptance.json'),{code:'ENOENT'});
});
test('a failed or incomplete report cannot finish a requirement by human-acceptance endpoint',async t=>{
 for(const result of [{testOutcome:'FAILED',verification:'NOT_VERIFIED'},{coverageComplete:false}])await t.test(JSON.stringify(result),async t=>{
  const f=await setup(t,result),outcome=await job(f.service,'workflow.accept',await f.input());assert.equal(outcome.error.code,'ACCEPTANCE_NOT_READY');assert.notEqual((await f.state()).status,'COMPLETE');
 });
});
