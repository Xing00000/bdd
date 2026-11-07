import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile as execCb} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {fixture} from './session-management-fixture.mjs';
import {provisionTaskWorktree} from '../../packages/workstation/session-management/worktree.mjs';
import {SessionAcceptance,fingerprintWorktree} from '../../packages/workstation/session-management/acceptance.mjs';
const execFile=promisify(execCb);
async function git(cwd,...args){return (await execFile('git',['-C',cwd,...args])).stdout.trim();}
async function ready(t){
  const f=fixture();t.after(()=>f.close());
  await git(path.join(f.home,'repo'),'init','-b','main');
  await git(path.join(f.home,'repo'),'config','user.name','Test');
  await git(path.join(f.home,'repo'),'config','user.email','test@local');
  await writeFile(path.join(f.home,'repo','app.txt'),'initial\n');
  await mkdir(path.join(f.home,'repo','tests'));
  await writeFile(path.join(f.home,'repo','tests','pass.test.cjs'),"const test=require('node:test');const assert=require('node:assert/strict');test('real pass',()=>assert.equal(2+2,4));\n");
  await git(path.join(f.home,'repo'),'add','.');await git(path.join(f.home,'repo'),'commit','-m','base');
  f.create();await provisionTaskWorktree(f.m,'task-a');
  const sa=f.start();f.submit(sa);const sd=f.start('task-a','design');f.submit(sd);
  const worktree=f.m.detail('task-a').worktree.path;
  assert.equal(f.m.task('task-a').state,'WAITING_ACCEPTANCE');
  await writeFile(path.join(worktree,'app.txt'),'implemented\n');
  const count=(text,key)=>Number(new RegExp('^# '+key+' (\\d+)\\s*$','m').exec(text)?.[1]);
  const runTests=async ({cwd})=>{
    const env={...process.env};delete env.NODE_TEST_CONTEXT;const {stdout}=await execFile(process.execPath,['--test','--test-reporter=tap','tests/pass.test.cjs'],{cwd,timeout:10000,env});
    const outcome={total:count(stdout,'tests'),passed:count(stdout,'pass'),failed:count(stdout,'fail'),skipped:count(stdout,'skipped'),cancelled:count(stdout,'cancelled'),exitCode:0};return outcome;
  };
  return {f,worktree,service:new SessionAcceptance(f.m,{runTests,profileId:'real-node-test'})};
}
test('real Node test verification binds immutable source and Git human acceptance checkpoint',async t=>{
  const {f,worktree,service}=await ready(t);
  const receipt=await service.verify('task-a');assert.equal(receipt.total,1);
  const before=f.m.task('task-a');
  const result=await service.accept('task-a',{verificationId:receipt.id,expectedVersion:before.version,authorName:'Human Reviewer',authorEmail:'reviewer@local'});
  assert.equal(result.state,'COMPLETED');assert.match(result.commitSha,/^[0-9a-f]{40}$/);
  assert.equal(await git(worktree,'rev-parse','HEAD'),result.commitSha);
  assert.equal(await git(worktree,'show','HEAD:app.txt'),'implemented');
  assert.equal(f.m.task('task-a').state,'COMPLETED');
  assert.equal(f.m.one('SELECT state FROM sm_acceptance_checkpoints WHERE task_id=?','task-a').state,'COMPLETED');
});
test('source mutation invalidates a previously passing receipt before Git checkpoint',async t=>{
  const {f,worktree,service}=await ready(t);
  const receipt=await service.verify('task-a');
  const old=await git(worktree,'rev-parse','HEAD');
  await writeFile(path.join(worktree,'app.txt'),'modified after test\n');
  await assert.rejects(service.accept('task-a',{verificationId:receipt.id,expectedVersion:f.m.task('task-a').version,authorName:'Human',authorEmail:'human@local'}),/Verified source differs/);
  assert.equal(f.m.one('SELECT COUNT(*) n FROM sm_acceptance_checkpoints').n,0);
  assert.equal(await git(worktree,'rev-parse','HEAD'),old);
});
test('zero, skipped, failed or simulated verification never creates evidence',async t=>{
  const {f,service}=await ready(t);
  for(const outcome of [{total:0,passed:0,failed:0,skipped:0,cancelled:0,exitCode:0},{total:1,passed:1,failed:0,skipped:1,cancelled:0,exitCode:0},{total:1,passed:0,failed:1,skipped:0,cancelled:0,exitCode:1}]){
    const bad=new SessionAcceptance(f.m,{runTests:async()=>outcome});
    await assert.rejects(bad.verify('task-a'),/Independent test suite did not complete/);
  }
  assert.equal(service.list('task-a').length,0);
});
test('crash or Git identity conflict enters UNKNOWN and cannot silently re-commit',async t=>{
  const {f,worktree,service}=await ready(t);const receipt=await service.verify('task-a');
  await git(worktree,'checkout','-b','foreign');
  await assert.rejects(service.accept('task-a',{verificationId:receipt.id,expectedVersion:f.m.task('task-a').version,authorName:'Human',authorEmail:'human@local'}),/branch\/base changed/);
  assert.equal(f.m.one('SELECT state FROM sm_acceptance_checkpoints WHERE task_id=?','task-a').state,'UNKNOWN');
  await git(worktree,'checkout',f.m.detail('task-a').worktree.branch);
  await assert.rejects(service.accept('task-a',{verificationId:receipt.id,expectedVersion:f.m.task('task-a').version,authorName:'Human',authorEmail:'human@local'}),/already exists/);
});
test('fingerprint is Git-free and preserves executable bit and file bytes',async t=>{
  const {worktree}=await ready(t);
  const a=await fingerprintWorktree(worktree);
  await writeFile(path.join(worktree,'app.txt'),'different bytes\n');
  const b=await fingerprintWorktree(worktree);assert.notEqual(a.digest,b.digest);
});
