/** Content-addressed working files. Reading or copying a draft never starts Git. */
import path from 'node:path';
import { readFile, lstat, mkdir, copyFile, chmod } from 'node:fs/promises';
import { invariant, safePath, exists, digest, identity } from '../contracts/index.mjs';
import { gitSourceFiles } from '../git-core/index.mjs';

const omitted = new Set(['.git', 'node_modules', '.runtime', '.generated', 'test-results', 'playwright-report', 'blob-report']);
export function workspaceSourcePath(relative, spec = false) {
  const parts = relative.split('/');
  return !parts.some(part => omitted.has(part) || /^\.env(?:\.|$)/.test(part) && !part.endsWith('.example'))
    && !(spec && ['projects', 'reports'].includes(parts[0]));
}

// Only these workstation-owned receipts may change after a run without changing
// its executable source. A same-named file anywhere else remains an input.
const identifier = '[A-Za-z0-9][A-Za-z0-9_-]{0,79}';
const derivedSpecMetadata = new RegExp(`^spec/${identifier}/(?:review\\.json|${identifier}/(?:acceptance|feedback|workflow)\\.json)$`);
export const specSourcePath = relative => workspaceSourcePath(relative, true) && !derivedSpecMetadata.test(relative);
const comparePaths = (left, right) => Buffer.compare(Buffer.from(left.path, 'utf8'), Buffer.from(right.path, 'utf8'));

export async function workspaceEntries(root, { spec = false } = {}) {
  const entries = [];
  for (const relative of await gitSourceFiles(root, [], { excludeDirectories: [...omitted, ...(spec ? ['projects', 'reports'] : [])] })) {
    if (!workspaceSourcePath(relative, spec)) continue;
    const file = await safePath(root, relative, { missing: false }), info = await lstat(file);
    invariant(info.isFile(), 'SOURCE_NOT_FILE', `來源必須是一般檔案：${relative}`, 409);
    entries.push({ path: relative, mode: info.mode & 0o111 ? '100755' : '100644', sha256: digest(await readFile(file)), size: info.size });
    invariant(entries.length <= 50000, 'WORKSPACE_SIZE_LIMIT', '工作目錄來源檔案過多，尚未建立執行快照。', 409);
  }
  return entries.sort(comparePaths);
}
export const entriesDigest = entries => identity([...entries].sort(comparePaths).map(file => [file.path, file.mode, file.sha256]));
export const specSourceDigest = entries => entriesDigest(entries.filter(file => specSourcePath(file.path)));
export async function workspaceSpecSourceDigest(root) {
  return specSourceDigest(await workspaceEntries(root, { spec: true }));
}

export async function workspaceModules(root, projects, { entries = false } = {}) {
  const result = [];
  for (const project of projects) {
    const relative = project.path ?? `projects/${project.id}`, directory = await safePath(root, relative);
    if (!await exists(directory)) { result.push({ ...project, path: relative, initialized: false, contentDigest: null }); continue; }
    const files = await workspaceEntries(directory);
    result.push({ ...project, path: relative, initialized: true, contentDigest: entriesDigest(files), ...(entries ? { entries: files } : {}) });
  }
  return result;
}

export async function workspaceInput(root, projects) {
  const spec = await workspaceEntries(root, { spec: true }), modules = await workspaceModules(root, projects, { entries: true });
  invariant(modules.every(project => project.initialized), 'PROJECT_NOT_INITIALIZED', '請先建立功能以取得產品原始碼；執行測試不會自動操作 Git。', 409);
  const files = [...spec.map(file => ({ ...file })), ...modules.flatMap(project => project.entries.map(file => ({ ...file, path: `${project.path}/${file.path}` })))];
  return { files, projects: modules.map(({ entries: ignored, ...project }) => project), specDigest: entriesDigest(spec),
    specSourceDigest: specSourceDigest(spec), inputDigest: entriesDigest(files) };
}

export async function copyWorkspace(root, destination, snapshot) {
  for (const entry of snapshot.files) {
    const source = await safePath(root, entry.path, { missing: false }), target = await safePath(destination, entry.path);
    invariant(digest(await readFile(source)) === entry.sha256, 'CONTENT_CHANGED', '建立執行快照時來源已變更，請重新執行。', 409);
    await mkdir(path.dirname(target), { recursive: true }); await copyFile(source, target);
    await chmod(target, entry.mode === '100755' ? 0o755 : 0o644);
    invariant(digest(await readFile(target)) === entry.sha256, 'CONTENT_CHANGED', '建立執行快照時來源已變更，請重新執行。', 409);
  }
}

/** Health receipts may identify a historical checkout without spawning Git. */
export async function workingCommit(root) {
  try {
    let directory = path.join(root, '.git');
    if ((await lstat(directory)).isFile()) {
      const match = /^gitdir: ([^\r\n\0]+)\s*$/.exec(await readFile(directory, 'utf8'));
      if (!match) return null; directory = path.resolve(root, match[1]);
    }
    const head = (await readFile(path.join(directory, 'HEAD'), 'utf8')).trim();
    if (/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head)) return head;
    const ref = /^ref: (refs\/[A-Za-z0-9._/-]+)$/.exec(head)?.[1];
    if (!ref || ref.split('/').some(part => !part || part === '..' || part === '.')) return null;
    let common = directory;
    if (await exists(path.join(directory, 'commondir'))) common = path.resolve(directory, (await readFile(path.join(directory, 'commondir'), 'utf8')).trim());
    for (const base of new Set([directory, common])) {
      if (await exists(path.join(base, ref))) {
        const value = (await readFile(path.join(base, ref), 'utf8')).trim();
        if (/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) return value;
      }
      if (await exists(path.join(base, 'packed-refs'))) for (const line of (await readFile(path.join(base, 'packed-refs'), 'utf8')).split('\n')) {
        const [value, name] = line.split(' '); if (name === ref && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) return value;
      }
    }
  } catch { /* An ordinary non-Git workbench still has a healthy HTTP process. */ }
  return null;
}
