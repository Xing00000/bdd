import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, cp, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createGit, execute } from '../../packages/git-core/index.mjs';
import { writeJson, exists } from '../../packages/contracts/index.mjs';
import { toolkitRoot } from '../workstation/helpers.mjs';
import { docxArchive } from '../workstation/requirement-fixtures.mjs';

async function port() { const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const value=server.address().port;await new Promise(r=>server.close(r));return value; }
// Fixture setup provisions only remote Git servers, a deliberately incomplete product,
// browser dependencies and the actual production entry point. No Spec Repo, review,
// operation, candidate or report is populated through a service/API/filesystem shortcut.
test('all-UI: two textareas → upload/generate/edit/restore → SQLite save → failure/fix/verification → sync and offline save', { timeout: 900000 }, async t => {
  const base=await mkdtemp(path.join(os.tmpdir(),'workbench-ui-')),home=path.join(base,'station');
  const artifacts=path.resolve(process.env.WB_E2E_ARTIFACTS??path.join(base,'evidence'));await mkdir(artifacts,{recursive:true});
  const driver=path.join(base,'driver');await mkdir(driver);
  // A deterministic CLI fixture, not a simulated PTY or an external paid LLM call.
  const agentFile=path.join(driver,'agent-fixture.mjs');
  await writeFile(agentFile,`import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
if(!process.stdin.isTTY||!process.stdout.isTTY)throw Error('real PTY required');
console.log('PTY_READY real-terminal=true');
process.stdin.setEncoding('utf8');process.stdin.on('data',x=>console.log('INPUT:'+x.trim()));
const result=spawnSync(process.execPath,[${JSON.stringify(path.join(toolkitRoot,'scripts/mcp-agent-task.mjs'))},process.argv[2]],{input:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'workbench_get_task',arguments:{}}})+'\\n',encoding:'utf8'});
if(result.status!==0)throw Error(result.stderr);
const task=JSON.parse(result.stdout).result.structuredContent;
if(task.purpose==='gherkin'){const {artifacts}=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const {generateRequirement}=await import(${JSON.stringify(path.join(toolkitRoot,'packages/workstation/requirements.mjs'))});fs.writeFileSync(task.output,generateRequirement(artifacts['requirement-description.txt']).gherkin);console.log('CLI fixture generated Gherkin');process.exit(0);}
if(task.feedback.some(item=>item.message.includes('feedback-pty-fixture'))){fs.writeFileSync('agent-fixed.txt','fixed from acceptance feedback\\n');console.log('Agent saved agent-fixed.txt');}
setTimeout(()=>process.exit(0),2500);
`);

  const browsers=process.env.PLAYWRIGHT_BROWSERS_PATH??path.join(base,'browsers');
  const env={...process.env,PLAYWRIGHT_BROWSERS_PATH:browsers};delete env.WB_ENABLE_TRUSTED_EXECUTION;const git=createGit({allowLocal:true});
  const remotes={alpha:path.join(base,'alpha.git'),beta:path.join(base,'beta.git'),mirror:path.join(base,'mirror.git'),product:path.join(base,'product.git')};
  for(const remote of Object.values(remotes))await git.command(undefined,['init','--bare','--initial-branch','main',remote]);
  const product=path.join(base,'product-source');await git.init(product);
  await writeFile(path.join(product,'server.mjs'),`import http from 'node:http';
import { readFileSync } from 'node:fs';
const server=http.createServer((request,response)=>{
  if(request.url==='/health'){response.setHeader('content-type','application/json');response.end(JSON.stringify({commit:process.env.WB_SOURCE_COMMIT}));return;}
  const message=JSON.stringify(readFileSync(new URL('./message.txt',import.meta.url),'utf8').trim());
  response.setHeader('content-type','text/html; charset=utf-8');
  response.end('<!doctype html><html><title>Versioned product</title><button id="login">Sign in</button><output role="status">Signed out</output><script>document.querySelector("#login").onclick=()=>{document.querySelector("output").textContent='+message+'};</script></html>');
});server.listen(Number(process.argv[2]),'127.0.0.1');process.on('SIGTERM',()=>server.close());\n`);
  await writeFile(path.join(product,'message.txt'),'Not implemented\n');
  const initialProduct=await git.commitSelected(product,{paths:['server.mjs','message.txt'],message:'Incomplete product fixture'},{head:null});
  await git.command(product,['remote','add','origin',remotes.product]);await git.push(product,{branch:'main'},await git.inspect(product));
  await writeJson(path.join(driver,'package.json'),{private:true,type:'module',devDependencies:{'@playwright/test':'1.64.1','@cucumber/gherkin':'39.1.0','@cucumber/messages':'32.3.1'}});
  async function install(args,label){const result=await execute(args[0],args.slice(1),{cwd:driver,env,timeoutMs:300000,maxBytes:24*1024*1024});await writeJson(path.join(artifacts,`${label}.json`),result);assert.equal(result.exitCode,0,result.stderr+result.stdout);assert.equal(result.timedOut,false);}
  await install(['npm','install','--ignore-scripts'],'driver-install');
  await install([path.join(driver,'node_modules/.bin/playwright'),'install','--with-deps','chromium'],'browser-install');
  const require=createRequire(path.join(driver,'package.json'));
  const {chromium,expect}=require('@playwright/test');
  const {Parser,AstBuilder,GherkinClassicTokenMatcher}=require('@cucumber/gherkin');
  const {IdGenerator}=require('@cucumber/messages');
  const parse=text=>new Parser(new AstBuilder(IdGenerator.incrementing()),new GherkinClassicTokenMatcher()).parse(text);
  const sitePort=await port(),productPort=await port(),site=`http://127.0.0.1:${sitePort}`,target=`http://127.0.0.1:${productPort}`;
  const server=spawn(process.execPath,[path.join(toolkitRoot,'scripts/workstation.mjs'),'serve'],{cwd:toolkitRoot,env:{...env,WB_HOME:home,WB_PORT:String(sitePort),WB_ALLOW_LOCAL_GIT:'1'},stdio:['ignore','pipe','pipe']});
  let serverLog='',browser,context,page;server.stdout.on('data',x=>serverLog+=x);server.stderr.on('data',x=>serverLog+=x);
  const events=[],browserErrors=[];
  t.after(async()=>{
    if(page)await page.screenshot({path:path.join(artifacts,'last-page.png'),fullPage:true}).catch(()=>{});
    if(context)await context.tracing.stop({path:path.join(artifacts,'ui-trace.zip')}).catch(()=>{});
    await browser?.close();server.kill('SIGTERM');await Promise.race([new Promise(r=>server.once('exit',r)),new Promise(r=>setTimeout(r,2500))]);if(server.exitCode===null)server.kill('SIGKILL');
    await writeFile(path.join(artifacts,'server.log'),serverLog);await writeJson(path.join(artifacts,'ui-write-requests.json'),events);await writeJson(path.join(artifacts,'browser-errors.json'),browserErrors);
    if(await exists(path.join(home,'development')))await cp(path.join(home,'development'),path.join(artifacts,'development'),{recursive:true});
    if(await exists(path.join(home,'executions')))await cp(path.join(home,'executions'),path.join(artifacts,'executions'),{recursive:true,filter:source=>!path.relative(path.join(home,'executions'),source).split(path.sep).some(p=>['repo','home','tmp'].includes(p))});
    if(process.env.WB_E2E_ARTIFACTS)await rm(base,{recursive:true,force:true});
  });
  for(let i=0;i<200;i++){try{const r=await fetch(site);if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,50));if(i===199)assert.fail(serverLog);}
  assert.equal((await (await fetch(site+'/repository-api/v1/capabilities')).json()).executionEnabled,true,'Normal startup must allow test confirmation without an execution flag');
  // Read-only assertion: the retired workspace/product UI is not a second normal entry.
  assert.equal((await fetch(site+'/requirements')).status,404);
  browser=await chromium.launch({chromiumSandbox:true});context=await browser.newContext({viewport:{width:1440,height:1000}});await context.tracing.start({screenshots:true,snapshots:true,sources:true});page=await context.newPage();page.setDefaultTimeout(20000);
  page.on('pageerror',e=>browserErrors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&r.url().startsWith(site))events.push({url:new URL(r.url()).pathname,body:r.postDataJSON()});});
  const ready=()=>expect(page.locator('#content')).toHaveAttribute('aria-busy','false');
  const click=async name=>{await page.getByRole('button',{name,exact:true}).click();await ready();};
  async function job(locator,name,outcome='SUCCEEDED',preview=true) { const previous=await page.locator('#notice').getAttribute('data-job-id');await locator.click();if(preview&&['workflow.develop','workflow.gherkin.generate'].includes(name)){await expect(page.getByRole('dialog')).toContainText('預覽 CLI Prompt');await page.getByRole('dialog').getByRole('button',{name:'送出',exact:true}).click();}await page.waitForFunction(({previous,name})=>{const n=document.querySelector('#notice');return n.dataset.jobId&&n.dataset.jobId!==previous&&n.dataset.operation===name;},{previous,name},{timeout:360000});assert.equal(await page.locator('#notice').getAttribute('data-outcome'),outcome,await page.locator('#notice').textContent());await ready(); }
  async function repositoryMenu(){if(!await page.locator('#sidebar').isVisible())await page.locator('#menu-toggle').click();const group=page.locator('.repo-nav.active + .repository-group');if(!await group.evaluate(n=>n.open))await group.locator('summary').click();return group;}
  // The reports view remains a supported evidence deep link; its sidebar entry was removed.
  async function reportHistory(){
    await expect(page.locator('#repository-nav [data-view="reports"]')).toHaveCount(0);
    const url=new URL(page.url());url.searchParams.set('view','reports');await page.goto(url.href);await ready();await expect(page.locator('#reports-view')).toBeVisible();
  }
  async function tab(name){const group=await repositoryMenu();await group.getByRole('button',{name,exact:true}).click();await expect(page.locator(`.repo-nav.active + .repository-group [data-view="${({'需求流程':'features','專案':'projects','設定':'settings'})[name]}"]`)).toHaveAttribute('aria-current','page');await ready();}
  async function bind(title,url,withProduct=false) {
    await page.locator('#bind-sidebar').click();const d=page.getByRole('dialog');
    await d.getByLabel('顯示名稱（選填，自動從網址帶入）',{exact:true}).fill(title);await d.getByLabel('Spec Repo Git 網址',{exact:true}).fill(url);
    if(withProduct){
      await d.getByLabel('需求確認者',{exact:true}).fill('UI Acceptance Reviewer');
      await d.getByText('有產品原始碼嗎？可以現在加入，也可以稍後設定').click();
      await d.getByLabel('產品原始碼 Git 網址',{exact:true}).fill(remotes.product);
      await d.getByText('進階：產品要怎麼啟動？需要測試時才設定').click();
      await d.getByLabel('產品服務網址',{exact:true}).fill(target);
      await d.getByLabel('啟動程式',{exact:true}).fill(process.execPath);
      await d.getByLabel('啟動參數（每行一個）',{exact:true}).fill(`server.mjs\n${productPort}`);
    }
    else await expect(d.getByLabel('需求確認者',{exact:true})).toHaveValue('UI Acceptance Reviewer');
    // Acquisition finishes before tools preparation can request installation consent.
    await job(d.getByRole('button',{name:'開始使用',exact:true}),'repository.tools.prepare','FAILED');await expect(d).toContainText('安裝必要套件並繼續');await expect(d).toContainText('@playwright/test');
    if(withProduct) {
      await d.getByRole('button',{name:'取消',exact:true}).click();await expect(d).not.toBeVisible();await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
      const repositoryId=new URL(page.url()).searchParams.get('repo');
      assert.equal(await exists(path.join(home,'repositories',repositoryId,'test-tools/node_modules')),false,'Cancelling setup preparation must not install');
      await tab('設定');await job(page.getByRole('button',{name:'儲存設定',exact:true}),'repository.tools.prepare','FAILED');await expect(d).toContainText('安裝必要套件並繼續');
    }
    await job(d.getByRole('button',{name:'安裝並繼續',exact:true}),'repository.tools.prepare');await expect(d).not.toBeVisible();
    if(withProduct)await tab('需求流程');await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();return new URL(page.url()).searchParams.get('repo');
  }
  async function configureFixtureAgent(){
    const repositoryId=new URL(page.url()).searchParams.get('repo'),repositoryTitle=await page.locator('#repository-title').textContent(),name=`UI Fixture ${repositoryId}`;
    await click('Agent、Prompt 與 Skill 管理');await page.getByRole('button',{name:'新增 Agent',exact:true}).click();
    const editor=page.locator('.catalog-editor');
    await editor.getByRole('textbox',{name:'名稱',exact:true}).fill(name);
    await editor.getByRole('textbox',{name:'CLI 執行檔',exact:true}).fill(process.execPath);
    await editor.getByRole('textbox',{name:'CLI 參數（每行一個）',exact:true}).fill(`${agentFile}\n{task}\n{prompt}`);
    await editor.getByRole('spinbutton',{name:'最大嘗試次數',exact:true}).fill('3');
    await editor.getByRole('button',{name:'儲存新版本',exact:true}).click();
    await expect(page.getByRole('button',{name:'編輯 '+name,exact:true})).toBeVisible();
    await page.getByRole('combobox',{name:'規格庫任務預設',exact:true}).selectOption(repositoryId);await expect(page.locator('.catalog-default')).toHaveCount(4);
    for(const purpose of ['Gherkin','系統設計','測試計劃','實作']){
      const section=page.locator('.catalog-default').filter({has:page.getByRole('heading',{name:purpose,exact:true})});
      await section.getByRole('combobox',{name:'Agent',exact:true}).selectOption({label:name+' · v1'});
      const saved=page.waitForResponse(response=>response.url().endsWith(`/spec-repositories/${repositoryId}/agent-defaults`)&&response.request().method()==='PUT');
      const submit=section.getByRole('button',{name:'儲存 '+purpose+' 預設',exact:true});await submit.click();
      const response=await saved;assert.equal(response.ok(),true,await response.text());await expect(submit).toBeEnabled();
    }
    await click('開啟規格庫 '+repositoryTitle);
  }
  async function editSource(content){await ready();if(await page.locator('#design-edit-button').isVisible())await page.locator('#design-edit-button').click();await page.getByRole('textbox',{name:'規格測試原始碼',exact:true}).fill(content);await job(page.locator('#save-source'),'repository.save');}
  // Every workstation write below is an actual UI event. Git is used only to
  // assert persisted/remote facts, never to complete a missing UI workflow step.
  await page.goto(site);await expect(page.getByRole('heading',{name:'工作台',exact:true})).toBeVisible();
  const alpha=await bind('Alpha 規格庫',remotes.alpha,true),beta=await bind('Beta 規格庫',remotes.beta);assert.notEqual(alpha,beta);
  for(const remote of [remotes.alpha,remotes.beta])assert.equal((await git.command(undefined,['--git-dir',remote,'show-ref'],{allowFailure:true})).exitCode,1,'Setup must not upload');
  await tab('專案');await expect(page.getByText('此規格庫尚未設定專案來源。',{exact:true})).toBeVisible();
  await configureFixtureAgent();
  await click('開啟規格庫 Alpha 規格庫');
  await configureFixtureAgent();
  const acquiredHead=(await git.inspect(path.join(home,'repositories',alpha,'repo'))).head;
  assert.equal(await page.getByRole('button',{name:/Commit|Push|Clone|安裝 Chromium|檢查測試接線|準備驗收候選/}).count(),0);
  await click('＋ 新增需求');let d=page.getByRole('dialog');
  await expect(d).not.toBeVisible();
  await expect(page.locator('#features-view textarea:visible')).toHaveCount(2);
  await expect(page.locator('#features-view input:visible')).toHaveCount(0);
  const upper=page.getByRole('textbox',{name:'需求描述',exact:true}),lower=page.getByRole('textbox',{name:'Gherkin',exact:true});
  const sourceDescription='真正產品登入\n當使用者點擊登入按鈕時，顯示已登入訊息';
  await upper.fill(sourceDescription);
  await job(page.locator('#generate-gherkin'),'workflow.gherkin.generate');
  await expect(lower).toHaveValue(/Feature: 真正產品登入/);await ready();
  assert.ok(parse(await lower.inputValue()).feature.children[0].scenario,'Actual Cucumber parser accepts generated grammar');
  const manual=`Feature: Sign in to the actual product\n  # Regression: Then 請補充可驗收的結果 in a comment must not block human review.\n  @case:CASE-001\n  Scenario: Sign in using the page\n    Given the product is open\n    When I sign in\n    Then the product confirms I signed in\n`;
  await lower.fill(manual);
  await upper.fill(sourceDescription+'\n上方修改不應蓋掉下方手動編輯');await expect(lower).toHaveValue(manual);
  await page.locator('#generate-gherkin').click();await expect(d).toContainText('重新產生');await d.getByRole('button',{name:'取消',exact:true}).click();await expect(lower).toHaveValue(manual);
  const beforeGeneration=await page.locator('#requirement-panel').getAttribute('data-generation');
  await page.locator('#generate-gherkin').click();await d.getByRole('button',{name:'保留原稿並產生',exact:true}).click();await expect(d).toContainText('預覽 CLI Prompt');await d.getByRole('button',{name:'送出',exact:true}).click();
  await page.waitForFunction(id=>document.querySelector('#requirement-panel').dataset.generation!==id,beforeGeneration);await ready();
  await expect(lower).not.toHaveValue(manual);assert.ok(parse(await lower.inputValue()).feature);
  await page.getByText('先前的生成草稿',{exact:true}).click();
  await page.getByRole('button',{name:'還原產生前內容',exact:true}).first().click();await d.getByRole('button',{name:'還原草稿',exact:true}).click();await expect(lower).toHaveValue(manual);
  await job(page.locator('#save-requirement'),'workflow.requirement.save');
  await expect(page.locator('#phase-title')).toHaveText('需求');
  await page.screenshot({path:path.join(artifacts,'00-two-input-requirement.png'),fullPage:true});
  const savedRoot=path.join(home,'repositories',alpha,'repo');
  assert.equal(await exists(savedRoot),true,'Binding automatically created the checkout');
  assert.equal((await git.inspect(savedRoot)).head,acquiredHead,'Saving still writes only SQLite, not a Git commit');
  const readSaved=(repo,path)=>{const db=new DatabaseSync(`${home}/metadata.sqlite`,{readOnly:true});try{return db.prepare('SELECT content FROM authoring_files WHERE repository_id=? AND path=?').get(repo,path)?.content;}finally{db.close();}};
  assert.match(readSaved(alpha,'spec/REQ-001/feature/feature.feature'),/Sign in to the actual product/);
  await page.reload();await ready();await expect(lower).toHaveValue(manual);await expect(upper).toHaveValue(sourceDescription+'\n上方修改不應蓋掉下方手動編輯');
  assert.equal((await git.command(undefined,['--git-dir',remotes.alpha,'show-ref'],{allowFailure:true})).exitCode,1,'Save must not upload');
  // Revisit settings without publishing any content; the automatically acquired checkout is unchanged.
  await tab('設定');await page.getByRole('textbox',{name:'確認者名稱',exact:true}).fill('UI Acceptance Reviewer Updated');
  await job(page.getByRole('button',{name:'儲存設定',exact:true}),'repository.tools.prepare');
  assert.equal(await exists(savedRoot),true);
  await tab('需求流程');await expect(page.locator('#phase-title')).toHaveText('需求');

  await job(page.getByRole('button',{name:'確認需求並繼續',exact:true}),'workflow.review');await expect(page.getByRole('dialog')).not.toBeVisible();await expect(page.locator('#phase-title')).toHaveText('設計');
  await editSource('# Sign-in design\n\nThe versioned product must display Signed in after clicking its sign-in button. Use the pinned source health identity and a screenshot for each real BDD step.\n');
  await job(page.getByRole('button',{name:'確認系統設計',exact:true}),'workflow.review');await expect(page.locator('#phase-title')).toHaveText('測試');
  await editSource(`import { Given, When, Then } from '../../_shared/bdd';\nimport { expect } from '@playwright/test';\nGiven('the product is open', async ({ page }) => { await page.goto('/'); });\nWhen('I sign in', async ({ page }) => { await page.getByRole('button', { name: 'Sign in' }).click(); });\nThen('the product confirms I signed in', async ({ page }) => { await expect(page.getByRole('status')).toHaveText('Signed in'); });\n`);
  await expect(page.getByRole('button',{name:'確認測試並繼續',exact:true})).toBeEnabled();
  await job(page.getByRole('button',{name:'確認測試並繼續',exact:true}),'workflow.review');await expect(page.getByRole('dialog')).not.toBeVisible();await expect(page.locator('#phase-title')).toHaveText('開發');
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(artifacts,'01-simple-workflow.png'),fullPage:true});
  const beforeDevelopment=await page.locator('#notice').getAttribute('data-job-id');
  await expect(page.locator('#implementation-panel')).toBeVisible();await expect(page.locator('#source-panel')).not.toBeVisible();await expect(page.locator('#scope-details')).not.toBeVisible();
  const beforeDispatch=events.filter(e=>e.url.endsWith('/operations')&&e.body.operation==='workflow.develop').length;
  await page.getByRole('button',{name:'確認開發',exact:true}).click();await expect(d).toContainText('預覽 CLI Prompt');
  assert.equal(events.filter(e=>e.url.endsWith('/operations')&&e.body.operation==='workflow.develop').length,beforeDispatch);
  await d.getByRole('button',{name:'取消',exact:true}).click();
  assert.equal(events.filter(e=>e.url.endsWith('/operations')&&e.body.operation==='workflow.develop').length,beforeDispatch);
  await page.getByRole('button',{name:'確認開發',exact:true}).click();
  const editedPrompt='Implement the approved feature using workbench_get_task. Preserve unrelated work.';
  await d.getByRole('textbox',{name:'派工 Prompt',exact:true}).fill(editedPrompt);
  await d.getByRole('button',{name:'送出',exact:true}).click();await expect(page.locator('#development-terminal')).toBeVisible({timeout:30000});
  assert.equal(events.filter(e=>e.url.endsWith('/operations')&&e.body.operation==='workflow.develop').at(-1).body.input.prompt,editedPrompt);
  await expect(page.locator('#development-terminal')).toContainText('PTY_READY real-terminal=true');
  await page.locator('#development-terminal .xterm-helper-textarea').focus();await page.keyboard.type('terminal-probe');await page.keyboard.press('Enter');
  const activeDevelopmentId=events.filter(e=>e.url.endsWith('/operations')&&e.body.operation==='workflow.develop').at(-1).body.operationId;
  const inputEntries=async()=>{const value=await (await fetch(site+`/repository-api/v1/spec-repositories/${alpha}/interactions`)).json();return value.entries.filter(entry=>entry.operation==='interaction.cli.input'&&entry.parentOperationId===activeDevelopmentId);};
  await expect.poll(async()=>(await inputEntries()).length).toBe(1);
  await page.locator('#development-terminal .xterm-helper-textarea').focus();await page.keyboard.type('second-probe');await page.keyboard.press('Enter');
  await expect.poll(async()=>(await inputEntries()).length).toBe(2);
  assert.deepEqual((await inputEntries()).map(entry=>entry.message).sort(),['second-probe','terminal-probe'].sort());
  await page.screenshot({path:path.join(artifacts,'10-real-agent-terminal.png'),fullPage:true});
  await page.waitForFunction(before=>{const n=document.querySelector('#notice');return n.dataset.operation==='workflow.develop'&&n.dataset.jobId!==before;},beforeDevelopment,{timeout:360000});await ready();
  await expect(page.locator('#implementation-panel')).toBeVisible();assert.equal(await page.getByRole('button',{name:'再次驗收',exact:true}).count(),0);
  await click('5 驗收');await expect(page.locator('#verification-panel')).toBeVisible();let run=page.locator('#feature-report-list [data-run-id]').first();const failedRunId=await run.getAttribute('data-run-id');const failedDevelopmentCount=await page.locator('#feature-report-list [data-run-id]').count();assert.equal(failedDevelopmentCount,3,'A failed full suite is retried within development, never marked accepted');await expect(run).toContainText('FAILED');await expect(run).toContainText('NOT_VERIFIED');
  if(!await page.locator('.report-history').evaluate(n=>n.open))await page.locator('.report-history > summary').click();await run.getByRole('button',{name:'檢視證據',exact:true}).click();await expect(page.locator('#feature-report-view')).toHaveAttribute('data-run-id',failedRunId);await expect(page.locator('#feature-report-view')).toHaveAttribute('aria-busy','false');
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(artifacts,'02-failure.png'),fullPage:true});
  await tab('專案');await page.getByRole('button',{name:'編輯專案',exact:true}).click();await page.locator('#project-file-tree button').filter({hasText:/^message\.txt$/}).click();await expect(page.getByRole('textbox',{name:'專案原始碼',exact:true})).toHaveValue('Not implemented\n');
  await page.getByRole('textbox',{name:'專案原始碼',exact:true}).fill('Signed in\n');await job(page.getByRole('button',{name:'儲存專案',exact:true}),'repository.save');await expect(page.getByRole('textbox',{name:'專案原始碼',exact:true})).toHaveValue('Signed in\n');
  assert.equal(await git.resolve(path.join(savedRoot,'projects/product')),initialProduct.commit,'Saving a product is a SQLite write, not a commit');
  assert.equal(readSaved(alpha,'message.txt'),'Signed in\n');
  await page.reload();await ready();await expect(page.getByRole('textbox',{name:'專案原始碼',exact:true})).toHaveValue('Signed in\n');
  assert.equal((await git.command(undefined,['--git-dir',remotes.product,'rev-parse','main'])).stdout.trim(),initialProduct.commit,'Local save and verification must not sync products');
  assert.equal((await git.command(undefined,['--git-dir',remotes.alpha,'show-ref'],{allowFailure:true})).exitCode,1);
  await tab('需求流程');await click('4 開發實作');await job(page.getByRole('button',{name:'確認開發',exact:true}),'workflow.develop');await expect(page.locator('#verification-panel')).toBeVisible();run=page.locator('#feature-report-list [data-run-id]').first();const passedRunId=await run.getAttribute('data-run-id');assert.notEqual(passedRunId,failedRunId);await expect(run).toContainText('VERIFIED');await expect(run).toContainText('PASSED');
  await expect(page.getByRole('dialog')).not.toBeVisible();if(!await page.locator('.report-history').evaluate(n=>n.open))await page.locator('.report-history > summary').click();await run.getByRole('button',{name:'檢視證據',exact:true}).click();await expect(page.locator('#feature-report-view')).toHaveAttribute('data-run-id',passedRunId);await expect(page.locator('#feature-report-view')).toHaveAttribute('aria-busy','false');await expect(page.frameLocator('#feature-report-view iframe').getByRole('link',{name:/Passed/})).toContainText('1');await reportHistory();await page.locator(`#run-list [data-run-id="${passedRunId}"]`).getByRole('button',{name:'檢視證據',exact:true}).click();for(const image of await page.locator('#report-view .gherkin-results img').all())await image.scrollIntoViewIfNeeded();await page.waitForFunction(()=>{const a=[...document.querySelectorAll('#report-view .gherkin-results img')];return a.length>=3&&a.every(x=>x.complete&&x.naturalWidth>0);});await tab('需求流程');await expect(page.locator('#feature-status')).toHaveText('等待人工驗收');await job(page.getByRole('button',{name:'驗收通過',exact:true}),'workflow.accept');
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(artifacts,'03-simple-verified.png'),fullPage:true});
  const productHead=await git.resolve(path.join(savedRoot,'projects/product'));assert.notEqual(productHead,initialProduct.commit);
  const tested=await git.resolve(savedRoot);await job(page.getByRole('button',{name:'遠端同步',exact:true}),'repository.sync');await expect(run).toContainText('已同步至遠端');await expect(page.getByRole('dialog')).not.toBeVisible();
  assert.equal((await git.command(undefined,['--git-dir',remotes.product,'rev-parse','main'])).stdout.trim(),productHead);const syncedHead=(await git.command(undefined,['--git-dir',remotes.alpha,'rev-parse','main'])).stdout.trim();
  const progressOnly=(await git.command(savedRoot,['diff','--name-only',tested,syncedHead])).stdout.trim().split('\n').filter(Boolean);
  assert.ok(progressOnly.length>0&&progressOnly.every(p=>p==='spec/REQ-001/feature/workflow.json'||p==='spec/REQ-001/feature/acceptance.json'),'Sync versions progress and human acceptance without changing tested source');
  const portable=JSON.parse((await git.command(undefined,['--git-dir',remotes.alpha,'show','main:spec/REQ-001/feature/workflow.json'])).stdout);
  assert.equal(portable.stage,'VERIFIED');assert.equal(portable.latestReport.runId,passedRunId);
  const acceptance=JSON.parse((await git.command(undefined,['--git-dir',remotes.alpha,'show','main:spec/REQ-001/feature/acceptance.json'])).stdout).items.at(-1);assert.equal(acceptance.runId,passedRunId);assert.equal(acceptance.manifestDigest,portable.latestReport.manifestDigest);assert.equal(acceptance.reviewer,portable.acceptance.reviewer);assert.ok(acceptance.reviewer.trim());
  const reportCommit=(await git.command(undefined,['--git-dir',remotes.alpha,'rev-parse',`refs/heads/evidence/${passedRunId}`])).stdout.trim();assert.notEqual(reportCommit,tested);
  const manifest=JSON.parse((await git.command(undefined,['--git-dir',remotes.alpha,'show',`${reportCommit}:reports/REQ-001/feature/${passedRunId}/manifest.json`])).stdout);assert.equal(manifest.testedSpecCommit,tested);assert.equal(manifest.verification,'VERIFIED');assert.equal(manifest.projects[0].commit,productHead);assert.ok(manifest.artifacts.filter(x=>x.path.startsWith('screenshots/')).length>=3);
  await page.reload();await ready();await expect(page.locator('#feature-report-list')).toContainText('已同步至遠端');await tab('需求流程');await expect(page.locator('#feature-status')).toHaveText('已完成');
  // The same completed human UI workflow can be inspected/advanced/re-run by the CLI.
  async function workflowCli(args,label) {
    const output=await execute(process.execPath,[path.join(toolkitRoot,'scripts/bdd.mjs'),'workflow',...args],{cwd:toolkitRoot,env:{...env,WB_HOME:home,WB_ALLOW_LOCAL_GIT:'1'},timeoutMs:360000});
    await writeJson(path.join(artifacts,`cli-${label}.json`),output);return {...output,value:JSON.parse(output.stdout)};
  }
  const cliStatus=await workflowCli(['status','--repo',alpha,'--feature','REQ-001/feature'],'status');assert.equal(cliStatus.exitCode,0);assert.equal(cliStatus.value.workflows[0].stage,'VERIFIED');
  const cliNext=await workflowCli(['next','--repo',alpha,'--feature','REQ-001/feature'],'next');assert.equal(cliNext.exitCode,0);assert.equal(cliNext.value.result.status,'COMPLETE');assert.equal(cliNext.value.result.advanced,false);
  await tab('專案');await page.getByRole('button',{name:'編輯專案',exact:true}).click();await page.locator('#project-file-tree button').filter({hasText:/^message\.txt$/}).click();await expect(page.getByRole('textbox',{name:'專案原始碼',exact:true})).toHaveValue('Signed in\n');
  await page.getByRole('textbox',{name:'專案原始碼',exact:true}).fill('CLI deliberately failing product\n');await job(page.getByRole('button',{name:'儲存專案',exact:true}),'repository.save');
  const cliFailed=await workflowCli(['next','--repo',alpha,'--feature','REQ-001/feature'],'next-failed');assert.equal(cliFailed.exitCode,1,cliFailed.stdout+cliFailed.stderr);assert.equal(cliFailed.value.result.testOutcome,'FAILED');
  await page.reload();await ready();await expect(page.getByRole('textbox',{name:'專案原始碼',exact:true})).toHaveValue('CLI deliberately failing product\n');
  await page.getByRole('textbox',{name:'專案原始碼',exact:true}).fill('Signed in\n');await job(page.getByRole('button',{name:'儲存專案',exact:true}),'repository.save');
  const cliRun=await workflowCli(['run','--repo',alpha,'--feature','REQ-001/feature'],'run');assert.equal(cliRun.exitCode,0,cliRun.stdout+cliRun.stderr);assert.equal(cliRun.value.result.verification,'VERIFIED');
  await tab('需求流程');await page.reload();await ready();await expect(page.locator('#feature-report-list [data-run-id]')).toHaveCount(failedDevelopmentCount+3);
  await expect(page.locator('#feature-report-list')).toContainText(cliRun.value.result.runId);await expect(page.locator('#feature-status')).toHaveText('等待人工驗收');
  await page.screenshot({path:path.join(artifacts,'09-cli-and-requirement-reports.png'),fullPage:true});
  // Report a real acceptance issue, return to development and let the configured CLI edit the product.
  await page.getByRole('textbox',{name:'驗收意見',exact:true}).fill('feedback-pty-fixture: add a regression marker without weakening the approved BDD');
  await job(page.getByRole('button',{name:'LLM 修改實作',exact:true}),'workflow.develop','SUCCEEDED',false);await expect(page.locator('#verification-panel')).toBeVisible();
  assert.equal(await readFile(path.join(savedRoot,'projects/product/agent-fixed.txt'),'utf8'),'fixed from acceptance feedback\n');
  await expect(page.locator('#feature-status')).toHaveText('等待人工驗收');await expect(page.frameLocator('#feature-report-view iframe').getByRole('link',{name:/Passed/})).toContainText('1');await reportHistory();await page.locator('#run-list [data-run-id]').first().getByRole('button',{name:'檢視證據',exact:true}).click();await expect(page.locator('#report-view .bdd-step')).toHaveCount(3);
  await expect(page.locator('#report-view')).toContainText('Given the product is open');await expect(page.locator('#report-view')).toContainText('Then the product confirms I signed in');await tab('需求流程');
  assert.equal(await page.getByRole('button',{name:'再次驗收',exact:true}).count(),0);
  assert.ok(await page.evaluate(()=>{const save=document.querySelector('#save-requirement'),next=document.querySelector('#advance');return !document.querySelector('.next-action')&&!!save&&!!next;}));
  await page.screenshot({path:path.join(artifacts,'11-acceptance-gherkin-steps.png'),fullPage:true});
  const devJobs=events.filter(e=>e.url.endsWith('/operations')&&e.body.operation==='workflow.develop');
  const firstTerminal=await (await fetch(site+`/repository-api/v1/operations/${devJobs[0].body.operationId}/terminal`)).json();
  assert.match(firstTerminal.output,/PTY_READY real-terminal=true/);assert.match(firstTerminal.output,/INPUT:terminal-probe/);assert.match(firstTerminal.output,/BDD.*FAILED/);
  const replies=await inputEntries(),firstReply=replies.find(entry=>entry.message==='terminal-probe'),secondReply=replies.find(entry=>entry.message==='second-probe');
  const replyLog=async id=>(await (await fetch(site+`/repository-api/v1/operations/${id}/terminal`)).json()).output;
  assert.match(await replyLog(firstReply.id),/INPUT:terminal-probe/);assert.doesNotMatch(await replyLog(firstReply.id),/INPUT:second-probe/);assert.match(await replyLog(secondReply.id),/INPUT:second-probe/);
  const latestDetail=await (await fetch(site+`/repository-api/v1/spec-repositories/${alpha}`)).json();assert.equal(latestDetail.spec.features[0].workflow.feedback.length,0);
  const latestRun=latestDetail.runs.find(r=>r.state==='SEALED');
  const native=await fetch(site+`/repository-api/v1/spec-repositories/${alpha}/runs/${latestRun.id}/report/native/index.html`);assert.equal(native.status,200);assert.match(native.headers.get('content-security-policy'),/sandbox allow-scripts/);assert.ok(!native.headers.get('content-security-policy').includes('allow-same-origin'));

  await click('開啟規格庫 Beta 規格庫');await tab('專案');await expect(page.getByText('此規格庫尚未設定專案來源。',{exact:true})).toBeVisible();assert.equal(await page.getByRole('button',{name:'開啟產品 product',exact:true}).count(),0);await reportHistory();await expect(page.locator('#run-list')).toContainText('尚無驗收紀錄');await expect(page.locator('#report-view')).not.toBeVisible();
  await tab('需求流程');await expect(page.locator('#feature-empty')).toBeVisible();
  await expect(page.locator('#features-view textarea:visible')).toHaveCount(2);
  await upper.fill('獨立規格庫查詢');
  await (await repositoryMenu()).getByRole('button',{name:'設定',exact:true}).click();await expect(d).toContainText('尚未儲存');await d.getByRole('button',{name:'取消',exact:true}).click();await expect(upper).toHaveValue('獨立規格庫查詢');
  const doc=docxArchive('<w:document xmlns:w="urn:test"><w:body><w:p><w:r><w:t>當輸入關鍵字時，顯示符合條件的資料</w:t></w:r></w:p></w:body></w:document>');
  await page.locator('#requirement-file').setInputFiles({name:'需求.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:doc});
  await expect(upper).toHaveValue('獨立規格庫查詢\n\n當輸入關鍵字時，顯示符合條件的資料');await ready();await expect(lower).toHaveValue('');
  await job(page.locator('#generate-gherkin'),'workflow.gherkin.generate');await expect(lower).toHaveValue(/Feature: 獨立規格庫查詢/);await ready();
  const betaGenerated=await lower.inputValue();assert.ok(parse(betaGenerated).feature.children[0].scenario);
  await page.locator('#requirement-file').setInputFiles({name:'more.md',mimeType:'text/markdown',buffer:Buffer.from('查不到時顯示空結果')});await expect(upper).toHaveValue(/查不到時顯示空結果/);await ready();await expect(lower).toHaveValue(betaGenerated);
  const importSource=await upper.inputValue();
  await page.locator('#requirement-file').setInputFiles({name:'invalid.pdf',mimeType:'application/pdf',buffer:Buffer.from('invalid')});await expect(page.locator('#notice')).toContainText('目前支援');await ready();await expect(upper).toHaveValue(importSource);await expect(lower).toHaveValue(betaGenerated);
  await lower.fill(betaGenerated+'# 手動加入且必須原樣保留\n');await job(page.locator('#save-requirement'),'workflow.requirement.save');
  await expect(page.locator('#feature-select option:checked')).toHaveText('獨立規格庫查詢');
  await page.screenshot({path:path.join(artifacts,'05-two-input-upload.png'),fullPage:true});
  const betaRoot=path.join(home,'repositories',beta,'repo');assert.equal(await exists(betaRoot),true);
  assert.match(readSaved(beta,'spec/REQ-001/feature/feature.feature'),/手動加入且必須原樣保留/);
  // The user explicitly approves content; old scaffold text is advice, not a veto.
  const placeholderDraft=betaGenerated.replace(/^    Then .+$/m,'    Then 請補充可驗收的結果');
  assert.ok(parse(placeholderDraft).feature);
  await lower.fill(placeholderDraft);await job(page.locator('#save-requirement'),'workflow.requirement.save');
  await expect(page.locator('#requirement-feedback')).toContainText('不阻擋確認');
  await page.screenshot({path:path.join(artifacts,'07-advice-not-a-gate.png'),fullPage:true});
  await job(page.getByRole('button',{name:'確認需求並繼續',exact:true}),'workflow.review');
  await expect(page.locator('#phase-title')).toHaveText('設計');
  await expect(page.locator('#feature-status')).not.toHaveText('已完成');
  await page.screenshot({path:path.join(artifacts,'08-human-review-progressed.png'),fullPage:true});
  await page.reload();await ready();await expect(page.locator('#phase-title')).toHaveText('設計');
  await click('1 需求確認');await expect(lower).toHaveValue(placeholderDraft);await expect(lower).not.toBeEditable();await expect(upper).not.toBeEditable();await expect(page.locator('#save-requirement')).not.toBeVisible();
  assert.equal(readSaved(beta,'spec/REQ-001/feature/feature.feature'),placeholderDraft);
  assert.equal(await exists(betaRoot),true,'Binding acquired the checkout; human content approval remains a SQLite action');
  // Official parser accepts static checks and * style without a mandatory When/Then pair.
  for(const source of [
    'Feature: Static data\n Scenario: Version\n  Given a version exists\n  Then the version is correct\n',
    'Feature: List\n Scenario: Items\n  * the first item exists\n  * the second item exists\n',
    'Feature: Background action\n Background:\n  When the page opens\n Scenario: Result\n  Then the homepage appears\n'
  ]) assert.ok(parse(source).feature);
  // Saving unfinished Gherkin must work; confirmation must not pretend it is valid.
  await job(page.locator('#restart-stage'),'workflow.restart');await expect(lower).toBeEditable();
  await lower.fill('Feature: unfinished\n');await job(page.locator('#save-requirement'),'workflow.requirement.save');
  let priorJob=await page.locator('#notice').getAttribute('data-job-id');await page.getByRole('button',{name:'確認需求並繼續',exact:true}).click();
  await page.waitForFunction(previous=>{const n=document.querySelector('#notice');return n.dataset.jobId!==previous&&n.dataset.operation==='workflow.review';},priorJob);
  await expect(page.locator('#notice')).toHaveAttribute('data-outcome','FAILED');await ready();await expect(lower).toHaveValue('Feature: unfinished\n');await expect(page.locator('#phase-title')).toHaveText('需求');
  await lower.fill(betaGenerated);await job(page.locator('#save-requirement'),'workflow.requirement.save');
  // Break the isolated remote after binding. A real UI sync fails, while later saves succeed.
  const moved=remotes.beta+'.offline';await import('node:fs/promises').then(fs=>fs.rename(remotes.beta,moved));
  const previousJob=await page.locator('#notice').getAttribute('data-job-id');await page.getByRole('button',{name:'遠端同步',exact:true}).click();
  await page.waitForFunction(previous=>{const n=document.querySelector('#notice');return n.dataset.jobId&&n.dataset.jobId!==previous&&n.dataset.operation==='repository.sync';},previousJob);
  await expect(page.locator('#notice')).toHaveAttribute('data-outcome','FAILED');await ready();
  await lower.fill(betaGenerated+'# 同步失敗後仍可儲存\n');await job(page.locator('#save-requirement'),'workflow.requirement.save');
  await page.reload();await ready();await expect(lower).toHaveValue(betaGenerated+'# 同步失敗後仍可儲存\n');await expect(upper).toHaveValue(importSource);
  assert.match(readSaved(beta,'spec/REQ-001/feature/feature.feature'),/同步失敗後仍可儲存/);
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(artifacts,'06-two-input-mobile.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));await page.setViewportSize({width:1440,height:1000});
  await upper.fill('尚未儲存的來源草稿');await lower.fill(betaGenerated+'# 尚未儲存的下方修改\n');
  await (await repositoryMenu()).getByRole('button',{name:'設定',exact:true}).click();await expect(d).toContainText('尚未儲存');await d.getByRole('button',{name:'取消',exact:true}).click();
  await expect(upper).toHaveValue('尚未儲存的來源草稿');await expect(lower).toHaveValue(betaGenerated+'# 尚未儲存的下方修改\n');
  await page.getByRole('button',{name:'開啟規格庫 Alpha 規格庫',exact:true}).click();await d.getByRole('button',{name:'捨棄草稿並離開',exact:true}).click();await ready();await expect(page.getByRole('heading',{name:'Alpha 規格庫',exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});await reportHistory();await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(artifacts,'04-simple-mobile.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
  await page.getByRole('button',{name:'展開導覽',exact:true}).click();await expect(page.getByRole('button',{name:'開啟規格庫 Beta 規格庫',exact:true})).toBeVisible();await click('開啟規格庫 Beta 規格庫');await expect(page.locator('#sidebar')).not.toBeVisible();assert.deepEqual(browserErrors,[]);
  const operations=events.filter(e=>e.url.endsWith('/operations')).map(e=>e.body),installs=operations.filter(x=>x.input.installConsent);
  assert.deepEqual(installs.map(x=>x.repositoryId).sort(),[alpha,beta].sort(),'Each distinct Spec Repo needs exactly one approved installation across the entire workflow');
  assert.ok(installs.every(x=>x.operation==='repository.tools.prepare'),'All installations are approved during settings preparation');
  assert.ok(operations.every(x=>!x.operation.startsWith('git.')&&!x.operation.startsWith('submodule.')&&!x.operation.startsWith('run.')),'No Git plumbing or split run steps are exposed to the UI');
  const installationConsentsByRepository=Object.fromEntries([alpha,beta].map(repositoryId=>[repositoryId,installs.filter(x=>x.repositoryId===repositoryId).length]));
  await writeJson(path.join(artifacts,'ui-flow-receipt.json'),{repositoryIds:{alpha,beta},failedRunId,passedRunId,initialProduct:initialProduct.commit,fixedProduct:productHead,testedSpecCommit:tested,reportCommit,localVerificationBeforeSync:true,installationConsentsByRepository,uiOperations:operations.map(x=>x.operation),noGitControls:true});
});
