import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { spawnSync } from 'node:child_process';
import { generate,manifestPath } from './generate.mjs';
import { canReportPass,hasCompleteEvidence } from '../../tests/completion/support/reporter.ts';
import { FixtureDatabase } from '../../tests/completion/support/database.ts';
import { resolveManagedPage } from '../../tests/completion/support/managed.ts';
import { StepEvidence } from '../../tests/completion/support/evidence.ts';
import { expect as playwrightExpect } from '@playwright/test';
import { specText,failingSpecText,missingFeature,missingSd } from '../../tests/completion/fixtures/content.ts';
const defs=JSON.parse(fs.readFileSync('tests/completion/steps/definitions.json'));
test('28/44 completion generation is reproducible and does not modify saved skeleton',()=>{
 const before=fs.readFileSync(manifestPath,'utf8'),spec=fs.readFileSync('generated/completed/REQ-WB-001/workbench.feature.spec.ts','utf8');generate();assert.equal(fs.readFileSync(manifestPath,'utf8'),before);assert.equal(fs.readFileSync('generated/completed/REQ-WB-001/workbench.feature.spec.ts','utf8'),spec);
});
test('all 174 active bindings have nonempty implementations and critical scenarios are wired',()=>{
 assert.equal(defs.length,174);assert(defs.every(d=>d.plan.length>0));
 for(const op of ['llmPrepare','llmCompleteBoth','llmFullCheck','llmMissingCheck','blockedSave','selectedExact','selectedUnselected','selectedLive','selectedEvidence','selectedPartial'])assert(defs.some(d=>d.plan.some(p=>p.op===op)),op);
 assert.equal(defs.filter(d=>d.scenarioId==='AC-WB-028').length,13);
});
test('managed resolver selects the requested identity across multiple contexts and rejects ambiguity',async()=>{
 const wanted={sessionId:'s',contextRef:'c2',pageId:'p2'},other={sessionId:'s',contextRef:'c1',pageId:'p1'};
 const page=id=>({isClosed:()=>false,evaluate:async()=>id});const match=page(wanted);
 const browser={contexts:()=>[{pages:()=>[page(other)]},{pages:()=>[match]}]};assert.equal(await resolveManagedPage(browser,wanted),match);
 await assert.rejects(()=>resolveManagedPage(browser,{...wanted,pageId:'missing'}),/found 0/);
 await assert.rejects(()=>resolveManagedPage({contexts:()=>[{pages:()=>[match,match]}]},wanted),/found 2/);
});
test('report refuses empty, partial, duplicate, skipped, failed or evidence-incomplete green results',()=>{
 const good=[{testKey:'a',status:'passed',evidenceComplete:true},{testKey:'b',status:'passed',evidenceComplete:true}];
 assert.equal(canReportPass('passed',['a','b'],good),true);
 for(const result of [[],good.slice(0,1),[good[0],good[0]],[good[0],{...good[1],status:'skipped'}],[good[0],{...good[1],status:'failed'}],[good[0],{...good[1],evidenceComplete:false}]])assert.equal(canReportPass('passed',['a','b'],result),false);
 assert.equal(canReportPass('passed',[],[]),false);assert.equal(canReportPass('failed',['a','b'],good),false);
});
test('report requires source-step coverage, real assertion values and screenshot identity chain',()=>{
 const row={status:'COMPLETED',screenshotSha256:'a'.repeat(64),sourceStepLine:9,assertion:true,runId:'r',testDefinitionId:'t',sourceCaseId:'t',sourceStepId:'L9',sessionId:'s',contextRef:'c',pageId:'p',actionIndex:1,expected:true,actual:true};
 assert.equal(hasCompleteEvidence({records:[row],actions:[row]},[9],'t'),true);
 assert.equal(hasCompleteEvidence({records:[row],actions:[row]},[9,10],'t'),false);
 for(const patch of [{screenshotSha256:null},{sessionId:''},{status:'FAILED'},{actual:undefined},{assertion:false}])assert.equal(hasCompleteEvidence({records:[{...row,...patch}],actions:[{...row,...patch}]},[9],'t'),false);
});
test('dedicated fixtures fit SD0.4 DDL and missing-information input has no expected outcomes',()=>{
 fs.mkdirSync('.test-fixtures',{recursive:true});const file=resolve('.test-fixtures/tool-'+randomUUID()+'.e2e.sqlite');const db=new DatabaseSync(file);db.exec('PRAGMA foreign_keys=ON');
 const sd=fs.readFileSync('spec/REQ-WB-001/SD.md','utf8');for(const m of sd.matchAll(/~~~sql\n([\s\S]*?)\n~~~/g))if(m[1].startsWith('CREATE TABLE'))db.exec(m[1]);db.close();
 const full=new FixtureDatabase(file,'http://fixture.invalid',resolve('.test-fixtures/target.sqlite'));
 const missing=new FixtureDatabase(file,'http://fixture.invalid',resolve('.test-fixtures/target.sqlite'),true);
 try{full.stage('TESTS');full.baseline(true);missing.stage('TESTS');
  assert.equal(full.all('SELECT test_stage FROM document_versions WHERE id=?',[full.vars.specVersion])[0].test_stage,'COMPLETED');
  assert.equal(full.all('SELECT count(*) AS n FROM test_definitions WHERE spec_version_id=?',[full.vars.specVersion])[0].n,3);
  const foreign=full.all('PRAGMA foreign_key_check');assert.deepEqual(foreign,[]);
  assert(!/denied|saved|<expected>/.test(missingFeature+missingSd));
  for(const row of missing.all('SELECT v.raw_text FROM document_versions v JOIN documents d ON d.id=v.document_id WHERE d.requirement_id=?',[missing.vars.requirement]))assert(!/denied|saved|<expected>/.test(row.raw_text));
 }finally{full.close();missing.close();fs.rmSync(file);}
});
test('nested success and deliberate-failure fixtures contain syntactically valid real assertions',()=>{
 for(const raw of [specText('http://fixture.invalid',true),failingSpecText('http://fixture.invalid')]){
  const file=ts.createSourceFile('fixture.ts',raw,ts.ScriptTarget.Latest,true);assert.equal(file.parseDiagnostics.length,0);assert.equal((raw.match(/workbenchTestId/g)||[]).length,3);assert(!raw.includes('this.check'));assert(raw.includes('runner.'));
 }
});
test('E2E entrypoint stops before execution when product prerequisites are missing',()=>{
 const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('WB_'))delete env[key];const r=spawnSync(process.execPath,['tools/completion/run-e2e.mjs'],{env,encoding:'utf8'});assert.equal(r.status,2);const receipt=JSON.parse(fs.readFileSync('spec/REQ-WB-001/evidence/completion/e2e-status.json'));assert.equal(receipt.productE2E,'NOT_RUN');assert.equal(receipt.executionAttempted,false);assert(receipt.missing.includes('WB_BASE_URL'));
});

test('per-action evidence records synchronous mismatch and preserves assertion error when screenshot fails',async()=>{
 const context={},info={annotations:[{type:'workbenchTestId',description:'REQ/AC/default'}],attach:async()=>{}};
 const page={context:()=>context,screenshot:async()=>Buffer.from('unit-image-not-product-evidence')};
 const tracker=new StepEvidence(page,info);tracker.setStep(9,'Then');const check=tracker.wrapExpect(playwrightExpect);
 assert.throws(()=>check(2).toBe(3));await Promise.resolve();await tracker.flush();
 const record=tracker.actions.find(a=>a.assertion);assert.equal(record.status,'FAILED');assert.equal(record.actual,2);assert.equal(record.expected.arguments[0],3);assert.equal(record.sourceStepLine,9);
 const broken=new StepEvidence({...page,screenshot:async()=>{throw Error('unit image failure');}},info);broken.setStep(9,'Then');const primary=Error('original assertion mismatch');
 const row=await broken.capture('assert',primary,3,2,undefined,true);assert.equal(row.status,'FAILED');assert.equal(row.error,String(primary));assert.match(row.screenshotError,/unit image failure/);
 await assert.rejects(()=>broken.capture('action'),/Required per-action screenshot failed/);
});
