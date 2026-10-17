import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCore, sha256 } from '../../src/application/core.ts';
import { createExtensions } from '../../src/application/extensions.ts';

// Application-port tests: SQLite/core are real; generator/LLM/workspace ports
// are controlled collaborators. These are not provider or product E2E claims.
const feature='Feature: Extension jobs\n @AC-EXT-001\n Scenario Outline: source cases\n  Given role "<role>"\n  Then result "<expected>"\n  Examples:\n   | case_id | role | expected |\n   | a | A | denied |\n   | b | B | saved |\n';
const mappings=[{testKey:'test-a',scenarioId:'AC-EXT-001',caseId:'a'},{testKey:'test-a-extra',scenarioId:'AC-EXT-001',caseId:'a'},{testKey:'test-b',scenarioId:'AC-EXT-001',caseId:'b'}];
const text=(pending=false,ids=mappings.map(m=>m.testKey))=>"import {test,expect} from '@playwright/test';\n"+ids.map(id=>`test('${id}',{annotation:{type:'workbenchTestId',description:'${id}'}},async()=>{${pending?"throw Error('UnimplementedStepError');":"expect(process.version).toMatch(/^v/);"}});`).join('\n');
const pass=()=>({passed:true,checks:{syntax:true,pendingAndDisabled:true,mapping:true,typecheck:true,discovery:true},diagnostics:[],discoveredTestKeys:mappings.map(m=>m.testKey),scope:'UNIT_PORT_RECEIPT_NOT_PRODUCT_E2E',productE2E:'NOT_RUN'});
function bundle(){const rawText=text(true),specPath='generated/demo.spec.ts',files=[{path:specPath,rawText},{path:'features/source.feature',rawText:feature},{path:'impl.ts',rawText:"throw Error('UnimplementedStepError: slot-one');\n"}];return {rawText,specPath,files,manifest:{schemaVersion:1,artifactStage:'SKELETON',completionStatus:'PENDING',specPath,mappings,pendingSlots:[{slotId:'slot-one'}],fileHashes:{'impl.ts':'stale'},manifestSha256:'stale',bundleFiles:files}};}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
const code=(expected:string)=>(error:any)=>error.code===expected;
async function setup(t:{after:(fn:()=>Promise<void>)=>void},stage:'SD'|'TESTS'='TESTS'){
  const directory=await mkdtemp(join(tmpdir(),'workbench-extensions-')),core=await createCore(join(directory,'metadata.sqlite'));
  t.after(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});
  const project=await core.createProject({name:'Extension application tests',workspaceRef:directory}),r=await core.createRequirement(project.id,{requirementKey:'REQ-EXT-001'});
  const g=await core.saveVersion(r.documents.gherkin.id,{rawText:feature});await core.confirm(r.id,'gherkin',{versionId:g.versionId!,rawSha256:g.rawSha256!});
  let sd:any;
  if(stage==='TESTS'){sd=await core.saveVersion(r.documents.sd.id,{rawText:'# SD\nArchitecture / DDL / DML\n',sourceGherkinVersionId:g.versionId});await core.confirm(r.id,'sd',{versionId:sd.versionId,rawSha256:sd.rawSha256});}
  const events:any[]=[],generation:any={generator:{generate:async()=>bundle(),validateCompletion:async()=>pass()},llm:{generateSd:async()=>({status:'completed',rawText:'# SD from a unit port',questions:[]}),complete:async()=>({status:'completed',rawText:text(),questions:[],files:[{path:'impl.ts',rawText:'export const implemented=1;\n'}]})}};
  const workspace:any={resolveSource:async(ref:string,_workspaceRef:string,projectId:string)=>({sourceRef:ref,resolvedCommit:ref==='other'?'b'.repeat(40):'a'.repeat(40),projectId}),readSource:async()=>({rawText:''}),saveSource:async()=>({})};
  const git:any={readSnapshot:async()=>{throw Error('Snapshot port not arranged');}},ext=createExtensions({core,generation,workspace,git,emit:event=>events.push(event)});
  async function legacySkeleton(){const b=bundle(),manifest={...b.manifest,sourceGherkinVersionId:g.versionId,gherkinSha256:g.rawSha256,sdSha256:sd.rawSha256,specSha256:sha256(b.rawText)};return core.saveVersion(r.documents.spec.id,{rawText:b.rawText,sourceGherkinVersionId:g.versionId,testStage:'SKELETON',manifest});}
  return {core,project,r,g,sd,ext,generation,workspace,git,events,legacySkeleton};
}
function assertSeal(manifest:any){const {manifestSha256,...rest}=manifest;assert.equal(manifestSha256,sha256(JSON.stringify(rest)));for(const file of manifest.bundleFiles)assert.equal(manifest.fileHashes[file.path],sha256(file.rawText));}

test('generation records schema2 confirmed sources, canonical cases, real file hashes and a fresh manifest self-hash',async t=>{
  const {ext,r,g,sd}=await setup(t),saved=await ext.generated(r.id,{}),m=saved.manifest;
  assert.equal(m.schemaVersion,2);assert.equal(m.sourceGherkinVersionId,g.versionId);assert.equal(m.gherkinSha256,g.rawSha256);assert.equal(m.sdVersionId,sd.versionId);assert.equal(m.sdSha256,sd.rawSha256);
  assert.deepEqual(m.cases.map((c:any)=>[c.testKey,c.scenarioId,c.caseId]),mappings.map(c=>[c.testKey,c.scenarioId,c.caseId]));assert.ok(m.cases.every((c:any)=>c.sourceCaseId&&c.generatedLine>0));
  assert.equal(m.artifactStage,'SKELETON');assert.equal(m.stage,'SKELETON');assert.equal(m.completionStatus,'PENDING');assertSeal(m);
});
test('caller-supplied Gherkin/SD versions or hashes are checked before expensive jobs',async t=>{
  const {ext,r,generation}=await setup(t);let calls=0;generation.generator.generate=async()=>{calls++;return bundle();};
  for(const key of ['gherkinVersionId','gherkinSha256','gherkinHash','sdVersionId','sdSha256','sdHash'])await assert.rejects(ext.generated(r.id,{[key]:'stale'}),code('VERSION_HASH_MISMATCH'));
  assert.equal(calls,0);
});
test('a slow generator cannot overwrite a newer spec head',async t=>{
  const {core,ext,r,generation}=await setup(t),entered=deferred<void>(),finish=deferred<any>();
  generation.generator.generate=async()=>{entered.resolve();return finish.promise;};const pending=ext.generated(r.id,{});await entered.promise;
  generation.generator.generate=async()=>bundle();const fresh=await ext.generated(r.id,{});finish.resolve(bundle());
  await assert.rejects(pending,code('VERSION_CONFLICT'));assert.equal((await core.getRequirement(r.id)).documents.spec.versionId,fresh.versionId);
});
test('a slow generator rejects changed source confirmations even when spec head is unchanged',async t=>{
  const {core,ext,r,g,sd,generation}=await setup(t),entered=deferred<void>(),finish=deferred<any>();
  generation.generator.generate=async()=>{entered.resolve();return finish.promise;};const pending=ext.generated(r.id,{});await entered.promise;
  await core.returnTo(r.id,'sd');const revised=await core.saveVersion(r.documents.sd.id,{rawText:sd.rawText,sourceGherkinVersionId:g.versionId});await core.confirm(r.id,'sd',{versionId:revised.versionId!,rawSha256:revised.rawSha256!});finish.resolve(bundle());
  await assert.rejects(pending,code('SOURCE_VERSION_MISMATCH'));assert.equal((await core.getRequirement(r.id)).documents.spec.versionId,null);
});
test('a slow SD provider proposal cannot overwrite a human edit',async t=>{
  const {core,ext,r,g,generation}=await setup(t,'SD'),entered=deferred<void>(),finish=deferred<any>();
  generation.llm.generateSd=async()=>{entered.resolve();return finish.promise;};const pending=ext.generateSd(r.id,{});await entered.promise;
  const edited=await core.saveVersion(r.documents.sd.id,{rawText:'# Human edit',sourceGherkinVersionId:g.versionId});finish.resolve({status:'completed',rawText:'# Late proposal',questions:[]});
  await assert.rejects(pending,code('VERSION_CONFLICT'));assert.equal((await core.getRequirement(r.id)).documents.sd.versionId,edited.versionId);
});
test('completion reconstructs cases for a legacy fixture and resets stale stage/hash/pending metadata',async t=>{
  const {core,ext,r,g,sd,legacySkeleton}=await setup(t),skeleton=await legacySkeleton();assert.equal(skeleton.manifest.cases,undefined);
  const result=await ext.complete(r.id,{skeletonVersionId:skeleton.versionId,skeletonSha256:skeleton.rawSha256});
  assert.equal(result.status,'completed');const m=result.manifest;assert.equal(m.schemaVersion,2);assert.equal(m.sourceSkeletonVersionId,skeleton.versionId);assert.equal(m.sourceSkeletonManifestSha256,skeleton.manifestSha256);
  assert.equal(m.sourceGherkinVersionId,g.versionId);assert.equal(m.sdVersionId,sd.versionId);assert.deepEqual(m.mappings,mappings);assert.equal(m.cases.length,3);assert.equal(m.artifactStage,'COMPLETED');assert.equal(m.completionStatus,'COMPLETED');assert.deepEqual(m.pendingSlots,[]);assertSeal(m);
  assert.equal((await core.getVersion(r.documents.spec.id,skeleton.versionId!)).rawText,text(true));
});
test('skeleton ID/hash aliases and source provenance reject mismatches before the provider',async t=>{
  const {core,ext,r,g,sd,generation,legacySkeleton}=await setup(t),skeleton=await legacySkeleton();let calls=0;
  generation.llm.complete=async()=>{calls++;throw Error('Must not be called');};
  for(const key of ['skeletonSha256','skeletonHash','sourceSkeletonSha256'])await assert.rejects(ext.complete(r.id,{skeletonVersionId:skeleton.versionId,[key]:'stale'}),code('VERSION_HASH_MISMATCH'));
  await assert.rejects(ext.complete(r.id,{skeletonVersionId:skeleton.versionId,sourceSkeletonVersionId:'other'}),code('VERSION_HASH_MISMATCH'));
  await core.returnTo(r.id,'sd');const revised=await core.saveVersion(r.documents.sd.id,{rawText:sd.rawText,sourceGherkinVersionId:g.versionId});await core.confirm(r.id,'sd',{versionId:revised.versionId!,rawSha256:revised.rawSha256!});
  await assert.rejects(ext.complete(r.id,{skeletonVersionId:skeleton.versionId}),code('REGENERATE_SKELETON_REQUIRED'));assert.equal(calls,0);
});
test('a slow completion cannot overwrite a later user spec revision',async t=>{
  const {core,ext,r,g,sd,generation,legacySkeleton}=await setup(t),skeleton=await legacySkeleton(),entered=deferred<void>(),finish=deferred<any>();
  generation.llm.complete=async()=>{entered.resolve();return finish.promise;};const pending=ext.complete(r.id,{skeletonVersionId:skeleton.versionId});await entered.promise;
  const b=bundle(),fresh=await core.saveVersion(r.documents.spec.id,{rawText:b.rawText,sourceGherkinVersionId:g.versionId,testStage:'SKELETON',manifest:{...b.manifest,specSha256:sha256(b.rawText),sourceGherkinVersionId:g.versionId,gherkinSha256:g.rawSha256,sdSha256:sd.rawSha256}});
  finish.resolve({status:'completed',rawText:text(),questions:[],files:[{path:'impl.ts',rawText:'export const implemented=1;'}]});await assert.rejects(pending,code('VERSION_CONFLICT'));assert.equal((await core.getRequirement(r.id)).documents.spec.versionId,fresh.versionId);
});
test('slow development validation cannot establish a baseline for a newer unvalidated test version',async t=>{
  const {core,ext,r,generation,legacySkeleton}=await setup(t);await legacySkeleton();const validated=await ext.complete(r.id,{}),entered=deferred<void>(),finish=deferred<any>();
  generation.generator.validateCompletion=async()=>{entered.resolve();return finish.promise;};const pending=ext.beginDevelopment(r.id);await entered.promise;
  // Identical source/hash still has a distinct immutable version identity.
  const newer=await core.saveVersion(r.documents.spec.id,{rawText:validated.rawText!,sourceGherkinVersionId:validated.sourceGherkinVersionId,testStage:'COMPLETED',sourceSkeletonVersionId:validated.sourceSkeletonVersionId,manifest:validated.manifest});
  assert.equal(newer.rawSha256,validated.rawSha256);assert.notEqual(newer.versionId,validated.versionId);finish.resolve(pass());
  await assert.rejects(pending,code('VERSION_CONFLICT'));const current=await core.getRequirement(r.id);assert.equal(current.stage,'TESTS');assert.equal(current.documents.spec.versionId,newer.versionId);assert.equal(current.baseline,null);
});
test('slow development validation cannot reuse a replaced SD confirmation with identical text/hash',async t=>{
  const {core,ext,r,g,sd,generation,legacySkeleton}=await setup(t);await legacySkeleton();await ext.complete(r.id,{});const entered=deferred<void>(),finish=deferred<any>();
  generation.generator.validateCompletion=async()=>{entered.resolve();return finish.promise;};const pending=ext.beginDevelopment(r.id);await entered.promise;
  await core.returnTo(r.id,'sd');const revised=await core.saveVersion(r.documents.sd.id,{rawText:sd.rawText,sourceGherkinVersionId:g.versionId});await core.confirm(r.id,'sd',{versionId:revised.versionId!,rawSha256:revised.rawSha256!});finish.resolve(pass());
  await assert.rejects(pending,code('SOURCE_VERSION_MISMATCH'));assert.equal((await core.getRequirement(r.id)).stage,'TESTS');assert.deepEqual(await core.store.all('SELECT id FROM baselines'),[]);
});
test('failed completion checks save a source-bound draft with current hashes and actual unresolved diagnostics',async t=>{
  const {ext,r,generation,legacySkeleton}=await setup(t);await legacySkeleton();
  generation.generator.validateCompletion=async()=>({passed:false,diagnostics:[{file:'impl.ts',line:1,column:1,reason:'Unresolved completion slot slot-one'}]});
  const result=await ext.complete(r.id,{});assert.equal(result.status,'needs_input');assert.equal(result.testStage,'COMPLETION_DRAFT');assert.equal(result.manifest.artifactStage,'COMPLETION_DRAFT');assert.equal(result.manifest.completionStatus,'PENDING');assert.equal(result.manifest.pendingSlots[0].reason,'Unresolved completion slot slot-one');assertSeal(result.manifest);
});
test('completion preserves all original mappings and supports only explicitly mapped additional test IDs',async t=>{
  const {ext,r,generation,legacySkeleton}=await setup(t);await legacySkeleton();
  generation.llm.complete=async()=>({status:'completed',questions:[],rawText:text(false,['test-a','test-b'])});await assert.rejects(ext.complete(r.id,{}),code('MAPPING_INVALID'));
  generation.llm.complete=async()=>({status:'completed',questions:[],rawText:text(),mappings:[{testKey:'test-a',scenarioId:'AC-EXT-001',caseId:'b'}]});await assert.rejects(ext.complete(r.id,{}),code('LLM_ACCEPTANCE_CHANGED'));
  generation.llm.complete=async()=>({status:'completed',questions:[],rawText:text(false,[...mappings.map(m=>m.testKey),'test-new']),files:[{path:'impl.ts',rawText:'export const implemented=1;'}],mappings:[{testKey:'test-new',scenarioId:'AC-EXT-001',caseId:'a'}]});
  const saved=await ext.complete(r.id,{});assert.equal(saved.manifest.mappings.length,4);assert.deepEqual(saved.manifest.mappings.slice(0,3),mappings);assert.equal(saved.manifest.cases.find((c:any)=>c.testKey==='test-new').caseId,'a');
});
test('changed source pin passes projectId and invalidates old runs while an equivalent commit preserves them',async t=>{
  const {core,ext,r,project,workspace,legacySkeleton}=await setup(t);await legacySkeleton();await ext.complete(r.id,{});const developed=await core.startDevelopment(r.id);assert.ok(developed.baseline);
  const calls:any[]=[];workspace.resolveSource=async(...args:any[])=>{calls.push(args);return {sourceRef:args[0],resolvedCommit:args[0]==='other'?'b'.repeat(40):'a'.repeat(40)};};
  await ext.pinSource(r.id,{sourceRef:'initial'});assert.equal(calls[0][2],project.id);
  await core.store.run("INSERT INTO runs(id,project_id,requirement_id,feature_id,origin,execution_scope,baseline_id,definition_snapshot_json,environment_snapshot_json,status) VALUES (?,?,?,?,'target_ci','ALL_REQUIRED',?,'{}','{}','PASSED')",['old-run',project.id,r.id,r.featureId,developed.baseline.id]);await core.store.run("UPDATE features SET stage='VERIFIED' WHERE id=?",[r.featureId]);
  await ext.pinSource(r.id,{sourceRef:'same'});assert.equal((await core.getRequirement(r.id)).stage,'VERIFIED');assert.equal((await core.store.all('SELECT status FROM runs'))[0].status,'PASSED');
  await ext.pinSource(r.id,{sourceRef:'other'});assert.equal((await core.getRequirement(r.id)).stage,'IMPLEMENTATION');assert.equal((await core.store.all('SELECT status FROM runs'))[0].status,'INVALID');assert.equal((await core.store.all("SELECT count(*) n FROM baselines WHERE kind='source' AND valid=1"))[0].n,1);assert.equal((await core.store.all('SELECT valid FROM baselines WHERE id=?',[developed.baseline.id]))[0].valid,1);
});
test('first source pin from verification works without a prior source baseline and resets obsolete results',async t=>{
  const {core,ext,r,project,legacySkeleton}=await setup(t);await legacySkeleton();await ext.complete(r.id,{});const developed=await core.startDevelopment(r.id);assert.ok(developed.baseline);
  await core.store.run("INSERT INTO runs(id,project_id,requirement_id,feature_id,origin,execution_scope,baseline_id,definition_snapshot_json,environment_snapshot_json,status) VALUES (?,?,?,?,'target_ci','ALL_REQUIRED',?,'{}','{}','PASSED')",['old-run',project.id,r.id,r.featureId,developed.baseline.id]);await core.store.run("UPDATE features SET stage='VERIFICATION' WHERE id=?",[r.featureId]);
  await ext.pinSource(r.id,{sourceRef:'initial'});assert.equal((await core.getRequirement(r.id)).stage,'IMPLEMENTATION');assert.equal((await core.store.all('SELECT status FROM runs'))[0].status,'INVALID');
});
test('repository snapshot stores the adapter-resolved path even when the HTTP input used filePath',async t=>{
  const {core,ext,r,git}=await setup(t);let requested:any;
  git.readSnapshot=async(input:any)=>{requested=input;return {repo:'resolved-repository',branch:'resolved-branch',commit:'c'.repeat(40),path:'resolved/demo.spec.ts',rawText:text()};};
  const result=await ext.snapshot({requirementId:r.id,repositoryUrl:'input-repository',branchRef:'main',commitSha:'c'.repeat(40),filePath:'input.spec.ts',manifest:{specSha256:sha256(text()),mappings}});
  assert.equal(requested.path,'input.spec.ts');const row=(await core.store.all('SELECT * FROM git_snapshots WHERE spec_version_id=?',[result.versionId]))[0];assert.equal(row.file_path,'resolved/demo.spec.ts');assert.equal(row.repository_url,'resolved-repository');assert.equal(row.branch_ref,'resolved-branch');
});

test('LLM completion cannot rewrite approved SD or export outside its feature directory',async t=>{
 const {core,ext,r,generation}=await setup(t);
 const generated=bundle();
 generated.files.push({path:'spec/REQ-EXT-001/checkout/checkout.sd.md',rawText:'# Approved design'});
 generation.generator.generate=async()=>({...generated,manifest:{...generated.manifest,bundleDirectory:'spec/REQ-EXT-001/checkout'}});
 await ext.generated(r.id,{});
 const before=await core.getRequirement(r.id);
 for(const [path,code] of [['spec/REQ-EXT-001/checkout/checkout.sd.md','APPROVED_SD_CHANGED'],['spec/REQ-EXT-001/sibling/sibling.steps.ts','BUNDLE_SCOPE_INVALID']]){
  generation.llm.complete=async()=>({status:'completed',questions:[],rawText:text(),files:[{path,rawText:'changed'}]});
  await assert.rejects(ext.complete(r.id,{}),(e:any)=>e.code===code);
  assert.deepEqual(await core.getRequirement(r.id),before);
 }
});
