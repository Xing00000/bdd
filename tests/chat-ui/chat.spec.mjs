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
import {openMenu} from './navigation-helpers.mjs';

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
 w.create=async()=>{await openMenu(page,'chat');await page.getByTestId('new-chat').click();await expect(page.getByRole('textbox',{name:'對話訊息輸入',exact:true})).toBeVisible();w.roomId=new URL(page.url()).searchParams.get('chat');w.title='新對話';await expect(page.getByRole('textbox',{name:'聊天室名稱',exact:true})).toHaveCount(0);};
 w.send=async content=>{await page.getByRole('textbox',{name:'對話訊息輸入',exact:true}).fill(content);await page.getByRole('button',{name:'送出',exact:true}).click();};
 page.on('pageerror',error=>w.errors.push(error.message));
 await page.goto(w.url);await expect(page.getByTestId('assistant-menu-toggle')).toBeVisible();await openMenu(page,'chat');await expect(page.getByTestId('new-chat')).toBeVisible();
 try{await use(w);}
 finally{
  await info.attach('正式入口操作畫面',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
  const room=w.roomId?await w.room():null;
  await info.attach('SQLite 與對話實際結果',{body:JSON.stringify({room,errors:w.errors,entry:'npm start -> createStandaloneServer',database:path.join(home,'metadata.sqlite'),visualReview:'pending; no approved screenshot baseline',inference:'real Codex and Copilot; no mocked responses'},null,2),contentType:'application/json'});
  await info.attach('測試來源',{body:await readFile(import.meta.filename),contentType:'text/plain'});
  await w.app.close();expect(w.errors).toEqual([]);
 }
}});

test('CLI Agent 輸出顯示於 xterm',async({page,workstation:w})=>{
 const session={sessionId:'AGT-test',agentName:'terminal-test',protocol:'pty',status:'IDLE',pid:123};
 const input=[];
 await page.routeWebSocket('**/agent-sessions/AGT-test/terminal**',socket=>{
  socket.onMessage(message=>input.push(JSON.parse(String(message)).data));
 });
 await page.route('**/repository-api/v1/agent-sessions**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/events'))return route.fulfill({json:{...session,events:[{seq:1,kind:'output',content:'TERMINAL_OUTPUT\r\n'}]}});
  if(url.pathname.endsWith('/agent-sessions'))return route.fulfill({json:{sessions:[session]}});
  return route.continue();
 });
 await page.getByText('＋ 啟動 CLI Agent').click();
 await page.getByRole('button',{name:'重新整理工作階段'}).click();
 await page.getByTestId('agent-session-AGT-test').click();
 await expect(page.getByTestId('agent-session-terminal').locator('.xterm')).toBeVisible();
 await expect(page.getByTestId('agent-session-terminal')).toContainText('TERMINAL_OUTPUT');
 await expect(page.getByTestId('agent-session-input')).toHaveCount(0);
 await page.getByTestId('agent-session-terminal').locator('.xterm-screen').click();
 await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
 await expect.poll(()=>input.join('')).toBe('\x1b[B\r');
});

test('終端自動取得焦點並將鍵盤輸入送達實際 PTY',async({page,workstation:w})=>{
 const supervisor=await w.app.service.supervisor();
 const session=await supervisor.start({protocol:'pty',command:process.execPath,cwd:w.home,args:['-e',"process.stdin.setEncoding('utf8');process.stdin.on('data',s=>process.stdout.write('KEYS:'+JSON.stringify(s)+'\\n'))"]});
 let eventRequests=0;
 page.on('request',request=>{if(request.url().includes(`/agent-sessions/${session.sessionId}/events`))eventRequests++;});
 await page.getByText('＋ 啟動 CLI Agent').click();
 await page.getByRole('button',{name:'重新整理工作階段'}).click();
 await page.getByTestId('agent-session-'+session.sessionId).click();
 const terminal=page.getByTestId('agent-session-terminal');
 await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused();
 await page.keyboard.type('hello');await page.keyboard.press('Enter');
 await expect.poll(()=>supervisor.events(session.sessionId).events.map(event=>event.content).join('')).toContain('KEYS:');
 expect(eventRequests).toBe(1);
 await supervisor.stop(session.sessionId);
});

test('ACP 終端可送出指令、中斷與停止工作階段',async({page,workstation:w})=>{
 const session={sessionId:'AGT-acp-test',agentName:'acp-terminal',protocol:'acp',status:'IDLE'},commands=[];
 await page.routeWebSocket('**/agent-sessions/AGT-acp-test/terminal**',()=>{});
 await page.route('**/repository-api/v1/agent-sessions**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/events'))return route.fulfill({json:{...session,events:[]}});
  if(url.pathname.endsWith('/agent-sessions'))return route.fulfill({json:{sessions:[session]}});
  const action=url.pathname.split('/').at(-1);
  if(['messages','cancel','stop'].includes(action)){
   commands.push({action,body:route.request().postDataJSON()});
   if(action==='stop')session.status='STOPPED';
   return route.fulfill({json:{accepted:true}});
  }
  return route.continue();
 });
 await page.getByText('＋ 啟動 CLI Agent').click();await page.getByRole('button',{name:'重新整理工作階段'}).click();
 await page.getByTestId('agent-session-'+session.sessionId).click();
 const terminal=page.getByTestId('agent-session-terminal');
 await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused();
 await page.keyboard.type('follow ux');await page.keyboard.press('Backspace');await page.keyboard.type('p');await page.keyboard.press('Enter');
 await expect.poll(()=>commands).toEqual([{action:'messages',body:{actor:'human',message:'follow up',wait:false}}]);
 await page.getByRole('button',{name:'中斷目前工作',exact:true}).click();
 await expect.poll(()=>commands.some(command=>command.action==='cancel'&&command.body.actor==='human')).toBe(true);
 await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused();
 await page.getByRole('button',{name:'停止工作階段',exact:true}).click();
 await expect(page.getByTestId('agent-session-detail')).toContainText('STOPPED');
 await expect(page.getByRole('button',{name:'停止工作階段',exact:true})).toBeDisabled();
 expect(commands.at(-1)).toEqual({action:'stop',body:{actor:'human'}});
 await expect(page.getByTestId('agent-session-input')).toHaveCount(0);
});

test('AC-WB-036 正式入口：收合全寬對話與雙層導覽',async({page,workstation:w})=>{
 await test.step('對話沒有重複頁籤，收合後使用完整面板寬度',async()=>{await w.create();await expect(page.getByRole('navigation',{name:'工作頁籤'})).toHaveCount(0);await expect(page.locator('.assistant-rail')).toBeHidden();await expect(page.locator('#chat-view .chat-settings')).toHaveCount(0);const drawer=await page.getByTestId('assistant-drawer').boundingBox(),body=await page.locator('.assistant-body').boundingBox();expect(body.width).toBe(await page.getByTestId('assistant-drawer').evaluate(node=>node.clientWidth));await openMenu(page,'chat');await expect(page.getByTestId('chat-room-'+w.roomId)).toBeVisible();await page.getByTestId('assistant-rooms-close').click();});
 await test.step('透過選單切換與重複開啟，不刪除聊天室或草稿',async()=>{await page.getByRole('textbox',{name:'對話訊息輸入'}).fill('尚未送出的草稿');await openMenu(page,'workspace');await page.locator('[data-home]').click();await openMenu(page,'chat');await page.getByTestId('chat-room-'+w.roomId).click();await expect(page.getByRole('textbox',{name:'對話訊息輸入'})).toHaveValue('尚未送出的草稿');await openMenu(page,'chat');await page.getByTestId('chat-room-'+w.roomId).click();await expect(page.getByRole('textbox',{name:'對話訊息輸入'})).toHaveValue('尚未送出的草稿');expect((await w.get('/chat-rooms')).length).toBe(1);});
 await test.step('右側可縮合面板以側邊 Modal 展開直式導覽清單（不設「對話 / 工作」分頁、非向下展開），整合對話紀錄與 CLI Agent Session',async()=>{
  await page.setViewportSize({width:1440,height:1000});
  await expect(page.locator('#home-view')).toBeVisible();
  await expect(page.getByTestId('assistant-tab-chat')).toHaveCount(0);
  await expect(page.getByTestId('assistant-tab-sessions')).toHaveCount(0);
  const mainBox=await page.locator('.main-shell').boundingBox(),drawerBox=await page.getByTestId('assistant-drawer').boundingBox();
  expect(drawerBox.x).toBeGreaterThanOrEqual(mainBox.x+mainBox.width-2);
  await expect(page.getByTestId('assistant-rooms-panel')).toBeHidden();
  await openMenu(page,'chat');
  await expect(page.getByTestId('assistant-rooms-panel')).toBeVisible();
  await expect(page.getByTestId('chat-agent-supervisor')).toBeVisible();
  const modalBox=await page.getByTestId('assistant-rooms-panel').boundingBox();
  const bodyBox=await page.locator('.assistant-body').boundingBox();
  expect(Math.abs(modalBox.x-bodyBox.x)).toBeLessThanOrEqual(2);
  expect(modalBox.height).toBeGreaterThanOrEqual(bodyBox.height-2);
  expect(modalBox.width).toBeLessThan(drawerBox.width);
  const newChatBox=await page.getByTestId('new-chat').boundingBox(),roomBox=await page.getByTestId('chat-room-'+w.roomId).boundingBox(),supBox=await page.getByTestId('chat-agent-supervisor').boundingBox();
  expect(roomBox.y).toBeGreaterThanOrEqual(newChatBox.y+newChatBox.height-2);
  expect(supBox.y).toBeGreaterThanOrEqual(roomBox.y+roomBox.height-2);
  await page.getByTestId('assistant-rooms-close').click();
  await expect(page.getByTestId('assistant-rooms-panel')).toBeHidden();
  await page.getByTestId('assistant-drawer-toggle').click();
  await expect(page.getByTestId('assistant-drawer')).toBeHidden();
  await expect(page.getByTestId('assistant-drawer-open')).toBeVisible();
  await page.getByTestId('assistant-drawer-open').click();
  await expect(page.getByTestId('assistant-drawer')).toBeVisible();
 });
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
 await w.create();const configured=await w.get('/chat-settings');await openMenu(page,'settings');await page.getByText('對話設定',{exact:true}).click();await page.getByRole('textbox',{name:'對話 Codex 執行檔',exact:true}).fill(path.join(w.home,'missing-codex'));await page.getByRole('button',{name:'儲存對話設定',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'對話設定已儲存'})).toBeVisible();
 await page.getByTestId('assistant-rooms-close').click();await w.send('<script>window.chatInjectionExecuted=true</script>');await expect(page.getByRole('alert').filter({hasText:'回覆失敗'})).toBeVisible();await expect(page.getByTestId('chat-message-assistant')).toHaveCount(0);expect((await w.room()).messages[0].status).toBe('failed');expect(await page.evaluate(()=>Object.hasOwn(window,'chatInjectionExecuted'))).toBe(false);
 await openMenu(page,'settings');await page.getByRole('textbox',{name:'對話 Codex 執行檔',exact:true}).fill(configured.codexExecutable);await page.getByRole('button',{name:'儲存對話設定',exact:true}).click();
 await page.getByTestId('assistant-rooms-close').click();
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
 await expect(page.locator('.chat-model-picker [role=status]')).toHaveText(catalog.models.length?'':'Copilot 目前未提供可手選模型，仍可使用自動選擇。');
 await info.attach('真實 Copilot CLI 模型清單（含實際空清單）',{body:JSON.stringify(catalog,null,2),contentType:'application/json'});expect(w.errors).toEqual([]);
});

base('AC-WB-047 UIUX：重疊保存模型與進階設定不互相覆蓋',{tag:'@protocol'},async({page},info)=>{
 const driver=await ChatModelsDriver.open(page),gate=Promise.withResolvers(),held=Promise.withResolvers(),patches=[];
 try{
  await openMenu(page,'settings');await page.getByText('對話設定',{exact:true}).click();const timeoutMs=driver.before.timeoutMs+1;await page.getByRole('textbox',{name:'對話 逾時',exact:true}).fill(String(timeoutMs));
  await page.route('**/chat-settings',async route=>{if(route.request().method()==='PATCH'){const patch=route.request().postDataJSON();patches.push(patch);if(Object.hasOwn(patch,'model')){held.resolve();await gate.promise;}}await route.continue();});
  await page.getByTestId('assistant-rooms-close').click();await page.getByRole('combobox',{name:'對話模型',exact:true}).selectOption('fixture-b');await held.promise;await openMenu(page,'settings');await page.getByRole('button',{name:'儲存對話設定',exact:true}).click();expect(patches).toEqual([{model:'fixture-b'}]);await expect(page.getByRole('combobox',{name:'對話模型',exact:true})).toBeDisabled();gate.resolve();await page.getByTestId('assistant-rooms-close').click();
  const chat=await driver.app.service.chat();await expect.poll(async()=>{const settings=await chat.settings();return {model:settings.model,timeoutMs:settings.timeoutMs};}).toEqual({model:'fixture-b',timeoutMs});await expect(page.getByRole('combobox',{name:'對話模型',exact:true})).toHaveValue('fixture-b');expect(patches).toHaveLength(2);expect(patches[1]).not.toHaveProperty('model');expect(driver.errors).toEqual([]);await driver.attach(info);
 }finally{gate.resolve();await driver.close();}
});
