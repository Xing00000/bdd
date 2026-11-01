import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { handleProgress } from '../../packages/workstation/mcp-progress.mjs';
import { withProgress } from '../../packages/git-core/progress.mjs';
import { dispatch } from '../../packages/workstation/http.mjs';
import { openStore } from '../../packages/workstation/store.mjs';

test('read-only MCP protocol, scoped progress, redaction and activity', async () => {
  const home=await mkdtemp(path.join(os.tmpdir(),'mcp-progress-'));
  try {
    const jobId='OP-123', repositoryId='SPEC-123', dir=path.join(home,'development',jobId);
    await mkdir(dir,{recursive:true});
    await writeFile(path.join(dir,'terminal.log'),'hello token=secret-value\n');
    await withProgress(home,jobId,async()=>{const {currentProgress}=await import('../../packages/git-core/progress.mjs');const p=currentProgress(), a=p.startProcess('/bin/node','agent',123);p.finishProcess(a,{exitCode:0});for(let i=0;i<70;i++){const x=p.startProcess('git','cli',i);p.finishProcess(x,{exitCode:0});}});
    const op={id:jobId,repository_id:repositoryId,request:{operation:'workflow.develop'},status:'SUCCEEDED',created_at:'2020-01-01T00:00:00.000Z',result:{runId:'RUN-1',testOutcome:'FAILED',verification:'NOT_VERIFIED',evidenceComplete:true}};
    const store={repositories:()=>[{id:repositoryId,title:'Demo',remoteUrl:'secret'}],repository:x=>{if(x!==repositoryId)throw Error('unknown');},get:x=>x===jobId?op:null,operations:()=>[op]};
    const call=body=>handleProgress(store,home,{method:'POST',headers:{host:'127.0.0.1:1234'},body});
    const rpc=(method,params={})=>({jsonrpc:'2.0',id:1,method,params});
    assert.equal((await call(rpc('initialize',{protocolVersion:'2025-11-25'}))).body.result.protocolVersion,'2025-11-25');
    assert.equal((await call({jsonrpc:'2.0',method:'notifications/initialized'})).status,202);
    assert.equal((await call(rpc('tools/list'))).body.result.tools.length,3);
    const request=rpc('tools/call',{name:'workbench_get_job_progress',arguments:{repositoryId,jobId,staleAfterMs:1000}});
    const value=(await call(request)).body.result.structuredContent;
    assert.equal(value.agent.state,'EXITED');assert.equal(value.agent.exitCode,0);assert.equal(value.acceptance.testOutcome,'FAILED');assert.match(value.output.text,/\[redacted\]/);assert.doesNotMatch(JSON.stringify(value),/secret-value/);
    assert.equal((await call(request)).body.result.structuredContent.activity.lastActivityAt,value.activity.lastActivityAt);
    assert.ok((await call(rpc('tools/call',{name:'workbench_get_job_progress',arguments:{repositoryId,jobId:'../bad'}}))).body.error);
    assert.ok((await call(rpc('tools/call',{name:'workbench_cancel_job',arguments:{}}))).body.error);
    assert.equal((await handleProgress(store,home,{method:'GET',headers:{host:'localhost:1234'}})).status,405);
    await assert.rejects(handleProgress(store,home,{method:'GET',headers:{host:'evil.example'}}));
    await assert.rejects(handleProgress(store,home,{method:'POST',headers:{host:'localhost:1234',origin:'http://evil.example'},body:{}}));
  } finally { await rm(home,{recursive:true,force:true}); }
});

test('dispatcher isolates MCP from the existing write guard', async () => {
  const service={mcpProgress:async request=>({status:200,body:{method:request.body.method}})};
  const reply=await dispatch(service,{method:'POST',url:'/repository-api/v1/mcp/progress',headers:{host:'localhost:1234'},body:{method:'ping'}});
  assert.equal(reply.status,200);
  await assert.rejects(dispatch(service,{method:'POST',url:'/repository-api/v1/operations',headers:{host:'localhost:1234'},body:{}}),{code:'REQUEST_HEADER_REQUIRED'});
});

test('SQLite-backed interrupted progress keeps missing exit unknown and queries do not update the job', async () => {
  const home=await mkdtemp(path.join(os.tmpdir(),'mcp-sqlite-'));
  const store=openStore(home);
  try {
    store.register({id:'SPEC-one',title:'One',remoteUrl:'/unused'});
    store.enqueue({operationId:'OP-one',repositoryId:'SPEC-one',operation:'workflow.develop',input:{}});
    store.claim('OP-one');
    const dir=path.join(home,'development','OP-one');await mkdir(dir,{recursive:true});
    await writeFile(path.join(dir,'processes.json'),JSON.stringify([{commandId:'one',command:'node',role:'agent',pid:1,state:'RUNNING',startedAt:'2020-01-01T00:00:00.000Z'}]));
    store.finish('OP-one','INTERRUPTED',undefined,{code:'WORKER_INTERRUPTED',message:'Worker ended'});
    const before=store.get('OP-one');
    const response=await handleProgress(store,home,{method:'POST',headers:{host:'localhost:1234'},body:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'workbench_get_job_progress',arguments:{repositoryId:'SPEC-one',jobId:'OP-one'}}}});
    const value=response.body.result.structuredContent;
    assert.equal(value.status,'INTERRUPTED');assert.equal(value.agent.state,'UNKNOWN');assert.equal(value.agent.reason,'NO_EXIT_RECEIPT');
    assert.equal(value.blockers[0].code,'WORKER_INTERRUPTED');assert.equal(value.acceptance,null);
    assert.deepEqual(store.get('OP-one'),before);
  } finally {store.close();await rm(home,{recursive:true,force:true});}
});
