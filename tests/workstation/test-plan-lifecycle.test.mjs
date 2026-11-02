import {readProgress} from '../../packages/git-core/progress-store.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile, readdir, symlink } from 'node:fs/promises';
import { fixture, toolkitRoot, testBrowserRoot } from './helpers.mjs';
import { createWorkstation } from '../../packages/workstation/service.mjs';
import { openStore } from '../../packages/workstation/store.mjs';
import { executeOperation } from '../../packages/workstation/operations.mjs';
import { inDraftView, sourceFiles } from '../../packages/workstation/authoring.mjs';
import { confirm, reviewState } from '../../packages/spec-toolkit/index.mjs';
import { validateTestImplementation } from '../../packages/spec-toolkit/engine.mjs';
import { withProgress } from '../../packages/git-core/progress.mjs';
import { materializeDependencies } from '../../packages/spec-toolkit/dependencies.mjs';

const ids={requirementId:'REQ-001',featureId:'arithmetic'};
const featurePath='spec/REQ-001/arithmetic/arithmetic.feature';
const designPath='spec/REQ-001/arithmetic/arithmetic.sd.md';
const stepPath='tests/REQ-001/arithmetic/arithmetic.steps.ts';
const hookPath='tests/REQ-001/arithmetic/arithmetic.hooks.ts';
const gherkin='Feature: Arithmetic\n  @case:CASE-001\n  Scenario: Addition\n    Given the operands are two and three\n    Then their sum is five\n';
const steps="import { Given, Then } from '../../_shared/bdd';\nimport { expect } from '@playwright/test';\nlet operands: number[];\nGiven('the operands are two and three', async () => { operands = [2, 3]; });\nThen('their sum is five', async () => { expect(operands.reduce((a, b) => a + b, 0)).toBe(5); });\n";
const hooks="import { AfterStep } from '../../_shared/bdd';\nAfterStep(async ({ page, $testInfo, $step }) => { await $testInfo.attach('step-' + $step.title, {contentType:'image/png',body:await page.screenshot()}); });\n";

async function setup(t,{featureText=gherkin}={}) {
  const f=await fixture(t),service=await createWorkstation({home:f.home,toolkitRoot,browserRoot:testBrowserRoot,allowLocal:true,autoAcquire:false,enableExecution:true});
  t.after(()=>service.close());service.register({id:'SPEC-plan',title:'Plan',remoteUrl:f.remote});
  const store=openStore(f.home);t.after(()=>store.close());
  const options=service.options;
  let sequence=0;
  const operations=[];
  const job=async(operation,input={})=>{
    if(operation==='workflow.tests.complete')input={...input,...await service.agentPreview('SPEC-plan',{...input,purpose:'testPlan'})};
    const operationId=`OP-plan-${++sequence}`;operations.push({operation,operationId,input});
    return withProgress(f.home,operationId,()=>executeOperation(options,store,{schemaVersion:1,repositoryId:'SPEC-plan',operationId,operation,input}));
  };
  const agentFile=path.join(f.base,'test-plan-agent.mjs');
  const agentBody=`import {writeFile} from 'node:fs/promises';\nconst root=process.argv[2];\nawait writeFile(root+'/'+${JSON.stringify(stepPath)},${JSON.stringify(steps)});\nawait writeFile(root+'/'+${JSON.stringify(hookPath)},${JSON.stringify(hooks)});\n`;
  await writeFile(agentFile,agentBody);
  await job('repository.setup',{reviewer:'Human',projects:[],agent:{command:process.execPath,args:[agentFile,'{spec}','{task}'],skills:''}});
  try { await job('repository.tools.prepare'); }
  catch(error) { assert.equal(error.code,'INSTALL_REQUIRED');assert.deepEqual(error.details.install.browsers,['chromium']);await job('repository.tools.prepare',{installConsent:error.details.install.digest}); }
  await job('workflow.create',{...ids,title:'Arithmetic'});
  const save=async(file,content)=>{const old=await service.readFile('SPEC-plan',file);return job('repository.save',{kind:'source',path:file,expectedHash:old.sha256,content});};
  await save(featurePath,featureText);await save(designPath,'# Arithmetic\nUse a module-local operand pair and verify its sum. Capture each step screenshot.\n');
  const current=async()=>(await service.detail('SPEC-plan')).spec.features[0];
  const approve=async stage=>job('workflow.review',{...ids,stage,expectedDigest:(await current()).review.hashes[stage]});
  await approve('gherkin');
  return {...f,service,store,job,save,current,approve,agentFile,agentBody,operations};
}

async function generate(f) {
  const skeleton=await f.approve('sd');
  assert.equal(skeleton.testPlan.skeleton,true);
  const source=(await f.service.readFile('SPEC-plan',stepPath)).content;
  assert.match(source,/Step implementation required/);
  assert.doesNotMatch(source,/operands = \[2, 3\]/,'Codegen must not invoke the Agent');
  assert.match((await f.service.readFile('SPEC-plan',hookPath)).content,/AfterStep/);
  return f.job('workflow.tests.complete',{...ids,expectedDigest:(await f.current()).review.hashes.tests});
}

test('settings installs tools; design codegens skeleton; explicit LLM completion validates modules; rollback clears this plan',async t=>{
  const f=await setup(t);
  await f.job('workflow.create',{requirementId:'REQ-OTHER',featureId:'unrelated',title:'Unrelated feature'});
  const unrelatedPath='spec/REQ-OTHER/unrelated/unrelated.feature';
  const unrelated=(await f.service.readFile('SPEC-plan',unrelatedPath)).content;
  await writeFile(f.agentFile,`import {existsSync} from 'node:fs';\nif(existsSync(process.argv[2]+'/'+${JSON.stringify(unrelatedPath)}))throw new Error('Unrelated Gherkin leaked into the Agent context');\n`+f.agentBody);
  assert.equal((await f.current()).testPlan.ready,false);
  await assert.rejects(f.save(featurePath,gherkin+'\n'),{code:'STAGE_READ_ONLY'});
  const generated=await generate(f);
  assert.equal(generated.nextStage,'TESTS');assert.equal(generated.testOutcome,'NOT_RUN');
  assert.equal(generated.testPlan.check.status,'CHECKED');assert.equal(generated.testPlan.check.tests,1);
  const before=await f.current();assert.equal(before.testPlan.ready,true);assert.equal(before.review.editable.sd,false);assert.equal(before.review.editable.tests,true);
  assert.equal((await f.service.readFile('SPEC-plan',stepPath)).content,steps);
  assert.equal((await f.service.readFile('SPEC-plan',hookPath)).content,hooks);
  assert.equal((await f.service.readFile('SPEC-plan',unrelatedPath)).content,unrelated);
  await f.job('repository.save',{kind:'source',path:'tests/REQ-001/arithmetic/obsolete.ts',expectedHash:null,content:'export const obsolete = true;\n'});
  await writeFile(f.agentFile,f.agentBody+"import {unlink} from 'node:fs/promises';await unlink(process.argv[2]+'/tests/REQ-001/arithmetic/obsolete.ts');\n");
  await assert.rejects(f.job('workflow.tests.complete',{...ids,expectedDigest:(await f.current()).review.hashes.tests}),{code:'AGENT_DELETED_TEST_SOURCE'});
  assert.equal((await f.service.readFile('SPEC-plan','tests/REQ-001/arithmetic/obsolete.ts')).content,'export const obsolete = true;\n');
  for(const operation of f.operations.filter(op=>op.operation==='workflow.tests.complete'||op.operation==='workflow.review'&&op.input.stage==='sd')) {
    const processes=readProgress(f.home,operation.operationId).processes;
    assert.ok(processes.every(process=>process.command!=='npm'),'Generation must never install packages');
  }
  await assert.rejects(f.save(designPath,'Changed approved design'),{code:'STAGE_READ_ONLY'});
  await assert.rejects(f.job('workflow.tests.generate',ids),{code:'TEST_PLAN_EXISTS'});
  // Exercise the canonical confirmation owner independently of browser installation.
  const snapshot=f.store.draft('SPEC-plan');
  const files=await inDraftView(snapshot,async root=>{
    const state=await reviewState(root,ids.requirementId,ids.featureId);
    await confirm(root,{...ids,stage:'tests',expectedDigest:state.hashes.tests,confirmedBy:'Human'});
    return (await sourceFiles(root)).filter(file=>file.path==='spec/REQ-001/review.json');
  });
  f.store.saveDraft('SPEC-plan',{expectedRevision:snapshot.revision,operationId:'OP-fixture-test-confirm',request:{fixture:'canonical-confirmation'},files,result:{}});
  await assert.rejects(f.save(stepPath,steps+'\n'),{code:'STAGE_READ_ONLY'});
  await assert.rejects(f.save(hookPath,hooks+'\n'),{code:'STAGE_READ_ONLY'});
  const state=await f.current();
  const rollback=await f.job('workflow.restart',{...ids,stage:'sd',expectedDigest:state.review.hashes.tests});
  assert.equal(rollback.nextStage,'SD');
  const after=await f.current();assert.equal(after.review.confirmed.gherkin,true);assert.equal(after.review.confirmed.sd,false);assert.equal(after.review.confirmed.tests,false);
  assert.equal(after.review.editable.sd,true);assert.equal(after.testPlan.ready,false);
  assert.equal((await f.service.readFile('SPEC-plan',stepPath)).content,'');assert.equal((await f.service.readFile('SPEC-plan',hookPath)).content,'');
  await assert.rejects(f.save(stepPath,steps),{code:'UPSTREAM_NOT_CONFIRMED'});
  await assert.rejects(f.job('workflow.restart',{...ids,stage:'sd',expectedDigest:before.review.hashes.gherkin}),{code:'CONTENT_CHANGED'});
  const reopened=await createWorkstation({home:f.home,toolkitRoot,allowLocal:true,autoAcquire:false});t.after(()=>reopened.close());
  const restored=(await reopened.detail('SPEC-plan')).spec.features[0];assert.equal(restored.review.stage,'SD');assert.equal(restored.testPlan.ready,false);
  // Identical upstream bytes cannot resurrect a revoked approval or a discarded plan.
  await inDraftView(f.store.draft('SPEC-plan'),async root=>{
    const state=await reviewState(root,ids.requirementId,ids.featureId);
    await confirm(root,{...ids,stage:'sd',expectedDigest:state.hashes.sd,confirmedBy:'Human'});
    assert.equal((await reviewState(root,ids.requirementId,ids.featureId)).confirmed.tests,false);
  });
});

test('generation cannot overwrite concurrent rollback and keeps its generated proposal for diagnosis',async t=>{
  const f=await setup(t);
  await f.approve('sd');
  const running=f.job('workflow.tests.complete',{...ids,expectedDigest:(await f.current()).review.hashes.tests});
  const result=assert.rejects(running,{code:'DRAFT_REVISION_CHANGED'});
  const state=await f.current();
  await f.job('workflow.restart',{...ids,stage:'sd',expectedDigest:state.review.hashes.tests});
  await result;
  assert.equal((await f.current()).review.stage,'SD');assert.equal((await f.service.readFile('SPEC-plan',stepPath)).content,'');
  const operations=await readdir(path.join(f.home,'test-plans'));
  assert.ok(operations.length>=1);
});

test('invalid and empty handlers are rejected independently of discovery',async t=>{
  const f=await setup(t);await generate(f);
  const parent=path.join(f.home,'test-plans');
  let candidate;
  for(const operation of await readdir(parent))for(const attempt of await readdir(path.join(parent,operation),{withFileTypes:true})) {
    if(!attempt.isDirectory())continue;
    const root=path.join(parent,operation,attempt.name);
    try{await readFile(path.join(root,'.runtime/test-plan-agent.json'));candidate=root;}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  assert.ok(candidate);
  await assert.rejects(readFile(path.join(candidate,'node_modules/typescript/package.json')),{code:'ENOENT'},'Generation must remove rebuildable dependencies while retaining its proposal');
  await materializeDependencies(path.join(f.home,'repositories/SPEC-plan/test-tools'),candidate);
  const {mkdir}=await import('node:fs/promises');
  await mkdir(path.join(candidate,'tests/REQ-001/arithmetic/cache'),{recursive:true});
  await mkdir(path.join(candidate,'tests/_shared/cache'),{recursive:true});
  const ignore=path.join(candidate,'.gitignore');
  await writeFile(ignore,(await readFile(ignore,'utf8'))+'\ntests/**/cache/\n');
  await writeFile(path.join(candidate,'tests/REQ-001/arithmetic/cache/broken.ts'),'let = ;');
  await writeFile(path.join(candidate,'tests/_shared/cache/broken.ts'),'let = ;');
  assert.equal((await validateTestImplementation(candidate,ids.requirementId,ids.featureId)).typecheck,'PASSED');
  await writeFile(path.join(candidate,stepPath),"import {Given} from '../../_shared/bdd';\nGiven('unfinished', async () => {});\n");
  await assert.rejects(validateTestImplementation(candidate,ids.requirementId,ids.featureId),{code:'TEST_PLAN_INCOMPLETE'});
  await writeFile(path.join(candidate,stepPath),"import {Given} from '../../_shared/bdd';\nGiven('unfinished', async () => {throw Error('pending');});\n");
  await assert.rejects(validateTestImplementation(candidate,ids.requirementId,ids.featureId),{code:'TEST_PLAN_INCOMPLETE'});
});

test('an agent proposal that edits approved design is rejected without changing SQLite sources or creating a plan',async t=>{
  const f=await setup(t),design=(await f.service.readFile('SPEC-plan',designPath)).content;
  await writeFile(f.agentFile,f.agentBody+`await writeFile(root+'/'+${JSON.stringify(designPath)},'Unapproved design change');\n`);
  await assert.rejects(generate(f),{code:'AGENT_CHANGED_INPUT'});
  const current=await f.current();assert.equal(current.review.confirmed.sd,true);assert.equal(current.testPlan.ready,true);
  assert.equal((await f.service.readFile('SPEC-plan',designPath)).content,design);
  assert.match((await f.service.readFile('SPEC-plan',stepPath)).content,/Step implementation required/);
  assert.match((await f.service.readFile('SPEC-plan',hookPath)).content,/AfterStep/);
});

test('native skeleton includes every missing definition beyond the CLI ten-snippet limit and never invokes the Agent',async t=>{
  const words=['alpha','bravo','charlie','delta','echo','foxtrot','golf','hotel','india','juliet','kilo','lima'];
  const featureText='Feature: Complete skeleton\n  @case:CASE-001\n  Scenario: All steps\n'+words.map((word,index)=>`    ${index===0?'Given':'And'} ${word} is available`).join('\n')+'\n';
  const f=await setup(t,{featureText});
  await writeFile(f.agentFile,"throw new Error('Codegen must never invoke the Agent');\n");
  const result=await f.approve('sd');assert.equal(result.testPlan.skeleton,true);
  const source=(await f.service.readFile('SPEC-plan',stepPath)).content;
  assert.equal((source.match(/^Given\(/gm)??[]).length,words.length);
  for(const word of words)assert.ok(source.includes(`${word} is available`));
  await inDraftView(f.store.draft('SPEC-plan'),async root=>{
    await symlink(path.join(toolkitRoot,'node_modules'),path.join(root,'node_modules'),'dir');
    await assert.rejects(validateTestImplementation(root,ids.requirementId,ids.featureId),{code:'TEST_PLAN_INCOMPLETE'});
  });
  await f.job('workflow.restart',{...ids,stage:'sd',expectedDigest:(await f.current()).review.hashes.tests});
  await f.job('workflow.create',{requirementId:'REQ-OTHER',featureId:'other',title:'Other'});
  const config=(await f.service.readFile('SPEC-plan','bdd.config.ts')).content;
  await f.save('bdd.config.ts',config.replace('features: `spec/${key}/${feature}.feature`',"features: 'spec/**/*.feature'"));
  await assert.rejects(f.approve('sd'),{code:'TEST_CODEGEN_FAILED'});
  assert.equal((await f.service.readFile('SPEC-plan',stepPath)).content,'');
});
