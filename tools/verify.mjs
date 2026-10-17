import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { sourceCases,hash,convert } from './generate.mjs';
export function verify(){
  const expected=sourceCases(),m=JSON.parse(fs.readFileSync('spec/REQ-WB-001/evidence/generation-manifest.json','utf8'));
  assert.equal(m.artifactStage,'CODEGEN_SKELETON');assert.equal(m.completionStatus,'PENDING');
  assert.equal(m.scenarioCount,28);assert.equal(m.caseCount,44);
  assert.deepEqual(new Set(m.cases.map(c=>c.testKey)),new Set(expected.map(c=>c.testKey)));
  for(const [file,sha] of Object.entries(m.inputHashes)){assert(['package.json','package-lock.json','playwright.config.ts','tsconfig.json'].includes(file)||file.startsWith('tests/skeleton/'));assert.equal(hash(fs.readFileSync(file)),sha);}
  assert.equal(m.testBundleSha256,hash(JSON.stringify({featureSha256:m.featureSha256,sdSha256:m.sdSha256,specSha256:m.specSha256,inputHashes:m.inputHashes,generatorAdapterSha256:m.generator.adapterSha256})));
  assert.equal(hash(fs.readFileSync(m.specPath)),m.specSha256);
  const raw=fs.readFileSync(m.rawPath,'utf8');assert.equal(hash(raw),m.rawSha256);assert.equal(convert(raw,expected).output,fs.readFileSync(m.specPath,'utf8'));
  const definitions=JSON.parse(fs.readFileSync('tests/skeleton/registry.json','utf8'));
  let matches=0;for(const c of expected)for(const text of c.expandedSteps){assert.equal(definitions.filter(d=>new RegExp(d.pattern).test(text)).length,1,text);matches++;}
  assert(definitions.every(d=>!('plan' in d)));
  assert(!fs.existsSync('tests/support/world.ts')&&!fs.existsSync('tests/steps/definitions.json'));
  const spec=fs.readFileSync(m.specPath,'utf8');assert(!spec.includes('sut')&&!spec.includes('tests/support'));
  const source=ts.createSourceFile(m.specPath,spec,ts.ScriptTarget.Latest,true);let tests=0;
  const walk=n=>{if(ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&n.expression.text==='test')tests++;ts.forEachChild(n,walk);};walk(source);assert.equal(tests,44);
  const result={scope:'CODEGEN_SKELETON_ONLY',scenarios:28,sourceCases:44,generatedTests:tests,registeredPendingPatterns:definitions.length,expandedStepMatches:matches,missingSteps:0,ambiguousSteps:0,completionStatus:'PENDING',productE2E:'NOT_RUN'};
  console.log(JSON.stringify(result));return result;
}
if(process.argv[1]?.endsWith('/verify.mjs'))verify();
