import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {analyze} from './analyze.mjs';
import { sourceCases,convert,hash,approved,reviewPath } from './source.mjs';
export const manifestPath='test-results/bdd/manifest.json';
export function generate(){
 const cases=sourceCases();
 const r=spawnSync(process.execPath,['node_modules/playwright-bdd/dist/cli/index.js','test','--config','bdd.config.ts'],{encoding:'utf8',env:{...process.env,WB_COMPLETION_RAW:'1'}});
 if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);if(r.status!==0)throw Error('Completion bddgen exit '+r.status);
 const nativePath='spec/REQ-WB-001/workbench/workbench.feature.spec.js';
 const rawPath='test-results/bdd/workbench.feature.spec.js';
 let raw=fs.readFileSync(nativePath,'utf8');
 // playwright-bdd 9.2.1 emits path.relative() without ./ for child fixtures.
 // Preserve the resolved local file when output and feature share a directory.
 const ast=ts.createSourceFile(nativePath,raw,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 for(const statement of [...ast.statements].reverse()){
   if(!ts.isImportDeclaration(statement)||!ts.isStringLiteral(statement.moduleSpecifier))continue;
   const specifier=statement.moduleSpecifier;
   if(specifier.text.startsWith('.')||path.isAbsolute(specifier.text))continue;
   if(!fs.existsSync(path.resolve(path.dirname(nativePath),specifier.text)))continue;
   raw=raw.slice(0,specifier.getStart(ast))+JSON.stringify('./'+specifier.text)+raw.slice(specifier.getEnd());
 }
 fs.mkdirSync(path.dirname(rawPath),{recursive:true});fs.writeFileSync(rawPath,raw);
 fs.unlinkSync(nativePath);
 const converted=convert(raw,cases),specPath='spec/REQ-WB-001/workbench/workbench.feature.spec.ts';
 fs.mkdirSync(path.dirname(specPath),{recursive:true});fs.writeFileSync(specPath,converted.output);
 const files=['package.json','package-lock.json','playwright.config.ts','bdd.config.ts','tsconfig.json','playwright.negative.config.ts',reviewPath];
 const scan=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())scan(f);else files.push(f);}};files.push('spec/REQ-WB-001/workbench/workbench.steps.ts','tests/integration/bdd-tooling.test.mjs');scan('spec/REQ-WB-001/workbench/testing');scan('tools/bdd');
 const implementationHashes=Object.fromEntries(files.sort().map(f=>[f,hash(fs.readFileSync(f))]));
 const analysis=analyze();
 const m={schemaVersion:2,artifactStage:'COMPLETION_DRAFT',completionStatus:'IMPLEMENTATION_CHECKS_PENDING',productE2E:'NOT_RUN',requirementId:'REQ-WB-001',featureSha256:approved.feature,sdSha256:approved.sd,rawPath,rawSha256:hash(raw),specPath,specSha256:hash(converted.output),generator:{name:'playwright-bdd',version:'9.2.1',command:'WB_COMPLETION_RAW=1 bddgen test --config bdd.config.ts',exitCode:r.status,adapter:'tools/bdd/generate.mjs',adapterSha256:hash(fs.readFileSync('tools/bdd/generate.mjs'))},implementationHashes,scenarioCount:new Set(cases.map(c=>c.scenarioId)).size,caseCount:cases.length,pendingSlots:analysis.pendingSlots,implementationProblems:analysis.problems,questions:analysis.problems,cases:converted.cases};
 fs.mkdirSync(path.dirname(manifestPath),{recursive:true});m.completionBundleSha256=hash(JSON.stringify(m));fs.writeFileSync(manifestPath,JSON.stringify(m,null,2)+'\n');console.log(JSON.stringify({scope:'COMPLETION_TOOLING_ONLY',bddgenExit:r.status,scenarios:m.scenarioCount,cases:m.caseCount,specPath,productE2E:'NOT_RUN'}));return m;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))generate();
