import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gitSourceFiles, gitSourcePaths, trackSourceView } from '../../packages/git-core/source-files.mjs';

const execute = promisify(childProcess.execFile);
const processMethods = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'];
const sorted = values => [...new Set(values)].sort();

async function fixture(t, { git = true } = {}) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'bdd-source-selection-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'workspace'), qaHome = path.join(base, 'home');
  await Promise.all([root, qaHome].map(directory => mkdir(directory)));
  const globalConfig = path.join(base, 'global.config'), globalIgnore = path.join(base, 'global.ignore');
  await writeFile(globalConfig, ''); await writeFile(globalIgnore, '');
  const env = { ...process.env, HOME: qaHome, USERPROFILE: qaHome, XDG_CONFIG_HOME: path.join(qaHome, '.config'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: globalConfig };
  const command = async args => (await execute('git', args, { cwd: root, env, maxBuffer: 8 * 1024 * 1024 })).stdout;
  if (git) {
    await command(['init', '--quiet']);
    await command(['config', 'core.excludesFile', globalIgnore]);
    await command(['config', 'core.ignoreCase', 'false']);
  }
  const put = async (relative, content = `${relative}\n`) => {
    const absolute = path.join(root, relative);
    await mkdir(path.dirname(absolute), { recursive: true }); await writeFile(absolute, content);
  };
  const oracle = async () => sorted((await command(['ls-files', '--cached', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean));
  return { base, root, env, globalIgnore, command, put, oracle };
}

async function withoutSubprocesses(t, action) {
  const mocks = processMethods.map(method => t.mock.method(childProcess, method, () => {
    assert.fail(`Source selection must not start child_process.${method}`);
  }));
  syncBuiltinESMExports();
  try { return await action(); }
  finally { for (const mock of mocks) mock.mock.restore(); syncBuiltinESMExports(); }
}

test('filesystem source selection agrees with Git for nested ignores, negation, local excludes and tracked ignored sources', async t => {
  const f = await fixture(t);
  const inputs = {
    '.gitignore': '*.secret\n*.tmp\nignored-tree/\n!ignored-tree/revived.ts\nnested/*.root\n',
    'nested/.gitignore': 'scratch/**\n!scratch/keep.ts\n!keep.root\n!overridden.tmp\n!keep.global\n',
    'nested/deep/.gitignore': '*.txt\n!keep.txt\n!allowed.tmp\n',
    'tracked.ts': 'tracked\n',
    'tracked.secret': 'forced tracked source\n',
    'ignored-tree/tracked.ts': 'tracked source under ignored parent\n',
    'ignored-tree/revived.ts': 'a negation cannot reopen an excluded parent\n',
    'ignored-tree/artifact.bin': Buffer.from([0, 255]),
    'untracked.ts': 'source\n',
    'root.tmp': 'ignored\n',
    'root.secret': 'ignored\n',
    'root.global': 'ignored globally\n',
    'local-only.txt': 'local exclude\n',
    'nested/local-excluded.ts': 'local exclude\n',
    'nested/overridden.tmp': 'nested override\n',
    'nested/keep.global': 'nested override of global ignore\n',
    'nested/keep.root': 'nested override of parent ignore\n',
    'nested/drop.root': 'ignored by parent\n',
    'nested/scratch/keep.ts': 'negated nested pattern\n',
    'nested/scratch/drop.ts': 'ignored\n',
    'nested/deep/allowed.tmp': 'nested override of root ignore\n',
    'nested/deep/drop.txt': 'ignored in deepest directory\n',
    'nested/deep/keep.txt': 'deepest negation\n',
    'nested/deep/allowed.root': 'parent anchored pattern does not match\n',
  };
  for (const [relative, content] of Object.entries(inputs)) await f.put(relative, content);
  await writeFile(f.globalIgnore, '*.global\n');
  await writeFile(path.join(f.root, '.git/info/exclude'), '/local-only.txt\n/nested/local-excluded.ts\n/nested/overridden.tmp\n');
  await f.command(['add', '--force', '--', 'tracked.ts', 'tracked.secret', 'ignored-tree/tracked.ts']);
  const expected = await f.oracle();
  assert(expected.includes('tracked.secret')); assert(expected.includes('ignored-tree/tracked.ts'));
  assert(expected.includes('nested/scratch/keep.ts')); assert(expected.includes('nested/deep/allowed.tmp'));
  assert(!expected.includes('ignored-tree/revived.ts')); assert(!expected.includes('nested/local-excluded.ts'));
  await withoutSubprocesses(t, async () => {
    assert.deepEqual(sorted(await gitSourceFiles(f.root)), expected);
    assert.deepEqual(sorted(await gitSourcePaths(f.root, Object.keys(inputs))), expected);
    assert.deepEqual(sorted(await gitSourceFiles(f.root, ['nested'])), expected.filter(file => file.startsWith('nested/')));
  });
});

test('filesystem source selection reads a version 4 index with long and Unicode compressed paths', async t => {
  const f = await fixture(t);
  const longDirectory = `a-${'prefix-'.repeat(25)}`;
  const tracked = ['.gitignore', `${longDirectory}/01-source.ignored`, `${longDirectory}/02-source.ignored`, 'b.ignored', '中文/來源.ignored'];
  await f.put('.gitignore', '*.ignored\n');
  for (const relative of tracked.slice(1)) await f.put(relative);
  await f.command(['add', '--force', '--', ...tracked]);
  await f.command(['update-index', '--index-version', '4']);
  assert.equal((await readFile(path.join(f.root, '.git/index'))).readUInt32BE(4), 4);
  await f.put('untracked.ts'); await f.put('untracked.ignored');
  const expected = await f.oracle();
  await withoutSubprocesses(t, async () => {
    assert.deepEqual(sorted(await gitSourceFiles(f.root)), expected);
    assert.deepEqual(sorted(await gitSourcePaths(f.root, [...tracked, 'untracked.ts', 'untracked.ignored'])), expected);
  });
});

test('filesystem source selection reconstructs split indexes after replacements, deletions and additions', async t => {
  const f = await fixture(t);
  await f.put('.gitignore', '*.ignored\n');
  const tracked = Array.from({ length: 140 }, (_, index) => `sources/${String(index).padStart(3, '0')}.ignored`);
  for (const relative of tracked) await f.put(relative);
  await f.command(['add', '--force', '--', '.gitignore', ...tracked]);
  await f.command(['config', 'splitIndex.maxPercentChange', '100']);
  await f.command(['update-index', '--index-version', '4']);
  await f.command(['update-index', '--split-index']);
  for (const index of [1, 70, 130]) await f.put(tracked[index], `replacement ${index}\n`);
  await f.command(['add', '--force', '--', tracked[1], tracked[70], tracked[130]]);
  // Keep deleted paths on disk. Their ignore rule must win once the index no
  // longer tracks them, so a broken delete bitmap cannot pass this test.
  await f.command(['update-index', '--force-remove', '--', tracked[4], tracked[100]]);
  await f.put('added.ignored'); await f.command(['add', '--force', '--', 'added.ignored']);
  await f.put('untracked.ts'); await f.put('untracked.ignored');
  assert((await readdir(path.join(f.root, '.git'))).some(file => file.startsWith('sharedindex.')));
  assert.equal((await readFile(path.join(f.root, '.git/index'))).readUInt32BE(4), 4);
  const expected = await f.oracle();
  assert(!expected.includes(tracked[4])); assert(!expected.includes(tracked[100])); assert(expected.includes('added.ignored'));
  await withoutSubprocesses(t, async () => {
    assert.deepEqual(sorted(await gitSourceFiles(f.root)), expected);
    assert.deepEqual(sorted(await gitSourcePaths(f.root, ['.gitignore', ...tracked, 'added.ignored', 'untracked.ts', 'untracked.ignored'])), expected);
  });
});

test('accepted source markers preserve ignored snapshot files in a fresh process without Git', async t => {
  const f = await fixture(t, { git: false });
  await f.put('.gitignore', '*.saved\nignored-tree/\n');
  await f.put('draft.saved'); await f.put('ignored-tree/accepted.ts');
  await f.put('discarded.saved'); await f.put('visible.ts');
  const accepted = ['.gitignore', 'draft.saved', 'ignored-tree/accepted.ts', 'draft.saved'];
  await withoutSubprocesses(t, () => trackSourceView(f.root, accepted));
  const marker = JSON.parse(await readFile(path.join(f.root, '.runtime/source-view.json'), 'utf8'));
  assert.deepEqual(marker, { schemaVersion: 1, files: sorted(accepted) });
  const script = `
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    for (const method of ${JSON.stringify(processMethods)}) childProcess[method] = () => { throw Error('Unexpected subprocess: ' + method); };
    syncBuiltinESMExports();
    const { gitSourceFiles } = await import(process.argv[1]);
    process.stdout.write(JSON.stringify(await gitSourceFiles(process.argv[2])));
  `;
  const result = await execute(process.execPath, ['--input-type=module', '--eval', script, new URL('../../packages/git-core/source-files.mjs', import.meta.url).href, f.root], { cwd: f.root, env: f.env });
  assert.deepEqual(sorted(JSON.parse(result.stdout)), ['.gitignore', 'draft.saved', 'ignored-tree/accepted.ts', 'visible.ts']);
  assert(!(await readdir(f.root)).includes('.git'), 'Source markers never initialize a repository');
});

test('source walking skips ignored and excluded trees and rejects included symbolic links', async t => {
  const f = await fixture(t);
  await f.put('.gitignore', 'cache/\n');
  await f.put('src/main.ts'); await f.put('vendor/tracked.ts'); await f.put('nested/vendor/unused.ts');
  await f.command(['add', '--', '.gitignore', 'src/main.ts', 'vendor/tracked.ts']);
  const outside = path.join(f.base, 'outside'); await mkdir(outside); await writeFile(path.join(outside, 'secret.txt'), 'outside source root\n');
  await mkdir(path.join(f.root, 'cache'));
  await symlink(outside, path.join(f.root, 'cache/ignored-link'), 'dir');
  await symlink(outside, path.join(f.root, 'vendor/excluded-link'), 'dir');
  await withoutSubprocesses(t, async () => {
    assert.deepEqual(sorted(await gitSourceFiles(f.root, [], { excludeDirectories: ['vendor'] })), ['.gitignore', 'src/main.ts']);
    assert.deepEqual(await gitSourceFiles(f.root, ['src'], { excludeDirectories: ['vendor'] }), ['src/main.ts']);
    assert.deepEqual(await gitSourcePaths(f.root, ['vendor/tracked.ts', 'nested/vendor/unused.ts', 'src/main.ts'], { excludeDirectories: ['vendor'] }), ['src/main.ts']);
  });
  await symlink(path.join(f.root, 'src/main.ts'), path.join(f.root, 'src/included-link.ts'));
  await withoutSubprocesses(t, () => assert.rejects(gitSourceFiles(f.root, ['src']), { code: 'SYMLINK_FORBIDDEN' }));
  await rm(path.join(f.root, 'src/included-link.ts'));
  await symlink(outside, path.join(f.root, 'src/included-directory'), 'dir');
  await withoutSubprocesses(t, () => assert.rejects(gitSourceFiles(f.root, ['src']), { code: 'SYMLINK_FORBIDDEN' }));
});
