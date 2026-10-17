import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { sourceCases,convert,generate,hash } from './generate.mjs';
import { pendingStep } from '../tests/skeleton/pending.ts';
function negative(kind,text){
 fs.mkdirSync('.bddgen-negative',{recursive:true});const feature=`.bddgen-negative/${kind}.feature`;
 fs.writeFileSync(feature,`Feature: negative\n  Scenario: reject\n    Given ${text}\n`);
 const r=spawnSync(process.execPath,['node_modules/playwright-bdd/dist/cli/index.js','test','--config','playwright.negative.config.ts'],{encoding:'utf8',env:{...process.env,BDD_NEGATIVE_FEATURE:feature,BDD_NEGATIVE_KIND:kind}});
 fs.writeFileSync(`spec/REQ-WB-001/evidence/checks/negative-${kind}.log`,JSON.stringify({exitCode:r.status})+'\n'+r.stdout+r.stderr);return r;
}
test('real bddgen rejects missing bindings',()=>{const r=negative('missing','unregistered fixture step');assert.notEqual(r.status,0);assert.match(r.stdout+r.stderr,/unregistered fixture step/i);});
test('real bddgen rejects ambiguous bindings',()=>{const r=negative('ambiguous','ambiguous fixture step');assert.notEqual(r.status,0);assert.match(r.stdout+r.stderr,/ambiguous/i);});
test('adapter rejects unknown source references and missing cases',()=>{const raw=fs.readFileSync('.bddgen-raw/REQ-WB-001/workbench.feature.spec.js','utf8');const cases=sourceCases(),wrong=structuredClone(cases);wrong[0].scenarioId='AC-MISSING-999';assert.throws(()=>convert(raw,wrong),/Missing\/ambiguous/);const first=raw.indexOf('\n  {"pwTestLine"'),end=raw.indexOf('\n',first+1);assert.throws(()=>convert(raw.slice(0,first)+raw.slice(end),cases),/case count/);});
test('codegen is reproducible without completion implementations',()=>{const before=fs.readFileSync('generated/skeleton/REQ-WB-001/workbench.feature.spec.ts');const beforeManifest=fs.readFileSync('spec/REQ-WB-001/evidence/generation-manifest.json','utf8');const m=generate();assert.equal(hash(before),m.specSha256);assert.equal(fs.readFileSync('spec/REQ-WB-001/evidence/generation-manifest.json','utf8'),beforeManifest);assert.equal(m.completionStatus,'PENDING');});
test('pending stub always fails explicitly',()=>{assert.throws(()=>pendingStep('fixture'),{name:'UnimplementedStepError',message:/PENDING_IMPLEMENTATION/});});
test('actual Playwright skeleton probe fails rather than passing or skipping',()=>{
 const args=['node_modules/@playwright/test/cli.js','test','--grep','本工作台自身依Git中的確認流程開發','--reporter=json'];
 const r=spawnSync(process.execPath,args,{encoding:'utf8'});assert.equal(r.status,1);assert.match(r.stdout+r.stderr,/UnimplementedStepError|PENDING_IMPLEMENTATION/);const report=JSON.parse(r.stdout);assert.equal(report.stats.expected,0);assert.equal(report.stats.unexpected,1);assert.equal(report.stats.skipped,0);
 fs.writeFileSync('spec/REQ-WB-001/evidence/checks/pending-runtime.log',JSON.stringify({scope:'SKELETON_PROBE_NOT_PRODUCT_E2E',expectedExit:1,actualExit:r.status})+'\n'+r.stdout+r.stderr);
});
