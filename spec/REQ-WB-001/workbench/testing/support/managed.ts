import type { Browser, Page } from '@playwright/test';
export type BrowserBinding = { sessionId:string; contextRef:string; pageId:string; bindingSeq?:number };
export type Attachment = BrowserBinding & { playwrightEndpoint:string };
// Application-managed identity, not a private Playwright object ID. Never select contexts()[0].
export async function resolveManagedPage(browser:Browser,binding:BrowserBinding):Promise<Page>{
  const found:Page[]=[],observed:{url:string;identity:BrowserBinding|null;error?:string}[]=[];
  for(const context of browser.contexts())for(const page of context.pages()){
    if(page.isClosed())continue;
    let identity:BrowserBinding|undefined;
    try{identity=await page.evaluate(()=> (globalThis as typeof globalThis & {__workbenchManaged?:BrowserBinding}).__workbenchManaged);}
    catch(firstError){
      try{await page.waitForLoadState('domcontentloaded');identity=await page.evaluate(()=> (globalThis as typeof globalThis & {__workbenchManaged?:BrowserBinding}).__workbenchManaged);}
      catch(retryError){observed.push({url:page.url(),identity:null,error:`${String(firstError)}; after document load: ${String(retryError)}`});continue;}
    }
    observed.push({url:page.url(),identity:identity??null});
    if(identity?.sessionId===binding.sessionId&&identity.contextRef===binding.contextRef&&identity.pageId===binding.pageId)found.push(page);
  }
  if(found.length!==1)throw Error(`Managed page resolution requires exactly one match for ${binding.sessionId}/${binding.contextRef}/${binding.pageId}; found ${found.length}; browserContexts=${browser.contexts().length}; observed=${JSON.stringify(observed)}`);
  return found[0];
}
