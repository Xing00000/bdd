import { Worker } from 'node:worker_threads';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { CoreError } from '../../domain/errors.ts';
import type { Store, SqlCommand, SqlValue, Row, RunResult } from '../../ports/store.ts';

export async function createSqliteStore(file: string): Promise<Store & { sqliteVersion: string }> {
  if (file !== ':memory:') await mkdir(dirname(file), { recursive: true });
  const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
  // Let Node inherit worker-compatible runtime options; explicitly copying
  // process.execArgv also copies process-only flags under node --test.
  const worker = new Worker(new URL(`./worker.${extension}`, import.meta.url), { workerData: { file } });
  let nextId = 0, closing = false;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  let readyResolve: (value: string) => void, readyReject: (error: Error) => void;
  const ready = new Promise<string>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  function rejectAll(error: Error) { readyReject(error); for (const request of pending.values()) request.reject(error); pending.clear(); }
  worker.on('error', rejectAll);
  worker.on('exit', code => { if (!closing || code !== 0) rejectAll(new CoreError(503, 'STORE_UNAVAILABLE', `SQLite worker exited (${code})`)); });
  worker.on('message', message => {
    if ('ready' in message) {
      if (message.ready) readyResolve(message.sqliteVersion);
      else readyReject(Object.assign(new CoreError(message.error.statusCode, message.error.code, message.error.message)));
      return;
    }
    const request = pending.get(message.id); if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new CoreError(message.error.statusCode, message.error.code, message.error.message));
    else request.resolve(message.result);
  });
  const sqliteVersion = await ready;
  function request(operation: string, fields: Record<string, unknown>): Promise<any> {
    if (closing) return Promise.reject(new CoreError(503, 'STORE_CLOSED', 'SQLite store is closed'));
    return new Promise((resolve, reject) => {
      const id = ++nextId; pending.set(id, { resolve, reject }); worker.postMessage({ id, operation, ...fields });
    });
  }
  return {
    sqliteVersion,
    all: <T extends Row = Row>(sql: string, params: SqlValue[] = []): Promise<T[]> => request('query', { command: { sql, params, mode: 'all' } }),
    run: (sql: string, params: SqlValue[] = []): Promise<RunResult> => request('query', { command: { sql, params } }),
    batch: (commands: SqlCommand[]) => request('batch', { commands }),
    async close() { if (closing) return; const completion = request('close', {}); closing = true; await completion; },
  };
}
