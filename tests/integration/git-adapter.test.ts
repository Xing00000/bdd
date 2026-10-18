import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGitAdapter } from '../../src/adapters/git/index.js';

const git = (repo: string, args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-git-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const repo = path.join(root, 'target'); await mkdir(repo);
  git(repo, ['init', '-b', 'main']);
  git(repo, ['config', 'user.name', 'Fixture']); git(repo, ['config', 'user.email', 'fixture@localhost']);
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({ type: 'module', scripts: { test: 'node verify.mjs' } }));
  await writeFile(path.join(repo, 'value.txt'), 'initial\n');
  await writeFile(path.join(repo, 'verify.mjs'), "import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';assert.equal(readFileSync('value.txt','utf8'),'initial\\n');console.log('verified committed value');\n");
  git(repo, ['add', '.']); git(repo, ['commit', '-m', 'initial']);
  return { root, repo, adapter: createGitAdapter({ workspaceRoot: root }), initial: git(repo, ['rev-parse', 'HEAD']) };
}

test('Git snapshot pins commit and preserves exact Unicode/CRLF bytes while branch advances', async t => {
  const { repo, adapter } = await fixture(t);
  const rawText = '// 繁體中文\r\nexport const text = "測試";\r\n';
  const saved = await adapter.save({ repo, files: [{ path: 'spec/demo.spec.ts', rawText }] });
  await adapter.save({ repo, files: [{ path: 'spec/demo.spec.ts', rawText: 'new branch content\n' }] });
  const snapshot = await adapter.readSnapshot({ repo, branch: 'main', commit: saved.commit, path: 'spec/demo.spec.ts' });
  assert.equal(snapshot.rawText, rawText);
  assert.equal(snapshot.commit, saved.commit);
  assert.equal(snapshot.branch, 'main');
  assert.notEqual(git(repo, ['rev-parse', 'HEAD']), snapshot.commit);
});

test('Explicit Git save excludes unrelated staged files and rejects path/symlink escapes', async t => {
  const { root, repo, adapter } = await fixture(t);
  await writeFile(path.join(repo, 'unrelated.txt'), 'keep staged\n'); git(repo, ['add', 'unrelated.txt']);
  const saved = await adapter.save({ repo, files: [{ path: 'saved.spec.ts', rawText: 'export {};\n' }] });
  assert.equal(git(repo, ['show', '--format=', '--name-only', saved.commit]), 'saved.spec.ts');
  assert.equal(git(repo, ['diff', '--cached', '--name-only']), 'unrelated.txt');
  await assert.rejects(adapter.save({ repo, files: [{ path: '../outside', rawText: 'no' }] }), { code: 'GIT_PATH_INVALID' });
  await symlink(root, path.join(repo, 'escape'), 'dir');
  await assert.rejects(adapter.save({ repo, files: [{ path: 'escape/outside', rawText: 'no' }] }), { code: 'GIT_SYMLINK_PATH' });
  await assert.rejects(adapter.readSnapshot({ repo: root, commit: saved.commit, path: '.git/config' }));
});

test('CI executes the pinned commit, keeps HEAD unchanged and preserves real failure exit code/output', async t => {
  const { repo, adapter, initial } = await fixture(t);
  const changed = await adapter.save({ repo, files: [{ path: 'value.txt', rawText: 'branch advanced\n' }] });
  const passed = await adapter.runCi({ repo, commit: initial });
  assert.equal(passed.status, 'PASSED'); assert.equal(passed.exitCode, 0);
  assert.equal(passed.candidateCommit, initial); assert.equal(passed.testedCommit, initial);
  assert.match(passed.stdout, /verified committed value/);
  assert.equal(git(repo, ['rev-parse', 'HEAD']), changed.commit);
  assert.equal(await readFile(path.join(repo, 'value.txt'), 'utf8'), 'branch advanced\n');
  const failed = await adapter.runCi({ repo, commit: initial, command: [process.execPath, '-e', "console.error('actual CI failure');process.exit(7)"] });
  assert.equal(failed.status, 'FAILED'); assert.equal(failed.exitCode, 7); assert.match(failed.stderr, /actual CI failure/);
  assert.equal(git(repo, ['worktree', 'list', '--porcelain']).split('worktree ').length - 1, 1);
});

test('CI trusted checkout preparation runs against the fixed worktree and failure prevents the project command',async t=>{
  const {repo,adapter,initial}=await fixture(t);
  const receipt=await adapter.runCi({repo,commit:initial,env:{WB_CHECK:'untrusted-default'},command:[process.execPath,'-e',"if(process.env.WB_CHECK!=='fixed-checkout')process.exit(8);console.log('trusted environment used')"],prepareCheckout:async checkout=>{
    assert.notEqual(checkout,repo);assert.equal(git(checkout,['rev-parse','HEAD']),initial);assert.equal(await readFile(path.join(checkout,'value.txt'),'utf8'),'initial\n');
    return {env:{WB_CHECK:'fixed-checkout'},files:[{path:'value.txt',verified:true}]};
  }});
  assert.equal(receipt.exitCode,0);assert.match(receipt.stdout,/trusted environment used/);assert.deepEqual(receipt.checkout?.files,[{path:'value.txt',verified:true}]);assert.equal('env' in receipt.checkout!,false);
  await assert.rejects(adapter.runCi({repo,commit:initial,command:[process.execPath,'-e',"throw Error('MUST_NOT_RUN')"],prepareCheckout:async()=>{throw Object.assign(Error('Committed tests differ from fixed DB version'),{code:'CI_DEFINITION_MISMATCH'});}}),{code:'CI_DEFINITION_MISMATCH'});
  assert.equal(git(repo,['worktree','list','--porcelain']).split('worktree ').length-1,1);
});
