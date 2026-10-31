import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdir, readFile, writeFile, symlink, rename } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { fixture, specRepository, git, toolkitRoot, commitAll } from './helpers.mjs';
import { createWorkstation } from '../../packages/workstation/service.mjs';
import { createStandaloneServer } from '../../packages/workstation/http.mjs';
import { validateLocation, remoteIdentity, repositoryPath } from '../../packages/workstation/locations.mjs';
import { exists } from '../../packages/contracts/index.mjs';
import { openStore } from '../../packages/workstation/store.mjs';

async function setup(t, {autoAcquire=true}={}) {
  const f=await fixture(t);const source=path.join(f.base,'source');await specRepository(source);
  await git.command(undefined,['init','--bare','--initial-branch','main',f.remote]);
  await git.command(source,['remote','add','origin',f.remote]);await git.push(source,{},await git.inspect(source));
  const options={home:f.home,toolkitRoot,allowLocal:true,autoAcquire};
  const service=await createWorkstation(options);t.after(()=>service.close());
  return {...f,source,options,service};
}
async function bind(f,localPath) {
  const r=f.service.register({id:'SPEC-local',title:'Local Spec',remoteUrl:f.remote,...(localPath?{localPath}:{})});
  const op=r.connection?.operationId?await f.service.wait(r.connection.operationId):null;
  return {r,op};
}
async function job(f,operation,input={}) {
  const operationId=`OP-${randomUUID()}`;f.service.enqueue({schemaVersion:1,operationId,repositoryId:'SPEC-local',operation,input});
  return f.service.wait(operationId);
}

test('explicit new directory is used for acquisition, SQL import and all subsequent reads',async t=>{
  const f=await setup(t),local=path.join(f.base,'我的專案 with spaces','bdd-spec');
  const {r,op}=await bind(f,local);assert.equal(r.localPath,local);assert.equal(op.status,'SUCCEEDED',JSON.stringify(op.error));
  assert.equal(await exists(path.join(local,'.git')),true);
  assert.equal(await exists(path.join(f.home,'repositories/SPEC-local/repo')),false,'Do not clone a second hidden copy');
  const d=await f.service.detail(r.id);assert.equal(d.localPath,local);assert.equal(d.connection.localPath,local);assert.equal(d.spec.features.length,1);
  assert.match((await f.service.readFile(r.id,'spec/REQ-001/login/login.sd.md')).content,/Fixture login/);
  const version=await f.service.versions(r.id,'main');assert.equal(version.spec.features.length,1);
  const db=new DatabaseSync(path.join(f.home,'metadata.sqlite'));assert.equal(db.prepare('SELECT local_path FROM spec_repositories').get().local_path,local);db.close();
  const store=openStore(f.home);assert.equal(await repositoryPath(f.home,r.id,store),local);store.close();
});
test('an existing empty selected directory can receive a clone',async t=>{
  const f=await setup(t),local=path.join(f.base,'empty');await mkdir(local);
  const {op}=await bind(f,local);assert.equal(op.status,'SUCCEEDED',JSON.stringify(op.error));assert.equal(await git.resolve(local),await git.resolve(f.source));
});
test('adopting an existing clone preserves its HEAD, staged files and uncommitted specification',async t=>{
  const f=await setup(t),local=path.join(f.base,'existing');await git.clone(f.remote,local);
  await writeFile(path.join(local,'staged.txt'),'keep staged');await git.command(local,['add','--','staged.txt']);
  await writeFile(path.join(local,'spec/REQ-001/login/login.sd.md'),'# My unsaved local design');
  const before=await git.inspect(local);const {op}=await bind(f,local);
  assert.equal(op.status,'SUCCEEDED',JSON.stringify(op.error));assert.deepEqual(await git.inspect(local),before);
  assert.equal((await f.service.readFile('SPEC-local','spec/REQ-001/login/login.sd.md')).content,'# My unsaved local design');
  assert.equal((await git.command(local,['show',':staged.txt'])).stdout,'keep staged');
});
test('a non-empty non-repository directory is rejected without registration or file loss',async t=>{
  const f=await setup(t),local=path.join(f.base,'important');await mkdir(local);await writeFile(path.join(local,'important.txt'),'preserve');
  assert.throws(()=>f.service.register({id:'SPEC-local',title:'Spec',remoteUrl:f.remote,localPath:local}),{code:'LOCAL_PATH_NOT_EMPTY'});
  assert.equal(f.service.list().length,0);assert.equal(await readFile(path.join(local,'important.txt'),'utf8'),'preserve');
});
test('a foreign clone is not adopted or imported and does not prevent SQLite saves',async t=>{
  const f=await setup(t),local=path.join(f.base,'foreign');await specRepository(local);
  await writeFile(path.join(local,'spec/REQ-001/login/login.sd.md'),'FOREIGN PRIVATE CONTENT');await commitAll(local);
  await git.command(local,['remote','add','origin',path.join(f.base,'other.git')]);const before=await git.inspect(local);
  const {op}=await bind(f,local);assert.equal(op.status,'FAILED');assert.equal(op.error.code,'BINDING_REMOTE_CHANGED');
  const d=await f.service.detail('SPEC-local');assert.equal(d.spec.features.length,0);assert.equal(JSON.stringify(d).includes('FOREIGN PRIVATE CONTENT'),false);
  assert.equal((await job(f,'repository.setup',{reviewer:'Human',projects:[]})).status,'SUCCEEDED');assert.deepEqual(await git.inspect(local),before);
});
test('changing an existing binding preserves old checkout and SQL drafts and uses the new path for export',async t=>{
  const f=await setup(t);const {r,op}=await bind(f);assert.equal(op.status,'SUCCEEDED');const previous=r.localPath;
  await job(f,'repository.setup',{reviewer:'Human',projects:[]});
  const relative='spec/REQ-001/login/login.sd.md',file=await f.service.readFile(r.id,relative);
  const saved=await job(f,'repository.save',{kind:'source',path:relative,content:'# Saved SQLite draft',expectedHash:file.sha256});assert.equal(saved.status,'SUCCEEDED',JSON.stringify(saved.error));
  const original=await git.inspect(previous),newPath=path.join(f.base,'relocated');
  const changed=await job(f,'repository.location',{localPath:newPath,expectedLocalPath:previous});assert.equal(changed.status,'SUCCEEDED',JSON.stringify(changed.error));
  assert.deepEqual(await git.inspect(previous),original);assert.equal((await f.service.detail(r.id)).localPath,newPath);
  assert.equal((await f.service.readFile(r.id,relative)).content,'# Saved SQLite draft');
  assert.equal((await job(f,'repository.prepare')).status,'SUCCEEDED');assert.equal(await readFile(path.join(newPath,relative),'utf8'),'# Saved SQLite draft');
  assert.notEqual(await readFile(path.join(previous,relative),'utf8'),'# Saved SQLite draft');
  assert.equal(await git.resolve(f.source), (await git.command(undefined,['--git-dir',f.remote,'rev-parse','main'])).stdout.trim(),'No implicit remote upload');
});
test('stale location settings do not replace a newer binding and mismatched clones retain the old location',async t=>{
  const f=await setup(t);const {r}=await bind(f);const local=path.join(f.base,'bad');await specRepository(local);await git.command(local,['remote','add','origin',path.join(f.base,'other.git')]);
  const stale=await job(f,'repository.location',{localPath:local,expectedLocalPath:'/wrong'});assert.equal(stale.error.code,'LOCAL_PATH_CHANGED');
  const bad=await job(f,'repository.location',{localPath:local,expectedLocalPath:r.localPath});assert.equal(bad.error.code,'BINDING_REMOTE_CHANGED');
  assert.equal((await f.service.detail(r.id)).localPath,r.localPath);
});
test('paths cannot overlap another binding, its submodules, application code or operational data',async t=>{
  const f=await setup(t,{autoAcquire:false}),local=path.join(f.base,'one');await bind(f,local);
  for(const name of [local,path.join(local,'projects/product'),f.base])assert.throws(()=>validateLocation(f.options,'SPEC-other',name,f.service.list()));
  for(const name of [toolkitRoot,path.join(toolkitRoot,'nested'),f.home,path.join(f.home,'executions'),os.homedir(),'/','/etc/new-spec'])assert.throws(()=>validateLocation(f.options,'SPEC-other',name));
});
test('symlink targets and relative/traversal paths are rejected; tilde is expanded on the server',async t=>{
  const f=await setup(t,{autoAcquire:false}),target=path.join(f.base,'target'),link=path.join(f.base,'shortcut');await mkdir(target);await symlink(target,link);
  assert.throws(()=>validateLocation(f.options,'SPEC-one',link),{code:'LOCAL_PATH_SYMLINK'});
  for(const name of ['relative/spec','/tmp/../escape','/tmp/.git/content','\0oops',{},[]])assert.throws(()=>validateLocation(f.options,'SPEC-one',name));
  const value=validateLocation(f.options,'SPEC-one','~/bdd-local-test-'+randomUUID());assert.ok(value.startsWith(os.homedir()+path.sep));
});
test('an unavailable checkout cannot invalidate saved SQLite content after a directory was bound',async t=>{
  const f=await setup(t),local=path.join(f.base,'local');await bind(f,local);await job(f,'repository.setup',{reviewer:'Human',projects:[]});
  const file=await f.service.readFile('SPEC-local','spec/REQ-001/login/login.sd.md');await rename(local,local+'-unmounted');
  const saved=await job(f,'repository.save',{kind:'source',path:file.path,content:'# Offline save',expectedHash:file.sha256});assert.equal(saved.status,'SUCCEEDED');
  assert.equal((await f.service.readFile('SPEC-local',file.path)).content,'# Offline save');
});
test('an existing clone remains readable when its remote is temporarily unreachable',async t=>{
  const f=await setup(t),local=path.join(f.base,'local');await git.clone(f.remote,local);await rename(f.remote,f.remote+'-offline');
  const {op}=await bind(f,local);assert.equal(op.status,'SUCCEEDED',JSON.stringify(op.error));
  const d=await f.service.detail('SPEC-local');assert.equal(d.spec.features.length,1);assert.ok(d.connection.warnings.some(x=>x.code==='REMOTE_UNAVAILABLE'));
});
test('v7 path migration creates a backup and preserves exact managed locations',async t=>{
  const f=await setup(t);const {r}=await bind(f);const d=await f.service.detail(r.id);
  const db=new DatabaseSync(path.join(f.home,'metadata.sqlite'));db.exec('DROP INDEX unique_repository_local_path; ALTER TABLE spec_repositories DROP COLUMN local_path; PRAGMA user_version=7;');db.close();
  const store=openStore(f.home);assert.equal(await repositoryPath(f.home,r.id,store),r.localPath);assert.equal(store.draft(r.id).revision,d.authoring.revision);store.close();
  assert.equal(await exists(path.join(f.home,'before-local-directories-v8.sqlite')),true);
});
test('equivalent GitHub HTTPS, SSH and .git URLs have one repository identity',()=>{
  assert.equal(remoteIdentity('https://github.com/Xing00000/bdd-spec'),remoteIdentity('git@github.com:Xing00000/bdd-spec.git'));
  assert.equal(remoteIdentity('https://github.com/Xing00000/bdd-spec/'),remoteIdentity('https://github.com/Xing00000/bdd-spec.git'));
});
test('real HTTP registration accepts and returns the requested host-side local directory',async t=>{
  const f=await fixture(t),source=path.join(f.base,'source');await specRepository(source);
  const app=await createStandaloneServer({home:f.home,toolkitRoot,allowLocal:true});t.after(()=>app.close());await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const localPath=path.join(f.base,'selected'),url=`http://127.0.0.1:${app.server.address().port}/repository-api/v1/spec-repositories`;
  const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-workbench-request':'1'},body:JSON.stringify({title:'UI location',remoteUrl:source,localPath})});
  assert.equal(response.status,201);const r=await response.json();assert.equal(r.localPath,localPath);assert.equal((await app.service.wait(r.connection.operationId)).status,'SUCCEEDED');
  assert.equal((await (await fetch(url+'/'+r.id)).json()).localPath,localPath);
});
