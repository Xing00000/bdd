import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fixture, git, toolkitRoot, repository, specRepository, approve, sealedBundle } from './helpers.mjs';
import { createWorkstation } from '../../packages/workstation/service.mjs';
import { openStore } from '../../packages/workstation/store.mjs';
import { executeOperation } from '../../packages/workstation/operations.mjs';
import { prepareProjection } from '../../packages/workstation/projection.mjs';
import { initialize, createFeature, configuration, confirm, reviewState } from '../../packages/spec-toolkit/index.mjs';
import { prepareWorkspaceRun, executeRun } from '../../packages/spec-toolkit/engine.mjs';
import { exists, digest, identity, writeJson } from '../../packages/contracts/index.mjs';
import { dispatch } from '../../packages/workstation/http.mjs';

async function realGit() {
  for (const directory of process.env.PATH.split(path.delimiter)) {
    const file = path.join(directory, 'git'); try { await access(file, constants.X_OK); return file; } catch {}
  }
  throw Error('Git is required for isolated boundary fixtures');
}
async function trapGit(base, fn, { failPublication = false, expectCalls = false } = {}) {
  const executable = await realGit(), directory = path.join(base, `git-trap-${crypto.randomUUID()}`), log = path.join(directory, 'calls.jsonl');
  await mkdir(directory);
  await writeFile(path.join(directory, 'git'), `#!${process.execPath}\nconst fs=require('node:fs'),cp=require('node:child_process');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(args)+'\\n');if(${failPublication}&&!args.some(arg=>arg.includes('/publishers/'))){const r=cp.spawnSync(${JSON.stringify(executable)},args,{stdio:'inherit'});process.exit(r.status??1);}process.exit(94);\n`, { mode: 0o755 });
  const previous = process.env.PATH; process.env.PATH = `${directory}${path.delimiter}${previous}`;
  try { await fn(); } finally { process.env.PATH = previous; }
  const calls = await exists(log) ? (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line)) : [];
  if (!expectCalls) assert.deepEqual(calls, [], 'ordinary work must never spawn Git, including read-only commands');
  return calls;
}
async function workstation(t, f, remoteUrl) {
  const options = { home: f.home, toolkitRoot, allowLocal: true, enableExecution: true };
  const service = await createWorkstation(options), store = openStore(f.home); t.after(async () => { store.close(); await service.close(); });
  service.register({ id: 'SPEC-flow', title: 'Lifecycle fixture', remoteUrl });
  const operation = (name, input = {}) => executeOperation(options, store, { schemaVersion: 1, operationId: `OP-${crypto.randomUUID()}`, repositoryId: 'SPEC-flow', operation: name, input });
  const root = path.join(f.home, 'repositories/SPEC-flow/repo');
  return { options, service, store, operation, root };
}

test('binding, settings, ordinary edits, reads and materialization never spawn Git between lifecycle boundaries', async t => {
  const f = await fixture(t); await git.command(undefined, ['init', '--bare', '--initial-branch', 'main', f.remote]);
  const product = path.join(f.base, 'product'); await repository(product, { 'message.txt': 'before\n' });
  let context;
  await trapGit(f.base, async () => {
    context = await workstation(t, f, f.remote);
    assert.equal(context.service.list()[0].connection.status, 'DEFERRED');
    await context.operation('repository.setup', { reviewer: 'Human', projects: [{ id: 'product', url: product }] });
    await context.service.detail('SPEC-flow');
    assert.equal(await exists(context.root), false);
    assert.equal((await dispatch(context.service, { method: 'GET', url: '/health', headers: {} })).body.status, 'ok');
    await context.operation('repository.prepare');assert.equal(await exists(path.join(context.root,'.git')),false);
  });
  const { service, operation, root } = context;
  await trapGit(f.base,()=>operation('workflow.create', { requirementId: 'REQ-001', featureId: 'login', title: 'Login', guided: true, projectIds: ['product'] }));
  await trapGit(f.base, async () => {
    const relative = 'spec/REQ-001/login/login.sd.md', before = await service.readFile('SPEC-flow', relative);
    await operation('repository.save', { kind: 'source', path: relative, expectedHash: before.sha256, content: '# Updated design\n' });
    await operation('repository.save', { kind: 'project', projectId: 'product', path: 'message.txt', expectedHash: null, content: 'draft product\n' });
    await operation('repository.prepare');
    const feature = (await service.detail('SPEC-flow')).spec.features[0];
    await operation('workflow.review', { requirementId: 'REQ-001', featureId: 'login', stage: 'gherkin', expectedDigest: feature.review.hashes.gherkin });
    await service.workflow('SPEC-flow'); await service.detail('SPEC-flow');
    await service.projectFiles('SPEC-flow', 'product'); await service.readProjectFile('SPEC-flow', 'product', 'message.txt');
    await assert.rejects(operation('repository.sync'), { code: 'ACCEPTANCE_CHECKPOINT_REQUIRED' });
  });
  assert.equal(await exists(path.join(root,'.git')),false);
  assert.equal(await exists(path.join(root,'projects/product/.git')),false);
  assert.equal(await readFile(path.join(root, 'projects/product/message.txt'), 'utf8'), 'draft product\n');
});

test('first creation saves complete source without acquiring an unavailable Git remote',async t=>{
  const f=await fixture(t),context=await workstation(t,f,f.remote);
  await context.operation('repository.setup',{reviewer:'Human',projects:[]});
  const input={editorKey:'new-offline-draft',expectedToken:null,description:'Original source\r\nSecond line',gherkin:'Feature: Offline draft\n  Scenario: saved\n    Then it remains available\n',projectIds:[]};
  const created=await trapGit(f.base,async()=>{
    const result=await context.operation('workflow.requirement.save',input);
    assert.equal(result.saved,true);assert.equal(result.key,'REQ-001/feature');
    const value=await context.service.requirement('SPEC-flow',result.requirementId,result.featureId);
    assert.equal(value.description,input.description);assert.equal(value.gherkin,input.gherkin);
    assert.equal(await exists(context.root),false);
  });
  assert.deepEqual(created,[]);
});

test('creation retries return the same database feature and changed content requires ordinary editing',async t=>{
  const f=await fixture(t),context=await workstation(t,f,f.remote);
  await context.operation('repository.setup',{reviewer:'Human',projects:[]});
  const input={editorKey:'new-create-retry',expectedToken:null,description:'First source',gherkin:'Feature: Retry creation\n  Scenario: create once\n    Then exactly one feature exists\n',projectIds:[]};
  await trapGit(f.base,async()=>{
    const created=await context.operation('workflow.requirement.save',input);
    assert.equal((await context.operation('workflow.requirement.save',input)).key,created.key);
    await assert.rejects(context.operation('workflow.requirement.save',{...input,description:'Use existing editor'}),{code:'CREATION_ALREADY_EXISTS'});
    assert.equal((await context.service.detail('SPEC-flow')).spec.features.length,1);
    const current=await context.service.requirement('SPEC-flow',created.requirementId,created.featureId);
    await context.operation('workflow.requirement.save',{requirementId:created.requirementId,featureId:created.featureId,expectedToken:current.token,description:'Revised source',gherkin:input.gherkin});
    assert.equal((await context.service.requirement('SPEC-flow',created.requirementId,created.featureId)).description,'Revised source');
  });
});

test('verification pins real file bytes without Git and rejects a changed candidate', async t => {
  const f = await fixture(t); await mkdir(f.repo); await mkdir(f.home);
  await initialize(f.repo, { specRepositoryId: 'file-snapshot', toolkitRoot: path.join(toolkitRoot, 'packages') });
  const config = await configuration(f.repo); config.projects = [{ id: 'product', path: 'projects/product' }]; config.execution.install = null;
  await writeJson(path.join(f.repo, 'workbench.yaml'), config);
  await mkdir(path.join(f.repo, 'projects/product'), { recursive: true }); await writeFile(path.join(f.repo, 'projects/product/source.txt'), 'saved bytes\n');
  await writeJson(path.join(f.repo, 'package-lock.json'), { lockfileVersion: 3, packages: {} });
  const ids = { requirementId: 'REQ-001', featureId: 'login' }; await createFeature(f.repo, { ...ids, title: 'Snapshot', projectIds: ['product'] });
  await trapGit(f.base, async () => {
    for (const stage of ['gherkin', 'sd', 'tests']) await confirm(f.repo, { ...ids, stage, expectedDigest: (await reviewState(f.repo, ids.requirementId, ids.featureId)).hashes[stage], confirmedBy: 'Fixture reviewer' });
    const plan = await prepareWorkspaceRun({ root: f.repo, home: f.home, repositoryId: 'SPEC-flow', input: ids });
    assert.equal(plan.sourceKind, 'WORKSPACE'); assert.equal(plan.testedSpecCommit, null); assert.match(plan.projects[0].contentDigest, /^[a-f0-9]{64}$/);
    const candidate = path.join(f.home, 'executions', plan.runId, 'repo'); assert.equal(await exists(path.join(candidate, '.git')), false);
    await writeFile(path.join(f.repo, 'projects/product/source.txt'), 'later edit\n');
    assert.equal(await readFile(path.join(candidate, 'projects/product/source.txt'), 'utf8'), 'saved bytes\n');
    // No runner is installed in this protocol fixture; its honest failure still seals the original inputs without Git.
    const failed = await executeRun({ home: f.home, repositoryId: 'SPEC-flow', runId: plan.runId, enabled: true });
    assert.equal(failed.verification, 'NOT_VERIFIED'); assert.equal(failed.inputsUnchanged, true); assert.equal(failed.testedSpecCommit, null);
    const another = await prepareWorkspaceRun({ root: f.repo, home: f.home, repositoryId: 'SPEC-flow', input: ids });
    await writeFile(path.join(f.home, 'executions', another.runId, 'repo/projects/product/source.txt'), 'tampered candidate\n');
    await assert.rejects(executeRun({ home: f.home, repositoryId: 'SPEC-flow', runId: another.runId, enabled: true }), { code: 'CANDIDATE_CHANGED' });
    await writeFile(path.join(f.repo,'.workbench-tools/spec-toolkit/reporter.mjs'),'// altered toolkit\n');
    await assert.rejects(prepareWorkspaceRun({root:f.repo,home:f.home,repositoryId:'SPEC-flow',input:ids}),{code:'TOOLKIT_HASH_MISMATCH'});
  });
});

async function acceptanceContext(t) {
  const f = await fixture(t); await specRepository(f.repo); await approve(f.repo);
  const context = await workstation(t, f, f.repo); await context.operation('repository.acquire');
  await context.operation('repository.setup', { reviewer: 'Human reviewer', projects: [] });
  const ids = { requirementId: 'REQ-001', featureId: 'login' };
  const request = { schemaVersion: 1, operationId: 'OP-materialize', repositoryId: 'SPEC-flow', operation: 'workflow.verify', input: ids };
  await prepareProjection({ ...context, request });
  const plan = await prepareWorkspaceRun({ root: context.root, home: f.home, repositoryId: 'SPEC-flow', input: ids });
  // An explicitly synthetic sealed report tests the human/checkpoint protocol, not browser execution.
  const report = await sealedBundle(path.join(f.home, 'executions', plan.runId, 'evidence'), plan,
    { testOutcome: 'PASSED', verification: 'VERIFIED', scope: 'ALL_CASES', coverageComplete: true, evidenceComplete: true, inputsUnchanged: true, finishedAt: new Date().toISOString() });
  context.store.recordRun('SPEC-flow', report, 'SEALED');
  return { ...f, ...context, input: { ...ids, runId: plan.runId, expectedManifestDigest: identity(report) }, report };
}
test('human acceptance persists without Git and explicit sync failure cannot undo the decision',async t=>{
  const f=await acceptanceContext(t);
  await trapGit(f.base,async()=>{assert.equal((await f.operation('workflow.accept',f.input)).status,'COMPLETE');});
  const before=JSON.parse((await f.service.readFile('SPEC-flow','spec/REQ-001/login/acceptance.json')).content);assert.equal(before.items.length,1);
  await trapGit(f.base,async()=>{await assert.rejects(f.operation('repository.sync'));},{expectCalls:true});
  assert.equal((await f.service.workflow('SPEC-flow')).workflows[0].status,'COMPLETE');
  await assert.rejects(f.operation('workflow.accept',f.input),{code:'ACCEPTANCE_NOT_READY'});
  assert.deepEqual(JSON.parse((await f.service.readFile('SPEC-flow','spec/REQ-001/login/acceptance.json')).content),before);
});

test('publication failure is an explicit synchronization failure, not an invalid database acceptance',async t=>{
  const f=await acceptanceContext(t);assert.equal((await f.operation('workflow.accept',f.input)).status,'COMPLETE');
  await trapGit(f.base,async()=>{await assert.rejects(f.operation('repository.sync'));},{failPublication:true,expectCalls:true});
  assert.equal((await f.service.workflow('SPEC-flow')).workflows[0].status,'COMPLETE');
  assert.equal(JSON.parse((await f.service.readFile('SPEC-flow','spec/REQ-001/login/acceptance.json')).content).items.length,1);
});

test('a concurrent SQLite edit is preserved and cannot be certified by an older synchronization checkpoint',async t=>{
  const f=await acceptanceContext(t);await f.operation('workflow.accept',f.input);
  const original=f.store.completeAcceptanceCheckpoint,relative='spec/REQ-001/login/login.feature';
  f.store.completeAcceptanceCheckpoint=function(repositoryId,revision,acceptanceId){
    const current=this.draft(repositoryId),file=current.files.find(file=>file.path===relative);
    this.saveDraft(repositoryId,{expectedRevision:current.revision,operationId:'OP-concurrent',request:{concurrent:true},files:[{...file,content:file.content+'\n# concurrent human draft\n'}]});
    return original.call(this,repositoryId,revision,acceptanceId);
  };
  await assert.rejects(f.operation('repository.sync'),{code:'CONTENT_CHANGED'});
  assert.match((await f.service.readFile('SPEC-flow',relative)).content,/concurrent human draft/);
  assert.doesNotMatch((await git.command(f.root,['show',`HEAD:${relative}`])).stdout,/concurrent human draft/);
  assert.notEqual((await f.service.workflow('SPEC-flow')).workflows[0].status,'COMPLETE');
  await assert.rejects(f.operation('repository.sync'),{code:'ACCEPTANCE_CHECKPOINT_REQUIRED'});
});
