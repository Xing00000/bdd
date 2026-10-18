import {expect,type Locator,type Page} from '@playwright/test';
type Observe=<T>(label:string,operation:()=>Promise<T>,expected?:unknown)=>Promise<T>;

/** DbGate 7.3.2 DOM contract; queries and values are obtained through its real UI. */
export class DbGatePage {
 private queryTab?:Locator;
 constructor(readonly page:Page,private readonly check:typeof expect=expect,
  private readonly observe:Observe=(_label,operation)=>operation()){}
 async open(url:string,connectionName:string){
  await this.observe('dbgate-open',()=>this.page.goto(url));
  const consent=this.page.getByTestId('UsageAnalyticsConsentModal_declineButton');
  await this.page.getByTestId('ConnectionList_container').waitFor();
  if(await consent.isVisible())await this.observe('dbgate-analytics-choice',()=>consent.click());
  await this.observe('dbgate-connect',()=>this.page.getByTestId('ConnectionList_container').getByText(connectionName).dblclick());
  await this.observe('dbgate-connected',async()=>{await this.check(this.page.getByText('Connected',{exact:true})).toBeVisible();return this.page.getByText('Connected',{exact:true}).innerText();},'Connected');
 }
 results(){
  if(!this.queryTab)throw Error('Open a DbGate query before reading its results');
  return this.queryTab.locator('table').filter({has:this.page.locator('td[data-row="header"][data-col="0"]')});
 }
 schema(){return this.page.getByTestId('SqlObjectList_container');}
 async query(sql:string){
  // DbGate retains inactive tabs in the DOM. Wait for a newly mounted active
  // TabContent, rather than an editor from the tab that is being hidden.
  const previous=await this.page.locator('[data-testid^="TabContent_"]').evaluateAll(elements=>elements.map(element=>element.getAttribute('data-testid')!));
  await this.observe('dbgate-new',()=>this.page.getByTestId('TabsPanel_buttonNewObject').click());
  await this.observe('dbgate-query-editor',()=>this.page.getByTestId('NewObjectModal_query').click());
  const tab=this.page.locator('[data-testid^="TabContent_"].tabVisible'+previous.map(id=>`:not([data-testid="${id}"])`).join(''));
  await tab.waitFor();
  this.queryTab=tab;
  const editor=tab.locator('.ace_editor:not(.ace_autocomplete)');
  await this.observe('dbgate-editor-focus',()=>editor.click());
  await this.observe('dbgate-editor-select',()=>this.page.keyboard.press('ControlOrMeta+A'));
  await this.observe('dbgate-sql',async()=>{await this.page.keyboard.insertText(sql);return {sql};});
  const started=this.page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/sessions/execute-query')&&r.request().method()==='POST');
  await this.observe('dbgate-run',()=>tab.getByTestId('QueryTab_executeButton').click());
  const response=await started;this.check(response.ok()).toBe(true);
  const messages=tab.getByTestId('MessageView_tableWrap');
  await this.observe('dbgate-execution-complete',async()=>{const completed=messages.getByText('Query execution finished',{exact:true});await this.check(completed).toHaveText('Query execution finished');return completed.textContent();},'Query execution finished');
  await this.observe('dbgate-finished',async()=>{await this.check(this.page.getByText('Finished',{exact:true})).toBeVisible();return this.page.getByText('Finished',{exact:true}).innerText();},'Finished');
  await this.observe('dbgate-query-status',async()=>{const errors=await messages.locator('tr.isError').allTextContents();if(errors.length)throw Error('DbGate SQL failed: '+errors.join('\n'));return errors;},[]);
  const tables=this.results();
  if(await messages.locator('[data-testid^="MessageViewRow-showDataButton-"]').count())await tables.first().waitFor();
  if(await tables.count()>1)throw Error('Select one result set before validating its data');
  const rows=await tables.evaluateAll(elements=>elements.flatMap(table=>{
   const headers=[...table.querySelectorAll<HTMLTableCellElement>('td[data-row="header"][data-col]')]
    .filter(cell=>/^\d+$/.test(cell.dataset.col!)).map(cell=>({column:cell.dataset.col!,name:cell.querySelector('.header > .label')!.textContent!.trim()}));
   return [...table.querySelectorAll('tbody tr')].filter(row=>[...row.querySelectorAll<HTMLElement>('td[data-row][data-col="0"]')].some(cell=>/^\d+$/.test(cell.dataset.row!)))
    .map(row=>Object.fromEntries(headers.map(header=>[header.name,row.querySelector<HTMLElement>(`td[data-col="${header.column}"]`)!.innerText])));
  }));
  return this.observe('dbgate-results',async()=>({sql,rows,messages:await messages.textContent()}));
 }
}
