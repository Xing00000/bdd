import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,rm,cp,mkdir,writeFile,symlink} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {initialize} from '../../packages/spec-toolkit/index.mjs';
import {readJson} from '../../packages/contracts/index.mjs';
import {saveComposer} from '../../packages/workstation/requirements.mjs';

async function composer(t,gherkin) {
  const root=await mkdtemp(path.join(os.tmpdir(),'bdd-requirement-cases-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await initialize(root,{specRepositoryId:'SPEC-cases'});
  const saved=await saveComposer(root,{description:'Preserve the authored case identities.',gherkin,expectedToken:null});
  return {root,saved,metadata:()=>readJson(path.join(root,'spec',saved.key,'feature.yaml'))};
}

test('saving a legacy case tag preserves its identity in the configured test matrix',async t=>{
  const f=await composer(t,'Feature: Legacy tags\n  @case=CASE-LEGACY\n  Scenario: Existing acceptance\n    Given a saved requirement\n');
  assert.deepEqual((await f.metadata()).caseIds,['CASE-LEGACY']);
});

test('saving Scenario Outlines configures concrete Examples rows rather than the outline tag',async t=>{
  const gherkin=`Feature: Examples
  @case:OUTLINE
  Scenario Outline: Value <value>
    Given the value is <value>
    Examples:
      | case_id | value |
      | CASE-A  | one   |
      | CASE-B  | two   |
`;
  const f=await composer(t,gherkin);
  assert.deepEqual((await f.metadata()).caseIds,['CASE-A','CASE-B']);
  assert.equal(f.saved.gherkin,gherkin);
});

test('comments and document payloads cannot create phantom acceptance cases',async t=>{
  const gherkin=`Feature: Literal text
  # Preserve this example: @case:COMMENT
  @case:CASE-A
  Scenario: Documentation payload
    Given a document
      """
      @case:DOCUMENT
      """
    Then the document is preserved
`;
  const f=await composer(t,gherkin);
  assert.deepEqual((await f.metadata()).caseIds,['CASE-A']);
});

test('unfinished edits remain saveable and retain the last complete case matrix',async t=>{
  const f=await composer(t,'Feature: Draft\n  @case:CASE-A\n  Scenario: A\n    Given a document\n');
  const gherkin='Feature: Draft\n  @case:CASE-NEW\n  Scenario: A\n    Given a document\n    unfinished new step\n';
  const saved=await saveComposer(f.root,{description:'Unfinished edits',gherkin,requirementId:f.saved.requirementId,featureId:f.saved.featureId,expectedToken:f.saved.token});
  assert.equal(saved.gherkin,gherkin);
  assert.ok(saved.diagnostics.length);
  assert.deepEqual((await f.metadata()).caseIds,['CASE-A']);
});

async function isolatedComposer(t) {
  const checkout=await mkdtemp(path.join(os.tmpdir(),'bdd-no-dependency-checkout-'));
  t.after(()=>rm(checkout,{recursive:true,force:true}));
  const toolkitRoot=fileURLToPath(new URL('../..',import.meta.url));
  for(const directory of ['packages','templates'])await cp(path.join(toolkitRoot,directory),path.join(checkout,directory),{recursive:true});
  const source=pathToFileURL(path.join(checkout,'packages/workstation/requirements.mjs'));
  assert.throws(()=>createRequire(source).resolve('@cucumber/gherkin'),{code:'MODULE_NOT_FOUND'},'The copied checkout must not inherit installed parser dependencies');
  const {initialize,reviewState}=await import(pathToFileURL(path.join(checkout,'packages/spec-toolkit/index.mjs')));
  const {saveComposer}=await import(source);
  const root=path.join(checkout,'fixture');await mkdir(root);
  await initialize(root,{specRepositoryId:'SPEC-isolated'});
  return {checkout,toolkitRoot,root,saveComposer,reviewState,metadata:saved=>readJson(path.join(root,'spec',saved.key,'feature.yaml'))};
}

test('a checkout without dependencies can save description-only and simple tagged drafts without approving them',async t=>{
  const f=await isolatedComposer(t);
  let saved=await f.saveComposer(f.root,{description:'Only a draft description',gherkin:'',expectedToken:null});
  assert.equal(saved.description,'Only a draft description');assert.equal(saved.gherkin,'');assert.ok(saved.diagnostics.length);
  const gherkin=`Feature: Optional parser
  # An example, not a tag: @case:COMMENT
  @case:CASE-A
  Scenario: First draft
    Given a document
      """
      @case:DOCUMENT
      """
  @case=CASE-B
  Scenario: Legacy draft
    Given another document
`;
  saved=await f.saveComposer(f.root,{description:'Draft',gherkin,requirementId:saved.requirementId,featureId:saved.featureId,expectedToken:saved.token});
  assert.deepEqual((await f.metadata(saved)).caseIds,['CASE-A','CASE-B']);
  const invalid=gherkin+'    unfinished new step\n';
  saved=await f.saveComposer(f.root,{description:'Draft',gherkin:invalid,requirementId:saved.requirementId,featureId:saved.featureId,expectedToken:saved.token});
  assert.equal(saved.gherkin,invalid);assert.ok(saved.diagnostics.length);
  assert.deepEqual((await f.metadata(saved)).caseIds,['CASE-A','CASE-B']);
  assert.deepEqual((await f.reviewState(f.root,saved.requirementId,saved.featureId)).confirmed,{gherkin:false,sd:false,tests:false});
});

test('an Outline saved without tools receives concrete cases when saved again after parser installation',async t=>{
  const f=await isolatedComposer(t);
  const gherkin=`Feature: Deferred expansion
  @case:OUTLINE
  Scenario Outline: Value <value>
    Given the value is <value>
    Examples:
      | case_id | value |
      | CASE-A  | one   |
      | CASE-B  | two   |
`;
  let saved=await f.saveComposer(f.root,{description:'Draft',gherkin,expectedToken:null});
  assert.equal(saved.gherkin,gherkin);
  assert.deepEqual((await f.metadata(saved)).caseIds,['CASE-001'],'Without a parser, retain the existing matrix instead of inventing expanded cases');
  await symlink(path.join(f.toolkitRoot,'node_modules'),path.join(f.checkout,'node_modules'),'dir');
  saved=await f.saveComposer(f.root,{description:'Draft',gherkin,requirementId:saved.requirementId,featureId:saved.featureId,expectedToken:saved.token});
  assert.deepEqual((await f.metadata(saved)).caseIds,['CASE-A','CASE-B']);
  assert.deepEqual((await f.reviewState(f.root,saved.requirementId,saved.featureId)).confirmed,{gherkin:false,sd:false,tests:false});
});

test('a broken parser installation is surfaced instead of treated as an absent optional parser',async t=>{
  const f=await isolatedComposer(t);
  for(const name of ['gherkin','messages']) {
    const directory=path.join(f.checkout,'node_modules/@cucumber',name);await mkdir(directory,{recursive:true});
    await writeFile(path.join(directory,'package.json'),JSON.stringify({name:`@cucumber/${name}`,type:'module',exports:'./index.mjs'}));
    await writeFile(path.join(directory,'index.mjs'),name==='gherkin'?"import 'missing-transitive-cucumber-fixture';\n":'export const IdGenerator = {}; export const SourceMediaType = {};\n');
  }
  await assert.rejects(f.saveComposer(f.root,{description:'Draft',gherkin:'Feature: A\n  @case:CASE-A\n  Scenario: A\n    Given a document\n',expectedToken:null}),error=>error.code==='ERR_MODULE_NOT_FOUND'&&error.message.includes('missing-transitive-cucumber-fixture'));
});
