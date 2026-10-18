import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,symlink,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createPlaywrightRunner} from '../../src/adapters/runner/playwright.ts';

test('runner discovers and selects exact cases when its artifact workspace traverses a directory symlink',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'bdd-runner-paths-'));
  const physical=join(directory,'physical'),alias=join(directory,'alias');
  await mkdir(physical);await symlink(physical,alias,'dir');
  const runner=createPlaywrightRunner({root:resolve(process.cwd()),artifactRoot:alias,baseUrl:'http://127.0.0.1:1'});
  t.after(async()=>{await runner.close();await rm(directory,{recursive:true,force:true});});
  const keys=['case-a','case-a-extra','case-b'];
  const raw="import {test,expect} from '@playwright/test';\n"+keys.map(key=>`test('${key}',{annotation:{type:'workbenchTestId',description:'${key}'}},async()=>{expect(2+2).toBe(4);});`).join('\n');
  const prepared=await runner.prepare('path-regression',[{id:'version',document_id:'document',raw_text:raw,raw_sha256:createHash('sha256').update(raw).digest('hex')}],keys.slice(0,2));
  assert.equal(prepared.directory,await realpath(join(alias,'runs/path-regression')));
  assert.deepEqual(prepared.tests.map(test=>test.testKey),keys);
  assert.deepEqual(prepared.selected.map(test=>test.testKey),keys.slice(0,2));
});
