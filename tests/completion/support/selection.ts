import { chromium, expect as rawExpect, type Page, type TestInfo, type Browser } from '@playwright/test';
import { FixtureDatabase, sha } from './database.ts';
import { resolveManagedPage, type BrowserBinding, type Attachment } from './managed.ts';
type Binding=BrowserBinding&{runId:string;testDefinitionId:string;caseResultId:string;testKey:string};
type Frame=Binding&{type:'browser.frame';payload:{sha256:string;viewportWidth:number;viewportHeight:number}};
const tuple=(b:Binding)=>[b.runId,b.testDefinitionId,b.caseResultId,b.sessionId,b.contextRef,b.pageId,b.bindingSeq];
export class SelectionProbe {
 starts:{runId:string;testKey:string}[]=[];frames:Binding[]=[];errors:unknown[]=[];tasks:Promise<void>[]=[];private browsers=new Map<string,Browser>();
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
 async report(){const response=await this.page.request.get(`/runs/${this.vars.run}/report`);this.check(response.ok()).toBe(true);return response.json();}
 async close(){await Promise.all(this.tasks);for(const browser of this.browsers.values())await browser.close();}
}
