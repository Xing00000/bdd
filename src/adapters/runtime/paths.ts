import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { RuntimeAdapterError } from './errors.js';

// The composition root supplies stage-specific worktrees. This validates a path;
// it does not claim to make node-pty a sandbox or to enforce file write policy.
export async function existingWorkspacePath(root: string, input: string, kind: 'directory' | 'file',registeredRoots:readonly string[]=[]): Promise<string> {
  if (!isAbsolute(input)) throw new RuntimeAdapterError('INVALID_WORKSPACE_PATH', 'An absolute existing workspace path is required');
  const [canonicalRoot, canonical] = await Promise.all([realpath(root), realpath(input)]).catch((cause) => {
    throw new RuntimeAdapterError('INVALID_WORKSPACE_PATH', 'Workspace path does not exist', 400, { cause });
  });
  const rel = relative(canonicalRoot, canonical);
  if ((rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))&&!registeredRoots.some(base=>{const r=relative(base,canonical);return r===''||r!=='..'&&!r.startsWith(`..${sep}`)&&!isAbsolute(r);})) {
    throw new RuntimeAdapterError('INVALID_WORKSPACE_PATH', 'Path is outside the managed workspace');
  }
  const info = await stat(canonical);
  if (kind === 'directory' ? !info.isDirectory() : !info.isFile()) {
    throw new RuntimeAdapterError('INVALID_WORKSPACE_PATH', `Expected a regular ${kind}`);
  }
  return canonical;
}
