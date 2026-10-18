import fs from 'node:fs';import assert from 'node:assert/strict';
import {sourceCases,hash,convert} from './source.mjs';
import {manifestPath} from './generate.mjs';
import {analyze} from './analyze.mjs';import {scenarioReviews} from './reviews.mjs';
export function verify(){
 const cases=sourceCases(),m=JSON.parse(fs.readFileSync(manifestPath)),analysis=analyze();assert.deepEqual(analysis.problems,[]);assert.equal(analysis.pendingSlots,0);
 assert.equal(m.artifactStage,'COMPLETION_DRAFT');const {completionBundleSha256,...payload}=m;assert.equal(hash(JSON.stringify(payload)),completionBundleSha256);
 for(const [file,sha] of Object.entries(m.implementationHashes))assert.equal(hash(fs.readFileSync(file)),sha,file);
 const raw=fs.readFileSync(m.rawPath,'utf8'),spec=fs.readFileSync(m.specPath,'utf8');assert.equal(hash(raw),m.rawSha256);assert.equal(hash(spec),m.specSha256);assert.equal(convert(raw,cases).output,spec);assert.deepEqual(new Set(m.cases.map(c=>c.testKey)),new Set(cases.map(c=>c.testKey)));assert.equal(m.cases.length,cases.length);
 assert(!fs.existsSync('spec/REQ-WB-001/workbench/definitions.json'));assert(!fs.existsSync('spec/REQ-WB-001/workbench/testing/support/world.ts'));
 const perCase=cases.map(c=>{const review=scenarioReviews[c.scenarioId.slice(-3)];assert(review?.length===2);const source=m.cases.find(row=>row.testKey===c.testKey);const steps=source.steps.map(s=>{const e=analysis.entries.find(e=>e.sourceLine===s.sourceLine);assert(e);return {...e,sourceText:s.expandedText};});assert(steps.filter(s=>s.keyword==='Then').every(s=>s.assertions.length>0));return {testKey:c.testKey,scenarioId:c.scenarioId,caseId:c.caseId,reviewStatus:'CODE_REVIEWED_RUNTIME_NOT_RUN',reviewFocus:review[0],expectedOracles:review[1],expandedSource:c.expandedSteps,steps};});
 const receipt={scope:'STATIC_IMPLEMENTATION_REVIEW_NOT_PRODUCT_E2E',manifestPath,manifestSha256:hash(fs.readFileSync(manifestPath)),sourceSha256:analysis.sourceSha256,helperSha256:analysis.helperSha256,scenarios:new Set(cases.map(c=>c.scenarioId)).size,cases:cases.length,registeredDirectSteps:analysis.entries.length,pendingSlots:analysis.pendingSlots,problems:analysis.problems,perCase};
 fs.mkdirSync('test-results/bdd',{recursive:true});fs.writeFileSync('test-results/bdd/case-review.json',JSON.stringify(receipt,null,2)+'\n');
 const result={scope:'TEST_IMPLEMENTATION_CHECKS',scenarios:new Set(cases.map(c=>c.scenarioId)).size,cases:cases.length,directSteps:analysis.entries.length,expandedSteps:cases.reduce((sum,c)=>sum+c.expandedSteps.length,0),pendingSlots:analysis.pendingSlots,reviewedCases:perCase.length,productE2E:'NOT_RUN'};console.log(JSON.stringify(result));return result;
}
if(process.argv[1]?.endsWith('/verify.mjs'))verify();
