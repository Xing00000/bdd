import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile, cp, rm, realpath } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { createGit, execute } from '../../packages/git-core/index.mjs';
import { initialize, createFeature } from '../../packages/spec-toolkit/index.mjs';
import { readJson, writeJson, exists } from '../../packages/contracts/index.mjs';
import { commitAll, toolkitRoot, sealedBundle } from '../workstation/helpers.mjs';

async function freePort(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
// The fixture is deliberately an EXISTING specification repository, with multiple
// revisions and reports. All workstation binding, selection and runs are UI events.
test('all-UI: acquire an existing Spec Repo → browse history → choose spec/product refs → full failing/passing regressions → replay', {timeout:900000}, async t=>{
  const base=await mkdtemp(path.join(os.tmpdir(),'catalog-ui-')),home=path.join(base,'station'),source=path.join(base,'source'),product=path.join(base,'product');
  const artifacts=path.join(path.resolve(process.env.WB_E2E_ARTIFACTS??base),'catalog-regression');await mkdir(artifacts,{recursive:true});
  const selectedLocalPath=path.join(base,'指定目錄 with spaces','bdd-spec');
  const git=createGit({allowLocal:true}), remote=path.join(base,'spec.git'),productRemote=path.join(base,'product.git');
  const servicePort=await freePort(),uiPort=await freePort(),origin=`http://127.0.0.1:${uiPort}`,target=`http://127.0.0.1:${servicePort}`;
  const browsers=process.env.PLAYWRIGHT_BROWSERS_PATH??path.join(base,'browsers');
  let server,browser,context,page,serverLog='';const writes=[],errors=[];
  t.after(async()=>{
    if(page)await page.screenshot({path:path.join(artifacts,'last-page.png'),fullPage:true}).catch(()=>{});
    await context?.tracing.stop({path:path.join(artifacts,'ui-trace.zip')}).catch(()=>{});await browser?.close();
    if(server){server.kill('SIGTERM');await Promise.race([new Promise(r=>server.once('exit',r)),new Promise(r=>setTimeout(r,2000))]);if(server.exitCode===null)server.kill('SIGKILL');}
    await writeFile(path.join(artifacts,'server.log'),serverLog);await writeJson(path.join(artifacts,'ui-writes.json'),writes);
    for(const area of ['executions','regressions'])if(await exists(path.join(home,area)))await cp(path.join(home,area),path.join(artifacts,area),{recursive:true,filter:f=>!path.relative(path.join(home,area),f).split(path.sep).some(p=>['repo','publisher','home','tmp'].includes(p))});
    if(process.env.WB_E2E_ARTIFACTS)await rm(base,{recursive:true,force:true});
  });
  for(const r of [remote,productRemote])await git.command(undefined,['init','--bare','--initial-branch','main',r]);
  await git.init(product);await writeFile(path.join(product,'message.txt'),'Old');
  await writeFile(path.join(product,'server.mjs'),`import http from 'node:http';import{readFileSync}from'node:fs';const s=http.createServer((q,r)=>{if(q.url==='/health'){r.setHeader('content-type','application/json');r.end(JSON.stringify({commit:process.env.WB_SOURCE_COMMIT}));return;}r.setHeader('content-type','text/html');r.end('<html><title>Catalog fixture</title><h1>'+readFileSync(new URL('./message.txt',import.meta.url),'utf8')+'</h1></html>');});s.listen(Number(process.argv[2]),'127.0.0.1');process.on('SIGTERM',()=>s.close());\n`);
  await commitAll(product);const p1=await git.resolve(product);await git.command(product,['remote','add','origin',productRemote]);await git.push(product,{},await git.inspect(product));
  await writeFile(path.join(product,'message.txt'),'Ready');await commitAll(product);const p2=await git.resolve(product);await git.push(product,{},await git.inspect(product));
  await git.init(source);await initialize(source,{specRepositoryId:'catalog-fixture',toolkitRoot:path.join(toolkitRoot,'packages'),templateRoot:path.join(toolkitRoot,'templates/spec-repo/v1')});await commitAll(source);
  await git.addModule(source,{projectId:'product',url:productRemote,commit:p1},await git.inspect(source));
  const cfg=await readJson(path.join(source,'workbench.yaml'));cfg.projects=[{id:'product',path:'projects/product'}];cfg.execution.environment={WB_TARGET_BASE_URL:target};cfg.execution.install=['npm','ci','--ignore-scripts'];cfg.execution.service={projectId:'product',command:[process.execPath,'server.mjs',String(servicePort)],healthUrl:target+'/health'};await writeJson(path.join(source,'workbench.yaml'),cfg);
  async function add(req,feature,title,assertion){
    await createFeature(source,{requirementId:req,featureId:feature,title,projectIds:['product']});
    await writeFile(path.join(source,`spec/${req}/${feature}/${feature}.feature`),`Feature: ${title}\n @case:CASE-001\n Scenario: Test the versioned product\n  Given I open the product\n  Then the expected content is shown\n`);
    await writeFile(path.join(source,`spec/${req}/${feature}/${feature}.sd.md`),`# ${title}\nHistorical design kept by the Spec repository.\n`);
    await writeFile(path.join(source,`tests/${req}/${feature}/${feature}.steps.ts`),`import {Given,Then} from '../../_shared/bdd';import{expect}from'@playwright/test';Given('I open the product',async({page})=>{await page.goto('/');});Then('the expected content is shown',async({page})=>{${assertion}});\n`);
  }
  await add('REQ-101','readiness','產品可用狀態',"await expect(page.locator('h1')).toHaveText('Ready');");
  await add('REQ-102','title','頁面標題',"await expect(page).toHaveTitle('Catalog fixture');");
  const env={...process.env,PLAYWRIGHT_BROWSERS_PATH:browsers};delete env.WB_ENABLE_TRUSTED_EXECUTION;
  async function install(args,label){const r=await execute(args[0],args.slice(1),{cwd:source,env,timeoutMs:240000,maxBytes:24*1024*1024});await writeJson(path.join(artifacts,label+'.json'),r);assert.equal(r.exitCode,0,r.stderr+r.stdout);}
  await install(['npm','install','--ignore-scripts'],'dependency-install');await install([path.join(source,'node_modules/.bin/playwright'),'install','--with-deps','chromium'],'browser-install');await commitAll(source);
  const s1=await git.resolve(source);await git.command(source,['tag','release-v1']);
  await sealedBundle(path.join(source,'reports/REQ-102/title/RUN-history'),{schemaVersion:1,runId:'RUN-history',requirementId:'REQ-102',featureId:'title',testedSpecCommit:s1});
  await add('REQ-103','heading','頁面主標題',"await expect(page.locator('h1')).toBeVisible();");await commitAll(source);const s2=await git.resolve(source);
  await git.command(source,['remote','add','origin',remote]);await git.push(source,{},await git.inspect(source));await git.command(source,['push','origin','refs/tags/release-v1']);
  server=spawn(process.execPath,[path.join(toolkitRoot,'scripts/workstation.mjs'),'serve'],{cwd:toolkitRoot,env:{...env,WB_HOME:home,WB_PORT:String(uiPort),WB_ALLOW_LOCAL_GIT:'1'},stdio:['ignore','pipe','pipe']});server.stdout.on('data',c=>serverLog+=c);server.stderr.on('data',c=>serverLog+=c);
  for(let i=0;i<200;i++){try{if((await fetch(origin)).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));if(i===199)assert.fail(serverLog);}
  assert.equal((await (await fetch(origin+'/repository-api/v1/capabilities')).json()).executionEnabled,true,'Normal startup must enable test execution without a flag');
  const {chromium,expect}=createRequire(path.join(source,'package.json'))('@playwright/test');browser=await chromium.launch({chromiumSandbox:true});context=await browser.newContext({viewport:{width:1440,height:1000}});await context.tracing.start({screenshots:true,snapshots:true,sources:true});page=await context.newPage();page.setDefaultTimeout(25000);
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&r.url().startsWith(origin))writes.push({path:new URL(r.url()).pathname,input:r.postDataJSON()});});
  const ready=()=>expect(page.locator('#content')).toHaveAttribute('aria-busy','false');
  async function tab(name){await page.getByRole('button',{name,exact:true}).click();await ready();}
  await page.goto(origin);await page.locator('#bind-sidebar').click();const dialog=page.getByRole('dialog');
  await dialog.getByLabel('Spec Repo Git 網址',{exact:true}).fill(remote);await dialog.getByLabel('顯示名稱（選填，自動從網址帶入）',{exact:true}).fill('既有規格與回歸');await dialog.getByLabel('需求確認者',{exact:true}).fill('UI reviewer');
  await dialog.getByRole('textbox',{name:'Spec Repo 本地目錄',exact:true}).fill(selectedLocalPath);
  await page.screenshot({path:path.join(artifacts,'00-custom-directory.png'),fullPage:true});
  await dialog.getByRole('button',{name:'開始使用',exact:true}).click();await expect(dialog).not.toBeVisible();await ready();
  await expect(page.locator('#binding-status')).toContainText('已連接');await expect(page.locator('#feature-select option')).toHaveCount(3);
  const repositoryId=new URL(page.url()).searchParams.get('repo'),checkout=selectedLocalPath;
  await expect(page.locator('#binding-status')).toContainText(selectedLocalPath);
  assert.equal(await exists(path.join(home,'repositories',repositoryId,'repo')),false,'The selected directory is the only editing checkout');
  assert.equal((await git.modules(checkout))[0].actual,p1,'Binding restores the recorded product version, not newer main');
  await tab('驗收紀錄');await expect(page.locator('#run-list')).toContainText('RUN-history');
  await tab('需求流程');await page.locator('#feature-select').selectOption('REQ-102/title');await ready();
  await page.getByRole('button',{name:'5 驗收',exact:true}).click();await ready();
  await expect(page.locator('#feature-report-list .feature-report')).toHaveCount(1);await expect(page.locator('#feature-report-list')).toContainText('reports/REQ-102/title/RUN-history/manifest.json');
  await page.locator('#feature-report-list').getByRole('button',{name:'檢視證據',exact:true}).click();
  await expect(page.locator('#feature-report-view')).toHaveAttribute('data-run-id','RUN-history');
  await page.screenshot({path:path.join(artifacts,'06-imported-requirement-report.png'),fullPage:true});
  await page.locator('#feature-select').selectOption('REQ-101/readiness');await ready();await expect(page.locator('#feature-report-list .feature-report')).toHaveCount(0);await expect(page.locator('#feature-report-view')).not.toBeVisible();
  await page.getByRole('button',{name:'1 需求',exact:true}).click();await ready();

  await tab('版本與回歸');await expect(page.locator('#catalog-count')).toContainText('3 個功能');
  await page.locator('#catalog-features').getByRole('button',{name:'設計',exact:true}).first().click();await expect(page.locator('#catalog-source')).toContainText('Historical design');
  await page.screenshot({path:path.join(artifacts,'01-bound-catalog.png'),fullPage:true});
  await page.getByLabel('規格與測試版本',{exact:true}).fill('release-v1');await page.getByLabel('規格與測試版本',{exact:true}).press('Tab');await expect(page.locator('#catalog-count')).toContainText('2 個功能');
  const originalHead=await git.resolve(checkout), originalStatus=await git.inspect(checkout);
  async function startAndWait(click,expected,{consent=false,during}={}) {
    const before=await page.locator('#notice').getAttribute('data-job-id');await click();
    if(consent){await expect(dialog).toContainText('安裝必要套件並繼續');await dialog.getByRole('button',{name:'安裝並繼續',exact:true}).click();}
    if(during){await expect(page.locator('.regression-card').first()).toContainText('RUNNING',{timeout:60000});await during();}
    await page.waitForFunction(previous=>{const n=document.querySelector('#notice');return n.dataset.operation==='regression.start'&&n.dataset.jobId&&n.dataset.jobId!==previous;},before,{timeout:480000});
    await expect(page.locator('#notice')).toHaveAttribute('data-outcome','SUCCEEDED');await expect(page.locator('#regression-status')).toContainText(expected);
  }
  await startAndWait(()=>page.getByRole('button',{name:'執行全部回歸測試',exact:true}).click(),'FAILED',{consent:true});
  let latest=page.locator('.regression-card').first();await expect(latest).toContainText('通過 1 / 全部 2');await expect(latest).toContainText('頁面標題 · PASSED');await expect(latest).toContainText(p1);
  const firstBatch=await latest.getAttribute('data-batch-id');await page.screenshot({path:path.join(artifacts,'02-old-product-failed.png'),fullPage:true});
  assert.deepEqual(await git.inspect(checkout),originalStatus);
  await page.getByLabel('規格與測試版本',{exact:true}).fill('main');await page.getByLabel('規格與測試版本',{exact:true}).press('Tab');await expect(page.locator('#catalog-count')).toContainText('3 個功能');
  await page.getByLabel('產品 product 的版本',{exact:true}).fill('main');
  let savedDuringRun;
  await startAndWait(()=>page.getByRole('button',{name:'執行全部回歸測試',exact:true}).click(),'PASSED',{during:async()=>{
    await tab('需求流程');const lower=page.getByRole('textbox',{name:'Gherkin',exact:true});savedDuringRun=(await lower.inputValue())+'# saved while a frozen regression runs\n';await lower.fill(savedDuringRun);
    await page.locator('#save-requirement').click();await expect(page.locator('#requirement-state')).toHaveText('已儲存');await ready();
    await tab('版本與回歸');
  }});
  latest=page.locator('.regression-card').first();await expect(latest).toContainText('通過 3 / 全部 3');await expect(latest).toContainText(p2);await expect(latest).toContainText(s2);
  const secondBatch=await latest.getAttribute('data-batch-id');await page.screenshot({path:path.join(artifacts,'03-new-product-passed.png'),fullPage:true});
  assert.equal(await git.resolve(checkout),originalHead);assert.equal((await git.modules(checkout))[0].actual,p1);
  // Replaying the first suite uses its frozen commits, not today's product main.
  await startAndWait(()=>page.locator(`[data-batch-id="${firstBatch}"]`).getByRole('button',{name:'相同版本重跑',exact:true}).click(),'FAILED');
  await expect(page.locator('.regression-card').first()).toContainText(p1);await expect(page.locator('.regression-card').first()).toContainText(s1);
  const db=new DatabaseSync(path.join(home,'metadata.sqlite'),{readOnly:true});
  const rows=db.prepare('SELECT result_json FROM regressions ORDER BY updated_at').all().map(x=>JSON.parse(x.result_json));
  assert.deepEqual(rows.map(r=>r.outcome),['FAILED','PASSED','FAILED']);assert.deepEqual(rows.map(r=>r.results.length),[2,3,2]);
  assert.ok(rows.every(r=>r.results.every(x=>x.runId)));assert.ok(rows.every(r=>r.results.every(x=>x.verification!=='VERIFIED')),'Regression must not approve unreviewed requirements');
  assert.equal(db.prepare("SELECT content FROM authoring_files WHERE repository_id=? AND path='spec/REQ-101/readiness/readiness.feature'").get(repositoryId).content,savedDuringRun);
  const edited=db.prepare("SELECT content FROM authoring_files WHERE repository_id=? AND path='spec/REQ-101/review.json'").get(repositoryId);assert.deepEqual(JSON.parse(edited.content).features,{});db.close();
  // Choose a second, already-existing clone through the same centralized settings.
  // Its unrelated staged draft must survive; SQLite drafts/history stay with the binding.
  const existingPath=path.join(base,'existing-spec');await git.clone(remote,existingPath);
  await writeFile(path.join(existingPath,'existing-staged.txt'),'preserve existing draft');await git.command(existingPath,['add','--','existing-staged.txt']);
  const existingBefore=await git.inspect(existingPath),oldBefore=await git.inspect(checkout);
  await tab('設定');await expect(page.getByRole('textbox',{name:'Spec Repo 本地目錄',exact:true})).toHaveValue(await realpath(selectedLocalPath));
  await page.getByRole('textbox',{name:'Spec Repo 本地目錄',exact:true}).fill(existingPath);
  await page.getByRole('button',{name:'儲存設定',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#notice').dataset.operation==='repository.location'&&document.querySelector('#notice').dataset.outcome==='SUCCEEDED');await ready();
  await expect(page.getByRole('textbox',{name:'Spec Repo 本地目錄',exact:true})).toHaveValue(await realpath(existingPath));
  assert.deepEqual(await git.inspect(checkout),oldBefore);
  assert.deepEqual(await git.inspect(existingPath),existingBefore);
  await page.screenshot({path:path.join(artifacts,'05-local-directory-settings.png'),fullPage:true});
  await tab('需求流程');await expect(page.getByRole('textbox',{name:'Gherkin',exact:true})).toHaveValue(savedDuringRun);
  await tab('版本與回歸');
  await page.reload();await ready();await expect(page.locator('.regression-card')).toHaveCount(3);
  await expect(page.locator('#binding-status')).toContainText(existingPath);

  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(artifacts,'04-regression-mobile.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  // CLI regression uses the same fixed-version engine and meaningful process exits.
  async function workflowCli(args,label) {
    const output=await execute(process.execPath,[path.join(toolkitRoot,'scripts/bdd.mjs'),'workflow',...args],{cwd:toolkitRoot,env:{...env,WB_HOME:home,WB_ALLOW_LOCAL_GIT:'1'},timeoutMs:480000});
    await writeJson(path.join(artifacts,`cli-${label}.json`),output);return {...output,value:JSON.parse(output.stdout)};
  }
  const paused=await workflowCli(['next','--repo',repositoryId,'--feature','REQ-102/title'],'human-gate');assert.equal(paused.exitCode,2);assert.equal(paused.value.result.requiredReview,'gherkin');
  const replay=await workflowCli(['regress','--repo',repositoryId,'--rerun',firstBatch],'failed-replay');assert.equal(replay.exitCode,1,replay.stdout+replay.stderr);assert.equal(replay.value.result.outcome,'FAILED');assert.equal(replay.value.result.testedSpecCommit,s1);assert.equal(replay.value.result.projects[0].commit,p1);
  const passed=await workflowCli(['regress','--repo',repositoryId,'--spec',s2,'--project',`product=${p2}`],'passed-regression');assert.equal(passed.exitCode,0,passed.stdout+passed.stderr);assert.equal(passed.value.result.counts.passed,3);assert.ok(passed.value.result.results.every(r=>r.verification!=='VERIFIED'));
  await page.reload();await ready();await expect(page.locator('.regression-card')).toHaveCount(5);
  assert.deepEqual(await git.inspect(existingPath),existingBefore);
  assert.deepEqual(errors,[]);assert.ok(writes.filter(x=>x.path.endsWith('/operations')).every(x=>!x.input.operation.startsWith('git.')));
  await writeJson(path.join(artifacts,'regression-ui-receipt.json'),{repositoryId,firstBatch,secondBatch,specVersions:{s1,s2},productVersions:{p1,p2},outcomes:rows.map(r=>r.outcome),noCheckoutMutation:true,noImplicitApproval:true,uiWrites:writes.length});
});
