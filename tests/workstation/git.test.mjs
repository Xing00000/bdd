import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, mkdir, symlink, rm } from 'node:fs/promises';
import path from 'node:path';
import { fixture, repository, git, commitAll } from './helpers.mjs';
import { remoteUrl, branchName, createGit, execute, processEnvironment } from '../../packages/git-core/index.mjs';
import { withProgress } from '../../packages/git-core/progress.mjs';
import { safePath } from '../../packages/contracts/index.mjs';

test('remote policy rejects credentials, unapproved hosts, executable transports and traversal', () => {
  for (const value of ['ext::sh -c id', 'file:///tmp/a', 'http://github.com/a/b', 'https://token@github.com/a/b', 'https://github.com/a/b?token=x', 'https://evil.example/a/b', 'https://github.com/a/../b', '-u'])
    assert.throws(() => remoteUrl(value));
  assert.equal(remoteUrl('git@github.com:Xing00000/bdd.git'), 'git@github.com:Xing00000/bdd.git');
  assert.equal(remoteUrl('https://github.com/Xing00000/bdd-spec.git'), 'https://github.com/Xing00000/bdd-spec.git');
  for (const value of ['../main', 'a..b', '-b', 'a.lock', 'a//b']) assert.throws(() => branchName(value));
});
test('repository paths reject traversal, .git and symlink escapes', async t => {
  const f = await fixture(t); await mkdir(f.repo); await mkdir(path.join(f.base, 'outside'));
  await symlink(path.join(f.base, 'outside'), path.join(f.repo, 'link'));
  for (const value of ['../secret', '.git/config', 'a/../../x', '/etc/passwd', 'link/secret']) await assert.rejects(safePath(f.repo, value));
});
test('empty remote clone supports unborn HEAD without assuming main exists', async t => {
  const f = await fixture(t); await git.command(undefined, ['init', '--bare', '--initial-branch', 'main', f.remote]);
  const state = await git.clone(f.remote, f.repo); assert.equal(state.head, null); assert.equal(state.branch, 'main');
});
test('commit-selected preserves unrelated staged and unstaged content', async t => {
  const f = await fixture(t); await repository(f.repo, { 'a.txt': 'a0', 'b.txt': 'b0', 'c.txt': 'c0' });
  await writeFile(path.join(f.repo, 'a.txt'), 'a1'); await writeFile(path.join(f.repo, 'b.txt'), 'b staged');
  await git.command(f.repo, ['add', '--', 'b.txt']); await writeFile(path.join(f.repo, 'b.txt'), 'b unstaged'); await writeFile(path.join(f.repo, 'c.txt'), 'c1');
  const before = await git.inspect(f.repo);
  const result = await git.commitSelected(f.repo, { paths: ['a.txt'], message: 'Only a' }, before);
  assert.notEqual(result.commit, before.head);
  assert.equal((await git.command(f.repo, ['show', 'HEAD:b.txt'])).stdout, 'b0');
  assert.equal((await git.command(f.repo, ['show', ':b.txt'])).stdout, 'b staged');
  assert.equal(await readFile(path.join(f.repo, 'b.txt'), 'utf8'), 'b unstaged');
  assert.equal(await readFile(path.join(f.repo, 'c.txt'), 'utf8'), 'c1');
  assert.equal((await git.command(f.repo, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'])).stdout.trim(), 'a.txt');
});
test('commit-selected supports literal filenames and never runs shell metacharacters', async t => {
  const f = await fixture(t); await repository(f.repo);
  const name = 'literal[1];touch-PWNED.txt'; await writeFile(path.join(f.repo, name), 'safe');
  await git.commitSelected(f.repo, { paths: [name], message: 'Literal file' }, await git.inspect(f.repo));
  assert.equal((await git.command(f.repo, ['show', `HEAD:${name}`])).stdout, 'safe');
});

test('selected additions and deletions refresh the index without reset or changing unrelated staging',async t=>{
  const f=await fixture(t);await repository(f.repo,{'removed.txt':'old','unrelated.txt':'original'});
  await rm(path.join(f.repo,'removed.txt'));await writeFile(path.join(f.repo,'new.txt'),'new source');
  await writeFile(path.join(f.repo,'unrelated.txt'),'staged work');await git.command(f.repo,['add','--','unrelated.txt']);
  await writeFile(path.join(f.repo,'unrelated.txt'),'unstaged work');
  const before=await git.inspect(f.repo);
  await withProgress(f.home,'OP-index',()=>git.commitSelected(f.repo,{paths:['removed.txt','new.txt'],message:'Selected changes'},before));
  assert.equal((await git.command(f.repo,['ls-files','--','removed.txt'])).stdout,'');
  assert.equal((await git.command(f.repo,['show',':new.txt'])).stdout,'new source');
  assert.equal((await git.command(f.repo,['show',':unrelated.txt'])).stdout,'staged work');
  assert.equal(await readFile(path.join(f.repo,'unrelated.txt'),'utf8'),'unstaged work');
  const log=await readFile(path.join(f.home,'development/OP-index/terminal.log'),'utf8');
  assert.ok(log.includes('git update-index'));assert.ok(!log.includes('git reset'));
});

test('status honors native global excludes without enabling unrelated global Git configuration',async t=>{
  const f=await fixture(t);await repository(f.repo);
  const taskHome=path.join(f.base,'user-home'),excludes=path.join(f.base,'global-ignore');await mkdir(taskHome);
  await writeFile(excludes,'editor-cache\n');
  await git.command(undefined,['config','--file',path.join(taskHome,'.gitconfig'),'core.excludesFile',excludes]);
  await writeFile(path.join(f.repo,'editor-cache'),'ignored artifact');
  const script=`import {createGit} from ${JSON.stringify(new URL('../../packages/git-core/index.mjs',import.meta.url).href)};console.log(JSON.stringify(await createGit({allowLocal:true}).inspect(process.argv[1])));`;
  const inspect=async()=>{
    const result=await execute(process.execPath,['--input-type=module','-e',script,f.repo],{env:processEnvironment({HOME:taskHome})});
    assert.equal(result.exitCode,0,result.stderr);return JSON.parse(result.stdout);
  };
  assert.equal((await inspect()).clean,true);
  await writeFile(path.join(f.repo,'readme.txt'),'genuine tracked edit');
  const changed=await inspect();assert.equal(changed.clean,false);assert.deepEqual(changed.changes.map(file=>file.path),['readme.txt']);
});
test('HEAD and content fingerprints prevent stale writes', async t => {
  const f = await fixture(t); await repository(f.repo); const initial = await git.inspect(f.repo);
  await writeFile(path.join(f.repo, 'readme.txt'), 'changed');
  await assert.rejects(git.commitSelected(f.repo, { paths: ['readme.txt'], message: 'stale' }, initial), { code: 'REPOSITORY_CHANGED' });
  await commitAll(f.repo);
  await assert.rejects(git.branch(f.repo, { name: 'new', create: true }, { head: initial.head }), { code: 'HEAD_MISMATCH' });
});
test('commit compare-and-swap rejects concurrent writers instead of losing a commit', async t => {
  const f = await fixture(t); await repository(f.repo); await writeFile(path.join(f.repo, 'readme.txt'), 'changed');
  const before = await git.inspect(f.repo);
  const results = await Promise.allSettled(['first', 'second'].map(message => git.commitSelected(f.repo, { paths: ['readme.txt'], message }, before)));
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal((await git.command(f.repo, ['rev-list', '--count', 'HEAD'])).stdout.trim(), '2');
});
test('a normal projects directory cannot impersonate a submodule', async t => {
  const f = await fixture(t); await repository(f.repo, { 'projects/product/a.txt': 'not a gitlink' });
  await assert.rejects(git.modules(f.repo), { code: 'INVALID_SUBMODULE' });
});
test('submodule add creates a true gitlink and restore uses the recorded commit, not remote main', async t => {
  const f = await fixture(t), product = path.join(f.base, 'product'); const pinned = await repository(product);
  await writeFile(path.join(product, 'readme.txt'), 'new main'); const newer = (await commitAll(product)).commit;
  await repository(f.repo);
  await git.addModule(f.repo, { projectId: 'product', url: product, commit: pinned }, await git.inspect(f.repo));
  await commitAll(f.repo);
  const module = (await git.modules(f.repo))[0]; assert.equal(module.commit, pinned); assert.equal(module.actual, pinned);
  assert.match((await git.command(f.repo, ['ls-tree', 'HEAD', '--', 'projects/product'])).stdout, /^160000 commit/);
  const child = path.join(f.repo, 'projects/product'); await git.command(child, ['checkout', '--detach', newer]);
  const restored = await git.restore(f.repo, await git.inspect(f.repo)); assert.equal(restored[0].actual, pinned);
  assert.equal((await git.inspect(child)).branch, null);
});
test('submodule dirty work is preserved and restore is refused', async t => {
  const f = await fixture(t), product = path.join(f.base, 'product'); const commit = await repository(product);
  await repository(f.repo); await git.addModule(f.repo, { projectId: 'product', url: product, commit }, await git.inspect(f.repo)); await commitAll(f.repo);
  const file = path.join(f.repo, 'projects/product/readme.txt'); await writeFile(file, 'uncommitted');
  await assert.rejects(git.restore(f.repo, await git.inspect(f.repo)), { code: 'DIRTY_SUBMODULE' });
  assert.equal(await readFile(file, 'utf8'), 'uncommitted');
});
test('an independent candidate clone does not share checkout or index state', async t => {
  const f = await fixture(t); const commit = await repository(f.repo); const candidate = path.join(f.base, 'candidate');
  await createGit().cloneCandidate(f.repo, candidate, commit);
  await writeFile(path.join(f.repo, 'readme.txt'), 'dirty developer draft');
  assert.equal(await readFile(path.join(candidate, 'readme.txt'), 'utf8'), 'initial\n'); assert.equal(await git.resolve(candidate), commit);
});
test('push sends only the explicit branch, verifies remote head and does not force', async t => {
  const f = await fixture(t); await repository(f.repo); await git.command(undefined, ['init', '--bare', '--initial-branch', 'main', f.remote]);
  await git.command(f.repo, ['remote', 'add', 'origin', f.remote]);
  const state = await git.inspect(f.repo), result = await git.push(f.repo, { branch: 'candidate' }, state);
  assert.equal(result.remoteCommit, state.head);
  assert.equal((await git.command(undefined, ['--git-dir', f.remote, 'show-ref', '--heads'])).stdout.trim().split(/\s/)[1], 'refs/heads/candidate');
});
