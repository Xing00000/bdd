import {expect,type Page,type TestInfo} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {copilotModelPeer} from '../helpers/copilot-model-peer.ts';

export class ChatModelsDriver {
 private constructor(readonly page:Page,readonly app:any,readonly home:string){}
 roomId='';url='';catalog:any;before:any;requests:string[]=[];errors:string[]=[];
 static async open(page:Page){
  const {createStandaloneServer}=await import(pathToFileURL(path.resolve('packages/workstation/http.mjs')).href);
  const home=await mkdtemp(path.join(tmpdir(),'bdd-chat-model-ui-')),app=await createStandaloneServer({home,toolkitRoot:process.cwd(),enableExecution:false}),driver=new ChatModelsDriver(page,app,home);
  try{
   const chat=await app.service.chat();driver.before=await chat.settings();await chat.saveSettings({...driver.before,...await copilotModelPeer(home,[{id:'fixture-a',name:'協定測試模型 A'},{id:'fixture-b',name:'協定測試模型 B'}])});
   page.on('pageerror',error=>driver.errors.push(error.message));page.on('request',request=>{if(request.url().endsWith('/chat-models'))driver.requests.push(request.url());});
   await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));driver.url=`http://127.0.0.1:${app.server.address().port}`;
   await page.goto(driver.url);const catalog=page.waitForResponse(response=>response.url().endsWith('/chat-models'));await page.getByTestId('new-chat').click();await expect(page.getByRole('textbox',{name:'對話訊息輸入',exact:true})).toBeVisible();driver.roomId=new URL(page.url()).searchParams.get('chat')!;
   driver.catalog=await (await catalog).json();await expect(page.getByRole('combobox',{name:'對話模型',exact:true})).toBeEnabled();return driver;
  }catch(error){await driver.close();throw error;}
 }
 async select(){await this.page.getByRole('combobox',{name:'對話模型',exact:true}).selectOption('fixture-b');await expect(this.page.locator('.chat-model-picker [role=status]')).toHaveText('模型已保存，供後續訊息使用。');}
 async persisted(){
  const chat=await this.app.service.chat(),settings=await chat.settings();expect(settings.model).toBe('fixture-b');expect(settings.codexExecutable).toBe(this.before.codexExecutable);expect(settings.timeoutMs).toBe(this.before.timeoutMs);
  const before=await chat.detail(this.roomId);await this.page.reload();await expect(this.page.getByRole('combobox',{name:'對話模型',exact:true})).toHaveValue('fixture-b');expect(await chat.detail(this.roomId)).toEqual(before);
  await this.page.getByText('對話設定',{exact:true}).click();await this.page.getByRole('button',{name:'儲存對話設定',exact:true}).click();await expect(this.page.getByRole('status').filter({hasText:'對話設定已儲存'})).toBeVisible();expect((await chat.settings()).model).toBe('fixture-b');await expect(this.page.locator('.chat-model-picker [role=status]')).toHaveText('已取得 2 個模型');
 }
 async refresh(){
  const before=this.requests.length;await expect(this.page.getByRole('button',{name:'重新整理模型',exact:true})).toHaveCount(0);await this.page.reload();await expect(this.page.locator('.chat-model-picker [role=status]')).toHaveText('已取得 2 個模型');expect(this.requests.length).toBe(before+1);await expect(this.page.getByRole('combobox',{name:'對話模型',exact:true})).toHaveValue('fixture-b');expect(this.errors).toEqual([]);
 }
 async attach(info:TestInfo){await info.attach('UIUX：模型選單與保存狀態（協定 peer，非模型推論）',{body:await this.page.screenshot({fullPage:true}),contentType:'image/png'});await info.attach('實際模型清單協定與 SQLite 設定',{body:JSON.stringify({catalog:this.catalog,settings:await this.app.service.chat().then((chat:any)=>chat.settings()),requests:this.requests,errors:this.errors},null,2),contentType:'application/json'});}
 async close(){await this.app.close();await rm(this.home,{recursive:true,force:true});}
}
