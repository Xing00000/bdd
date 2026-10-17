import type { BrowserRuntimePort, TerminalRuntimePort, TargetDatabasePort } from '../../ports/runtime.js';
import { PlaywrightBrowserAdapter } from './browser.js';
import { PtyTerminalAdapter } from './terminal.js';
import { SqliteTargetAdapter } from './target-db.js';
export { RuntimeAdapterError } from './errors.js';
export { resolveRecordingSecrets, allowlistedRecordingSecretResolver, requiredRecordingSecretAliases } from './secrets.js';
export type { RecordingSecretBinding, RecordingSecretResolver } from './secrets.js';

export function createRuntimeAdapters(options: { workspaceRoot?: string } = {}): { browser: BrowserRuntimePort; terminal: TerminalRuntimePort; targetDb: TargetDatabasePort } {
  const root = options.workspaceRoot ?? '/workspace';
  return { browser: new PlaywrightBrowserAdapter(), terminal: new PtyTerminalAdapter(root), targetDb: new SqliteTargetAdapter(root) };
}
