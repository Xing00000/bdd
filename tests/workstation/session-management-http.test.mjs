import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {dispatchSessionManagement} from '../../packages/workstation/session-management/http.mjs';
import {fixture} from './session-management-fixture.mjs';
const exec=promisify(execFile);
const prefix='/repository-api/v1/session-management';
function setup(t){const f=fixture();t.after(()=>f.close());return f;}
const req=(f,method,url,body,headers={'x-workbench-request':'1',host:'127.0.0.1'})=>dispatchSessionManagement({options:{home:f.home}},{method,url,body,headers});

test('HTTP: shared workstation state survives independently opened request connections',async t=>{
  const f=setup(t);const result=await req(f,'POST',prefix+'/commands',{command:'project.create',input:{name:'From HTTP'},requestId:'http-create'});assert.equal(result.status,200);
  const listed=await req(f,'GET',prefix);assert.equal(listed.body.projects.length,3);
  const replay=await req(f,'POST',prefix+'/commands',{command:'project.create',input:{name:'From HTTP'},requestId:'http-create'});assert.deepEqual(replay.body,result.body);
});
test('HTTP: rejects cross-origin requests and missing write header',async t=>{
  const f=setup(t),body={command:'project.create',input:{name:'no'},requestId:'no'};
  assert.equal((await req(f,'POST',prefix+'/commands',body,{})).status,403);
  assert.equal((await req(f,'POST',prefix+'/commands',body,{'x-workbench-request':'1',host:'127.0.0.1',origin:'https://evil.invalid'})).status,403);
  assert.equal(f.m.snapshot().projects.length,2);
});
test('HTTP: cannot impersonate internal runtime or forge execution receipts',async t=>{
  const f=setup(t);f.create();
  for(const command of ['runtime.attach','node.start','node.submit','worker.receipt','worktree.ready'])assert.equal((await req(f,'POST',prefix+'/commands',{command,input:{},requestId:command})).status,403);
  const result=await req(f,'POST',prefix+'/commands',{command:'project.create',input:{name:'x'},requestId:'spoof',actor:{kind:'system'}});assert.equal(result.status,400);
});
test('HTTP: capability report explicitly distinguishes data core from unavailable execution',async t=>{
  const f=setup(t),response=await req(f,'GET',prefix+'/capabilities');assert.equal(response.body.nativeRuntimeDispatch,false);assert.equal(response.body.workerDispatch,false);assert.equal(response.body.taskWorktreeProvisioning,true);
});
test('HTTP: preview UI served on existing workstation origin with CSP',async t=>{
  const f=setup(t),page=await req(f,'GET','/repositories/session-management');assert.equal(page.status,200);assert.ok(page.headers['content-security-policy'].includes("script-src 'self'"));assert.match(page.body.toString(),/尚未接線/);
  const js=await req(f,'GET','/repositories/session-management.js');assert.equal(js.status,200);assert.ok(!js.body.toString().includes('innerHTML'));
});
test('HTTP: unknown or malformed routes never fall through as success',async t=>{
  const f=setup(t);assert.equal((await req(f,'POST',prefix+'/unknown',{})).status,404);assert.equal((await req(f,'GET',prefix+'/tasks/absent')).status,404);
  assert.equal(await req(f,'GET','/repository-api/v1/agent-sessions'),undefined);
});
test('HTTP: real socket requests exercise production session route',async t=>{
  const f=setup(t),server=createServer(async(request,response)=>{
    const chunks=[];for await(const chunk of request)chunks.push(chunk);
    const result=await dispatchSessionManagement({options:{home:f.home}},{url:request.url,method:request.method,headers:request.headers,body:chunks.length?JSON.parse(Buffer.concat(chunks)):undefined});
    response.writeHead(result.status,result.headers);response.end(Buffer.isBuffer(result.body)?result.body:JSON.stringify(result.body));
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const url=`http://127.0.0.1:${server.address().port}${prefix}`;
  const saved=await fetch(url+'/commands',{method:'POST',headers:{'content-type':'application/json','x-workbench-request':'1'},body:JSON.stringify({command:'project.create',input:{name:'Socket project'},requestId:'socket'})});assert.equal(saved.status,200);
  const loaded=await(await fetch(url)).json();assert.ok(loaded.projects.some(p=>p.name==='Socket project'));
});
test('race: two OS processes cannot take the last Worker quota slot',async t=>{
  const f=setup(t);f.create();f.ready();const run=f.start();
  const moduleUrl=new URL('../../packages/workstation/session-management/core.mjs',import.meta.url).href;
  const code=`import {SessionManager} from ${JSON.stringify(moduleUrl)};const [file,options,input,actor]=JSON.parse(process.argv[1]);const m=new SessionManager(file,options);try{console.log(JSON.stringify({ok:true,result:m.command('worker.reserve',input,{actor})}));}catch(e){console.log(JSON.stringify({ok:false,code:e.code}));}finally{m.close();}`;
  const args=JSON.stringify([f.file,f.options,{nodeId:run.node.id,profile:'coding-acp',writeAccess:true},run.actor]);
  const outcomes=await Promise.all([1,2].map(()=>exec(process.execPath,['--input-type=module','-e',code,args]).then(r=>JSON.parse(r.stdout))));
  assert.equal(outcomes.filter(r=>r.ok).length,1);assert.equal(outcomes.find(r=>!r.ok).code,'CLI_CONCURRENCY_LIMIT');
});
