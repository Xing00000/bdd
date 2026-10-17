import type { Page, Locator, TestInfo, Expect, BrowserContext } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import type { BrowserBinding } from './managed.ts';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const pageActions=new Set(['goto','reload','goBack','goForward','waitForURL']);
const locatorActions=new Set(['click','dblclick','fill','press','check','uncheck','selectOption','setInputFiles','hover','focus','inputValue','innerText','textContent','getAttribute','isVisible','isEditable','isEnabled','isDisabled','isChecked','boundingBox']);
const selectors=new Set(['locator','getByTestId','getByRole','getByText','getByLabel','getByPlaceholder','getByTitle','getByAltText','filter','first','last','nth']);
export class StepEvidence {
 readonly actions:Record<string,unknown>[]=[];
 readonly runId=process.env.WB_HARNESS_RUN_ID??'harness-'+randomUUID();
 private active:Page; private pending:Promise<unknown>=Promise.resolve(); private line=0; private index=0; private keyword='Given';
 private pages=new WeakMap<Page,BrowserBinding>();private contexts=new WeakMap<BrowserContext,string>();private locators=new WeakMap<object,{locator:Locator;page:Page}>();
 constructor(page:Page,private info:TestInfo){this.active=page;}
 setStep(line:number,keyword='Given'){this.line=line;this.keyword=keyword;}
 async flush(){await this.pending;}
 private identity(page:Page){
  let identity=this.pages.get(page);if(!identity){let contextRef=this.contexts.get(page.context());if(!contextRef){contextRef='harness-context-'+randomUUID();this.contexts.set(page.context(),contextRef);}identity={sessionId:'harness-session-'+this.runId,contextRef,pageId:'harness-page-'+randomUUID(),bindingSeq:1};this.pages.set(page,identity);}return identity;
 }
 private json(value:unknown):unknown{if(value===undefined)return null;try{return JSON.parse(JSON.stringify(value));}catch{return String(value);}}
 capture(label:string,error?:unknown,expected?:unknown,actual?:unknown,page=this.active,assertion=false){
  const sourceStepLine=this.line,index=++this.index,keyword=this.keyword,identity=this.identity(page);
  const testKey=this.info.annotations.find(a=>a.type==='workbenchTestId')?.description;
  const task=this.pending.catch(()=>{}).then(async()=>{
   let image:Buffer|undefined,screenshotError:unknown;
   try{image=await page.screenshot({fullPage:false});await this.info.attach(`action-${index}-L${sourceStepLine}-${error?'failure':'after'}`,{body:image,contentType:'image/png'});}catch(e){screenshotError=e;}
   const row={runId:this.runId,testDefinitionId:testKey,sourceCaseId:testKey,scenarioId:testKey?.split('/')[1],sourceStepId:`${testKey}:L${sourceStepLine}`,sourceStepLine,actionIndex:index,...identity,label,assertion,moment:error?'failure':keyword==='Given'?'precondition':assertion?'after_assertion':'after_action',status:error?'FAILED':screenshotError?'INCOMPLETE':'COMPLETED',expected:this.json(expected),actual:this.json(actual),error:error?String(error):undefined,screenshotSha256:image?hash(image):null,screenshotError:screenshotError?String(screenshotError):undefined};
   this.actions.push(row);
   if(screenshotError&&!error)throw Error('Required per-action screenshot failed: '+String(screenshotError));
   return row;
  });this.pending=task;return task;
 }
 async operation(label:string,error?:unknown,expected?:unknown,actual?:unknown,assertion=false){return this.capture(label,error,expected,actual,this.active,assertion);}
 wrapPage(page:Page,binding?:BrowserBinding):Page{
  if(binding)this.pages.set(page,binding);
  const self=this;
  return new Proxy(page,{get(target,key){const item=Reflect.get(target,key,target);
   if(['keyboard','mouse','touchscreen'].includes(String(key)))return self.wrapInput(item,page,String(key));
   if(typeof item!=='function')return item;
   if(selectors.has(String(key)))return (...args:unknown[])=>self.wrapLocator(item.apply(target,args),page);
   if(pageActions.has(String(key)))return async(...args:unknown[])=>{await self.flush();self.active=page;let error:unknown,actual:unknown;try{const result=await item.apply(target,args);actual=page.url();return result;}catch(e){error=e;throw e;}finally{await self.capture('page.'+String(key),error,args,actual,page);}};
   return item.bind(target);
  }});
 }
 private wrapInput(input:any,page:Page,label:string):any{return new Proxy(input,{get:(target,key)=>{const method=Reflect.get(target,key,target);if(typeof method!=='function')return method;return async(...args:unknown[])=>{await this.flush();this.active=page;let error:unknown;try{return await method.apply(target,args);}catch(e){error=e;throw e;}finally{await this.capture(label+'.'+String(key),error,undefined,undefined,page);}};}});}
 private wrapLocator(locator:Locator,page:Page):Locator{
  const self=this;const proxy=new Proxy(locator,{get(target,key){const item=Reflect.get(target,key,target);if(typeof item!=='function')return item;
   if(selectors.has(String(key)))return (...args:unknown[])=>self.wrapLocator(item.apply(target,args),page);
   if(locatorActions.has(String(key)))return async(...args:unknown[])=>{await self.flush();self.active=page;let error:unknown,actual:unknown;try{actual=await item.apply(target,args);return actual;}catch(e){error=e;throw e;}finally{await self.capture('locator.'+String(key),error,undefined,actual,page);}};
   return item.bind(target);
  }});this.locators.set(proxy,{locator,page});return proxy;
 }
 private async observed(actual:unknown,matcher:string,args:unknown[]){
  const meta=actual&&typeof actual==='object'?this.locators.get(actual):undefined;if(!meta)return actual;
  this.active=meta.page;const l=meta.locator;
  switch(matcher){
   case 'toHaveText':case 'toContainText':return l.innerText({timeout:1000});
   case 'toHaveValue':return l.inputValue({timeout:1000});
   case 'toBeVisible':case 'toBeHidden':return l.isVisible();
   case 'toBeEditable':return l.isEditable({timeout:1000});
   case 'toBeEnabled':return l.isEnabled({timeout:1000});
   case 'toBeDisabled':return l.isDisabled({timeout:1000});
   case 'toHaveAttribute':return l.getAttribute(String(args[0]),{timeout:1000});
   case 'toHaveCount':return l.count();
   default:return l.textContent({timeout:1000});
  }
 }
 wrapExpect(base:Expect):Expect{
  const wrap=(matcher:any,actual:unknown,negated=false,poll?:{actual:unknown}):any=>new Proxy(matcher,{get:(target,key)=>{
   const value=Reflect.get(target,key,target);if(['not','resolves','rejects'].includes(String(key)))return wrap(value,actual,String(key)==='not'?!negated:negated,poll);
   if(typeof value!=='function')return value;
   return (...args:unknown[])=>{
    const record=async(error?:unknown)=>{let observed:unknown;try{observed=poll?poll.actual:await this.observed(actual,String(key),args);}catch(e){observed={observationError:String(e)};}
     await this.capture('expect.'+String(key),error,{matcher:String(key),negated,arguments:args},observed,this.active,true);
    };
    let result:any;try{result=value.apply(target,args);}catch(error){void record(error).catch(()=>{});throw error;}
    if(result&&typeof result.then==='function')return result.then(async(v:unknown)=>{await record();return v;},async(error:unknown)=>{try{await record(error);}finally{throw error;}});
    void record().catch(()=>{});return result;
   };
  }});
  return new Proxy(base,{apply:(target,thisArg,args)=>wrap(Reflect.apply(target,thisArg,args),args[0]),get:(target,key)=>{
   const value=Reflect.get(target,key,target);if(String(key)==='poll')return (callback:()=>unknown,...args:unknown[])=>{const state={actual:undefined as unknown};return wrap(value(async()=>{state.actual=await callback();return state.actual;},...args),undefined,false,state);};
   return typeof value==='function'?value.bind(target):value;
  }});
 }
}
