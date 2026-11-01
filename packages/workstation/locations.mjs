/** Explicit host-side checkout locations. Never move, erase or implicitly adopt user files. */
import path from 'node:path';
import os from 'node:os';
import { lstatSync, realpathSync, readdirSync } from 'node:fs';
import { id, invariant, safePath, exists } from '../contracts/index.mjs';

export const managedLocation = (home, repositoryId) => path.join(home, 'repositories', id(repositoryId), 'repo');
export function overlaps(a, b) {
  const within = (parent, child) => { const r = path.relative(parent, child); return !r || (!r.startsWith(`..${path.sep}`) && r !== '..' && !path.isAbsolute(r)); };
  return within(a, b) || within(b, a);
}
function stat(file) { try { return lstatSync(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
/** Resolve existing ancestors (including macOS /var aliases), but not a symlink selected as the checkout. */
export function canonicalLocation(input) {
  invariant(typeof input === 'string' && input.trim() && input.length <= 4096 && !/[\x00-\x1f\x7f]/.test(input), 'INVALID_LOCAL_PATH', '請填寫本機資料夾的完整路徑，例如 ~/projects/bdd-spec。');
  let value = input.trim(); if (value.startsWith('~/')) value = path.join(os.homedir(), value.slice(2));
  invariant(path.isAbsolute(value) && !value.split(/[\\/]/).some(x => x === '..' || x.toLowerCase() === '.git'), 'INVALID_LOCAL_PATH', '請使用完整資料夾路徑，不可包含 .. 或 .git。');
  value = path.resolve(value);
  const info = stat(value);
  invariant(!info?.isSymbolicLink(), 'LOCAL_PATH_SYMLINK', '請選擇資料夾的實際位置，不要使用資料夾捷徑。');
  invariant(!info || info.isDirectory(), 'LOCAL_PATH_NOT_DIRECTORY', '這個位置是檔案，請改用資料夾。');
  let parent = value; const tail = [];
  while (!stat(parent)) { tail.unshift(path.basename(parent)); parent = path.dirname(parent); }
  invariant(stat(parent).isDirectory() || stat(parent).isSymbolicLink(), 'LOCAL_PATH_NOT_DIRECTORY', '上層路徑不是資料夾。');
  return path.join(realpathSync(parent), ...tail);
}
export function remoteIdentity(value) {
  if (path.isAbsolute(value)) { try { return `file:${realpathSync(value)}`; } catch { return `file:${path.resolve(value)}`; } }
  const text = value.startsWith('git@') ? `ssh://${value.replace(':', '/')}` : value;
  const url = new URL(text);
  return `${url.hostname.toLowerCase()}/${url.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '').toLowerCase()}`;
}
export function validateLocation(options, repositoryId, input, repositories = []) {
  invariant(input==null||typeof input==='string','INVALID_LOCAL_PATH','本地目錄必須是文字路徑。');
  const fallback = managedLocation(options.home, repositoryId);
  const selected = input?.trim() ? canonicalLocation(input) : canonicalLocation(fallback);
  const managed = canonicalLocation(fallback);
  const home = canonicalLocation(options.home);
  invariant(selected !== path.parse(selected).root && selected !== realpathSync(os.homedir()), 'LOCAL_PATH_UNSAFE', '請選擇專屬的規格庫資料夾，不要使用磁碟或使用者家目錄。');
  invariant(selected === managed || !overlaps(selected, home), 'LOCAL_PATH_PROTECTED', '不可使用工作台的資料庫、快取或其他受管理目錄；可留空使用原本預設位置。');
  if (options.toolkitRoot) invariant(!overlaps(selected, canonicalLocation(options.toolkitRoot)), 'LOCAL_PATH_PROTECTED', '這是工作台程式所在的目錄，請改用獨立的 bdd-spec 資料夾。');
  // System directories are not checkout destinations. Dedicated /tmp fixtures remain usable.
  for (const system of ['/etc', '/usr', '/bin', '/sbin', '/dev', '/proc', '/sys', '/System', '/Library'])
    invariant(!overlaps(selected, stat(system) ? realpathSync(system) : system), 'LOCAL_PATH_PROTECTED', '系統資料夾不能作為規格庫目錄。');
  for (const record of repositories) if (record.id !== repositoryId) {
    const other = canonicalLocation(record.localPath ?? managedLocation(options.home, record.id));
    invariant(!overlaps(selected, other), 'LOCAL_PATH_IN_USE', `這個位置已由「${record.title}」使用，兩個規格庫不能共用或互相包含。`, 409);
  }
  const info = stat(selected);
  if (info && readdirSync(selected).length) invariant(Boolean(stat(path.join(selected, '.git'))), 'LOCAL_PATH_NOT_EMPTY', '這個資料夾已有檔案，但不是 Git clone。未覆寫任何內容，請選空資料夾或既有的 Spec Repo。', 409);
  return selected;
}
export async function repositoryPath(home, repositoryId, storeOrRecord) {
  id(repositoryId);
  const record = storeOrRecord?.repository ? storeOrRecord.repository(repositoryId) : storeOrRecord;
  if (!record?.localPath) return safePath(home, `repositories/${repositoryId}/repo`);
  // SQL saves and reads must not require the checkout to be mounted or accessible.
  return record.localPath;
}
export async function checkRepositoryIdentity(root, record, git) {
  invariant(canonicalLocation(root)===root,'LOCAL_PATH_CHANGED','本地目錄的實際位置已改變，未讀取或覆寫；請在設定確認。',409);
  await git.root(root);
  const origin = (await git.remotes(root)).find(x => x.name === 'origin');
  invariant(origin && remoteIdentity(origin.url) === remoteIdentity(record.remoteUrl), 'BINDING_REMOTE_CHANGED', '這個本地 clone 屬於另一個來源。未覆寫任何檔案；請選擇與規格庫網址相符的目錄。', 409);
}
/** A location change reserves a new checkout but leaves the old one and all SQLite drafts untouched. */
export async function changeLocation(context) {
  const { options, store, request, git } = context, record = store.repository(request.repositoryId);
  const previous = await repositoryPath(options.home, record.id, record);
  invariant(request.input.expectedLocalPath === previous, 'LOCAL_PATH_CHANGED', '目錄設定已由另一個操作更新，請重新開啟設定。', 409);
  const selected = validateLocation(options, record.id, request.input.localPath, store.repositories());
  invariant(selected===previous||!overlaps(selected,previous),'LOCAL_PATH_OVERLAP','新舊目錄不能互相包含；請選獨立位置，原檔案仍保留。',409);
  if (await exists(path.join(selected, '.git'))) await checkRepositoryIdentity(selected, record, git);
  if (selected !== previous) store.setRepositoryLocation(record.id, record.localPath, selected, previous, request.operationId, () => validateLocation(options, record.id, selected, store.repositories()));
  const { acquireRepository } = await import('./catalog.mjs');
  return acquireRepository({ ...context, root: selected });
}
