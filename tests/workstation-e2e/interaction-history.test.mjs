import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {rm,mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {fixture,toolkitRoot,git} from '../workstation/helpers.mjs';
import {createStandaloneServer} from '../../packages/workstation/http.mjs';

test('LLM requests retain stage-scoped collapsible logs while saves stay absent after restart', {timeout:90000},async t=>{
  const f=await fixture(t),options={home:f.home,toolkitRoot,allowLocal:true,autoAcquire:false,enableExecution:false};
  await git.command(undefined,['init','--bare','--initial-branch','main',f.remote]);
  let app=await createStandaloneServer(options);t.after(()=>app.close());await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const port=app.server.address().port,origin=`http://127.0.0.1:${port}`;
  app.service.register({id:'SPEC-history-ui',title:'History UI',remoteUrl:f.remote});
  const job=async(operation,input)=>{const operationId=`OP-${crypto.randomUUID()}`;app.service.enqueue({schemaVersion:1,operationId,repositoryId:'SPEC-history-ui',operation,input});const result=await app.service.wait(operationId);assert.equal(result.status,'SUCCEEDED',JSON.stringify(result.error));};
  await job('repository.setup',{reviewer:'Human',projects:[]});await job('workflow.create',{requirementId:'REQ-001',featureId:'history',title:'History'});
  for(let index=0;index<25;index++)app.service.generateRequirement('SPEC-history-ui',{editorKey:'REQ-001/history',description:`Earlier requirement ${index}`,previousGherkin:''});
  const browser=await chromium.launch();t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${origin}/?repo=SPEC-history-ui&view=features&feature=REQ-001%2Fhistory&stage=GHERKIN`);
  await expect(page.locator('#content')).toHaveAttribute('aria-busy','false');
  const ids=[];
  for(const message of ['First independent message','Second independent message']) {
    await page.getByRole('textbox',{name:'需求描述',exact:true}).fill(message);
    await page.getByRole('textbox',{name:'Gherkin',exact:true}).fill('Feature: History\n  @case:CASE-001\n  Scenario: Review history\n    Given a submission is saved\n    Then its log remains available\n');
    const previous=await page.locator('#notice').getAttribute('data-job-id');await page.locator('#save-requirement').click();
    await page.waitForFunction(before=>{const node=document.querySelector('#notice');return node.dataset.jobId&&node.dataset.jobId!==before&&node.dataset.operation==='workflow.requirement.save';},previous);
    await expect(page.locator('#notice')).toHaveAttribute('data-outcome','SUCCEEDED');await expect(page.locator('#content')).toHaveAttribute('aria-busy','false');
    ids.push(await page.locator('#notice').getAttribute('data-job-id'));
  }
  await expect(page.locator('#interaction-list > article')).toHaveCount(0);
  for(const id of ids)assert.equal(app.service.operation(id).isLlmInteraction,false);
  // Real service requests retain failed LLM attempts too, even when preflight
  // blocks execution. No agent output or successful dispatch is fabricated.
  const taskIds=[];
  for(const prompt of ['First LLM request','Second LLM request']) {
    const operationId=`OP-${crypto.randomUUID()}`;
    app.service.enqueue({schemaVersion:1,operationId,repositoryId:'SPEC-history-ui',operation:'workflow.tests.complete',input:{requirementId:'REQ-001',featureId:'history',prompt}});
    const result=await app.service.wait(operationId);assert.equal(result.status,'FAILED');taskIds.push(operationId);
  }
  await page.goto(`${origin}/?repo=SPEC-history-ui&view=features&feature=REQ-001%2Fhistory&stage=TESTS`);
  const first=page.locator(`[data-interaction-id="${taskIds[0]}"]`),second=page.locator(`[data-interaction-id="${taskIds[1]}"]`);
  await expect(page.locator('#interaction-list > article')).toHaveCount(2);
  await expect(page.locator('#interaction-list > article').first()).toHaveAttribute('data-interaction-id',taskIds[1]);
  await expect(first.locator('.interaction-message')).toHaveText('First LLM request');await expect(second.locator('.interaction-message')).toHaveText('Second LLM request');
  await first.locator('summary').click();await expect(first.locator('details')).toHaveJSProperty('open',true);
  await expect(first.locator('.interaction-log')).toContainText('[FAILED]');await first.locator('summary').click();
  await page.getByRole('button',{name:'1 需求確認',exact:true}).click();await expect(page.locator('#content')).toHaveAttribute('aria-busy','false');
  await page.getByRole('button',{name:'確認需求並繼續',exact:true}).click();await expect(page.locator('#phase-title')).toHaveText('設計');await expect(page.locator('#content')).toHaveAttribute('aria-busy','false');
  await expect(page.locator('#interaction-list > article')).toHaveCount(0);
  await page.locator('#design-edit-button').click();
  await page.locator('#source-editor').fill('# A design save is not an LLM interaction');
  const beforeDesign=await page.locator('#notice').getAttribute('data-job-id');await page.locator('#design-controls #save-source').click();
  await page.waitForFunction(previous=>document.querySelector('#notice').dataset.jobId!==previous,beforeDesign);
  await expect(page.locator('#content')).toHaveAttribute('aria-busy','false');
  await expect(page.locator('#interaction-list > article')).toHaveCount(0);
  await page.getByRole('button',{name:'3 測試計劃',exact:true}).click();await expect(second.locator('.interaction-message')).toHaveText('Second LLM request');
  await app.close();await rm(path.join(f.home,'development'),{recursive:true,force:true});
  app=await createStandaloneServer(options);await new Promise(resolve=>app.server.listen(port,'127.0.0.1',resolve));await page.reload();
  await expect(page.locator('#interaction-list > article').first()).toHaveAttribute('data-interaction-id',taskIds[1]);
  await expect(first.locator('.interaction-message')).toHaveText('First LLM request');await expect(second.locator('.interaction-message')).toHaveText('Second LLM request');
  await first.locator('summary').click();await second.locator('summary').click();
  await expect(first.locator('.interaction-log')).toContainText('[FAILED]');await expect(second.locator('.interaction-log')).toContainText('[FAILED]');
  const artifacts=path.resolve('.runtime/interaction-history-ui');await mkdir(artifacts,{recursive:true});await page.screenshot({path:path.join(artifacts,'interaction-history.png'),fullPage:true});assert.deepEqual(errors,[]);
});
