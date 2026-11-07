import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {SessionManager} from '../../packages/workstation/session-management/core.mjs';
import {checkSchema,validateOutput} from '../../packages/workstation/session-management/contracts.mjs';
import {provisionTaskWorktree} from '../../packages/workstation/session-management/worktree.mjs';
import {fixture,system,resultSchema} from './session-management-fixture.mjs';
const code=expected=>error=>error.code===expected;
function setup(t,options){const f=fixture(options);t.after(()=>f.close());return f;}

test('SM-001: multiple projects/repos, exactly one workflow/room/worktree per task',t=>{
  const f=setup(t);f.m.command('repository.link',{projectId:'project-a',repositoryId:'repo-b'});const d=f.create();
  assert.equal(d.nodes.length,2);assert.equal(d.worktree.state,'PENDING');assert.equal(d.task.state,'PROVISIONING');
  for(const table of ['sm_workflows','sm_rooms','sm_worktrees'])assert.equal(f.m.one(`SELECT count(*) n FROM ${table} WHERE task_id=?`,d.task.id).n,1);
  assert.throws(()=>f.create(),/UNIQUE/);assert.equal(f.m.snapshot().tasks.length,1);
});
test('SM-001: rejects repository outside project without partial task',t=>{const f=setup(t);assert.throws(()=>f.create('task-b','project-a','repo-b'),code('REPOSITORY_SCOPE'));assert.equal(f.m.snapshot().tasks.length,0);});
test('SM-002: fixed output activates SD in the same room only after human approval',t=>{
  const f=setup(t,{approval:true});f.create();f.ready();const before=f.m.detail('task-a'),run=f.start();const candidate=f.submit(run);
  assert.deepEqual(f.m.detail('task-a').participants,['sa']);assert.equal(f.m.node(run.node.id).state,'WAITING_HUMAN');
  assert.throws(()=>f.m.command('node.approve',{nodeId:run.node.id,expectedVersion:f.m.node(run.node.id).version,candidateDigest:'wrong'}),code('STALE_APPROVAL'));
  f.m.command('node.approve',{nodeId:run.node.id,expectedVersion:f.m.node(run.node.id).version,candidateDigest:candidate.candidateDigest});
  const after=f.m.detail('task-a');assert.equal(after.room.id,before.room.id);assert.deepEqual(after.participants,['sd']);
  const sd=f.start('task-a','design');assert.equal(f.m.context(sd.node.id).dependencies[0].data.summary,'Analysed');
});
test('SM-003: Bot task session map is isolated and survives a new DB connection',t=>{
  const f=setup(t);f.create();f.create('task-b');f.ready();f.ready('task-b');const a=f.start(),b=f.start('task-b');
  assert.notEqual(a.session.id,b.session.id);assert.notEqual(a.session.native_session_id,b.session.native_session_id);
  const reopened=new SessionManager(f.file,f.options);t.after(()=>reopened.close());assert.equal(reopened.detail('task-a').sessions.find(s=>s.bot_id==='sa').id,a.session.id);
});
test('SM-003: a native thread cannot be attached across tasks',t=>{
  const f=setup(t);f.create();f.create('task-b');f.ready();f.ready('task-b');f.start();const b=f.start('task-b');
  assert.throws(()=>f.m.command('runtime.attach',{sessionId:b.session.id,expectedGeneration:b.session.generation,adapter:'codex-sdk',nativeId:'fixture-task-a-analysis-0'},{actor:system}),/UNIQUE/);
  assert.equal(f.m.session(b.session.id).generation,b.session.generation);
});
test('SM-004: scoped summary only; no automatic transcript copied to memory',t=>{
  const f=setup(t);f.create();f.create('task-b','project-b','repo-b');f.ready();f.ready('task-b');
  const a=f.m.command('room.message',{taskId:'task-a',target:'bot:sa',text:'Use cookies. Secret A.'}),b=f.m.command('room.message',{taskId:'task-b',target:'bot:sa',text:'Different project. Secret B.'});
  assert.equal(f.m.memory('sa-soul','project-a').entries.length,0);
  for(const [projectId,event,summary] of [['project-a',a,'Use cookies.'],['project-b',b,'Use server sessions.']])f.m.command('memory.summarize',{soulId:'sa-soul',projectId,category:'DECISION',summary,sourceEventIds:[event.messageId]});
  assert.deepEqual(f.m.memory('sa-soul','project-a').entries.map(e=>e.summary),['Use cookies.']);assert.ok(!JSON.stringify(f.m.memory('sa-soul','project-a')).includes('Secret B'));
});
test('SM-004: rejects cross-project memory sources and model-created shared memory',t=>{
  const f=setup(t);f.create();f.ready();const run=f.start(),event=f.m.command('room.message',{taskId:'task-a',target:'room',text:'Decision'});
  const input={soulId:'sa-soul',projectId:'project-b',category:'DECISION',summary:'Summary',sourceEventIds:[event.messageId]};
  assert.throws(()=>f.m.command('memory.summarize',input),code('MEMORY_SCOPE'));
  assert.throws(()=>f.m.command('memory.summarize',{...input,projectId:'project-a',shareAcrossProjects:true},{actor:run.actor}),code('HUMAN_REQUIRED'));
});
test('SM-004: explicit human promotion shares only the summary',t=>{
  const f=setup(t);f.create();f.ready();const e=f.m.command('room.message',{taskId:'task-a',target:'room',text:'Prefer concise answers, plus private text'});
  f.m.command('memory.summarize',{soulId:'sa-soul',projectId:'project-a',category:'PREFERENCE',summary:'Prefer concise answers.',sourceEventIds:[e.messageId],shareAcrossProjects:true});
  assert.equal(f.m.memory('sa-soul','project-b').entries[0].summary,'Prefer concise answers.');
});
test('SM-005: replacing native session fences old generation and preserves logical ID/cursor',t=>{
  const f=setup(t);f.create();f.ready();const run=f.start(),s=run.session;
  f.m.command('session.cursor',{sessionId:s.id,generation:s.generation,source:'room',seq:1},{actor:run.actor});
  const newer=f.m.command('runtime.attach',{sessionId:s.id,expectedGeneration:s.generation,adapter:'codex-sdk',nativeId:'new-thread'},{actor:system});
  assert.equal(newer.id,s.id);assert.equal(newer.generation,s.generation+1);
  assert.throws(()=>f.submit(run),code('STALE_GENERATION'));
  assert.throws(()=>f.m.command('session.cursor',{sessionId:s.id,generation:s.generation,source:'room',seq:2},{actor:run.actor}),code('STALE_GENERATION'));
  assert.equal(f.m.context(run.node.id).cursors[0].seq,1);
});
test('SM-006: messages are idempotent, ordered, and never claim processed',t=>{
  const f=setup(t);f.create();f.ready();const input={taskId:'task-a',target:'bot:sa',text:'Use cookie'},options={requestId:'message-1'};
  const a=f.m.command('room.message',input,options),b=f.m.command('room.message',input,options);assert.deepEqual(a,b);assert.equal(a.delivery,'QUEUED');
  assert.throws(()=>f.m.command('room.message',{...input,text:'changed'},options),code('IDEMPOTENCY_CONFLICT'));
  assert.throws(()=>f.m.command('room.message',{...input,target:'bot:sd'}),code('BOT_NOT_PARTICIPATING'));
  assert.throws(()=>f.m.command('room.message',{...input,actor:'system'}),code('UNKNOWN_FIELD'));
  const events=f.m.events('task-a').events;assert.deepEqual(events.map(e=>e.seq),events.map((_,i)=>i+1));assert.equal(events.filter(e=>e.type==='message.queued').length,1);
});
test('SM-007: persistent reservations across connections enforce concurrency and total budgets',t=>{
  const f=setup(t);f.create();f.ready();const run=f.start(),input={nodeId:run.node.id,profile:'coding-acp',writeAccess:true};
  const first=f.m.command('worker.reserve',input,{actor:run.actor});const second=new SessionManager(f.file,f.options);t.after(()=>second.close());
  assert.throws(()=>second.command('worker.reserve',input,{actor:run.actor}),code('CLI_CONCURRENCY_LIMIT'));
  f.m.command('worker.receipt',{workerId:first.id,state:'UNKNOWN',confirmed:false},{actor:system});
  assert.throws(()=>second.command('worker.reserve',input,{actor:run.actor}),code('CLI_CONCURRENCY_LIMIT'));
  assert.throws(()=>f.m.command('worker.receipt',{workerId:first.id,state:'STOPPED',confirmed:false},{actor:system}),code('STOP_NOT_CONFIRMED'));
  f.m.command('worker.receipt',{workerId:first.id,state:'STOPPED',confirmed:true},{actor:system});
  const last=second.command('worker.reserve',input,{actor:run.actor});second.command('worker.receipt',{workerId:last.id,state:'FAILED',confirmed:true},{actor:system});
  assert.throws(()=>f.m.command('worker.reserve',input,{actor:run.actor}),code('CLI_TOTAL_LIMIT'));
});
test('SM-007: workstation-wide quota includes other tasks',t=>{
  const f=setup(t,{maxWorkers:1});f.create();f.create('task-b');f.ready();f.ready('task-b');const a=f.start(),b=f.start('task-b');
  f.m.command('worker.reserve',{nodeId:a.node.id,profile:'coding-acp',writeAccess:false},{actor:a.actor});
  assert.throws(()=>f.m.command('worker.reserve',{nodeId:b.node.id,profile:'coding-acp',writeAccess:false},{actor:b.actor}),code('WORKSTATION_CLI_LIMIT'));
});
test('SM-007: untrusted callers cannot release reservations',t=>{
  const f=setup(t);f.create();f.ready();const r=f.start(),w=f.m.command('worker.reserve',{nodeId:r.node.id,profile:'coding-acp',writeAccess:false},{actor:r.actor});
  assert.throws(()=>f.m.command('worker.receipt',{workerId:w.id,state:'STOPPED',confirmed:true}),code('CONTROLLER_REQUIRED'));
});
test('SM-007: worker turn limit and separate source cursors',t=>{
  const f=setup(t);f.create();f.ready();const r=f.start(),w=f.m.command('worker.reserve',{nodeId:r.node.id,profile:'coding-acp',writeAccess:false},{actor:r.actor});
  f.m.command('worker.receipt',{workerId:w.id,state:'RUNNING',externalId:'actual-supervisor-id',confirmed:true},{actor:system});
  for(let i=1;i<=3;i++)assert.equal(f.m.command('worker.turn',{workerId:w.id},{actor:system}).turn,i);
  assert.throws(()=>f.m.command('worker.turn',{workerId:w.id},{actor:system}),code('CLI_TURN_LIMIT'));
  f.m.command('worker.event',{workerId:w.id,seq:1,payload:{text:'output'}},{actor:system});
  f.m.command('session.cursor',{sessionId:r.session.id,generation:r.session.generation,source:`worker:${w.id}`,seq:1},{actor:r.actor});
  assert.throws(()=>f.m.command('session.cursor',{sessionId:r.session.id,generation:r.session.generation,source:`worker:${w.id}`,seq:2},{actor:r.actor}),code('CURSOR_OUT_OF_RANGE'));
});
test('SM-008: invalid, stale and extra output fields do not publish',t=>{
  const f=setup(t);f.create();f.ready();const r=f.start();
  for(const data of [{summary:'x'},{summary:'x',accepted:'true'},{summary:'x',accepted:true,validation:'PASSED'}])assert.throws(()=>f.submit(r,data),code('OUTPUT_CONTRACT_VIOLATION'));
  assert.throws(()=>f.m.command('node.submit',{nodeId:r.node.id,expectedVersion:r.node.version,inputRevision:0,generation:r.session.generation,data:{summary:'x',accepted:true}},{actor:r.actor}),code('STALE_INPUT'));
  assert.equal(f.m.detail('task-a').results.length,0);assert.equal(f.m.node(r.node.id).state,'RUNNING');
});
test('SM-008: result publication is immutable and activates a typed dependency',t=>{
  const f=setup(t);f.create();f.ready();const r=f.start(),result=f.submit(r);
  assert.ok(result.resultId);assert.throws(()=>f.submit(r),code('STALE_GENERATION'));
  assert.throws(()=>f.m.exec("UPDATE sm_results SET data='{}' WHERE id=?",result.resultId),/immutable/);
  assert.throws(()=>f.m.exec('DELETE FROM sm_results WHERE id=?',result.resultId),/immutable/);
  const sd=f.start('task-a','design');assert.equal(f.m.context(sd.node.id).dependencies[0].id,result.resultId);
});
test('SM-008: active Worker blocks final output',t=>{
  const f=setup(t);f.create();f.ready();const r=f.start();f.m.command('worker.reserve',{nodeId:r.node.id,profile:'coding-acp',writeAccess:true},{actor:r.actor});assert.throws(()=>f.submit(r),code('WORKER_STILL_ACTIVE'));
});
test('SM-008: schema-valid failure verdict is data, not fabricated acceptance',t=>{
  const f=setup(t);f.create();f.ready();const r=f.start();f.submit(r,{summary:'Business check failed',accepted:false});
  assert.equal(f.m.detail('task-a').results[0].data.accepted,false);assert.notEqual(f.m.task('task-a').state,'COMPLETED');
});
test('SM-009: cancellation persists, keeps resources pending and rejects late output',t=>{
  const f=setup(t);f.create();f.ready();const r=f.start(),w=f.m.command('worker.reserve',{nodeId:r.node.id,profile:'coding-acp',writeAccess:true},{actor:r.actor});
  f.m.command('task.cancel',{taskId:'task-a',expectedVersion:f.m.task('task-a').version});
  assert.throws(()=>f.submit(r),code('TASK_NOT_ACTIVE'));
  const reopened=new SessionManager(f.file,f.options);t.after(()=>reopened.close());const detail=reopened.detail('task-a');
  assert.equal(detail.task.state,'CANCELLED');assert.equal(detail.worktree.state,'CLEANUP_PENDING');assert.equal(reopened.worker(w.id).state,'RESERVED');assert.equal(detail.sessions.find(s=>s.bot_id==='sa').id,r.session.id);
});
test('SM-010: secretary portfolio contains progress but not conversations or memory',t=>{
  const f=setup(t);f.create();f.create('task-b','project-b','repo-b');f.ready();f.m.command('room.message',{taskId:'task-a',target:'room',text:'private-transcript'});
  const result=f.m.portfolio();assert.equal(result.projects.length,2);assert.equal(result.projects[0].tasks[0].nodes.length,2);assert.ok(!JSON.stringify(result).includes('private-transcript'));
});
test('catalog revisions are immutable and task definitions remain frozen',t=>{
  const f=setup(t);f.create();const old=f.m.catalog('soul',{id:'sa-soul',revision:1});
  f.save('soul','sa-soul',{...old.body,thinkingStyle:'Changed later'},1);
  assert.equal(f.m.detail('task-a').nodes[0].config.soul.body.thinkingStyle,old.body.thinkingStyle);
  assert.throws(()=>f.save('soul','sa-soul',old.body,1),code('REVISION_CONFLICT'));
  assert.throws(()=>f.m.exec("UPDATE sm_catalog SET body='{}'"),/immutable/);
});
test('Soul memory identity remains stable across revisions',t=>{const f=setup(t);const before=f.m.memory('sa-soul','project-a').id,old=f.m.catalog('soul',{id:'sa-soul',revision:1});f.save('soul','sa-soul',{...old.body,name:'Renamed'},1);assert.equal(f.m.memory('sa-soul','project-a').id,before);});
test('workflow rejects cycles and unknown dependency keys',t=>{
  const f=setup(t),old=f.m.catalog('workflow',{id:'sa-sd',revision:1}).body;
  for(const key of ['design','missing'])assert.throws(()=>f.save('workflow','bad',{...old,nodes:old.nodes.map((n,i)=>i? n:{...n,dependsOn:[key]})}),code('WORKFLOW_CYCLE'));
});
test('cross-workstation data access is denied even with a known ID',t=>{
  const f=setup(t);f.create();const other=new SessionManager(f.file,{...f.options,workstationId:'other'});t.after(()=>other.close());
  assert.throws(()=>other.detail('task-a'),code('TASK_NOT_FOUND'));assert.equal(other.portfolio().projects.length,0);assert.throws(()=>other.catalog('bot',{id:'sa',revision:1}),code('CATALOG_NOT_FOUND'));
});
test('schema registration rejects unsupported keywords instead of pretending to validate',()=>{
  for(const extra of [{$ref:'https://external.invalid/schema'},{patternProperties:{}},{anyOf:[]}])assert.throws(()=>checkSchema({...resultSchema,...extra}),code('UNKNOWN_FIELD'));
  assert.throws(()=>checkSchema({type:'object',properties:{},required:[],additionalProperties:true}),code('INVALID_SCHEMA'));
});
test('schema verifier enforces nesting, arrays, enums, const and numeric bounds',()=>{
  const schema=checkSchema({type:'array',minItems:1,maxItems:2,items:{type:'integer',minimum:1,maximum:3,enum:[1,2],const:2}});
  assert.deepEqual(validateOutput(schema,[2]),[2]);for(const value of [[],[1],[3],[2,2,2],['2']])assert.throws(()=>validateOutput(schema,value),code('OUTPUT_CONTRACT_VIOLATION'));
});
test('failed commands roll back all writes and permit a corrected retry',t=>{
  const f=setup(t);assert.throws(()=>f.m.command('task.create',{id:'bad',projectId:'project-a',repositoryId:'repo-b',title:'bad',workflow:{id:'sa-sd',revision:1}},{requestId:'retry'}));
  assert.equal(f.m.one("SELECT count(*) n FROM sm_commands WHERE request_id='retry'").n,0);
  const d=f.m.command('task.create',{id:'bad',projectId:'project-a',repositoryId:'repo-a',title:'valid',workflow:{id:'sa-sd',revision:1}},{requestId:'retry'});assert.equal(d.task.id,'bad');
});
test('additive migration preserves pre-existing application tables and user_version',t=>{
  const f=setup(t);f.m.exec('CREATE TABLE legacy_records(id TEXT PRIMARY KEY,value TEXT)');f.m.exec("INSERT INTO legacy_records VALUES('saved','keep')");f.m.db.exec('PRAGMA user_version=39');
  const reopened=new SessionManager(f.file,f.options);t.after(()=>reopened.close());assert.equal(reopened.one('SELECT value FROM legacy_records').value,'keep');assert.equal(reopened.one('PRAGMA user_version').user_version,39);
});
test('real Git worktree provisioning, replay without more Git, cancellation retains worktree',async t=>{
  const f=setup(t),repo=join(f.home,'repo');
  const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init');git('config','user.name','Integration Test');git('config','user.email','test@example.invalid');writeFileSync(join(repo,'source.txt'),'source');git('add','source.txt');git('commit','-m','fixture');
  f.create();const result=await provisionTaskWorktree(f.m,'task-a');assert.equal(result.task.state,'ACTIVE');assert.equal(result.worktree.state,'READY');assert.equal(result.worktree.base_sha,git('rev-parse','HEAD'));assert.ok(git('worktree','list','--porcelain').includes(result.worktree.path));
  const replay=await provisionTaskWorktree(f.m,'task-a');assert.equal(replay.room.id,result.room.id);
  f.m.command('task.cancel',{taskId:'task-a',expectedVersion:f.m.task('task-a').version});assert.ok(git('worktree','list','--porcelain').includes(result.worktree.path));
});
test('non-repository provisioning fails explicitly without making task ACTIVE',async t=>{
  const f=setup(t);f.create();await assert.rejects(()=>provisionTaskWorktree(f.m,'task-a'));assert.equal(f.m.task('task-a').state,'PROVISIONING');assert.equal(f.m.detail('task-a').worktree.state,'ERROR');
});
test('stale Bot capabilities cannot reserve Workers or send messages',t=>{
  const f=setup(t);f.create();f.ready();const r=f.start();f.m.command('runtime.attach',{sessionId:r.session.id,expectedGeneration:r.session.generation,adapter:'codex-sdk',nativeId:'new-generation'},{actor:system});
  assert.throws(()=>f.m.command('worker.reserve',{nodeId:r.node.id,profile:'coding-acp',writeAccess:false},{actor:r.actor}),code('STALE_GENERATION'));
  assert.throws(()=>f.m.command('room.message',{taskId:'task-a',target:'room',text:'late'},{actor:r.actor}),code('STALE_GENERATION'));
});
test('one Bot cannot run two parallel nodes in its single Task session',t=>{
  const f=setup(t),body=f.m.catalog('workflow',{id:'sa-sd',revision:1}).body;
  f.save('workflow','parallel',{name:'Parallel',nodes:[body.nodes[0],{...body.nodes[0],key:'second'}]});
  f.m.command('task.create',{id:'task-a',projectId:'project-a',repositoryId:'repo-a',title:'Parallel',workflow:{id:'parallel',revision:1}});f.ready();f.start();
  const n=f.m.detail('task-a').nodes.find(n=>n.node_key==='second');assert.throws(()=>f.m.command('node.start',{nodeId:n.id,expectedVersion:n.version},{actor:system}),code('BOT_SESSION_BUSY'));
});
test('workflows cannot mix different revisions of the same Bot',t=>{
  const f=setup(t),bot=f.m.catalog('bot',{id:'sa',revision:1}).body;f.save('bot','sa',{...bot,model:'other'},1);
  const body=f.m.catalog('workflow',{id:'sa-sd',revision:1}).body;assert.throws(()=>f.save('workflow','mixed',{name:'Mixed',nodes:[body.nodes[0],{...body.nodes[0],key:'second',bot:{id:'sa',revision:2}}]}),code('BOT_REVISION_CONFLICT'));
});
test('summaries are deduplicated and never accept an arbitrary transcript field',t=>{
  const f=setup(t);f.create();f.ready();const e=f.m.command('room.message',{taskId:'task-a',target:'room',text:'Decision'});
  const input={soulId:'sa-soul',projectId:'project-a',category:'DECISION',summary:'Summary.',sourceEventIds:[e.messageId]};
  assert.equal(f.m.command('memory.summarize',input).id,f.m.command('memory.summarize',input).id);
  assert.throws(()=>f.m.command('memory.summarize',{...input,transcript:['all conversation']}),code('UNKNOWN_FIELD'));
});
test('in-progress Git checkpoint is never blindly replayed just because a lease expired',async t=>{
  const f=setup(t);f.create();f.m.exec("INSERT INTO sm_git_jobs(task_id,state,owner,deadline) VALUES(?,'RUNNING','old-owner',0)",'task-a');
  await assert.rejects(()=>provisionTaskWorktree(f.m,'task-a'),code('CHECKPOINT_BUSY'));assert.equal(f.m.detail('task-a').worktree.state,'PENDING');
});
