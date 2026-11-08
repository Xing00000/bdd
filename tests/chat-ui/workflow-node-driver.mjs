import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {ChatCreateDriver} from './chat-create-driver.mjs';
import {exists} from '../../packages/contracts/index.mjs';

const gherkin='Feature: Account name\n  @case:ACCOUNT-001\n  Scenario: Show own account name\n    Given Ada has an account\n    When Ada signs in\n    Then Ada sees her account name\n';
export class WorkflowNodeDriver {
 static async open(page,options){const driver=new WorkflowNodeDriver();driver.chat=await ChatCreateDriver.open(page,'copilot',{...options,gitBound:options.gitBound??true});Object.assign(driver,{page,expect:options.expect,evidence:[]});return driver;}
 async read(nodeId){const response=await this.page.request.get(`${this.chat.origin}/repository-api/v1/nodes/${nodeId}`);this.expect(response.ok(),await response.text()).toBe(true);return response.json();}
 async submit(key,response){return this.page.request.post(`${this.chat.origin}/repository-api/v1/node-responses`,{headers:{'x-workbench-request':'1'},data:{key,response}});}
 async contracts(){
  const {expect}=this,service=this.chat.app.service,repositoryId=this.chat.repository.id;
  const before=await service.detail(repositoryId),ticket=await this.read(before.creationNodeId),stale=await this.read(before.creationNodeId);
  for(const response of [{description:'Missing Gherkin'},{description:'Invalid',gherkin:'Feature: Empty'},{description:'Wrong language',gherkin:'# language: zh-TW\n'+gherkin},{description:'Cannot approve',gherkin,approve:true}]){
   const result=await this.submit(ticket.key,response);expect(result.ok()).toBe(false);
   this.evidence.push({kind:'invalid-response',status:result.status(),body:await result.json()});
  }
  const response={description:'Original heading\nEvery original line',gherkin};
  const saved=await this.submit(ticket.key,response);expect(saved.ok(),await saved.text()).toBe(true);this.receipt=await saved.json();
  const replay=await this.submit(ticket.key,response);expect(await replay.json()).toEqual(this.receipt);
  const conflict=await this.submit(stale.key,response);expect(conflict.status()).toBe(409);
  this.evidence.push({kind:'stale-key',status:conflict.status(),body:await conflict.json()});
  this.feature=(await service.detail(repositoryId)).spec.features[0];
  expect(this.feature.nodes.map(node=>node.key)).toEqual(service.nodeDefinitions.map(node=>node.key));
  expect(this.feature.nodes.some(node=>node.key==='VERIFIED')).toBe(false);
  for(const node of this.feature.nodes){const contract=await this.read(node.nodeId);expect(contract.responseSchema).toBeTruthy();this.evidence.push({kind:'node-contract',...contract});}
  expect(this.feature.review.confirmed).toEqual({gherkin:false,sd:false,tests:false});
  await expect(this.page.locator('#feature-select')).toHaveValue(this.feature.key);
  await expect(this.page.locator('#requirement-gherkin')).toHaveValue(gherkin);
 }
 async editDocuments(){
  const {expect}=this,repositoryId=this.chat.repository.id;
  await expect(this.page.locator('#content')).toHaveAttribute('aria-busy','false');
  const draft='Feature: Unfinished manual draft';
  await this.page.locator('#requirement-gherkin').fill(draft);
  const submitted=this.page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/node-responses'));
  await this.page.locator('#save-requirement').click();
  const result=await submitted;expect(result.ok(),await result.text()).toBe(true);
  expect(result.request().postDataJSON().response.draft).toBe(true);
  await expect(this.page.locator('#requirement-gherkin')).toHaveValue(draft);
  await expect(this.page.locator('#content')).toHaveAttribute('aria-busy','false');
  await this.page.getByRole('button',{name:'2 系統設計',exact:true}).click();
  await this.page.locator('#design-edit-button').click();
  await expect(this.page.locator('#source-editor')).toBeVisible();
  const design='# Node driven design\n\nThe account name comes from the signed-in account.\n';
  await this.page.locator('#source-editor').fill(design);
  const designSaved=this.page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/node-responses'));
  await this.page.locator('#save-source').click();const designResult=await designSaved;expect(designResult.ok(),await designResult.text()).toBe(true);
  await expect(this.page.locator('#content')).toHaveAttribute('aria-busy','false');
  const detail=await this.chat.app.service.detail(repositoryId);
  expect(detail.spec.features[0].review.confirmed).toEqual({gherkin:false,sd:false,tests:false});
  this.evidence.push({kind:'manual-draft',receipt:await result.json(),design:await designResult.json(),review:detail.spec.features[0].review});
  await this.page.reload();await expect(this.page.locator('#content')).toHaveAttribute('aria-busy','false');
  await this.page.locator('#design-edit-button').click();await expect(this.page.locator('#source-editor')).toHaveValue(design);
 }
 async prepareConflict(){
  for(const operation of ['repository.acquire','repository.prepare']){
   const request={schemaVersion:1,operationId:'OP-'+crypto.randomUUID(),repositoryId:this.chat.repository.id,operation,input:{}};
   this.chat.app.service.enqueue(request);const result=await this.chat.app.service.wait(request.operationId);this.expect(result.status,JSON.stringify(result.error)).toBe('SUCCEEDED');
  }
  const detail=await this.chat.app.service.detail(this.chat.repository.id);
  await writeFile(path.join(detail.localPath,'README.md'),'External README modification must survive\n');
 }
 async submitConflict(){
  const {expect}=this,service=this.chat.app.service,repositoryId=this.chat.repository.id;
  const detail=await service.detail(repositoryId);
  const ticket=await this.read(detail.creationNodeId);
  const documentId=await this.page.evaluate(()=>window.liveChatDocumentId);
  const response={description:'Second requirement\nNotifications display unread count.',gherkin:gherkin.replace('Account name','Notification count')};
  const result=await this.submit(ticket.key,response);expect(result.ok(),await result.text()).toBe(true);
  const receipt=await result.json();expect(receipt.saved).toBe(true);expect(receipt.status).toBe('SUCCEEDED');expect(receipt.error).toBe(null);
  this.conflict={receipt,response,documentId};
 }
 async explicitExport(){
  const {expect}=this,{receipt,response,documentId}=this.conflict;
  await expect(this.page.locator('#feature-select')).toHaveValue(receipt.key);
  await expect(this.page.locator('#requirement-gherkin')).toHaveValue(response.gherkin);
  await expect(this.page.locator('#content')).toHaveAttribute('aria-busy','false');
  const exported=this.page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/operations'));
  await this.page.getByRole('button',{name:'匯出資料庫文件',exact:true}).click();
  await exported;
  await expect(this.page.locator('#notice')).toContainText('另有修改');
 }
 async verifyConflict(){
  const {expect}=this,{receipt,response,documentId}=this.conflict;
  await expect(this.page.locator('#feature-select')).toHaveValue(receipt.key);
  await expect(this.page.locator('#notice')).toContainText('另有修改');
  await expect(this.page.locator('#requirement-gherkin')).toHaveValue(response.gherkin);
  expect(await this.page.evaluate(()=>window.liveChatDocumentId)).toBe(documentId);
  this.evidence.push({kind:'export-conflict',receipt,response,documentId});
 }
 async reloadConflict(){
  const {expect}=this;
  await this.page.reload();await expect(this.page.locator('#requirement-gherkin')).toHaveValue(this.conflict.response.gherkin);
  expect((await this.chat.app.service.detail(this.chat.repository.id)).spec.features).toHaveLength(2);
 }
 async verifyDatabaseOnly(){
  const detail=await this.chat.app.service.detail(this.chat.repository.id);
  this.expect(detail.remoteUrl).toBe(null);this.expect(await exists(detail.localPath)).toBe(false);
  this.expect(detail.spec.features).toHaveLength(1);
  const changes=this.chat.app.service.nodeChanges();this.expect(changes.some(change=>change.repositoryId===this.chat.repository.id&&change.saved)).toBe(true);
  this.evidence.push({kind:'database-only',authoring:detail.authoring,remoteUrl:detail.remoteUrl,localPathExists:false,changes});
 }
 async restartDatabaseOnly(){
  await this.chat.restartService();await this.verifyDatabaseOnly();
  await this.page.locator('#design-edit-button').click();
  await this.expect(this.page.locator('#source-editor')).toHaveValue('# Node driven design\n\nThe account name comes from the signed-in account.\n');
 }
 async exportConflict(){await this.prepareConflict();await this.submitConflict();await this.explicitExport();await this.verifyConflict();await this.reloadConflict();}
 async attach(info){await info.attach('Node 契約、保存與同步衝突證據',{body:JSON.stringify(this.evidence,null,2),contentType:'application/json'});await info.attach('Node 工作台畫面',{body:await this.page.screenshot({fullPage:true}),contentType:'image/png'});}
 close(){return this.chat.close();}
}
