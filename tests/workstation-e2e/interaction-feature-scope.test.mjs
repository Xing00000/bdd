import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {fixture,toolkitRoot,git} from '../workstation/helpers.mjs';
import {createStandaloneServer} from '../../packages/workstation/http.mjs';

test('completed transcripts remain in SQLite while feature switches and new drafts never display interaction history',{timeout:60000},async t=>{
  const f=await fixture(t);
  await git.command(undefined,['init','--bare','--initial-branch','main',f.remote]);
  const app=await createStandaloneServer({home:f.home,toolkitRoot,autoAcquire:false,allowLocal:true,enableExecution:false});t.after(()=>app.close());const repositoryId='SPEC-history-ui';app.service.register({id:repositoryId,title:'Feature history',remoteUrl:f.remote});let sequence=0;
  const job=async(operation,input,expectedStatus='SUCCEEDED')=>{const operationId=`OP-history-ui-${++sequence}`;app.service.enqueue({schemaVersion:1,operationId,repositoryId,operation,input});const result=await app.service.wait(operationId);assert.equal(result.status,expectedStatus,JSON.stringify(result.error));return result;};
  await job('repository.setup',{reviewer:'Human',projects:[],agent:{runtime:'codex-sdk'}});
  for(const [requirementId,featureId,title] of [['REQ-001','a','Alpha'],['REQ-002','b','Beta']])await job('workflow.create',{requirementId,featureId,title});
  const generated=[];
  for(const editorKey of ['REQ-001/a','REQ-002/b']){const source={editorKey,description:editorKey,previousGherkin:''},preview=await app.service.agentPreview(repositoryId,{purpose:'gherkin',...source});const result=await job('workflow.gherkin.generate',{...source,...preview},'FAILED');assert.equal(result.error.code,'EXECUTION_DISABLED');generated.push(result);}
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${app.server.address().port}`;
  const browser=await chromium.launch();t.after(()=>browser.close());const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const absent=page.locator('#interaction-history, #interaction-list'),terminal=page.locator('#active-operation');
  await page.goto(`${origin}/?repo=${repositoryId}&view=features&feature=REQ-001%2Fa`);
  await expect(page.locator('#content')).toHaveAttribute('aria-busy','false');
  await expect(absent).toHaveCount(0);await expect(terminal).toBeHidden();
  await page.locator('#feature-select').selectOption('REQ-002/b');
  await expect(page.locator('#content')).toHaveAttribute('aria-busy','false');
  await expect(absent).toHaveCount(0);await expect(terminal).toBeHidden();
  for(const [key,result] of [['REQ-001/a',generated[0]],['REQ-002/b',generated[1]]]){const entry=app.service.interactions(repositoryId,{type:'GHERKIN',key}).entries[0];assert.equal(entry.id,result.id);assert.ok(result.request.input.prompt.startsWith(entry.message));assert.equal(app.service.interaction(result.id).message,result.request.input.prompt);assert.equal(app.service.operation(result.id).request.input.description,key);assert.equal(entry.interactionKey,key);assert.equal(entry.status,'FAILED');}
  await page.getByRole('button',{name:'2 系統設計',exact:true}).click();await expect(page.locator('#content')).toHaveAttribute('aria-busy','false');await expect(absent).toHaveCount(0);
  await page.locator('#feature-select').selectOption('REQ-001/a');await expect(page.locator('#content')).toHaveAttribute('aria-busy','false');
  await page.goBack();await expect(page.locator('#feature-select')).toHaveValue('REQ-002/b');await expect(absent).toHaveCount(0);await expect(terminal).toBeHidden();
  await page.locator('#new-feature').click();
  const draft='Feature: New manual requirement\n  @case:CASE-001\n  Scenario: Save draft\n    Given a new draft is entered\n';
  await page.locator('#requirement-gherkin').fill(draft);await page.locator('#save-requirement').click();
  await expect(page.locator('#feature-select')).toHaveValue('REQ-003/feature');await expect(absent).toHaveCount(0);await expect(terminal).toBeHidden();
  await page.reload();await expect(page.locator('#requirement-gherkin')).toHaveValue(draft);await expect(absent).toHaveCount(0);await expect(terminal).toBeHidden();
  for(const [key,result] of [['REQ-001/a',generated[0]],['REQ-002/b',generated[1]]]){const entry=app.service.interactions(repositoryId,{type:'GHERKIN',key}).entries[0];assert.equal(entry.id,result.id);assert.ok(result.request.input.prompt.startsWith(entry.message));assert.equal(app.service.interaction(result.id).message,result.request.input.prompt);assert.equal(app.service.operation(result.id).request.input.description,key);assert.equal(entry.interactionKey,key);assert.equal(entry.status,'FAILED');}
  assert.deepEqual(errors,[]);
});
