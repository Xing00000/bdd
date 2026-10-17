import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../src/http/server.ts';

test('real UI switches dedicated Gherkin documents and phases, persists selection and adds a sibling',async t=>{
 const root=resolve(process.cwd());await mkdir(join(root,'.test-fixtures'),{recursive:true});
 const directory=await mkdtemp(join(root,'.test-fixtures/feature-ui-'));
 const server=await createServer({root,metadataFile:join(directory,'metadata.sqlite'),dataRoot:join(directory,'data'),baseUrl:'http://127.0.0.1:1'});
 const browser=await chromium.launch({headless:true,chromiumSandbox:true});
 t.after(async()=>{await browser.close();await server.app.close();await rm(directory,{recursive:true,force:true});});
 const address=await server.app.listen({host:'127.0.0.1',port:0});
 const project=await server.core.createProject({name:'Multiple Gherkin UI',workspaceRef:directory});
 const first=await server.core.createRequirement(project.id,{requirementKey:'REQ-UI'});
 const second=await server.core.createFeature(first.id,{featureKey:'checkout'});
 const g=await server.core.saveVersion(first.documents.gherkin.id,{rawText:'Feature: First\n @AC-UI-001\n Scenario: display\n  Given first source\n  Then first result\n'});
 await server.core.confirm(first.id,'gherkin',{featureId:first.featureId,versionId:g.versionId!,rawSha256:g.rawSha256!});
 const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`${address}/projects/${project.id}/requirements/${first.id}?featureId=${first.featureId}`);
 await expect(page.getByTestId('feature-select')).toHaveValue(first.featureId);
 await expect(page.getByTestId('workflow-stage')).toHaveText('SD確認');
 await page.getByTestId('feature-select').selectOption(second.featureId);
 await expect(page.getByTestId('workflow-stage')).toHaveText('Gherkin確認');
 await expect(page.getByTestId('confirmed-gherkin')).toContainText('尚未確認');
 await page.reload();await expect(page.getByTestId('feature-select')).toHaveValue(second.featureId);
 await page.getByRole('button',{name:'新增 Gherkin',exact:true}).click();
 await page.getByLabel('Gherkin 名稱（不含副檔名）').fill('refund');
 await page.getByRole('button',{name:'建立',exact:true}).click();
 await expect(page.getByTestId('feature-select').locator('option')).toHaveCount(3);
 await expect(page.getByTestId('feature-select').locator('option:checked')).toContainText('refund');
 for(const width of [320,768,1024,1440]){
  await page.setViewportSize({width,height:900});
  await expect(page.getByTestId('feature-select')).toBeVisible();
 }
 assert.deepEqual(errors,[]);
 const ambiguous=await page.request.get(`${address}/requirements/${first.id}`);assert.equal(ambiguous.status(),400);
 assert.equal((await ambiguous.json()).code,'FEATURE_REQUIRED');
});
