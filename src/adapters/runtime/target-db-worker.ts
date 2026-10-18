import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync, constants, type SQLInputValue } from 'node:sqlite';
import { quoteIdentifier, splitStatements } from './sql.js';

const db = new DatabaseSync(workerData.file as string, { enableForeignKeyConstraints: true, allowExtension: false });
db.setAuthorizer((code, first, second) => {
  if (code === constants.SQLITE_ATTACH || code === constants.SQLITE_DETACH) return constants.SQLITE_DENY;
  if (code === constants.SQLITE_FUNCTION && second?.toLowerCase() === 'load_extension') return constants.SQLITE_DENY;
  if (code === constants.SQLITE_PRAGMA && ['writable_schema', 'temp_store_directory', 'data_store_directory'].includes(first?.toLowerCase() ?? '')) return constants.SQLITE_DENY;
  return constants.SQLITE_OK;
});

function wire(value: unknown): unknown {
  if (typeof value === 'bigint') return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(value) : value.toString();
  if (value instanceof Uint8Array) return { type: 'blob', base64: Buffer.from(value).toString('base64') };
  if (Array.isArray(value)) return value.map(wire);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, wire(v)]));
  return value;
}

parentPort!.on('message', (message: { id: number; operation: 'schema' | 'query' | 'close'; sql?: string; params?: SQLInputValue[] }) => {
  try {
    if (message.operation === 'close') { db.close(); parentPort!.postMessage({ id: message.id, result: null }); parentPort!.close(); return; }
    if (message.operation === 'schema') {
      const tables = db.prepare("SELECT name,type,sql FROM sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
      const result = tables.map((table) => ({ ...table, columns: db.prepare(`PRAGMA table_xinfo(${quoteIdentifier(String(table.name))})`).all(), foreignKeys: db.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(String(table.name))})`).all() }));
      parentPort!.postMessage({ id: message.id, result: wire(result) }); return;
    }
    const statements = splitStatements(message.sql!);
    const params = message.params ?? [];
    if (statements.length > 1 && params.length) { const error = new Error('Bound parameters must be submitted with exactly one SQL statement') as Error & { code: string }; error.code = 'AMBIGUOUS_SQL_PARAMETERS'; throw error; }
    let result: unknown;
    for (let index = 0; index < statements.length; index++) {
      try {
        const statement = db.prepare(statements[index]);
        statement.setReadBigInts(true);
        const columns = statement.columns().map((column) => column.name);
        result = columns.length ? { columns, rows: statement.all(...params) } : { columns: [], rows: [], changes: statement.run(...params).changes };
      } catch (error) {
        if (statements.length > 1 && error instanceof Error) error.message = `Statement ${index + 1}/${statements.length} failed; preceding statements may be committed unless an explicit transaction is active: ${error.message}`;
        throw error;
      }
    }
    parentPort!.postMessage({ id: message.id, result: wire(result) });
  } catch (error) {
    const e = error as Error & { code?: string; statusCode?: number };
    parentPort!.postMessage({ id: message.id, error: { code: e.code ?? 'TARGET_DB_ERROR', message: e.message, statusCode: e.statusCode ?? 400 } });
  }
});
