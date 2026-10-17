import { test as base,createBdd } from 'playwright-bdd';
import { Workbench } from './workbench.ts';
import { requireProductEnvironment } from './prerequisites.ts';
export const test=base.extend<{productEnvironment:void;sut:Workbench}>({
  // Auto fixture runs before browser/page setup; absent product prerequisites fail explicitly.
  productEnvironment:[async({},use)=>{requireProductEnvironment();await use();},{auto:true,box:true}],
  sut:async({productEnvironment,page,context},use,testInfo)=>{
    const sut=await Workbench.open(page,context,testInfo);
    try{await use(sut);}finally{await sut.close();}
  },
});
export const {Given,When,Then}=createBdd(test);
