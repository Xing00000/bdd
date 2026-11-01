import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture,git,specRepository,approve} from './helpers.mjs';
import {writeJson} from '../../packages/contracts/index.mjs';
import {prepareRun,executeRun,verifyBundle} from '../../packages/spec-toolkit/engine.mjs';

test('runtime Git repositories outside the evidence allowlist cannot prevent sealing a failed run',async t=>{
  const f=await fixture(t);await mkdir(f.home);await specRepository(f.repo);
  const config=JSON.parse(await readFile(path.join(f.repo,'workbench.yaml'),'utf8'));
  config.execution.install=[process.execPath,'-e',"const fs=require('node:fs'),path=require('node:path'); const directory=path.join(process.env.TMPDIR,'private-fixture','.git');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'config'),'runtime data must not become evidence');console.error('expected preparation failure');process.exit(3)"];
  await writeJson(path.join(f.repo,'workbench.yaml'),config);await approve(f.repo);
  const candidate=await prepareRun({root:f.repo,home:f.home,repositoryId:'WS-scratch',input:{requirementId:'REQ-001',featureId:'login',expected:await git.inspect(f.repo)},git});
  const result=await executeRun({home:f.home,repositoryId:'WS-scratch',runId:candidate.runId,git,enabled:true});
  assert.equal(result.testOutcome,'NOT_RUN');assert.equal(result.verification,'NOT_VERIFIED');
  assert.equal(result.failure.code,'EXECUTION_COMMAND_FAILED');assert.ok(result.artifacts.some(a=>a.path==='logs/1.json'));
  assert.ok(result.artifacts.every(a=>!a.path.startsWith('tmp/')&&!a.path.includes('.git')));
  await verifyBundle(path.join(f.home,'executions',candidate.runId,'evidence'));
});
