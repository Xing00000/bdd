import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { handleProgress } from '../../packages/workstation/mcp-progress.mjs';
import {openProgressStore} from '../../packages/git-core/progress-store.mjs';

const rpc=(method,params={})=>({jsonrpc:'2.0',id:1,method,params});
test('protocol versions apply to initialize, calls and notifications', async()=>{
  const call=(version,body)=>handleProgress({},'/unused',{method:'POST',headers:{host:'localhost:1234',...(version===undefined?{}:{'mcp-protocol-version':version})},body});
  for(const body of [rpc('initialize',{protocolVersion:'2025-11-25'}),rpc('ping'),{jsonrpc:'2.0',method:'notifications/initialized'}]) {
    assert.equal((await call('bad',body)).status,400);
    assert.notEqual((await call('2025-11-25',body)).status,400);
    assert.notEqual((await call('2025-06-18',body)).status,400);
    assert.notEqual((await call(undefined,body)).status,400);
  }
});
test('process metadata is bounded and only allowed fields are returned',async()=>{
  const home=await mkdtemp(path.join(os.tmpdir(),'mcp-hardening-'));
  try {
    const dir=path.join(home,'development','OP-one');await mkdir(dir,{recursive:true});
    const file=path.join(dir,'processes.json');
    await writeFile(file,JSON.stringify([{role:'agent',state:'RUNNING',command:'node --token=hidden',env:{secret:'hidden'},argv:['hidden'],reason:'token=hidden'}]));
    const store={repository(){},get(){return {repository_id:'SPEC-one',status:'RUNNING',request:{operation:'workflow.develop'},created_at:'2020-01-01T00:00:00.000Z'};}};
    const call=()=>handleProgress(store,home,{method:'POST',headers:{host:'localhost:1234'},body:rpc('tools/call',{name:'workbench_get_job_progress',arguments:{repositoryId:'SPEC-one',jobId:'OP-one'}})});
    const result=(await call()).body.result.structuredContent;
    assert.equal(result.agent.state,'RUNNING');assert.equal(result.agent.command,'[redacted]');assert.doesNotMatch(JSON.stringify(result),/hidden|argv|env/);
    const database=openProgressStore(home);database.update('OP-one','processes_json',Array.from({length:4097},()=>({state:'RUNNING'})));database.close();assert.ok((await call()).body.error);
  } finally {await rm(home,{recursive:true,force:true});}
});
test('bridge returns safe same-id errors and follows negotiated version',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'mcp-bridge-'));
  try {
    const mock=path.join(dir,'mock.mjs');
    await writeFile(mock,`globalThis.fetch=async (url,options)=>{const q=JSON.parse(options.body);if(options.redirect!=='error'||!options.signal)throw Error('bad options');if(q.method==='initialize')return {status:200,ok:true,json:async()=>({jsonrpc:'2.0',id:q.id,result:{protocolVersion:'2025-11-25'}})};if(options.headers['mcp-protocol-version']!=='2025-11-25')throw Error('bad version');throw Error('secret url');};`);
    const input=[rpc('initialize',{protocolVersion:'2025-11-25'}),rpc('ping'),{jsonrpc:'2.0',method:'notifications/initialized'}].map(JSON.stringify).join('\n')+'\n';
    const result=spawnSync(process.execPath,['--import',mock,'scripts/mcp-progress.mjs','http://127.0.0.1:1234/repository-api/v1/mcp/progress'],{input,encoding:'utf8'});
    assert.equal(result.status,0);const lines=result.stdout.trim().split('\n').map(JSON.parse);assert.equal(lines.length,2);assert.equal(lines[1].id,1);assert.equal(lines[1].error.code,-32603);assert.doesNotMatch(result.stdout+result.stderr,/secret|127\.0\.0\.1/);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('failed process registration terminates the spawned process group',async t=>{
  const { spawn }=await import('node:child_process');
  const { withProgress }=await import('../../packages/git-core/progress.mjs');
  const { runPty }=await import('../../packages/workstation/development.mjs');
  const home=await mkdtemp(path.join(os.tmpdir(),'mcp-cleanup-'));let child;
  try {
    const pty={spawn(){child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});return {pid:child.pid,kill:signal=>child.kill(signal),onExit:fn=>child.once('exit',(exitCode,signal)=>fn({exitCode,signal}))};}};
    await assert.rejects(withProgress(home,'OP-one',async()=>{const {currentProgress}=await import('../../packages/git-core/progress.mjs');t.mock.method(currentProgress(),'startProcess',()=>{throw new Error('SQLite registration failed');});return runPty(pty,'node',[],home,{log(){},timeoutMs:5000});}));
    await new Promise(resolve=>child.once('exit',resolve));
    assert.ok(child.signalCode);
  } finally {await rm(home,{recursive:true,force:true});}
});
