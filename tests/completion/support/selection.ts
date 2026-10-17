import { chromium, expect as rawExpect, type Page, type TestInfo, type Browser } from '@playwright/test';
import { FixtureDatabase, sha } from './database.ts';
import { resolveManagedPage, type BrowserBinding, type Attachment } from './managed.ts';
type Binding=BrowserBinding&{runId:string;testDefinitionId:string;caseResultId:string;testKey:string};
type Frame=Binding&{type:'browser.frame';payload:{sha256:string;viewportWidth:number;viewportHeight:number}};
const tuple=(b:Binding)=>[b.runId,b.testDefinitionId,b.caseResultId,b.sessionId,b.contextRef,b.pageId,b.bindingSeq];
export class SelectionProbe {
 private starts:{runId:string;testKey:string}[]=[];private frames:Binding[]=[];private errors:unknown[]=[];private tasks:Promise<void>[]=[];private browsers=new Map<string,Browser>();
 constructor(private page:Page,private db:FixtureDatabase,private vars:Record<string,unknown>,private info:TestInfo,private check:typeof rawExpect=rawExpect){
  page.on('websocket',ws=>{let header:Frame|undefined;
   ws.on('framereceived',({payload})=>{
    if(typeof payload==='string'){
     let event:any;try{event=JSON.parse(payload);}catch{return;}
     if(event.type==='run.testStarted')this.starts.push({runId:event.runId,testKey:event.testKey});
     if(event.type==='browser.frame')header=event as Frame;
    }else if(header){const current=header;header=undefined;this.tasks.push(this.frame(current,Buffer.from(payload)).catch(error=>{this.errors.push(error);}));}
   });
  });
 }
 async open(){await this.page.goto(`/projects/${this.vars.project}/requirements/${this.vars.requirement}/tests`);await this.check(this.page.getByTestId('scenario-tests')).toBeVisible();}
 async list(){
  for(const [key,ids] of [['a',['test-a','test-a-extra']],['b',['test-b']]] as const){const row=this.page.getByTestId('scenario-case-'+key);await this.check(row).toContainText('AC-DEMO-001');for(const id of ids)await this.check(row.getByTestId('case-test-ids')).toContainText(id);}
 }
 async pending(){
  for(const key of ['a','b']){const row=this.page.getByTestId('scenario-case-'+key);await this.check(row.getByTestId('case-readiness')).toHaveText('PENDING_COMPLETION');await this.check(row.getByTestId('case-execution-status')).toHaveText('NOT_RUN');await this.check(row.getByTestId('case-run')).toBeDisabled();}
  const response=await this.page.request.post(`/requirements/${this.vars.requirement}/verify`,{data:{testBaselineId:null,sourceRef:this.vars.sourceRef,selection:{mode:'SELECTED_CASES',sourceCaseIds:[this.vars.caseA]}}});
  this.check(response.status()).toBe(409);this.check(await response.text()).toContain('TESTS_PENDING_COMPLETION');
  this.check(this.db.all('SELECT id FROM runs WHERE requirement_id=?',[String(this.vars.requirement)])).toHaveLength(0);
 }
 async start(){
  // Real completion use case; no fixture DB update substitutes for its result.
  await this.page.getByTestId('complete-tests').click();await this.check(this.page.getByTestId('test-readiness')).toHaveText('COMPLETED',{timeout:60_000});
  const row=this.db.all('SELECT v.* FROM document_heads h JOIN document_versions v ON v.id=h.version_id WHERE h.document_id=?',[String(this.vars.specDoc)])[0];
  this.check(row.test_stage).toBe('COMPLETED');this.check(row.source_skeleton_version_id).toBe(this.vars.specSkeletonVersion);this.check(row.id).not.toBe(this.vars.specSkeletonVersion);
  const ids=this.db.all('SELECT t.test_key,c.case_key FROM test_definitions t JOIN test_case_mappings m ON m.test_definition_id=t.id JOIN source_cases c ON c.id=m.source_case_id WHERE t.spec_version_id=? ORDER BY t.test_key',[String(row.id)]);
  this.check(ids).toEqual([{test_key:'test-a',case_key:'a'},{test_key:'test-a-extra',case_key:'a'},{test_key:'test-b',case_key:'b'}]);
  await this.page.getByTestId('start-development').click();
  if(!this.vars.sourceRef)throw Error('WB_SOURCE_REF required; no invented product revision');
  await this.page.getByTestId('source-ref').fill(String(this.vars.sourceRef));await this.page.getByTestId('pin-source').click();
  await this.check(this.page.getByTestId('pinned-source-ref')).toHaveText(String(this.vars.sourceRef));
  const baseline=this.db.all("SELECT id,sha256 FROM baselines WHERE requirement_id=? AND kind='tests' AND valid=1",[String(this.vars.requirement)]);this.check(baseline).toHaveLength(1);this.vars.baseline=baseline[0].id;
  const responsePromise=this.page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===`/requirements/${this.vars.requirement}/verify`);
  await this.page.getByTestId('scenario-case-a').getByTestId('case-select').check();await this.page.getByTestId('run-selected-cases').click();
  const response=await responsePromise;this.check(response.ok()).toBe(true);const request=response.request().postDataJSON();this.check(request.selection).toEqual({mode:'SELECTED_CASES',sourceCaseIds:[this.vars.caseA]});
  const result=await response.json();this.vars.run=result.runId;this.check(result.scope).toBe('SELECTED_CASES');this.check(result.expectedTestKeys.sort()).toEqual(['test-a','test-a-extra']);
 }
 async exactSet(){
  await this.check.poll(()=>this.db.all('SELECT t.test_key FROM run_test_selection s JOIN test_definitions t ON t.id=s.test_definition_id WHERE s.run_id=? ORDER BY t.test_key',[String(this.vars.run)])).toEqual([{test_key:'test-a'},{test_key:'test-a-extra'}]);
  this.check(this.db.all('SELECT source_case_id FROM run_source_cases WHERE run_id=?',[String(this.vars.run)])).toEqual([{source_case_id:this.vars.caseA}]);
  await this.check.poll(async()=>{const r=await this.report();return r.status;},{timeout:90_000}).toMatch(/^(PASSED|FAILED|INCOMPLETE)$/);
  const report=await this.report();this.check(report.executedTestKeys.sort()).toEqual(['test-a','test-a-extra']);await this.check.poll(()=>this.starts.filter(s=>s.runId===this.vars.run).map(s=>s.testKey).sort()).toEqual(['test-a','test-a-extra']);
 }
 async unselected(){
  this.check(this.db.all('SELECT c.id FROM case_results c JOIN test_definitions t ON t.id=c.test_definition_id WHERE c.run_id=? AND t.test_key=?',[String(this.vars.run),'test-b'])).toHaveLength(0);
  const row=this.page.getByTestId('scenario-case-b');await this.check(row.getByTestId('case-execution-status')).toHaveText('NOT_RUN');await this.check(row).toHaveAttribute('data-selected','false');
  const report=await this.report();this.check(report.sourceCases.find((c:any)=>c.caseId==='b')).toMatchObject({selected:false,status:'NOT_RUN'});
 }
 private async frame(header:Frame,bytes:Buffer){
  if(header.runId!==this.vars.run)return;
  this.check(header.payload.sha256).toBe(sha(bytes));this.check(header.payload.viewportWidth).toBeGreaterThan(0);this.check(header.payload.viewportHeight).toBeGreaterThan(0);
  const response=await this.page.request.get(`/runs/${header.runId}/viewer-binding`);this.check(response.ok()).toBe(true);const current=await response.json() as Binding;
  if(JSON.stringify(tuple(header))!==JSON.stringify(tuple(current)))return; // Late frames are allowed on wire; never accepted by current canvas.
  const canvas=this.page.getByTestId('run-browser-canvas');
  const presented=await canvas.evaluate(async(element,args)=>{
   const c=element as HTMLCanvasElement;if(c.dataset.frameSha256!==args.sha)return false;
   const received=await createImageBitmap(new Blob([new Uint8Array(args.bytes)],{type:'image/jpeg'}));
   const expected=new OffscreenCanvas(32,24),actual=new OffscreenCanvas(32,24);
   expected.getContext('2d')!.drawImage(received,0,0,32,24);actual.getContext('2d')!.drawImage(c,0,0,32,24);
   const a=expected.getContext('2d')!.getImageData(0,0,32,24).data,b=actual.getContext('2d')!.getImageData(0,0,32,24).data;
   if(c.dataset.frameSha256!==args.sha||!a.every((value,i)=>Math.abs(value-b[i])<=2))return false;return {...c.dataset};
  },{sha:header.payload.sha256,bytes:[...bytes]});if(!presented)return;
  for(const [key,value] of Object.entries({runId:header.runId,testDefinitionId:header.testDefinitionId,caseResultId:header.caseResultId,sessionId:header.sessionId,contextRef:header.contextRef,pageId:header.pageId,bindingSeq:String(header.bindingSeq)}))this.check(presented[key]).toBe(String(value));
  const attach=await this.page.request.get(`/internal/browser-sessions/${header.sessionId}/attachment`);this.check(attach.ok()).toBe(true);const attachment=await attach.json() as Attachment;
  this.check(attachment.sessionId).toBe(header.sessionId);
  let browser=this.browsers.get(attachment.playwrightEndpoint);if(!browser){browser=await chromium.connect(attachment.playwrightEndpoint,{timeout:15_000});this.browsers.set(attachment.playwrightEndpoint,browser);}
  const operatedPage=await resolveManagedPage(browser,header);this.check(operatedPage.isClosed()).toBe(false);this.check(operatedPage.url()).not.toBe('about:blank');
  const result=this.db.all('SELECT runtime_test_key FROM case_results WHERE id=? AND run_id=?',[header.caseResultId,header.runId]);this.check(result).toEqual([{runtime_test_key:header.testKey}]);
  await this.info.attach(`live-${header.testKey}-${header.bindingSeq}`,{body:bytes,contentType:'image/jpeg'});this.frames.push(header);
 }
 async live(){await this.check.poll(()=>this.frames.filter(f=>f.runId===this.vars.run).map(f=>f.testKey).filter((key,i,all)=>all.indexOf(key)===i).sort(),{timeout:15_000}).toEqual(['test-a','test-a-extra']);await Promise.all(this.tasks);this.check(this.errors.map(String)).toEqual([]);for(const key of ['test-a','test-a-extra'])this.check(this.frames.some(f=>f.runId===this.vars.run&&f.testKey===key),`real same-run canvas/page frame for ${key}`).toBe(true);}
 async evidence(){
  const report=await this.report();this.check(report.runId).toBe(this.vars.run);this.check(report.scope).toBe('SELECTED_CASES');this.check(report.testBaselineId).toBe(this.vars.baseline);this.check(report.sourceRef).toBe(this.vars.sourceRef);
  this.check(report.cases.map((c:any)=>c.testKey).sort()).toEqual(['test-a','test-a-extra']);
  for(const c of report.cases){this.check(c.runId).toBe(this.vars.run);this.check(c.scenarioId).toBe('AC-DEMO-001');this.check(c.caseId).toBe('a');this.check(c.executed).toBe(true);this.check(c.steps.length).toBeGreaterThan(0);this.check(c.steps.some((s:any)=>s.assertion)).toBe(true);
   for(const s of c.steps){this.check(s.runId).toBe(this.vars.run);this.check(s.testDefinitionId).toBe(c.testDefinitionId);this.check(s.sourceCaseId).toBe(this.vars.caseA);this.check(s.sourceStepId).toBeTruthy();this.check(s.actionIndex).toBeGreaterThan(0);this.check(s.sessionId).toBeTruthy();this.check(s.contextRef).toBeTruthy();this.check(s.pageId).toBeTruthy();this.check(s.bindingSeq).toBeGreaterThan(0);if(s.assertion){this.check(s).toHaveProperty('expected');this.check(s).toHaveProperty('actual');if(s.status==='PASSED')this.check(s.assertionPassed).toBe(true);}this.check(s.screenshots.length).toBeGreaterThan(0);
    for(const shot of s.screenshots){const response=await this.page.request.get(`/screenshots/${shot.id}`);this.check(response.ok()).toBe(true);this.check(sha(await response.body())).toBe(shot.sha256);}
   }
  }
 }
 async passed(){const report=await this.report();this.check(report.status).toBe('PASSED');for(const c of report.cases){this.check(c.status).toBe('PASSED');this.check(c.steps.every((s:any)=>s.status==='PASSED')).toBe(true);}await this.check(this.page.getByTestId('scenario-case-a').getByTestId('case-execution-status')).toHaveText('PASSED');}
 async partial(){const report=await this.report();this.check(report.coverageComplete).toBe(false);this.check(report.requiredTestCount).toBe(3);this.check(report.executedTestKeys).toHaveLength(2);this.check(report.unexecutedTestKeys).toEqual(['test-b']);this.check(this.db.all('SELECT stage FROM requirements WHERE id=?',[String(this.vars.requirement)])[0].stage).toBe('VERIFICATION');}
 private async report(){const response=await this.page.request.get(`/runs/${this.vars.run}/report`);this.check(response.ok()).toBe(true);return response.json();}
 async close(){await Promise.all(this.tasks);for(const browser of this.browsers.values())await browser.close();}
}
