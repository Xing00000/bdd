import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { hash } from '../generate.mjs';
const required=['WB_BASE_URL','WB_TARGET_BASE_URL','WB_METADATA_DB','WB_TARGET_DB','WB_TARGET_PASSWORD','WB_SOURCE_REF','WB_TARGET_REPO'];
const missing=required.filter(k=>!process.env[k]);const statusPath='spec/REQ-WB-001/evidence/repair/e2e-status.json';
const manifestPath='spec/REQ-WB-001/evidence/repair/generation-manifest.json';
const source={sourceSkeletonCommit:'95fb2960aa56cce22c17ad40b5cfa535da315a28',repairBaseCommit:'f8678bdc59dbcd582bb9cdb3cc8be4060a9e6efe',completionManifestPath:manifestPath,completionManifestSha256:fs.existsSync(manifestPath)?hash(fs.readFileSync(manifestPath)):null};
const manifest=fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath)):null;
const checkPath='spec/REQ-WB-001/evidence/repair/check-results.json';const checks=fs.existsSync(checkPath)?JSON.parse(fs.readFileSync(checkPath)):null;
const implementationFresh=Boolean(manifest&&checks?.implementationStatus==='CHECKED'&&checks.manifestSha256===source.completionManifestSha256&&Object.entries(manifest.implementationHashes).every(([file,sha])=>fs.existsSync(file)&&hash(fs.readFileSync(file))===sha));
if(missing.length||!implementationFresh){
 const result={...source,productE2E:'NOT_RUN',executionAttempted:false,classification:missing.length?'ENVIRONMENT_BLOCKED':'IMPLEMENTATION_CHECKS_STALE',reason:missing.length?'Product and dedicated fixtures are not configured; stopped before browser/test execution':'Test implementation receipt is absent or stale; regenerate and check before execution',missing,exitCode:2};
 fs.mkdirSync('spec/REQ-WB-001/evidence/repair',{recursive:true});fs.writeFileSync(statusPath,JSON.stringify(result,null,2)+'\n');console.error(JSON.stringify(result));process.exitCode=2;
}else{
 const runId='e2e-'+randomUUID();const r=spawnSync(process.execPath,['node_modules/@playwright/test/cli.js','test','--config','completion.config.ts'],{stdio:'inherit',env:{...process.env,WB_HARNESS_RUN_ID:runId}});
 const chain='test-results/completion/evidence-chain.json';const report=fs.existsSync(chain)?JSON.parse(fs.readFileSync(chain)):null;
 const result={...source,runId,productE2E:r.status===0&&report?.runId===runId&&report?.productE2E==='PASSED'?'PASSED':r.status!==0?'FAILED':'INCOMPLETE',executionAttempted:true,exitCode:r.status??1,report:chain};
 fs.writeFileSync(statusPath,JSON.stringify(result,null,2)+'\n');process.exitCode=result.productE2E==='PASSED'?0:r.status||1;
}
