import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openStore } from '../../packages/workstation/store.mjs';
import { importBoundRepository, prepareProjection } from '../../packages/workstation/projection.mjs';
import { digest } from '../../packages/contracts/index.mjs';
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


test('binding keeps a locally edited draft when incoming content still equals its base', async t => {
  const f=await bound(t),store=openStore(f.home);t.after(()=>store.close());
  const file='spec/REQ-001/login/login.feature';
  let snapshot=await importBoundRepository({root:f.root,store,git,request:{repositoryId:'SPEC-bound',operationId:'OP-initial'}},store.draft('SPEC-bound'));
  const before=snapshot.files.find(x=>x.path===file);
  assert.ok(before.baseHash);
  store.saveDraft('SPEC-bound',{expectedRevision:snapshot.revision,files:[{target:'spec',path:file,content:'Feature: preserved human edit\n'}],operationId:'OP-human',request:{edit:true}});
  snapshot=await importBoundRepository({root:f.root,store,git,request:{repositoryId:'SPEC-bound',operationId:'OP-again'}},store.draft('SPEC-bound'));
  const after=snapshot.files.find(x=>x.path===file);
  assert.equal(after.content,'Feature: preserved human edit\n');
  assert.equal(after.baseHash,before.baseHash);
});

test('an accepted checkout import replaces bootstrap baselines and permits later SQL tool edits to export',async t=>{
  const f=await bound(t),store=openStore(f.home);t.after(()=>store.close());
  const repositoryId='SPEC-bound',file='.workbench-tools/git-core/index.mjs';
  const before=store.draft(repositoryId),old=before.files.find(item=>item.path===file);
  const imported=old.content+'\n// accepted checkout revision\n';await writeFile(path.join(f.root,file),imported);
  await git.command(f.root,['remote','add','origin',f.root]);
  const context={root:f.root,store,git,options:{toolkitRoot,allowLocal:true},request:{repositoryId,operationId:'OP-import-updated'}};
  const snapshot=await importBoundRepository(context,before);
  assert.equal(snapshot.files.find(item=>item.path===file).baseHash,digest(imported));
  const content=imported+'\n// later SQL authoring edit\n';
  store.saveDraft(repositoryId,{expectedRevision:snapshot.revision,settings:{...snapshot.settings,configured:true,reviewer:'Human'},files:[{target:'spec',path:file,content}],operationId:'OP-edit-tool',request:{edit:true}});
  await prepareProjection({...context,request:{repositoryId,operationId:'OP-export-updated'}});
  assert.equal(await readFile(path.join(f.root,file),'utf8'),content);
});

test('legacy import repair restores only proven baselines, retains authored content, and still rejects external edits',async t=>{
  const f=await bound(t),store=openStore(f.home);t.after(()=>store.close());
  const repositoryId='SPEC-bound',file='.workbench-tools/git-core/index.mjs';
  const before=store.draft(repositoryId),old=before.files.find(item=>item.path===file);
  const firstImport=old.content+'\n// accepted prior checkout\n',imported=firstImport+'\n// later accepted checkout\n';
  await writeFile(path.join(f.root,file),imported);await git.command(f.root,['remote','add','origin',f.root]);
  // Reproduce the old importer: accepted provenance is retained in history,
  // but COALESCE keeps the bootstrap base in authoring_files and its receipt.
  store.saveDraft(repositoryId,{expectedRevision:before.revision,settings:{...before.settings,configured:true,reviewer:'Human'},files:[{target:'spec',path:file,content:firstImport,baseHash:digest(firstImport),origin:'checkout'}],operationId:'import-OP-legacy',request:{import:true},result:{imported:true}});
  const accepted=store.draft(repositoryId);
  store.setProjection(repositoryId,{status:'IMPORTED',revision:accepted.revision,files:[{target:'spec',path:file,sha256:old.baseHash}]});
  store.saveDraft(repositoryId,{expectedRevision:accepted.revision,files:[{target:'spec',path:file,content:imported,baseHash:digest(imported),origin:'checkout'}],operationId:'import-OP-legacy-later',request:{import:true},result:{imported:true}});
  const content=imported+'\n// preserve the SQL draft\n';
  store.saveDraft(repositoryId,{expectedRevision:store.draft(repositoryId).revision,files:[{target:'spec',path:file,content}],operationId:'OP-sql-edit',request:{edit:true}});
  const revision=store.draft(repositoryId).revision;
  assert.equal(store.repairImportBaselines(repositoryId).corrected,1);
  assert.equal(store.draft(repositoryId).revision,revision);
  assert.equal(store.draft(repositoryId).files.find(item=>item.path===file).content,content);
  assert.equal(store.projection(repositoryId).files.find(item=>item.path===file).sha256,digest(imported));
  assert.equal(store.repairImportBaselines(repositoryId).corrected,0,'Repair is idempotent');
  await writeFile(path.join(f.root,file),imported+'\n// actual external edit\n');
  const context={root:f.root,store,git,options:{toolkitRoot,allowLocal:true},request:{repositoryId,operationId:'OP-export-conflict'}};
  await assert.rejects(prepareProjection(context),{code:'EXPORT_CONFLICT'});
  assert.equal(await readFile(path.join(f.root,file),'utf8'),imported+'\n// actual external edit\n');
  assert.equal(store.draft(repositoryId).files.find(item=>item.path===file).content,content);
  await writeFile(path.join(f.root,file),imported);
  await prepareProjection({...context,request:{repositoryId,operationId:'OP-export-repaired'}});
  assert.equal(await readFile(path.join(f.root,file),'utf8'),content);
  const exported=store.projection(repositoryId);store.repairImportBaselines(repositoryId);
  assert.deepEqual(store.projection(repositoryId),exported,'A newer export checkpoint must not revert to an import baseline');
});
