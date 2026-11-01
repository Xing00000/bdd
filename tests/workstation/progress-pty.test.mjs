import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { withProgress } from '../../packages/git-core/progress.mjs';
import { execute, processEnvironment, terminateSpawnedPty } from '../../packages/git-core/index.mjs';
import { readTerminal } from '../../packages/workstation/development.mjs';

test('spawn failure cleanup only escalates while the PTY remains live', t => {
  let exit, scheduled, cleared = false, closed = 0;
  const signals = [];
  const child = { pid: 123, onExit(callback) { exit = callback; }, kill(signal) { signals.push(signal); } };
  t.mock.method(process, 'kill', (_pid, signal) => { signals.push(signal); });
  t.mock.method(globalThis, 'setTimeout', callback => { scheduled = callback; return 42; });
  t.mock.method(globalThis, 'clearTimeout', handle => { if (handle === 42) cleared = true; });
  terminateSpawnedPty(child, () => closed++);
  assert.deepEqual(signals, ['SIGTERM']);
  exit();
  assert.equal(cleared, true);
  assert.equal(closed, 1);
  scheduled(); // A timer callback already queued before cancellation must also be harmless.
  assert.deepEqual(signals, ['SIGTERM']);
});

test('spawn failure cleanup escalates a live PTY and handles synchronous exit', t => {
  let exit, scheduled, closed = 0;
  const signals = [];
  const child = { pid: 123, onExit(callback) { exit = callback; }, kill(signal) { signals.push(signal); } };
  t.mock.method(process, 'kill', (_pid, signal) => { signals.push(signal); });
  t.mock.method(globalThis, 'setTimeout', callback => { scheduled = callback; return 42; });
  terminateSpawnedPty(child, () => closed++);
  scheduled();
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  exit();
  assert.equal(closed, 1);
  signals.length = 0; scheduled = undefined;
  child.onExit = callback => callback();
  terminateSpawnedPty(child, () => closed++);
  assert.equal(closed, 2);
  assert.deepEqual(signals, []);
  assert.equal(scheduled, undefined);
});

test('spawn failure cleanup does not schedule escalation when SIGTERM synchronously causes exit', t => {
  let exit, scheduled = false, closed = 0;
  const child = { pid: 123, onExit(callback) { exit = callback; }, kill() { exit(); } };
  t.mock.method(process, 'kill', () => exit());
  t.mock.method(globalThis, 'setTimeout', () => { scheduled = true; });
  terminateSpawnedPty(child, () => closed++);
  assert.equal(closed, 1);
  assert.equal(scheduled, false);
});

test('progress captures live TTY output, redacts credentials and preserves offsets', async t => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'progress-')); t.after(() => rm(home, { recursive: true, force: true }));
  await withProgress(home, 'OP-test', async () => {
    let first = false;
    const result = await execute(process.execPath, ['-e', "console.log('TTY:'+process.stdout.isTTY+' token=secret');setTimeout(()=>console.log('SECOND'),200)"], { env: processEnvironment(), onOutput: (_kind, text) => { if (text.includes('TTY:true')) first = true; } });
    assert.equal(result.exitCode, 0); assert.equal(first, true);
  });
  const first = await readTerminal(home, 'OP-test', 0); const rest = await readTerminal(home, 'OP-test', first.nextOffset);
  assert.match(first.output, /TTY:true/); assert.match(first.output, /token=\[redacted\]/); assert.doesNotMatch(first.output, /secret/); assert.match(first.output, /SECOND/); assert.equal(rest.output, '');
});
test('controlling PTY pipe relay preserves binary and NUL output', async t => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'progress-')); t.after(() => rm(home, { recursive: true, force: true }));
  await withProgress(home, 'OP-test', async () => {
    const result = await execute(process.execPath, ['-e', 'process.stdout.write(Buffer.from([0,255,10,13,65]))'], { env: processEnvironment(), binaryOutput: true });
    assert.equal(result.exitCode, 0); assert.deepEqual(result.stdout, Buffer.from([0,255,10,13,65]));
  });
  assert.match(await readFile(path.join(home, 'development/OP-test/terminal.log'), 'utf8'), /controlling-PTY pipe relay/);
});
test('progress bounds bytes, removes OSC across chunks and pages UTF-8 at byte boundaries', async t => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'progress-')); t.after(() => rm(home, { recursive: true, force: true }));
  const { currentProgress } = await import('../../packages/git-core/progress.mjs');
  await withProgress(home, 'OP-test', async () => {
    const progress = currentProgress();
    progress.output('\x1b]52;c;private\n'); progress.output('data\x07\n');
    for (let i = 0; i < 100; i++) progress.output('界'.repeat(16000) + '\n');
  });
  const bytes = await readFile(path.join(home, 'development/OP-test/terminal.log'));
  assert.ok(bytes.length <= 4 * 1024 * 1024); assert.doesNotMatch(bytes.toString(), /private|data/);
  let offset = 0, collected = '';
  do { const page = await readTerminal(home, 'OP-test', offset); collected += page.output; assert.ok(page.nextOffset > offset); offset = page.nextOffset; } while (offset < bytes.length);
  assert.equal(collected, bytes.toString('utf8')); assert.doesNotMatch(collected, /�/);
});
test('PTY timeout terminates the process group and records the outcome', async t => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'progress-')); t.after(() => rm(home, { recursive: true, force: true }));
  await withProgress(home, 'OP-test', async () => {
    const result = await execute(process.execPath, ['-e', 'setInterval(()=>{},100)'], { env: processEnvironment(), timeoutMs: 150 });
    assert.equal(result.timedOut, true); assert.ok(result.signal);
  });
  assert.match((await readTerminal(home, 'OP-test')).output, /timeout=true/);
});
test('Git machine output is identical with and without operation progress', async t => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'progress-')); t.after(() => rm(home, { recursive: true, force: true }));
  const env = processEnvironment({}, { git: true }), repo = path.join(home, 'repo');
  const init = await execute('git', ['init', repo], { env }); assert.equal(init.exitCode, 0);
  const { writeFile } = await import('node:fs/promises'); await writeFile(path.join(repo, 'untracked file'), 'content');
  const args = ['-C', repo, 'status', '--porcelain=v1', '-z'];
  const expected = await execute('git', args, { env, binaryOutput: true });
  const actual = await withProgress(home, 'OP-git', () => execute('git', args, { env, binaryOutput: true }));
  assert.equal(actual.exitCode, 0); assert.ok(actual.stdout.includes(0)); assert.deepEqual(actual.stdout, expected.stdout);
});

test('carriage-return progress is visible before completion and bounded output retains exit', async t => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'progress-')); t.after(() => rm(home, { recursive: true, force: true }));
  const { currentProgress } = await import('../../packages/git-core/progress.mjs');
  await withProgress(home, 'OP-live', async () => {
    const progress = currentProgress();
    progress.output('token=sec'); progress.output('ret\r');
    assert.match((await readTerminal(home, 'OP-live')).output, /token=\[redacted\]/);
    for (let i=0;i<100;i++) progress.output('x'.repeat(50000)+'\n');
    progress.record('[exit] code=17\r\n');
  });
  const bytes=await readFile(path.join(home,'development/OP-live/terminal.log'));
  assert.ok(bytes.length<=4*1024*1024);
  assert.match(bytes.toString(),/\[output truncated\]/);
  assert.match(bytes.toString(),/\[exit\] code=17/);
  assert.doesNotMatch(bytes.toString(),/secret/);
});

test('polling at the cap preserves offsets and exposes the later exit', async t => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'progress-')); t.after(() => rm(home, { recursive: true, force: true }));
  const { currentProgress } = await import('../../packages/git-core/progress.mjs');
  await withProgress(home, 'OP-cap', async () => {
    const progress = currentProgress();
    for (let i=0;i<100;i++) progress.output('界'.repeat(16000)+'\n');
    const before = await readFile(path.join(home, 'development/OP-cap/terminal.log'));
    let offset=0, page;
    do { page=await readTerminal(home,'OP-cap',offset); offset=page.nextOffset; } while(page.hasMore);
    progress.record('[exit] code=17\r\n'); progress.exit({exitCode:17,signal:null});
    const after=await readFile(path.join(home,'development/OP-cap/terminal.log'));
    assert.deepEqual(after.subarray(0,before.length),before);
    const final=await readTerminal(home,'OP-cap',offset);
    assert.equal(final.latestExit.exitCode,17); assert.ok(final.nextOffset>=offset);
    assert.doesNotMatch(after.toString('utf8'),/�/);
  });
});

test('concurrent Git metadata reads avoid progress relays while mutations retain them', async t => {
  const home=await mkdtemp(path.join(os.tmpdir(),'progress-git-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const {createGit}=await import('../../packages/git-core/index.mjs');
  const git=createGit({allowLocal:true}), repo=path.join(home,'repo');
  await withProgress(home,'OP-concurrent',async()=>{
    await git.init(repo);
    await Promise.all(Array.from({length:12},()=>git.inspect(repo)));
  });
  const log=await readFile(path.join(home,'development/OP-concurrent/terminal.log'),'utf8');
  assert.match(log,/controlling-PTY pipe relay.*git init/);
  assert.equal((log.match(/\[start /g)??[]).length,1);
});

test('concurrent supervised Git operations complete with metadata inspections', async t => {
  const home=await mkdtemp(path.join(os.tmpdir(),'progress-git-parallel-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const {createGit}=await import('../../packages/git-core/index.mjs');
  await Promise.all(Array.from({length:4},(_,i)=>withProgress(home,`OP-parallel-${i}`,async()=>{
    const git=createGit({allowLocal:true}),repo=path.join(home,`repo-${i}`);
    await git.init(repo);
    const states=await Promise.all(Array.from({length:4},()=>git.inspect(repo)));
    assert.ok(states.every(state=>state.head===null));
    assert.match(await readFile(path.join(home,`development/OP-parallel-${i}/terminal.log`),'utf8'),/controlling-PTY pipe relay.*git init/);
  })));
});
