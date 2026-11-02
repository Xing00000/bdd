import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createServer} from '../../src/http/server.ts';

test('compatibility requirement API preserves sibling selection, workspace links and renamed requirements across reload',async t=>{
 const root=resolve(process.cwd());await mkdir(join(root,'.test-fixtures'),{recursive:true});const directory=await mkdtemp(join(root,'.test-fixtures/requirement-navigation-')),workspace=join(directory,'workspace');await mkdir(workspace);
 const options={root,metadataFile:join(directory,'metadata.sqlite'),dataRoot:join(directory,'data'),baseUrl:'http://127.0.0.1:1'};let server=await createServer(options);
 t.after(async()=>{await server.app.close();await rm(directory,{recursive:true,force:true});});
 const request=async(method:'GET'|'POST'|'PUT',url:string,payload?:any,status=200)=>{const r=await server.app.inject({method,url,payload});assert.equal(r.statusCode,status,r.body);return r.json();};
 const project=await request('POST','/projects',{name:'Navigation workspace',workspaceRef:workspace},201);
 const requirement=await request('POST','/requirements',{requirementKey:'REQ-NAV',projectIds:[project.id]},201);
 const sibling=await request('POST',`/requirements/${requirement.id}/features`,{featureKey:'checkout'},201);
 const renamed=await request('PUT',`/requirements/${requirement.id}`,{requirementKey:'REQ-NAV-RENAMED',projectIds:[project.id]});assert.equal(renamed.requirementKey,'REQ-NAV-RENAMED');
 for(const id of [requirement.featureId,sibling.featureId]){const selected=await request('GET',`/requirements/${requirement.id}?featureId=${id}`);assert.equal(selected.featureId,id);assert.equal(selected.stage,'GHERKIN');assert.equal(selected.projects[0].id,project.id);assert.equal(selected.features.length,2);}
 const before=await request('GET',`/requirements/${requirement.id}?featureId=${sibling.featureId}`);
 await server.app.close();server=await createServer(options);const restored=await request('GET',`/requirements/${requirement.id}?featureId=${sibling.featureId}`);assert.deepEqual(restored,before);
 const other=await request('POST','/requirements',{requirementKey:'REQ-OTHER',projectIds:[project.id]},201);assert.notEqual(other.id,requirement.id);assert.equal((await request('GET','/requirements')).length,2);
 const rejected=await request('GET',`/requirements/${requirement.id}`,undefined,400);assert.equal(rejected.code,'FEATURE_REQUIRED');
});

test('compatibility terminal API opens a real PTY in the selected local project directory',async t=>{
 const root=resolve(process.cwd());await mkdir(join(root,'.test-fixtures'),{recursive:true});const directory=await mkdtemp(join(root,'.test-fixtures/requirement-terminal-')),workspace=await mkdtemp(join(directory,'workspace-'));
 const server=await createServer({root,metadataFile:join(directory,'metadata.sqlite'),dataRoot:join(directory,'data'),baseUrl:'http://127.0.0.1:1'});t.after(async()=>{await server.app.close();await rm(directory,{recursive:true,force:true});});
 const project=await server.core.createProject({name:'Terminal workspace',workspaceRef:workspace});const response=await server.app.inject({method:'POST',url:'/terminals',payload:{projectId:project.id,sessionKey:'workspace-terminal'}});assert.equal(response.statusCode,201,response.body);const session=response.json();assert.equal(session.workspaceRef,workspace);
 let output='';await new Promise<void>((resolvePromise,reject)=>{const timer=setTimeout(()=>{unsubscribe();reject(Error('PTY did not report its actual workspace'));},10000);const unsubscribe=server.runtime.terminal.subscribe(session.id,event=>{output+=event.data??'';if(output.includes(workspace)){clearTimeout(timer);unsubscribe();resolvePromise();}});server.runtime.terminal.input(session.id,'pwd\r');});
 assert.match(output,new RegExp(workspace.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));assert.equal((await server.core.store.all('SELECT id FROM terminal_sessions WHERE project_id=?',[project.id]))[0].id,session.id);
 const closed=await server.app.inject({method:'DELETE',url:'/terminals/'+session.id});assert.equal(closed.statusCode,200);
});

test('default example API supports user deletion, preserves history and stays deleted after application restart',async t=>{
 const root=resolve(process.cwd());await mkdir(join(root,'.test-fixtures'),{recursive:true});const directory=await mkdtemp(join(root,'.test-fixtures/default-example-'));
 const options={root,metadataFile:join(directory,'metadata.sqlite'),dataRoot:join(directory,'data'),baseUrl:'http://127.0.0.1:1',initializeDefaultExample:true};
 let server=await createServer(options);let serverClosed=false;
 t.after(async()=>{if(!serverClosed)await server.app.close();await rm(directory,{recursive:true,force:true});});
 const list=await server.app.inject({method:'GET',url:'/requirements'});assert.equal(list.statusCode,200);const example=list.json().find((r:any)=>r.requirementKey==='REQ-SAMPLE-001');assert.ok(example);
 const deleted=await server.app.inject({method:'DELETE',url:'/requirements/'+example.id});assert.equal(deleted.statusCode,200,deleted.body);assert.deepEqual(await server.core.listRequirements(),[]);
 const tombstone=await server.core.store.all('SELECT deleted_at FROM requirements WHERE is_default_example=1');assert.equal(tombstone.length,1);assert.ok(tombstone[0].deleted_at);
 const preserved=await server.core.store.all("SELECT count(*) AS count FROM document_versions v JOIN documents d ON d.id=v.document_id JOIN requirements r ON r.id=d.requirement_id WHERE r.is_default_example=1");assert.equal(Number(preserved[0].count),1);
 await server.app.close();serverClosed=true;
 server=await createServer(options);serverClosed=false;assert.deepEqual(await server.core.listRequirements(),[]);
});
