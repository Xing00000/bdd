import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {openStore} from '../../packages/workstation/store.mjs';
import {validateAgentSettings,validateAgentRuntimeSettings,agentPromptFields} from '../../packages/workstation/agent-settings.mjs';
import {previewAgentPrompt,approvedAgentPrompt} from '../../packages/workstation/agent-task.mjs';

test('schema 11 migration splits Prompt versions without changing historical rows or frozen requests',async()=>{
 const home=await mkdtemp(path.join(tmpdir(),'bdd-prompt-migration-')),file=path.join(home,'metadata.sqlite');let store=openStore(home);
 store.register({id:'SPEC-migration',title:'Migration',remoteUrl:'https://github.com/example/spec'});
 const settings=validateAgentSettings({gherkinPrompt:'Exact original {featureId}\nKeep whitespace.\n'}),agentId=randomUUID(),revisionId=randomUUID(),historical={schemaVersion:1,operationId:'OP-historical',repositoryId:'SPEC-migration',operation:'workflow.gherkin.generate',input:{prompt:'Already accepted',agentSnapshot:{settings}}};
 store.enqueue(historical);store.close();
 const db=new DatabaseSync(file);db.exec('PRAGMA foreign_keys=ON; ALTER TABLE agent_task_defaults DROP COLUMN prompt_revision_id; DROP TABLE prompt_migrations; DROP TABLE prompt_revisions; DROP TABLE prompts;');db.prepare('INSERT INTO agent_profiles VALUES(?,?,?,?)').run(agentId,'Original Agent','Existing custom settings',0);const original=JSON.stringify(settings);db.prepare('INSERT INTO agent_revisions VALUES(?,?,?,?,?)').run(revisionId,agentId,1,original,new Date().toISOString());
 for(const purpose of Object.keys(agentPromptFields))db.prepare('INSERT INTO agent_task_defaults(repository_id,purpose,agent_revision_id,skills_json) VALUES(?,?,?,?)').run('SPEC-migration',purpose,revisionId,'[]');
 const frozen=db.prepare('SELECT request_json FROM operations WHERE id=?').get('OP-historical').request_json;db.exec('PRAGMA user_version=11');db.close();
 store=openStore(home);
 try{
  const catalog=store.agentCatalog(),latest=catalog.agents[0].revisions[0];assert.equal(catalog.prompts.length,4);assert.deepEqual(latest.settings,validateAgentRuntimeSettings(settings));assert.equal(catalog.agents[0].revisions[1].settings.gherkinPrompt,settings.gherkinPrompt);
  const resolved=store.resolveAgent('SPEC-migration','gherkin');assert.equal(resolved.prompt.content,settings.gherkinPrompt);assert.equal(resolved.agentRevisionId,latest.id);
  const verify=new DatabaseSync(file,{readOnly:true});try{assert.equal(verify.prepare('SELECT settings_json FROM agent_revisions WHERE id=?').get(revisionId).settings_json,original);assert.equal(verify.prepare('SELECT request_json FROM operations WHERE id=?').get('OP-historical').request_json,frozen);}finally{verify.close();}
  assert((await readFile(path.join(home,'before-prompt-catalog-v12.sqlite'))).length>0);
 }finally{store.close();}
 store=openStore(home);try{assert.equal(store.agentCatalog().prompts.length,4);assert.equal(store.agentCatalog().agents[0].revisions.length,2);}finally{store.close();}
});

test('one Prompt is reusable across Agents; edits and archive invalidate new dispatches, not frozen work',async()=>{
 const home=await mkdtemp(path.join(tmpdir(),'bdd-prompt-version-')),store=openStore(home);
 try{
  store.register({id:'SPEC-prompts',title:'Prompts',remoteUrl:'https://github.com/example/spec'});
  const first=store.saveCatalogAgent({name:'First',settings:validateAgentRuntimeSettings()}),second=store.saveCatalogAgent({name:'Second',settings:validateAgentRuntimeSettings({timeoutMs:1000})}),prompt=store.saveCatalogPrompt({name:'Reusable',content:'Generate {featureId}',purposes:['gherkin']});
  const selection={agentRevisionId:first.revisions[0].id,promptRevisionId:prompt.revisions[0].id,skillRevisionIds:[]},chosen=store.resolveAgent('SPEC-prompts','gherkin',selection),other=store.resolveAgent('SPEC-prompts','gherkin',{...selection,agentRevisionId:second.revisions[0].id});assert.equal(chosen.prompt.revisionId,other.prompt.revisionId);
  assert.throws(()=>store.saveCatalogAgent({name:'Coupled',settings:validateAgentSettings()}),{code:'AGENT_PROMPT_SEPARATE'});assert.throws(()=>store.resolveAgent('SPEC-prompts','design',selection),{code:'PROMPT_PURPOSE_MISMATCH'});assert.throws(()=>store.resolveAgent('SPEC-prompts','gherkin',{agentRevisionId:first.revisions[0].id}),{code:'PROMPT_SELECTION_REQUIRED'});
  const source={revision:1,settings:{agent:validateAgentSettings()},files:[]},input={purpose:'gherkin',editorKey:'new-prompt',description:'Requirement',featureId:'name',agentSnapshot:chosen},preview=previewAgentPrompt(source,'SPEC-prompts',home,input),context={root:home,request:{repositoryId:'SPEC-prompts',input:{...input,...preview}}};
  const updated=store.saveCatalogPrompt({id:prompt.id,expectedRevision:prompt.revisions[0].id,name:prompt.name,content:'Changed {featureId}',purposes:['gherkin']});assert.throws(()=>store.resolveAgent('SPEC-prompts','gherkin',selection),{code:'CATALOG_CHANGED'});assert.equal(approvedAgentPrompt(source,context,'gherkin'),'Generate name');assert.equal(store.agentCatalog().agents[0].revisions.length,1);
  assert.throws(()=>store.saveCatalogPrompt({id:prompt.id,expectedRevision:prompt.revisions[0].id,name:'Stale',content:'Stale'}),{code:'CATALOG_CHANGED'});
  const archived=store.saveCatalogPrompt({id:prompt.id,expectedRevision:updated.revisions[0].id,name:prompt.name,content:updated.revisions[0].content,purposes:['gherkin'],archived:true});assert.throws(()=>store.resolveAgent('SPEC-prompts','gherkin',{...selection,promptRevisionId:archived.revisions[0].id}),{code:'CATALOG_CHANGED'});
 }finally{store.close();}
});

test('schema 11 migration fills absent Prompt fields while preserving the exact historical settings',async t=>{
 const home=await mkdtemp(path.join(tmpdir(),'bdd-prompt-partial-')),file=path.join(home,'metadata.sqlite');let store=openStore(home);
 t.after(async()=>{store?.close();await rm(home,{recursive:true,force:true});});
 const repositoryId='SPEC-partial-migration';store.register({id:repositoryId,title:'Partial migration',remoteUrl:'https://github.com/example/spec'});store.close();store=null;
 const settings={command:'legacy-cli',args:['{task}','{prompt}'],gherkinPrompt:'  Exact custom Gherkin {featureId}\n'},agentId=randomUUID(),revisionId=randomUUID(),original=JSON.stringify(settings);
 const db=new DatabaseSync(file);
 try{
  db.exec('PRAGMA foreign_keys=ON; ALTER TABLE agent_task_defaults DROP COLUMN prompt_revision_id; DROP TABLE prompt_migrations; DROP TABLE prompt_revisions; DROP TABLE prompts;');
  db.prepare('INSERT INTO agent_profiles VALUES(?,?,?,?)').run(agentId,'Legacy Agent','Partial legacy settings',0);
  db.prepare('INSERT INTO agent_revisions VALUES(?,?,?,?,?)').run(revisionId,agentId,1,original,new Date().toISOString());
  for(const purpose of Object.keys(agentPromptFields))db.prepare('INSERT INTO agent_task_defaults(repository_id,purpose,agent_revision_id,skills_json) VALUES(?,?,?,?)').run(repositoryId,purpose,revisionId,'[]');
  db.exec('PRAGMA user_version=11');
 }finally{db.close();}
 store=openStore(home);
 const defaults=validateAgentSettings();
 for(const [purpose,field] of Object.entries(agentPromptFields))assert.equal(store.resolveAgent(repositoryId,purpose).prompt.content,settings[field]??defaults[field]);
 const verify=new DatabaseSync(file,{readOnly:true});
 try{assert.equal(verify.prepare('SELECT settings_json FROM agent_revisions WHERE id=?').get(revisionId).settings_json,original);assert.deepEqual(verify.prepare('PRAGMA foreign_key_check').all(),[]);}finally{verify.close();}
 const catalog=store.agentCatalog();assert.equal(catalog.prompts.length,4);assert.equal(catalog.agents[0].revisions.length,2);
 store.close();store=openStore(home);assert.deepEqual(store.agentCatalog(),catalog);
});
