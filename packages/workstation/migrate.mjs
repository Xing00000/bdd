import path from 'node:path';
import { exists, invariant } from '../contracts/index.mjs';
import { rename } from 'node:fs/promises';

// Only legacy storage compatibility, never a second workspace domain or HTTP API.
export function normalizeStoredRequest(request) {
  const result = { ...request, repositoryId: request.repositoryId ?? request.workspaceId };
  delete result.workspaceId;
  if (result.operation?.startsWith('workspace.')) result.operation = result.operation.replace('workspace.', 'repository.');
  return result;
}
export async function migrateCheckoutDirectory(home) {
  const source = path.join(home, 'workspaces'), destination = path.join(home, 'repositories');
  if (!await exists(source)) return;
  invariant(!await exists(destination), 'CHECKOUT_MIGRATION_CONFLICT', 'Both old and new checkout directories exist; preserve both and resolve before restarting', 409);
  await rename(source, destination);
}
