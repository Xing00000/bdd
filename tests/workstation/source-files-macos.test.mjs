import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sourceFiles, inDraftView } from '../../packages/workstation/authoring.mjs';
import { initialize, createFeature, reviewState, confirm } from '../../packages/spec-toolkit/index.mjs';
import { toolkitRoot } from './helpers.mjs';

test('macOS Finder metadata does not block importing specification text', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bdd-macos-source-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'tests', 'nested'), { recursive: true });
  await writeFile(path.join(root,'.gitignore'),'.DS_Store\n');
  await writeFile(path.join(root, 'tests', '.DS_Store'), Buffer.from([0, 1, 255]));
  await writeFile(path.join(root, 'tests', 'nested', '.DS_Store'), Buffer.from([0, 2]));
  await writeFile(path.join(root, 'tests', 'feature.steps.ts'), 'export {};\n');
  const files = await sourceFiles(root);
  assert.deepEqual(files.map(file => file.path), ['.gitignore','tests/feature.steps.ts']);
  await writeFile(path.join(root, 'tests', 'other.bin'), Buffer.from([0, 1]));
  await assert.rejects(sourceFiles(root), { code: 'BINARY_FILE' });
});

test('Finder metadata cannot change SQL versus checkout review hashes or veto the reviewed test digest',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'bdd-macos-review-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await initialize(root,{specRepositoryId:'SPEC-macos',toolkitRoot:path.join(toolkitRoot,'packages')});
  const ids={requirementId:'REQ-001',featureId:'reader'};
  await createFeature(root,{...ids,title:'Reader'});
  const ignore=path.join(root,'.gitignore');
  const {readFile}=await import('node:fs/promises');await writeFile(ignore,(await readFile(ignore,'utf8'))+'\n.DS_Store\n');
  for(const stage of ['gherkin','sd'])await confirm(root,{...ids,stage,expectedDigest:(await reviewState(root,ids.requirementId,ids.featureId)).hashes[stage],confirmedBy:'Human'});
  const expected=await reviewState(root,ids.requirementId,ids.featureId),snapshot={files:await sourceFiles(root)};
  for(const folder of ['.workbench-tools','tests/_shared','tests/REQ-001/reader'])await writeFile(path.join(root,folder,'.DS_Store'),Buffer.from([0,1,255]));
  const checkout=await reviewState(root,ids.requirementId,ids.featureId),sql=await inDraftView(snapshot,view=>reviewState(view,ids.requirementId,ids.featureId));
  assert.deepEqual(checkout.hashes,sql.hashes);assert.deepEqual(checkout.hashes,expected.hashes);
  await confirm(root,{...ids,stage:'tests',expectedDigest:sql.hashes.tests,confirmedBy:'Human'});
  await writeFile(path.join(root,'tests/REQ-001/reader/reader.steps.ts'),'export const actualSourceChange = true;\n');
  await assert.rejects(confirm(root,{...ids,stage:'tests',expectedDigest:sql.hashes.tests,confirmedBy:'Human'}),{code:'CONTENT_CHANGED'});
});
