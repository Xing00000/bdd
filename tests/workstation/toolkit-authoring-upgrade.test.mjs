import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture,git,toolkitRoot } from './helpers.mjs';
import { createWorkstation } from '../../packages/workstation/service.mjs';
import { openStore } from '../../packages/workstation/store.mjs';
import { inDraftView,sourceFiles } from '../../packages/workstation/authoring.mjs';
import { TOOLKIT_VERSION } from '../../packages/spec-toolkit/index.mjs';
import { digest } from '../../packages/contracts/index.mjs';

test('hash-verified toolkit upgrade is one SQLite authoring transaction and preserves confirmed sources',async t=>{
  const f=await fixture(t);await git.command(undefined,['init','--bare','--initial-branch','main',f.remote]);
  const service=await createWorkstation({home:f.home,toolkitRoot,allowLocal:true,autoAcquire:false});t.after(()=>service.close());
  service.register({id:'SPEC-upgrade',title:'Upgrade',remoteUrl:f.remote});
  const store=openStore(f.home);t.after(()=>store.close());let count=0;
  const job=async(operation,input={})=>{
    const id=`UPGRADE-${++count}`;service.enqueue({schemaVersion:1,operationId:id,repositoryId:'SPEC-upgrade',operation,input});return service.wait(id);
  };
  assert.equal((await job('repository.setup',{reviewer:'Human',projects:[]})).status,'SUCCEEDED');
  const created=await job('workflow.create',{requirementId:'REQ-001',featureId:'login',title:'Login',guided:true,acceptance:'Login succeeds'});assert.equal(created.status,'SUCCEEDED',JSON.stringify(created.error));
  const root=path.join(f.home,'repositories/SPEC-upgrade/repo'),checkpoint=await git.inspect(root);
  let feature=(await service.detail('SPEC-upgrade')).spec.features[0];
  await job('workflow.review',{requirementId:'REQ-001',featureId:'login',stage:'gherkin',expectedDigest:feature.review.hashes.gherkin});
  const snapshot=store.draft('SPEC-upgrade');
  const altered=await inDraftView(snapshot,async root=>{
    const manifestPath=path.join(root,'.workbench-tools/manifest.json');
    const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
    const reporterPath='.workbench-tools/spec-toolkit/reporter.mjs';
    const reporter=(await readFile(path.join(root,reporterPath),'utf8'))+'\n// verified prior toolkit release\n';
    await writeFile(path.join(root,reporterPath),reporter);
    manifest.version='1.3.0+req-tags.1';manifest.files.find(file=>file.path==='spec-toolkit/reporter.mjs').sha256=digest(reporter);
    await writeFile(manifestPath,JSON.stringify(manifest));
    return (await sourceFiles(root)).filter(file=>[reporterPath,'.workbench-tools/manifest.json'].includes(file.path));
  });
  store.saveDraft('SPEC-upgrade',{expectedRevision:snapshot.revision,operationId:'seed-prior-release',request:{fixture:'prior-release'},files:altered,result:{}});
  const before=(await service.detail('SPEC-upgrade')).spec.features[0];
  const preview=await job('repository.upgrade.preview');assert.equal(preview.status,'SUCCEEDED',JSON.stringify(preview.error));assert.ok(preview.result.changed>0);
  const rejected=await job('repository.upgrade.apply',{planDigest:'stale'});assert.equal(rejected.error.code,'PLAN_CHANGED');
  const applied=await job('repository.upgrade.apply',{planDigest:preview.result.digest});assert.equal(applied.status,'SUCCEEDED',JSON.stringify(applied.error));assert.equal(applied.result.storage,'sqlite');
  const after=(await service.detail('SPEC-upgrade')).spec.features[0];
  assert.deepEqual(after.review.confirmed,before.review.confirmed);
  assert.equal(after.review.hashes.gherkin,before.review.hashes.gherkin);assert.equal(after.review.hashes.sd,before.review.hashes.sd);
  assert.equal(JSON.parse((await service.readFile('SPEC-upgrade','workbench.yaml')).content).specRepositoryId,'SPEC-upgrade');
  assert.equal(JSON.parse(store.draft('SPEC-upgrade').files.find(file=>file.path==='.workbench-tools/manifest.json').content).version,TOOLKIT_VERSION);
  assert.deepEqual(await git.inspect(root),checkpoint,'Upgrade must not modify the creation checkout or its checkpoint');
});
