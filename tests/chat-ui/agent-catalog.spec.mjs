import {agentCatalogScenario} from './agent-catalog-driver.mjs';
import {test,expect} from '@playwright/test';

test('AC-WB-043 Agent／Skill 統一管理、預覽選擇與真實 Gherkin 派工',async({page},info)=>{
 const phases=[];for await(const checkpoint of agentCatalogScenario(page,info))phases.push(checkpoint.phase);
 expect(phases).toEqual(['opened','saved','restarted','previewed','generated','stale-rejected']);
});

test('AC-WB-043 管理編輯保護、資源驗證與窄視窗',{tag:'@protocol'},async({page},info)=>{
 const {mkdtemp}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path'),{createStandaloneServer}=await import('../../packages/workstation/http.mjs');
 const app=await createStandaloneServer({home:await mkdtemp(path.join(tmpdir(),'bdd-catalog-edit-')),toolkitRoot:process.cwd(),enableExecution:false});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 try{
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?view=agents`);await page.getByRole('button',{name:'新增 Skill',exact:true}).click();const editor=page.locator('.catalog-editor');await editor.getByRole('textbox',{name:'名稱',exact:true}).fill('尚未儲存的技能');await editor.getByRole('textbox',{name:'Skill 內容',exact:true}).fill('Retain this instruction.');
  await page.getByRole('button',{name:'新增 Agent',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('尚未儲存的設定');await page.getByRole('button',{name:'取消',exact:true}).click();await expect(editor.getByRole('textbox',{name:'Skill 內容',exact:true})).toHaveValue('Retain this instruction.');
  await page.locator('.nav-home[data-home]').click();await expect(page.getByRole('dialog')).toContainText('有尚未儲存的編輯');await page.getByRole('button',{name:'取消',exact:true}).click();await expect(editor.getByRole('textbox',{name:'名稱',exact:true})).toHaveValue('尚未儲存的技能');
  await editor.getByLabel('加入 Skill 資源檔',{exact:true}).setInputFiles({name:'reference.txt',mimeType:'text/plain',buffer:Buffer.from('resource text')});await editor.getByRole('textbox',{name:'資源相對路徑',exact:true}).fill('../outside.txt');await editor.getByRole('button',{name:'儲存新版本',exact:true}).click();await expect(page.locator('#notice')).toContainText('路徑無效');expect(app.service.catalog().skills).toHaveLength(0);
  await editor.getByRole('textbox',{name:'資源相對路徑',exact:true}).fill('references/reference.txt');await editor.getByRole('button',{name:'儲存新版本',exact:true}).click();await expect(page.getByRole('button',{name:'編輯 尚未儲存的技能',exact:true})).toBeVisible();expect(app.service.catalog().skills[0].revisions[0].resources[0].content).toBe('resource text');
  const denied=await page.request.post(`http://127.0.0.1:${app.server.address().port}/repository-api/v1/operations`,{headers:{'x-workbench-request':'1'},data:{schemaVersion:1,operationId:'OP-forged-catalog',repositoryId:'SPEC-missing',operation:'workflow.gherkin.generate',input:{agentSnapshot:{settings:{command:'untrusted'}}}}});expect(denied.status()).toBe(422);expect((await denied.json()).code).toBe('INVALID_AGENT_SNAPSHOT');expect(()=>app.service.operation('OP-forged-catalog')).toThrow('Operation not found');
  for(const width of [320,768,1024,1440]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
  await info.attach('管理頁與編輯保護結果',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
 }finally{await app.close();}
});
