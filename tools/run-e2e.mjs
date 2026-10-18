import {spawnSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fixtureEnvironment,root} from './environment.mjs';
import {llmFromEnvironment} from '../dist/src/adapters/generation/config.js';
const require=createRequire(path.join(root,'package.json'));
const {chromium}=require('@playwright/test');
const blockers=[];let env={};try{env=await fixtureEnvironment();}catch{blockers.push('FIXTURES_NOT_INITIALIZED');}
let browserProbe='NOT_RUN';try{const browser=await chromium.launch({headless:true,chromiumSandbox:true});await browser.close();browserProbe='AVAILABLE';}catch(error){browserProbe='UNAVAILABLE';blockers.push('BROWSER_UNAVAILABLE: '+String(error.message).slice(0,1200));}
try{const llm=llmFromEnvironment({...process.env,...env});{const cli=spawnSync(llm.executable,['--version'],{encoding:'utf8'});if(cli.status!==0)blockers.push('LLM_CLI_UNAVAILABLE: configured terminal CLI cannot start');}}catch{blockers.push('LLM_UNCONFIGURED: the selected provider configuration is invalid');}
if(env.WB_BASE_URL)try{const response=await fetch(env.WB_BASE_URL+'/health');if(!response.ok)blockers.push('WORKBENCH_UNAVAILABLE');else{const health=await response.json();if(!health.dbgateUrl)blockers.push('DBGATE_UNAVAILABLE');else env.WB_DBGATE_URL=health.dbgateUrl;}}catch{blockers.push('WORKBENCH_UNAVAILABLE');}
const receipt=path.join(root,'.workbench/receipts/product-e2e.json');await mkdir(path.dirname(receipt),{recursive:true});
if(blockers.length){const result={productE2E:'NOT_RUN',executionAttempted:false,browserProbe,blockers,at:new Date().toISOString(),exitCode:2};await writeFile(receipt,JSON.stringify(result,null,2)+'\n');console.error(JSON.stringify(result,null,2));process.exitCode=2;}else{const result=spawnSync(process.execPath,['tools/bdd/run-e2e.mjs'],{cwd:root,env:{...process.env,...env},stdio:'inherit'});process.exitCode=result.status??1;}
