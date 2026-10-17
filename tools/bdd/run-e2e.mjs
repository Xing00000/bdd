import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { hash, sourcesConfirmed } from './source.mjs';
const required=['WB_BASE_URL','WB_TARGET_BASE_URL','WB_METADATA_DB','WB_TARGET_DB','WB_TARGET_PASSWORD','WB_SOURCE_REF','WB_TARGET_REPO'];
const missing=required.filter(k=>!process.env[k]);const statusPath='test-results/bdd/e2e-status.json';
const manifestPath='test-results/bdd/manifest.json';
const source={completionManifestPath:manifestPath,completionManifestSha256:fs.existsSync(manifestPath)?hash(fs.readFileSync(manifestPath)):null};
const manifest=fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath)):null;
const checkPath='test-results/bdd/check-results.json';const checks=fs.existsSync(checkPath)?JSON.parse(fs.readFileSync(checkPath)):null;
const excludeCli=process.argv.includes('--exclude-cli');
const cliScenarioIds=['AC-WB-001','AC-WB-003','AC-WB-004','AC-WB-005','AC-WB-016','AC-WB-028'];
const cliTitlePattern='本工作台自身依Git中的確認流程開發|人類確認Gherkin後才產生SD|SD確認後將Gherkin產生成Playwright測試骨架|LLM補齊測試規格|修改上游產物必須退回對應階段並使下游結果失效|點選Gherkin案例執行並在右側觀看同次測試過程與結果';
const implementationFresh=Boolean(sourcesConfirmed()&&manifest&&checks?.implementationStatus==='CHECKED'&&checks.manifestSha256===source.completionManifestSha256&&Object.entries(manifest.implementationHashes).every(([file,sha])=>fs.existsSync(file)&&hash(fs.readFileSync(file))===sha));
const executionEnvironment={...process.env};let healthFailure;
if(!missing.length){
 try{const response=await fetch(`${executionEnvironment.WB_BASE_URL}/health`);if(!response.ok)throw Error(`Workbench health returned HTTP ${response.status}`);const health=await response.json();if(typeof health.dbgateUrl!=='string'||!/^https?:\/\//.test(health.dbgateUrl))throw Error('Workbench health does not provide a valid DbGate URL');executionEnvironment.WB_DBGATE_URL=health.dbgateUrl;}
 catch(error){healthFailure=error instanceof Error?error.message:String(error);}
}
if(missing.length||!implementationFresh||healthFailure){
 const result={...source,productE2E:'NOT_RUN',executionAttempted:false,classification:missing.length?'ENVIRONMENT_BLOCKED':healthFailure?'SERVICE_HEALTH_BLOCKED':'IMPLEMENTATION_CHECKS_STALE',reason:missing.length?'Product and dedicated fixtures are not configured; stopped before browser/test execution':healthFailure??'Test implementation receipt is absent or stale; regenerate and check before execution',healthFailure,missing,exitCode:2};
 fs.mkdirSync('test-results/bdd',{recursive:true});fs.writeFileSync(statusPath,JSON.stringify(result,null,2)+'\n');console.error(JSON.stringify(result));process.exitCode=2;
}else{
 const runId='e2e-'+randomUUID(),excluded=excludeCli?cliScenarioIds:[];const args=['node_modules/@playwright/test/cli.js','test','--config','bdd.config.ts'];if(excludeCli)args.push('--grep-invert',cliTitlePattern);
 const r=spawnSync(process.execPath,args,{stdio:'inherit',env:{...executionEnvironment,WB_HARNESS_RUN_ID:runId,WB_BDD_EXCLUDED_SCENARIOS:JSON.stringify(excluded)}});
 const chain='test-results/bdd/evidence-chain.json';const report=fs.existsSync(chain)?JSON.parse(fs.readFileSync(chain)):null;
 const expectedScope=excludeCli?'ALL_REQUIRED_EXCEPT_CLI':'ALL_REQUIRED';
 const result={...source,runId,scope:expectedScope,excludedScenarioIds:excluded,productE2E:r.status===0&&report?.runId===runId&&report?.scope===expectedScope&&report?.productE2E==='PASSED'?'PASSED':r.status!==0?'FAILED':'INCOMPLETE',executionAttempted:true,exitCode:r.status??1,report:chain};
 fs.writeFileSync(statusPath,JSON.stringify(result,null,2)+'\n');process.exitCode=result.productE2E==='PASSED'?0:r.status||1;
}
