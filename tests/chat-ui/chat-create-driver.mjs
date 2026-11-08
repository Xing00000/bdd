import {mkdtemp,readFile,readdir,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createStandaloneServer} from '../../packages/workstation/http.mjs';
import {composerPaths,requirementDiagnostics} from '../../packages/workstation/requirements.mjs';
import {Parser,AstBuilder,GherkinClassicTokenMatcher} from '@cucumber/gherkin';
import {IdGenerator} from '@cucumber/messages';
import {DatabaseSync} from 'node:sqlite';
import {exists} from '../../packages/contracts/index.mjs';

export class ChatCreateDriver {
 static async open(page,provider,{expect,openMenu,timeoutMs,gitBound=false}){
  const base=await realpath(await mkdtemp(path.join(tmpdir(),'bdd-live-chat-create-')));
  const home=path.join(base,'home'),remote=path.join(base,'remote.git');
  if(gitBound)execFileSync('git',['init','--bare','--initial-branch','main',remote],{stdio:'pipe'});
  const options={home,toolkitRoot:fileURLToPath(new URL('../../',import.meta.url)),allowLocal:true,enableExecution:false};
  const d=new ChatCreateDriver();Object.assign(d,{page,provider,base,home,options,errors:[],expect,timeoutMs});
  d.title=`聊天建立需求 ${provider} ${randomUUID()}`;
  d.description=`${d.title}\n使用者登入後應看見自己的帳戶名稱。`;
  d.app=await createStandaloneServer(options);
  try{
   d.repository=d.app.service.register({title:d.title,...(gitBound?{remoteUrl:remote}:{})});
   const request={schemaVersion:1,operationId:'OP-'+randomUUID(),repositoryId:d.repository.id,operation:'repository.setup',input:{reviewer:'Playwright live chat verification',projects:[]}};
   d.app.service.enqueue(request);const op=await d.app.service.wait(request.operationId);expect(op.status,JSON.stringify(op.error)).toBe('SUCCEEDED');
   const chat=await d.app.service.chat();await chat.patchSettings({acpProvider:provider,timeoutMs});
   page.on('pageerror',error=>d.errors.push(error.message));
   await page.addInitScript(()=>{window.liveChatDocumentId=crypto.randomUUID();});
   await new Promise(resolve=>d.app.server.listen(0,'127.0.0.1',resolve));d.origin=`http://127.0.0.1:${d.app.server.address().port}`;
   await page.goto(`${d.origin}/?repo=${d.repository.id}&view=features`);
   await openMenu(page,'chat');await page.getByTestId('new-chat').click();
   await expect(page.getByRole('textbox',{name:'對話訊息輸入',exact:true})).toBeVisible();
   d.roomId=new URL(page.url()).searchParams.get('chat');return d;
  }catch(error){await d.app.close();throw error;}
 }
 async request(description=this.description){
  const {expect}=this;
  this.documentIdBefore=await this.page.evaluate(()=>window.liveChatDocumentId);
  const chat=await this.app.service.chat(),index=(await chat.detail(this.roomId)).messages.length;
  const prompt=`請在「${this.repository.title}」工作台直接建立並儲存下列新需求，撰寫具有具體 Given、When、Then 的 Gherkin 文件。請完成儲存，不要只產生提案，也不要派 CLI Agent 或 shell 代寫檔案，不要確認任何階段。需求原文請保留：\n${description}`;
  await this.page.getByRole('textbox',{name:'對話訊息輸入',exact:true}).fill(prompt);
  const sent=this.page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith(`/chat-rooms/${this.roomId}/messages`));
  await this.page.getByRole('button',{name:'送出',exact:true}).click();
  const response=await sent;expect(response.ok(),await response.text()).toBe(true);
  await expect.poll(async()=> (await chat.detail(this.roomId)).messages[index]?.status,{timeout:this.timeoutMs}).not.toBe('pending');
  this.room=await chat.detail(this.roomId);expect(this.room.messages[index].status,this.room.messages[index].error??JSON.stringify(this.room.messages)).toBe('completed');
 }
 async verifyCreated(){
  const {expect}=this;
  const detail=await this.app.service.detail(this.repository.id);
  expect(detail.spec.features).toHaveLength(1);
  this.feature=detail.spec.features[0];
  this.saved=await this.app.service.requirement(this.repository.id,this.feature.requirementId,this.feature.id);
  expect(this.saved.description).toBe(this.description);expect(requirementDiagnostics(this.saved.gherkin)).toEqual([]);
  const ast=new Parser(new AstBuilder(IdGenerator.incrementing()),new GherkinClassicTokenMatcher()).parse(this.saved.gherkin);
  expect(ast.feature.children.some(child=>child.scenario)).toBe(true);
  const stepTypes=ast.feature.children.flatMap(child=>child.scenario?.steps??[]).map(step=>step.keywordType);
  for(const type of ['Context','Action','Outcome'])expect(stepTypes).toContain(type);
  expect(this.feature.review.confirmed.gherkin).toBe(false);
  const file=composerPaths(this.feature.requirementId,this.feature.id).gherkin;
  const db=new DatabaseSync(path.join(this.home,'metadata.sqlite'),{readOnly:true});
  try{this.file={path:file,storage:'sqlite',content:db.prepare('SELECT content FROM authoring_files WHERE repository_id=? AND target=? AND path=?').get(this.repository.id,'spec',file).content};expect(this.file.content).toBe(this.saved.gherkin);}
  finally{db.close();}
  expect(await exists(detail.localPath)).toBe(false);
  expect(detail.remoteUrl).toBe(null);
  await expect(this.page.locator('#feature-select')).toHaveValue(this.feature.key);
  await expect(this.page.locator('#requirement-gherkin')).toHaveValue(this.saved.gherkin);
  await expect(this.page.locator('#requirement-description, #requirement-file, #upload-requirement, #interaction-history')).toHaveCount(0);
  expect(await this.page.evaluate(()=>window.liveChatDocumentId)).toBe(this.documentIdBefore);
  this.calls=await this.toolCalls();
  const reads=this.calls.filter(row=>row.payload.name?.includes('workbench_get_node')).map(row=>JSON.parse(row.payload.arguments));
  const submissions=this.calls.filter(row=>row.payload.name?.includes('workbench_submit_node')).map(row=>JSON.parse(row.payload.arguments));
  expect(reads.some(args=>args.nodeId===detail.creationNodeId)).toBe(true);
  expect(submissions.some(args=>args.response.description===this.description&&args.response.gherkin===this.saved.gherkin&&typeof args.key==='string')).toBe(true);
  expect(this.calls.some(row=>row.payload.name?.includes('workbench_create_requirement'))).toBe(false);
  expect(this.calls.some(row=>row.payload.name?.includes('agent_start'))).toBe(false);
  expect(this.app.service.agentSessions()).toEqual([]);
  expect(this.errors).toEqual([]);
 }
 async toolCalls(){
  const dir=path.join(this.home,'chat','codex','sessions'),files=await readdir(dir,{recursive:true});
  const logs=await Promise.all(files.filter(f=>f.endsWith('.jsonl')&&f.includes(this.room.thread_id)).map(f=>readFile(path.join(dir,f),'utf8')));
  return logs.flatMap(log=>log.split('\n').filter(Boolean).map(line=>JSON.parse(line))).filter(row=>row.payload?.type==='function_call');
 }
 async restartService(){
  const port=this.app.server.address().port;
  await this.app.close();this.app=await createStandaloneServer(this.options);
  await new Promise(resolve=>this.app.server.listen(port,'127.0.0.1',resolve));
  await this.page.reload();await this.expect(this.page.locator('#content')).toHaveAttribute('aria-busy','false');
 }
 async protectDraft(){
  const {expect}=this;
  const draft=this.saved.gherkin+'\n# 使用者尚未儲存的編輯 '+randomUUID()+'\n';
  await this.page.locator('#requirement-gherkin').fill(draft);
  const description='另一個通知需求 '+randomUUID()+'\n使用者開啟通知清單時應看見未讀通知數量。';
  await this.request(description);
  const detail=await this.app.service.detail(this.repository.id);expect(detail.spec.features).toHaveLength(2);
  const other=detail.spec.features.find(f=>f.key!==this.feature.key);
  const saved=await this.app.service.requirement(this.repository.id,other.requirementId,other.id);
  expect(saved.description).toBe(description);expect(requirementDiagnostics(saved.gherkin)).toEqual([]);
  expect(other.review.confirmed.gherkin).toBe(false);
  await expect(this.page.getByRole('button',{name:'查看新建立的需求',exact:true})).toBeVisible();
  await expect(this.page.locator('#requirement-gherkin')).toHaveValue(draft);
  await expect(this.page.locator('#feature-select')).toHaveValue(this.feature.key);
  expect((await this.app.service.requirement(this.repository.id,this.feature.requirementId,this.feature.id)).gherkin).toBe(this.saved.gherkin);
  expect(await this.page.evaluate(()=>window.liveChatDocumentId)).toBe(this.documentIdBefore);
  this.protectionEvidence={draft,created:saved};this.calls=await this.toolCalls();
  expect(this.calls.some(row=>row.payload.name?.includes('agent_start'))).toBe(false);
  expect(this.app.service.agentSessions()).toEqual([]);expect(this.errors).toEqual([]);
 }
 async reload(){
  await this.page.reload();await this.expect(this.page.locator('#requirement-gherkin')).toHaveValue(this.saved.gherkin);
 }
 async attach(info){
  await info.attach('真實模型建立需求畫面',{body:await this.page.screenshot({fullPage:true}),contentType:'image/png'});
  await info.attach('真實 ACP、工具呼叫與文件證據',{body:JSON.stringify({provider:this.provider,home:this.home,description:this.description,room:this.room,saved:this.saved,file:this.file,calls:this.calls,protection:this.protectionEvidence,errors:this.errors},null,2),contentType:'application/json'});
 }
 async close(){await this.app.close();}
}
