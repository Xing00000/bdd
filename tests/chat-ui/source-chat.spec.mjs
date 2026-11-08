import {test,expect} from '@playwright/test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createStandaloneServer} from '../../packages/workstation/http.mjs';
import {copilotChatPeer} from '../helpers/copilot-chat-peer.ts';
import {openMenu} from './navigation-helpers.mjs';

test('聊天直接載入來源：開啟、實際 Codex 串流與重新載入持久化',async({page},info)=>{
 const home=await mkdtemp(path.join(tmpdir(),'bdd-source-chat-'));
 const app=await createStandaloneServer({home,toolkitRoot:process.cwd(),enableExecution:false});
 const errors=[],deltas=[],answer='Source chat protocol fixture reply';
 page.on('pageerror',error=>errors.push(error.message));
 try{
  const chat=await app.service.chat(),settings=await chat.settings();
  const peer=await copilotChatPeer(home,{responseText:answer});
  await chat.saveSettings({...settings,...peer,model:'fixture-model'});
  await page.addInitScript(()=>{
   window.sourceChatDeltas=[];
   const Native=window.EventSource;
   window.EventSource=class extends Native{
    constructor(...args){super(...args);this.addEventListener('message',event=>{
     const data=JSON.parse(event.data);if(data.type==='delta')window.sourceChatDeltas.push(data.delta);
    });}
   };
  });
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${app.server.address().port}`;
  const response=await page.request.get(url+'/repository-api/v1/chat-settings');
  expect(response.status()).toBe(200);
  await page.goto(url);await openMenu(page,'chat');
  await page.getByTestId('new-chat').click();
  const input=page.getByRole('textbox',{name:'對話訊息輸入',exact:true});
  await expect(input).toBeVisible();
  await expect(page.getByText('聊天功能需要先執行 npm install 與 npm run build。',{exact:true})).toHaveCount(0);
  await input.fill('Reply with the protocol fixture response.');
  await page.getByRole('button',{name:'送出',exact:true}).click();
  const assistant=page.getByTestId('chat-message-assistant').locator('.chat-message-content');
  await expect(assistant).toHaveText(answer,{timeout:60000});
  deltas.push(...await page.evaluate(()=>window.sourceChatDeltas));
  expect(deltas.length).toBeGreaterThan(0);expect(deltas.join('')).toBe(answer);
  const roomId=new URL(page.url()).searchParams.get('chat');
  expect((await chat.detail(roomId)).messages.at(-1)).toMatchObject({content:answer,status:'completed'});
  await page.reload();await expect(assistant).toHaveText(answer);
  expect(errors).toEqual([]);
  await info.attach('聊天畫面',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
  await info.attach('驗證範圍',{body:JSON.stringify({node:process.version,deltas,errors,
   runtime:'Installed Codex app-server and real SSE; local ACP protocol fixture, not live model inference'}),contentType:'application/json'});
  await info.attach('測試來源',{body:await readFile(import.meta.filename),contentType:'text/plain'});
 }finally{await app.close();await rm(home,{recursive:true,force:true});}
});
