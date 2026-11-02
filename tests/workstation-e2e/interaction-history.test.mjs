import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {rm,mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {fixture,toolkitRoot} from '../workstation/helpers.mjs';
import {createStandaloneServer} from '../../packages/workstation/http.mjs';

test('two real submissions retain separate collapsible SQL logs after page and server restart', {timeout:90000},async t=>{
  const f=await fixture(t),options={home:f.home,toolkitRoot,allowLocal:true,autoAcquire:false,enableExecution:false};
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
  const first=page.locator(`[data-interaction-id="${ids[0]}"]`),second=page.locator(`[data-interaction-id="${ids[1]}"]`);
  await expect(page.locator('#interaction-list > article').first()).toHaveAttribute('data-interaction-id',ids[1]);
  const beforeOlder=await page.locator('#interaction-list > article').count();await page.locator('#interaction-more').click();
  await expect.poll(()=>page.locator('#interaction-list > article').count()).toBeGreaterThan(beforeOlder);
  await expect(page.locator('#interaction-list > article').first()).toHaveAttribute('data-interaction-id',ids[1]);
  await expect(first.locator('.interaction-message')).toHaveText('First independent message');await expect(second.locator('.interaction-message')).toHaveText('Second independent message');
  await expect(first.locator('details')).toHaveJSProperty('open',true);await first.locator('summary').click();await expect(first.locator('details')).toHaveJSProperty('open',false);await expect(second.locator('details')).toHaveJSProperty('open',true);
  await first.locator('summary').click();await expect(first.locator('.interaction-log')).toContainText('[SUCCEEDED]');
  await app.close();await rm(path.join(f.home,'development'),{recursive:true,force:true});
  app=await createStandaloneServer(options);await new Promise(resolve=>app.server.listen(port,'127.0.0.1',resolve));await page.reload();
  await expect(page.locator('#interaction-list > article').first()).toHaveAttribute('data-interaction-id',ids[1]);
  await expect(first.locator('.interaction-message')).toHaveText('First independent message');await expect(second.locator('.interaction-message')).toHaveText('Second independent message');
  await first.locator('summary').click();await second.locator('summary').click();
  await expect(first.locator('.interaction-log')).toContainText('[SUCCEEDED]');await expect(second.locator('.interaction-log')).toContainText('[SUCCEEDED]');
  const artifacts=path.resolve('.runtime/interaction-history-ui');await mkdir(artifacts,{recursive:true});await page.screenshot({path:path.join(artifacts,'interaction-history.png'),fullPage:true});assert.deepEqual(errors,[]);
});
