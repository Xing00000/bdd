import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import Fastify from 'fastify';
import {registerRepositoryRoutes} from '../../packages/workstation/http.mjs';

test('Fastify exposes protected partial chat settings updates at the workstation route',async t=>{
  const home=await mkdtemp(path.join(os.tmpdir(),'bdd-http-routing-'));
  const app=Fastify();
  t.after(async()=>{await app.close();await rm(home,{recursive:true,force:true});});
  const service=await registerRepositoryRoutes(app,{home,toolkitRoot:fileURLToPath(new URL('../..',import.meta.url)),autoAcquire:false});
  const updates=[];
  // This checks the HTTP adapter contract; chat persistence has its own tests.
  service.chat=async()=>({patchSettings:async input=>{updates.push(input);return {timeoutMs:input.timeoutMs};}});
  const url='/repository-api/v1/chat-settings',payload={timeoutMs:120000};
  const protectedResponse=await app.inject({method:'PATCH',url,payload});
  assert.equal(protectedResponse.statusCode,403);
  assert.deepEqual(updates,[]);
  const response=await app.inject({method:'PATCH',url,payload,headers:{'x-workbench-request':'1'}});
  assert.equal(response.statusCode,200);
  assert.deepEqual(response.json(),payload);
  assert.deepEqual(updates,[payload]);
});
