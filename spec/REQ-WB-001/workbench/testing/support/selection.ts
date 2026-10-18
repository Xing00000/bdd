import { chromium, expect as rawExpect, type Page, type TestInfo, type Browser } from '@playwright/test';
import { FixtureDatabase, sha } from './database.ts';
import { resolveManagedPage, type BrowserBinding, type Attachment } from './managed.ts';
import {writeFile} from 'node:fs/promises';
type Binding=BrowserBinding&{runId:string;testDefinitionId:string;caseResultId:string;testKey:string};
type Frame=Binding&{type:'browser.frame';payload:{sha256:string;viewportWidth:number;viewportHeight:number}};
type Presented={dataset:Record<string,string>;pixels:number[]};
const tuple=(b:Binding)=>[b.runId,b.testDefinitionId,b.caseResultId,b.sessionId,b.contextRef,b.pageId,b.bindingSeq];
const managedPageKey=(b:Binding)=>JSON.stringify([b.runId,b.testDefinitionId,b.caseResultId,b.sessionId,b.contextRef,b.pageId].map(String));
const renderedKeys=['runId','testDefinitionId','caseResultId','sessionId','contextRef','pageId','bindingSeq'] as const;
export class SelectionProbe {
 starts:{runId:string;testKey:string}[]=[];frames:Binding[]=[];errors:unknown[]=[];tasks:Promise<void>[]=[];readonly ready:Promise<void>;private browsers=new Map<string,Promise<Browser>>();private bindings=new Map<string,Promise<void>>();
 private received=new Map<string,{header:Frame;bytes:Buffer}>();
 private presentedSequence=0;
 private processingFrames=new Set<string>();private acceptedFrames=new Set<string>();
 constructor(private page:Page,private db:FixtureDatabase,private vars:Record<string,unknown>,private info:TestInfo){
  page.on('websocket',ws=>{let header:Frame|undefined;
   ws.on('framereceived',({payload})=>{
    if(typeof payload==='string'){
     let event:any;try{event=JSON.parse(payload);}catch{return;}
     if(event.type==='run.testStarted')this.starts.push({runId:event.runId,testKey:event.testKey});
     if(event.type==='run.browserBound'){
      const binding=event as Binding,key=managedPageKey(binding);
      if(!this.bindings.has(key)){const task=this.bindManagedPage(binding).catch(error=>{this.errors.push(error);});this.bindings.set(key,task);this.tasks.push(task);}
     }
     if(event.type==='browser.frame')header=event as Frame;
    }else if(header){const current=header;header=undefined;this.received.set(JSON.stringify([...tuple(current).map(String),current.payload.sha256]),{header:current,bytes:Buffer.from(payload)});}
   });
  });
  this.ready=Promise.all([
   page.exposeBinding('workbenchProbePresented',(_source,presented:Presented)=>{this.tasks.push(this.frame(presented).catch(error=>{this.errors.push(error);}));}),
   page.addInitScript(()=>{
    // Observe the actual draw receipt. Network delivery precedes async hash,
    // binding validation and image decoding in the product viewer.
    new MutationObserver(records=>{
     for(const element of new Set(records.map(record=>record.target)))if(element instanceof HTMLCanvasElement&&element.dataset.testid==='run-browser-canvas'&&element.dataset.frameSha256){
      const sample=new OffscreenCanvas(32,24);sample.getContext('2d')!.drawImage(element,0,0,32,24);
      void (window as unknown as {workbenchProbePresented:(value:Presented)=>Promise<void>}).workbenchProbePresented({dataset:{...element.dataset} as Record<string,string>,pixels:[...sample.getContext('2d')!.getImageData(0,0,32,24).data]});
     }
    }).observe(document,{subtree:true,attributes:true,attributeFilter:['data-frame-sha256']});
   }),
  ]).then(()=>{});
 }
 private async frame(presented:Presented){
  const sequence=++this.presentedSequence;
  const received=this.received.get(JSON.stringify([...renderedKeys.map(key=>presented.dataset[key]),presented.dataset.frameSha256]));rawExpect(received,'Rendered frame must come from received websocket bytes').toBeDefined();
  const {header,bytes}=received!;
  if(header.runId!==this.vars.run)return;
  const key=managedPageKey(header);if(this.acceptedFrames.has(key)||this.processingFrames.has(key))return;this.processingFrames.add(key);
  try{
  rawExpect(header.payload.sha256).toBe(sha(bytes));rawExpect(header.payload.viewportWidth).toBeGreaterThan(0);rawExpect(header.payload.viewportHeight).toBeGreaterThan(0);
  const response=await this.page.request.get(`/runs/${header.runId}/viewer-binding`);rawExpect(response.ok()).toBe(true);const current=await response.json() as Binding;
  if(JSON.stringify(tuple(header))!==JSON.stringify(tuple(current)))return; // Late frames are allowed on wire; never accepted by current canvas.
  const bindingTask=this.bindings.get(key);rawExpect(bindingTask,'The run browser binding must be inspected while its page is live').toBeDefined();await bindingTask;
  const matches=await this.page.evaluate(async(args)=>{
   const received=await createImageBitmap(new Blob([new Uint8Array(args.bytes)],{type:'image/jpeg'}));
   const expected=new OffscreenCanvas(32,24);expected.getContext('2d')!.drawImage(received,0,0,32,24);received.close();
   return expected.getContext('2d')!.getImageData(0,0,32,24).data.every((value,i)=>Math.abs(value-args.pixels[i])<=2);
  },{bytes:[...bytes],pixels:presented.pixels});rawExpect(matches,'Rendered pixels must match the received JPEG').toBe(true);
  for(const [key,value] of Object.entries({runId:header.runId,testDefinitionId:header.testDefinitionId,caseResultId:header.caseResultId,sessionId:header.sessionId,contextRef:header.contextRef,pageId:header.pageId,bindingSeq:String(header.bindingSeq)}))rawExpect(presented.dataset[key]).toBe(String(value));
  const result=this.db.all('SELECT runtime_test_key FROM case_results WHERE id=? AND run_id=?',[header.caseResultId,header.runId]);rawExpect(result).toEqual([{runtime_test_key:header.testKey}]);
  const name=`live-frame-${sequence}`,path=this.info.outputPath(name+'.jpg');await writeFile(path,bytes);await this.info.attach(name,{path,contentType:'image/jpeg'});this.frames.push(header);this.acceptedFrames.add(key);
  }finally{this.processingFrames.delete(key);}
 }
 private async bindManagedPage(binding:Binding){
  const attach=await this.page.request.get(`/internal/browser-sessions/${binding.sessionId}/attachment`);rawExpect(attach.ok()).toBe(true);const attachment=await attach.json() as Attachment;
  rawExpect(attachment.sessionId).toBe(binding.sessionId);rawExpect(attachment.contextRef).toBe(binding.contextRef);rawExpect(attachment.pageId).toBe(binding.pageId);
  let connection=this.browsers.get(attachment.playwrightEndpoint);if(!connection){connection=chromium.connect(attachment.playwrightEndpoint,{timeout:15_000});this.browsers.set(attachment.playwrightEndpoint,connection);}const browser=await connection;
  const operatedPage=await resolveManagedPage(browser,binding);rawExpect(operatedPage.isClosed()).toBe(false);rawExpect(operatedPage.url()).not.toBe('about:blank');
 }
 async report(){const response=await this.page.request.get(`/runs/${this.vars.run}/report`);rawExpect(response.ok()).toBe(true);return response.json();}
 async close(){await this.ready;await Promise.all(this.tasks);for(const browser of this.browsers.values())await(await browser).close();}
}
