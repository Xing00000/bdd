import { Worker } from 'node:worker_threads';
import type { TargetDatabasePort } from '../../ports/runtime.js';
import { RuntimeAdapterError, invalid } from './errors.js';
import { existingWorkspacePath } from './paths.js';

type WorkerState = { worker: Worker; pending: Map<number, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }>; closed: boolean };
type QueryResult = { columns: string[]; rows: Record<string, unknown>[]; changes?: number };

export class SqliteTargetAdapter implements TargetDatabasePort {
  private readonly workers = new Map<string, WorkerState>();
  private requestId = 0;
  private closed = false;
  private readonly workspaceRoot: string;
  constructor(workspaceRoot: string) { this.workspaceRoot = workspaceRoot; }

  private async request(file: string, operation: 'schema' | 'query', sql?: string, params?: unknown[]): Promise<unknown> {
    if (this.closed) throw new RuntimeAdapterError('RUNTIME_CLOSED', 'Target DB runtime is closed', 409);
    const canonical = await existingWorkspacePath(this.workspaceRoot, file, 'file');
    if (this.closed) throw new RuntimeAdapterError('RUNTIME_CLOSED', 'Target DB runtime is closed', 409);
    let state = this.workers.get(canonical);
    if (!state) {
      const worker = new Worker(new URL('./target-db-worker.js', import.meta.url), { workerData: { file: canonical } });
      state = { worker, pending: new Map(), closed: false };
      const current = state;
      worker.on('message', (message: { id: number; result?: unknown; error?: { code: string; message: string; statusCode: number } }) => {
        const pending = current.pending.get(message.id); if (!pending) return;
        current.pending.delete(message.id);
        if (message.error) pending.reject(new RuntimeAdapterError(message.error.code, message.error.message, message.error.statusCode));
        else pending.resolve(message.result);
      });
      const fail = (error: Error) => { current.closed = true; if (this.workers.get(canonical) === current) this.workers.delete(canonical); for (const pending of current.pending.values()) pending.reject(error); current.pending.clear(); };
      worker.on('error', (cause) => fail(new RuntimeAdapterError('TARGET_DB_UNAVAILABLE', 'Target DB worker failed', 503, { cause })));
      worker.on('exit', (code) => fail(new RuntimeAdapterError('TARGET_DB_CLOSED', `Target DB worker exited (${code})`, 503)));
      this.workers.set(canonical, state);
    }
    const id = ++this.requestId;
    return new Promise((resolve, reject) => { state!.pending.set(id, { resolve, reject }); state!.worker.postMessage({ id, operation, sql, params }); });
  }
  schema(file: string): Promise<unknown> { return this.request(file, 'schema'); }
  async query(file: string, sql: string, params: unknown[] = []): Promise<QueryResult> {
    if (!Array.isArray(params) || params.some((p) => !(p === null || typeof p === 'string' || typeof p === 'bigint' || (typeof p === 'number' && Number.isFinite(p)) || p instanceof Uint8Array))) invalid('SQLite parameters must be bindable scalar values');
    return await this.request(file, 'query', sql, params) as QueryResult;
  }
  async close(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.workers.values()].map(async (state) => {
      for (const pending of state.pending.values()) pending.reject(new RuntimeAdapterError('TARGET_DB_CLOSED', 'Target DB adapter closed during operation', 503));
      state.pending.clear();
      await state.worker.terminate();
    }));
    this.workers.clear();
  }
}
