import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, lstat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkstationError, invariant, id, relativePath, safePath, exists, digest, identity } from '../contracts/index.mjs';

const activeChildren = new Set();
export function stopChildProcesses(signal = 'SIGTERM') {
  for (const child of activeChildren) { try { if (process.platform !== 'win32') process.kill(-child.pid, signal); else child.kill(signal); } catch {} }
}
export function trackChild(child) { activeChildren.add(child); child.once('close', () => activeChildren.delete(child)); return child; }

const shaPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
export function commitId(value) { invariant(typeof value === 'string' && shaPattern.test(value), 'INVALID_COMMIT', 'Expected a full Git commit SHA'); return value; }
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
  const env = { PATH: process.env.PATH, LANG: 'C.UTF-8', CI: 'true', ...extra };
  if (git) {
    for (const key of ['HOME', 'USERPROFILE', 'SSH_AUTH_SOCK', 'SYSTEMROOT']) if (process.env[key]) env[key] = process.env[key];
    Object.assign(env, { GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull,
      GIT_LITERAL_PATHSPECS: '1', GIT_OPTIONAL_LOCKS: '0' });
  }
  return env;
}
export async function execute(executable, args, { cwd, env = {}, timeoutMs = 180000, input, maxBytes = 8 * 1024 * 1024, onOutput, binaryOutput = false } = {}) {
  invariant(typeof executable === 'string' && executable && Array.isArray(args) && args.every(v => typeof v === 'string' && !v.includes('\0')), 'INVALID_COMMAND', 'Invalid executable/arguments');
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
export function createGit(policy = {}) {
  const settings = { allowLocal: false, hosts: ['github.com'], ...policy };
  async function command(repo, args, options = {}) {
    const result = await execute('git', ['-c', `core.hooksPath=${os.devNull}`, '-c', 'core.fsmonitor=false',
      '-c', 'commit.gpgSign=false', '-c', 'protocol.ext.allow=never', '-c', `protocol.file.allow=${settings.allowLocal ? 'always' : 'never'}`,
      '-c', 'submodule.recurse=false', '-c', 'user.name=BDD Workstation', '-c', 'user.email=workstation@localhost',
      ...(repo ? ['-C', repo] : []), ...args], { ...options, cwd: repo, env: processEnvironment(options.env, { git: true }) });
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
  async function inspect(directory) {
    const repo = await root(directory);
    const resolved = await command(repo, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true });
    const branch = (await command(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true })).stdout.trim() || null;
    const status = (await command(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).stdout.split('\0');
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
          hashes.push([change.path, (await command(file, ['rev-parse', 'HEAD'])).stdout.trim(), (await command(file, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).stdout]);
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
    if (expected.fingerprint) invariant(state.fingerprint === expected.fingerprint, 'WORKSPACE_CHANGED', 'Files changed since preview', 409);
    if (clean) invariant(state.clean, 'DIRTY_WORKSPACE', 'Commit or preserve changes before this operation', 409);
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
  return {
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
      await command(directory, ['checkout', '--detach', commit]);
      invariant(await resolve(directory) === commit, 'HEAD_MISMATCH', 'Candidate clone mismatch');
      return inspect(directory);
    },
    async fetch(directory) {
      const url = (await command(directory, ['remote', 'get-url', 'origin'])).stdout.trim(); remoteUrl(url, settings);
      await command(directory, ['fetch', '--no-recurse-submodules', 'origin']); return inspect(directory);
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
        const refreshed = await command(directory, ['reset', '--quiet', 'HEAD', '--', ...input.paths], { allowFailure: true });
        return { ...(await inspect(directory)), commit: sha, changedPaths: input.paths, ...(refreshed.exitCode !== 0 ? { warning: 'COMMITTED_INDEX_REFRESH_REQUIRED' } : {}) };
      } finally { await rm(temporary, { recursive: true, force: true }); }
    },
    async push(directory, input, expected) {
      const state = await expect(directory, expected, { attached: true });
      const branch = branchName(input.branch ?? state.branch);
      const url = (await command(directory, ['remote', 'get-url', '--push', 'origin'])).stdout.trim(); remoteUrl(url, settings);
      await command(directory, ['push', '--porcelain', '--recurse-submodules=check', 'origin', `HEAD:refs/heads/${branch}`]);
      const remote = (await command(directory, ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`])).stdout.split(/\s/)[0];
      invariant(remote === state.head, 'REMOTE_VERIFY_FAILED', 'Push returned but remote head does not match');
      return { localCommit: state.head, remoteCommit: remote, branch };
    },
    async addModule(directory, input, expected) {
      id(input.projectId, 'projectId'); remoteUrl(input.url, settings); commitId(input.commit);
      await expect(directory, expected, { clean: true, attached: true });
      const relative = `projects/${input.projectId}`;
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
