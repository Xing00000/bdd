import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {fixture,toolkitRoot,git} from '../workstation/helpers.mjs';
import {createStandaloneServer} from '../../packages/workstation/http.mjs';

test('cancelling a requirement switch restores the selected requirement and keeps its unsaved draft',async t=>{
  const f=await fixture(t),app=await createStandaloneServer({home:f.home,toolkitRoot,autoAcquire:false,allowLocal:true});t.after(()=>app.close());
  await git.command(undefined,['init','--bare','--initial-branch','main',f.remote]);
  const repositoryId='SPEC-navigation-ui';app.service.register({id:repositoryId,title:'Navigation UI',remoteUrl:f.remote});let sequence=0;
  const job=async(operation,input)=>{const operationId=`OP-navigation-ui-${++sequence}`;app.service.enqueue({schemaVersion:1,operationId,repositoryId,operation,input});const result=await app.service.wait(operationId);assert.equal(result.status,'SUCCEEDED',JSON.stringify(result.error));};
  await job('repository.setup',{reviewer:'Human',projects:[]});
  await job('workflow.create',{requirementId:'REQ-001',featureId:'first',title:'First'});
  await job('workflow.create',{requirementId:'REQ-002',featureId:'second',title:'Second'});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch();t.after(()=>browser.close());const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?repo=${repositoryId}&view=features&feature=REQ-001%2Ffirst`);
  await expect(page.locator('#content')).toHaveAttribute('aria-busy','false');
  const select=page.locator('#feature-select'),description=page.locator('#requirement-description');
  await description.fill('First requirement unsaved draft');await select.selectOption('REQ-002/second');
  const dialog=page.getByRole('dialog');await expect(dialog).toContainText('有尚未儲存的編輯');await dialog.getByRole('button',{name:'取消',exact:true}).click();
  await expect(select).toHaveValue('REQ-001/first');await expect(description).toHaveValue('First requirement unsaved draft');
  assert.equal(new URL(page.url()).searchParams.get('feature'),'REQ-001/first');
  await page.locator('#save-requirement').click();await expect(page.locator('#requirement-state')).toHaveText('已儲存');
  await select.selectOption('REQ-002/second');await expect(page.locator('#content')).toHaveAttribute('aria-busy','false');await expect(dialog).not.toBeVisible();
  await expect(description).not.toHaveValue('First requirement unsaved draft');
  await select.selectOption('REQ-001/first');await expect(description).toHaveValue('First requirement unsaved draft');
  assert.deepEqual(errors,[]);
});
