import {test,expect} from '@playwright/test';
import {designDecisionScenario} from './design-decisions-driver.mjs';
for(const real of [false,true])test(`AC-WB-045／046 系統決策與文件預覽 ${real?'真實 CLI':'PTY 契約'}`,{tag:real?[]:['@protocol']},async({page},info)=>{
 const phases=[];for await(const point of designDecisionScenario(page,info,{real}))phases.push(point.phase);expect(phases).toEqual(['opened','generated','gated','answered','modes']);
});
