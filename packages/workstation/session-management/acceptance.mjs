/** Task-level verification and HUMAN_ACCEPTANCE Git checkpoint.
 * Tests and ordinary file inspection never invoke Git. The explicit approval
 * boundary is the only path here that invokes Git, with a durable crash guard.
 */
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readdir,readFile,lstat,realpath,mkdtemp,mkdir,writeFile,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {requireThat as ok,canonical} from './contracts.mjs';

const execute=promisify(execFile);
const ignored=new Set(['.git','node_modules','.runtime','.generated','test-results','playwright-report','blob-report']);
const system={kind:'system',id:'verification-checkpoint'};
function sha256(bytes){return createHash('sha256').update(bytes).digest('hex');}
function sourceName(name){return !ignored.has(name)&&(!name.startsWith('.env')||name==='.env.example')&&name!=='__pycache__';}
function assertText(text,name,max=1024){ok(typeof text==='string'&&text.length>0&&text.length<=max,'INVALID_ACCEPTANCE',`${name} invalid`,422);return text;}

/** Git-free snapshot: every included regular file and executable bit is bound.
 * Reject symbolic links and special files rather than traversing outside worktree.
 */
export async function fingerprintWorktree(root){
  const files=[];let total=0;
  async function walk(relative,depth){
    ok(depth<40&&files.length<=30000,'SOURCE_LIMIT','Source tree is too deep or large',413);
    const entries=await readdir(path.join(root,relative),{withFileTypes:true});
    entries.sort((a,b)=>Buffer.compare(Buffer.from(a.name),Buffer.from(b.name)));
    for(const entry of entries){
      if(!sourceName(entry.name))continue;
      const rel=relative?relative+'/'+entry.name:entry.name;
      ok(!entry.isSymbolicLink(),'SOURCE_SYMLINK','Source links require explicit support',409);
      if(entry.isDirectory()){await walk(rel,depth+1);continue;}
      ok(entry.isFile(),'SOURCE_NOT_REGULAR',`Special file: ${rel}`,409);
      const stat=await lstat(path.join(root,rel));
      ok(stat.size<=20*1024*1024,'SOURCE_LIMIT','Single file too large',413);
      total+=stat.size;ok(total<=100*1024*1024,'SOURCE_LIMIT','Source tree too large',413);
      const bytes=await readFile(path.join(root,rel));
      files.push({path:rel,mode:stat.mode&0o111?'100755':'100644',sha256:sha256(bytes),size:bytes.length});
    }
  }
  await walk('',0);
  ok(files.length>0,'EMPTY_WORKTREE','Nothing to verify',409);
  const digest=sha256(canonical(files));
  return {digest,files};
}
function install(db){
  db.exec(`CREATE TABLE IF NOT EXISTS sm_verification_evidence(
     id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES sm_tasks(id),
     task_version INTEGER NOT NULL,task_revision INTEGER NOT NULL,
     source_digest TEXT NOT NULL,results_digest TEXT NOT NULL,
     profile_id TEXT NOT NULL,profile_digest TEXT NOT NULL,
     total INTEGER NOT NULL CHECK(total>0),passed INTEGER NOT NULL,
     failed INTEGER NOT NULL,skipped INTEGER NOT NULL,
     receipt TEXT NOT NULL CHECK(json_valid(receipt)),created_at TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS sm_acceptance_checkpoints(
     task_id TEXT PRIMARY KEY REFERENCES sm_tasks(id),
     verification_id TEXT NOT NULL REFERENCES sm_verification_evidence(id),
     expected_version INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN ('COMMITTING','COMPLETED','UNKNOWN')),
     commit_sha TEXT,error TEXT,created_at TEXT NOT NULL
   );`);
}
async function runGit(worktree,args,options={}){
  const env={};for(const [k,v] of Object.entries(process.env))if(!k.startsWith('GIT_'))env[k]=v;
  env.GIT_CONFIG_NOSYSTEM='1';env.GIT_CONFIG_GLOBAL='/dev/null';env.GIT_TERMINAL_PROMPT='0';
  const {stdout}=await execute('git',['-c','core.hooksPath=/dev/null',
    ...(options.authorName?['-c',`user.name=${options.authorName}`,'-c',`user.email=${options.authorEmail}`]:[]),
    '-C',worktree,...args],{timeout:60000,maxBuffer:40*1024*1024,windowsHide:true,encoding:options.encoding??'utf8',env});
  return stdout;
}
function resultDigest(manager,taskId){
  const rows=manager.all('SELECT node_id,digest,task_revision FROM sm_results WHERE task_id=? ORDER BY node_id',taskId);
  const count=manager.one('SELECT COUNT(*) n FROM sm_nodes WHERE task_id=?',taskId).n;
  ok(rows.length===count&&count>0,'UNFINISHED_NODES','Every node must publish an immutable result before verification',409);
  return sha256(canonical(rows));
}

export class SessionAcceptance{
  constructor(manager,{runTests,profileId='registered-bdd-suite',profileDigest}={}){
    this.manager=manager;this.db=manager.db;install(this.db);this.runTests=runTests;
    this.profileId=profileId;this.profileDigest=profileDigest??sha256(profileId);
  }
  list(taskId){this.manager.task(taskId);return this.manager.all('SELECT * FROM sm_verification_evidence WHERE task_id=? ORDER BY created_at,id',taskId);}
  async verify(taskId){
    const before=this.manager.detail(taskId);
    ok(before.task.state==='WAITING_ACCEPTANCE'&&before.worktree.state==='READY','NOT_READY_FOR_VERIFICATION','Task nodes or worktree not ready',409);
    ok(typeof this.runTests==='function','TRUSTED_VERIFIER_REQUIRED','No registered independent verifier available',503);
    const source=await fingerprintWorktree(before.worktree.path);
    const results=resultDigest(this.manager,taskId);
    // Run against a detached, exact source copy. No Git metadata or task
    // worktree is made accessible as cwd to test commands.
    const detached=await mkdtemp(path.join(tmpdir(),'bdd-verification-'));
    let outcome;
    try{
      for(const item of source.files){
        const original=await readFile(path.join(before.worktree.path,item.path));
        ok(sha256(original)===item.sha256,'SOURCE_CHANGED','Source changed during snapshot copy',409);
        const dest=path.join(detached,item.path);
        await mkdir(path.dirname(dest),{recursive:true,mode:0o700});
        await writeFile(dest,original,{flag:'wx',mode:item.mode==='100755'?0o700:0o600});
        await chmod(dest,item.mode==='100755'?0o700:0o600);
      }
      // The verifier must be registered by the host, not an HTTP/model argument.
      outcome=await this.runTests({taskId,cwd:detached,sourceDigest:source.digest});
    }finally{await rm(detached,{recursive:true,force:true});}
    ok(outcome&&Number.isSafeInteger(outcome.total)&&outcome.total>0&&
       Number.isSafeInteger(outcome.passed)&&outcome.passed===outcome.total&&
       outcome.failed===0&&outcome.skipped===0&&outcome.cancelled===0&&outcome.exitCode===0,
       'VERIFICATION_FAILED','Independent test suite did not complete with all cases passing',422);
    const after=await fingerprintWorktree(before.worktree.path);
    ok(after.digest===source.digest,'SOURCE_CHANGED','Verification changed source files',409);
    const now=this.manager.detail(taskId);
    ok(now.task.state===before.task.state&&now.task.version===before.task.version&&
       resultDigest(this.manager,taskId)===results,'STALE_VERIFICATION','Task or published results changed during verification',409);
    const id='verified-'+randomUUID(),created=new Date().toISOString();
    this.manager.transaction(()=>{
      const task=this.manager.task(taskId);
      ok(task.version===before.task.version&&task.state==='WAITING_ACCEPTANCE','STALE_VERIFICATION','Task changed during publication',409);
      this.manager.exec('INSERT INTO sm_verification_evidence VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        id,taskId,task.version,task.input_revision,source.digest,results,
        this.profileId,this.profileDigest,outcome.total,outcome.passed,0,0,
        canonical({exitCode:outcome.exitCode,summary:outcome.summary??'',sourceFiles:source.files.length}),created);
    });
    return {id,taskId,sourceDigest:source.digest,resultsDigest:results,total:outcome.total,passed:outcome.passed};
  }
  async accept(taskId,{verificationId,expectedVersion,authorName,authorEmail}={}){
    const before=this.manager.detail(taskId);
    ok(before.task.state==='WAITING_ACCEPTANCE'&&before.worktree.state==='READY','NOT_READY_FOR_ACCEPTANCE','Task not ready',409);
    ok(Number.isSafeInteger(expectedVersion)&&expectedVersion===before.task.version,'TASK_VERSION_CONFLICT','Task version changed',409);
    assertText(verificationId,'verificationId',120);
    assertText(authorName,'authorName',200);assertText(authorEmail,'authorEmail',200);
    ok(!/[\r\n\0]/.test(authorName+authorEmail),'INVALID_AUTHOR','Invalid author name/email',422);
    const evidence=this.manager.one('SELECT * FROM sm_verification_evidence WHERE id=? AND task_id=?',verificationId,taskId);
    ok(evidence&&evidence.task_version===expectedVersion&&evidence.task_revision===before.task.input_revision&&
      evidence.results_digest===resultDigest(this.manager,taskId),'STALE_EVIDENCE','Evidence not bound to current results',409);
    const snapshot=await fingerprintWorktree(before.worktree.path);
    ok(snapshot.digest===evidence.source_digest,'STALE_EVIDENCE','Verified source differs from current source',409);
    ok(!before.workers.some(w=>['RESERVED','RUNNING','UNKNOWN'].includes(w.state)),'WORKER_STILL_ACTIVE','Active worker blocks acceptance',409);
    const existing=this.manager.one('SELECT * FROM sm_acceptance_checkpoints WHERE task_id=?',taskId);
    ok(!existing,'CHECKPOINT_RECONCILIATION_REQUIRED','An acceptance checkpoint already exists; reconcile instead of retrying',409);
    this.manager.transaction(()=>{
      const now=this.manager.task(taskId);
      ok(now.version===expectedVersion&&now.state==='WAITING_ACCEPTANCE','TASK_VERSION_CONFLICT','Task changed before acceptance',409);
      this.manager.exec("INSERT INTO sm_acceptance_checkpoints VALUES(?,?,?,'COMMITTING',NULL,NULL,?)",taskId,verificationId,expectedVersion,new Date().toISOString());
    });
    let commitSha;
    try{
      const worktree=await realpath(before.worktree.path);
      ok(worktree===before.worktree.path,'UNSAFE_WORKTREE','Worktree path was replaced',409);
      const branch=(await runGit(worktree,['symbolic-ref','--short','HEAD'])).trim();
      const base=(await runGit(worktree,['rev-parse','HEAD'])).trim();
      ok(branch===before.worktree.branch&&base===before.worktree.base_sha,'WORKTREE_IDENTITY_CHANGED','Worktree branch/base changed',409);
      const tracked=(await runGit(worktree,['ls-files','-z'])).split('\0').filter(Boolean);
      const snapshotPaths=new Set(snapshot.files.map(f=>f.path));
      ok(tracked.every(p=>sourceName(p.split('/')[0])),'UNSAFE_TRACKED_FILE','Tracked source contains excluded private paths',409);
      const changes=[...new Set([...tracked,...snapshotPaths])].sort();
      if(changes.length)await runGit(worktree,['add','-A','--',...changes]);
      const staged=(await runGit(worktree,['diff','--cached','--name-only','-z'])).split('\0').filter(Boolean);
      ok(staged.length>0,'NO_SOURCE_CHANGES','Cannot create an empty acceptance checkpoint',409);
      ok(staged.every(p=>snapshotPaths.has(p)||tracked.includes(p)),'UNEXPECTED_STAGED_FILE','Unverified path would be committed',409);
      ok((await fingerprintWorktree(worktree)).digest===snapshot.digest,'SOURCE_CHANGED','Source changed during acceptance checkpoint',409);
      await runGit(worktree,['commit','-m',`bdd: accept ${taskId} (${verificationId})`],{authorName,authorEmail});
      commitSha=(await runGit(worktree,['rev-parse','HEAD'])).trim();
      const after=await fingerprintWorktree(worktree);
      ok(after.digest===snapshot.digest,'SOURCE_CHANGED','Source changed after Git checkpoint',409);
      const committed=(await runGit(worktree,['ls-files','-z'])).split('\0').filter(Boolean);
      ok(committed.length===snapshotPaths.size&&committed.every(p=>snapshotPaths.has(p)),
        'CHECKPOINT_CONTENT_MISMATCH','Committed paths differ from verified source',409);
      for(const file of snapshot.files){
        const data=await runGit(worktree,['show',`HEAD:${file.path}`],{encoding:'buffer'});
        ok(sha256(data)===file.sha256,'CHECKPOINT_CONTENT_MISMATCH',`Committed bytes mismatch: ${file.path}`,409);
      }
      this.manager.transaction(()=>{
        const now=this.manager.task(taskId);
        ok(now.state==='WAITING_ACCEPTANCE'&&now.version===expectedVersion,'TASK_VERSION_CONFLICT','Task changed before final publication',409);
        this.manager.exec("UPDATE sm_tasks SET state='COMPLETED',version=version+1 WHERE id=?",taskId);
        this.manager.exec("UPDATE sm_acceptance_checkpoints SET state='COMPLETED',commit_sha=? WHERE task_id=?",commitSha,taskId);
        this.manager.event(taskId,'task.accepted',{verificationId,commitSha,sourceDigest:snapshot.digest},
          {kind:'human',id:'local'});
      });
      return {taskId,state:'COMPLETED',commitSha,verificationId};
    }catch(error){
      // Git may have executed already. NEVER retry automatically.
      this.manager.transaction(()=>this.manager.exec("UPDATE sm_acceptance_checkpoints SET state='UNKNOWN',commit_sha=?,error=? WHERE task_id=?",
        commitSha??null,String(error.message??error).slice(0,2000),taskId));
      throw error;
    }
  }
}
