import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,symlink,writeFile,rename} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import path from 'node:path';
import {createAgentSupervisor,supervisorRpc} from '../../packages/workstation/agent-supervisor.mjs';
import {openStore} from '../../packages/workstation/store.mjs';
import {registeredAgentWorkspaces} from '../../packages/workstation/agent-workspaces.mjs';
import {projectFixture} from './agent-workspace-fixture.mjs';

test('registered project discovery, selection and real CLI writes use product directories',async t=>{
 const f=await projectFixture();t.after(()=>f.close());
 const result=await supervisorRpc(f.supervisor,{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'agent_workspaces',arguments:{}}});
 assert.deepEqual(result.result.structuredContent.workspaces.map(item=>item.cwd),f.config.projects.map(item=>path.join(f.root,item.path)));
 await assert.rejects(()=>f.supervisor.start({protocol:'pty',command:process.execPath}),{code:'AGENT_PROJECT_REQUIRED'});
 for(const project of f.config.projects){
  const session=await f.supervisor.start({protocol:'pty',command:process.execPath,args:['-e',"require('node:fs').writeFileSync('cli-write.txt',process.cwd());console.log('SAVED');process.stdin.resume()"],repositoryId:'fixture-spec',projectId:project.id});
  const target=path.join(f.root,project.path);assert.equal(session.cwd,target);
  const deadline=Date.now()+3000;
  while(!f.supervisor.events(session.sessionId).events.some(event=>event.content.includes('SAVED'))&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(await readFile(path.join(target,'cli-write.txt'),'utf8'),target);await f.supervisor.stop(session.sessionId);
 }
});
test('unregistered directories and symlink escapes are rejected',async t=>{
 const f=await projectFixture();t.after(()=>f.close());const outside=path.join(f.base,'outside');await mkdir(outside);
 const link=path.join(f.root,'projects','alpha','escape');await symlink(outside,link,'dir');
 for(const cwd of [outside,link,f.scratch])await assert.rejects(()=>f.supervisor.start({protocol:'pty',command:process.execPath,cwd}),{code:'AGENT_CWD_FORBIDDEN'});
 await assert.rejects(()=>f.supervisor.start({protocol:'pty',command:process.execPath,projectId:'unknown'}),{code:'AGENT_PROJECT_NOT_FOUND'});
});
test('SQLite authoring revision owns registration after import and a sole project is selected automatically',async t=>{
 const f=await projectFixture();t.after(()=>f.close());const store=openStore(f.home),config={...f.config,projects:[f.config.projects[1]]};
 try{store.saveDraft('fixture-spec',{expectedRevision:null,settings:{projects:[{id:'beta'}]},files:[{target:'spec',path:'workbench.yaml',content:JSON.stringify(config),baseHash:null}],operationId:'import-fixture',request:{import:true},result:{imported:true}});}finally{store.close();}
 assert.deepEqual((await registeredAgentWorkspaces(f.home)).workspaces.map(item=>item.projectId),['beta']);
 await assert.rejects(()=>f.supervisor.start({protocol:'pty',command:process.execPath,cwd:path.join(f.root,'projects','alpha')}),{code:'AGENT_CWD_FORBIDDEN'});
 const session=await f.supervisor.start({protocol:'pty',command:process.execPath,args:['-e','process.stdin.resume()']});
 assert.equal(session.cwd,path.join(f.root,'projects','beta'));await f.supervisor.stop(session.sessionId);
});
test('task capability remains narrower than project registration',async t=>{
 const f=await projectFixture();t.after(()=>f.close());const scoped=await createAgentSupervisor({home:f.home,defaultCwd:f.scratch,allowedRoots:[f.scratch]});
 try{assert.deepEqual(await scoped.workspaces(),[]);await assert.rejects(()=>scoped.start({protocol:'pty',command:process.execPath,cwd:path.join(f.root,'projects','alpha')}),{code:'AGENT_CWD_FORBIDDEN'});}finally{await scoped.close();}
});
test('a registered empty product directory is not an initialized workspace',async t=>{
 const f=await projectFixture();t.after(()=>f.close());const cwd=path.join(f.root,'projects','beta');
 await rename(cwd,path.join(f.base,'retained-beta'));await mkdir(cwd);
 assert.deepEqual((await f.supervisor.workspaces()).map(item=>item.projectId),['alpha']);
 await assert.rejects(()=>f.supervisor.start({protocol:'pty',command:process.execPath,projectId:'beta'}),{code:'AGENT_PROJECT_NOT_FOUND'});
});
test('real chat MCP child forwards registered cwd to the host and rejects outside paths',async t=>{
 const f=await projectFixture(),peer=path.join(f.base,'peer.mjs');await writeFile(peer,"console.log(process.cwd());process.stdin.resume();\n");
 const child=spawn(process.execPath,['scripts/mcp-agent-supervisor.mjs',f.home,'CHAT','room',f.scratch],{env:{...process.env,WB_AGENT_SUPERVISOR_COMMAND:process.execPath,WB_AGENT_SUPERVISOR_ARGS_JSON:JSON.stringify([peer])},stdio:['pipe','pipe','inherit']});
 const exited=new Promise(resolve=>child.once('exit',resolve));t.after(async()=>{child.stdin.end();await exited;await f.close();});
 const pending=new Map();let sequence=0;
 createInterface({input:child.stdout}).on('line',line=>{const reply=JSON.parse(line),entry=pending.get(reply.id);if(entry){clearTimeout(entry.timer);pending.delete(reply.id);entry.resolve(reply.result);}});
 const call=(name,args={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('MCP reply timeout'));},5000);pending.set(id,{resolve,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}})+'\n');});
 assert.equal((await call('agent_workspaces')).structuredContent.workspaces.length,2);
 const response=await call('agent_start',{protocol:'pty',repositoryId:'fixture-spec',projectId:'beta'});assert.equal(response.isError,undefined);
 const session=response.structuredContent;assert.equal(session.cwd,path.join(f.root,'projects','beta'));assert.equal(f.supervisor.session(session.sessionId).pid,session.pid);
 assert.equal((await call('agent_start',{protocol:'pty',cwd:f.base})).structuredContent.code,'AGENT_CWD_FORBIDDEN');await f.supervisor.stop(session.sessionId);
});
