import {expect,type Page,type TestInfo} from '@playwright/test';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

declare global {interface Window {chatStreamEvidence:any[];}}
export class ChatStreamDriver {
 private constructor(readonly page:Page,readonly app:any){}
 roomId='';url='';requests:string[]=[];errors:string[]=[];inferenceRequests:string[]=[];answer='';events:any[]=[];
 static async open(page:Page){
  await page.addInitScript(()=>{
   const Native=window.EventSource;window.chatStreamEvidence=[];
   window.EventSource=class extends Native{constructor(url:string|URL,options?:EventSourceInit){super(url,options);this.addEventListener('message',event=>window.chatStreamEvidence.push(JSON.parse(event.data)));}};
  });
  const {createStandaloneServer}=await import(pathToFileURL(path.resolve('packages/workstation/http.mjs')).href);
  const app=await createStandaloneServer({home:await mkdtemp(path.join(tmpdir(),'bdd-chat-stream-ui-')),toolkitRoot:process.cwd(),enableExecution:false});
  const driver=new ChatStreamDriver(page,app);
  page.on('pageerror',error=>driver.errors.push(error.message));
  await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));driver.url=`http://127.0.0.1:${app.server.address().port}`;
  await page.goto(driver.url);await page.getByTestId('new-chat').click();await page.getByRole('textbox',{name:'對話訊息輸入'}).waitFor();driver.roomId=new URL(page.url()).searchParams.get('chat')!;
  page.on('request',request=>{if(request.method()==='GET'&&/\/chat-rooms(?:\/[^/?]+)?$/.test(new URL(request.url()).pathname))driver.requests.push(request.url());});return driver;
 }
 async send(){await this.page.getByRole('textbox',{name:'對話訊息輸入'}).fill('Write a numbered list of 30 distinct short facts about prime numbers.');await this.page.getByRole('button',{name:'送出',exact:true}).click();}
 async early(){
  await expect.poll(()=>this.page.evaluate(()=>window.chatStreamEvidence.filter(event=>event.type==='delta'&&event.delta.length>0).length),{timeout:180000}).toBeGreaterThan(1);
 }
 async complete(){
  await expect(this.page.getByTestId('chat-message-assistant')).toHaveCount(1,{timeout:180000});this.events=await this.page.evaluate(()=>window.chatStreamEvidence);
  const deltas=this.events.filter(event=>event.type==='delta'),completed=this.events.findIndex(event=>event.type==='snapshot'&&event.room?.messages.some((message:any)=>message.role==='assistant'&&message.status==='completed'));
  expect(this.events.indexOf(deltas[0])).toBeLessThan(completed);
  this.answer=(await this.page.getByTestId('chat-message-assistant').locator('.chat-message-content').textContent())!;expect(this.answer).toBe(deltas.map(event=>event.delta).join(''));this.inferenceRequests=[...this.requests];expect(this.inferenceRequests).toEqual([]);
  const room=await this.app.service.chat().then((chat:any)=>chat.detail(this.roomId));expect(room.messages.at(-1).content).toBe(this.answer);
 }
 async reconnect(){await this.page.reload();await expect(this.page.getByTestId('chat-message-assistant')).toHaveCount(1);await expect(this.page.getByTestId('chat-message-assistant').locator('.chat-message-content')).toHaveText(this.answer);}
 async failure(){
  const chat=await this.app.service.chat(),settings=await chat.settings();await chat.saveSettings({...settings,codexExecutable:path.join(this.app.service.options.home,'missing-codex')});
  await this.page.getByRole('textbox',{name:'對話訊息輸入'}).fill('Verify failed inference');await this.page.getByRole('button',{name:'送出',exact:true}).click();await expect(this.page.getByRole('alert').filter({hasText:'回覆失敗'})).toBeVisible();await expect(this.page.getByTestId('chat-message-assistant')).toHaveCount(1);
 }
 async attach(info:TestInfo){await info.attach('SSE 增量、完成順序與完整對話 GET 計數',{body:JSON.stringify({events:this.events,fullConversationGetsDuringInference:this.inferenceRequests,errors:this.errors},null,2),contentType:'application/json'});await info.attach('串流操作畫面',{body:await this.page.screenshot({fullPage:true}),contentType:'image/png'});}
 async close(){await this.app.close();expect(this.errors).toEqual([]);}
}
