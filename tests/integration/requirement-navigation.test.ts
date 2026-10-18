import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../src/http/server.ts';

test('fixed sidebar creates independent requirements, directly selects each workflow stage and preserves the selected workflow on reload',async t=>{
 const root=resolve(process.cwd());await mkdir(join(root,'.test-fixtures'),{recursive:true});const directory=await mkdtemp(join(root,'.test-fixtures/requirement-navigation-'));
 const workspace=join(directory,'workspace');await mkdir(workspace);
 const server=await createServer({root,metadataFile:join(directory,'metadata.sqlite'),dataRoot:join(directory,'data'),baseUrl:'http://127.0.0.1:1'}),browser=await chromium.launch({headless:true,chromiumSandbox:true});
 t.after(async()=>{await browser.close();await server.app.close();await rm(directory,{recursive:true,force:true});});
 const address=await server.app.listen({host:'127.0.0.1',port:0}),page=await browser.newPage(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(address+'/requirements');await expect(page.getByRole('heading',{name:'需求工作台',exact:true})).toBeVisible();
 const sidebar=page.getByTestId('requirement-sidebar');await page.getByRole('button',{name:'＋ 新增工作區'}).click();await page.getByLabel('工作區名稱').fill('Navigation workspace');await page.getByLabel('本機程式碼目錄').fill(workspace);await page.getByRole('button',{name:'建立',exact:true}).click();
 await sidebar.getByRole('button',{name:'新增需求',exact:true}).click();await page.getByLabel('需求編號').fill('REQ-NAV');await page.locator('.requirement-workspace-picker label').filter({hasText:'Navigation workspace'}).locator('input').check();await page.getByRole('button',{name:'建立',exact:true}).click();
 await expect(page.getByTestId('feature-select')).toBeVisible();const requirements=await server.core.listRequirements();assert.equal(requirements.length,1);assert.equal(requirements[0].projects.length,1);assert.equal(requirements[0].projects[0].name,'Navigation workspace');
 await page.getByRole('button',{name:'為 REQ-NAV 新增 Gherkin',exact:true}).click();await page.getByLabel('Gherkin 名稱（不含副檔名）').fill('checkout');await page.getByRole('button',{name:'建立',exact:true}).click();await expect(page.locator('dialog')).not.toHaveAttribute('open','');
 const checkoutId=await page.getByTestId('feature-select').locator('option').filter({hasText:'checkout'}).getAttribute('value');await sidebar.getByRole('link',{name:'需求',exact:true}).click();const requirementEntry=page.locator('.requirement-list-entry').filter({hasText:'REQ-NAV'}),listUrl=page.url();await requirementEntry.getByRole('button',{name:'展開需求 REQ-NAV'}).click();await expect(requirementEntry.locator('.requirement-child-name')).toHaveCount(2);assert.equal(page.url(),listUrl);await requirementEntry.getByRole('button',{name:'重新命名 REQ-NAV'}).click();await requirementEntry.getByLabel('需求名稱 REQ-NAV').fill('REQ-NAV-RENAMED');await requirementEntry.getByRole('button',{name:'保存需求名稱'}).click();await expect(requirementEntry).toContainText('REQ-NAV-RENAMED');await requirementEntry.getByRole('button',{name:'重新命名 REQ-NAV-RENAMED'}).click();await requirementEntry.getByLabel('需求名稱 REQ-NAV-RENAMED').fill('REQ-NAV');await requirementEntry.getByRole('button',{name:'保存需求名稱'}).click();await expect(requirementEntry).toContainText('REQ-NAV');await sidebar.getByRole('link',{name:'REQ-NAV',exact:true}).click();
 const node=sidebar.getByTestId('sidebar-requirement-'+requirements[0].id),stages=node.locator('.sidebar-stage');await expect(stages).toHaveCount(5);await expect(node).toHaveAttribute('open','');
 const baseFeatureId=await page.getByTestId('feature-select').locator('option').filter({hasText:'REQ-NAV'}).getAttribute('value');await page.getByTestId('feature-select').selectOption(baseFeatureId!);await expect(page.getByTestId('feature-select').locator('option:checked')).toContainText('REQ-NAV');await expect(page).toHaveURL(new RegExp('featureId='+baseFeatureId));await expect(stages.nth(0)).toHaveAttribute('href',new RegExp('featureId='+baseFeatureId));await stages.nth(0).click();await expect(page.getByTestId('feature-select').locator('option:checked')).toContainText('REQ-NAV');await expect(page).toHaveURL(/workflowStage=GHERKIN/);await expect(page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage','GHERKIN');await expect(page.getByTestId('gherkin-editor')).toBeVisible();
 await page.getByTestId('feature-select').selectOption(checkoutId!);await stages.nth(1).click();await expect(page.getByTestId('feature-select').locator('option:checked')).toContainText('checkout');await expect(page).toHaveURL(/workflowStage=SD/);await expect(page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage','SD');await expect(page.getByTestId('sd-editor')).toBeVisible();
 for(const [index,key,testId] of [[2,'TESTS','spec-editor'],[3,'IMPLEMENTATION','source-editor'],[4,'VERIFICATION','scenario-tests']] as const){await stages.nth(index).click();await expect(page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage',key);await expect(page.getByTestId(testId)).toBeVisible();}
 const tabs=page.getByTestId('workspace-tabs');await expect(tabs.locator('.workspace-tab')).toHaveCount(9);await tabs.getByRole('button',{name:'REQ-NAV · 需求確認 · REQ-NAV',exact:true}).click();await expect(page).toHaveURL(/workflowStage=GHERKIN/);
 await tabs.locator('.workspace-tab.active').getByRole('button',{name:/關閉/}).click();await expect(page).toHaveURL(/workflowStage=SD/);await expect(tabs.locator('.workspace-tab')).toHaveCount(8);
 const url=page.url();await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));assert.equal(await sidebar.evaluate(element=>getComputedStyle(element).position),'fixed');assert.equal((await sidebar.boundingBox())!.y,0);
 await page.reload();assert.equal(page.url(),url);await expect(page.getByTestId('feature-select').locator('option:checked')).toContainText('checkout');
 for(const width of [320,768,1024,1440]){
  await page.setViewportSize({width,height:900});if(width<=800){await expect(sidebar).toBeInViewport();await expect(stages.nth(0)).toBeVisible();}
  await expect(page.getByTestId('feature-select')).toBeVisible();
 }
 await page.setViewportSize({width:1440,height:900});await sidebar.getByRole('button',{name:'新增需求',exact:true}).click();await page.getByLabel('需求編號').fill('REQ-OTHER');await page.locator('.requirement-workspace-picker label').filter({hasText:'Navigation workspace'}).locator('input').check();await page.getByRole('button',{name:'建立',exact:true}).click();await expect(page.getByTestId('feature-select')).toBeVisible();await expect(page.locator('dialog')).not.toHaveAttribute('open','');await stages.nth(1).click();await expect(page).toHaveURL(new RegExp('featureId='+checkoutId));await expect(page).toHaveURL(/workflowStage=SD/);await server.core.store.run("UPDATE features SET stage='VERIFIED' WHERE requirement_id=?",[requirements[0].id]);await page.goto(address+`/requirements/${requirements[0].id}`);await expect(page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage','VERIFICATION');await expect(page.getByTestId('scenario-tests')).toBeVisible();await sidebar.getByRole('link',{name:'需求',exact:true}).click();await expect(page.getByRole('heading',{name:'工作區管理',exact:true})).toBeVisible();assert.deepEqual(errors,[]);
});

test('fixed Terminal menu opens an interactive PTY in the selected local project directory',async t=>{
 const root=resolve(process.cwd());await mkdir(join(root,'.test-fixtures'),{recursive:true});const directory=await mkdtemp(join(root,'.test-fixtures/requirement-terminal-'));
 const workspace=await mkdtemp(join(directory,'workspace-'));
 const server=await createServer({root,metadataFile:join(directory,'metadata.sqlite'),dataRoot:join(directory,'data'),baseUrl:'http://127.0.0.1:1'}),browser=await chromium.launch({headless:true,chromiumSandbox:true});
 t.after(async()=>{await browser.close();await server.app.close();await rm(directory,{recursive:true,force:true});});
 const address=await server.app.listen({host:'127.0.0.1',port:0}),page=await browser.newPage(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(address+'/projects');await page.getByRole('button',{name:'＋ 新增工作區'}).click();await page.getByLabel('工作區名稱').fill('Terminal workspace');await page.getByLabel('本機程式碼目錄').fill(workspace);await page.getByRole('button',{name:'建立',exact:true}).click();
 await page.getByRole('link',{name:/Terminal workspace/}).click();await expect(page.getByRole('heading',{name:'Terminal workspace',exact:true})).toBeVisible();
 const terminalSocketPromise=page.waitForEvent('websocket',socket=>new URL(socket.url()).pathname.includes('/terminals/'));
 await page.getByTestId('sidebar-terminal').click();await page.getByTestId('requirement-sidebar').getByRole('button',{name:'Terminal workspace',exact:true}).click();await expect(page).toHaveURL(/\/projects\/[^/]+\/terminal$/);await expect(page.getByTestId('xterm-host')).toBeVisible();
 const terminalSocket=await terminalSocketPromise;await terminalSocket.waitForEvent('framereceived');await page.getByTestId('xterm-host').click();await page.keyboard.type('pwd');await page.keyboard.press('Enter');
 await expect(page.locator('.xterm-rows')).toContainText(workspace,{timeout:10000});
 const sidebar=page.getByTestId('requirement-sidebar'),tabs=page.getByTestId('workspace-tabs');await sidebar.getByTestId('sidebar-browser').click();await expect(page).toHaveURL(/\/browser-recorder$/);await expect(page.getByTestId('global-browser-toolbar')).toBeVisible();
 await sidebar.getByTestId('sidebar-terminal').click();await sidebar.getByRole('button',{name:'Terminal workspace',exact:true}).click();await expect(tabs.getByRole('button',{name:'Terminal workspace · Terminal',exact:true})).toBeVisible();await tabs.getByRole('button',{name:'瀏覽器錄製',exact:true}).click();await expect(page).toHaveURL(/\/browser-recorder$/);assert.deepEqual(errors,[]);
});

test('default example is visible, user-deletable, and stays deleted after application restart',async t=>{
 const root=resolve(process.cwd());await mkdir(join(root,'.test-fixtures'),{recursive:true});const directory=await mkdtemp(join(root,'.test-fixtures/default-example-'));
 const options={root,metadataFile:join(directory,'metadata.sqlite'),dataRoot:join(directory,'data'),baseUrl:'http://127.0.0.1:1',initializeDefaultExample:true};
 let server=await createServer(options);let serverClosed=false;const browser=await chromium.launch({headless:true,chromiumSandbox:true});
 t.after(async()=>{await browser.close();if(!serverClosed)await server.app.close();await rm(directory,{recursive:true,force:true});});
 const address=await server.app.listen({host:'127.0.0.1',port:0}),page=await browser.newPage();
 await page.goto(address+'/requirements');const example=page.locator('.requirement-list-entry').filter({hasText:'REQ-SAMPLE-001'});await expect(example).toBeVisible();
 const deleteButton=page.getByTestId('delete-default-example');await expect(deleteButton).toBeVisible();page.once('dialog',dialog=>dialog.accept());await deleteButton.click();
 await expect(example).toHaveCount(0);await expect(page.getByText('建立需求後，選取 Gherkin 並點選左側階段。')).toBeVisible();
 const tombstone=await server.core.store.all('SELECT deleted_at FROM requirements WHERE is_default_example=1');assert.equal(tombstone.length,1);assert.ok(tombstone[0].deleted_at);
 const preserved=await server.core.store.all("SELECT count(*) AS count FROM document_versions v JOIN documents d ON d.id=v.document_id JOIN requirements r ON r.id=d.requirement_id WHERE r.is_default_example=1");assert.equal(Number(preserved[0].count),1);
 await server.app.close();serverClosed=true;
 server=await createServer(options);serverClosed=false;const restartedAddress=await server.app.listen({host:'127.0.0.1',port:0});await page.goto(restartedAddress+'/requirements');await expect(page.getByTestId('delete-default-example')).toHaveCount(0);assert.deepEqual(await server.core.listRequirements(),[]);
});
