import {expect} from '@playwright/test';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createStandaloneServer} from '../../packages/workstation/http.mjs';
import {testBrowserRoot} from '../workstation/helpers.mjs';

export async function* agentCatalogScenario(page,info){
 const directory=await mkdtemp(path.join(tmpdir(),'bdd-catalog-ui-')),home=path.join(directory,'home'),repositoryId='SPEC-catalog-ui',marker='Catalog-'+randomUUID();
 const options={home,toolkitRoot:process.cwd(),browserRoot:testBrowserRoot,autoAcquire:false,allowLocal:true,enableExecution:true};let app=await createStandaloneServer(options),url;const errors=[];page.on('pageerror',error=>errors.push(error.message));
 app.service.register({id:repositoryId,title:'Catalog UI',remoteUrl:path.join(directory,'remote.git')});
 app.service.enqueue({schemaVersion:1,operationId:'OP-catalog-setup',repositoryId,operation:'repository.setup',input:{reviewer:'Catalog UI',projects:[],agent:{timeoutMs:120000}}});
 const setup=await app.service.wait('OP-catalog-setup');expect(setup.status,JSON.stringify(setup.error)).toBe('SUCCEEDED');
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));url=`http://127.0.0.1:${app.server.address().port}`;
 try{
  await page.goto(url);yield {phase:'opened'};await page.getByRole('button',{name:'Agent、Prompt 與 Skill 管理',exact:true}).click();await expect(page.getByRole('heading',{name:'Agent、Prompt 與 Skill 管理'})).toBeVisible();
  await page.getByRole('button',{name:'新增 Skill',exact:true}).click();const editor=page.locator('.catalog-editor');
  await editor.getByRole('textbox',{name:'名稱',exact:true}).fill('命名技能');await editor.getByRole('textbox',{name:'Skill 內容',exact:true}).fill('Read the attached resource references/title.txt using the workbench task MCP. Use its entire content verbatim as the Feature title. Follow all task rules.');
  await editor.getByLabel('加入 Skill 資源檔',{exact:true}).setInputFiles({name:'title.txt',mimeType:'text/plain',buffer:Buffer.from(marker)});await editor.getByRole('textbox',{name:'資源相對路徑',exact:true}).fill('references/title.txt');
  await editor.getByRole('button',{name:'儲存新版本',exact:true}).click();await expect(page.getByRole('button',{name:'編輯 命名技能',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'新增 Prompt',exact:true}).click();await editor.getByRole('textbox',{name:'名稱',exact:true}).fill('需求 Prompt');await editor.getByRole('textbox',{name:'Prompt 內容',exact:true}).fill('Generate the requested Gherkin. Read workbench_get_task, selected skill instructions and their attached resources using workbench_read_artifact. Follow the task output path and rules.');await editor.getByRole('button',{name:'儲存新版本',exact:true}).click();await expect(page.getByRole('button',{name:'編輯 需求 Prompt',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'新增 Agent',exact:true}).click();await editor.getByRole('textbox',{name:'名稱',exact:true}).fill('需求生成 Agent');await editor.getByRole('textbox',{name:'CLI 執行檔',exact:true}).fill(path.resolve('node_modules/@openai/codex/bin/codex.js'));
  await expect(editor.getByRole('textbox',{name:'Prompt 內容',exact:true})).toHaveCount(0);await editor.getByRole('spinbutton',{name:'逾時毫秒',exact:true}).fill('120000');
await editor.getByRole('button',{name:'儲存新版本',exact:true}).click();await expect(page.getByRole('button',{name:'編輯 需求生成 Agent',exact:true})).toBeVisible();
  // Verify SQLite owns the editable resources, rather than a browser-only cache.
  const db=new DatabaseSync(path.join(home,'metadata.sqlite'),{readOnly:true});let stored;try{stored=db.prepare('SELECT content FROM skill_resources WHERE path=?').get('references/title.txt');expect(stored.content).toBe(marker);}finally{db.close();}
  await page.getByRole('combobox',{name:'規格庫任務預設',exact:true}).selectOption(repositoryId);const defaults=page.locator('.catalog-default').filter({has:page.getByRole('heading',{name:'Gherkin',exact:true})});await defaults.getByRole('combobox',{name:'Agent',exact:true}).selectOption({label:'需求生成 Agent · v1'});await defaults.getByRole('combobox',{name:'Prompt',exact:true}).selectOption({label:'需求 Prompt · v1'});await defaults.getByRole('checkbox',{name:'命名技能 · v1',exact:true}).check();await defaults.getByRole('button',{name:'儲存 Gherkin 預設',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'任務預設已保存'})).toBeVisible();
  yield {phase:'saved'};
  const port=app.server.address().port;await app.close();app=await createStandaloneServer(options);await new Promise(resolve=>app.server.listen(port,'127.0.0.1',resolve));await page.reload();await expect(page.getByRole('button',{name:'編輯 需求生成 Agent',exact:true})).toBeVisible();
  yield {phase:'restarted'};
  await page.goto(`${url}/?repo=${repositoryId}&view=features`);await page.getByRole('textbox',{name:'需求描述',exact:true}).fill('使用者可以新增購物車商品並確認已加入。Feature 名稱請依選用技能。');await page.getByRole('button',{name:'LLM 生成 Gherkin',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog.getByRole('combobox',{name:'Agent',exact:true})).toHaveValue(app.service.catalog().agents.find(a=>a.name==='需求生成 Agent').revisions[0].id);await expect(dialog.getByRole('checkbox',{name:'命名技能 · v1',exact:true})).toBeChecked();
  const selectedPrompt=await dialog.getByRole('combobox',{name:'Prompt',exact:true}).inputValue(),firstAgent=app.service.catalog().agents.find(a=>a.name==='需求生成 Agent');const other=app.service.saveAgent({name:'另一執行器',settings:firstAgent.revisions[0].settings});await dialog.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('button',{name:'LLM 生成 Gherkin',exact:true}).click();await dialog.getByRole('combobox',{name:'Agent',exact:true}).selectOption(other.revisions[0].id);await expect(dialog.getByRole('combobox',{name:'Prompt',exact:true})).toHaveValue(selectedPrompt);await expect(dialog.getByRole('checkbox',{name:'命名技能 · v1',exact:true})).toBeChecked();await dialog.getByRole('button',{name:'更新預覽',exact:true}).click();await expect(dialog.locator('#dialog-error')).toHaveText('');
  await expect(dialog.getByRole('textbox',{name:'派工 Prompt',exact:true})).toHaveValue(/命名技能/);
  await info.attach('選擇 Agent 與 Skills 並預覽',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
  yield {phase:'previewed'};
  await dialog.getByRole('button',{name:'送出',exact:true}).click();await expect(page.locator('#content')).toHaveAttribute('aria-busy','false',{timeout:150000});
  const detail=await app.service.detail(repositoryId),operation=detail.operations.find(o=>o.request.operation==='workflow.gherkin.generate');expect(operation?.status,JSON.stringify(operation?.error)).toBe('SUCCEEDED');expect(operation.request.input.agentSnapshot.agentName).toBe('另一執行器');expect(operation.request.input.agentSnapshot.prompt.name).toBe('需求 Prompt');expect(operation.request.input.agentSnapshot.skills[0].resources[0].content).toBe(marker);await expect(page.getByRole('textbox',{name:'Gherkin',exact:true})).toHaveValue(new RegExp(marker));
  await info.attach('派工版本與 SQLite 產出',{body:JSON.stringify({operation,stored,marker},null,2),contentType:'application/json'});
  yield {phase:'generated'};
  // Edited catalog versions invalidate a preview; an existing operation snapshot remains immutable.
  const agent=app.service.catalog().agents.find(a=>a.name==='需求生成 Agent'),before=JSON.stringify(operation.request.input.agentSnapshot);
  const payload={purpose:'gherkin',editorKey:'new-stale',description:'stale preview',previousGherkin:'',agentSelection:{agentRevisionId:agent.revisions[0].id,promptRevisionId:selectedPrompt,skillRevisionIds:operation.request.input.agentSelection.skillRevisionIds}};
  const preview=await app.service.agentPreview(repositoryId,payload);const prompt=app.service.catalog().prompts.find(p=>p.name==='需求 Prompt');app.service.savePrompt({id:prompt.id,expectedRevision:prompt.revisions[0].id,name:prompt.name,content:'Changed prompt',purposes:['gherkin']});expect(app.service.catalog().agents.find(a=>a.id===agent.id).revisions.length).toBe(agent.revisions.length);
  const denied=await page.request.post(url+'/repository-api/v1/operations',{headers:{'x-workbench-request':'1'},data:{schemaVersion:1,operationId:'OP-stale-selection',repositoryId,operation:'workflow.gherkin.generate',input:{...payload,prompt:preview.prompt,promptDigest:preview.promptDigest}}});expect(denied.status()).toBe(409);expect(JSON.stringify(app.service.operation(operation.id).request.input.agentSnapshot)).toBe(before);expect(errors).toEqual([]);yield {phase:'stale-rejected'};
 }finally{
  await info.attach('管理與生成結果畫面',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});await info.attach('當次規格與測試來源',{body:await readFile(import.meta.filename),contentType:'text/plain'});await app.close();
 }
}
