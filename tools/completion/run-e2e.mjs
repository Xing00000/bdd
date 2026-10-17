import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { hash } from '../generate.mjs';
const required=['WB_BASE_URL','WB_TARGET_BASE_URL','WB_METADATA_DB','WB_TARGET_DB','WB_TARGET_PASSWORD','WB_SOURCE_REF','WB_TARGET_REPO'];
const missing=required.filter(k=>!process.env[k]);const statusPath='spec/REQ-WB-001/evidence/completion/e2e-status.json';
const manifestPath='spec/REQ-WB-001/evidence/completion/generation-manifest.json';
const source={sourceCommit:'95fb2960aa56cce22c17ad40b5cfa535da315a28',completionManifestPath:manifestPath,completionManifestSha256:fs.existsSync(manifestPath)?hash(fs.readFileSync(manifestPath)):null};
if(missing.length){
 const result={...source,productE2E:'NOT_RUN',executionAttempted:false,reason:'Product and dedicated fixtures are not configured; prerequisite check stopped before browser/test execution',missing,exitCode:2};
 fs.mkdirSync('spec/REQ-WB-001/evidence/completion',{recursive:true});fs.writeFileSync(statusPath,JSON.stringify(result,null,2)+'\n');console.error(JSON.stringify(result));process.exitCode=2;
}else{
 const runId='e2e-'+randomUUID();const r=spawnSync(process.execPath,['node_modules/@playwright/test/cli.js','test','--config','completion.config.ts'],{stdio:'inherit',env:{...process.env,WB_HARNESS_RUN_ID:runId}});
 const chain='test-results/completion/evidence-chain.json';const report=fs.existsSync(chain)?JSON.parse(fs.readFileSync(chain)):null;
 const result={...source,runId,productE2E:r.status===0&&report?.productE2E==='PASSED'?'PASSED':r.status!==0?'FAILED':'INCOMPLETE',executionAttempted:true,exitCode:r.status??1,report:chain};
 fs.writeFileSync(statusPath,JSON.stringify(result,null,2)+'\n');process.exitCode=result.productE2E==='PASSED'?0:r.status||1;
}
