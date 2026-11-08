import {test,expect} from '@playwright/test';
import {ChatCreateDriver} from './chat-create-driver.mjs';
import {openMenu} from './navigation-helpers.mjs';
import config from '../../playwright.chat.config.ts';

for(const provider of ['copilot','kiro'])test(`真實 ${provider} ACP 聊天建立 Gherkin 並自動刷新`,async({page},info)=>{
 const d=await ChatCreateDriver.open(page,provider,{expect,openMenu,timeoutMs:config.timeout});
 try{await d.request();await d.verifyCreated();await d.attach(info);await d.reload();await d.protectDraft();}
 finally{try{await d.attach(info);}finally{await d.close();}}
});
