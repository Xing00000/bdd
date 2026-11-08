import {test,expect} from '@playwright/test';
import {WorkflowNodeDriver} from './workflow-node-driver.mjs';
import {openMenu} from './navigation-helpers.mjs';
import config from '../../playwright.chat.config.ts';
test('BDD nodes share contracts, preserve manual drafts and refresh after a failed Git export',async({page},info)=>{
 const driver=await WorkflowNodeDriver.open(page,{expect,openMenu,timeoutMs:config.timeout});
 try{await driver.contracts();await driver.editDocuments();await driver.exportConflict();}
 finally{try{await driver.attach(info);}finally{await driver.close();}}
});

test('requirement editor omits source upload and interaction history in every BDD stage',async({page},info)=>{
 const driver=await WorkflowNodeDriver.open(page,{expect,openMenu,timeoutMs:config.timeout,gitBound:false});
 try{await driver.contracts();await driver.editSimplifiedUi();await driver.verifySimplifiedUi();await driver.reloadSimplifiedUi();}
 finally{try{await driver.attach(info);}finally{await driver.close();}}
});
