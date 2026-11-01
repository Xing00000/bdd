import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {scan, reviewState, confirm} from '../../packages/spec-toolkit/index.mjs';
import {runBddCommand} from '../../packages/spec-toolkit/engine.mjs';

async function catalog(t) {
  const root=await mkdtemp(path.join(os.tmpdir(),'authoring-catalog-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const put=async(file,value)=>{await mkdir(path.dirname(path.join(root,file)),{recursive:true});await writeFile(path.join(root,file),typeof value==='string'?value:JSON.stringify(value));};
  await put('workbench.yaml',{schemaVersion:1,specRepositoryId:'source-catalog',layout:{specRoot:'spec',testsRoot:'tests',reportsRoot:'reports',projectsRoot:'projects'},projects:[],execution:{featureIsolation:'process'},reports:{storage:'git',publishMode:'explicit'}});
  await put('spec/sdk/requirement.yaml',{schemaVersion:1,id:'sdk',title:'SDK',features:['world']});
  await put('spec/sdk/review.json',{schemaVersion:1,features:{}});
  const metadata={schemaVersion:1,id:'world',requirementId:'sdk',title:'World',authoringOnly:true,projectIds:[],caseIds:['WORLD-001'],profiles:[]};
  await put('spec/sdk/world/feature.yaml',metadata);
  await put('spec/sdk/world/world.feature','Feature: World\n  @case:WORLD-001\n  Scenario: Read saved state\n    Given a saved world\n    Then the world state is readable\n');
  await put('spec/sdk/world/world.sd.md','# World\nExternal native test implementation is maintained by the SDK package.\n');
  return {root,put,metadata};
}

test('authored specs are readable without browser profiles or fabricated test implementations',async t=>{
  const {root}=await catalog(t),data=await scan(root);
  assert.equal(data.features.length,1);
  assert.deepEqual(data.features[0].testPlan,{paths:[],ready:false});
  assert.equal((await reviewState(root,'sdk','world')).stage,'GHERKIN');
  await assert.rejects(confirm(root,{requirementId:'sdk',featureId:'world',stage:'tests',confirmedBy:'reviewer'}),{code:'TEST_RUNNER_NOT_CONFIGURED'});
  for(const mode of ['generate','list','test'])await assert.rejects(runBddCommand(root,mode,'sdk','world'),{code:'TEST_RUNNER_NOT_CONFIGURED'});
});

test('authored specs still require real Gherkin and design sources',async t=>{
  const {root}=await catalog(t);
  await rm(path.join(root,'spec/sdk/world/world.feature'));
  await assert.rejects(scan(root));
});

test('executable feature metadata retains the required browser matrix',async t=>{
  const {root,put,metadata}=await catalog(t);
  delete metadata.authoringOnly;
  await put('spec/sdk/world/feature.yaml',metadata);
  await assert.rejects(scan(root),{code:'CONTRACT_INVALID'});
});

test('authored specs cannot advertise a browser execution matrix',async t=>{
  const {root,put,metadata}=await catalog(t);
  await put('spec/sdk/world/feature.yaml',{...metadata,profiles:['chromium']});
  await assert.rejects(scan(root),{code:'CONTRACT_INVALID'});
});
