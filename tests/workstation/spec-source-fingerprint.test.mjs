import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { fixture, git, toolkitRoot, specRepository, approve, commitAll, sealedBundle } from './helpers.mjs';
import { initialize, createFeature, scan, reviewState } from '../../packages/spec-toolkit/index.mjs';
import { workspaceInput, workspaceSpecSourceDigest, entriesDigest, specSourcePath } from '../../packages/spec-toolkit/workspace.mjs';
import { specCheckpointDigest } from '../../packages/spec-toolkit/source-checkpoint.mjs';
import { prepareWorkspaceRun } from '../../packages/spec-toolkit/engine.mjs';
import { validateContract } from '../../packages/contracts/schemas.mjs';
import { identity, digest } from '../../packages/contracts/index.mjs';
import { openStore } from '../../packages/workstation/store.mjs';
import { createWorkstation } from '../../packages/workstation/service.mjs';
import { executeOperation } from '../../packages/workstation/operations.mjs';
import { prepareProjection, checkpointProjection } from '../../packages/workstation/projection.mjs';
import { editDraft } from '../../packages/workstation/authoring.mjs';
import { featureReports, liveWorkflowSpecSourceDigest } from '../../packages/workstation/workflow-state.mjs';
import { reindexReports } from '../../packages/workstation/reports.mjs';

async function file(root,relative,content) {const target=path.join(root,relative);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,content);}

test('source fingerprints canonicalize Unicode file order without mutating their input',()=>{
  const entries=['中.ts','Z.ts','é.ts','e\u0301.ts','a.ts'].map((name,index)=>({path:name,mode:'100644',sha256:digest(String(index))}));
  const before=structuredClone(entries),reversed=[...entries].reverse();
  assert.equal(entriesDigest(entries),entriesDigest(reversed));assert.deepEqual(entries,before);assert.deepEqual(reversed,[...before].reverse());
  assert.notEqual(entriesDigest(entries),entriesDigest(entries.map(entry=>entry.path==='中.ts'?{...entry,mode:'100755'}:entry)));
});

test('only exact workstation metadata paths are excluded from the stable specification digest',async t=>{
  const f=await fixture(t);await mkdir(f.repo);
  const metadata=['spec/REQ-001/review.json','spec/REQ-001/login/workflow.json','spec/REQ-001/login/acceptance.json','spec/REQ-001/login/feedback.json'];
  for(const relative of [...metadata,'tests/support/workflow.json','workflow.json','spec/REQ-001/login/nested/acceptance.json'])await file(f.repo,relative,'before\n');
  const before=await workspaceInput(f.repo,[]);
  for(const relative of metadata){assert.equal(specSourcePath(relative),false);await file(f.repo,relative,'derived metadata changed\n');}
  const after=await workspaceInput(f.repo,[]);assert.equal(after.specSourceDigest,before.specSourceDigest);assert.notEqual(after.specDigest,before.specDigest);assert.notEqual(after.inputDigest,before.inputDigest);
  for(const relative of ['tests/support/workflow.json','workflow.json','spec/REQ-001/login/nested/acceptance.json']){
    const old=await workspaceSpecSourceDigest(f.repo);assert.equal(specSourcePath(relative),true);await file(f.repo,relative,'real source changed\n');assert.notEqual(await workspaceSpecSourceDigest(f.repo),old);
  }
});

test('external support and root helpers make evidence stale even when the older feature baseline is unchanged',async t=>{
  const f=await fixture(t);await mkdir(f.repo);await initialize(f.repo,{specRepositoryId:'source-fixture',toolkitRoot:path.join(toolkitRoot,'packages')});
  const ids={requirementId:'REQ-001',featureId:'login'};await createFeature(f.repo,{...ids,title:'Helper fixture'});
  await file(f.repo,'tests/REQ-001/login/login.steps.ts',"import '../../support/helper.mjs';\nimport '../../../root-helper.mjs';\n");
  for(const relative of ['tests/support/helper.mjs','root-helper.mjs'])await file(f.repo,relative,'export const value=1;\n');
  const feature=(await scan(f.repo)).features[0];feature.review=await reviewState(f.repo,ids.requirementId,ids.featureId);
  const originalBaseline=feature.review.hashes.tests,originalDigest=await workspaceSpecSourceDigest(f.repo);
  const manifest={...ids,runId:'RUN-source',specRepositoryId:'source-fixture',sourceKind:'WORKSPACE',baseline:originalBaseline,specSourceDigest:originalDigest,projects:[],testOutcome:'PASSED',verification:'VERIFIED',scope:'ALL_CASES',coverageComplete:true,evidenceComplete:true,inputsUnchanged:true};
  const reports=current=>featureReports(feature,[],[{id:manifest.runId,state:'SEALED',result:manifest}],[],'source-fixture',current);
  assert.equal(reports(originalDigest)[0].qualified,true);
  for(const relative of ['tests/support/helper.mjs','root-helper.mjs']){
    await file(f.repo,relative,'export const value=2;\n');
    assert.equal((await reviewState(f.repo,ids.requirementId,ids.featureId)).hashes.tests,originalBaseline);
    const current=await workspaceSpecSourceDigest(f.repo);assert.notEqual(current,originalDigest);assert.equal(reports(current)[0].current,false);assert.equal(reports(current)[0].qualified,false);
    await file(f.repo,relative,'export const value=1;\n');
  }
});

test('pending SQL edits, unsaved draft-view changes and external file conflicts cannot certify live sources',async t=>{
  const f=await fixture(t);await mkdir(f.repo);await mkdir(f.home);await file(f.repo,'root-helper.mjs','export const value=1;\n');
  const store=openStore(f.home);t.after(()=>store.close());store.register({id:'SPEC-source',title:'Source',remoteUrl:'/unused'});
  const save=content=>store.saveDraft('SPEC-source',{expectedRevision:store.draft('SPEC-source')?.revision??null,settings:{configured:true,projects:[]},files:[{target:'spec',path:'root-helper.mjs',content}],operationId:`OP-${crypto.randomUUID()}`,request:{content}});
  save('export const value=1;\n');const context={root:f.repo,repositoryId:'SPEC-source',store};
  const original=await liveWorkflowSpecSourceDigest(context,store.draft('SPEC-source'));assert.equal(original,await workspaceSpecSourceDigest(f.repo));
  save('export const value=2;\n');assert.equal(await liveWorkflowSpecSourceDigest(context,store.draft('SPEC-source')),null);
  save('export const value=1;\n');await file(f.repo,'root-helper.mjs','external edit\n');assert.equal(await liveWorkflowSpecSourceDigest(context,store.draft('SPEC-source')),null);
  await file(f.repo,'root-helper.mjs','export const value=1;\n');const draftRoot=path.join(f.base,'draft-view');await file(draftRoot,'root-helper.mjs','unsaved editor content\n');
  assert.equal(await liveWorkflowSpecSourceDigest(context,store.draft('SPEC-source'),draftRoot),null);
});

async function acceptanceFixture(t) {
  const f=await fixture(t);await specRepository(f.repo);await file(f.repo,'retired-helper.mjs','export const retired=true;\n');await commitAll(f.repo);await approve(f.repo);
  const options={home:f.home,toolkitRoot,allowLocal:true,enableExecution:true},service=await createWorkstation(options),store=openStore(f.home);t.after(async()=>{store.close();await service.close();});
  service.register({id:'SPEC-source',title:'Source checkpoint fixture',remoteUrl:f.repo});
  const operation=(operation,input={})=>executeOperation(options,store,{schemaVersion:1,operationId:`OP-${crypto.randomUUID()}`,repositoryId:'SPEC-source',operation,input});
  await operation('repository.acquire');await operation('repository.setup',{reviewer:'Protocol fixture reviewer',projects:[]});
  const root=path.join(f.home,'repositories/SPEC-source/repo'),ids={requirementId:'REQ-001',featureId:'login'};
  await file(root,'root-helper.mjs','export const value="測過的來源";\n');await file(root,'中文資料/樣本.bin',Buffer.from([0,0xff,0x0a,0x80,0x31]));await rm(path.join(root,'retired-helper.mjs'));
  const context={root,options,store,git,request:{schemaVersion:1,operationId:'OP-materialize',repositoryId:'SPEC-source',operation:'repository.prepare',input:{}}};
  await prepareProjection(context);
  const plan=await prepareWorkspaceRun({root,home:f.home,repositoryId:'SPEC-source',input:ids});
  // Synthetic sealed evidence exercises the checkpoint protocol, not browser execution.
  const manifest=await sealedBundle(path.join(f.home,'executions',plan.runId,'evidence'),plan,{testOutcome:'PASSED',verification:'VERIFIED',scope:'ALL_CASES',coverageComplete:true,evidenceComplete:true,inputsUnchanged:true,finishedAt:new Date().toISOString()});
  store.recordRun('SPEC-source',manifest,'SEALED');
  const input={...ids,runId:plan.runId,expectedManifestDigest:identity(manifest)};
  assert.equal((await service.workflow('SPEC-source')).workflows[0].status,'AWAITING_ACCEPTANCE');
  return {...f,...context,service,operation,input,manifest,plan};
}

test('acceptance commits every verified helper byte and deletion, and its report imports against that exact commit',async t=>{
  const f=await acceptanceFixture(t);
  validateContract('manifest',f.manifest);
  const missing=structuredClone(f.manifest);delete missing.specSourceDigest;assert.throws(()=>validateContract('manifest',missing));
  assert.throws(()=>validateContract('manifest',{...f.manifest,testedSpecCommit:'a'.repeat(40)}));
  const result=await f.operation('workflow.accept',f.input);assert.equal(result.status,'COMPLETE');
  assert.equal(await specCheckpointDigest(f.root,git,result.checkpoint.head),f.manifest.specSourceDigest);
  assert.equal((await git.command(f.root,['show','HEAD:root-helper.mjs'])).stdout,'export const value="測過的來源";\n');
  assert.deepEqual((await git.command(f.root,['show','HEAD:中文資料/樣本.bin'],{binaryOutput:true})).stdout,Buffer.from([0,0xff,0x0a,0x80,0x31]));
  assert.equal((await git.command(f.root,['ls-tree','HEAD','--','retired-helper.mjs'])).stdout,'');
  const publisher=path.join(f.home,result.publication.publisherPath),imported=await reindexReports({root:publisher,home:f.home,repositoryId:'SPEC-source',git,store:f.store,refs:[result.publication.reportCommit]});
  assert.deepEqual(imported.errors,[]);assert.equal(imported.indexed.length,1);assert.equal(f.store.reports('SPEC-source')[0].manifest.specSourceDigest,f.manifest.specSourceDigest);
});

test('an external helper change after the checkpoint commit cannot complete human acceptance',async t=>{
  const f=await acceptanceFixture(t),request={schemaVersion:1,operationId:'OP-accept-race',repositoryId:'SPEC-source',operation:'workflow.accept',input:f.input};
  const result=await editDraft({...f,request});let changed=false;
  const racingGit={...git,async commitSelected(directory,input,expected){const result=await git.commitSelected(directory,input,expected);if(directory===f.root&&!changed){changed=true;await file(f.root,'root-helper.mjs','export const value="changed after commit";\n');}return result;}};
  await assert.rejects(checkpointProjection({...f,request,git:racingGit,expectedRevision:result.revision,acceptance:result.acceptance,acceptedManifest:f.manifest}),{code:'CONTENT_CHANGED'});
  assert.equal(changed,true);assert.notEqual((await f.service.workflow('SPEC-source')).workflows[0].status,'COMPLETE');assert.notEqual(f.store.projection('SPEC-source').checkpointKind,'ACCEPTED');
  assert.equal(await readFile(path.join(f.root,'root-helper.mjs'),'utf8'),'export const value="changed after commit";\n');
  assert.equal((await git.command(f.root,['show','HEAD:root-helper.mjs'])).stdout,'export const value="測過的來源";\n');
});
