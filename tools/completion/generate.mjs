import fs from 'node:fs';
import path from 'node:path';
import { spawnSync,execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sourceCases,convert,hash,approved } from '../generate.mjs';
export const base='95fb2960aa56cce22c17ad40b5cfa535da315a28';
export const manifestPath='spec/REQ-WB-001/evidence/completion/generation-manifest.json';
export function frozen(){
 const files=execFileSync('git',['ls-tree','-r','--name-only',base],{encoding:'utf8'}).trim().split('\n').filter(f=>f!=='README.md'&&f!=='spec/REQ-WB-001/review.json');
 for(const file of files){if(!fs.readFileSync(file).equals(execFileSync('git',['show',`${base}:${file}`])))throw Error('Frozen skeleton/source/tool file changed: '+file);}return files;
}
export function generate(){
 frozen();const cases=sourceCases();
 const r=spawnSync(process.execPath,['node_modules/playwright-bdd/dist/cli/index.js','test','--config','completion.config.ts'],{encoding:'utf8',env:{...process.env,WB_COMPLETION_RAW:'1'}});
 if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);if(r.status!==0)throw Error('Completion bddgen exit '+r.status);
 const rawPath='.bddgen-negative/completion-native/REQ-WB-001/workbench.feature.spec.js';
 const raw=fs.readFileSync(rawPath,'utf8'),converted=convert(raw,cases),specPath='generated/completed/REQ-WB-001/workbench.feature.spec.ts';
 fs.mkdirSync(path.dirname(specPath),{recursive:true});fs.writeFileSync(specPath,converted.output);
 const files=['completion.config.ts','completion.tsconfig.json'];
 const scan=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())scan(f);else files.push(f);}};scan('tests/completion');scan('tools/completion');
 const implementationHashes=Object.fromEntries(files.sort().map(f=>[f,hash(fs.readFileSync(f))]));
 const sourceSkeletonPath='generated/skeleton/REQ-WB-001/workbench.feature.spec.ts',sourceManifestPath='spec/REQ-WB-001/evidence/generation-manifest.json';
 const sourceSkeleton={commit:base,specPath:sourceSkeletonPath,specSha256:hash(fs.readFileSync(sourceSkeletonPath)),manifestPath:sourceManifestPath,manifestSha256:hash(fs.readFileSync(sourceManifestPath)),codegenSnapshotSha256:JSON.parse(fs.readFileSync(sourceManifestPath)).testBundleSha256};
 const m={schemaVersion:1,artifactStage:'COMPLETED',completionStatus:'COMPLETE_TEST_CODE_ONLY',productE2E:'NOT_RUN',requirementId:'REQ-WB-001',featureSha256:approved.feature,sdSha256:approved.sd,sourceSkeleton,rawPath,rawSha256:hash(raw),specPath,specSha256:hash(converted.output),generator:{name:'playwright-bdd',version:'9.2.1',command:'WB_COMPLETION_RAW=1 bddgen test --config completion.config.ts',exitCode:r.status,adapter:'tools/generate.mjs',adapterSha256:hash(fs.readFileSync('tools/generate.mjs'))},implementationHashes,scenarioCount:28,caseCount:44,pendingSlots:0,questions:[],cases:converted.cases};
 m.completionBundleSha256=hash(JSON.stringify(m));fs.writeFileSync(manifestPath,JSON.stringify(m,null,2)+'\n');console.log(JSON.stringify({scope:'COMPLETION_TOOLING_ONLY',bddgenExit:r.status,scenarios:28,cases:44,specPath,productE2E:'NOT_RUN'}));return m;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))generate();
