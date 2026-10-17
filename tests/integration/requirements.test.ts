import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from '../../src/http/server.ts';
import {createWorkspaceAdapter} from '../../src/adapters/workspace.ts';
import {expect} from '@playwright/test';
import {DatabaseSync} from 'node:sqlite';
import {metadataMigrations,migrationSql,applyMetadataMigrations} from '../../src/adapters/sqlite/migrations.ts';
import {sha256} from '../../src/application/core.ts';
import {projectSources} from '../../src/domain/project-sources.ts';

test('independent requirements link local repositories, route source files and pin every project without cloning documents',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'wb-requirement-projects-')),root=resolve(process.cwd());
 const server=await createServer({root,metadataFile:join(directory,'metadata.sqlite'),dataRoot:join(directory,'data'),baseUrl:'http://127.0.0.1:1'});
 t.after(async()=>{await server.app.close();await rm(directory,{recursive:true,force:true});});
 const request=async(method:'GET'|'POST'|'PUT',url:string,payload?:unknown,status=200)=>{const r=await server.app.inject({method,url,payload:payload as any});assert.equal(r.statusCode,status,r.body);return r.json();};
 const requirement=await request('POST','/requirements',{requirementKey:'REQ-CROSS'},201);
 assert.equal(requirement.projectId,null);assert.deepEqual(requirement.projects,[]);
 const projects:any[]=[];
 for(const name of ['frontend','backend']){
  const workspaceRef=join(directory,name);await mkdir(workspaceRef);await writeFile(join(workspaceRef,'app.ts'),`export const name=${JSON.stringify(name)};\n`);
  execFileSync('git',['init','-b','main',workspaceRef],{stdio:'pipe'});execFileSync('git',['-C',workspaceRef,'add','app.ts']);execFileSync('git',['-C',workspaceRef,'-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','-m','Initial source'],{stdio:'pipe'});
  const project=await request('POST','/projects',{name,workspaceRef},201);projects.push(project);
  await request('POST','/projects',{name,workspaceRef},409);
 }
 await request('PUT',`/requirements/${requirement.id}/projects`,{projectIds:projects.map(p=>p.id)});
 const current=await request('GET',`/requirements/${requirement.id}`);
 assert.equal(current.projectId,null);assert.equal(current.projects.length,2);
 assert.deepEqual(Object.values(current.documents).map((d:any)=>d.id).sort(),Object.values(requirement.documents).map((d:any)=>d.id).sort());
 assert(Object.values(current.documents).every((d:any)=>d.projectId===null&&d.requirementId===requirement.id));
 await server.core.store.run("UPDATE features SET stage='IMPLEMENTATION' WHERE id=?",[current.featureId]);
 for(const p of projects){
  const rawText=`export const changed=${JSON.stringify(p.name)};\n`;
  await request('POST',`/requirements/${requirement.id}/source`,{projectId:p.id,path:'app.ts',rawText});assert.equal(await readFile(join(p.workspaceRef,'app.ts'),'utf8'),rawText);
  execFileSync('git',['-C',p.workspaceRef,'add','app.ts']);execFileSync('git',['-C',p.workspaceRef,'-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','-m','Requirement change'],{stdio:'pipe'});
 }
 await request('POST',`/requirements/${requirement.id}/pin-source`,{sourceRef:'HEAD'},422);
 const pin=await request('POST',`/requirements/${requirement.id}/pin-source`,{projects:projects.map(p=>({projectId:p.id,sourceRef:'HEAD'}))});
 assert.equal(pin.projects.length,2);for(const p of pin.projects){assert.equal(p.repositoryRef,projects.find(item=>item.id===p.projectId).workspaceRef);assert.match(p.resolvedCommit,/^[a-f0-9]{40,64}$/);}
 const terminal=await request('POST','/terminals',{projectId:projects[0].id,requirementId:requirement.id},201);assert.equal(terminal.workspaceRef,projects[0].workspaceRef);
 let output='';server.runtime.terminal.subscribe(terminal.id,event=>{output+=event.data??'';});server.runtime.terminal.input(terminal.id,'pwd\r');
 await expect.poll(()=>output,{timeout:10000}).toContain(projects[0].workspaceRef);
 const source=await request('GET',`/requirements/${requirement.id}/source?projectId=${projects[1].id}&path=app.ts`);assert.match(source.rawText,/backend/);
 await request('POST',`/requirements/${requirement.id}/source`,{projectId:projects[0].id,path:'../outside.ts',rawText:'blocked'},400);
 const workspace=createWorkspaceAdapter(root,join(directory,'data'));await assert.rejects(workspace.saveSource(projects[0].workspaceRef,'blocked','../outside.ts'),{code:'INVALID_SOURCE_PATH'});
 await request('PUT',`/requirements/${requirement.id}/projects`,{projectIds:[projects[0].id]});
 assert.equal((await request('GET',`/requirements/${requirement.id}`)).stage,'SD');assert.equal((await server.core.store.all("SELECT valid FROM baselines WHERE kind='source'"))[0].valid,0);
 assert.equal((await request('GET','/requirements')).length,1);
});

test('populated version 3 migration preserves confirmations, Git receipts, failed run evidence and legacy source baselines',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  for(const m of metadataMigrations.filter(m=>m.toVersion<=3))db.exec(migrationSql(m));
  db.exec("INSERT INTO projects VALUES('p','legacy','/legacy/project');INSERT INTO requirements VALUES('r','p','REQ-LEGACY');INSERT INTO features VALUES('f','r','legacy','IMPLEMENTATION');INSERT INTO documents VALUES('g','p','r','gherkin','requirement','legacy.feature','f');INSERT INTO documents VALUES('s','p','r','spec','target_ci','legacy.spec.ts','f');");
  const raw='Feature: preserved legacy source',digest=sha256(raw);
  for(const [id,doc] of [['gv','g'],['sv','s']])db.prepare('INSERT INTO document_versions(id,document_id,version_no,raw_text,raw_sha256,projection_schema_version,created_at) VALUES(?,?,1,?,?,1,?)').run(id,doc,raw,digest,'legacy');
  db.prepare("INSERT INTO confirmations VALUES('f','r','gherkin','gv',?,'legacy')").run(digest);
  db.exec("INSERT INTO document_heads VALUES('g','gv');INSERT INTO document_heads VALUES('s','sv');INSERT INTO git_snapshots VALUES('sv','/legacy/project','main','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','legacy.spec.ts');");
  const legacy=JSON.stringify({sourceRef:'HEAD',resolvedCommit:'a'.repeat(40),repositoryRef:'/legacy/project'});
  db.prepare("INSERT INTO baselines VALUES('source','r','source',?,?,1,'f')").run(legacy,sha256(legacy));
  db.prepare("INSERT INTO baselines VALUES('tests','r','tests',?,?,1,'f')").run('{}',sha256('{}'));
  db.exec("INSERT INTO runs(id,project_id,requirement_id,feature_id,origin,execution_scope,baseline_id,source_ref,definition_snapshot_json,environment_snapshot_json,status) VALUES('run','p','r','f','target_ci','ALL_REQUIRED','tests','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','{}','{}','FAILED');INSERT INTO case_results(id,run_id,runtime_test_key,status) VALUES('case','run','legacy-incomplete','FAILED');INSERT INTO step_results(id,case_result_id,action_index,expected_json,actual_json,status,error_text) VALUES('step','case',1,'1','2','FAILED','preserved mismatch');");
  db.prepare("INSERT INTO screenshots VALUES('shot','step','failure','legacy/failure.png',?)").run(digest);
  const before={versions:db.prepare('SELECT * FROM document_versions ORDER BY id').all(),runs:db.prepare('SELECT * FROM runs').all(),steps:db.prepare('SELECT * FROM step_results').all(),shots:db.prepare('SELECT * FROM screenshots').all(),baselines:db.prepare('SELECT * FROM baselines ORDER BY id').all()};
  applyMetadataMigrations(db);
  assert.equal(db.prepare('SELECT project_id FROM requirement_projects').get()!.project_id,'p');assert.equal(db.prepare('SELECT project_id FROM documents WHERE id=?').get('g')!.project_id,null);assert.equal(db.prepare('SELECT project_id FROM git_snapshots').get()!.project_id,'p');
  assert.deepEqual(db.prepare('SELECT * FROM document_versions ORDER BY id').all(),before.versions);assert.deepEqual(db.prepare('SELECT * FROM runs').all(),before.runs);assert.deepEqual(db.prepare('SELECT * FROM step_results').all(),before.steps);assert.deepEqual(db.prepare('SELECT * FROM screenshots').all(),before.shots);assert.deepEqual(db.prepare('SELECT * FROM baselines ORDER BY id').all(),before.baselines);
  assert.equal(db.prepare('SELECT raw_sha256 FROM confirmations').get()!.raw_sha256,digest);assert.equal(projectSources(JSON.parse(legacy),['p'])[0].resolvedCommit,'a'.repeat(40));assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(db.prepare('PRAGMA foreign_keys').get()!.foreign_keys,1);
 }finally{db.close();}
});

test('version 4 Git receipt migration preserves the repository owner after requirement project reassociation',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  for(const migration of metadataMigrations.filter(m=>m.toVersion<=4))db.exec(migrationSql(migration));
  db.exec("INSERT INTO projects VALUES('a','A','/repo/a');INSERT INTO projects VALUES('b','B','/repo/b');INSERT INTO requirements VALUES('r','REQ-OWNER');INSERT INTO requirement_projects VALUES('r','b');INSERT INTO features VALUES('f','r','main','TESTS');INSERT INTO documents VALUES('d',NULL,'r','spec','target_ci','main.spec.ts','f');");
  db.prepare("INSERT INTO document_versions(id,document_id,version_no,raw_text,raw_sha256,projection_schema_version,created_at) VALUES('v','d',1,?,?,1,'legacy')").run('immutable',sha256('immutable'));
  db.exec("INSERT INTO git_snapshots VALUES('v','/repo/a','main','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','main.spec.ts');");
  db.prepare("INSERT INTO document_versions(id,document_id,version_no,raw_text,raw_sha256,projection_schema_version,created_at) VALUES('v-unmatched','d',2,?,?,1,'legacy')").run('immutable unmatched receipt',sha256('immutable unmatched receipt'));
  db.exec("INSERT INTO git_snapshots VALUES('v-unmatched','/workspace/unregistered-repository','legacy','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','legacy.spec.ts');");
  applyMetadataMigrations(db);
  assert.equal(db.prepare('SELECT project_id FROM git_snapshots WHERE spec_version_id=?').get('v')!.project_id,'a');
  const unmatched=db.prepare('SELECT project_id,repository_url,branch_ref,commit_sha,file_path FROM git_snapshots WHERE spec_version_id=?').get('v-unmatched');
  assert.deepEqual({...unmatched},{project_id:null,repository_url:'/workspace/unregistered-repository',branch_ref:'legacy',commit_sha:'b'.repeat(40),file_path:'legacy.spec.ts'});
  assert.equal(db.prepare('SELECT project_id FROM requirement_projects').get()!.project_id,'b');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();}
});
