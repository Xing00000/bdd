import {expect,type Page,type TestInfo} from '@playwright/test';
import {mkdtemp,readFile,readdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';

export class ChatToolsDriver {
 private constructor(readonly page:Page,readonly home:string,readonly options:object,public app:any){}
 url='';roomId='';threadId='';proposalId='';errors:string[]=[];
 repository:{id:string;title:string}={id:'',title:''};
 editorKey='new-'+randomUUID();description='需求提案 '+randomUUID()+'\n登入後顯示帳戶頁面';
 baseline:unknown;
 static async open(page:Page){
  const home=await realpath(await mkdtemp(path.join(tmpdir(),'bdd-chat-tools-ui-')));
  const {createStandaloneServer}=await import(pathToFileURL(path.resolve('packages/workstation/http.mjs')).href);
  const options={home,toolkitRoot:process.cwd(),autoAcquire:false,enableExecution:false};
  const driver=new ChatToolsDriver(page,home,options,await createStandaloneServer(options));
  driver.repository=driver.app.service.register({title:'聊天能力驗證 '+randomUUID(),remoteUrl:'https://github.com/openai/codex'});
  await new Promise<void>(resolve=>driver.app.server.listen(0,'127.0.0.1',resolve));driver.url=`http://127.0.0.1:${driver.app.server.address().port}`;
  page.on('pageerror',error=>driver.errors.push(error.message));driver.baseline=driver.authoring();
  await page.goto(driver.url);await page.getByTestId('new-chat').click();await expect(page.getByRole('textbox',{name:'對話訊息輸入',exact:true})).toBeVisible();driver.roomId=new URL(page.url()).searchParams.get('chat')!;
  return driver;
 }
 async get(route:string){const r=await this.page.request.get(this.url+'/repository-api/v1'+route);expect(r.ok(),await r.text()).toBe(true);return r.json();}
 room(){return this.get('/chat-rooms/'+this.roomId);}
 proposals(){return this.get(`/spec-repositories/${this.repository.id}/requirement/proposals?editorKey=${encodeURIComponent(this.editorKey)}`);}
 authoring(){
  const db=new DatabaseSync(path.join(this.home,'metadata.sqlite'),{readOnly:true});
  try{return {state:db.prepare('SELECT * FROM authoring_state').all(),files:db.prepare('SELECT * FROM authoring_files').all(),history:db.prepare('SELECT * FROM authoring_history').all()};}finally{db.close();}
 }
 async send(text:string){await this.page.getByRole('textbox',{name:'對話訊息輸入',exact:true}).fill(text);await this.page.getByRole('button',{name:'送出',exact:true}).click();}
 async waitForReply(userIndex:number,assistantCount:number){
  await expect.poll(async()=> (await this.room()).messages[userIndex]?.status??'pending',{timeout:180000}).not.toBe('pending');
  const room=await this.room();expect(room.messages[userIndex].status,room.messages[userIndex].error??'reply status').toBe('completed');
  await expect(this.page.getByTestId('chat-message-assistant')).toHaveCount(assistantCount);
 }
 async generate(){
  await this.send(`請先呼叫工作站 MCP 查詢規格庫，找出名稱 ${JSON.stringify(this.repository.title)} 的規格庫，再透過工作站工具產生並保存一筆需求提案。editorKey 使用 ${JSON.stringify(this.editorKey)}；description 必須原樣使用以下 JSON 字串的值：${JSON.stringify(this.description)}。只產生一次，不確認任何階段。完成後回覆真實 proposalId 與規格庫 ID。`);
  await this.waitForReply(0,1);
 }
 async toolRecords(){
  const dir=path.join(this.home,'chat/codex/sessions'),files=await readdir(dir,{recursive:true});
  const logs=await Promise.all(files.filter(f=>f.endsWith('.jsonl')&&f.includes(this.threadId)).map(f=>readFile(path.join(dir,f),'utf8')));
  return logs.flatMap(log=>log.split('\n').filter(Boolean).map(line=>JSON.parse(line))).filter(row=>['function_call','function_call_output'].includes(row.payload?.type));
 }
 async proposalEvidence(){
  const room=await this.room();this.threadId=room.thread_id;const proposals=await this.proposals();this.proposalId=proposals[0]?.id;
  const db=new DatabaseSync(path.join(this.home,'metadata.sqlite'),{readOnly:true});let rows,operations;
  try{rows=db.prepare('SELECT * FROM requirement_proposals WHERE repository_id=?').all(this.repository.id);operations=db.prepare('SELECT status,request_json,result_json FROM operations WHERE repository_id=?').all(this.repository.id);}finally{db.close();}
  return {room,proposals,rows,operations,tools:await this.toolRecords(),authoring:this.authoring()};
 }
 async restartAndAsk(){
  const url=this.page.url(),port=this.app.server.address().port;await this.app.close();
  const {createStandaloneServer}=await import(pathToFileURL(path.resolve('packages/workstation/http.mjs')).href);this.app=await createStandaloneServer(this.options);
  await new Promise<void>(resolve=>this.app.server.listen(port,'127.0.0.1',resolve));await this.page.goto(url);
  await this.send('請透過工作站 MCP 重新讀取剛才保存的需求提案，回覆同一筆 proposalId 與完整原始 description，不要產生新的提案。');
  await this.waitForReply(2,2);
 }
 async attach(info:TestInfo){
  await info.attach('UIUX：正式工作站聊天操作畫面',{body:await this.page.screenshot({fullPage:true}),contentType:'image/png'});
  await info.attach('UIUX：MCP、SQLite、API 與原始需求對照',{body:JSON.stringify({scenario:'AC-WB-039',testLevel:'e2e',runtime:'real Codex -> Copilot structured toolRequests -> Codex MCP -> workstation service',expected:{repository:this.repository,description:this.description,editorKey:this.editorKey,authoringUnchanged:this.baseline},actual:await this.proposalEvidence(),errors:this.errors},null,2),contentType:'application/json'});
  await info.attach('驗收程式與原始 Gherkin',{body:(await readFile(import.meta.filename,'utf8'))+'\n'+await readFile('spec/REQ-WB-001/workbench/workbench.feature','utf8'),contentType:'text/plain'});
 }
 async close(){await this.app.close();expect(this.errors).toEqual([]);}
}
