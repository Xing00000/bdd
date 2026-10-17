import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,readFile,writeFile,rm,appendFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {metadataMigrations,applyMetadataMigrations} from '../../src/adapters/sqlite/migrations.ts';

test('canonical metadata migrations preserve existing records, reject unknown versions and roll back failures',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    applyMetadataMigrations(db);
    const version=Number(db.prepare('PRAGMA user_version').get()!.user_version);
    assert.equal(version,metadataMigrations.at(-1)!.toVersion);
    db.prepare('INSERT INTO projects(id,name,workspace_ref) VALUES(?,?,?)').run('migration-project','preserved','workspace');
    applyMetadataMigrations(db);
    assert.equal(db.prepare('SELECT name FROM projects WHERE id=?').get('migration-project')!.name,'preserved');
    db.exec(`PRAGMA user_version=${version+1}`);
    assert.throws(()=>applyMetadataMigrations(db),/Unsupported metadata schema version/);
  }finally{db.close();}
  const invalid=new DatabaseSync(':memory:');
  try{
    invalid.exec('CREATE TABLE projects(existing TEXT)');
    assert.throws(()=>applyMetadataMigrations(invalid),/already exists/);
    assert.equal(Number(invalid.prepare('PRAGMA user_version').get()!.user_version),0);
    assert.equal(invalid.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='requirements'").get()!.n,0);
  }finally{invalid.close();}
});

test('generated deploy bundle migrates real SQLite, preserves data, backs up and rejects corrupt SQL before opening a DB',async t=>{
  const root=resolve(process.cwd());
  const generated=spawnSync(process.execPath,['tools/deploy.mjs'],{cwd:root,encoding:'utf8'});
  assert.equal(generated.status,0,generated.stdout+generated.stderr);
  const directory=await mkdtemp(join(tmpdir(),'bdd-deploy-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const bundle=join(directory,'deploy');await cp(join(root,'deploy'),bundle,{recursive:true});
  const execute=(database:string,backup?:string)=>spawnSync(process.execPath,[join(bundle,'migrate.mjs'),database,...(backup?['--backup',backup]:[])],{encoding:'utf8'});
  const database=join(directory,'metadata.sqlite');
  const migrated=execute(database);assert.equal(migrated.status,0,migrated.stdout+migrated.stderr);
  assert.equal(JSON.parse(migrated.stdout).version,metadataMigrations.at(-1)!.toVersion);
  const repeated=execute(database);assert.equal(repeated.status,0,repeated.stderr);assert.deepEqual(JSON.parse(repeated.stdout).applied,[]);
  const legacy=join(directory,'legacy.sqlite'),backup=join(directory,'before.sqlite');
  const db=new DatabaseSync(legacy);db.exec("CREATE TABLE existing_records(content TEXT); INSERT INTO existing_records VALUES('original');");db.close();
  assert.notEqual(execute(legacy).status,0,'An existing database requires a backup before applying pending migrations');
  const upgraded=execute(legacy,backup);assert.equal(upgraded.status,0,upgraded.stdout+upgraded.stderr);
  for(const file of [legacy,backup]){
    const check=new DatabaseSync(file);try{assert.equal(check.prepare('SELECT content FROM existing_records').get()!.content,'original');}finally{check.close();}
  }
  const backedUp=new DatabaseSync(backup);try{assert.equal(Number(backedUp.prepare('PRAGMA user_version').get()!.user_version),0);}finally{backedUp.close();}
  const manifest=JSON.parse(await readFile(join(bundle,'manifest.json'),'utf8'));
  await appendFile(join(bundle,manifest.migrations[0].ddl.path),'\n-- corruption\n');
  const rejected=join(directory,'must-not-exist.sqlite');
  const invalid=execute(rejected);assert.notEqual(invalid.status,0);assert.match(invalid.stderr,/hash mismatch/);assert.equal(existsSync(rejected),false);
  await writeFile(join(bundle,'manifest.json'),JSON.stringify({...manifest,targetVersion:manifest.targetVersion+1}));
  assert.notEqual(execute(rejected).status,0);
});
