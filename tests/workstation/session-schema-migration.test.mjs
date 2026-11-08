import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {SessionManager} from '../../packages/workstation/session-management/core.mjs';
import {migrateExecutionSchema} from '../../packages/workstation/session-management/migrations.mjs';
import {fixture} from './session-management-fixture.mjs';

// Historical physical v1 schema, not an expected-output snapshot.
function legacyDatabase(file){
  const db=new DatabaseSync(file);
  db.exec(readFileSync(new URL('../../packages/workstation/session-management/schema.sql',import.meta.url),'utf8'));
  db.exec(`PRAGMA user_version=39;
    INSERT INTO sm_migrations VALUES(1,'historical');
    INSERT INTO sm_workstations VALUES('local',8);
    INSERT INTO sm_projects VALUES('local','p','Project');
    INSERT INTO sm_repositories VALUES('local','r','Repo','/fixture','');
    INSERT INTO sm_project_repositories VALUES('local','p','r');
    INSERT INTO sm_catalog VALUES('local','profile','profile',1,'{}','digest','historical');
    INSERT INTO sm_tasks VALUES('local','task','p','r','Task',1,'ACTIVE',1,'historical');
    INSERT INTO sm_nodes VALUES('node','task','analysis','bot','{"profile":{"id":"profile","revision":1}}','RUNNING',1);
    INSERT INTO sm_bot_task_sessions VALUES('session','local','bot','task',1,'node',NULL);
    INSERT INTO sm_rooms VALUES('room','task',2);
    INSERT INTO sm_events VALUES('event','room',1,'human','local','message.queued','room','{}','historical');
    INSERT INTO sm_native_sessions VALUES('native','local','session',1,'codex-sdk','thread','historical');
    UPDATE sm_bot_task_sessions SET native_session_id='native';
    INSERT INTO sm_workers VALUES('worker','node','task','coding-acp','STOPPED',1,'external',1,'historical');
    INSERT INTO sm_results VALUES('result','node','task',1,'{}','{}','digest','{}',NULL,'historical');
    INSERT INTO sm_soul_memory VALUES('local','soul','memory');
    INSERT INTO sm_summaries VALUES('summary','local','memory','p','fact','Remember','["event"]','historical');
    CREATE TABLE sm_execution_turns(id TEXT PRIMARY KEY,task_id TEXT,node_id TEXT,logical_session_id TEXT,generation INTEGER,input_revision INTEGER,source_highwater INTEGER,attempt INTEGER,state TEXT,disposition TEXT,native_id TEXT,error TEXT,created_at TEXT,finished_at TEXT);
    CREATE UNIQUE INDEX sm_one_live_execution ON sm_execution_turns(task_id) WHERE state IN ('RUNNING','UNKNOWN');
    INSERT INTO sm_execution_turns VALUES('turn','task','node','session',1,1,1,1,'WAITING','{"kind":"YIELD","reason":"human"}',NULL,NULL,'historical','historical');
    CREATE TABLE sm_execution_deliveries(event_id TEXT,logical_session_id TEXT,turn_id TEXT REFERENCES sm_execution_turns(id),state TEXT,PRIMARY KEY(event_id,logical_session_id));
    INSERT INTO sm_execution_deliveries VALUES('event','session','turn','PROCESSED');
    CREATE TABLE sm_execution_wakes(task_id TEXT PRIMARY KEY,requested_at TEXT);
    INSERT INTO sm_execution_wakes VALUES('task','historical');
    CREATE TABLE sm_verification_evidence(id TEXT PRIMARY KEY,task_id TEXT,task_version INTEGER,task_revision INTEGER,source_digest TEXT,results_digest TEXT,profile_id TEXT,profile_digest TEXT,total INTEGER,passed INTEGER,failed INTEGER,skipped INTEGER,receipt TEXT,created_at TEXT);
    INSERT INTO sm_verification_evidence VALUES('evidence','task',1,1,'source','results','suite','suite-digest',1,1,0,0,'{}','historical');
    CREATE TABLE sm_acceptance_checkpoints(task_id TEXT PRIMARY KEY,verification_id TEXT REFERENCES sm_verification_evidence(id),expected_version INTEGER,state TEXT,commit_sha TEXT,error TEXT,created_at TEXT);
    INSERT INTO sm_acceptance_checkpoints VALUES('task','evidence',1,'UNKNOWN',NULL,'needs reconciliation','historical');`);
  return db;
}

test('v1 dynamic tables migrate without losing receipts, waits or the application schema version',t=>{
  const directory=mkdtempSync(path.join(tmpdir(),'bdd-schema-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'metadata.sqlite');legacyDatabase(file).close();
  const manager=new SessionManager(file);t.after(()=>manager.close());
  assert.equal(manager.one('SELECT MAX(version) version FROM sm_migrations').version,3);
  assert.equal(manager.one('PRAGMA user_version').user_version,39);
  assert.equal(manager.one('PRAGMA foreign_keys').foreign_keys,1);
  assert.equal(manager.one('SELECT room_seq FROM sm_execution_turns').room_seq,1);
  assert.equal(manager.one('SELECT input_context FROM sm_execution_turns').input_context,null);
  assert.equal(manager.one('SELECT state FROM sm_execution_messages').state,'PROCESSED');
  assert.equal(manager.one('SELECT state FROM sm_execution_waits').state,'WAITING');
  assert.equal(manager.one('SELECT state FROM sm_execution_acceptances').state,'UNKNOWN');
  assert.equal(manager.one("SELECT type FROM sqlite_master WHERE name='sm_acceptance_checkpoints'").type,'view');
  assert.equal(manager.one('SELECT task_id FROM sm_worker_scope').task_id,'task');
  assert.equal(manager.one('SELECT task_id FROM sm_result_scope').task_id,'task');
  assert.equal(manager.one('SELECT source_events FROM sm_summary_scope').source_events,'["event"]');
  assert.equal(manager.one('SELECT workstation_id FROM sm_native_session_scope').workstation_id,'local');
  for(const [table,column] of [['sm_workers','task_id'],['sm_results','task_id'],['sm_bot_task_sessions','workstation_id'],['sm_native_sessions','workstation_id'],['sm_summaries','source_events']]){
    assert.equal(manager.all(`PRAGMA table_info(${table})`).some(field=>field.name===column),false);
  }
  assert.deepEqual(manager.all('PRAGMA foreign_key_check'),[]);
  const reopened=new SessionManager(file);reopened.close();
});

test('an existing v2 database receives the core normalization migration once',t=>{
  const directory=mkdtempSync(path.join(tmpdir(),'bdd-schema-v2-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'metadata.sqlite'),old=legacyDatabase(file);
  old.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
  migrateExecutionSchema(old);
  old.exec("INSERT INTO sm_migrations VALUES(2,'historical'); COMMIT");old.close();
  const manager=new SessionManager(file);t.after(()=>manager.close());
  assert.equal(manager.one('SELECT COUNT(*) n FROM sm_migrations').n,3);
  assert.equal(manager.one('SELECT summary FROM sm_summaries').summary,'Remember');
  assert.equal(manager.one('SELECT event_id FROM sm_summary_sources').event_id,'event');
  const second=new SessionManager(file);second.close();
  assert.equal(manager.one('SELECT COUNT(*) n FROM sm_summary_sources').n,1);
});

test('normalization preserves repeated summary sources and their original order',t=>{
  const directory=mkdtempSync(path.join(tmpdir(),'bdd-schema-sources-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'metadata.sqlite'),old=legacyDatabase(file);
  old.prepare('UPDATE sm_summaries SET source_events=?').run('["event","event"]');old.close();
  const manager=new SessionManager(file);t.after(()=>manager.close());
  assert.equal(manager.one('SELECT source_events FROM sm_summary_scope').source_events,'["event","event"]');
  assert.deepEqual(manager.all('SELECT ordinal,event_id FROM sm_summary_sources ORDER BY ordinal').map(row=>({...row})),[{ordinal:0,event_id:'event'},{ordinal:1,event_id:'event'}]);
  assert.deepEqual(manager.all('PRAGMA foreign_key_check'),[]);
});

test('invalid legacy ownership aborts the entire migration and retains v1 rows',t=>{
  const directory=mkdtempSync(path.join(tmpdir(),'bdd-schema-invalid-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'metadata.sqlite'),old=legacyDatabase(file);
  old.exec("UPDATE sm_execution_turns SET task_id='other-task'");old.close();
  assert.throws(()=>new SessionManager(file),/task\/node mismatch/);
  const db=new DatabaseSync(file);t.after(()=>db.close());
  assert.equal(db.prepare('SELECT MAX(version) version FROM sm_migrations').get().version,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sm_execution_turns').get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='sm_execution_messages'").get().n,0);
});

test('execution schema rejects cross-task relationships and repeated worker operation keys',t=>{
  const f=fixture();t.after(()=>f.close());f.create();f.create('task-b');f.ready();f.ready('task-b');
  const a=f.start(),b=f.start('task-b');
  const insert=(id,node,session)=>f.m.exec("INSERT INTO sm_execution_turns(id,node_id,logical_session_id,generation,input_revision,room_seq,attempt,state,created_at) VALUES(?,?,?,1,1,0,1,'RUNNING','now')",id,node,session);
  assert.throws(()=>insert('wrong',a.node.id,b.session.id),/scope mismatch/);
  insert('turn',a.node.id,a.session.id);
  const message=f.m.command('room.message',{taskId:'task-b',target:'room',text:'Other task'});
  assert.throws(()=>f.m.exec("INSERT INTO sm_execution_messages VALUES(?,?,'QUEUED')",message.messageId,'turn'),/scope mismatch/);
  const op=()=>f.m.exec("INSERT INTO sm_execution_worker_ops(id,node_id,request_key,digest,operation,state,request,created_at) VALUES(?,?,'same-key','digest','START','PENDING','{}','now')",crypto.randomUUID(),a.node.id);
  op();assert.throws(op,/UNIQUE constraint failed/);
  assert.equal(f.m.all('SELECT * FROM sm_execution_profiles WHERE task_id=?','task-a').length,1);
});
