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

async function port() { const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const value=server.address().port;await new Promise(r=>server.close(r));return value; }
// Fixture setup provisions only remote Git servers, a deliberately incomplete product,
// browser dependencies and the actual production entry point. No Spec Repo, review,
// operation, candidate or report is populated through a service/API/filesystem shortcut.
test('all-UI: two Spec remotes → nested Project → reviewed tests → failure → source fix → real verification → remote publication', { timeout: 900000 }, async t => {
  const base=await mkdtemp(path.join(os.tmpdir(),'workbench-ui-')),home=path.join(base,'station');
  const artifacts=path.resolve(process.env.WB_E2E_ARTIFACTS??path.join(base,'evidence'));await mkdir(artifacts,{recursive:true});
  const driver=path.join(base,'driver');await mkdir(driver);
  const browsers=process.env.PLAYWRIGHT_BROWSERS_PATH??path.join(base,'browsers');
  const env={...process.env,PLAYWRIGHT_BROWSERS_PATH:browsers};const git=createGit({allowLocal:true});
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
  await writeJson(path.join(driver,'package.json'),{private:true,type:'module',devDependencies:{'@playwright/test':'1.64.1'}});
  async function install(args,label){const result=await execute(args[0],args.slice(1),{cwd:driver,env,timeoutMs:300000,maxBytes:24*1024*1024});await writeJson(path.join(artifacts,`${label}.json`),result);assert.equal(result.exitCode,0,result.stderr+result.stdout);assert.equal(result.timedOut,false);}
  await install(['npm','install','--ignore-scripts'],'driver-install');
  await install([path.join(driver,'node_modules/.bin/playwright'),'install','--with-deps','chromium'],'browser-install');
  const {chromium,expect}=createRequire(path.join(driver,'package.json'))('@playwright/test');
  const sitePort=await port(),productPort=await port(),site=`http://127.0.0.1:${sitePort}`,target=`http://127.0.0.1:${productPort}`;
  const server=spawn(process.execPath,[path.join(toolkitRoot,'scripts/workstation.mjs'),'serve'],{cwd:toolkitRoot,env:{...env,WB_HOME:home,WB_PORT:String(sitePort),WB_ALLOW_LOCAL_GIT:'1',WB_ENABLE_TRUSTED_EXECUTION:'1'},stdio:['ignore','pipe','pipe']});
  let serverLog='',browser,context,page;server.stdout.on('data',x=>serverLog+=x);server.stderr.on('data',x=>serverLog+=x);
  const events=[],browserErrors=[];
  t.after(async()=>{
    if(page)await page.screenshot({path:path.join(artifacts,'last-page.png'),fullPage:true}).catch(()=>{});
    if(context)await context.tracing.stop({path:path.join(artifacts,'ui-trace.zip')}).catch(()=>{});
    await browser?.close();server.kill('SIGTERM');await Promise.race([new Promise(r=>server.once('exit',r)),new Promise(r=>setTimeout(r,2500))]);if(server.exitCode===null)server.kill('SIGKILL');
    await writeFile(path.join(artifacts,'server.log'),serverLog);await writeJson(path.join(artifacts,'ui-write-requests.json'),events);await writeJson(path.join(artifacts,'browser-errors.json'),browserErrors);
    if(await exists(path.join(home,'executions')))await cp(path.join(home,'executions'),path.join(artifacts,'executions'),{recursive:true,filter:source=>!path.relative(path.join(home,'executions'),source).split(path.sep).some(p=>['repo','home','tmp'].includes(p))});
    if(process.env.WB_E2E_ARTIFACTS)await rm(base,{recursive:true,force:true});
  });
  for(let i=0;i<200;i++){try{const r=await fetch(site);if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,50));if(i===199)assert.fail(serverLog);}
  // Read-only assertion: the retired workspace/product UI is not a second normal entry.
  assert.equal((await fetch(site+'/requirements')).status,404);
  browser=await chromium.launch({chromiumSandbox:true});context=await browser.newContext({viewport:{width:1440,height:1000}});await context.tracing.start({screenshots:true,snapshots:true,sources:true});page=await context.newPage();page.setDefaultTimeout(20000);
  page.on('pageerror',e=>browserErrors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&r.url().startsWith(site))events.push({url:new URL(r.url()).pathname,body:r.postDataJSON()});});
  const click=async name=>{await page.getByRole('button',{name,exact:true}).click();await expect(page.locator('#repository-view')).toHaveAttribute('aria-busy','false');};
  async function job(locator,name){const previous=await page.locator('#notice').getAttribute('data-job-id');await locator.click();await page.waitForFunction(({previous,name})=>{const n=document.querySelector('#notice');return n.dataset.jobId&&n.dataset.jobId!==previous&&n.dataset.operation===name;},{previous,name},{timeout:360000});assert.equal(await page.locator('#notice').getAttribute('data-outcome'),'SUCCEEDED',await page.locator('#notice').textContent());await expect(page.locator('#repository-view')).toHaveAttribute('aria-busy','false');}
  async function confirmJob(buttonName,submitName,operation){await click(buttonName);await job(page.getByRole('dialog').getByRole('button',{name:submitName,exact:true}),operation);await expect(page.getByRole('dialog')).not.toBeVisible();}
  async function tab(name){await click(name);await expect(page.locator(`[data-view="${({ '總覽與環境':'overview','需求流程':'features','Projects':'projects','Git 與 Remotes':'git','驗收紀錄':'reports','維護':'maintenance' })[name]}"]`)).toHaveAttribute('aria-current','page');await expect(page.locator('#repository-view')).toHaveAttribute('aria-busy','false');}
  async function commit(message){await tab('Git 與 Remotes');await expect(page.locator('#changed-files input').first()).toBeVisible();await click('全選變更');await page.getByLabel('提交訊息',{exact:true}).fill(message);await job(page.getByRole('button',{name:'提交選取檔案',exact:true}),'git.commit');await expect(page.getByText('沒有待提交的變更。',{exact:true})).toBeVisible();}
  async function push(remote='origin',branch='main'){await page.getByLabel('推送 Remote',{exact:true}).selectOption(remote);await page.getByLabel('遠端分支',{exact:true}).fill(branch);await confirmJob('Push 選取目標','確認 Push','git.push');await expect(page.locator('#push-receipt')).toContainText('遠端已核對');}
  async function bind(title,url){await page.locator('#bind-sidebar').click();const dialog=page.getByRole('dialog');await dialog.getByLabel('規格庫名稱',{exact:true}).fill(title);await dialog.getByLabel('Git remote URL',{exact:true}).fill(url);await dialog.getByRole('button',{name:'綁定規格庫',exact:true}).click();await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();await job(page.getByRole('button',{name:'取得 Repo',exact:true}),'repository.clone');await job(page.getByRole('button',{name:'初始化 Spec 結構',exact:true}),'repository.initialize');await commit('Initialize specification repository');await push();return new URL(page.url()).searchParams.get('repo');}
  async function editSource(content){await page.getByRole('textbox',{name:'規格測試原始碼',exact:true}).fill(content);await job(page.getByRole('button',{name:'保存文件',exact:true}),'spec.file.save');}
  // BEGIN USER FLOW: every state-changing workstation action below is a UI event.
  await page.goto(site);await expect(page.getByRole('heading',{name:'規格與驗收工作台',exact:true})).toBeVisible();
  assert.equal(await page.getByText('既有工作台',{exact:true}).count(),0);
  const alpha=await bind('Alpha 規格庫',remotes.alpha),beta=await bind('Beta 規格庫',remotes.beta);assert.notEqual(alpha,beta);
  await tab('Projects');await expect(page.getByText('此 Spec Repo 尚未加入任何 Project。',{exact:true})).toBeVisible();
  await click('開啟規格庫 Alpha 規格庫');await tab('Projects');await click('＋ 加入 Project');
  let dialog=page.getByRole('dialog');await dialog.getByLabel('Project ID',{exact:true}).fill('product');await dialog.getByLabel('產品 Git remote URL',{exact:true}).fill(remotes.product);await job(dialog.getByRole('button',{name:'加入產品',exact:true}),'submodule.add');await expect(dialog).not.toBeVisible();await expect(page.locator('#project-cards')).toContainText(initialProduct.commit);
  await commit('Bind product submodule');
  await click('＋ 新增 Remote');dialog=page.getByRole('dialog');await dialog.getByLabel('Remote 名稱',{exact:true}).fill('mirror');await dialog.getByLabel('Fetch URL',{exact:true}).fill(remotes.mirror);await job(dialog.getByRole('button',{name:'保存 Remote',exact:true}),'git.remote');await push('mirror');
  const mirrorCommit=(await git.command(undefined,['--git-dir',remotes.mirror,'rev-parse','main'])).stdout.trim();assert.equal(mirrorCommit,(await git.command(path.join(home,'repositories',alpha,'repo'),['rev-parse','HEAD'])).stdout.trim());
  await tab('總覽與環境');await page.getByLabel('服務 Project',{exact:true}).selectOption('product');await page.getByLabel('目標網址',{exact:true}).fill(target);await page.getByLabel('健康檢查網址',{exact:true}).fill(target+'/health');await page.getByLabel('啟動程式',{exact:true}).fill('node');await page.getByLabel('啟動參數（每行一個，不經 shell）',{exact:true}).fill(`server.mjs\n${productPort}`);await job(page.getByRole('button',{name:'保存驗收環境',exact:true}),'spec.execution.configure');
  await confirmJob('安裝／更新測試依賴','安裝依賴','repository.dependencies.install');await expect(page.locator('#dependency-state')).toContainText('已有 package-lock.json');await job(page.getByRole('button',{name:'安裝 Chromium',exact:true}),'repository.browsers.install');
  await tab('需求流程');await click('＋ 建立需求功能');dialog=page.getByRole('dialog');await dialog.getByLabel('需求 ID',{exact:true}).fill('REQ-001');await dialog.getByLabel('功能 ID',{exact:true}).fill('login');await dialog.getByLabel('功能標題',{exact:true}).fill('由真正產品頁面登入');await dialog.getByLabel('product',{exact:true}).check();await job(dialog.getByRole('button',{name:'建立功能',exact:true}),'spec.feature.create');
  await editSource(`Feature: Sign in to the actual product\n  @case:CASE-001\n  Scenario: Sign in using the page\n    Given the product is open\n    When I sign in\n    Then the product confirms I signed in\n`);
  await page.getByLabel('確認者',{exact:true}).fill('UI Acceptance Reviewer');await expect(page.getByLabel('確認者',{exact:true})).toHaveValue('UI Acceptance Reviewer');await confirmJob('確認 Gherkin','確認目前版本','spec.review.confirm');await expect(page.locator('#phase-title')).toHaveText('設計產品與測試的介面');
  await editSource('# Sign-in design\n\nThe versioned product serves a sign-in button and status output. Clicking it must show Signed in. The runner starts the pinned product and checks /health commit; every BDD step attaches an actual screenshot.\n');
  await confirmJob('確認系統設計','確認目前版本','spec.review.confirm');await expect(page.locator('#phase-title')).toHaveText('實作真正的操作與斷言');
  await expect(page.getByRole('button',{name:'確認測試基線',exact:true})).toBeDisabled();
  await editSource(`import { Given, When, Then } from '../../_shared/bdd';\nimport { expect } from '@playwright/test';\nGiven('the product is open', async ({ page }) => { await page.goto('/'); });\nWhen('I sign in', async ({ page }) => { await page.getByRole('button', { name: 'Sign in' }).click(); });\nThen('the product confirms I signed in', async ({ page }) => { await expect(page.getByRole('status')).toHaveText('Signed in'); });\n`);
  await job(page.getByRole('button',{name:'檢查測試接線',exact:true}),'spec.tests.check');await expect(page.locator('#check-state')).toContainText('1 個測試');await confirmJob('確認測試基線','確認目前版本','spec.review.confirm');await expect(page.locator('#phase-title')).toHaveText('讓產品符合已確認的測試');
  await expect(page.getByRole('button',{name:'準備驗收候選',exact:true})).toBeDisabled();await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(artifacts,'01-reviewed-workflow.png'),fullPage:true});
  await commit('Confirm requirements design and actual BDD tests');await push('origin');await tab('需求流程');await job(page.getByRole('button',{name:'準備驗收候選',exact:true}),'run.prepare');
  await expect(page.locator('#reports-view')).toBeVisible();let run=page.locator('#run-list [data-run-id]').first(),failedRunId=await run.getAttribute('data-run-id');await job(run.getByRole('button',{name:'執行此候選驗收',exact:true}),'run.execute');
  await expect(run).toContainText('FAILED');await expect(run).toContainText('NOT_VERIFIED');await run.getByRole('button',{name:'檢視證據',exact:true}).click();await expect(page.locator('#report-view')).toHaveAttribute('data-run-id',failedRunId);await expect(page.locator('#report-view')).toHaveAttribute('aria-busy','false');await expect(page.locator('#report-view')).toContainText('FAILED');await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(artifacts,'02-real-failing-run.png'),fullPage:true});
  await click('開啟 Project product');await click('此 Project 的 Git');await page.getByPlaceholder('feat/REQ-001',{exact:true}).fill('feat/REQ-001');await expect(page.getByPlaceholder('feat/REQ-001',{exact:true})).toHaveValue('feat/REQ-001');await job(page.getByRole('button',{name:'建立開發分支',exact:true}),'git.branch');
  await click('開啟 Project product');await page.getByLabel('產品檔案',{exact:true}).selectOption('message.txt');await click('開啟檔案');await expect(page.getByRole('textbox',{name:'產品原始碼',exact:true})).toHaveValue('Not implemented\n');
  await page.getByRole('textbox',{name:'產品原始碼',exact:true}).fill('Signed in\n');await expect(page.getByRole('textbox',{name:'產品原始碼',exact:true})).toHaveValue('Signed in\n');await job(page.getByRole('button',{name:'保存產品檔案',exact:true}),'project.file.save');await expect(page.getByRole('textbox',{name:'產品原始碼',exact:true})).toHaveValue('Signed in\n');await click('此 Project 的 Git');await commit('Implement sign-in outcome');await push('origin','feat/REQ-001');
  const fixedProduct=(await git.command(undefined,['--git-dir',remotes.product,'rev-parse','refs/heads/feat/REQ-001'])).stdout.trim();assert.notEqual(fixedProduct,initialProduct.commit);
  await tab('Projects');await confirmJob('固定目前產品 Commit','固定版本','submodule.pin');await tab('Git 與 Remotes');await page.getByLabel('Git 目標',{exact:true}).selectOption('');await expect(page.locator('#git-head')).toContainText('Spec Repo');await commit('Pin fixed product version');await push('origin');
  const tested=(await git.command(undefined,['--git-dir',remotes.alpha,'rev-parse','main'])).stdout.trim();
  await tab('需求流程');await job(page.getByRole('button',{name:'準備驗收候選',exact:true}),'run.prepare');run=page.locator('#run-list [data-run-id]').first();const passedRunId=await run.getAttribute('data-run-id');assert.notEqual(passedRunId,failedRunId);await job(run.getByRole('button',{name:'執行此候選驗收',exact:true}),'run.execute');await expect(run).toContainText('VERIFIED');await expect(run).toContainText('PASSED');
  await run.getByRole('button',{name:'檢視證據',exact:true}).click();await expect(page.locator('#report-view')).toHaveAttribute('data-run-id',passedRunId);await expect(page.locator('#report-view')).toHaveAttribute('aria-busy','false');await page.locator('#report-view .gallery').scrollIntoViewIfNeeded();await page.waitForFunction(()=>{const imgs=[...document.querySelectorAll('#report-view .gallery img')];return imgs.length>=3&&imgs.every(x=>x.complete&&x.naturalWidth>0);});
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(artifacts,'03-verified-report.png'),fullPage:true});await job(run.getByRole('button',{name:'建立報告 Commit',exact:true}),'run.publish');await run.getByRole('button',{name:'Push 報告分支',exact:true}).click();await job(page.getByRole('dialog').getByRole('button',{name:'確認發布報告',exact:true}),'run.publish');await expect(run).toContainText('PUBLISHED');
  const reportCommit=(await git.command(undefined,['--git-dir',remotes.alpha,'rev-parse',`refs/heads/evidence/${passedRunId}`])).stdout.trim();assert.notEqual(reportCommit,tested);assert.equal((await git.command(undefined,['--git-dir',remotes.alpha,'rev-parse','main'])).stdout.trim(),tested);
  const manifest=JSON.parse((await git.command(undefined,['--git-dir',remotes.alpha,'show',`${reportCommit}:reports/REQ-001/login/${passedRunId}/manifest.json`])).stdout);assert.equal(manifest.testedSpecCommit,tested);assert.equal(manifest.verification,'VERIFIED');assert.equal(manifest.projects[0].commit,fixedProduct);assert.ok(manifest.artifacts.filter(x=>x.path.startsWith('screenshots/')).length>=3);
  await writeJson(path.join(artifacts,'ui-flow-receipt.json'),{repositoryIds:{alpha,beta},initialProduct:initialProduct.commit,fixedProduct,testedSpecCommit:tested,reportCommit,failedRunId,passedRunId,remoteMainUnchanged:true,productFixThroughUI:true});
  await page.reload();await expect(page.locator('#run-list')).toContainText('PUBLISHED');await tab('需求流程');await expect(page.locator('#feature-status')).toHaveText('VERIFIED');
  await click('開啟規格庫 Beta 規格庫');await tab('Projects');await expect(page.getByText('此 Spec Repo 尚未加入任何 Project。',{exact:true})).toBeVisible();assert.equal(await page.getByRole('button',{name:'開啟 Project product',exact:true}).count(),0);await tab('驗收紀錄');await expect(page.locator('#run-list')).toContainText('尚無執行紀錄');await expect(page.locator('#report-view')).not.toBeVisible();await page.goBack();await expect(page.locator('#repository-view')).toHaveAttribute('aria-busy','false');await page.goForward();await expect(page.locator('#repository-view')).toHaveAttribute('aria-busy','false');await expect(page.locator('#report-view')).not.toBeVisible();
  await tab('需求流程');await click('＋ 建立需求功能');dialog=page.getByRole('dialog');await dialog.getByLabel('需求 ID',{exact:true}).fill('REQ-001');await dialog.getByLabel('功能 ID',{exact:true}).fill('login');await dialog.getByLabel('功能標題',{exact:true}).fill('Same identity in another Spec Repo');await job(dialog.getByRole('button',{name:'建立功能',exact:true}),'spec.feature.create');await expect(page.locator('#feature-status')).toHaveText('GHERKIN');
  await page.getByRole('textbox',{name:'規格測試原始碼',exact:true}).fill('unsaved personal draft');await click('總覽與環境');await expect(page.getByRole('dialog')).toContainText('尚未保存');await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();await expect(page.getByRole('textbox',{name:'規格測試原始碼',exact:true})).toHaveValue('unsaved personal draft');
  await click('開啟規格庫 Alpha 規格庫');await page.getByRole('dialog').getByRole('button',{name:'捨棄編輯並離開',exact:true}).click();await expect(page.getByRole('heading',{name:'Alpha 規格庫',exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});await tab('驗收紀錄');await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(artifacts,'04-mobile.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
  await page.getByRole('button',{name:'展開導覽',exact:true}).click();await expect(page.getByRole('button',{name:'開啟規格庫 Beta 規格庫',exact:true})).toBeVisible();await click('開啟規格庫 Beta 規格庫');await expect(page.locator('#sidebar')).not.toBeVisible();
  assert.deepEqual(browserErrors,[]);
  const operations=events.filter(e=>e.url.endsWith('/operations')).map(e=>e.body);
  for(const required of ['repository.clone','repository.initialize','submodule.add','repository.dependencies.install','repository.browsers.install','spec.file.save','spec.review.confirm','spec.tests.check','project.file.save','git.commit','git.push','submodule.pin','run.prepare','run.execute','run.publish'])assert.ok(operations.some(x=>x.operation===required),`No UI request for ${required}`);
  assert.ok(operations.some(x=>x.operation==='git.push'&&x.input.remote==='mirror'));
});
