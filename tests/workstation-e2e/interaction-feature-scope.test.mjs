import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {fixture,toolkitRoot,git} from '../workstation/helpers.mjs';
import {createStandaloneServer} from '../../packages/workstation/http.mjs';

test('history and terminal follow the selected feature, ignore late responses, and follow a saved new draft',{timeout:60000},async t=>{
  const f=await fixture(t),agent=path.join(f.base,'history-peer.mjs');
  await git.command(undefined,['init','--bare','--initial-branch','main',f.remote]);
  // A real PTY peer supplies repeatable transcript data; this test checks history ownership, not model inference.
  await writeFile(agent,`import {readFile,writeFile} from 'node:fs/promises';const {task}=JSON.parse(await readFile(process.argv[2],'utf8'));console.log('TRANSCRIPT '+task.key);await writeFile(task.output,'Feature: History draft\\n  A user can inspect history.\\n\\n  @case:CASE-001\\n  Scenario: Read history\\n    Given history is available\\n');`);
  const app=await createStandaloneServer({home:f.home,toolkitRoot,autoAcquire:false,allowLocal:true,enableExecution:true});t.after(()=>app.close());const repositoryId='SPEC-history-ui';app.service.register({id:repositoryId,title:'Feature history',remoteUrl:f.remote});let sequence=0;
  const job=async(operation,input)=>{const operationId=`OP-history-ui-${++sequence}`;app.service.enqueue({schemaVersion:1,operationId,repositoryId,operation,input});const result=await app.service.wait(operationId);assert.equal(result.status,'SUCCEEDED',JSON.stringify(result.error));return result;};
  await job('repository.setup',{reviewer:'Human',projects:[],agent:{command:process.execPath,args:[agent,'{task}']}});
  for(const [requirementId,featureId,title] of [['REQ-001','a','Alpha'],['REQ-002','b','Beta']])await job('workflow.create',{requirementId,featureId,title});
  const generated=[];
  for(const editorKey of ['REQ-001/a','REQ-002/b']){const source={editorKey,description:editorKey,previousGherkin:''},preview=await app.service.agentPreview(repositoryId,{purpose:'gherkin',...source});generated.push(await job('workflow.gherkin.generate',{...source,...preview}));}
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${app.server.address().port}`;
  const browser=await chromium.launch();t.after(()=>browser.close());const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const cards=page.locator('#interaction-list > article'),terminal=page.locator('#operation-terminal-details');
  await page.goto(`${origin}/?repo=${repositoryId}&view=features&feature=REQ-001%2Fa`);await expect(cards).toHaveCount(1);await expect(cards.first()).toHaveAttribute('data-interaction-id',generated[0].id);await expect(terminal).toHaveAttribute('data-operation-id',generated[0].id);
  await page.locator('#feature-select').selectOption('REQ-002/b');await expect(cards).toHaveCount(1);await expect(cards.first()).toHaveAttribute('data-interaction-id',generated[1].id);await expect(terminal).toHaveAttribute('data-operation-id',generated[1].id);
  await page.getByRole('button',{name:'2 系統設計',exact:true}).click();await expect(page.locator('#content')).toHaveAttribute('aria-busy','false');await expect(cards).toHaveCount(0);
  let release,seen;const hold=new Promise(r=>release=r),requested=new Promise(r=>seen=r);
  await page.route('**/interactions?*',async route=>{if(new URL(route.request().url()).searchParams.get('key')==='REQ-001/a'){seen();await hold;}await route.continue();});
  await page.locator('#feature-select').selectOption('REQ-001/a');await requested;await page.goBack();await expect(page.locator('#feature-select')).toHaveValue('REQ-002/b');release();await expect(page.locator('#content')).toHaveAttribute('aria-busy','false');await expect(cards).toHaveCount(0);await page.unroute('**/interactions?*');
  await page.locator('#new-feature').click();await page.locator('#requirement-description').fill('A new requirement');await page.getByRole('button',{name:'LLM 生成 Gherkin',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'送出',exact:true}).click();await expect(page.locator('#content')).toHaveAttribute('aria-busy','false');await expect(cards).toHaveCount(1);
  const draftId=await cards.first().getAttribute('data-interaction-id');assert.ok(!generated.some(g=>g.id===draftId));await page.locator('#save-requirement').click();await expect(page.locator('#feature-select')).toHaveValue('REQ-003/feature');await expect(cards).toHaveCount(1);await expect(cards.first()).toHaveAttribute('data-interaction-id',draftId);await page.reload();await expect(cards).toHaveCount(1);await expect(cards.first()).toHaveAttribute('data-interaction-id',draftId);assert.deepEqual(errors,[]);
});
