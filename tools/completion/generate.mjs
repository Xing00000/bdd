import fs from 'node:fs';
import path from 'node:path';
import { spawnSync,execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {analyze} from './analyze.mjs';
import { sourceCases,convert,hash,approved } from '../generate.mjs';
export const base='95fb2960aa56cce22c17ad40b5cfa535da315a28';
export const manifestPath='spec/REQ-WB-001/evidence/repair/generation-manifest.json';
export function frozen(){
 const files=execFileSync('git',['ls-tree','-r','--name-only',base],{encoding:'utf8'}).trim().split('\n').filter(f=>f==='spec/REQ-WB-001/workbench.feature'||f==='spec/REQ-WB-001/SD.md'||f.startsWith('generated/skeleton/')||f.startsWith('tests/skeleton/')||f.startsWith('spec/REQ-WB-001/evidence/'));
 for(const file of files){if(!fs.readFileSync(file).equals(execFileSync('git',['show',`${base}:${file}`])))throw Error('Frozen skeleton/source evidence changed: '+file);}
 const previous='f8678bdc59dbcd582bb9cdb3cc8be4060a9e6efe',older=execFileSync('git',['ls-tree','-r','--name-only',previous],{encoding:'utf8'}).trim().split('\n').filter(f=>f.startsWith('spec/REQ-WB-001/evidence/completion/'));
 for(const file of older)if(!fs.readFileSync(file).equals(execFileSync('git',['show',`${previous}:${file}`])))throw Error('Prior completion evidence changed: '+file);return [...files,...older];
}
export function generate(){
 frozen();const cases=sourceCases();
 const r=spawnSync(process.execPath,['node_modules/playwright-bdd/dist/cli/index.js','test','--config','completion.config.ts'],{encoding:'utf8',env:{...process.env,WB_COMPLETION_RAW:'1'}});
 if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);if(r.status!==0)throw Error('Completion bddgen exit '+r.status);
 const rawPath='.bddgen-negative/completion-native/REQ-WB-001/workbench.feature.spec.js';
 const raw=fs.readFileSync(rawPath,'utf8'),converted=convert(raw,cases),specPath='generated/completed/REQ-WB-001/workbench.feature.spec.ts';
 fs.mkdirSync(path.dirname(specPath),{recursive:true});fs.writeFileSync(specPath,converted.output);
 const files=['package.json','package-lock.json','playwright.config.ts','skeleton.config.ts','completion.config.ts','completion.tsconfig.json'];
 const scan=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())scan(f);else files.push(f);}};scan('tests/completion');scan('tools/completion');
 const implementationHashes=Object.fromEntries(files.sort().map(f=>[f,hash(fs.readFileSync(f))]));
 const sourceSkeletonPath='generated/skeleton/REQ-WB-001/workbench.feature.spec.ts',sourceManifestPath='spec/REQ-WB-001/evidence/generation-manifest.json';
 const sourceSkeleton={commit:base,specPath:sourceSkeletonPath,specSha256:hash(fs.readFileSync(sourceSkeletonPath)),manifestPath:sourceManifestPath,manifestSha256:hash(fs.readFileSync(sourceManifestPath)),codegenSnapshotSha256:JSON.parse(fs.readFileSync(sourceManifestPath)).testBundleSha256};
 const analysis=analyze();
 const m={schemaVersion:2,artifactStage:'COMPLETION_DRAFT',completionStatus:'IMPLEMENTATION_CHECKS_PENDING',productE2E:'NOT_RUN',requirementId:'REQ-WB-001',featureSha256:approved.feature,sdSha256:approved.sd,sourceSkeleton,previousCompletion:{commit:'f8678bdc59dbcd582bb9cdb3cc8be4060a9e6efe',manifestPath:'spec/REQ-WB-001/evidence/completion/generation-manifest.json',manifestSha256:hash(fs.readFileSync('spec/REQ-WB-001/evidence/completion/generation-manifest.json'))},rawPath,rawSha256:hash(raw),specPath,specSha256:hash(converted.output),generator:{name:'playwright-bdd',version:'9.2.1',command:'WB_COMPLETION_RAW=1 bddgen test --config completion.config.ts',exitCode:r.status,adapter:'tools/generate.mjs',adapterSha256:hash(fs.readFileSync('tools/generate.mjs'))},implementationHashes,scenarioCount:28,caseCount:44,pendingSlots:analysis.pendingSlots,implementationProblems:analysis.problems,questions:analysis.problems,cases:converted.cases};
 fs.mkdirSync(path.dirname(manifestPath),{recursive:true});m.completionBundleSha256=hash(JSON.stringify(m));fs.writeFileSync(manifestPath,JSON.stringify(m,null,2)+'\n');console.log(JSON.stringify({scope:'COMPLETION_TOOLING_ONLY',bddgenExit:r.status,scenarios:28,cases:44,specPath,productE2E:'NOT_RUN'}));return m;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))generate();
