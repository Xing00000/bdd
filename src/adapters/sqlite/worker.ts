import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { schema } from './schema.ts';
import type { SqlCommand } from '../../ports/store.ts';

let db: DatabaseSync;
try {
  db = new DatabaseSync(workerData.file, { timeout: 5000 });
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA trusted_schema=OFF;');
  const version = Number(db.prepare('PRAGMA user_version').get()!.user_version);
  if (version === 0) {
    db.exec('BEGIN IMMEDIATE');
    try { db.exec(schema); db.exec('PRAGMA user_version=1; COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  } else if (version !== 1) throw new Error(`Unsupported metadata schema version ${version}`);
  parentPort!.postMessage({ ready: true, sqliteVersion: db.prepare('SELECT sqlite_version() AS version').get()!.version });
} catch (error) {
  parentPort!.postMessage({ ready: false, error: serialize(error) });
  throw error;
}
function serialize(error: unknown) {
  const e = error as Error & { code?: string; statusCode?: number };
  return { message: e.message, code: e.code ?? 'SQLITE_ERROR', statusCode: e.statusCode ?? 500 };
}
function execute(command: SqlCommand) {
  const statement = db.prepare(command.sql);
  const result = command.mode === 'all' ? statement.all(...(command.params ?? [])) : statement.run(...(command.params ?? []));
  if (command.expectChanges !== undefined && !Array.isArray(result) && Number(result.changes) !== command.expectChanges)
    throw Object.assign(new Error('Concurrent state change; no changes were saved'), { code: 'STATE_CHANGED', statusCode: 409 });
  if (command.expectRows !== undefined && Array.isArray(result) && result.length !== command.expectRows)
    throw Object.assign(new Error('Concurrent state change; no changes were saved'), { code: 'STATE_CHANGED', statusCode: 409 });
  return result;
}
parentPort!.on('message', (message: { id: number; operation: string; command?: SqlCommand; commands?: SqlCommand[] }) => {
  try {
    if (message.operation === 'close') {
      db.close(); parentPort!.postMessage({ id: message.id, result: null }); parentPort!.close(); return;
    }
    let result: unknown;
    if (message.operation === 'batch') {
      db.exec('BEGIN IMMEDIATE');
      try { result = message.commands!.map(execute); db.exec('COMMIT'); }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    } else result = execute(message.command!);
    parentPort!.postMessage({ id: message.id, result });
  } catch (error) { parentPort!.postMessage({ id: message.id, error: serialize(error) }); }
});
