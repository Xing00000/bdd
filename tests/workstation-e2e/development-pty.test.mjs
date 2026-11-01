import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp,rm } from 'node:fs/promises';
import pty from 'node-pty';
import { runPty, createDevelopmentLog } from '../../packages/workstation/development.mjs';
import { stopChildProcesses } from '../../packages/git-core/index.mjs';

async function directory(t){const cwd=await mkdtemp(path.join(os.tmpdir(),'bdd-real-pty-'));t.after(()=>rm(cwd,{recursive:true,force:true}));return cwd;}
test('real PTY supports terminal input and exits without orphaned listeners',{timeout:15000},async t=>{
 const cwd=await directory(t);let output='',sent=false;const before=process.listenerCount('message');
 const result=await runPty(pty,process.execPath,['-e',`if(!process.stdin.isTTY||!process.stdout.isTTY)process.exit(9);console.log('TTY_READY');process.stdin.setEncoding('utf8');process.stdin.on('data',s=>{console.log('RECEIVED:'+s.trim());process.exit(0)});`],cwd,{timeoutMs:8000,log:text=>{output+=text;if(!sent&&output.includes('TTY_READY')){sent=true;process.emit('message',{type:'development.input',data:'hello-pty\r'});}}});
 assert.equal(result.exitCode,0);assert.match(output,/RECEIVED:hello-pty/);assert.equal(process.listenerCount('message'),before);
});
test('real PTY timeout terminates an agent that ignores ordinary termination',{timeout:10000},async t=>{
 const cwd=await directory(t);const start=Date.now();const result=await runPty(pty,process.execPath,['-e',`process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},100);`],cwd,{timeoutMs:500,log:()=>{}});
 assert.equal(result.timedOut,true);assert.ok(Date.now()-start<6000);
});
test('worker cancellation tracks and stops the real PTY process group',{timeout:10000},async t=>{
 const cwd=await directory(t);let cancelled=false;const result=await runPty(pty,process.execPath,['-e',`console.log('CANCEL_READY');setInterval(()=>{},100);`],cwd,{timeoutMs:8000,log:text=>{if(!cancelled&&text.includes('CANCEL_READY')){cancelled=true;void stopChildProcesses();}}});
 assert.equal(cancelled,true);assert.ok(result.exitCode!==0||result.signal);
});

test('Agent output limit stops the real process in a progress context', {timeout:15000}, async t=>{
 const cwd=await directory(t);const {withProgress}=await import('../../packages/git-core/progress.mjs');
 await withProgress(cwd,'OP-limit',async()=>{
  const log=createDevelopmentLog(path.join(cwd,'development/OP-limit/terminal.log'));
  await assert.rejects(runPty(pty,process.execPath,['-e',"setInterval(()=>process.stdout.write('x'.repeat(65536)),1)"],cwd,{timeoutMs:8000,log}),{code:'TERMINAL_OUTPUT_LIMIT'});
 });
});
