/** Git is read only at explicit checkpoint/publication/import boundaries. */
import { invariant, digest } from '../contracts/index.mjs';
import { specSourcePath, specSourceDigest } from './workspace.mjs';

/** Hash committed bytes directly: no checkout, hooks, filters or repository code. */
export async function specCheckpointDigest(root, git, commit) {
  invariant(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit ?? ''), 'INVALID_COMMIT', '來源版本必須是完整 Git commit。');
  const raw = (await git.command(root, ['ls-tree', '-r', '-z', '-l', '--full-tree', commit])).stdout;
  const entries = raw.split('\0').filter(Boolean).map(line => {
    const split = line.indexOf('\t'), [mode, type, sha, size] = line.slice(0, split).trim().split(/\s+/);
    return { path: line.slice(split + 1), mode, type, sha, size: Number(size) };
  }).filter(entry => specSourcePath(entry.path));
  invariant(entries.length <= 50000 && entries.every(entry => entry.type === 'blob' && ['100644', '100755'].includes(entry.mode)
    && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(entry.sha) && Number.isSafeInteger(entry.size) && entry.size >= 0),
  'SOURCE_CHECKPOINT_INVALID', '驗收來源版本含有不支援的檔案。', 409);
  const objects = [...new Map(entries.map(entry => [entry.sha, entry.size])).entries()];
  const bytes = objects.reduce((total, [, size]) => total + size, 0);
  invariant(bytes <= 256 * 1024 * 1024, 'SOURCE_SIZE_LIMIT', '驗收來源版本超過完整性檢查上限。', 409);
  if (!objects.length) return specSourceDigest(entries);
  const response = (await git.command(root, ['cat-file', '--batch'], {
    input: objects.map(([sha]) => sha).join('\n') + '\n', binaryOutput: true,
    maxBytes: bytes + objects.length * 128
  })).stdout;
  invariant(Buffer.isBuffer(response), 'SOURCE_CHECKPOINT_INVALID', '無法讀取來源版本的原始位元組。', 409);
  const hashes = new Map(); let offset = 0;
  for (const [sha, size] of objects) {
    const newline = response.indexOf(10, offset);
    invariant(newline >= offset && response.subarray(offset, newline).toString('ascii') === `${sha} blob ${size}`
      && response.length >= newline + size + 2 && response[newline + size + 1] === 10,
    'SOURCE_CHECKPOINT_INVALID', '來源版本的物件資料不完整。', 409);
    hashes.set(sha, digest(response.subarray(newline + 1, newline + size + 1))); offset = newline + size + 2;
  }
  invariant(offset === response.length, 'SOURCE_CHECKPOINT_INVALID', '來源版本的物件資料長度不符。', 409);
  return specSourceDigest(entries.map(entry => ({ ...entry, sha256: hashes.get(entry.sha) })));
}
