import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type GitFile = { path: string; rawText: string };
export type GitSnapshot = {
  repo: string; branch: string; commit: string; commitSha: string;
  path: string; filePath: string; rawText: string; rawSha256: string;
};
export type CiCommand = [string, ...string[]];
type ProcessResult = { exitCode: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; timedOut: boolean };
export class GitAdapterError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode = 422) { super(message); }
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const inside = (root: string, value: string) => {
  const rel = path.relative(root, value);
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
};
function filePath(value: string) {
  if (!value || value.includes('\0') || value.includes('\\') || path.posix.isAbsolute(value)
      || value.split('/').some(part => part === '.' || part === '..' || part === '.git' || part === ''))
    throw new GitAdapterError('GIT_PATH_INVALID', 'Git 檔案必須是 repository 內的相對路徑，且不可含 .git 或跨目錄路徑');
  return value;
}
async function execute(file: string, args: string[], cwd: string, timeoutMs = 180_000, environment: Record<string, string> = {}): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const processGroup = process.platform !== 'win32';
    const child = spawn(file, args, { cwd, shell: false, detached: processGroup, env: { PATH:process.env.PATH, LANG:process.env.LANG??'C.UTF-8', TMPDIR:process.env.TMPDIR??'/tmp', npm_config_cache:'/tmp/bdd-npm-cache', ...environment, GIT_TERMINAL_PROMPT: '0', CI: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false;
    const limit = 8 * 1024 * 1024;
    let hardKill: ReturnType<typeof setTimeout> | undefined;
    const kill = (signal: NodeJS.Signals) => {
      try { if (processGroup && child.pid) process.kill(-child.pid, signal); else child.kill(signal); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    };
    const timer = setTimeout(() => { timedOut = true; kill('SIGTERM'); hardKill = setTimeout(() => kill('SIGKILL'), 2000); hardKill.unref(); }, timeoutMs);
    timer.unref();
    child.stdout.on('data', (chunk: Buffer) => { stdout = (stdout + chunk.toString('utf8')).slice(-limit); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-limit); });
    child.once('error', error => { clearTimeout(timer); clearTimeout(hardKill); reject(error); });
    child.once('close', (exitCode, signal) => { clearTimeout(timer); clearTimeout(hardKill); resolve({ exitCode, signal, stdout, stderr, timedOut }); });
  });
}
async function git(repo: string, args: string[]) {
  const result = await execute('git', ['-C', repo, ...args], repo);
  if (result.exitCode !== 0) throw new GitAdapterError('GIT_COMMAND_FAILED', result.stderr.trim() || result.stdout.trim() || 'Git command failed');
  return result.stdout;
}

/** No operation pushes. A write is made only by the explicit save() application action. */
export function createGitAdapter({ workspaceRoot }: { workspaceRoot: string }) {
  const rootPromise = realpath(workspaceRoot);
  const writes = new Map<string, Promise<unknown>>();
  async function repository(input: string) {
    if (!input || input.includes('\0')) throw new GitAdapterError('GIT_REPO_INVALID', 'Repository 路徑無效');
    const root = await rootPromise, candidate = await realpath(path.resolve(workspaceRoot, input));
    if (candidate !== root && !inside(root, candidate)) throw new GitAdapterError('GIT_REPO_OUTSIDE_WORKSPACE', 'Repository 必須位於目前工作區', 403);
    const top = (await git(candidate, ['rev-parse', '--show-toplevel'])).trim();
    if (await realpath(top) !== candidate) throw new GitAdapterError('GIT_REPO_INVALID', '必須指定 repository 根目錄');
    return candidate;
  }
  async function commitOf(repo: string, ref: string) {
    if (!ref || ref.includes('\0')) throw new GitAdapterError('GIT_REF_INVALID', '必須指定真實 Git revision');
    const commit = (await git(repo, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])).trim();
    if (!/^[0-9a-f]{40,64}$/.test(commit)) throw new GitAdapterError('GIT_REF_INVALID', '無法固定 Git commit');
    return commit;
  }
  async function safeDestination(repo: string, relative: string) {
    filePath(relative);
    let current = repo;
    for (const part of relative.split('/')) {
      current = path.join(current, part);
      try { if ((await lstat(current)).isSymbolicLink()) throw new GitAdapterError('GIT_SYMLINK_PATH', '保存路徑不可通過 symbolic link', 403); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return current;
  }
  async function serial<T>(repo: string, operation: () => Promise<T>): Promise<T> {
    const previous = writes.get(repo) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    writes.set(repo, current);
    try { return await current; } finally { if (writes.get(repo) === current) writes.delete(repo); }
  }
  return {
    async readSnapshot(input: { repo: string; branch?: string; commit: string; path: string }): Promise<GitSnapshot> {
      const repo = await repository(input.repo), commit = await commitOf(repo, input.commit), selectedPath = filePath(input.path);
      const rawText = await git(repo, ['show', `${commit}:${selectedPath}`]);
      return { repo, branch: input.branch ?? '', commit, commitSha: commit, path: selectedPath, filePath: selectedPath, rawText, rawSha256: hash(rawText) };
    },
    async save(input: { repo: string; files: GitFile[]; message?: string }) {
      const repo = await repository(input.repo);
      return serial(repo, async () => {
        if (!input.files.length || new Set(input.files.map(file => file.path)).size !== input.files.length)
          throw new GitAdapterError('GIT_FILES_INVALID', '必須提供不重複的檔案清單');
        if (input.files.some(file => typeof file.rawText !== 'string')) throw new GitAdapterError('GIT_FILES_INVALID', '檔案內容必須是完整原文');
        const destinations = await Promise.all(input.files.map(file => safeDestination(repo, file.path)));
        for (const [index, file] of input.files.entries()) {
          const destination = destinations[index], temporary = `${destination}.workbench-${randomUUID()}`;
          await mkdir(path.dirname(destination), { recursive: true });
          try { await writeFile(temporary, file.rawText, { flag: 'wx', mode: 0o600 }); await rename(temporary, destination); }
          finally { await rm(temporary, { force: true }); }
        }
        const paths = input.files.map(file => file.path);
        // --only ensures an unrelated staged file is never included in this commit.
        const difference = await git(repo, ['status', '--porcelain', '--', ...paths]);
        if (difference) {
          await git(repo, ['add', '--', ...paths]);
          await git(repo, ['-c', 'user.name=Workbench', '-c', 'user.email=workbench@localhost', 'commit', '--only', '-m', input.message ?? 'Save workbench test candidate', '--', ...paths]);
        }
        const commit = await commitOf(repo, 'HEAD'), branch = (await git(repo, ['branch', '--show-current'])).trim();
        return { repo, branch, commit, commitSha: commit, files: input.files.map(file => ({ ...file, rawSha256: hash(file.rawText) })) };
      });
    },
    async runCi(input: { repo: string; commit: string; command?: CiCommand; env?: Record<string, string> }) {
      const repo = await repository(input.repo), candidateCommit = await commitOf(repo, input.commit);
      const root = await rootPromise, directory = path.join(root, '.workbench', 'ci', randomUUID());
      await mkdir(path.dirname(directory), { recursive: true });
      await git(repo, ['worktree', 'add', '--detach', directory, candidateCommit]);
      const startedAt = new Date().toISOString();
      try {
        const testedCommit = await commitOf(directory, 'HEAD');
        let command = input.command;
        if (!command) {
          const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
          if (!manifest.scripts?.test) throw new GitAdapterError('CI_COMMAND_MISSING', '指定 commit 未設定 package.json scripts.test');
          command = [process.platform === 'win32' ? 'npm.cmd' : 'npm', 'run', 'test'];
        }
        if (!Array.isArray(command) || !command.length || command.some(value => typeof value !== 'string' || value.includes('\0')))
          throw new GitAdapterError('CI_COMMAND_INVALID', 'CI command 必須是 executable/arguments 字串陣列');
        let result: ProcessResult;
        try { result = await execute(command[0], command.slice(1), directory, 180_000, input.env); }
        catch (error) { result = { exitCode: null, signal: null, stdout: '', stderr: String(error), timedOut: false }; }
        return { repo, candidateCommit, testedCommit, command, status: result.exitCode === 0 && !result.timedOut ? 'PASSED' as const : 'FAILED' as const, ...result, startedAt, finishedAt: new Date().toISOString() };
      } finally {
        await git(repo, ['worktree', 'remove', '--force', directory]);
      }
    },
  };
}
