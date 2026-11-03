import {ChatStreamDriver} from './chat-stream-driver.ts';
import {ChatModelsDriver} from './chat-models-driver.ts';
import {test as base,expect} from '@playwright/test';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createStandaloneServer} from '../../packages/workstation/http.mjs';
import {access} from 'node:fs/promises';
import {ChatToolsDriver} from './chat-tools-driver.ts';

const prefix='/repository-api/v1';
base('single UI: the compatibility API never serves the retired Vue application',{tag:'@protocol'},async()=>{
 const {createServer:createCompatibilityApi}=await import('../../dist/src/http/server.js');
 const home=await mkdtemp(path.join(tmpdir(),'bdd-single-ui-'));
 const api=await createCompatibilityApi({root:process.cwd(),metadataFile:path.join(home,'metadata.sqlite'),dataRoot:path.join(home,'data'),baseUrl:'http://127.0.0.1:1'});
 try{
  for(const url of ['/','/browser-recorder','/assets/obsolete.js','/index.html']){const r=await api.app.inject({method:'GET',url,headers:{accept:'text/html'}});expect(r.statusCode).toBe(404);expect(r.headers['content-type']).toContain('application/json');expect(r.body).not.toContain('<html');}
  const projects=await api.app.inject({method:'GET',url:'/projects',headers:{accept:'text/html'}});expect(projects.statusCode).toBe(200);expect(projects.headers['content-type']).toContain('application/json');expect(projects.json()).toEqual([]);
  await expect(access(path.resolve('ui'))).rejects.toMatchObject({code:'ENOENT'});
  await expect(access(path.resolve('dist/public'))).rejects.toMatchObject({code:'ENOENT'});
 }finally{await api.app.close();}
});
const test=base.extend({workstation:async({page},use,info)=>{
 const home=await mkdtemp(path.join(tmpdir(),'bdd-chat-standalone-'));
 const options={home,toolkitRoot:process.cwd(),enableExecution:false};
 const w={home,options,app:await createStandaloneServer(options),url:'',roomId:'',title:'聊天室 '+randomUUID().slice(0,8),errors:[]};
 const listen=async()=>{await new Promise(resolve=>w.app.server.listen(0,'127.0.0.1',resolve));w.url=`http://127.0.0.1:${w.app.server.address().port}`;};await listen();
 w.restart=async()=>{const port=w.app.server.address().port;await w.app.close();w.app=await createStandaloneServer(options);await new Promise(resolve=>w.app.server.listen(port,'127.0.0.1',resolve));};
 w.get=async route=>{const response=await page.request.get(w.url+prefix+route);expect(response.ok(),await response.text()).toBe(true);return response.json();};
 w.post=async(route,data)=>page.request.post(w.url+prefix+route,{headers:{'x-workbench-request':'1'},data});
 w.room=()=>w.get('/chat-rooms/'+w.roomId);
 w.create=async()=>{await page.getByTestId('new-chat').click();await expect(page.getByRole('textbox',{name:'對話訊息輸入',exact:true})).toBeVisible();w.roomId=new URL(page.url()).searchParams.get('chat');w.title='新對話';await expect(page.getByRole('textbox',{name:'聊天室名稱',exact:true})).toHaveCount(0);};
 w.send=async content=>{await page.getByRole('textbox',{name:'對話訊息輸入',exact:true}).fill(content);await page.getByRole('button',{name:'送出',exact:true}).click();};
 page.on('pageerror',error=>w.errors.push(error.message));
 await page.goto(w.url);await expect(page.getByTestId('new-chat')).toBeVisible();
 try{await use(w);}
 finally{
  await info.attach('正式入口操作畫面',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
  const room=w.roomId?await w.room():null;
  await info.attach('SQLite 與對話實際結果',{body:JSON.stringify({room,errors:w.errors,entry:'npm start -> createStandaloneServer',database:path.join(home,'metadata.sqlite'),visualReview:'pending; no approved screenshot baseline',inference:'real Codex and Copilot; no mocked responses'},null,2),contentType:'application/json'});
  await info.attach('測試來源',{body:await readFile(import.meta.filename),contentType:'text/plain'});
  await w.app.close();expect(w.errors).toEqual([]);
 }
}});

test('AC-WB-036 正式入口：左側聊天室與中間頁籤',async({page,workstation:w})=>{
 await test.step('建立聊天室後，左側與對話頁籤同時顯示',async()=>{await w.create();await expect(page.getByTestId('chat-room-'+w.roomId)).toBeVisible();await expect(page.getByRole('navigation',{name:'工作頁籤'}).getByRole('button',{name:'對話 · '+w.title,exact:true})).toHaveCount(1);});
 await test.step('切換、重複開啟及關閉頁籤不刪除聊天室或草稿',async()=>{await page.getByRole('textbox',{name:'對話訊息輸入'}).fill('尚未送出的草稿');await page.getByRole('navigation',{name:'工作頁籤'}).getByRole('button',{name:'工作台',exact:true}).click();await page.getByTestId('chat-room-'+w.roomId).click();await expect(page.getByRole('textbox',{name:'對話訊息輸入'})).toHaveValue('尚未送出的草稿');await page.getByRole('button',{name:'關閉 對話 · '+w.title,exact:true}).click();await page.getByTestId('chat-room-'+w.roomId).click();await expect(page.getByRole('navigation',{name:'工作頁籤'}).getByRole('button',{name:'對話 · '+w.title,exact:true})).toBeVisible();await expect(page.getByRole('textbox',{name:'對話訊息輸入'})).toBeVisible();expect((await w.get('/chat-rooms')).length).toBe(1);});
 for(const width of [320,768,1024,1440])await test.step(`視窗寬度 ${width} 不產生水平溢出`,async()=>{await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);});
});
test('AC-WB-037 正式入口：真實 Copilot 回覆、SQLite、重啟續聊與壓縮',async({page,workstation:w})=>{
 const marker=randomUUID();await w.create();
 const original=`  Remember the verification marker ${marker}. Reply with only the marker.\n`;
 await w.send(original);await expect(page.getByTestId('chat-message-assistant')).toHaveCount(1,{timeout:180000});await expect(page.getByTestId('chat-message-assistant')).toContainText(marker);
 const before=await w.room();expect(before.messages[0].content).toBe(original);expect(before.title).toBe(original.trim().replace(/\s+/g,' ').slice(0,160));await expect(page.getByTestId('chat-room-'+w.roomId)).toContainText(marker);expect(before.messages.map(m=>m.status)).toEqual(['completed','completed']);
 const db=new DatabaseSync(path.join(w.home,'metadata.sqlite'),{readOnly:true});try{expect(db.prepare('SELECT content FROM chat_messages WHERE room_id=? ORDER BY sequence LIMIT 1').get(w.roomId).content).toBe(original);}finally{db.close();}
 const url=page.url();await w.restart();await page.goto(url);await expect(page.getByTestId('chat-message-assistant')).toContainText(marker);
 await w.send('What verification marker did I give you? Return only the marker.');await expect(page.getByTestId('chat-message-assistant')).toHaveCount(2,{timeout:180000});await expect(page.getByTestId('chat-message-assistant').last()).toContainText(marker);expect((await w.room()).thread_id).toBe(before.thread_id);
 const messages=(await w.room()).messages,response=await w.post('/chat-rooms/'+w.roomId+'/compact',{});expect(response.ok(),await response.text()).toBe(true);expect((await w.room()).messages).toEqual(messages);
});
test('AC-WB-038 正式入口：失敗不假回覆、重複送出與新草稿保留',async({page,workstation:w})=>{
 await w.create();const configured=await w.get('/chat-settings');await page.getByText('對話設定',{exact:true}).click();await page.getByRole('textbox',{name:'對話 Codex 執行檔',exact:true}).fill(path.join(w.home,'missing-codex'));await page.getByRole('button',{name:'儲存對話設定',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'對話設定已儲存'})).toBeVisible();
 await w.send('<script>window.chatInjectionExecuted=true</script>');await expect(page.getByRole('alert').filter({hasText:'回覆失敗'})).toBeVisible();await expect(page.getByTestId('chat-message-assistant')).toHaveCount(0);expect((await w.room()).messages[0].status).toBe('failed');expect(await page.evaluate(()=>Object.hasOwn(window,'chatInjectionExecuted'))).toBe(false);
 await page.getByRole('textbox',{name:'對話 Codex 執行檔',exact:true}).fill(configured.codexExecutable);await page.getByRole('button',{name:'儲存對話設定',exact:true}).click();
 // Delay only transport delivery; the request still reaches the actual backend.
 let release;const blocked=new Promise(resolve=>release=resolve);
 await page.route('**/chat-rooms/*/messages',async route=>{await blocked;await route.continue();},{times:1});
 await page.getByRole('textbox',{name:'對話訊息輸入'}).fill('Reply with only 42.');await page.getByRole('button',{name:'送出',exact:true}).click();await page.getByRole('textbox',{name:'對話訊息輸入'}).fill('這是尚未送出的下一則草稿');release();
 await expect(page.getByRole('button',{name:'回覆中…',exact:true})).toBeDisabled();expect((await w.post('/chat-rooms/'+w.roomId+'/messages',{content:'duplicate'})).status()).toBe(409);
 await expect(page.getByTestId('chat-message-assistant')).toHaveCount(1,{timeout:180000});await expect(page.getByRole('textbox',{name:'對話訊息輸入'})).toHaveValue('這是尚未送出的下一則草稿');expect((await w.room()).messages.some(m=>m.content==='duplicate')).toBe(false);
});

base('AC-WB-039 UIUX：Codex 操作工作站並保存提案，重啟後讀回',async({page},info)=>{
 const driver=await ChatToolsDriver.open(page);
 try{
  await base.step('使用者要求查詢規格庫並保存需求提案',()=>driver.generate());
  const before=await driver.proposalEvidence();
  await base.step('MCP 呼叫、SQLite、API 與畫面對照，且未確認任何需求階段',async()=>{
   expect(before.proposals).toHaveLength(1);expect(before.rows).toHaveLength(1);
   expect(before.proposals[0].description).toBe(driver.description);expect(before.rows[0].description).toBe(driver.description);
   expect(before.rows[0].id).toBe(before.proposals[0].id);expect(before.rows[0].editor_key).toBe(driver.editorKey);
   expect(before.authoring).toEqual(driver.baseline);
   const calls=before.tools.filter(r=>r.payload.type==='function_call');
   expect(calls.map(r=>r.payload.name)).toEqual(expect.arrayContaining(['workbench_list_repositories','workbench_generate_requirement']));
   expect(calls.filter(r=>r.payload.name==='workbench_generate_requirement')).toHaveLength(1);
   expect(calls.every(r=>r.payload.namespace==='mcp__workbench')).toBe(true);
   for(const call of calls)expect(before.tools.some(r=>r.payload.type==='function_call_output'&&r.payload.call_id===call.payload.call_id&&r.metadata?.mcp_attribution?.status==='complete')).toBe(true);
   const writes=before.operations.map(o=>({...o,request:JSON.parse(o.request_json),result:JSON.parse(o.result_json)})).filter(o=>o.request.operation==='interaction.requirement.generate');
   expect(writes).toHaveLength(1);expect(writes[0].status).toBe('SUCCEEDED');expect(writes[0].result.proposalId).toBe(before.proposals[0].id);
   await expect(page.getByTestId('chat-message-assistant')).toContainText(driver.repository.id);await expect(page.getByTestId('chat-message-assistant')).toContainText(before.proposals[0].id);
  });
  await base.step('重啟正式工作站，以同一 Codex thread 重新查詢保存的提案',async()=>{
   await driver.restartAndAsk();const after=await driver.proposalEvidence();
   expect(after.room.thread_id).toBe(before.room.thread_id);expect(after.proposals).toEqual(before.proposals);expect(after.authoring).toEqual(driver.baseline);
   expect(after.room.messages.map(m=>m.status)).toEqual(['completed','completed','completed','completed']);
   expect(after.tools.filter(r=>r.payload.type==='function_call'&&r.payload.name==='workbench_get_requirement_proposals').length).toBeGreaterThan(0);
   await expect(page.getByTestId('chat-message-assistant').last()).toContainText(before.proposals[0].id);await expect(page.getByTestId('chat-message-assistant').last()).toContainText(driver.description);
  });
 }finally{try{await driver.attach(info);}finally{await driver.close();}}
});


base('AC-WB-040 正式入口：真實文字增量透過 SSE 到達且不輪詢完整對話',async({page},info)=>{
 const driver=await ChatStreamDriver.open(page);
 try{await driver.send();await driver.early();await driver.complete();await driver.reconnect();await driver.failure();}
 finally{try{await driver.attach(info);}finally{await driver.close();}}
});

base('AC-WB-047 UIUX：取得模型清單、選擇並保存，重新整理維持選擇（協定測試）',{tag:'@protocol'},async({page},info)=>{
 const driver=await ChatModelsDriver.open(page);
 try{
  expect(driver.catalog.models.map(m=>m.id)).toEqual(['fixture-a','fixture-b']);
  await driver.select();await driver.persisted();await driver.refresh();
  for(const width of [390,1440]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);const select=await page.getByRole('combobox',{name:'對話模型',exact:true}).boundingBox(),send=await page.getByRole('button',{name:'送出',exact:true}).boundingBox();expect(select.x+select.width).toBeLessThanOrEqual(send.x);expect(Math.abs((select.y+select.height/2)-(send.y+send.height/2))).toBeLessThanOrEqual(Math.max(select.height,send.height)/2);await expect(page.locator('.chat-composer-actions').getByRole('combobox',{name:'對話模型',exact:true})).toBeVisible();}
  await driver.attach(info);
 }finally{await driver.close();}
});

test('對話模型清單：真實 Copilot CLI 的可用與空清單狀態',async({page,workstation:w},info)=>{
 const response=page.waitForResponse(r=>r.url().endsWith('/chat-models'));await w.create();const received=await response,catalog=await received.json();expect(received.ok(),JSON.stringify(catalog)).toBe(true);
 const select=page.getByRole('combobox',{name:'對話模型',exact:true});await expect(select).toBeEnabled();await expect(select.locator('option')).toHaveCount(catalog.models.length+1);await expect(select).toHaveValue(catalog.automaticModel);
 await expect(page.locator('.chat-model-picker [role=status]')).toHaveText(catalog.models.length?`已取得 ${catalog.models.length} 個模型`:'Copilot 目前未提供可手選模型，仍可使用自動選擇。');
 await info.attach('真實 Copilot CLI 模型清單（含實際空清單）',{body:JSON.stringify(catalog,null,2),contentType:'application/json'});expect(w.errors).toEqual([]);
});

base('AC-WB-047 UIUX：重疊保存模型與進階設定不互相覆蓋',{tag:'@protocol'},async({page},info)=>{
 const driver=await ChatModelsDriver.open(page),gate=Promise.withResolvers(),held=Promise.withResolvers(),patches=[];
 try{
  await page.getByText('對話設定',{exact:true}).click();const timeoutMs=driver.before.timeoutMs+1;await page.getByRole('textbox',{name:'對話 逾時',exact:true}).fill(String(timeoutMs));
  await page.route('**/chat-settings',async route=>{if(route.request().method()==='PATCH'){const patch=route.request().postDataJSON();patches.push(patch);if(Object.hasOwn(patch,'model')){held.resolve();await gate.promise;}}await route.continue();});
  await page.getByRole('combobox',{name:'對話模型',exact:true}).selectOption('fixture-b');await held.promise;await page.getByRole('button',{name:'儲存對話設定',exact:true}).click();expect(patches).toEqual([{model:'fixture-b'}]);await expect(page.getByRole('combobox',{name:'對話模型',exact:true})).toBeDisabled();gate.resolve();
  const chat=await driver.app.service.chat();await expect.poll(async()=>{const settings=await chat.settings();return {model:settings.model,timeoutMs:settings.timeoutMs};}).toEqual({model:'fixture-b',timeoutMs});await expect(page.getByRole('combobox',{name:'對話模型',exact:true})).toHaveValue('fixture-b');expect(patches).toHaveLength(2);expect(patches[1]).not.toHaveProperty('model');expect(driver.errors).toEqual([]);await driver.attach(info);
 }finally{gate.resolve();await driver.close();}
});
