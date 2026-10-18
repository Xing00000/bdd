import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createCore} from '../../src/application/core.ts';
import {schema} from '../../src/adapters/sqlite/schema.ts';
import {applyMetadataMigrations} from '../../src/adapters/sqlite/migrations.ts';

test('Gherkin siblings own separate documents, confirmations, phases and invalidation',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'bdd-features-'));
 const core=await createCore(join(directory,'metadata.sqlite'));
 t.after(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});
 const project=await core.createProject({name:'Sibling workflows',workspaceRef:directory});
 const first=await core.createRequirement(project.id,{requirementKey:'REQ-MULTI'});
 const second=await core.createFeature(first.id,{featureKey:'checkout'});
 assert.notEqual(first.featureId,second.featureId);
 assert.equal(second.documents.sd.fileName,'checkout.sd.md');
 assert.equal(second.documents.spec.fileName,'checkout.feature.spec.ts');
 await assert.rejects(core.getRequirement(first.id),(e:any)=>e.code==='FEATURE_REQUIRED');
 const snapshots=[];
 for(const f of [first,second]){
  const g=await core.saveVersion(f.documents.gherkin.id,{rawText:'Feature: Sibling\n @AC-MULTI-001\n Scenario: same stable ID in its source version\n  Given a customer\n  Then an explicit outcome\n'});
  await core.confirm(first.id,'gherkin',{featureId:f.featureId,versionId:g.versionId!,rawSha256:g.rawSha256!});
  const sd=await core.saveVersion(f.documents.sd.id,{rawText:'# Dedicated design\nDesign for this feature.',sourceGherkinVersionId:g.versionId});
  await core.confirm(first.id,'sd',{featureId:f.featureId,versionId:sd.versionId!,rawSha256:sd.rawSha256!});
  snapshots.push(await core.getRequirement(first.id,f.featureId));
 }
 assert.equal(snapshots[0].stage,'TESTS');assert.equal(snapshots[1].stage,'TESTS');
 await assert.rejects(core.saveVersion(first.documents.sd.id,{rawText:'wrong sibling',sourceGherkinVersionId:snapshots[1].documents.gherkin.versionId}));
 await core.returnTo(first.id,'gherkin',first.featureId);
 assert.deepEqual((await core.getRequirement(first.id,first.featureId)).confirmations,{});
 const sibling=await core.getRequirement(first.id,second.featureId);
 assert.deepEqual(sibling.documents,snapshots[1].documents);
 assert.deepEqual(sibling.confirmations,snapshots[1].confirmations);
 assert.equal(sibling.stage,snapshots[1].stage);
 assert.deepEqual(sibling.baseline,snapshots[1].baseline);
 assert.equal(sibling.features.find(f=>f.id===first.featureId)!.stage,'GHERKIN');
 await assert.rejects(core.confirm(first.id,'gherkin',{featureId:first.featureId,versionId:snapshots[1].documents.gherkin.versionId!,rawSha256:snapshots[1].documents.gherkin.rawSha256!}));
 await assert.rejects(core.scenarioTests(first.id,{featureId:first.featureId,gherkinVersionId:snapshots[1].documents.gherkin.versionId!}));
 const other=await core.createRequirement(project.id,{requirementKey:'REQ-OTHER'});
 await assert.rejects(core.getRequirement(first.id,other.featureId));
 assert.equal((await core.listRequirements(project.id))[0].features.length,2);
});

test('version 1 migration preserves legacy documents, phase and exact confirmation hashes',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('PRAGMA foreign_keys=ON');db.exec(schema);db.exec('PRAGMA user_version=1');
  db.exec("INSERT INTO projects VALUES('p','legacy','workspace'); INSERT INTO requirements VALUES('r','p','REQ-LEGACY','SD'); INSERT INTO documents VALUES('d','p','r','gherkin','requirement','legacy.feature');");
  const digest='a'.repeat(64);
  db.prepare('INSERT INTO document_versions(id,document_id,version_no,raw_text,raw_sha256,projection_schema_version,created_at) VALUES(?,?,?,?,?,?,?)').run('v','d',1,'Feature: legacy',digest,1,'2026-10-17');
  db.exec("INSERT INTO document_heads VALUES('d','v')");
  db.prepare('INSERT INTO confirmations VALUES(?,?,?,?,?)').run('r','gherkin','v',digest,'2026-10-17');
  applyMetadataMigrations(db);
  assert.equal(db.prepare('SELECT stage FROM features WHERE requirement_id=?').get('r')!.stage,'SD');
  assert.equal(db.prepare('SELECT raw_sha256 FROM confirmations WHERE feature_id=?').get('r')!.raw_sha256,digest);
  assert.equal(db.prepare('SELECT feature_id FROM documents WHERE id=?').get('d')!.feature_id,'r');
  assert.equal(db.prepare('PRAGMA table_info(requirements)').all().some(row=>row.name==='stage'),false);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  applyMetadataMigrations(db);
  assert.equal(db.prepare('SELECT count(*) n FROM features').get()!.n,1);
 }finally{db.close();}
});
