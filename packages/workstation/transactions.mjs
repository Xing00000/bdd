import path from 'node:path';
import { readFile, realpath, readdir } from 'node:fs/promises';
import { id, invariant, safePath, exists, digest, identity, writeJson, readJson, atomicWrite } from '../contracts/index.mjs';

const allowed = relative => /^(spec|tests|reports|\.workbench-tools)\//.test(relative);
async function currentHash(root, relative) {
  const file = await safePath(root, relative);
  return await exists(file) ? digest(await readFile(file)) : null;
}
export async function planFiles(root, files, metadata) {
  invariant(files.length <= 10000 && new Set(files.map(x => x.path)).size === files.length, 'INVALID_FILE_PLAN', 'Too many or duplicate files');
  let total = 0;
  const changes = [];
  for (const item of files) {
    invariant(allowed(item.path), 'PLAN_PATH_FORBIDDEN', item.path, 403);
    const bytes = Buffer.from(item.content); total += bytes.length;
    invariant(bytes.length <= 32 * 1024 * 1024 && total <= 64 * 1024 * 1024, 'IMPORT_SIZE_LIMIT', 'Migration plan exceeds 64 MiB');
    const before = await currentHash(root, item.path), after = digest(bytes);
    if (before !== after) changes.push({ path: item.path, before, after, size: bytes.length, content: bytes.toString('base64') });
  }
  const plan = { schemaVersion: 1, metadata, files: changes };
  return { ...plan, digest: identity(plan) };
}
export function publicPlan(plan) {
  return { schemaVersion: 1, digest: plan.digest, metadata: plan.metadata, files: plan.files.map(({ content, ...file }) => file), changed: plan.files.length };
}
function validatePlan(plan) {
  invariant(plan?.schemaVersion === 1 && plan.digest === identity({ schemaVersion: 1, metadata: plan.metadata, files: plan.files }), 'PLAN_CHANGED', 'Saved migration plan failed integrity validation');
  invariant(Array.isArray(plan.files) && new Set(plan.files.map(x => x.path)).size === plan.files.length, 'INVALID_FILE_PLAN', 'Duplicate file plan');
  for (const item of plan.files) invariant(allowed(item.path) && digest(Buffer.from(item.content, 'base64')) === item.after, 'PLAN_CHANGED', 'Saved file content changed');
}
async function journalPath(home, workspaceId, transactionId) {
  return safePath(home, `transactions/${id(workspaceId)}/${id(transactionId)}.json`);
}
export async function applyPlan({ root, home, workspaceId, transactionId, plan, expectedDigest, sourceHead, afterWrite }) {
  validatePlan(plan);
  invariant(expectedDigest === plan.digest, 'PLAN_CHANGED', 'Preview changed; review the new file plan before applying', 409);
  const file = await journalPath(home, workspaceId, transactionId);
  invariant(!await exists(file), 'TRANSACTION_EXISTS', 'Use the explicit resume operation for an existing transaction', 409);
  const journal = { schemaVersion: 1, transactionId, workspaceId, root: await realpath(root), sourceHead, plan, status: 'PREPARED', createdAt: new Date().toISOString() };
  // Persist all original/desired hashes before the first working-tree write.
  await writeJson(file, journal);
  return resumePlan({ root, home, workspaceId, transactionId, sourceHead, afterWrite });
}
export async function resumePlan({ root, home, workspaceId, transactionId, sourceHead, afterWrite }) {
  const file = await journalPath(home, workspaceId, transactionId), journal = await readJson(file, { maxBytes: 128 * 1024 * 1024 });
  invariant(journal.workspaceId === workspaceId && journal.root === await realpath(root), 'TRANSACTION_WORKSPACE_MISMATCH', 'Transaction belongs to another checkout', 403);
  invariant(sourceHead === journal.sourceHead, 'HEAD_MISMATCH', 'Checkout HEAD changed since migration began', 409);
  validatePlan(journal.plan);
  const check = async item => {
    const current = await currentHash(root, item.path);
    invariant(current === item.before || current === item.after, 'MIGRATION_FILE_CONFLICT', `Preserve external edits before resuming: ${item.path}`, 409);
    return current;
  };
  for (const item of journal.plan.files) await check(item);
  journal.status = 'APPLYING'; await writeJson(file, journal);
  for (const [ordinal, item] of journal.plan.files.entries()) {
    if (await check(item) !== item.after) await atomicWrite(await safePath(root, item.path), Buffer.from(item.content, 'base64'));
    await afterWrite?.(ordinal, item); // Optional test fault injection; never supplied from API input.
  }
  for (const item of journal.plan.files) invariant(await currentHash(root, item.path) === item.after, 'MIGRATION_FILE_CONFLICT', item.path, 409);
  journal.status = 'APPLIED'; journal.finishedAt = new Date().toISOString(); await writeJson(file, journal);
  return { transactionId, status: journal.status, ...publicPlan(journal.plan), committed: false };
}
export async function listTransactions(home, workspaceId) {
  const directory = await safePath(home, `transactions/${id(workspaceId)}`);
  if (!await exists(directory)) return [];
  const result = [];
  for (const name of await readdir(directory)) if (name.endsWith('.json')) {
    const value = await readJson(await safePath(directory, name), { maxBytes: 128 * 1024 * 1024 });
    result.push({ transactionId: value.transactionId, status: value.status, createdAt: value.createdAt, finishedAt: value.finishedAt, ...publicPlan(value.plan) });
  }
  return result;
}
