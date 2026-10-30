import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export class WorkstationError extends Error {
  constructor(code, message, statusCode = 422, details = undefined) {
    super(message); this.name = 'WorkstationError'; this.code = code;
    this.statusCode = statusCode; this.details = details;
  }
}
export function invariant(condition, code, message, statusCode = 422) {
  if (!condition) throw new WorkstationError(code, message, statusCode);
}
export const digest = value => createHash('sha256').update(value).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const identity = value => digest(canonical(value));
export function id(value, label = 'id') {
  invariant(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value), 'INVALID_ID', `${label} must be 1–80 letters, digits, _ or -`);
  return value;
}
export function relativePath(value) {
  invariant(typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\\\x00-\x1f\x7f]/.test(value)
    && !path.posix.isAbsolute(value) && !/^[A-Za-z]:/.test(value)
    && value.split('/').every(p => p && p !== '.' && p !== '..' && p.toLowerCase() !== '.git'),
  'INVALID_PATH', 'Expected a repository-relative path without traversal, control characters or .git');
  return value;
}
export async function safePath(root, relative, { missing = true } = {}) {
  relativePath(relative);
  const base = await realpath(root);
  let current = base;
  for (const component of relative.split('/')) {
    current = path.join(current, component);
    try { invariant(!(await lstat(current)).isSymbolicLink(), 'SYMLINK_FORBIDDEN', `Symlink path rejected: ${relative}`, 403); }
    catch (error) { if (error.code !== 'ENOENT' || !missing) throw error; }
  }
  return current;
}
export async function exists(file) { try { await lstat(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
export async function readJson(file, { maxBytes = 4 * 1024 * 1024 } = {}) {
  invariant((await lstat(file)).size <= maxBytes, 'CONFIG_TOO_LARGE', 'JSON exceeds the permitted size');
  const text = await readFile(file, 'utf8');
  invariant(Buffer.byteLength(text) <= maxBytes, 'CONFIG_TOO_LARGE', 'JSON exceeds the permitted size');
  try { return JSON.parse(text); }
  catch { throw new WorkstationError('CONFIG_FORMAT_UNSUPPORTED', `${path.basename(file)}: v1 accepts JSON syntax (also valid YAML 1.2), not executable configuration`); }
}
export async function atomicWrite(file, content) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, content, { flag: 'wx', mode: 0o600 }); await rename(temporary, file); }
  finally { const { rm } = await import('node:fs/promises'); await rm(temporary, { force: true }); }
}
export const writeJson = (file, value) => atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`);
export async function walk(root, relative = '') {
  const entries = await readdir(relative ? await safePath(root, relative) : root, { withFileTypes: true });
  const result = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    relativePath(name);
    invariant(!entry.isSymbolicLink(), 'SYMLINK_FORBIDDEN', `Symlink rejected: ${name}`, 403);
    if (entry.isDirectory()) result.push(...await walk(root, name));
    else { invariant(entry.isFile(), 'SPECIAL_FILE_FORBIDDEN', `Not a regular file: ${name}`); result.push(name); }
  }
  return result;
}
export function version(value) { invariant(value?.schemaVersion === 1, 'SCHEMA_VERSION_UNSUPPORTED', 'Expected schemaVersion: 1'); return value; }
export function errorResult(error) {
  return { code: error.code ?? 'INTERNAL_ERROR', message: error.message ?? String(error), ...(error.details ? { details: error.details } : {}) };
}
export function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
