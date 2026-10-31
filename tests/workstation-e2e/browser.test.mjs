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

async function port() { const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const value=server.address().port;await new Promise(r=>server.close(r));return value; }
// Fixture setup provisions only remote Git servers, a deliberately incomplete product,
// browser dependencies and the actual production entry point. No Spec Repo, review,
// operation, candidate or report is populated through a service/API/filesystem shortcut.
test('all-UI: one-time setup → save without Git → one installation consent → failed/fixed verification → one remote sync', { timeout: 900000 }, async t => {
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
  const ready=()=>expect(page.locator('#content')).toHaveAttribute('aria-busy','false');
  const click=async name=>{await page.getByRole('button',{name,exact:true}).click();await ready();};
  async function job(locator,name) { const previous=await page.locator('#notice').getAttribute('data-job-id');await locator.click();await page.waitForFunction(({previous,name})=>{const n=document.querySelector('#notice');return n.dataset.jobId&&n.dataset.jobId!==previous&&n.dataset.operation===name;},{previous,name},{timeout:360000});assert.equal(await page.locator('#notice').getAttribute('data-outcome'),'SUCCEEDED',await page.locator('#notice').textContent());await ready(); }
  async function tab(name){await click(name);await expect(page.locator(`[data-view="${({'需求流程':'features','產品':'projects','驗收紀錄':'reports','設定':'settings'})[name]}"]`)).toHaveAttribute('aria-current','page');await ready();}
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
    await job(d.getByRole('button',{name:'開始使用',exact:true}),'repository.setup');await expect(d).not.toBeVisible();await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();return new URL(page.url()).searchParams.get('repo');
  }
  async function editSource(content){await ready();await page.getByRole('textbox',{name:'規格測試原始碼',exact:true}).fill(content);await job(page.getByRole('button',{name:'儲存',exact:true}),'repository.save');}
  // Every workstation write below is an actual UI event. Git is used only to
  // assert persisted/remote facts, never to complete a missing UI workflow step.
  await page.goto(site);await expect(page.getByRole('heading',{name:'把需求推進到可驗收的結果',exact:true})).toBeVisible();
  const alpha=await bind('Alpha 規格庫',remotes.alpha,true),beta=await bind('Beta 規格庫',remotes.beta);assert.notEqual(alpha,beta);
  for(const remote of [remotes.alpha,remotes.beta])assert.equal((await git.command(undefined,['--git-dir',remote,'show-ref'],{allowFailure:true})).exitCode,1,'Setup must not upload');
  await tab('產品');await expect(page.getByText('此規格庫尚未設定產品來源。',{exact:true})).toBeVisible();
  await click('開啟規格庫 Alpha 規格庫');
  assert.equal(await page.getByRole('button',{name:/Commit|Push|Clone|安裝 Chromium|檢查測試接線|準備驗收候選/}).count(),0);
  await click('＋ 新增需求');let d=page.getByRole('dialog');await d.getByLabel('這個功能要做到什麼？',{exact:true}).fill('真正產品登入');await d.getByLabel('怎樣才算成功？（每行一項）',{exact:true}).fill('點擊登入按鈕，出現已登入訊息');await d.getByText('進階：自訂需求編號和功能代號（一般不需要）').click();await d.getByLabel('需求 ID',{exact:true}).fill('REQ-001');await d.getByLabel('功能 ID',{exact:true}).fill('login');await job(d.getByRole('button',{name:'建立需求草稿',exact:true}),'workflow.create');await expect(d).not.toBeVisible();await expect(page.locator('#gherkin-guided')).toBeVisible();await page.getByRole('button',{name:'直接編輯 Gherkin（進階）',exact:true}).click();
  await editSource(`Feature: Sign in to the actual product\n  @case:CASE-001\n  Scenario: Sign in using the page\n    Given the product is open\n    When I sign in\n    Then the product confirms I signed in\n`);
  const savedRoot=path.join(home,'repositories',alpha,'repo');
  assert.equal(await exists(savedRoot),false,'Saving must not require or create a Git checkout');
  const readSaved=(repo,path)=>{const db=new DatabaseSync(`${home}/metadata.sqlite`,{readOnly:true});try{return db.prepare('SELECT content FROM authoring_files WHERE repository_id=? AND path=?').get(repo,path)?.content;}finally{db.close();}};
  assert.match(readSaved(alpha,'spec/REQ-001/login/login.feature'),/Sign in to the actual product/);
  await page.reload();await ready();await expect(page.getByRole('textbox',{name:'規格測試原始碼',exact:true})).toHaveValue(/Sign in to the actual product/);
  assert.equal((await git.command(undefined,['--git-dir',remotes.alpha,'show-ref'],{allowFailure:true})).exitCode,1,'Save must not upload');
  // Revisit settings with no checkout and no successful remote operation.
  await tab('設定');await page.getByRole('textbox',{name:'確認者名稱',exact:true}).fill('UI Acceptance Reviewer Updated');
  await job(page.getByRole('button',{name:'儲存設定',exact:true}),'repository.setup');
  assert.equal(await exists(savedRoot),false);
  await tab('需求流程');await expect(page.locator('#phase-title')).toHaveText('定義產品應該做到的事');

  await job(page.getByRole('button',{name:'確認需求並繼續',exact:true}),'workflow.review');await expect(page.getByRole('dialog')).not.toBeVisible();await expect(page.locator('#phase-title')).toHaveText('確認系統設計');
  await editSource('# Sign-in design\n\nThe versioned product must display Signed in after clicking its sign-in button. Use the pinned source health identity and a screenshot for each real BDD step.\n');
  await job(page.getByRole('button',{name:'確認設計並繼續',exact:true}),'workflow.review');await expect(page.locator('#phase-title')).toHaveText('確認真正的操作與斷言');
  await editSource(`import { Given, When, Then } from '../../_shared/bdd';\nimport { expect } from '@playwright/test';\nGiven('the product is open', async ({ page }) => { await page.goto('/'); });\nWhen('I sign in', async ({ page }) => { await page.getByRole('button', { name: 'Sign in' }).click(); });\nThen('the product confirms I signed in', async ({ page }) => { await expect(page.getByRole('status')).toHaveText('Signed in'); });\n`);
  await page.getByRole('button',{name:'確認測試並繼續',exact:true}).click();d=page.getByRole('dialog');await expect(d).toContainText('安裝必要套件並繼續');await expect(d).toContainText('@playwright/test');await d.getByRole('button',{name:'取消',exact:true}).click();await expect(page.locator('#phase-title')).toHaveText('確認真正的操作與斷言');assert.equal(await exists(path.join(savedRoot,'node_modules')),false,'Cancel must not install');
  await page.getByRole('button',{name:'確認測試並繼續',exact:true}).click();await expect(d).toBeVisible();await job(d.getByRole('button',{name:'安裝並繼續',exact:true}),'workflow.review');await expect(d).not.toBeVisible();await expect(page.locator('#phase-title')).toHaveText('讓產品符合已確認的測試');
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(artifacts,'01-simple-workflow.png'),fullPage:true});
  await job(page.getByRole('button',{name:'開始驗收',exact:true}),'workflow.verify');await expect(page.locator('#reports-view')).toBeVisible();let run=page.locator('#run-list [data-run-id]').first();const failedRunId=await run.getAttribute('data-run-id');await expect(run).toContainText('FAILED');await expect(run).toContainText('NOT_VERIFIED');
  await run.getByRole('button',{name:'檢視證據',exact:true}).click();await expect(page.locator('#report-view')).toHaveAttribute('data-run-id',failedRunId);await expect(page.locator('#report-view')).toHaveAttribute('aria-busy','false');
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(artifacts,'02-failure.png'),fullPage:true});
  await click('開啟產品 product');await page.getByLabel('產品檔案',{exact:true}).selectOption('message.txt');await expect(page.getByRole('textbox',{name:'產品原始碼',exact:true})).toHaveValue('Not implemented\n');
  await page.getByRole('textbox',{name:'產品原始碼',exact:true}).fill('Signed in\n');await job(page.getByRole('button',{name:'儲存產品',exact:true}),'repository.save');await expect(page.getByRole('textbox',{name:'產品原始碼',exact:true})).toHaveValue('Signed in\n');
  assert.equal(await git.resolve(path.join(savedRoot,'projects/product')),initialProduct.commit,'Saving a product is a SQLite write, not a commit');
  assert.equal(readSaved(alpha,'message.txt'),'Signed in\n');
  await page.reload();await ready();await expect(page.getByRole('textbox',{name:'產品原始碼',exact:true})).toHaveValue('Signed in\n');
  assert.equal((await git.command(undefined,['--git-dir',remotes.product,'rev-parse','main'])).stdout.trim(),initialProduct.commit,'Local save and verification must not sync products');
  assert.equal((await git.command(undefined,['--git-dir',remotes.alpha,'show-ref'],{allowFailure:true})).exitCode,1);
  await tab('需求流程');await job(page.getByRole('button',{name:'再次驗收',exact:true}),'workflow.verify');run=page.locator('#run-list [data-run-id]').first();const passedRunId=await run.getAttribute('data-run-id');assert.notEqual(passedRunId,failedRunId);await expect(run).toContainText('VERIFIED');await expect(run).toContainText('PASSED');
  await expect(page.getByRole('dialog')).not.toBeVisible();await run.getByRole('button',{name:'檢視證據',exact:true}).click();await expect(page.locator('#report-view')).toHaveAttribute('data-run-id',passedRunId);await expect(page.locator('#report-view')).toHaveAttribute('aria-busy','false');await page.locator('#report-view .gallery').scrollIntoViewIfNeeded();await page.waitForFunction(()=>{const a=[...document.querySelectorAll('#report-view .gallery img')];return a.length>=3&&a.every(x=>x.complete&&x.naturalWidth>0);});
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(artifacts,'03-simple-verified.png'),fullPage:true});
  const productHead=await git.resolve(path.join(savedRoot,'projects/product'));assert.notEqual(productHead,initialProduct.commit);
  const tested=await git.resolve(savedRoot);await job(page.getByRole('button',{name:'遠端同步',exact:true}),'repository.sync');await expect(run).toContainText('已同步至遠端');await expect(page.getByRole('dialog')).not.toBeVisible();
  assert.equal((await git.command(undefined,['--git-dir',remotes.product,'rev-parse','main'])).stdout.trim(),productHead);assert.equal((await git.command(undefined,['--git-dir',remotes.alpha,'rev-parse','main'])).stdout.trim(),tested);
  const reportCommit=(await git.command(undefined,['--git-dir',remotes.alpha,'rev-parse',`refs/heads/evidence/${passedRunId}`])).stdout.trim();assert.notEqual(reportCommit,tested);
  const manifest=JSON.parse((await git.command(undefined,['--git-dir',remotes.alpha,'show',`${reportCommit}:reports/REQ-001/login/${passedRunId}/manifest.json`])).stdout);assert.equal(manifest.testedSpecCommit,tested);assert.equal(manifest.verification,'VERIFIED');assert.equal(manifest.projects[0].commit,productHead);assert.ok(manifest.artifacts.filter(x=>x.path.startsWith('screenshots/')).length>=3);
  const operations=events.filter(e=>e.url.endsWith('/operations')).map(e=>e.body);const installs=operations.filter(x=>x.input.installConsent);
  assert.equal(installs.length,1,'Exactly one approved installation for the entire workflow');assert.ok(operations.every(x=>!x.operation.startsWith('git.')&&!x.operation.startsWith('submodule.')&&!x.operation.startsWith('run.')),'No Git plumbing or split run steps are exposed to the UI');
  await writeJson(path.join(artifacts,'ui-flow-receipt.json'),{repositoryIds:{alpha,beta},failedRunId,passedRunId,initialProduct:initialProduct.commit,fixedProduct:productHead,testedSpecCommit:tested,reportCommit,localVerificationBeforeSync:true,oneInstallationConsent:installs.length,uiOperations:operations.map(x=>x.operation),noGitControls:true});
  await page.reload();await ready();await expect(page.locator('#run-list')).toContainText('已同步至遠端');await tab('需求流程');await expect(page.locator('#feature-status')).toHaveText('VERIFIED');
  await click('開啟規格庫 Beta 規格庫');await tab('產品');await expect(page.getByText('此規格庫尚未設定產品來源。',{exact:true})).toBeVisible();assert.equal(await page.getByRole('button',{name:'開啟產品 product',exact:true}).count(),0);await tab('驗收紀錄');await expect(page.locator('#run-list')).toContainText('尚無驗收紀錄');await expect(page.locator('#report-view')).not.toBeVisible();
  await tab('需求流程');await expect(page.locator('#feature-empty')).toBeVisible();
  const quick=page.locator('#quick-feature-form');
  await quick.getByLabel('功能名稱',{exact:true}).fill('獨立規格庫查詢');
  await page.getByRole('button',{name:'設定',exact:true}).click();await expect(d).toContainText('尚未儲存');
  await d.getByRole('button',{name:'取消',exact:true}).click();
  await expect(quick.getByLabel('功能名稱',{exact:true})).toHaveValue('獨立規格庫查詢');
  await quick.getByLabel('怎樣才算成功？',{exact:true}).fill('可以找到符合關鍵字的資料');
  await job(page.getByRole('button',{name:'建立需求草稿',exact:true}),'workflow.create');
  await expect(page.locator('#gherkin-guided')).toBeVisible();
  await expect(page.locator('#guided-acceptance')).toHaveValue('可以找到符合關鍵字的資料');
  await expect(page.locator('#feature-select option:checked')).toHaveText('獨立規格庫查詢');
  await page.screenshot({path:path.join(artifacts,'05-guided-requirement.png'),fullPage:true});
  await page.getByLabel('怎樣才算成功？（每行一項）',{exact:true}).fill('能找到符合關鍵字的資料\n查不到時顯示空結果');
  await job(page.getByRole('button',{name:'儲存需求',exact:true}),'workflow.draft');
  const betaRoot=path.join(home,'repositories',beta,'repo');
  const betaFeature=readSaved(beta,'spec/REQ-001/feature/feature.feature');assert.equal(await exists(betaRoot),false);
  assert.match(betaFeature,/@case:CASE-002/);
  // Break the isolated remote after binding. A real UI sync fails, while later saves succeed.
  const moved=remotes.beta+'.offline';await import('node:fs/promises').then(fs=>fs.rename(remotes.beta,moved));
  const previousJob=await page.locator('#notice').getAttribute('data-job-id');
  await page.getByRole('button',{name:'遠端同步',exact:true}).click();
  await page.waitForFunction(previous=>{const n=document.querySelector('#notice');return n.dataset.jobId&&n.dataset.jobId!==previous&&n.dataset.operation==='repository.sync';},previousJob);
  await expect(page.locator('#notice')).toHaveAttribute('data-outcome','FAILED');await ready();
  await page.getByLabel('怎樣才算成功？（每行一項）',{exact:true}).fill('同步失敗後仍可儲存');
  await job(page.getByRole('button',{name:'儲存需求',exact:true}),'workflow.draft');
  await page.reload();await ready();await expect(page.locator('#guided-acceptance')).toHaveValue('同步失敗後仍可儲存');
  assert.match(readSaved(beta,'spec/REQ-001/feature/feature.feature'),/同步失敗後仍可儲存/);
  await page.getByLabel('使用情境（選填）',{exact:true}).fill('尚未儲存的草稿');
  await page.getByRole('button',{name:'設定',exact:true}).click();await expect(d).toContainText('尚未儲存');
  await d.getByRole('button',{name:'取消',exact:true}).click();
  await expect(page.getByLabel('使用情境（選填）',{exact:true})).toHaveValue('尚未儲存的草稿');
  await page.getByRole('button',{name:'開啟規格庫 Alpha 規格庫',exact:true}).click();await d.getByRole('button',{name:'捨棄草稿並離開',exact:true}).click();await ready();await expect(page.getByRole('heading',{name:'Alpha 規格庫',exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});await tab('驗收紀錄');await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(artifacts,'04-simple-mobile.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
  await page.getByRole('button',{name:'展開導覽',exact:true}).click();await expect(page.getByRole('button',{name:'開啟規格庫 Beta 規格庫',exact:true})).toBeVisible();await click('開啟規格庫 Beta 規格庫');await expect(page.locator('#sidebar')).not.toBeVisible();assert.deepEqual(browserErrors,[]);
});
