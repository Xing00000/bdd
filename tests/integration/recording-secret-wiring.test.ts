import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCore} from '../../src/application/core.ts';
import {createRuns} from '../../src/application/runs.ts';
import type {BrowserRuntimePort} from '../../src/ports/runtime.ts';
import type {TestRunnerPort} from '../../src/ports/runner.ts';

test('explicit replay port fixture receives only resolved aliases and canonical receipts redact their values',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'wb-secret-wiring-')),core=await createCore(join(directory,'metadata.sqlite'));
  const secret='unit-fixture-secret-value',project=await core.createProject({name:'Secret wiring unit',workspaceRef:directory});
  const script=await core.createScript({projectId:project.id,purpose:'recording',rawText:"import {test} from '@playwright/test';\ntest('recorded',async()=>{const value=process.env.WB_SECRET_LOGIN;});",actions:[],executionConfig:{secretBindings:[{alias:'WB_SECRET_LOGIN',secretRef:'unit-reference'}]}});
  const browser:BrowserRuntimePort={async create(){throw Error('No browser in this explicit port fixture');},attachment(){throw Error('No browser');},async input(){},subscribe(){return()=>{};},async startRecording(){throw Error('No browser');},async stopRecording(){throw Error('No browser');},async addAssertion(){},async closeSession(){},async close(){}};
  let runs:ReturnType<typeof createRuns>;
  const runner:TestRunnerPort={async prepare(){const entry={testKey:'recorded',project:'workbench',file:'recording.spec.ts',titlePath:['recorded'],qualified:'[workbench] › recording.spec.ts › recorded',expectedStatus:'passed'};return {directory,config:'unit-config',configSha256:'unit',selection:'unit-selection',selectionSha256:'unit',tests:[entry],selected:[entry],materializations:[]};},async execute(runId,_prepared,_token,env){assert.deepEqual(env,{WB_SECRET_LOGIN:secret});await runs.ingest(runId,{eventId:'unit-completed',runId,type:'run.completed',payload:{errors:[secret]}});return {code:1,stdout:secret,stderr:secret};},async close(){}};
  runs=createRuns({store:core.store,browser,runner,root:directory,artifactRoot:join(directory,'artifacts'),baseUrl:'http://127.0.0.1:1',emit(){},async resolveSource(){throw Error('Not used by independent replay');},async resolveRecordingSecret(ref,context){assert.equal(ref,'unit-reference');assert.equal(context.projectId,project.id);return secret;}});
  try{const result=await runs.replay(script.documentId,script.versionId!);const report=await runs.wait(result.runId);assert.equal(report.status,'INCOMPLETE');assert.equal(report.environment.execution.stderr,'[REDACTED]');assert.deepEqual(report.environment.execution.reporter.errors,['[REDACTED]']);assert.equal(JSON.stringify(report).includes(secret),false);assert.equal((await readFile(join(directory,'artifacts/runs',result.runId,'report.json'),'utf8')).includes(secret),false);}
  finally{await runs.close();await core.close();await rm(directory,{recursive:true,force:true});}
});
