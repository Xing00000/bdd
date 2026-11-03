import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openStore} from '../../packages/workstation/store.mjs';
import {validateAgentSettings,validateAgentRuntimeSettings} from '../../packages/workstation/agent-settings.mjs';
import {previewAgentPrompt,approvedAgentPrompt,selectedAgent,selectedTaskSnapshot,writeAgentTask,taskRpc} from '../../packages/workstation/agent-task.mjs';
import {readFile} from 'node:fs/promises';

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
