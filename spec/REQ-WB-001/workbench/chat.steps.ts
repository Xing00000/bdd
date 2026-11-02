import {BeforeScenario,AfterScenario,AfterStep,test} from './testing/support/fixtures.ts';
import {expect,type Page} from '@playwright/test';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createServer} from '../../../src/http/server.ts';

const tags='@AC-WB-036 or @AC-WB-037 or @AC-WB-038';
type World={server:Awaited<ReturnType<typeof createServer>>;options:Parameters<typeof createServer>[0];url:string;title:string;roomId:string;marker:string;thread?:string;codexExecutable?:string;initialCount?:number;errors:string[]};
const worlds=new WeakMap<Page,World>();
export const world=(page:Page)=>{const value=worlds.get(page);if(!value)throw Error('Chat fixture is not initialized');return value;};
export async function detail(page:Page){const w=world(page),response=await page.request.get(w.url+'/chat-rooms/'+w.roomId);expect(response.ok()).toBe(true);return response.json();}
export async function createRoom(page:Page){const w=world(page);await page.getByTestId('new-chat').click();await expect(page.getByRole('textbox',{name:'對話訊息輸入',exact:true})).toBeVisible();w.roomId=new URL(page.url()).pathname.split('/').at(-1)!;w.title='新對話';await expect(page.getByRole('textbox',{name:'聊天室名稱',exact:true})).toHaveCount(0);}
export async function send(page:Page,content:string){await page.getByRole('textbox',{name:'對話訊息輸入'}).fill(content);await page.getByRole('button',{name:'送出',exact:true}).click();}
BeforeScenario(tags,async({page})=>{
 const directory=await mkdtemp(path.join(tmpdir(),'bdd-chat-ui-'));
 if(!process.env.WB_METADATA_DB||!process.env.WB_BASE_URL)throw Error('Dedicated product fixture DB and URL are required');
 const options={root:process.cwd(),metadataFile:process.env.WB_METADATA_DB,dataRoot:path.join(directory,'data'),baseUrl:process.env.WB_BASE_URL};
 const server=await createServer(options);const url=await server.app.listen({host:'127.0.0.1',port:Number(new URL(options.baseUrl).port)});
 const w:World={server,options,url,title:'對話驗證 '+randomUUID().slice(0,8),roomId:'',marker:randomUUID(),errors:[]};worlds.set(page,w);
 page.on('pageerror',error=>w.errors.push(error.message));
 await page.goto(url+'/requirements');await expect(page.getByTestId('new-chat')).toBeVisible();
});
AfterStep(tags,async({page})=>{if(worlds.has(page)&&!page.isClosed())await test.info().attach('操作後畫面',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});});
AfterScenario(tags,async({page})=>{
 const w=worlds.get(page);if(!w)return;
 try{
  const feature=await readFile('spec/REQ-WB-001/workbench/workbench.feature','utf8');
  const design=await readFile('spec/REQ-WB-001/workbench/workbench.sd.md','utf8');
  await test.info().attach('當次規格與設計',{body:feature+'\n\n'+design,contentType:'text/plain'});
  await test.info().attach('實際測試程式碼',{body:await readFile('spec/REQ-WB-001/workbench/chat.steps.ts'),contentType:'text/plain'});
  const actual={scope:'AC-WB-036–038 / UIUX / Chromium / e2e',room:w.roomId?await detail(page):null,consoleErrors:w.errors,featureSha256:createHash('sha256').update(feature).digest('hex'),visualReview:'pending; no approved screenshot baseline',runtime:'real Codex app-server and Copilot CLI; no mocked inference'};
  await test.info().attach('預期與實際紀錄',{body:JSON.stringify(actual,null,2),contentType:'application/json'});
  expect(w.errors).toEqual([]);
 }finally{await w.server.app.close();worlds.delete(page);}
});
