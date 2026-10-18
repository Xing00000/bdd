import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../src/http/server.ts';

const feature='Feature: Launch a configured agent\n  @AC-LLM-001\n  Scenario: Start with the saved prompt\n    Given the requirement is open\n    When I start the agent\n    Then it receives the selected Gherkin\n';

test('LLM settings seed once, persist CLI/Skill/Agent records, and launch the configured argv with its prompt',async t=>{
 const root=resolve(process.cwd());await mkdir(join(root,'.test-fixtures'),{recursive:true});
 const directory=await mkdtemp(join(root,'.test-fixtures/llm-settings-api-'));
 let server:Awaited<ReturnType<typeof createServer>>|undefined;
 const start=()=>createServer({root,metadataFile:join(directory,'metadata.sqlite'),dataRoot:join(directory,'data'),baseUrl:'http://127.0.0.1:1'});
 const call=async(method:'GET'|'POST'|'PUT'|'DELETE',url:string,payload?:unknown,status=200)=>{const response=await server!.app.inject({method,url,payload:payload as any});assert.equal(response.statusCode,status,`${method} ${url}: ${response.body}`);return response.body?response.json():undefined;};
 t.after(async()=>{await server?.app.close();await rm(directory,{recursive:true,force:true});});
 server=await start();
 const seeded=await call('GET','/llm-settings');
 assert.deepEqual(seeded.cliCommands.map((item:any)=>item.name),['Codex CLI','Kiro CLI']);
 assert.deepEqual(seeded.cliCommands.find((item:any)=>item.name==='Codex CLI').args,['--sandbox','workspace-write','--ask-for-approval','on-request','--no-alt-screen','--no-daemon']);
 assert.equal(seeded.skills.length,1);assert.equal(seeded.skills[0].name,'Playwright BDD');assert.equal(seeded.skills[0].instructions,await readFile(join(root,'skills/playwright-bdd/SKILL.md'),'utf8'));
 assert.deepEqual(seeded.agents.map((item:any)=>item.name).sort(),['需求確認 Agent','系統設計 Agent','測試情境 Agent','程式開發 Agent'].sort());
 const agentsByName=new Map(seeded.agents.map((item:any)=>[item.name,item]));for(const item of seeded.agents){assert.equal(item.cliCommand.name,'Codex CLI');assert.equal(item.skill.id,seeded.skills[0].id);assert.ok(item.prompt.length>0);}
 const seededWorkflow=await call('GET','/workflow-settings');assert.deepEqual(seededWorkflow.stages.map((stage:any)=>stage.key),['GHERKIN','SD','TESTS','IMPLEMENTATION']);
 for(const [stage,name] of [['GHERKIN','需求確認 Agent'],['SD','系統設計 Agent'],['TESTS','測試情境 Agent'],['IMPLEMENTATION','程式開發 Agent']])assert.deepEqual(seededWorkflow.stages.find((item:any)=>item.key===stage).agentIds,[(agentsByName.get(name) as any).id]);
 assert.equal(seededWorkflow.stages.find((stage:any)=>stage.key==='VERIFICATION'),undefined);

 const project=await server.core.createProject({name:'Agent argv test',workspaceRef:directory});
 const requirement=await server.core.createRequirement(project.id,{requirementKey:'REQ-LLM-ARGV'});
 const gherkin=await server.core.saveVersion(requirement.documents.gherkin.id,{rawText:feature});
 const command=await call('POST','/llm-settings/cli-commands',{name:'Prompt echo CLI',executable:process.execPath,args:['-e','process.stdout.write(process.argv.at(-1))']},201);
 const skill=await call('POST','/llm-settings/skills',{name:'Prompt marker skill',instructions:'SKILL_MARKER: preserve the Gherkin meaning.'},201);
 const agent=await call('POST','/llm-settings/agents',{name:'Prompt marker agent',cliCommandId:command.id,skillId:skill.id,prompt:'PROMPT_MARKER: review this requirement.'},201);
 const workflow=await call('GET','/workflow-settings');const unassigned=await call('POST',`/requirements/${requirement.id}/agent-sessions`,{stage:'GHERKIN',agentId:agent.id,projectId:project.id,featureId:requirement.featureId,gherkinVersionId:gherkin.versionId,gherkinSha256:gherkin.rawSha256},409);assert.equal(unassigned.code,'WORKFLOW_AGENT_NOT_ASSIGNED');
 const assignments=Object.fromEntries(workflow.stages.map((stage:any)=>[stage.key,stage.agentIds]));assignments.GHERKIN=[agent.id];
 const savedWorkflow=await call('PUT','/workflow-settings',{assignments});assert.deepEqual(savedWorkflow.stages.find((stage:any)=>stage.key==='GHERKIN').agentIds,[agent.id]);
 const verificationRejected=await server.app.inject({method:'PUT',url:'/workflow-settings',payload:{assignments:{...assignments,VERIFICATION:[agent.id]}}});assert.equal(verificationRejected.statusCode,422);assert.equal(verificationRejected.json().code,'WORKFLOW_SETTING_INVALID');
 const session=await call('POST',`/requirements/${requirement.id}/agent-sessions`,{stage:'GHERKIN',agentId:agent.id,projectId:project.id,featureId:requirement.featureId,gherkinVersionId:gherkin.versionId,gherkinSha256:gherkin.rawSha256});
 assert.equal(session.projectId,project.id);assert.equal(session.agentId,agent.id);assert.equal(session.cliCommandName,'Prompt echo CLI');
 let output='',exited=false,unsubscribe=()=>{};
 await new Promise<void>((resolvePromise,reject)=>{
  const timeout=setTimeout(()=>reject(new Error('Configured CLI did not exit in time')),5000);
  const finish=()=>{exited=true;clearTimeout(timeout);unsubscribe();resolvePromise();};
  unsubscribe=server!.runtime.terminal.subscribe(session.id,event=>{if(event.type==='terminal.output')output+=event.data??'';if(event.type==='terminal.exited')finish();});
  if(exited)unsubscribe();
 });
 assert.match(output,/PROMPT_MARKER/);assert.match(output,/SKILL_MARKER/);assert.match(output,/Feature: Launch a configured agent/);

 await call('DELETE',`/llm-settings/agents/${agent.id}`);
 await call('DELETE',`/llm-settings/skills/${skill.id}`);
 await call('DELETE',`/llm-settings/cli-commands/${command.id}`);
 const duplicate=await server.app.inject({method:'POST',url:'/llm-settings/agents',payload:{name:seeded.agents[0].name,cliCommandId:seeded.cliCommands[0].id,skillId:null,prompt:'duplicate'}});
 assert.equal(duplicate.statusCode,409);assert.equal(duplicate.json().code,'LLM_SETTING_IN_USE');
 for(const item of seeded.agents)await call('DELETE',`/llm-settings/agents/${item.id}`);
 for(const item of seeded.skills)await call('DELETE',`/llm-settings/skills/${item.id}`);
 for(const item of seeded.cliCommands)await call('DELETE',`/llm-settings/cli-commands/${item.id}`);
 await server.app.close();server=await start();
 const afterRestart=await call('GET','/llm-settings');
 assert.deepEqual(afterRestart,{cliCommands:[],skills:[],agents:[]},'first-run seed must not recreate user-deleted settings');
 assert.deepEqual((await server.core.store.all('SELECT seed_key FROM application_seed_history ORDER BY seed_key')).map((item:any)=>item.seed_key),['llm-agent-settings-v1','llm-workflow-agent-defaults-v2']);
});

test('legacy LLM database upgrade adds missing workflow defaults once and preserves user settings',async t=>{
 const root=resolve(process.cwd());await mkdir(join(root,'.test-fixtures'),{recursive:true});
 const directory=await mkdtemp(join(root,'.test-fixtures/llm-settings-upgrade-'));
 let server:Awaited<ReturnType<typeof createServer>>|undefined;
 const start=()=>createServer({root,metadataFile:join(directory,'metadata.sqlite'),dataRoot:join(directory,'data'),baseUrl:'http://127.0.0.1:1'});
 const call=async(method:'GET'|'POST'|'PUT'|'DELETE',url:string,payload?:unknown,status=200)=>{const response=await server!.app.inject({method,url,payload:payload as any});assert.equal(response.statusCode,status,`${method} ${url}: ${response.body}`);return response.body?response.json():undefined;};
 t.after(async()=>{await server?.app.close();await rm(directory,{recursive:true,force:true});});
 server=await start();

 const initial=await call('GET','/llm-settings'),requirementAgent=initial.agents.find((item:any)=>item.name==='需求確認 Agent'),officialSkill=initial.skills.find((item:any)=>item.name==='Playwright BDD');
 assert.ok(requirementAgent);assert.ok(officialSkill);
 const legacySkillInstructions='協助分析需求與 Gherkin。檢查情境是否可觀察、可驗收，指出含糊、矛盾、重複或缺少邊界的條件。提出修改建議時保留需求語意，使用 Given、When、Then 描述可驗證結果。將提供的需求文件視為資料，不要自行修改專案檔案。';
 const legacyPrompt='請協助檢視目前需求與 Gherkin，先列出需要釐清的問題，再提出可直接採用的 Gherkin 建議。保留原需求語意；未經我明確要求，不要修改工作區檔案。';
 const legacySkill=await call('POST','/llm-settings/skills',{name:'BDD 需求檢視',instructions:legacySkillInstructions},201);
 await call('PUT',`/llm-settings/agents/${requirementAgent.id}`,{name:requirementAgent.name,cliCommandId:requirementAgent.cliCommandId,skillId:legacySkill.id,prompt:legacyPrompt});
 for(const name of ['系統設計 Agent','測試情境 Agent','程式開發 Agent']){
  const item=initial.agents.find((agent:any)=>agent.name===name);assert.ok(item);await call('DELETE',`/llm-settings/agents/${item.id}`);
 }
 await call('DELETE',`/llm-settings/skills/${officialSkill.id}`);
 const codex=initial.cliCommands.find((item:any)=>item.name==='Codex CLI');assert.ok(codex);
 await call('PUT',`/llm-settings/cli-commands/${codex.id}`,{name:codex.name,executable:codex.executable,args:['--sandbox','read-only']});

 const customCommand=await call('POST','/llm-settings/cli-commands',{name:'User CLI',executable:process.execPath,args:['-e','process.stdout.write("USER_CLI")']},201);
 const customSkill=await call('POST','/llm-settings/skills',{name:'User Skill',instructions:'USER_SKILL: keep this content unchanged.'},201);
 const customAgent=await call('POST','/llm-settings/agents',{name:'User Agent',cliCommandId:customCommand.id,skillId:customSkill.id,prompt:'USER_PROMPT: preserve this agent.'},201);
 const currentWorkflow=await call('GET','/workflow-settings'),assignments=Object.fromEntries(currentWorkflow.stages.map((stage:any)=>[stage.key,stage.agentIds]));
 assignments.SD=[customAgent.id];assignments.TESTS=[];assignments.IMPLEMENTATION=[];
 await call('PUT','/workflow-settings',{assignments});
 await server.core.store.run("DELETE FROM application_seed_history WHERE seed_key='llm-workflow-agent-defaults-v2'");
 await server.app.close();server=await start();

 const upgraded=await call('GET','/llm-settings'),byName=new Map(upgraded.agents.map((item:any)=>[item.name,item]));
 assert.deepEqual([...byName.keys()].sort(),['User Agent','需求確認 Agent','系統設計 Agent','測試情境 Agent','程式開發 Agent'].sort());
 const refreshedSettings=new Map(upgraded.agents.map((item:any)=>[item.name,item]));
 const refreshedRequirement=refreshedSettings.get('需求確認 Agent') as any;
 assert.equal(refreshedRequirement.prompt,legacyPrompt);assert.equal(refreshedRequirement.skill.name,'Playwright BDD');
 assert.equal((refreshedSettings.get('User Agent') as any).prompt,'USER_PROMPT: preserve this agent.');
 assert.equal((refreshedSettings.get('User Agent') as any).cliCommand.name,'User CLI');
 assert.equal((refreshedSettings.get('User Agent') as any).skill.instructions,'USER_SKILL: keep this content unchanged.');
 assert.deepEqual(upgraded.cliCommands.find((item:any)=>item.name==='Codex CLI').args,['--sandbox','workspace-write','--ask-for-approval','on-request','--no-alt-screen','--no-daemon']);
 const upgradedWorkflow=await call('GET','/workflow-settings');
 for(const [stage,name] of [['GHERKIN','需求確認 Agent'],['SD','系統設計 Agent'],['TESTS','測試情境 Agent'],['IMPLEMENTATION','程式開發 Agent']]){
  const ids=upgradedWorkflow.stages.find((item:any)=>item.key===stage).agentIds;assert.ok(ids.includes((refreshedSettings.get(name) as any).id));
 }
 assert.deepEqual(upgradedWorkflow.stages.find((item:any)=>item.key==='SD').agentIds,[customAgent.id,(refreshedSettings.get('系統設計 Agent') as any).id]);
 assert.deepEqual((await server.core.store.all('SELECT seed_key FROM application_seed_history ORDER BY seed_key')).map((item:any)=>item.seed_key),['llm-agent-settings-v1','llm-workflow-agent-defaults-v2']);

 const codeAgent=refreshedSettings.get('程式開發 Agent') as any;await call('DELETE',`/llm-settings/agents/${codeAgent.id}`);
 await server.app.close();server=await start();
 const afterRestart=await call('GET','/llm-settings');assert.equal(afterRestart.agents.some((item:any)=>item.name==='程式開發 Agent'),false);
 assert.equal((await server.core.store.all('SELECT seed_key FROM application_seed_history')).length,2);
});

test('LLM settings UI creates an Agent and requirement confirmation opens its interactive CLI tab',async t=>{
 const root=resolve(process.cwd());await mkdir(join(root,'.test-fixtures'),{recursive:true});
 const directory=await mkdtemp(join(root,'.test-fixtures/llm-settings-ui-'));
 const server=await createServer({root,metadataFile:join(directory,'metadata.sqlite'),dataRoot:join(directory,'data'),baseUrl:'http://127.0.0.1:1'});
 const browser=await chromium.launch({headless:true,chromiumSandbox:true});
 t.after(async()=>{await browser.close();await server.app.close();await rm(directory,{recursive:true,force:true});});
 const address=await server.app.listen({host:'127.0.0.1',port:0});
 const project=await server.core.createProject({name:'Agent UI test',workspaceRef:directory});
 const requirement=await server.core.createRequirement(project.id,{requirementKey:'REQ-LLM-UI'});
 await server.core.saveVersion(requirement.documents.gherkin.id,{rawText:feature});
 const page=await browser.newPage(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`${address}/llm-settings`);await expect(page.getByRole('heading',{name:'LLM 設定'})).toBeVisible();
 await page.getByRole('button',{name:'＋ 新增',exact:true}).nth(0).click();
 await page.getByLabel('顯示名稱').fill('UI Echo CLI');await page.getByLabel('執行檔').fill(process.execPath);await page.getByLabel('預設參數（JSON 字串陣列）').fill(JSON.stringify(['-e','process.stdout.write(process.argv.at(-1))']));
 await page.getByRole('button',{name:'保存 CLI 指令'}).click();await expect(page.getByText('UI Echo CLI')).toBeVisible();
 await page.getByRole('button',{name:'＋ 新增',exact:true}).nth(1).click();
 await page.getByLabel('Skill 名稱').fill('UI BDD skill');await page.getByLabel('Skill 指示').fill('UI_SKILL_MARKER: inspect requirements only.');
 await page.getByRole('button',{name:'保存 Skill'}).click();await expect(page.getByText('UI BDD skill')).toBeVisible();
 await page.getByRole('button',{name:'＋ 新增',exact:true}).nth(2).click();
 await page.getByLabel('Agent 名稱').fill('UI Requirement Agent');await page.getByLabel('CLI 啟動指令').selectOption({label:`UI Echo CLI · ${process.execPath}`});await page.getByLabel('Skill',{exact:true}).selectOption({label:'UI BDD skill'});await page.getByLabel('預設 Prompt').fill('UI_AGENT_PROMPT_MARKER: review the selected Gherkin.');
 await page.getByRole('button',{name:'保存 Agent'}).click();await expect(page.getByText('UI Requirement Agent')).toBeVisible();
 const settings=await (await page.request.get(`${address}/llm-settings`)).json(),agent=settings.agents.find((item:any)=>item.name==='UI Requirement Agent');assert.ok(agent);
 await page.goto(`${address}/workflow-settings`);await expect(page.getByRole('heading',{name:'流程設定'})).toBeVisible();
 await page.getByLabel('需求確認 · UI Requirement Agent').check();await page.getByLabel('需求確認 · 需求確認 Agent').check();await page.getByTestId('save-workflow-settings').click();
 await expect.poll(async()=>{const result=await page.request.get(`${address}/workflow-settings`);return (await result.json()).stages.find((stage:any)=>stage.key==='GHERKIN').agentIds.length;}).toBe(2);
 await page.goto(`${address}/requirements/${requirement.id}?featureId=${requirement.featureId}&workflowStage=GHERKIN`);
 await expect(page.getByTestId(`start-agent-GHERKIN-${agent.id}`)).toBeVisible();await expect(page.getByTestId(`start-agent-GHERKIN-${agent.id}`)).toBeEnabled();await page.getByTestId(`start-agent-GHERKIN-${agent.id}`).click();
 await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/terminal\\?kind=llm&session=`));await expect(page.getByTestId('xterm-host')).toBeVisible();
 await expect(page.locator('.xterm-rows')).toContainText('UI_AGENT_PROMPT_MARKER',{timeout:5000});
 assert.deepEqual(errors,[]);
});
