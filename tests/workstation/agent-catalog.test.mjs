import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openStore} from '../../packages/workstation/store.mjs';
import {validateAgentSettings,validateAgentRuntimeSettings} from '../../packages/workstation/agent-settings.mjs';
import {previewAgentPrompt,approvedAgentPrompt,selectedAgent,selectedTaskSnapshot,writeAgentTask,taskRpc} from '../../packages/workstation/agent-task.mjs';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';

test('catalog migrates custom settings once, persists immutable versions and resolves ordered purpose-scoped skills',async()=>{
 const home=await mkdtemp(path.join(tmpdir(),'bdd-catalog-'));let store=openStore(home);
 try{
  store.register({id:'SPEC-catalog',title:'Catalog',remoteUrl:'https://github.com/example/spec'});
  const legacy=validateAgentSettings({gherkinPrompt:'Exact custom prompt',skills:'Exact custom skill'});store.ensureAgentDefaults('SPEC-catalog',legacy);store.ensureAgentDefaults('SPEC-catalog',validateAgentSettings());
  assert.equal(store.agentCatalog().agents.length,1);let selected=store.resolveAgent('SPEC-catalog','gherkin');assert.equal(selected.prompt.content,legacy.gherkinPrompt);assert.equal(selected.skills[0].content,legacy.skills);
  const skill=store.saveCatalogSkill({name:'Analysis',content:'Use references/data.txt',purposes:['gherkin'],resources:[{path:'references/data.txt',content:'Original resource'}]});
  const agent=store.saveCatalogAgent({name:'Generator',settings:validateAgentRuntimeSettings(),skillRevisionIds:[skill.revisions[0].id]});
  const prompt=store.saveCatalogPrompt({name:'Template',content:'Exact custom prompt',purposes:['gherkin','design']});
  const choice={agentRevisionId:agent.revisions[0].id,promptRevisionId:prompt.revisions[0].id,skillRevisionIds:[skill.revisions[0].id]};store.saveAgentDefault('SPEC-catalog',{purpose:'gherkin',...choice});selected=store.resolveAgent('SPEC-catalog','gherkin');
  assert.throws(()=>store.resolveAgent('SPEC-catalog','design',choice),{code:'SKILL_PURPOSE_MISMATCH'});
  const snapshot={revision:1,settings:{agent:legacy},files:[]},input={purpose:'gherkin',editorKey:'new-selection',description:'Requirement',previousGherkin:'',agentSnapshot:selected};
  const preview=previewAgentPrompt(snapshot,'SPEC-catalog',home,input),context={root:home,request:{repositoryId:'SPEC-catalog',input:{...input,...preview}}};
  store.saveCatalogSkill({id:skill.id,expectedRevision:skill.revisions[0].id,name:'Analysis',content:'Updated',purposes:['gherkin']});
  assert.throws(()=>store.resolveAgent('SPEC-catalog','gherkin',choice),{code:'CATALOG_CHANGED'});assert.equal(approvedAgentPrompt(snapshot,context,'gherkin'),preview.prompt);assert.deepEqual(selectedAgent(snapshot,context),selected.settings);
  const file=await writeAgentTask(path.join(home,'task'),selectedTaskSnapshot(snapshot,context),{purpose:'gherkin',workspace:home,source:{editorKey:'new-selection',description:'Requirement',previousGherkin:''}}),bundle=JSON.parse(await readFile(file,'utf8'));
  const result=taskRpc(bundle,{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'workbench_read_artifact',arguments:{path:`skills/${skill.id}/references/data.txt`}}});assert.equal(result.result.structuredContent.content,'Original resource');
  assert.throws(()=>store.saveCatalogSkill({name:'Unsafe',content:'x',resources:[{path:'../escape',content:'x'}]}),{code:'INVALID_SKILL_RESOURCE'});
  assert.throws(()=>store.saveCatalogSkill({id:skill.id,expectedRevision:skill.revisions[0].id,name:'Stale',content:'x'}),{code:'CATALOG_CHANGED'});
  store.close();store=openStore(home);assert.equal(store.agentCatalog().skills.find(s=>s.id===skill.id).revisions.length,2);assert.equal(store.agentCatalog().skills.find(s=>s.id===skill.id).revisions[1].resources[0].content,'Original resource');
 }finally{store.close();}
});

test('partial task defaults are completed without replacing a saved choice or duplicating seeds',async t=>{
 const home=await mkdtemp(path.join(tmpdir(),'bdd-catalog-partial-'));let store=openStore(home);
 t.after(async()=>{store.close();await rm(home,{recursive:true,force:true});});
 const repositoryId='SPEC-partial';store.register({id:repositoryId,title:'Partial',remoteUrl:'https://github.com/example/spec'});
 const agent=store.saveCatalogAgent({name:'User-selected Agent',settings:{command:'user-cli',args:['{task}','{prompt}']}});
 const prompt=store.saveCatalogPrompt({name:'User-selected Prompt',content:'Preserve this exact choice',purposes:['design']});
 const choice={purpose:'design',agentRevisionId:agent.revisions[0].id,promptRevisionId:prompt.revisions[0].id,skillRevisionIds:[]};
 store.saveAgentDefault(repositoryId,choice);
 const legacy=validateAgentSettings({gherkinPrompt:'Custom legacy Gherkin',skills:'Custom legacy skill'});
 store.ensureAgentDefaults(repositoryId,legacy);
 assert.deepEqual(store.agentDefaults(repositoryId).map(row=>row.purpose).sort(),['development','design','gherkin','testPlan'].sort());
 assert.deepEqual(store.agentDefaults(repositoryId).find(row=>row.purpose==='design'),choice);
 assert.equal(store.resolveAgent(repositoryId,'gherkin').prompt.content,legacy.gherkinPrompt);
 for(const purpose of ['gherkin','testPlan','development'])assert.equal(store.resolveAgent(repositoryId,purpose).skills[0].content,legacy.skills);
 const complete=store.agentCatalog(),defaults=store.agentDefaults(repositoryId);
 store.ensureAgentDefaults(repositoryId,validateAgentSettings());
 assert.deepEqual(store.agentCatalog(),complete);assert.deepEqual(store.agentDefaults(repositoryId),defaults);
 store.close();store=openStore(home);store.ensureAgentDefaults(repositoryId,validateAgentSettings());
 assert.deepEqual(store.agentCatalog(),complete);assert.deepEqual(store.agentDefaults(repositoryId),defaults);
});

test('repairing missing defaults reuses the original seed profiles and revision references',async t=>{
 const home=await mkdtemp(path.join(tmpdir(),'bdd-catalog-repair-')),store=openStore(home);
 t.after(async()=>{store.close();await rm(home,{recursive:true,force:true});});
 const repositoryId='SPEC-repair',legacy=validateAgentSettings({skills:'Keep this exact imported skill',designPrompt:'Keep this exact design Prompt'});
 store.register({id:repositoryId,title:'Repair',remoteUrl:'https://github.com/example/spec'});store.ensureAgentDefaults(repositoryId,legacy);
 const catalog=store.agentCatalog(),defaults=store.agentDefaults(repositoryId);
 assert.deepEqual([catalog.agents.length,catalog.skills.length,catalog.prompts.length,defaults.length],[1,1,4,4]);
 for(const purposes of [['design'],['gherkin','design','testPlan','development']]){
  const db=new DatabaseSync(path.join(home,'metadata.sqlite'));
  try{for(const purpose of purposes)db.prepare('DELETE FROM agent_task_defaults WHERE repository_id=? AND purpose=?').run(repositoryId,purpose);}finally{db.close();}
  store.ensureAgentDefaults(repositoryId,legacy);
  assert.deepEqual(store.agentCatalog(),catalog);
  assert.deepEqual(store.agentDefaults(repositoryId),defaults);
  for(const purpose of purposes)assert.equal(store.resolveAgent(repositoryId,purpose).agentRevisionId,catalog.agents[0].revisions[0].id);
 }
});

test('default repair preserves custom revisions and does not revive archived seed profiles',async t=>{
 const home=await mkdtemp(path.join(tmpdir(),'bdd-catalog-repair-custom-')),store=openStore(home);
 t.after(async()=>{store.close();await rm(home,{recursive:true,force:true});});
 const repositoryId='SPEC-custom-repair',legacy=validateAgentSettings({skills:'Original imported skill'});
 store.register({id:repositoryId,title:'Custom repair',remoteUrl:'https://github.com/example/spec'});store.ensureAgentDefaults(repositoryId,legacy);
 const initial=store.agentCatalog(),agent=initial.agents[0],skill=initial.skills[0],prompt=initial.prompts.find(item=>item.revisions[0].purposes.includes('design'));
 const changedSkill=store.saveCatalogSkill({id:skill.id,expectedRevision:skill.revisions[0].id,name:skill.name,description:skill.description,content:legacy.skills,resources:[{path:'custom.txt',content:'Keep this custom resource'}]});
 const changedAgent=store.saveCatalogAgent({id:agent.id,expectedRevision:agent.revisions[0].id,name:agent.name,description:agent.description,settings:{...agent.revisions[0].settings,command:'custom-cli'},skillRevisionIds:[changedSkill.revisions[0].id]});
 const archivedPrompt=store.saveCatalogPrompt({id:prompt.id,expectedRevision:prompt.revisions[0].id,name:prompt.name,description:prompt.description,content:prompt.revisions[0].content,purposes:['design'],archived:true});
 const preserved=store.agentDefaults(repositoryId).filter(row=>row.purpose!=='design'),db=new DatabaseSync(path.join(home,'metadata.sqlite'));
 try{db.prepare('DELETE FROM agent_task_defaults WHERE repository_id=? AND purpose=?').run(repositoryId,'design');}finally{db.close();}
 store.ensureAgentDefaults(repositoryId,legacy);
 const repaired=store.resolveAgent(repositoryId,'design'),catalog=store.agentCatalog();
 assert.notEqual(repaired.agentId,agent.id);assert.notEqual(repaired.skills[0].id,skill.id);assert.notEqual(repaired.prompt.id,prompt.id);
 assert.equal(repaired.settings.command,legacy.command);assert.equal(repaired.skills[0].content,legacy.skills);assert.deepEqual(repaired.skills[0].resources,[]);
 assert.deepEqual(catalog.agents.find(item=>item.id===agent.id),changedAgent);assert.deepEqual(catalog.skills.find(item=>item.id===skill.id),changedSkill);assert.deepEqual(catalog.prompts.find(item=>item.id===prompt.id),archivedPrompt);
 assert.deepEqual(store.agentDefaults(repositoryId).filter(row=>row.purpose!=='design'),preserved);
 store.ensureAgentDefaults(repositoryId,legacy);assert.deepEqual(store.agentCatalog(),catalog);
});
