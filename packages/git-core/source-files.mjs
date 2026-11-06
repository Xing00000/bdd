/** Source selection is filesystem-only. Never spawn Git while authoring or testing.
 * Ignore matching: node-ignore 7.0.14 (MIT), vendored for portable Spec toolkits.
 * Index format: https://git-scm.com/docs/index-format (read-only v2/v3/v4).
 */
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { readFile, readdir, lstat } from 'node:fs/promises';
import ignore from './vendor/ignore.cjs';
import { invariant, relativePath, safePath, atomicWrite } from '../contracts/index.mjs';

const viewFile = '.runtime/source-view.json', maxEntries = 1000000;
async function optional(file, encoding) {
  try { return await readFile(file, encoding); }
  catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) return null; throw error; }
}
async function metadata(root) {
  const entry = path.join(root, '.git');
  let stat; try { stat = await lstat(entry); } catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  invariant(!stat.isSymbolicLink(), 'SYMLINK_FORBIDDEN', 'Git metadata must not be a symbolic link');
  let directory = entry;
  if (stat.isFile()) {
    const match = /^gitdir:\s*(.+)\s*$/m.exec(await readFile(entry, 'utf8'));
    invariant(match, 'SOURCE_INDEX_INVALID', 'Git metadata location is invalid');
    directory = path.resolve(root, match[1].trim());
  }
  const common = await optional(path.join(directory, 'commondir'), 'utf8');
  const commonDirectory = common ? path.resolve(directory, common.trim()) : directory;
  const config = await optional(path.join(commonDirectory, 'config'), 'utf8') ?? '';
  return { directory, commonDirectory, config };
}
function configValue(config, section, key) {
  let current = '', value;
  for (const line of config.split(/\r?\n/)) {
    const header = /^\s*\[([^\]]+)\]/.exec(line);
    if (header) { current = header[1].trim().toLowerCase(); continue; }
    const pair = /^\s*([\w.-]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (current === section && pair?.[1].toLowerCase() === key) value = pair[2].replace(/^"(.*)"$/, '$1');
  }
  return value;
}
function indexEntries(bytes, hashBytes) {
  const invalid = message => invariant(false, 'SOURCE_INDEX_INVALID', message);
  if (bytes.length < 12 + hashBytes || bytes.toString('ascii', 0, 4) !== 'DIRC') invalid('Git index header is invalid');
  const version = bytes.readUInt32BE(4), count = bytes.readUInt32BE(8), end = bytes.length - hashBytes;
  invariant([2, 3, 4].includes(version), 'SOURCE_INDEX_UNSUPPORTED', 'Source selection requires Git index version 2, 3 or 4');
  if (count > maxEntries) invalid('Git index contains too many entries');
  if (!createHash(hashBytes === 32 ? 'sha256' : 'sha1').update(bytes.subarray(0, end)).digest().equals(bytes.subarray(end))) invalid('Git index checksum is invalid');
  let offset = 12, previous = Buffer.alloc(0); const entries = [];
  for (let index = 0; index < count; index++) {
    const start = offset;
    if (offset + 42 + hashBytes > end) invalid('Git index entry is truncated');
    const mode = bytes.readUInt32BE(offset + 24), flags = bytes.readUInt16BE(offset + 40 + hashBytes);
    offset += 42 + hashBytes;
    if (flags & 0x4000) { if (version < 3 || offset + 2 > end) invalid('Git index flags are invalid'); offset += 2; }
    let remove = 0;
    if (version === 4) {
      let byte, groups = 0;
      do {
        if (offset >= end || ++groups > 8) invalid('Git index path prefix is invalid');
        byte = bytes[offset++]; remove = remove * 128 + (byte & 127);
        if (byte & 128) remove++;
      } while (byte & 128);
      if (remove > previous.length) invalid('Git index path prefix exceeds its predecessor');
    }
    const nul = bytes.indexOf(0, offset); if (nul < offset || nul >= end) invalid('Git index path is truncated');
    const name = version === 4 ? Buffer.concat([previous.subarray(0, previous.length - remove), bytes.subarray(offset, nul)]) : bytes.subarray(offset, nul);
    previous = name;
    const file = name.toString('utf8');
    if (!Buffer.from(file).equals(name)) invalid('Git index path is not UTF-8');
    entries.push({ path: file, mode }); offset = nul + 1;
    if (version !== 4) offset = start + Math.ceil((offset - start) / 8) * 8;
  }
  let link;
  while (offset < end) {
    if (offset + 8 > end) invalid('Git index extension is truncated');
    const type = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32BE(offset + 4); offset += 8;
    if (offset + size > end) invalid('Git index extension size is invalid');
    if (type === 'link') link = bytes.subarray(offset, offset + size);
    else invariant(type[0] === type[0].toUpperCase() || type === 'sdir', 'SOURCE_INDEX_UNSUPPORTED', `Unsupported required Git index extension: ${type}`);
    offset += size;
  }
  return { entries, link };
}
function bitmap(bytes, start, limit) {
  invariant(start + 8 <= bytes.length, 'SOURCE_INDEX_INVALID', 'Split index bitmap is truncated');
  const size = bytes.readUInt32BE(start), words = bytes.readUInt32BE(start + 4), end = start + 8 + words * 8;
  invariant(size <= maxEntries && end + 4 <= bytes.length, 'SOURCE_INDEX_INVALID', 'Split index bitmap is invalid');
  const selected = new Set(); let offset = start + 8, bit = 0;
  while (offset < end) {
    const word = bytes.readBigUInt64BE(offset); offset += 8;
    const run = Number((word >> 1n) & 0xffffffffn), literals = Number(word >> 33n);
    invariant(offset + literals * 8 <= end && bit + run * 64 <= maxEntries + 64, 'SOURCE_INDEX_INVALID', 'Split index bitmap exceeds its bounds');
    if (word & 1n) for (let i = bit; i < Math.min(bit + run * 64, size, limit); i++) selected.add(i);
    bit += run * 64;
    for (let i = 0; i < literals; i++, bit += 64, offset += 8) {
      const literal = bytes.readBigUInt64BE(offset);
      for (let n = 0; n < 64 && bit + n < Math.min(size, limit); n++) if (literal & (1n << BigInt(n))) selected.add(bit + n);
    }
  }
  return { selected, offset: end + 4 };
}
async function trackedPaths(root, meta) {
  const materialized = await optional(path.join(root, viewFile), 'utf8');
  if (materialized !== null) {
    const value = JSON.parse(materialized);
    invariant(value.schemaVersion === 1 && Array.isArray(value.files) && value.files.length <= maxEntries, 'SOURCE_VIEW_INVALID', 'Source view metadata is invalid');
    return new Set(value.files.map(file => relativePath(file)));
  }
  if (!meta.directory) return new Set();
  const indexFile = path.join(meta.directory, 'index');
  try { invariant((await lstat(indexFile)).size <= 64 * 1024 * 1024, 'SOURCE_SIZE_LIMIT', 'Git index exceeds the source selection limit'); }
  catch (error) { if (error.code === 'ENOENT') return new Set(); throw error; }
  const bytes = await optional(indexFile); if (!bytes) return new Set();
  const hashBytes = configValue(meta.config, 'extensions', 'objectformat') === 'sha256' ? 32 : 20;
  let { entries, link } = indexEntries(bytes, hashBytes);
  if (link) {
    invariant(link.length >= hashBytes, 'SOURCE_INDEX_INVALID', 'Split index link is truncated');
    const hash = link.subarray(0, hashBytes).toString('hex');
    if (!/^0+$/.test(hash)) {
      const shared = await optional(path.join(meta.directory, `sharedindex.${hash}`));
      invariant(shared, 'SOURCE_INDEX_INVALID', 'Shared Git index is missing');
      const base = indexEntries(shared, hashBytes); invariant(!base.link, 'SOURCE_INDEX_INVALID', 'Shared Git index cannot contain another split index');
      const deleted = bitmap(link, hashBytes, base.entries.length), replaced = bitmap(link, deleted.offset, base.entries.length);
      let cursor = 0;
      const merged = base.entries.map((entry, index) => {
        if (!replaced.selected.has(index)) return entry;
        const update = entries[cursor++]; invariant(update, 'SOURCE_INDEX_INVALID', 'Split index replacement is missing');
        return { ...update, path: update.path || entry.path };
      }).filter((entry, index) => !deleted.selected.has(index));
      entries = [...merged, ...entries.slice(cursor)];
    }
  }
  // Sparse directories and gitlinks are directories, not editable source files.
  return new Set(entries.filter(entry => entry.mode !== 0o160000 && entry.mode !== 0o40000).map(entry => relativePath(entry.path)));
}
async function selection(root, options = {}) {
  const meta = await metadata(root), tracked = await trackedPaths(root, meta), layers = new Map();
  const excluded = new Set(['.git', ...(options.excludeDirectories ?? [])]);
  const ignorecase = configValue(meta.config ?? '', 'core', 'ignorecase') === 'true';
  const make = (text, base = '') => ({ base, rules: ignore({ ignorecase }).add(text ?? '') });
  const home = os.homedir(), xdg = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  const globalConfig = (await optional(path.join(xdg, 'git/config'), 'utf8') ?? '') + '\n' + (await optional(path.join(home, '.gitconfig'), 'utf8') ?? '');
  let globalIgnore = configValue(meta.config ?? '', 'core', 'excludesfile') ?? configValue(globalConfig, 'core', 'excludesfile') ?? path.join(xdg, 'git/ignore');
  if (globalIgnore.startsWith('~/')) globalIgnore = path.join(home, globalIgnore.slice(2));
  const initial = [make(await optional(path.resolve(root, globalIgnore), 'utf8'))];
  if (meta.commonDirectory) initial.push(make(await optional(path.join(meta.commonDirectory, 'info/exclude'), 'utf8')));
  const layer = async directory => {
    if (layers.has(directory)) return layers.get(directory);
    const file = path.join(root, directory, '.gitignore'); let text = null;
    try {
      const stat = await lstat(file);
      invariant(stat.size <= 4 * 1024 * 1024, 'SOURCE_SIZE_LIMIT', 'Source ignore rules exceed the size limit');
      if (stat.isFile()) text = await readFile(file, 'utf8');
    }
    catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error; }
    const value = make(text, directory); layers.set(directory, value); return value;
  };
  const ignores = (file, directory, active) => {
    let ignored = false;
    for (const { base, rules } of active) {
      const relative = base ? file.slice(base.length + 1) : file;
      const match = rules.test(relative + (directory ? '/' : ''));
      if (match.ignored) ignored = true; else if (match.unignored) ignored = false;
    }
    return ignored;
  };
  const allowed = file => !file.split('/').some(part => excluded.has(part)) && file !== viewFile;
  return { tracked, initial, layer, ignores, allowed };
}

/** Filter selected paths with nested ignore files, without consulting a Git process. */
export async function gitSourcePaths(root, paths, options = {}) {
  if (!paths.length) return [];
  const state = await selection(root, options), result = [];
  for (const input of paths) {
    const file = relativePath(input); if (!state.allowed(file)) continue;
    if (state.tracked.has(file)) { result.push(file); continue; }
    const parts = file.split('/'), active = [...state.initial, await state.layer('')]; let ignored = false;
    for (let index = 0; index < parts.length; index++) {
      const current = parts.slice(0, index + 1).join('/'), directory = index < parts.length - 1;
      if (state.ignores(current, directory, active)) { ignored = true; break; }
      if (directory) active.push(await state.layer(current));
    }
    if (!ignored) result.push(file);
  }
  return result;
}

/** [] or ['.'] enumerates the root. Excluded directories are never traversed. */
export async function gitSourceFiles(root, folders = [], options = {}) {
  const scopes = folders.length ? folders.map(folder => folder === '.' || folder === '' ? '' : relativePath(folder)) : [''];
  const state = await selection(root, options), files = new Set(); let visited = 0;
  const inScope = file => scopes.some(folder => !folder || file === folder || file.startsWith(folder + '/'));
  const visit = async (directory, inherited) => {
    const active = [...inherited, await state.layer(directory)];
    for (const item of await readdir(path.join(root, directory), { withFileTypes: true })) {
      const file = directory ? `${directory}/${item.name}` : item.name;
      if (!state.allowed(file)) continue;
      invariant(++visited <= maxEntries, 'SOURCE_SIZE_LIMIT', 'Source directory contains too many entries');
      if (state.ignores(file, item.isDirectory(), active)) continue;
      if (item.isDirectory()) {
        if (inScope(file) || scopes.some(folder => folder.startsWith(file + '/'))) await visit(file, active);
      } else if (inScope(file)) {
        invariant(item.isFile() || item.isSymbolicLink(), 'SPECIAL_FILE_FORBIDDEN', `Not a regular source file: ${file}`);
        await safePath(root, file, { missing: false }); files.add(file);
      }
    }
  };
  try { await visit('', state.initial); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const file of state.tracked) if (state.allowed(file) && inScope(file)) {
    try { const absolute = await safePath(root, file, { missing: false }); if ((await lstat(absolute)).isFile()) files.add(file); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const group = file => scopes.findIndex(folder => !folder || file === folder || file.startsWith(folder + '/'));
  return [...files].sort((a, b) => {
    const difference = group(a) - group(b); if (difference) return difference;
    const left = a.split('/'), right = b.split('/');
    for (let index = 0; index < Math.min(left.length, right.length); index++) { const order = left[index].localeCompare(right[index]); if (order) return order; }
    return left.length - right.length;
  });
}

/** Mark the exact accepted SQLite/snapshot files across processes; not an execution grant. */
export async function trackSourceView(root, files) {
  const accepted = files ? files.map(file => relativePath(file)) : [];
  if (!files) {
    const visit = async directory => {
      for (const item of await readdir(path.join(root, directory), { withFileTypes: true })) {
        if (['.git', '.runtime', 'node_modules'].includes(item.name)) continue;
        const file = directory ? `${directory}/${item.name}` : item.name;
        await safePath(root, file, { missing: false });
        if (item.isDirectory()) await visit(file); else if (item.isFile()) accepted.push(file);
        invariant(accepted.length <= maxEntries, 'SOURCE_SIZE_LIMIT', 'Source view contains too many files');
      }
    }; await visit('');
  }
  await atomicWrite(await safePath(root, viewFile), JSON.stringify({ schemaVersion: 1, files: [...new Set(accepted)].sort() }) + '\n');
}
