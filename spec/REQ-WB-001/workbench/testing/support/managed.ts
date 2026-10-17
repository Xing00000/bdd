import type { Browser, Page } from '@playwright/test';
export type BrowserBinding = { sessionId:string; contextRef:string; pageId:string; bindingSeq?:number };
export type Attachment = BrowserBinding & { playwrightEndpoint:string };
// Application-managed identity, not a private Playwright object ID. Never select contexts()[0].
export async function resolveManagedPage(browser:Browser,binding:BrowserBinding):Promise<Page>{
  const found:Page[]=[];
  for(const context of browser.contexts())for(const page of context.pages()){
    if(page.isClosed())continue;
    let identity:BrowserBinding|undefined;
    try{identity=await page.evaluate(()=> (globalThis as typeof globalThis & {__workbenchManaged?:BrowserBinding}).__workbenchManaged);}catch{continue;}
    if(identity?.sessionId===binding.sessionId&&identity.contextRef===binding.contextRef&&identity.pageId===binding.pageId)found.push(page);
  }
  if(found.length!==1)throw Error(`Managed page resolution requires exactly one match for ${binding.sessionId}/${binding.contextRef}/${binding.pageId}; found ${found.length}`);
  return found[0];
}
