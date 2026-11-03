import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {chromium,expect} from '@playwright/test';
import {fixture,toolkitRoot,git} from '../workstation/helpers.mjs';
import {createStandaloneServer} from '../../packages/workstation/http.mjs';

async function setup(t) {
  const f=await fixture(t),app=await createStandaloneServer({home:f.home,toolkitRoot,autoAcquire:false,allowLocal:true});
  t.after(()=>app.close());
  const repositories=['SPEC-defaults-alpha','SPEC-defaults-beta'];
  for(const repositoryId of repositories){
    const remoteUrl=path.join(f.base,repositoryId+'.git');
    await git.command(undefined,['init','--bare','--initial-branch','main',remoteUrl]);
    app.service.register({id:repositoryId,title:repositoryId,remoteUrl});
    const operationId=`OP-setup-${repositoryId}`;
    app.service.enqueue({schemaVersion:1,operationId,repositoryId,operation:'repository.setup',input:{reviewer:'Human',projects:[]}});
    const result=await app.service.wait(operationId);assert.equal(result.status,'SUCCEEDED',JSON.stringify(result.error));
  }
  const agent=app.service.saveAgent({name:'Alternate test agent',settings:app.service.catalog().template});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch();t.after(()=>browser.close());
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?view=agents`);
  await expect(page.locator('#content')).toHaveAttribute('aria-busy','false');
  const repository=page.getByRole('combobox',{name:'規格庫任務預設',exact:true});
  const section=purpose=>page.locator('.catalog-default').filter({has:page.getByRole('heading',{name:purpose,exact:true})});
  return {app,page,repository,section,repositories,agentRevisionId:agent.revisions[0].id,errors};
}

test('repository seed agents and prompts become editable immediately after the first defaults load',{timeout:60000},async t=>{
  const {app,page,repository,repositories:[alpha],errors}=await setup(t);
  await repository.selectOption(alpha);await expect(page.locator('.catalog-default')).toHaveCount(4);
  const defaults=await app.service.catalogDefaults(alpha),catalog=app.service.catalog();
  for(const agent of catalog.agents.filter(a=>defaults.some(d=>a.revisions.some(r=>r.id===d.agentRevisionId)))){
    await expect(page.getByRole('button',{name:'編輯 '+agent.name,exact:true})).toBeVisible();
  }
  for(const prompt of catalog.prompts.filter(p=>defaults.some(d=>p.revisions.some(r=>r.id===d.promptRevisionId)))){
    await expect(page.getByRole('button',{name:'編輯 '+prompt.name,exact:true})).toBeVisible();
  }
  assert.deepEqual(errors,[]);
});

test('saving one task default retains the other unsaved task selections and navigation guard',{timeout:60000},async t=>{
  const {app,page,repository,section,repositories:[alpha,beta],agentRevisionId,errors}=await setup(t);
  await repository.selectOption(alpha);await expect(page.locator('.catalog-default')).toHaveCount(4);
  const original=await app.service.catalogDefaults(alpha);
  await section('Gherkin').getByRole('combobox',{name:'Agent',exact:true}).selectOption(agentRevisionId);
  await section('系統設計').getByRole('combobox',{name:'Agent',exact:true}).selectOption(agentRevisionId);
  await section('Gherkin').getByRole('button',{name:'儲存 Gherkin 預設',exact:true}).click();
  await expect(page.locator('#notice')).toHaveText('任務預設已保存');
  assert.equal((await app.service.catalogDefaults(alpha)).find(d=>d.purpose==='gherkin').agentRevisionId,agentRevisionId);
  assert.equal((await app.service.catalogDefaults(alpha)).find(d=>d.purpose==='design').agentRevisionId,original.find(d=>d.purpose==='design').agentRevisionId);
  await repository.selectOption(beta);
  const dialog=page.getByRole('dialog');await expect(dialog).toContainText('尚未儲存的任務預設');
  await dialog.getByRole('button',{name:'取消',exact:true}).click();
  await expect(repository).toHaveValue(alpha);
  await expect(section('系統設計').getByRole('combobox',{name:'Agent',exact:true})).toHaveValue(agentRevisionId);
  await section('系統設計').getByRole('button',{name:'儲存 系統設計 預設',exact:true}).click();
  await expect.poll(async()=>(await app.service.catalogDefaults(alpha)).find(d=>d.purpose==='design').agentRevisionId).toBe(agentRevisionId);
  await expect(section('系統設計').getByRole('button',{name:'儲存 系統設計 預設',exact:true})).toBeEnabled();
  await repository.selectOption(beta);await expect(page.locator('.catalog-default')).toHaveCount(4);await expect(dialog).not.toBeVisible();
  assert.deepEqual(errors,[]);
});

test('edits made while a task default is saving remain unsaved after its response arrives',{timeout:60000},async t=>{
  const {app,page,repository,section,repositories:[alpha,beta],agentRevisionId,errors}=await setup(t);
  await repository.selectOption(alpha);await expect(page.locator('.catalog-default')).toHaveCount(4);
  const choice=section('Gherkin').getByRole('combobox',{name:'Agent',exact:true}),original=await choice.inputValue();
  const held=Promise.withResolvers(),release=Promise.withResolvers();
  t.after(()=>release.resolve());
  await page.route(`**/spec-repositories/${alpha}/agent-defaults`,async route=>{
    if(route.request().method()!=='PUT')return route.continue();
    const response=await route.fetch();held.resolve();await release.promise;await route.fulfill({response});
  });
  await choice.selectOption(agentRevisionId);await section('Gherkin').getByRole('button',{name:'儲存 Gherkin 預設',exact:true}).click();
  await held.promise;await choice.selectOption(original);release.resolve();
  await expect(page.locator('#notice')).toHaveText('任務預設已保存');
  assert.equal((await app.service.catalogDefaults(alpha)).find(d=>d.purpose==='gherkin').agentRevisionId,agentRevisionId);
  await repository.selectOption(beta);await expect(page.getByRole('dialog')).toContainText('尚未儲存的任務預設');
  await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();await expect(choice).toHaveValue(original);
  assert.deepEqual(errors,[]);
});

test('switching repositories during a default load never appends stale controls or saves to the previous repository',{timeout:60000},async t=>{
  const {app,page,repository,section,repositories:[alpha,beta],agentRevisionId,errors}=await setup(t);
  const held=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve());
  await page.route(`**/spec-repositories/${alpha}/agent-defaults`,async route=>{held.resolve();await release.promise;await route.continue();},{times:1});
  await repository.selectOption(alpha);await held.promise;
  await repository.selectOption(beta);await expect(page.locator('.catalog-default')).toHaveCount(4);
  const catalogResponse=page.waitForResponse(r=>r.url().endsWith('/agent-catalog'));
  release.resolve();await (await catalogResponse).finished();
  // Let the completed response reach the UI before inspecting the rendered controls.
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect(page.locator('.catalog-default')).toHaveCount(4);
  await section('Gherkin').getByRole('combobox',{name:'Agent',exact:true}).selectOption(agentRevisionId);
  await section('Gherkin').getByRole('button',{name:'儲存 Gherkin 預設',exact:true}).click();
  await expect(page.locator('#notice')).toHaveText('任務預設已保存');
  assert.equal((await app.service.catalogDefaults(beta)).find(d=>d.purpose==='gherkin').agentRevisionId,agentRevisionId);
  assert.notEqual((await app.service.catalogDefaults(alpha)).find(d=>d.purpose==='gherkin').agentRevisionId,agentRevisionId);
  assert.deepEqual(errors,[]);
});

for(const [label,collection,bodyLabel] of [['Agent','agents','說明'],['Prompt','prompts','Prompt 內容'],['Skill','skills','Skill 內容']]){
  test(`${label} creation keeps edits typed while saving and updates the same record on the next save`,{timeout:60000},async t=>{
    const {app,page,errors}=await setup(t),editor=page.locator('.catalog-editor');
    await page.getByRole('button',{name:'新增 '+label,exact:true}).click();
    await editor.getByRole('textbox',{name:'名稱',exact:true}).fill('Submitted '+label);
    await editor.getByRole('textbox',{name:bodyLabel,exact:true}).fill('Submitted body');
    const held=Promise.withResolvers(),release=Promise.withResolvers(),requests=[];t.after(()=>release.resolve());
    await page.route(`**/agent-catalog/${collection}`,async route=>{
      requests.push(route.request().postDataJSON());const response=await route.fetch();
      if(requests.length===1){held.resolve();await release.promise;}
      await route.fulfill({response});
    });
    const save=editor.getByRole('button',{name:'儲存新版本',exact:true});await save.click();await held.promise;
    await editor.getByRole('textbox',{name:'名稱',exact:true}).fill('Newer '+label);
    await editor.getByRole('textbox',{name:bodyLabel,exact:true}).fill('Newer body');
    release.resolve();await expect(save).toBeEnabled();
    await expect(editor.getByRole('textbox',{name:'名稱',exact:true})).toHaveValue('Newer '+label);
    await expect(editor.getByRole('textbox',{name:bodyLabel,exact:true})).toHaveValue('Newer body');
    const saved=app.service.catalog()[collection].find(item=>item.name==='Submitted '+label);assert.ok(saved);
    await save.click();await expect(page.locator('#notice')).toHaveText('已保存新版本');await expect(save).toBeEnabled();
    assert.equal(requests[1].id,saved.id);assert.equal(requests[1].expectedRevision,saved.revisions[0].id);
    const updated=app.service.catalog()[collection].find(item=>item.id===saved.id);assert.equal(updated.name,'Newer '+label);assert.equal(updated.revisions.length,2);
    assert.deepEqual(errors,[]);
  });
}
