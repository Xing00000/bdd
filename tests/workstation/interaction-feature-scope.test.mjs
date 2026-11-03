import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openStore} from '../../packages/workstation/store.mjs';

async function setup(t){
  const home=await mkdtemp(path.join(os.tmpdir(),'history-feature-'));t.after(()=>rm(home,{recursive:true,force:true}));let store=openStore(home);t.after(()=>store.close());
  store.register({id:'SPEC-history',title:'History',remoteUrl:'https://github.com/example/history.git'});
  return {home,get store(){return store;},reopen(){store.close();store=openStore(home);},enqueue(operationId,operation,input){return store.enqueue({schemaVersion:1,operationId,repositoryId:'SPEC-history',operation,input});}};
}
test('feature filtering includes inherited CLI replies and paginates only within the selected feature and stage',async t=>{
  const f=await setup(t);
  f.enqueue('OP-a','workflow.develop',{requirementId:'REQ-001',featureId:'a',prompt:'A'});
  f.enqueue('OP-a-reply','interaction.cli.input',{parentOperationId:'OP-a',requirementId:'REQ-001',featureId:'b',message:'A reply'});f.store.finish('OP-a','SUCCEEDED',{});
  f.enqueue('OP-b','workflow.develop',{requirementId:'REQ-001',featureId:'b',prompt:'B'});f.store.finish('OP-b','SUCCEEDED',{});
  f.enqueue('OP-a-design','workflow.design.generate',{requirementId:'REQ-001',featureId:'a',prompt:'A design'});f.store.finish('OP-a-design','SUCCEEDED',{});
  f.enqueue('OP-unbound','workflow.develop',{prompt:'Unbound legacy record'});f.store.finish('OP-unbound','SUCCEEDED',{});
  const query={key:'REQ-001/a',type:'IMPLEMENTATION',limit:1},first=f.store.interactions('SPEC-history',query);assert.equal(first.entries[0].id,'OP-a-reply');assert.equal(first.entries[0].interactionKey,'REQ-001/a');assert.ok(first.nextCursor);
  const second=f.store.interactions('SPEC-history',{...query,before:first.nextCursor});assert.equal(second.entries[0].id,'OP-a');assert.equal(second.nextCursor,null);
  assert.deepEqual(f.store.interactions('SPEC-history',{key:'REQ-001/b',type:'IMPLEMENTATION'}).entries.map(e=>e.id),['OP-b']);
  assert.deepEqual(f.store.interactions('SPEC-history',{key:'REQ-001/a',type:'SD'}).entries.map(e=>e.id),['OP-a-design']);
  assert.throws(()=>f.store.interactions('SPEC-history',{key:'../invalid'}),{code:'INVALID_INTERACTION_KEY'});
});
test('new-draft history moves atomically to its saved feature and legacy ownership backfills without rewriting requests',async t=>{
  const f=await setup(t),editorKey='new-composer';
  const original=f.enqueue('OP-draft','workflow.gherkin.generate',{editorKey,prompt:'Generate draft'});f.enqueue('OP-draft-reply','interaction.cli.input',{parentOperationId:'OP-draft',message:'Draft reply'});
  const proposal=f.store.saveRequirementProposal('SPEC-history',{editorKey,description:'Original description',previousGherkin:'',gherkin:'Feature: Generated'});f.store.finish('OP-draft','SUCCEEDED',proposal);
  assert.equal(f.store.interactions('SPEC-history',{key:editorKey}).entries.length,2);
  assert.equal(f.store.interactions('SPEC-history',{key:'new-other'}).entries.length,0);
  const saved=f.enqueue('OP-save','workflow.requirement.save',{editorKey});const receipt=f.store.saveDraft('SPEC-history',{expectedRevision:null,files:[],settings:{},operationId:saved.id,request:saved.request,result:{key:'REQ-001/new-feature'},proposalKey:editorKey});f.store.finish(saved.id,'SUCCEEDED',receipt);
  assert.equal(f.store.interactions('SPEC-history',{key:editorKey}).entries.length,0);assert.equal(f.store.interactions('SPEC-history',{key:'REQ-001/new-feature'}).entries.length,2);
  const db=new DatabaseSync(path.join(f.home,'metadata.sqlite'));db.exec('UPDATE operations SET interaction_key=NULL');db.close();f.reopen();
  assert.equal(f.store.interactions('SPEC-history',{key:'REQ-001/new-feature'}).entries.length,2);assert.deepEqual(f.store.get('OP-draft').request,original.request);
  assert.equal(f.store.get('OP-draft-reply').interactionKey,'REQ-001/new-feature');
});
test('legacy rows bind by explicit feature identifiers and never inherit a parent from another repository',async t=>{
  const f=await setup(t);f.store.register({id:'SPEC-other',title:'Other',remoteUrl:'https://github.com/example/other.git'});
  f.enqueue('OP-parent','workflow.tests.complete',{requirementId:'REQ-002',featureId:'feature'});f.store.finish('OP-parent','SUCCEEDED',{});
  f.store.enqueue({schemaVersion:1,operationId:'OP-cross',repositoryId:'SPEC-other',operation:'interaction.cli.input',input:{parentOperationId:'OP-parent',message:'Invalid cross-repository reply'}});
  assert.equal(f.store.get('OP-cross').interactionKey,null);
  const db=new DatabaseSync(path.join(f.home,'metadata.sqlite'));db.exec('UPDATE operations SET interaction_key=NULL');db.close();f.reopen();
  assert.equal(f.store.get('OP-parent').interactionKey,'REQ-002/feature');assert.equal(f.store.get('OP-cross').interactionKey,null);
  assert.equal(f.store.interactions('SPEC-other',{key:'REQ-002/feature'}).entries.length,0);
});

test('legacy failed draft history follows a committed save receipt even before worker completion and recovery',async t=>{
  const f=await setup(t),editorKey='new-interrupted-save';
  f.enqueue('OP-failed-draft','workflow.gherkin.generate',{editorKey,prompt:'Generate'});f.store.finish('OP-failed-draft','FAILED',null,{code:'AGENT_FAILED',message:'No proposal created'});
  const save=f.enqueue('OP-interrupted-save','workflow.requirement.save',{editorKey});f.store.claim(save.id);
  f.store.saveDraft('SPEC-history',{expectedRevision:null,files:[],settings:{},operationId:save.id,request:save.request,result:{key:'REQ-003/saved'},proposalKey:editorKey});
  const db=new DatabaseSync(path.join(f.home,'metadata.sqlite'));db.exec('UPDATE operations SET interaction_key=NULL');db.close();f.reopen();
  assert.equal(f.store.get(save.id).status,'RUNNING');assert.equal(f.store.get('OP-failed-draft').interactionKey,'REQ-003/saved');
  f.store.recover();assert.equal(f.store.get(save.id).status,'SUCCEEDED');assert.equal(f.store.interactions('SPEC-history',{key:'REQ-003/saved'}).entries[0].id,'OP-failed-draft');
});
