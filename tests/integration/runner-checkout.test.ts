import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, symlink, realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {createPlaywrightRunner} from '../../src/adapters/runner/playwright.ts';
import {prepareCheckout} from '../../src/adapters/runner/checkout.ts';
import type {RunnerVersion} from '../../src/ports/runner.ts';

const root = resolve(process.cwd()), hash = (value: string) => createHash('sha256').update(value).digest('hex');
const spec = "import {test,expect} from '../support/fixture.ts';\n" + ['test-a', 'test-a-extra', 'test-b'].map(key => `test('${key}',{annotation:{type:'workbenchTestId',description:'${key}'}},async()=>{expect(2+2).toBe(4);});`).join('\n');
const members = [{path: 'generated/actual.spec.ts', rawText: spec}, {path: 'support/fixture.ts', rawText: "export {test,expect} from '@playwright/test';\n"}];
async function setup(t: {after: (fn: () => Promise<void>) => void}, plain = false) {
  const directory = await mkdtemp(join(tmpdir(), 'workbench-checkout-')), checkout = join(directory, 'checkout'), artifactRoot = join(directory, 'artifacts'), runId = randomUUID();
  await mkdir(checkout); await symlink(join(root, 'node_modules'), join(checkout, 'node_modules'), 'dir');
  const files = plain ? [{path: 'demo.spec.ts', rawText: spec.replace("'../support/fixture.ts'", "'@playwright/test'")}] : members;
  await writeFile(join(checkout, 'package.json'), '{"private":true,"type":"module"}\n');
  for (const file of files) {await mkdir(dirname(join(checkout, file.path)), {recursive: true}); await writeFile(join(checkout, file.path), file.rawText);}
  const versions: RunnerVersion[] = [{id: 'version-v1', document_id: 'document', file_name: files[0].path, raw_text: files[0].rawText, raw_sha256: hash(files[0].rawText),
    test_manifest_json: plain ? null : JSON.stringify({specPath: files[0].path, bundleFiles: files, specSha256: hash(files[0].rawText)})}];
  const runner = createPlaywrightRunner({root, artifactRoot, baseUrl: 'http://127.0.0.1:1'});
  const prepared = await runner.prepare(runId, versions, ['test-a', 'test-a-extra']);
  t.after(async () => {await runner.close(); await rm(directory, {recursive: true, force: true});});
  const input = {checkout, prepared, versions, root, baseUrl: 'http://127.0.0.1:1', artifactRoot, runId};
  return {input, files, checkout, prepared, versions};
}

test('trusted CI preparation discovers actual checkout bytes and keeps all evidence outside the disposable checkout', async t => {
  const fixture = await setup(t), receipt = await prepareCheckout(fixture.input);
  assert.deepEqual(receipt.discoveredTestKeys.sort(), ['test-a', 'test-a-extra', 'test-b']);
  assert.deepEqual(receipt.selectedTestKeys.sort(), ['test-a', 'test-a-extra']);
  assert.equal(receipt.config, join(fixture.prepared.directory, 'checkout.config.mjs'));
  assert.equal(receipt.selection, join(fixture.prepared.directory, 'checkout-selected-tests.txt'));
  const config = await readFile(receipt.config, 'utf8');
  assert.ok(config.includes(JSON.stringify(await realpath(fixture.checkout))));
  for (const output of ['test-results', 'execution.json', 'html']) assert.ok(config.includes(JSON.stringify(join(fixture.prepared.directory, output))));
  assert.deepEqual(receipt.files, fixture.files.map(file => ({path: file.path, sha256: hash(file.rawText)})));
  assert.equal(receipt.env.WB_CI_CONFIG, receipt.config); assert.equal(receipt.env.WB_CI_PROJECT, 'workbench');
  assert.doesNotMatch(await readFile(receipt.selection, 'utf8'), /test-b/);
  // Deleting the worktree must not delete configuration, the exact test list, or preparation evidence.
  await rm(fixture.checkout, {recursive: true});
  assert.match(await readFile(receipt.config, 'utf8'), /testDir/);
  assert.ok(JSON.parse(await readFile(join(fixture.prepared.directory, 'checkout-preparation.json'), 'utf8')).files.length);
});

test('trusted CI preparation maps the database materialization alias to the actual Git document filename', async t => {
  const fixture = await setup(t, true), receipt = await prepareCheckout(fixture.input);
  assert.ok(fixture.prepared.tests.every(test => test.file === 'script-1.spec.ts'));
  assert.match(await readFile(receipt.selection, 'utf8'), /demo\.spec\.ts/);
  assert.doesNotMatch(await readFile(receipt.selection, 'utf8'), /script-1/);
  assert.equal(receipt.files[0].path, 'demo.spec.ts');
});

test('trusted CI preparation rejects a changed helper even when spec IDs and titles would remain identical', async t => {
  const fixture = await setup(t);
  await writeFile(join(fixture.checkout, 'support/fixture.ts'), "export {test,expect} from '@playwright/test';\n// unauthorized helper change\n");
  await assert.rejects(prepareCheckout(fixture.input), (error: any) => error.code === 'CHECKOUT_CONTENT_MISMATCH');
});

test('trusted CI preparation rejects a changed selected ID and any symlink bundle path', async t => {
  const fixture = await setup(t);
  const original = fixture.prepared.tests[0].testKey;
  fixture.prepared.tests[0].testKey = 'metadata-was-replaced';
  await assert.rejects(prepareCheckout(fixture.input), (error: any) => error.code === 'CHECKOUT_DISCOVERY_MISMATCH');
  fixture.prepared.tests[0].testKey = original;
  await rm(join(fixture.checkout, 'support/fixture.ts'));
  await symlink(join(fixture.prepared.directory, 'tests/support/fixture.ts'), join(fixture.checkout, 'support/fixture.ts'));
  await assert.rejects(prepareCheckout(fixture.input), (error: any) => error.code === 'CHECKOUT_SYMLINK_REJECTED');
});
