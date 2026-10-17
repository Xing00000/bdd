import { test as base, expect, chromium, type Page, type TestInfo, type APIRequestContext } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { resolveManagedPage, type Attachment, type BrowserBinding } from '../support/managed.ts';
export { expect };
type Execution={runId:string;testDefinitionId:string;sourceCaseId:string;testKey:string;sourceSteps:Record<string,string>;app:Attachment;db:Attachment;dbUiUrl:string};
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
export class ManagedRunner {
 private queryRows:Record<string,unknown>[]=[];
 private index=0;private bindingSeq=0;private identities=new WeakMap<Page,BrowserBinding>();
 constructor(readonly appPage:Page,readonly dbPage:Page,private execution:Execution,private request:APIRequestContext,private info:TestInfo){this.identities.set(appPage,execution.app);this.identities.set(dbPage,execution.db);}
 private async event(type:string,payload:Record<string,unknown>,binding?:BrowserBinding){
  const e=this.execution;const response=await this.request.post(`/internal/runs/${e.runId}/events`,{data:{eventId:randomUUID(),type,runId:e.runId,testDefinitionId:e.testDefinitionId,testKey:e.testKey,sourceCaseId:e.sourceCaseId,...binding,payload}});
  expect(response.ok(),await response.text()).toBe(true);return response.json();
 }
 async capture<T>(line:number,label:string,page:Page,action:()=>Promise<T>,expected?:unknown):Promise<T>{
  const identity=this.identities.get(page);if(!identity)throw Error('Unregistered managed runner page');
  const sourceStepId=this.execution.sourceSteps[String(line)];if(!sourceStepId)throw Error('No source step for line '+line);
  const bound=await this.event('run.browserBound',{},identity);expect(bound.bindingSeq).toBeGreaterThan(this.bindingSeq);this.bindingSeq=bound.bindingSeq;
  const binding={...identity,bindingSeq:this.bindingSeq},index=++this.index;let error:unknown,actual:unknown;
  try{actual=await action();return actual as T;}catch(e){error=e;const matcher=(e as {matcherResult?:{actual?:unknown;expected?:unknown}}).matcherResult;actual=matcher?.actual;expected=matcher?.expected??expected;throw e;}
  finally{
   let image:Buffer|undefined,imageError:unknown;try{image=await page.screenshot();await this.info.attach(`${index}-L${line}-${error?'failure':'after'}-${label}`,{body:image,contentType:'image/png'});}catch(e){imageError=e;}
   try{await this.event('run.stepFinished',{sourceStepId,sourceStepLine:line,actionIndex:index,label,assertion:expected!==undefined,assertionPassed:expected!==undefined?!error:null,expected:expected??null,actual:actual??null,status:error?'FAILED':imageError?'INCOMPLETE':'PASSED',error:error?String(error):imageError?String(imageError):null,screenshot:image?{moment:error?'failure':expected!==undefined?'after_assertion':line===4?'precondition':'after_action',sha256:sha(image),contentType:'image/png',base64:image.toString('base64')}:null},binding);}catch(e){if(!error)throw e;}
   if(imageError&&!error)throw imageError;
  }
 }
 async query(sql:string,line=4){
  await this.capture(line,'db-open',this.dbPage,()=>this.dbPage.goto(this.execution.dbUiUrl));
  await this.capture(line,'sql-input',this.dbPage,()=>this.dbPage.getByTestId('sql-editor').fill(sql));
  const waiting=this.dbPage.waitForResponse(r=>r.request().method()==='POST'&&/\/query$/.test(new URL(r.url()).pathname));
  await this.capture(line,'sql-run',this.dbPage,()=>this.dbPage.getByTestId('sql-run').click());
  const response=await waiting;expect(response.ok()).toBe(true);this.queryRows=(await response.json()).rows??[];
  await this.capture(line,'sql-completed',this.dbPage,async()=>{await expect(this.dbPage.getByTestId('sql-execution-state')).toHaveText('completed');return this.dbPage.getByTestId('sql-execution-state').innerText();},'completed');
  return this.dbPage.getByTestId('db-results').innerText();
 }
 async login(url:string,role:string){
  expect(['A','B']).toContain(role);
  await this.query(`UPDATE test_accounts SET role_code='${role}' WHERE username='scenario_user';`);
  await this.query("SELECT role_code,state FROM test_accounts WHERE username='scenario_user';");
  await this.capture(4,'db-role',this.dbPage,async()=>{await expect(this.dbPage.getByTestId('db-results')).toContainText(role);const actual=this.queryRows[0]?.role_code;expect(actual).toBe(role);return actual;},role);
  await this.capture(4,'app-open',this.appPage,()=>this.appPage.goto(url));
  if(await this.appPage.getByTestId('logout').isVisible())await this.capture(4,'logout',this.appPage,()=>this.appPage.getByTestId('logout').click());
  await this.capture(4,'username',this.appPage,()=>this.appPage.getByTestId('login-username').fill('scenario_user'));
  if(!process.env.WB_TARGET_PASSWORD)throw Error('WB_TARGET_PASSWORD missing');
  await this.capture(4,'password',this.appPage,()=>this.appPage.getByTestId('login-password').fill(process.env.WB_TARGET_PASSWORD!));
  await this.capture(4,'login',this.appPage,()=>this.appPage.getByTestId('login-submit').click());
  await this.capture(4,'role',this.appPage,async()=>{const actual=await this.appPage.getByTestId('account-role').innerText();expect(actual).toBe(role);return actual;},role);
 }
 async edit(outcome:string){
  if(outcome==='saved'){
   await this.capture(5,'edit',this.appPage,()=>this.appPage.getByTestId('document-content').fill('edited'));
   await this.capture(5,'save',this.appPage,()=>this.appPage.getByTestId('document-save').click());
  }else{expect(outcome).toBe('denied');await this.capture(5,'readonly',this.appPage,async()=>{await expect(this.appPage.getByTestId('document-content')).not.toBeEditable();return this.appPage.getByTestId('document-content').isEditable();},false);}
 }
 async assertOutcome(outcome:string){
  if(outcome==='saved'){
   await this.capture(6,'saved',this.appPage,async()=>{await expect(this.appPage.getByTestId('document-saved')).toBeVisible();return this.appPage.getByTestId('document-saved').isVisible();},true);
   await this.query("SELECT content FROM test_documents WHERE document_key='scenario_document';",6);
   await this.capture(6,'persisted-content',this.dbPage,async()=>{await expect(this.dbPage.getByTestId('db-results')).toContainText('edited');const actual=this.queryRows[0]?.content;expect(actual).toBe('edited');return actual;},'edited');
  }else{expect(outcome).toBe('denied');await this.capture(6,'denied',this.appPage,async()=>{await expect(this.appPage.getByTestId('document-content')).not.toBeEditable();return this.appPage.getByTestId('document-content').isEditable();},false);}
 }
}
export const runnerFixture=async({request}:{request:APIRequestContext},use:(runner:ManagedRunner)=>Promise<void>,info:TestInfo)=>{
 const runId=process.env.WB_RUN_ID,testKey=info.annotations.find(a=>a.type==='workbenchTestId')?.description;
 if(!runId||!testKey)throw Error('Managed runner requires WB_RUN_ID and explicit testKey');
 const response=await request.get(`/internal/runs/${runId}/tests/${encodeURIComponent(testKey)}/execution-context`);expect(response.ok()).toBe(true);
 const e=await response.json() as Execution;expect(e.runId).toBe(runId);expect(e.testKey).toBe(testKey);
 const browsers=[];try{
  const browser=await chromium.connect(e.app.playwrightEndpoint,{timeout:15_000});browsers.push(browser);
  const dbBrowser=e.db.playwrightEndpoint===e.app.playwrightEndpoint?browser:await chromium.connect(e.db.playwrightEndpoint,{timeout:15_000});if(dbBrowser!==browser)browsers.push(dbBrowser);
  const app=await resolveManagedPage(browser,e.app),db=await resolveManagedPage(dbBrowser,e.db);
  await use(new ManagedRunner(app,db,e,request,info));
 }finally{for(const browser of browsers)await browser.close();}
};
export const test=base.extend<{runner:ManagedRunner}>({runner:runnerFixture});
