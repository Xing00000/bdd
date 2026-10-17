import { test as base,createBdd } from 'playwright-bdd';
import { Workbench } from './workbench.ts';
import { requireProductEnvironment } from './prerequisites.ts';
import {execFileSync} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
const fixtureRepository=process.env.WB_TARGET_REPO;
export const test=base.extend<{productEnvironment:void;sut:Workbench}>({
  // Auto fixture runs before browser/page setup; absent product prerequisites fail explicitly.
  productEnvironment:[async({},use)=>{
    requireProductEnvironment();
    if(!fixtureRepository)throw Error('WB_TARGET_REPO is required for an isolated source fixture');
    const repository=resolve(fixtureRepository),sourceRef=process.env.WB_SOURCE_REF;
    if(!sourceRef)throw Error('WB_SOURCE_REF must identify the fixture baseline commit');
    const directory=resolve('.test-fixtures/bdd-worktrees');await mkdir(directory,{recursive:true});
    const worktree=join(directory,randomUUID());
    execFileSync('git',['-C',repository,'worktree','add','--detach','--quiet',worktree,sourceRef],{stdio:'pipe'});
    process.env.WB_TARGET_REPO=worktree;
    try{await use();}
    finally{
      process.env.WB_TARGET_REPO=repository;
      const status=execFileSync('git',['-C',worktree,'status','--porcelain','--untracked-files=all'],{encoding:'utf8'});
      if(!status.split('\n').some(line=>line.startsWith('?? ')))execFileSync('git',['-C',repository,'worktree','remove','--force',worktree],{stdio:'pipe'});
    }
  },{auto:true,box:true}],
  sut:async({productEnvironment,page,context},use,testInfo)=>{
    const sut=await Workbench.open(page,context,testInfo);
    try{await use(sut);}finally{await sut.close();}
  },
});
export const {Given,When,Then}=createBdd(test);
