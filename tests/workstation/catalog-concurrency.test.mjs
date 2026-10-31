import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { openStore } from '../../packages/workstation/store.mjs';
import { importBoundRepository } from '../../packages/workstation/projection.mjs';
import { ensureDraft } from '../../packages/workstation/authoring.mjs';
import { fixture, git, toolkitRoot, specRepository } from './helpers.mjs';

async function bound(t) {
  const f=await fixture(t);await mkdir(f.home);await specRepository(f.repo);
  const store=openStore(f.home);
  store.register({id:'SPEC-bound',title:'Concurrent import',remoteUrl:f.repo});
  await ensureDraft({root:f.repo,options:{toolkitRoot},store,repositoryId:'SPEC-bound'});store.close();
  return {...f,root:f.repo};
}

test('binding retries an import when simultaneous settings save advances SQLite without overwriting that save',async t=>{
  const f=await bound(t),store=openStore(f.home);t.after(()=>store.close());
  const save=store.saveDraft.bind(store),snapshot=store.draft('SPEC-bound');let interrupted=false;
  store.saveDraft=(repositoryId,input)=>{
    if(!interrupted&&input.operationId==='import-OP-concurrent') {
      interrupted=true;const current=store.draft(repositoryId);
      save(repositoryId,{expectedRevision:current.revision,settings:{...current.settings,reviewer:'Concurrent reviewer',configured:true},files:[{target:'spec',path:'spec/extra-draft.md',content:'keep this draft'}],operationId:'OP-settings',request:{save:true}});
    }
    return save(repositoryId,input);
  };
  const result=await importBoundRepository({root:f.root,store,git,request:{repositoryId:'SPEC-bound',operationId:'OP-concurrent'}},snapshot);
  assert.equal(interrupted,true);assert.equal(result.settings.reviewer,'Concurrent reviewer');assert.equal(result.settings.configured,true);
  assert.equal(result.files.find(x=>x.path==='spec/extra-draft.md').content,'keep this draft');
  assert.ok(result.files.some(x=>x.path==='spec/REQ-001/login/login.feature'));
});
test('concurrent import retry still rejects overlapping content changes and retains the newer SQL draft',async t=>{
  const f=await bound(t),store=openStore(f.home);t.after(()=>store.close());
  const save=store.saveDraft.bind(store),snapshot=store.draft('SPEC-bound'),file='spec/REQ-001/login/login.feature';let interrupted=false;
  store.saveDraft=(repositoryId,input)=>{
    if(!interrupted&&input.operationId==='import-OP-overlap') {
      interrupted=true;const current=store.draft(repositoryId);
      save(repositoryId,{expectedRevision:current.revision,files:[{target:'spec',path:file,content:'Feature: human edit while importing\n'}],operationId:'OP-human-edit',request:{edit:true}});
    }
    return save(repositoryId,input);
  };
  await assert.rejects(importBoundRepository({root:f.root,store,git,request:{repositoryId:'SPEC-bound',operationId:'OP-overlap'}},snapshot),{code:'IMPORT_CONFLICT'});
  assert.equal(store.draft('SPEC-bound').files.find(x=>x.path===file).content,'Feature: human edit while importing\n');
});
