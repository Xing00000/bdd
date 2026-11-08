import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {fixture,toolkitRoot,git} from '../workstation/helpers.mjs';
import {createStandaloneServer} from '../../packages/workstation/http.mjs';

test('UI deletion confirms, persists, selects remaining requirements and supports deleting the last one',async t=>{
  const f=await fixture(t),app=await createStandaloneServer({home:f.home,toolkitRoot,autoAcquire:false,allowLocal:true});t.after(()=>app.close());
  await git.command(undefined,['init','--bare','--initial-branch','main',f.remote]);
  const repositoryId='SPEC-delete-ui';app.service.register({id:repositoryId,title:'Delete UI',remoteUrl:f.remote});let sequence=0;
  const job=async(operation,input)=>{const operationId=`OP-delete-ui-${++sequence}`;app.service.enqueue({schemaVersion:1,operationId,repositoryId,operation,input});const result=await app.service.wait(operationId);assert.equal(result.status,'SUCCEEDED',JSON.stringify(result.error));};
  await job('repository.setup',{reviewer:'Human',projects:[]});await job('workflow.create',{requirementId:'REQ-001',featureId:'first',title:'First'});await job('workflow.create',{requirementId:'REQ-002',featureId:'second',title:'Second'});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${app.server.address().port}`;
  const browser=await chromium.launch();t.after(()=>browser.close());const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${origin}/?repo=${repositoryId}&view=features&feature=REQ-001%2Ffirst`);await expect(page.locator('#content')).toHaveAttribute('aria-busy','false');
  const remove=page.getByRole('button',{name:'刪除需求',exact:true}),dialog=page.getByRole('dialog');await remove.click();await expect(dialog).toContainText('First');await expect(dialog).toContainText('spec/REQ-001/first/feature.yaml');await dialog.getByRole('button',{name:'取消',exact:true}).click();assert.equal((await app.service.detail(repositoryId)).spec.features.length,2);
  await remove.click();await dialog.getByRole('button',{name:'刪除需求',exact:true}).click();await expect(page.locator('#feature-select option')).toHaveCount(1);await expect(page.locator('#feature-select')).toHaveValue('REQ-002/second');
  await page.reload();await expect(page.locator('#feature-select option')).toHaveCount(1);assert.ok(JSON.parse((await app.service.readFile(repositoryId,'spec/REQ-001/first/feature.yaml')).content).deletedAt);
  await remove.click();await dialog.getByRole('button',{name:'刪除需求',exact:true}).click();await expect(page.locator('#feature-select option')).toHaveCount(0);await expect(remove).toBeHidden();await expect(page.locator('#requirement-gherkin')).toBeEditable();
  await page.locator('#requirement-gherkin').fill('Feature: New\n\n  @case:CASE-001\n  Scenario: Save\n    Given a new requirement\n');await page.locator('#save-requirement').click();await expect(page.locator('#feature-select option')).toHaveCount(1);assert.equal((await app.service.detail(repositoryId)).spec.features[0].requirementId,'REQ-003');assert.deepEqual(errors,[]);
});
