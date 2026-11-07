import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,realpath,lstat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {requireThat as ok} from './contracts.mjs';

const exec=promisify(execFile);
const system={kind:'system',id:'git-checkpoint'};
const pending=new Map();
async function git(cwd,args) {
  const {stdout}=await exec('git',['-c','core.hooksPath=/dev/null','-C',cwd,...args],{
    timeout:60000,maxBuffer:1024*1024,windowsHide:true,
    env:{...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_'))),GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}
  });return stdout.trim();
}
async function exists(file){try{return await lstat(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}

/** Only FEATURE_CREATE calls this. Normal reads/messages/cancel never invoke Git. */
export async function provisionTaskWorktree(manager,taskId) {
  const key=manager.workstationId+':'+manager.worktreeRoot+':'+taskId;
  if(pending.has(key))return pending.get(key);
  const operation=provision(manager,taskId);pending.set(key,operation);
  try{return await operation;}finally{pending.delete(key);}
}
async function provision(manager,taskId) {
  const details=manager.detail(taskId);
  if(details.worktree.state==='READY')return details;
  ok(details.task.state==='PROVISIONING','TASK_STATE_CONFLICT','Task is not provisioning');
  const owner=randomUUID();
  manager.transaction(()=>{
    const job=manager.one('SELECT * FROM sm_git_jobs WHERE task_id=?',taskId);
    ok(!job||job.state!=='RUNNING','CHECKPOINT_BUSY','Worktree creation is running or needs operator reconciliation; an expired lease does not prove its Git child stopped');
    manager.exec("INSERT INTO sm_git_jobs(task_id,state,owner,deadline) VALUES(?,'RUNNING',?,?) ON CONFLICT(task_id) DO UPDATE SET state='RUNNING',owner=excluded.owner,deadline=excluded.deadline,error=NULL",taskId,owner,Date.now()+300000);
  });
  const wt=details.worktree,repo=manager.one('SELECT * FROM sm_repositories WHERE workstation_id=? AND id=?',manager.workstationId,details.task.repository_id);
  try {
    await mkdir(manager.worktreeRoot,{recursive:true,mode:0o700});
    ok(await realpath(manager.worktreeRoot)===manager.worktreeRoot,'UNSAFE_PATH','Worktree root must not be redirected by symlinks');
    const root=await realpath(repo.root_path),top=await realpath(await git(root,['rev-parse','--show-toplevel']));
    ok(root===top,'REPOSITORY_ROOT_REQUIRED','Register the repository root, not a nested directory');
    const job=manager.one('SELECT * FROM sm_git_jobs WHERE task_id=?',taskId);
    const baseSha=job.planned_base_sha??await git(root,['rev-parse','--verify','HEAD^{commit}']);
    ok(/^[a-f0-9]{40}$/.test(baseSha),'INVALID_BASE_SHA','Expected a SHA-1 commit');
    manager.transaction(()=>{const current=manager.one('SELECT * FROM sm_git_jobs WHERE task_id=?',taskId);ok(current.owner===owner,'LEASE_LOST','Creation lease lost');manager.exec('UPDATE sm_git_jobs SET planned_base_sha=? WHERE task_id=?',baseSha,taskId);});
    const existing=await exists(wt.path);
    if(existing) {
      ok(existing.isDirectory()&&!existing.isSymbolicLink(),'UNSAFE_PATH','Worktree target is not a real directory');
      const sourceCommon=await realpath(path.resolve(root,await git(root,['rev-parse','--git-common-dir'])));
      const targetCommon=await realpath(path.resolve(wt.path,await git(wt.path,['rev-parse','--git-common-dir'])));
      ok(sourceCommon===targetCommon&&await git(wt.path,['symbolic-ref','--short','HEAD'])===wt.branch&&await git(wt.path,['rev-parse','HEAD'])===baseSha,'WORKTREE_IDENTITY_CONFLICT','Existing path is not this task worktree');
    } else await git(root,['worktree','add','-b',wt.branch,'--',wt.path,baseSha]);
    // Reconcile filesystem completion before publishing; never claim success from exit code alone.
    ok(await git(wt.path,['rev-parse','HEAD'])===baseSha,'WORKTREE_IDENTITY_CONFLICT','Created worktree changed');
    const outcome=manager.command('worktree.ready',{taskId,path:wt.path,branch:wt.branch,baseSha},{actor:system,requestId:`worktree-ready:${taskId}`});
    manager.transaction(()=>manager.exec("UPDATE sm_git_jobs SET state='DONE' WHERE task_id=? AND owner=?",taskId,owner));
    return outcome;
  }catch(error){
    manager.transaction(()=>manager.exec("UPDATE sm_git_jobs SET state='ERROR',error=? WHERE task_id=? AND owner=?",String(error.message).slice(0,2000),taskId,owner));
    if(manager.task(taskId).state==='PROVISIONING')manager.command('worktree.failed',{taskId,message:String(error.message).slice(0,2000)},{actor:system});
    throw error;
  }
}
