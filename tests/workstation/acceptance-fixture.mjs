import assert from 'node:assert/strict';
import path from 'node:path';
import {createServer as createPortProbe} from 'node:net';
import {writeFile,readFile} from 'node:fs/promises';
import {fixture,git,toolkitRoot,testBrowserRoot,repository,commitAll,approve} from './helpers.mjs';
import {initialize,createFeature} from '../../packages/spec-toolkit/index.mjs';
import {installDependencies} from '../../packages/workstation/repository-actions.mjs';
import {writeJson} from '../../packages/contracts/index.mjs';
import {createStandaloneServer} from '../../packages/workstation/http.mjs';

export async function acceptanceFixture({passed=false}={}){
 const cleanups=[],f=await fixture({after:fn=>cleanups.push(fn)}),repositoryId='SPEC-acceptance';
 let app;
 const close=async()=>{await app?.close();for(const cleanup of cleanups.splice(0).reverse())await cleanup();};
 try{
  const probe=createPortProbe();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  const product=path.join(f.base,'product');
  const source=`import http from 'node:http';import {readFileSync} from 'node:fs';
 const server=http.createServer((req,res)=>{if(req.url==='/health'){res.setHeader('content-type','application/json');res.end(JSON.stringify({commit:process.env.WB_SOURCE_COMMIT}));return;}res.setHeader('content-type','text/html; charset=utf-8');res.end('<!doctype html><html><h1>驗收測試產品</h1><button>'+readFileSync(new URL('./label.txt',import.meta.url),'utf8').trim()+'</button></html>');});server.listen(Number(process.argv[2]),'127.0.0.1');process.on('SIGTERM',()=>server.close());\n`;
  const productHead=await repository(product,{'server.mjs':source,'label.txt':passed?'登入\n':'開始\n'});
  await git.init(f.repo);await initialize(f.repo,{specRepositoryId:'acceptance-fixture',toolkitRoot:path.join(toolkitRoot,'packages'),templateRoot:path.join(toolkitRoot,'templates/spec-repo/v1')});
  const config=JSON.parse(await readFile(path.join(f.repo,'workbench.yaml'),'utf8'));config.projects=[{id:'product',path:'projects/product'}];config.execution={featureIsolation:'process',environment:{WB_TARGET_BASE_URL:`http://127.0.0.1:${port}`},service:{projectId:'product',command:[process.execPath,'server.mjs',String(port)],healthUrl:`http://127.0.0.1:${port}/health`}};await writeJson(path.join(f.repo,'workbench.yaml'),config);
  await createFeature(f.repo,{requirementId:'REQ-001',featureId:'login',title:'人工驗收流程',projectIds:['product']});
  await writeFile(path.join(f.repo,'spec/REQ-001/login/login.feature'),'Feature: 登入入口\n  @case:CASE-001\n  Scenario: 顯示登入按鈕\n    Given 使用者開啟產品頁面\n    Then 頁面顯示登入按鈕\n');
  await writeFile(path.join(f.repo,'spec/REQ-001/login/login.sd.md'),'# 登入入口\n由 server.mjs 顯示 label.txt 的按鈕文字。Playwright 直接檢查可見的登入按鈕。\n');
  await writeFile(path.join(f.repo,'tests/REQ-001/login/login.steps.ts'),"import {Given,Then} from '../../_shared/bdd';\nimport {expect} from '@playwright/test';\nGiven('使用者開啟產品頁面',async({page})=>{await page.goto('/');});\nThen('頁面顯示登入按鈕',async({page})=>{await expect(page.getByRole('button',{name:'登入',exact:true})).toBeVisible();});\n");
  await writeFile(path.join(f.repo,'tests/REQ-001/login/login.hooks.ts'),"import {AfterStep} from '../../_shared/bdd';\nAfterStep(async({page,$testInfo,$step})=>{await $testInfo.attach('step-'+$step.title,{body:await page.screenshot(),contentType:'image/png'});});\n");
  await commitAll(f.repo,'Authored acceptance fixture');await git.addModule(f.repo,{projectId:'product',url:product,commit:productHead},await git.inspect(f.repo));
  await installDependencies(f.repo,true);await approve(f.repo);
  const options={home:f.home,toolkitRoot,browserRoot:testBrowserRoot,allowLocal:true,enableExecution:true};
  app=await createStandaloneServer(options);
  const repo=app.service.register({id:repositoryId,title:'人工驗收工作站',remoteUrl:f.repo});assert.equal((await app.service.wait(repo.connection.operationId)).status,'SUCCEEDED');
  const job=async(operation,input={})=>{if(operation==='workflow.develop'){const preview=await app.service.agentPreview(repositoryId,{...input,purpose:'development'});input={...preview,...input,promptDigest:preview.promptDigest};}const operationId=`OP-${crypto.randomUUID()}`;app.service.enqueue({schemaVersion:1,operationId,repositoryId,operation,input});return app.service.wait(operationId,180000);};
  const setup=await job('repository.setup',{reviewer:'Playwright 人工驗收測試',projects:[{id:'product',url:product}],agent:{maxAttempts:1,timeoutMs:120000}});assert.equal(setup.status,'SUCCEEDED',JSON.stringify(setup.error));
  const ids={requirementId:'REQ-001',featureId:'login'};
  const initialOperation=passed?'workflow.verify':'workflow.develop',initialInput=passed?ids:{...ids,prompt:'請先讀取 workbench MCP 任務，檢查產品 label.txt 並回覆目前內容。本次僅查詢，不修改任何檔案；修改會在下一段互動提出。'};
  let initial=await job(initialOperation,initialInput);const consents=new Set();
  while(initial.error?.code==='INSTALL_REQUIRED'){
    const consent=initial.error.details.install.digest;assert(!consents.has(consent),'An approved installation must not repeat the same consent request');consents.add(consent);
    initial=await job(initialOperation,{...initialInput,installConsent:consent});
  }
  assert.equal(initial.status,'SUCCEEDED',JSON.stringify(initial.error));assert.equal(initial.result.testOutcome,passed?'PASSED':'FAILED');
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${app.server.address().port}`;
  return {...f,repositoryId,ids,origin,options,initial,job,priorInteractions:app.service.interactions(repositoryId,{type:'IMPLEMENTATION'}).entries,get app(){return app;},async restart(){const port=app.server.address().port;await app.close();app=await createStandaloneServer({...options,autoAcquire:false});await new Promise(r=>app.server.listen(port,'127.0.0.1',r));},current:async()=>(await app.service.detail(repositoryId)).spec.features.find(f=>f.key==='REQ-001/login'),close};
 }catch(error){await close();throw error;}
}
