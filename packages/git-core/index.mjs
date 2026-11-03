import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { currentProgress } from './progress.mjs';
import { mkdir, mkdtemp, readFile, realpath, rm, lstat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkstationError, invariant, id, relativePath, safePath, exists, digest, identity } from '../contracts/index.mjs';

const activeChildren = new Set();
/** Let Git own ignore semantics, including nested rules, negation and tracked files. */
async function sourceGit(root, operation, input) {
  let temporary;
  const env=processEnvironment({HOME:process.env.HOME}),prefix=['-c',`core.hooksPath=${os.devNull}`,'-c','core.fsmonitor=false'];
  try {
    let args=[...prefix,'-C',root];
    if(!await exists(path.join(root,'.git'))) {
      temporary=await mkdtemp(path.join(os.tmpdir(),'bdd-ignore-'));
      const initialized=await execute('git',[...prefix,'init','--bare','--quiet','--template=',temporary],{env,progress:false});
      invariant(initialized.exitCode===0&&!initialized.timedOut&&!initialized.overflow,'GIT_IGNORE_FAILED',initialized.stderr);
      args=[...prefix,`--git-dir=${temporary}`,`--work-tree=${root}`];
    }
    const result=await execute('git',[...args,...operation],{cwd:root,env,input,progress:false});
    invariant((operation[0]==='check-ignore'?[0,1]:[0]).includes(result.exitCode)&&!result.timedOut&&!result.overflow,'GIT_IGNORE_FAILED',result.stderr);
    return result;
  } finally {if(temporary)await rm(temporary,{recursive:true,force:true});}
}

export async function gitSourcePaths(root,paths) {
  if(!paths.length)return [];
  const result=await sourceGit(root,['check-ignore','--stdin','-z'],paths.join('\0')+'\0');
  const ignored=new Set(result.stdout.split('\0').filter(Boolean));return paths.filter(file=>!ignored.has(file));
}

/** Enumerate with Git before inspecting paths, so ignored trees are never traversed. */
export async function gitSourceFiles(root,folders) {
  const result=await sourceGit(root,['ls-files','--cached','--others','--exclude-standard','-z','--',...folders]);
  const files=[];
  for(const file of new Set(result.stdout.split('\0').filter(Boolean)))if(await exists(await safePath(root,file)))files.push(file);
  const group=file=>folders.findIndex(folder=>file===folder||file.startsWith(folder+'/'));
  return files.sort((a,b)=>{
    const difference=group(a)-group(b);if(difference)return difference;
    const left=a.split('/'),right=b.split('/');
    for(let i=0;i<Math.min(left.length,right.length);i++){const order=left[i].localeCompare(right[i]);if(order)return order;}
    return left.length-right.length;
  });
}

/** SQLite materializations are already accepted sources, including tracked ignored paths. */
export async function trackSourceView(root) {
  for(const args of [['init','--quiet','--template='],['add','--force','--all']]) {
    const result=await execute('git',['-c',`core.hooksPath=${os.devNull}`,'-c','core.fsmonitor=false','-C',root,...args],{env:processEnvironment({HOME:process.env.HOME},{git:true}),progress:false});
    invariant(result.exitCode===0&&!result.timedOut&&!result.overflow,'GIT_SOURCE_VIEW_FAILED',result.stderr);
  }
}
export function stopChildProcesses(signal = 'SIGTERM') {
  for (const child of activeChildren) { try { if (process.platform !== 'win32') process.kill(-child.pid, signal); else child.kill(signal); } catch {} }
}
export function terminateSpawnedPty(child, onExit = () => {}) {
  const kill = signal => { try { if (process.platform !== 'win32') process.kill(-child.pid, signal); else child.kill(signal); } catch {} };
  let exited = false, hardKill;
  child.onExit(() => { exited = true; clearTimeout(hardKill); onExit(); });
  if (exited) return;
  kill('SIGTERM');
  if (!exited) hardKill = setTimeout(() => { if (!exited) kill('SIGKILL'); }, 1000);
}
export function trackChild(child) { activeChildren.add(child); child.once('close', () => activeChildren.delete(child)); return child; }

const shaPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
export function commitId(value) { invariant(typeof value === 'string' && shaPattern.test(value), 'INVALID_COMMIT', 'Expected a full Git commit SHA'); return value; }
export function remoteName(value) {
  invariant(typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value), 'INVALID_REMOTE_NAME', 'Remote name must be a simple identifier');
  return value;
}
export function branchName(value) {
  invariant(typeof value === 'string' && value.length <= 180 && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)
    && !value.includes('..') && !value.includes('//') && !value.endsWith('/')
    && value.split('/').every(p => p && !p.startsWith('.') && !p.endsWith('.') && !p.endsWith('.lock')),
  'INVALID_BRANCH', 'Invalid branch name'); return value;
}
export function remoteUrl(value, { allowLocal = false, hosts = ['github.com'] } = {}) {
  invariant(typeof value === 'string' && value.length <= 2048 && !/[\x00-\x20\x7f]/.test(value), 'INVALID_REMOTE', 'Invalid Git remote');
  if (allowLocal && path.isAbsolute(value)) return value;
  let url;
  try { url = new URL(value.startsWith('git@') ? `ssh://${value.replace(':', '/')}` : value); }
  catch { throw new WorkstationError('INVALID_REMOTE', 'Use an HTTPS or git@host:path SSH repository URL'); }
  invariant(['https:', 'ssh:'].includes(url.protocol) && !url.password && !url.search && !url.hash && !url.port
    && (!url.username || (url.protocol === 'ssh:' && url.username === 'git'))
    && hosts.includes(url.hostname) && /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(url.pathname)
    && !url.pathname.split('/').includes('..'), 'REMOTE_NOT_ALLOWED', 'Remote host, credentials, protocol or path is not allowed', 403);
  return value;
}
export function processEnvironment(extra = {}, { git = false } = {}) {
  const temporary = {};
  // Keep the host's writable temporary location when sanitizing worker environments.
  // Execution-specific scratch directories in extra still take precedence.
  for (const key of ['TMPDIR', 'TMP', 'TEMP']) if (process.env[key]) temporary[key] = process.env[key];
  const env = { PATH: process.env.PATH, LANG: 'C.UTF-8', CI: 'true', ...temporary, ...extra };
  if (git) {
    for (const key of ['HOME', 'USERPROFILE', 'SSH_AUTH_SOCK', 'SYSTEMROOT']) if (process.env[key]) env[key] = process.env[key];
    Object.assign(env, { GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull,
      GIT_LITERAL_PATHSPECS: '1', GIT_OPTIONAL_LOCKS: '0' });
  }
  return env;
}
export async function execute(executable, args, { cwd, env = {}, timeoutMs = 180000, input, maxBytes = 8 * 1024 * 1024, onOutput, binaryOutput = false, progress = true } = {}) {
  invariant(typeof executable === 'string' && executable && Array.isArray(args) && args.every(v => typeof v === 'string' && !v.includes('\0')), 'INVALID_COMMAND', 'Invalid executable/arguments');
  if (progress && currentProgress()) return executePty(executable, args, { cwd, env, timeoutMs, input, maxBytes, onOutput, binaryOutput, supervised: binaryOutput || executable === 'git' });
  return new Promise((resolve, reject) => {
    const child = trackChild(spawn(executable, args, { cwd, env, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] }));
    let stdout = [], stderr = [], bytes = 0, timedOut = false, overflow = false, hardKill;
    const kill = signal => { try { if (process.platform !== 'win32') process.kill(-child.pid, signal); else child.kill(signal); } catch {} };
    const stop = () => { kill('SIGTERM'); hardKill = setTimeout(() => kill('SIGKILL'), 1000); hardKill.unref(); };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs); timer.unref();
    const capture = (kind, chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) { if (!overflow) { overflow = true; stop(); } return; }
      if (kind === 'stdout') stdout.push(chunk); else stderr.push(chunk);
      onOutput?.(kind, chunk.toString('utf8'));
    };
    child.stdout.on('data', chunk => capture('stdout', chunk)); child.stderr.on('data', chunk => capture('stderr', chunk));
    child.stdin.on('error', () => {}); child.stdin.end(input);
    child.once('error', error => { clearTimeout(timer); clearTimeout(hardKill); reject(error); });
    child.once('close', (exitCode, signal) => { clearTimeout(timer); clearTimeout(hardKill); resolve({ exitCode, signal, timedOut, overflow, stdout: binaryOutput ? Buffer.concat(stdout) : Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') }); });
  });
}
export function startProgressPty(executable, args, { cwd, env, onData, supervised = false, input, role = 'cli' } = {}) {
  let pty;
  try { pty = createRequire(import.meta.url)('node-pty'); }
  catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND' || !currentProgress()?.home) throw error;
    pty = createRequire(path.join(currentProgress().home, 'runtime', 'terminal', 'package.json'))('node-pty');
  }
  const config = { executable, args, cwd, env, input: input == null ? null : Buffer.from(input).toString('base64') };
  const command = supervised ? process.execPath : executable;
  const argv = supervised ? [fileURLToPath(new URL('./pty-supervisor.mjs', import.meta.url))] : args;
  const child = pty.spawn(command, argv, { cwd, env: supervised ? { ...env, WB_PTY_CONFIG: Buffer.from(JSON.stringify(config)).toString('base64') } : { ...env, TERM: 'xterm-256color' }, name: 'xterm-256color', cols: 100, rows: 30 });
  const tracked = new EventEmitter(); tracked.pid = child.pid; tracked.kill = signal => child.kill(signal); trackChild(tracked);
  const progress = currentProgress(); let commandId;
  try { progress?.record(`\r\n[start ${supervised ? 'controlling-PTY pipe relay' : 'PTY'}] ${executable}${executable === 'git' ? ' ' + (args.find(arg => ['clone','fetch','push','commit-tree','submodule','checkout','switch','add','merge','init','update-ref','read-tree','write-tree','update-index','remote','ls-remote'].includes(arg)) ?? 'command') : ''}\r\n`);
  commandId = progress?.startProcess(executable, role, child.pid); } catch (error) { terminateSpawnedPty(child, () => tracked.emit('close')); throw error; }
  let pending = '', result, timedOut = false;
  child.onData(data => {
    if (!supervised) { progress?.output(data); onData?.('stdout', Buffer.from(data)); return; }
    pending += data;
    let index;
    while ((index = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, index).trim(); pending = pending.slice(index + 1);
      if (!line) continue;
      const frame = JSON.parse(line);
      if (frame.kind === 'exit') result = frame.value;
      else if (frame.kind === 'error') progress?.record(`[spawn error] ${frame.value}\r\n`);
      else { const data = Buffer.from(frame.value, 'base64'); if (!data.includes(0)) progress?.output(data.toString('utf8')); onData?.(frame.kind, data); }
    }
  });
  const done = new Promise(resolve => child.onExit(({ exitCode, signal }) => { tracked.emit('close'); const outcome = supervised && result ? { exitCode: result.code, signal: result.signal } : { exitCode, signal }; progress?.record(`\r\n[exit] code=${outcome.exitCode} signal=${outcome.signal ?? 'none'}\r\n`); progress?.finishProcess(commandId, { ...outcome, timedOut }); progress?.exit(outcome); resolve(outcome); }));
  return { pid: child.pid, done, markTimedOut() { timedOut = true; }, stop(signal = 'SIGTERM') { try { if (process.platform !== 'win32') process.kill(-child.pid, signal); else child.kill(signal); } catch {} }, write(data) { child.write(data); } };
}
async function executePty(executable, args, options) {
  let stdout = [], stderr = [], bytes = 0, overflow = false, timedOut = false, hardKill;
  const child = startProgressPty(executable, args, { ...options, onData(kind, data) {
    bytes += data.length; if (bytes > options.maxBytes) { if (!overflow) { overflow = true; stop(); } return; }
    (kind === 'stderr' ? stderr : stdout).push(data); options.onOutput?.(kind, data.toString('utf8'));
  } });
  const stop = () => { child.stop(); hardKill = setTimeout(() => child.stop('SIGKILL'), 1000); hardKill.unref(); };
  const timer = setTimeout(() => { timedOut = true; child.markTimedOut(); stop(); }, options.timeoutMs); timer.unref();
  if (!options.supervised && options.input != null) child.write(String(options.input) + '\x04');
  const outcome = await child.done; clearTimeout(timer); clearTimeout(hardKill);
  if (timedOut || overflow) currentProgress()?.record(`[termination] timeout=${timedOut} overflow=${overflow}\r\n`);
  return { ...outcome, timedOut, overflow, stdout: options.binaryOutput ? Buffer.concat(stdout) : Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') };
}
export function createGit(policy = {}) {
  const settings = { allowLocal: false, hosts: ['github.com'], ...policy };
  async function command(repo, args, options = {}) {
    const readonly = new Set(['rev-parse', 'symbolic-ref', 'status', 'ls-files', 'cat-file', 'show', 'show-ref', 'diff', 'log', 'for-each-ref', 'ls-tree', 'merge-base']);
    let index=0;while(args[index]==='-c')index+=2;
    const operation=args.slice(index);
    const query = readonly.has(operation[0]) || (operation[0] === 'config' && operation.some(arg => ['--get', '--get-regexp', '--get-all', '--list', '-l'].includes(arg))) || (operation[0] === 'remote' && (operation.length === 1 || operation[1] === 'get-url'));
    const result = await execute('git', ['-c', `core.hooksPath=${os.devNull}`, '-c', 'core.fsmonitor=false',
      '-c', 'commit.gpgSign=false', '-c', 'protocol.ext.allow=never', '-c', `protocol.file.allow=${settings.allowLocal ? 'always' : 'never'}`,
      '-c', 'submodule.recurse=false', '-c', 'user.name=BDD Workstation', '-c', 'user.email=workstation@localhost',
      ...(repo ? ['-C', repo] : []), ...args], { ...options, progress: !query, cwd: repo, env: processEnvironment(options.env, { git: true }) });
    if (!options.allowFailure && (result.exitCode !== 0 || result.timedOut || result.overflow))
      throw new WorkstationError(result.timedOut ? 'GIT_TIMEOUT' : result.overflow ? 'GIT_OUTPUT_LIMIT' : 'GIT_COMMAND_FAILED',
        result.stderr.trim() || `Git exited ${result.exitCode}`, 422, { exitCode: result.exitCode, signal: result.signal });
    return result;
  }
  async function root(directory) {
    const canonical = await realpath(directory);
    const top = (await command(canonical, ['rev-parse', '--show-toplevel'])).stdout.trim();
    invariant(await realpath(top) === canonical, 'NOT_REPOSITORY_ROOT', 'Expected repository root');
    return canonical;
  }
  async function resolve(directory, ref = 'HEAD') {
    invariant(typeof ref === 'string' && ref.length <= 240 && !/[\x00-\x20]/.test(ref), 'INVALID_REF', 'Invalid revision');
    return commitId((await command(directory, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])).stdout.trim());
  }
  async function nativeStatus(directory) {
    // Preserve Git's effective excludes without enabling unrelated global config.
    const excludes=await execute('git',['-C',directory,'config','--path','--get','core.excludesFile'],{env:processEnvironment({HOME:process.env.HOME}),progress:false});
    invariant([0,1].includes(excludes.exitCode)&&!excludes.timedOut&&!excludes.overflow,'GIT_IGNORE_FAILED',excludes.stderr);
    return command(directory,[...(excludes.exitCode===0?['-c',`core.excludesFile=${excludes.stdout.trim()}`]:[]),'status','--porcelain=v1','-z','--untracked-files=all']);
  }
  async function inspect(directory) {
    const repo = await root(directory);
    const resolved = await command(repo, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true });
    const branch = (await command(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true })).stdout.trim() || null;
    const status = (await nativeStatus(repo)).stdout.split('\0');
    const changes = [];
    for (let i = 0; i < status.length; i++) {
      if (!status[i]) continue;
      const code = status[i].slice(0, 2), file = status[i].slice(3);
      const change = { code, path: file };
      if (code.includes('R') || code.includes('C')) change.originalPath = status[++i];
      changes.push(change);
    }
    const hashes = [];
    for (const change of changes) {
      const file = await safePath(repo, change.path);
      if (await exists(file)) {
        const info = await lstat(file);
        if (info.isFile()) hashes.push([change.path, digest(await readFile(file))]);
        else if (await exists(path.join(file, '.git'))) {
          hashes.push([change.path, (await command(file, ['rev-parse', 'HEAD'])).stdout.trim(), (await nativeStatus(file)).stdout]);
        } else hashes.push([change.path, 'directory']);
      } else hashes.push([change.path, 'deleted']);
    }
    const head = resolved.exitCode === 0 ? commitId(resolved.stdout.trim()) : null;
    return { head, branch, changes, clean: changes.length === 0, fingerprint: identity({ head, branch, changes, hashes }) };
  }
  async function expect(directory, expected, { clean = false, attached = false } = {}) {
    invariant(expected && Object.hasOwn(expected, 'head'), 'EXPECTED_HEAD_REQUIRED', 'Supply the inspected expected.head (null for unborn HEAD)', 400);
    const state = await inspect(directory);
    invariant(state.head === expected.head && (expected.branch === undefined || state.branch === expected.branch), 'HEAD_MISMATCH', 'Repository changed; inspect and retry', 409);
    if (expected.fingerprint) invariant(state.fingerprint === expected.fingerprint, 'REPOSITORY_CHANGED', 'Files changed since preview', 409);
    if (clean) invariant(state.clean, 'DIRTY_WORKSPACE', '目前還有其他未儲存的內容，系統已保留草稿；請先在工作台儲存相關檔案，再重試這項操作。', 409);
    if (attached) invariant(state.branch, 'DETACHED_HEAD', 'Create a development branch before committing', 409);
    return state;
  }
  async function modules(directory) {
    const repo = await root(directory);
    if (!await exists(path.join(repo, '.gitmodules'))) {
      invariant(!(await command(repo, ['ls-files', '-z', '--', 'projects'])).stdout, 'INVALID_SUBMODULE', 'projects/ contains files without declared gitlinks');
      return [];
    }
    await safePath(repo, '.gitmodules', { missing: false });
    const config = await command(repo, ['config', '--null', '--file', '.gitmodules', '--get-regexp', '^submodule\\..*\\.path$'], { allowFailure: true });
    invariant([0, 1].includes(config.exitCode), 'INVALID_SUBMODULE', 'Invalid .gitmodules');
    const result = [];
    for (const entry of config.stdout.split('\0').filter(Boolean)) {
      const split = entry.indexOf('\n');
      invariant(split > 0, 'INVALID_SUBMODULE', 'Invalid submodule entry');
      const key = entry.slice(0, split), relative = relativePath(entry.slice(split + 1));
      invariant(/^projects\/[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(relative), 'INVALID_SUBMODULE', 'Top-level submodules must be projects/<id>');
      const url = (await command(repo, ['config', '--file', '.gitmodules', '--get', key.replace(/\.path$/, '.url')])).stdout.trim();
      remoteUrl(url, settings);
      const indexed = (await command(repo, ['ls-files', '--stage', '-z', '--', relative])).stdout;
      const match = /^160000 ([a-f0-9]{40,64}) 0\t/.exec(indexed);
      invariant(match, 'INVALID_SUBMODULE', `${relative} is not a staged gitlink`);
      const target = await safePath(repo, relative);
      let actual = null, dirty = null;
      if (await exists(path.join(target, '.git'))) { const state = await inspect(target); actual = state.head; dirty = !state.clean; }
      result.push({ id: relative.slice(9), path: relative, url, commit: commitId(match[1]), actual, dirty });
    }
    invariant(new Set(result.map(x => x.path)).size === result.length, 'INVALID_SUBMODULE', 'Duplicate submodule paths');
    const indexed = (await command(repo, ['ls-files', '--stage', '-z', '--', 'projects'])).stdout.split('\0').filter(Boolean);
    invariant(indexed.every(row => row.startsWith('160000 ') && result.some(x => row.endsWith(`\t${x.path}`))), 'INVALID_SUBMODULE', 'projects/ may only contain declared gitlinks');
    return result;
  }
  async function restore(directory, expected) {
    const state = await expect(directory, expected);
    const list = await modules(directory);
    invariant(state.changes.every(c => c.code === ' M' && list.some(m => m.path === c.path)), 'DIRTY_WORKSPACE', 'Preserve non-submodule changes before restore', 409);
    invariant(list.every(x => !x.dirty), 'DIRTY_SUBMODULE', 'Preserve submodule changes before restore', 409);
    for (const item of list) {
      await command(directory, ['submodule', 'sync', '--', item.path]);
      await command(directory, ['submodule', 'update', '--init', '--checkout', '--', item.path]);
      const target = await safePath(directory, item.path);
      invariant(await resolve(target) === item.commit, 'SUBMODULE_VERSION_MISMATCH', item.path);
      // Nested repository graphs need their own policy validation; never recurse blindly.
      invariant(!await exists(path.join(target, '.gitmodules')), 'NESTED_SUBMODULE_UNSUPPORTED', 'v1 rejects nested submodules instead of downloading unvalidated remotes');
    }
    return modules(directory);
  }
  async function remotes(directory) {
    const names = (await command(directory, ['remote'])).stdout.trim().split('\n').filter(Boolean);
    const result = [];
    for (const name of names) {
      remoteName(name);
      const urls = (await command(directory, ['remote', 'get-url', '--all', name])).stdout.trim().split('\n');
      const pushUrls = (await command(directory, ['remote', 'get-url', '--push', '--all', name])).stdout.trim().split('\n');
      result.push({ name, url: urls[0], pushUrl: pushUrls[0], urls, pushUrls });
    }
    return result;
  }
  async function selectedRemote(directory, name, push = false) {
    const item = (await remotes(directory)).find(x => x.name === remoteName(name));
    invariant(item, 'REMOTE_NOT_FOUND', 'Select an existing Git remote');
    invariant(item.urls.length === 1 && item.pushUrls.length === 1, 'MULTIPLE_REMOTE_URLS_UNSUPPORTED', 'Multiple URLs per remote require explicit manual review');
    remoteUrl(push ? item.pushUrl : item.url, settings);
    return item;
  }
  return {
    async remoteHead(url, ref = 'main') {
      remoteUrl(url, settings); branchName(ref);
      const output = (await command(undefined, ['ls-remote', '--exit-code', '--heads', url, `refs/heads/${ref}`])).stdout.trim();
      invariant(output.split('\n').length === 1 && output.endsWith(`\trefs/heads/${ref}`), 'REMOTE_BRANCH_NOT_FOUND', 'Selected branch does not resolve uniquely');
      return commitId(output.split('\t')[0]);
    },
    remotes,
    async configureRemote(directory, input, expected) {
      await expect(directory, expected); const name = remoteName(input.name);
      const previous = (await remotes(directory)).find(x => x.name === name);
      invariant(['add', 'update', 'remove'].includes(input.action), 'INVALID_REMOTE_ACTION', 'Choose add, update or remove');
      if (input.action === 'add') invariant(!previous, 'REMOTE_EXISTS', name, 409);
      else {
        invariant(previous && identity(previous) === identity(input.previous), 'REMOTE_CHANGED', 'Remote configuration changed since inspection', 409);
        invariant(!(input.action === 'remove' && name === 'origin'), 'ORIGIN_REQUIRED', 'origin is the repository binding; edit its URL rather than removing it');
      }
      if (input.action === 'remove') await command(directory, ['remote', 'remove', name]);
      else {
        remoteUrl(input.url, settings); remoteUrl(input.pushUrl ?? input.url, settings);
        await command(directory, input.action === 'add' ? ['remote', 'add', name, input.url] : ['remote', 'set-url', name, input.url]);
        await command(directory, ['remote', 'set-url', '--push', name, input.pushUrl ?? input.url]);
      }
      return remotes(directory);
    },
    command, root, resolve, inspect, expect, modules, restore, policy: settings,
    async blob(directory, sha, maxBytes = 32 * 1024 * 1024) { return (await command(directory, ['cat-file', 'blob', commitId(sha)], { binaryOutput: true, maxBytes })).stdout; },
    async init(directory, branch = 'main') { branchName(branch); await mkdir(directory, { recursive: true }); await command(directory, ['init', '--initial-branch', branch]); return inspect(directory); },
    async clone(url, directory, branch) {
      remoteUrl(url, settings); if (branch) branchName(branch);
      invariant(!await exists(directory), 'DESTINATION_EXISTS', 'Clone destination already exists', 409);
      await mkdir(path.dirname(directory), { recursive: true, mode: 0o700 });
      await command(undefined, ['clone', '--no-hardlinks', '--no-recurse-submodules', ...(branch ? ['--branch', branch] : []), '--', url, directory]);
      return inspect(directory);
    },
    async cloneCandidate(source, directory, commit) {
      await root(source); commitId(commit); invariant(!await exists(directory), 'DESTINATION_EXISTS', 'Execution directory already exists', 409);
      await mkdir(path.dirname(directory), { recursive: true });
      // This local source is resolved from the registry, never from an untrusted URL.
      await command(undefined, ['-c', 'protocol.file.allow=always', 'clone', '--no-local', '--no-hardlinks', '--no-checkout', '--no-recurse-submodules', '--', source, directory]);
      // A fetched remote branch may not be reachable from source's local branches.
      // Fetch the already-validated immutable SHA, rather than assuming clone advertised it.
      invariant(await resolve(source, commit) === commit, 'CANDIDATE_VERSION_MISSING', 'Selected source version is not available');
      await command(directory, ['-c', 'protocol.file.allow=always', 'fetch', '--no-tags', '--no-recurse-submodules', '--', source, commit]);
      await command(directory, ['checkout', '--detach', commit]);
      invariant(await resolve(directory) === commit, 'HEAD_MISMATCH', 'Candidate clone mismatch');
      return inspect(directory);
    },
    async fetch(directory, input = {}) {
      const name = input.remote ?? 'origin'; await selectedRemote(directory, name);
      await command(directory, ['fetch', '--no-recurse-submodules', name]); return inspect(directory);
    },
    async branch(directory, input, expected) {
      branchName(input.name); await expect(directory, expected, { clean: true });
      await command(directory, ['switch', ...(input.create ? ['-c'] : []), input.name]); return inspect(directory);
    },
    async diff(directory) {
      const unstaged = await command(directory, ['diff', '--no-ext-diff', '--no-textconv']);
      const staged = await command(directory, ['diff', '--cached', '--no-ext-diff', '--no-textconv']);
      return { staged: staged.stdout, unstaged: unstaged.stdout, state: await inspect(directory) };
    },
    async commitSelected(directory, input, expected) {
      const before = await expect(directory, expected, { attached: true });
      invariant(Array.isArray(input.paths) && input.paths.length && new Set(input.paths).size === input.paths.length, 'INVALID_PATHS', 'Select distinct files');
      invariant(typeof input.message === 'string' && input.message.trim() && input.message.length <= 2000 && !input.message.includes('\0'), 'INVALID_MESSAGE', 'Commit message is required');
      for (const file of input.paths) {
        const destination = await safePath(directory, relativePath(file));
        if (await exists(destination) && (await lstat(destination)).isDirectory())
          invariant((await modules(directory)).some(x => x.path === file), 'EXPLICIT_FILES_REQUIRED', 'Select files or exact submodule paths, not folders');
      }
      const temporary = await mkdtemp(path.join(os.tmpdir(), 'bdd-index-'));
      const env = { GIT_INDEX_FILE: path.join(temporary, 'index') };
      try {
        await command(directory, before.head ? ['read-tree', before.head] : ['read-tree', '--empty'], { env });
        await command(directory, ['add', '--all', '--', ...input.paths], { env });
        const tree = (await command(directory, ['write-tree'], { env })).stdout.trim();
        if (before.head && tree === (await command(directory, ['rev-parse', `${before.head}^{tree}`])).stdout.trim()) return { ...before, noChanges: true };
        const sha = (await command(directory, ['commit-tree', tree, ...(before.head ? ['-p', before.head] : []), '-F', '-'], { env, input: input.message })).stdout.trim();
        await expect(directory, expected, { attached: true });
        // Compare-and-swap: never attach the commit to a concurrently changed branch.
        await command(directory, ['update-ref', `refs/heads/${before.branch}`, sha, before.head ?? '0'.repeat(sha.length)]);
        const entries=(await command(directory,['ls-files','--stage','-z','--',...input.paths],{env})).stdout;
        const removals=input.paths.map(file=>`0 ${'0'.repeat(sha.length)}\t${file}\0`).join('');
        const refreshed = await command(directory, ['update-index', '-z', '--index-info'], { input:removals+entries,allowFailure: true });
        return { ...(await inspect(directory)), commit: sha, changedPaths: input.paths, ...(refreshed.exitCode !== 0 ? { warning: 'COMMITTED_INDEX_REFRESH_REQUIRED' } : {}) };
      } finally { await rm(temporary, { recursive: true, force: true }); }
    },
    async push(directory, input, expected) {
      const state = await expect(directory, expected, { attached: true });
      const branch = branchName(input.branch ?? state.branch);
      const name = input.remote ?? 'origin', remote = await selectedRemote(directory, name, true);
      await command(directory, ['push', '--porcelain', '--recurse-submodules=check', name, `HEAD:refs/heads/${branch}`]);
      const remoteCommit = (await command(directory, ['ls-remote', '--heads', remote.pushUrl, `refs/heads/${branch}`])).stdout.split(/\s/)[0];
      invariant(remoteCommit === state.head, 'REMOTE_VERIFY_FAILED', 'Push returned but remote head does not match');
      return { localCommit: state.head, remoteCommit, branch, remote: name, remoteUrl: remote.pushUrl };
    },
    async addModule(directory, input, expected) {
      id(input.projectId, 'projectId'); remoteUrl(input.url, settings); commitId(input.commit);
      const current = await expect(directory, expected, { attached: true });
      const relative = `projects/${input.projectId}`;
      // Submodule registration changes only .gitmodules and this exact path.
      // Unrelated local edits and staged files are not a reason to block setup.
      invariant(!current.changes.some(change => change.path === '.gitmodules' || change.path === relative || change.path.startsWith(relative + '/')),
        'SUBMODULE_SETTINGS_CONFLICT', '產品連結設定有尚未儲存的修改。系統已保留內容；請先儲存後再加入產品。', 409);
      invariant(!await exists(await safePath(directory, relative)), 'DESTINATION_EXISTS', relative, 409);
      await command(directory, ['submodule', 'add', '--name', input.projectId, '--', input.url, relative]);
      const target = await safePath(directory, relative);
      await command(target, ['checkout', '--detach', await resolve(target, input.commit)]);
      invariant(!await exists(path.join(target, '.gitmodules')), 'NESTED_SUBMODULE_UNSUPPORTED', 'Nested submodules are not supported by v1');
      await command(directory, ['add', '--', '.gitmodules', relative]);
      return modules(directory);
    },
    async pin(directory, input, expected) {
      id(input.projectId); commitId(input.commit); await expect(directory, expected);
      const item = (await modules(directory)).find(x => x.id === input.projectId);
      invariant(item && item.actual, 'SUBMODULE_NOT_INITIALIZED', 'Initialize the selected submodule');
      const target = await safePath(directory, item.path);
      invariant((await inspect(target)).clean, 'DIRTY_SUBMODULE', 'Preserve project changes before pinning', 409);
      await command(target, ['checkout', '--detach', await resolve(target, input.commit)]);
      await command(directory, ['add', '--', item.path]); return modules(directory);
    }
  };
}
