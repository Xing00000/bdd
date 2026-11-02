import {test as base,expect} from '@playwright/test';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createStandaloneServer} from '../../packages/workstation/http.mjs';
import {createServer as createCompatibilityApi} from '../../dist/src/http/server.js';
import {access} from 'node:fs/promises';

const prefix='/repository-api/v1';
base('single UI: the compatibility API never serves the retired Vue application',async()=>{
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
