import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openStore} from '../../packages/workstation/store.mjs';
import {withProgress,currentProgress} from '../../packages/git-core/progress.mjs';
import {readProgress,openProgressStore} from '../../packages/git-core/progress-store.mjs';

test('each submission and each CLI reply have independent SQLite transcripts that survive reopening',async t=>{
  const home=await mkdtemp(path.join(os.tmpdir(),'interaction-history-'));t.after(()=>rm(home,{recursive:true,force:true}));
  let store=openStore(home);store.register({id:'SPEC-history',title:'History',remoteUrl:'https://github.com/example/history.git'});
  const enqueue=(id,operation,input)=>store.enqueue({schemaVersion:1,operationId:id,repositoryId:'SPEC-history',operation,input});
  enqueue('OP-parent','workflow.develop',{prompt:'First submitted prompt'});store.claim('OP-parent');
  enqueue('OP-one','interaction.cli.input',{parentOperationId:'OP-parent',message:'first reply'});store.claim('OP-one');
  enqueue('OP-two','interaction.cli.input',{parentOperationId:'OP-parent',message:'second reply'});store.claim('OP-two');
  await withProgress(home,'OP-parent',async()=>{
    const p=currentProgress();p.output('initial output\n');
    p.routeInput('OP-one');store.acknowledgeInput('OP-parent','OP-one');p.output('answer one token=private\n');
    assert.equal(p.routeInput('OP-two'),'OP-one');store.acknowledgeInput('OP-parent','OP-two','OP-one');
    p.output('answer two\n');p.exit({exitCode:0,signal:null});
  });
  store.finish('OP-parent','SUCCEEDED',{completed:true});
  assert.equal(store.get('OP-two').status,'SUCCEEDED');store.close();
  await rm(path.join(home,'development'),{recursive:true,force:true});store=openStore(home);
  try {
    const newest=store.interactions('SPEC-history',{limit:1});assert.equal(newest.entries[0].message,'second reply');assert.ok(newest.nextCursor);
    for(const before of [0,NaN,-1])assert.throws(()=>store.interactions('SPEC-history',{before}),{code:'INVALID_HISTORY_CURSOR'});
    const older=store.interactions('SPEC-history',{limit:1,before:newest.nextCursor});assert.equal(older.entries[0].message,'first reply');
    assert.equal(store.interaction('OP-parent').message,'First submitted prompt');
    assert.match(readProgress(home,'OP-parent').output.toString(),/initial output[\s\S]*answer one[\s\S]*answer two/);
    const first=readProgress(home,'OP-one').output.toString(),second=readProgress(home,'OP-two').output.toString();
    assert.match(first,/answer one token=\[redacted\]/);assert.doesNotMatch(first,/private|answer two/);
    assert.match(second,/answer two/);assert.doesNotMatch(second,/answer one/);assert.equal(readProgress(home,'OP-two').latestExit.exitCode,0);
    const db=new DatabaseSync(path.join(home,'metadata.sqlite'),{readOnly:true});assert.ok(db.prepare('SELECT count(*) n FROM execution_log_chunks').get().n>0);db.close();
  }finally{store.close();}
});

test('legacy log imports once, then SQLite remains authoritative; symlinks are refused',async t=>{
  const home=await mkdtemp(path.join(os.tmpdir(),'interaction-legacy-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const directory=path.join(home,'development/OP-legacy');await mkdir(directory,{recursive:true});
  await writeFile(path.join(directory,'terminal.log'),'Original legacy transcript\n');
  assert.equal(readProgress(home,'OP-legacy').legacyImported,true);
  await writeFile(path.join(directory,'terminal.log'),'External replacement\n');
  assert.equal(readProgress(home,'OP-legacy').output.toString(),'Original legacy transcript\n');
  await mkdir(path.join(home,'development/OP-symlink'));await symlink(path.join(directory,'terminal.log'),path.join(home,'development/OP-symlink/terminal.log'));
  assert.throws(()=>readProgress(home,'OP-symlink'),/Invalid legacy/);
});

test('an Enter without a worker delivery receipt cannot inherit parent success',async t=>{
  const home=await mkdtemp(path.join(os.tmpdir(),'interaction-undelivered-'));t.after(()=>rm(home,{recursive:true,force:true}));const store=openStore(home);t.after(()=>store.close());
  store.register({id:'SPEC-input',title:'Input',remoteUrl:'https://github.com/example/input.git'});
  for(const [operationId,operation,input] of [['OP-parent','workflow.develop',{}],['OP-input','interaction.cli.input',{parentOperationId:'OP-parent',message:'unsent reply'}]]){store.enqueue({schemaVersion:1,operationId,repositoryId:'SPEC-input',operation,input});store.claim(operationId);}
  store.finish('OP-parent','SUCCEEDED',{});assert.equal(store.get('OP-input').status,'FAILED');assert.equal(store.get('OP-input').error.code,'CLI_INPUT_NOT_DELIVERED');
});

test('claim and completion roll back their status when the corresponding SQLite log append fails',async t=>{
  const home=await mkdtemp(path.join(os.tmpdir(),'interaction-atomic-'));t.after(()=>rm(home,{recursive:true,force:true}));const store=openStore(home);t.after(()=>store.close());
  store.register({id:'SPEC-atomic',title:'Atomic',remoteUrl:'https://github.com/example/atomic.git'});store.enqueue({schemaVersion:1,operationId:'OP-atomic',repositoryId:'SPEC-atomic',operation:'workflow.develop',input:{}});
  const db=new DatabaseSync(path.join(home,'metadata.sqlite'));t.after(()=>db.close());
  db.exec("CREATE TRIGGER fail_log BEFORE INSERT ON execution_log_chunks WHEN CAST(NEW.content AS TEXT)='[RUNNING]'||char(10) BEGIN SELECT RAISE(ABORT,'log append failed'); END;");
  assert.throws(()=>store.claim('OP-atomic'),/log append failed/);assert.equal(store.get('OP-atomic').status,'QUEUED');db.exec('DROP TRIGGER fail_log');store.claim('OP-atomic');
  db.exec("CREATE TRIGGER fail_log BEFORE INSERT ON execution_log_chunks WHEN CAST(NEW.content AS TEXT)='[SUCCEEDED]'||char(10) BEGIN SELECT RAISE(ABORT,'log append failed'); END;");
  assert.throws(()=>store.finish('OP-atomic','SUCCEEDED',{}),/log append failed/);assert.equal(store.get('OP-atomic').status,'RUNNING');
});

test('only LLM tasks and their CLI replies appear in stage history, including legacy backfill',async t=>{
  const home=await mkdtemp(path.join(os.tmpdir(),'interaction-types-'));t.after(()=>rm(home,{recursive:true,force:true}));let store=openStore(home);
  store.register({id:'SPEC-types',title:'Types',remoteUrl:'https://github.com/example/types.git'});
  const enqueue=(operationId,operation,input={},context)=>store.enqueue({schemaVersion:1,operationId,repositoryId:'SPEC-types',operation,input,...(context?{interactionType:context}:{})});
  enqueue('OP-design','repository.save',{kind:'source',path:'spec/REQ-001/login/login.sd.md',content:'Design text'});store.finish('OP-design','SUCCEEDED',{});
  enqueue('OP-develop','workflow.develop',{},'GHERKIN');enqueue('OP-reply','interaction.cli.input',{parentOperationId:'OP-develop',message:'CLI reply'},'GHERKIN');store.finish('OP-develop','SUCCEEDED',{});
  assert.equal(store.get('OP-reply').interactionType,'IMPLEMENTATION');
  for(let index=0;index<25;index++){const id=`OP-demand-${index}`;enqueue(id,'workflow.requirement.save',{description:`Demand ${index}`});store.finish(id,'SUCCEEDED',{});}
  enqueue('OP-tests','workflow.tests.complete',{prompt:'Complete tests'});store.finish('OP-tests','FAILED',null,{message:'Agent unavailable'});
  enqueue('OP-local-reply','interaction.cli.input',{parentOperationId:'OP-design',message:'Not an LLM reply'});store.finish('OP-local-reply','FAILED',null,{message:'Not a CLI'});
  assert.equal(store.get('OP-local-reply').isLlmInteraction,false);
  const page=store.interactions('SPEC-types',{limit:1});assert.equal(page.entries[0].id,'OP-tests');assert.ok(page.nextCursor);
  assert.equal(store.interactions('SPEC-types',{limit:1,before:page.nextCursor}).entries[0].id,'OP-reply');
  assert.equal(store.get('OP-tests').isLlmInteraction,true);
  const design=store.interactions('SPEC-types',{type:'SD',limit:1});assert.equal(design.entries.length,0);assert.equal(store.get('OP-design').isLlmInteraction,false);assert.equal(design.nextCursor,null);
  assert.equal(store.interactions('SPEC-types',{type:'GHERKIN',limit:2}).entries.length,0);
  assert.equal(store.interactions('SPEC-types',{type:'IMPLEMENTATION'}).entries.length,2);
  assert.throws(()=>store.interactions('SPEC-types',{type:'invalid'}),{code:'INVALID_INTERACTION_TYPE'});store.close();
  const db=new DatabaseSync(path.join(home,'metadata.sqlite'));db.exec('UPDATE operations SET interaction_type=NULL; PRAGMA user_version=9;');db.close();store=openStore(home);
  try{assert.equal(store.get('OP-reply').interactionType,'IMPLEMENTATION');assert.equal(store.interactions('SPEC-types',{type:'SD'}).entries.length,0);}finally{store.close();}
});
