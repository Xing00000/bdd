import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { seedAgentSettings, validateAgentSettings, renderAgentPrompt } from '../../packages/workstation/agent-settings.mjs';
import { ensureDraft, editDraft } from '../../packages/workstation/authoring.mjs';
import { openStore } from '../../packages/workstation/store.mjs';
import { fixture, toolkitRoot } from './helpers.mjs';

test('editable seed pins the model without injecting a general-purpose skill manual',async()=>{
  const seed=validateAgentSettings();
  assert.deepEqual(seed.args,['exec','--model','gpt-6.1-sol','--sandbox','workspace-write','{mcp}','{prompt}']);
  assert.equal(seed.skills,'');
  assert.equal(seed.maxAttempts,3);assert.equal(seed.timeoutMs,900000);
});

test('legacy values and explicit empty skills survive seeding and partial setting updates',()=>{
  const legacy={command:'custom',args:['{prompt}'],maxAttempts:2,timeoutMs:60000};
  const merged=seedAgentSettings(legacy);
  for(const key of Object.keys(legacy))assert.deepEqual(merged[key],legacy[key]);
  assert.ok(merged.prompt.includes('{requirementId}'));
  const custom={...merged,prompt:'custom {spec}',skills:''};
  assert.deepEqual(seedAgentSettings(custom),custom);
  assert.deepEqual(validateAgentSettings({command:'other'},custom),{...custom,command:'other'});
  merged.args.push('changed');assert.ok(!seedAgentSettings().args.includes('changed'));
});

test('prompt and skills enforce text, template names and UTF-8 byte limits',()=>{
  for(const input of [{prompt:''},{prompt:' \n'},{prompt:null},{prompt:'bad {unknown_setting_token}'},
    {prompt:'中'.repeat(21846)},{skills:42},{skills:'中'.repeat(87382)}]){
    assert.throws(()=>validateAgentSettings(input),{code:'INVALID_AGENT'});
  }
  assert.equal(validateAgentSettings({prompt:'x'.repeat(65536),skills:'x'.repeat(262144)}).skills.length,262144);
  assert.throws(()=>validateAgentSettings({prompt:'bad {unknown_setting_token}'}),/unknown_setting_token/);
});

test('effective prompt substitutes once and appends literal skills without interpreting input',()=>{
  const values={requirementId:'REQ-X',featureId:'login',spec:'/tmp/a b',projects:'/tmp/product',feedback:'literal {spec} $(echo bad)',previousFailure:'retry'};
  const settings={prompt:'{requirementId}/{featureId}: {spec}; {projects}; {feedback}; {previousFailure}',skills:'skill {unknown}'};
  assert.ok(renderAgentPrompt(settings,values).endsWith('REQ-X/login: /tmp/a b; /tmp/product; literal {spec} $(echo bad); retry\n\nskill {unknown}'));
  assert.equal(renderAgentPrompt({prompt:'{feedback}',skills:''},values),values.feedback);
  assert.throws(()=>renderAgentPrompt({prompt:'{spec}'},{}),{code:'INVALID_AGENT'});
});

test('both dispatch stages carry only the selected approved feature and stage contract',async()=>{
  const legacy=await readFile(new URL('../../skills/playwright-bdd/SKILL.md',import.meta.url),'utf8');
  assert.equal(seedAgentSettings({skills:legacy}).skills,'');
  assert.equal(seedAgentSettings({skills:'Custom project instructions'}).skills,'Custom project instructions');
  const values={requirementId:'REQ-X',featureId:'login',spec:'/spec-repo',projects:'/product',feedback:'',previousFailure:''};
  for(const purpose of ['development','testPlan']) {
    const prompt=renderAgentPrompt({skills:legacy},values,purpose);
    assert.ok(prompt.includes('REQ-X/login'));
    assert.ok(prompt.includes('workbench_get_task'));
    assert.ok(prompt.includes('workbench_read_artifact'));
    assert.ok(prompt.length<250);
    assert.ok(!prompt.includes('/spec-repo'));
    assert.ok(!prompt.includes('Phase 1'));
  }
});

test('persisted factory skill retirement changes settings once and preserves sources and custom CLI configuration',async t=>{
  const f=await fixture(t);const {mkdir}=await import('node:fs/promises');await mkdir(f.home,{recursive:true});
  const store=openStore(f.home);t.after(()=>store.close());
  const repositoryId='SPEC-context';store.register({id:repositoryId,title:'Context',remoteUrl:f.remote});
  const context={root:f.repo,options:{toolkitRoot,allowLocal:true},store,repositoryId};
  const initial=await ensureDraft(context),legacy=await readFile(new URL('../../skills/playwright-bdd/SKILL.md',import.meta.url),'utf8');
  const agent={...initial.settings.agent,command:'custom-cli',args:['custom-mode','{prompt}'],prompt:'Custom task {spec}',skills:legacy};
  store.saveDraft(repositoryId,{expectedRevision:initial.revision,settings:{...initial.settings,agent},files:[],operationId:'seed-factory-context',request:{fixture:'factory-context'}});
  const before=store.draft(repositoryId),migrated=await ensureDraft(context);
  assert.equal(migrated.revision,before.revision+1);
  assert.deepEqual(migrated.settings.agent,{...agent,skills:''});assert.deepEqual(migrated.files,before.files);
  assert.equal((await ensureDraft(context)).revision,migrated.revision);
});

test('SQLite seeds missing legacy fields once, preserves custom settings, and rejects saves atomically',async t=>{
  const f=await fixture(t);
  const { mkdir }=await import('node:fs/promises');await mkdir(f.home,{recursive:true});
  const store=openStore(f.home);t.after(()=>store.close());
  const repositoryId='SPEC-agent';store.register({id:repositoryId,title:'Agent',remoteUrl:f.remote});
  const options={toolkitRoot,allowLocal:true};
  const context={root:f.repo,options,store,repositoryId};
  await ensureDraft(context);
  const initial=store.draft(repositoryId),legacy={command:'legacy-cli',args:['{prompt}'],maxAttempts:2,timeoutMs:60000};
  const {agent:omitted,...withoutAgent}=initial.settings;
  store.saveDraft(repositoryId,{expectedRevision:initial.revision,settings:withoutAgent,files:[],operationId:'pre-agent',request:{}});
  const preAgent=await ensureDraft(context);
  assert.deepEqual(preAgent.settings.agent,validateAgentSettings());
  assert.equal((await ensureDraft(context)).revision,preAgent.revision);
  store.saveDraft(repositoryId,{expectedRevision:preAgent.revision,settings:{...initial.settings,agent:legacy},files:[],operationId:'legacy',request:{}});
  const migrated=await ensureDraft(context);
  for(const key of Object.keys(legacy))assert.deepEqual(migrated.settings.agent[key],legacy[key]);
  assert.equal((await ensureDraft(context)).revision,migrated.revision);
  const save=agent=>editDraft({...context,request:{operation:'repository.setup',operationId:crypto.randomUUID(),repositoryId,input:{reviewer:'Reviewer',projects:[],...(agent===undefined?{}:{agent})}}});
  await save({prompt:'persist {spec}',skills:'',maxAttempts:1});
  const saved=store.draft(repositoryId);
  await assert.rejects(()=>save({prompt:'bad {unknown}'}),{code:'INVALID_AGENT'});
  assert.deepEqual(store.draft(repositoryId),saved);
  await save();
  assert.deepEqual((await ensureDraft(context)).settings.agent,saved.settings.agent);
  assert.equal(saved.settings.agent.command,'legacy-cli');
  assert.equal(saved.settings.agent.prompt,'persist {spec}');assert.equal(saved.settings.agent.skills,'');
});
