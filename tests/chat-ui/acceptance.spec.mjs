import {test as base,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {acceptanceFixture} from '../workstation/acceptance-fixture.mjs';
import config from '../../playwright.chat.config.ts';

// Provisioning installs dependencies and runs the pre-existing CLI/report.
// Give it its own finite budget, using the same canonical timeout as the UI test.
function workstation(passed){return [async({},use)=>{const fixture=await acceptanceFixture({passed});try{await use(fixture);}finally{await fixture.close();}},{timeout:config.timeout}];}
const test=base.extend({passingWorkstation:workstation(true),changesWorkstation:workstation(false)});

test('AC-WB-042 UIUX：真實 Playwright 報告等待人工驗收，通過後完成並保存',async({page,passingWorkstation:f},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(`${f.origin}/?repo=${f.repositoryId}&view=features&feature=REQ-001%2Flogin&stage=VERIFICATION`);
  await expect(page.getByRole('heading',{name:'Playwright 報告',exact:true})).toBeVisible();await expect(page.locator('#acceptance-status')).toHaveText('等待人工驗收');
  const frame=page.frameLocator('iframe[title="Playwright 測試報告"]');await expect(frame.getByRole('link',{name:/Passed/})).toContainText('1');
  await expect(page.getByRole('textbox',{name:'驗收意見',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'LLM 修改實作',exact:true})).toBeDisabled();
  const before=(await f.current()).workflow;expect(before.status).toBe('AWAITING_ACCEPTANCE');expect(before.acceptance).toBeNull();
  await page.getByRole('button',{name:'驗收通過',exact:true}).click();await expect(page.locator('#acceptance-status')).toHaveText('驗收通過，流程已完成');
  const after=(await f.current()).workflow;expect(after.status).toBe('COMPLETE');expect(after.acceptance.runId).toBe(before.latestReport.runId);expect(after.acceptance.message).toBe('');
  const url=page.url();await f.restart();await page.goto(url);await expect(page.locator('#acceptance-status')).toHaveText('驗收通過，流程已完成');await expect(page.getByRole('button',{name:'驗收通過',exact:true})).toBeDisabled();expect((await f.current()).workflow.acceptance).toEqual(after.acceptance);expect(errors).toEqual([]);
  await info.attach('UIUX：人工驗收後的實際畫面',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});await info.attach('UIUX：真實報告與人工確認前後狀態',{body:JSON.stringify({before,after,initialRun:f.initial.result},null,2),contentType:'application/json'});
 }finally{await info.attach('驗收測試原始碼',{body:await readFile(import.meta.filename),contentType:'text/plain'});}
});

test('AC-WB-041 UIUX：驗收意見進入真實 Codex 實作互動，修改後重新驗收',async({page,changesWorkstation:f},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(`${f.origin}/?repo=${f.repositoryId}&view=features&feature=REQ-001%2Flogin&stage=VERIFICATION`);
  await expect(page.getByRole('heading',{name:'Playwright 報告',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'驗收通過',exact:true})).toBeDisabled();
  const before=await f.current(),reportCount=before.workflow.reports.length;
  const message='請讀取 workbench MCP 任務與必要產物，依已確認規格修正產品。將產品 label.txt 的按鈕文字改為「登入」，保留換行；只修改該產品檔案，不變更需求、設計、測試或工作站設定。';
  await page.getByRole('textbox',{name:'驗收意見',exact:true}).fill(message);await page.getByRole('button',{name:'LLM 修改實作',exact:true}).click();
  await expect(page.locator('#implementation-panel')).toBeVisible();await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(f.priorInteractions.length).toBeGreaterThan(0);await expect(page.locator('#interaction-list > article')).toHaveCount(f.priorInteractions.length+1);await expect(page.locator('#interaction-list')).toContainText(message);
  const operations=(await f.app.service.detail(f.repositoryId)).operations,submitted=operations.find(o=>o.request.operation==='workflow.develop'&&o.request.input.acceptanceFeedback);
  expect(submitted.request.input.prompt).toBe(message);expect(submitted.request.input.acceptanceFeedback.runId).toBe(f.initial.result.runId);
  const result=await f.app.service.wait(submitted.id,180000);expect(result.status,JSON.stringify(result.error)).toBe('SUCCEEDED');expect(result.result.testOutcome).toBe('PASSED');expect(result.result.verification).toBe('VERIFIED');
  await expect(page.locator('#verification-panel')).toBeVisible({timeout:15000});await expect(page.locator('#acceptance-status')).toHaveText('等待人工驗收');
  const after=await f.current();expect(after.workflow.status).toBe('AWAITING_ACCEPTANCE');expect(after.workflow.acceptance).toBeNull();expect(after.workflow.reports.length).toBeGreaterThan(reportCount);expect(after.workflow.reports.some(r=>r.runId===f.initial.result.runId)).toBe(true);
  expect(after.review.hashes).toEqual(before.review.hashes);expect(after.review.confirmed).toEqual(before.review.confirmed);
  expect((await f.app.service.readProjectFile(f.repositoryId,'product','label.txt')).content).toBe('登入\n');
  const interactions=f.app.service.interactions(f.repositoryId,{type:'IMPLEMENTATION'});expect(interactions.entries.some(e=>e.id===submitted.id&&e.message===message)).toBe(true);for(const old of f.priorInteractions)expect(interactions.entries.some(e=>e.id===old.id&&e.message===old.message)).toBe(true);
  await page.getByRole('button',{name:'4 開發實作',exact:true}).click();await expect(page.locator(`[data-interaction-id="${submitted.id}"]`)).toBeVisible();await page.reload();await expect(page.locator(`[data-interaction-id="${submitted.id}"]`)).toBeVisible();
  expect(errors).toEqual([]);await info.attach('UIUX：實作互動與原始驗收意見',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});await info.attach('UIUX：真實 Codex、產品修改與獨立 Playwright 重驗結果',{body:JSON.stringify({message,before:before.workflow,after:after.workflow,operation:result,interactions},null,2),contentType:'application/json'});
 }finally{await info.attach('驗收修改測試原始碼',{body:await readFile(import.meta.filename),contentType:'text/plain'});}
});


test('AC-WB-041 UIUX：歷史清單各自展開真實 Playwright 報告，保留目前報告',async({page,passingWorkstation:f},info)=>{
 const second=await f.job('workflow.verify',f.ids);expect(second.status,JSON.stringify(second.error)).toBe('SUCCEEDED');expect(second.result.testOutcome).toBe('PASSED');
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`${f.origin}/?repo=${f.repositoryId}&view=features&feature=REQ-001%2Flogin&stage=VERIFICATION`);
 await expect(page.locator('#feature-report-view')).toHaveAttribute('data-run-id',second.result.runId);
 const primary=page.locator('#feature-report-view iframe'),primaryUrl=await primary.getAttribute('src');await expect(page.locator('#feature-report-list iframe')).toHaveCount(0);
 await page.locator('.report-history > summary').click();
 for(const runId of [f.initial.result.runId,second.result.runId]){
  const card=page.locator(`#feature-report-list [data-run-id="${runId}"]`),details=card.locator('.historical-native-report');
  await details.locator(':scope > summary').click();await expect(details.locator('iframe')).toHaveCount(1);await expect(details.locator('iframe')).toHaveAttribute('src',new RegExp(`/runs/${runId}/report/`));
  await expect(details.frameLocator('iframe').getByRole('link',{name:/Passed/})).toContainText('1');await expect(details.locator('iframe')).toHaveAttribute('sandbox','allow-scripts');
  await details.locator(':scope > summary').click();await details.locator(':scope > summary').click();await expect(details.locator('iframe')).toHaveCount(1);
 }
 await expect(page.locator('#feature-report-list iframe')).toHaveCount(2);await expect(primary).toHaveAttribute('src',primaryUrl);await expect(page.locator('#feature-report-view')).toHaveAttribute('data-run-id',second.result.runId);await expect(page.locator('#acceptance-status')).toHaveText('等待人工驗收');expect(errors).toEqual([]);
 await info.attach('UIUX：歷史報告各自展開',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});await info.attach('報告識別與目前驗收狀態',{body:JSON.stringify({oldRun:f.initial.result.runId,currentRun:second.result.runId,primaryUrl,workflow:(await f.current()).workflow},null,2),contentType:'application/json'});
});
