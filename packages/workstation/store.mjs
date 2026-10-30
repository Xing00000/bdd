import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { invariant, identity, errorResult } from '../contracts/index.mjs';

export function openStore(home) {
  const db = new DatabaseSync(path.join(home, 'metadata.sqlite'));
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  invariant(version >= 0 && version <= 2, 'METADATA_VERSION_UNSUPPORTED', 'Do not open a newer workstation database with an older binary');
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, remote_url TEXT NOT NULL,
      branch TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS operations (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      request_hash TEXT NOT NULL, request_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('QUEUED','RUNNING','CANCELLING','SUCCEEDED','FAILED','INTERRUPTED','CANCELLED')),
      worker_pid INTEGER, result_json TEXT, error_json TEXT,
      created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_writer_per_workspace ON operations(workspace_id)
      WHERE status IN ('QUEUED','RUNNING','CANCELLING');
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      state TEXT NOT NULL, result_json TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS report_index (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      report_key TEXT NOT NULL, run_id TEXT NOT NULL, requirement_id TEXT NOT NULL,
      feature_id TEXT NOT NULL, manifest_hash TEXT NOT NULL, entry_json TEXT NOT NULL,
      invalid_reason TEXT, indexed_at TEXT NOT NULL,
      PRIMARY KEY(workspace_id, report_key)
    );
    PRAGMA user_version=2;
  `);
  const decode = row => row ? { ...row, request: JSON.parse(row.request_json), result: row.result_json ? JSON.parse(row.result_json) : null, error: row.error_json ? JSON.parse(row.error_json) : null } : null;
  const get = operationId => decode(db.prepare('SELECT * FROM operations WHERE id=?').get(operationId));
  return {
    close() { db.close(); },
    workspaces() { return db.prepare('SELECT id,title,remote_url remoteUrl,branch,created_at createdAt FROM workspaces ORDER BY created_at').all(); },
    workspace(workspaceId) {
      const row = db.prepare('SELECT id,title,remote_url remoteUrl,branch,created_at createdAt FROM workspaces WHERE id=?').get(workspaceId);
      invariant(row, 'WORKSPACE_NOT_FOUND', 'Workspace not found', 404); return row;
    },
    register(input) {
      invariant(!db.prepare('SELECT id FROM workspaces WHERE id=?').get(input.id), 'WORKSPACE_EXISTS', 'Workspace ID already exists', 409);
      db.prepare('INSERT INTO workspaces(id,title,remote_url,branch,created_at) VALUES(?,?,?,?,?)')
        .run(input.id, input.title, input.remoteUrl, input.branch ?? null, new Date().toISOString());
      return this.workspace(input.id);
    },
    get,
    operations(workspaceId) { return db.prepare('SELECT * FROM operations WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100').all(workspaceId).map(decode); },
    enqueue(request) {
      const hash = identity(request);
      db.exec('BEGIN IMMEDIATE');
      try {
        const previous = get(request.operationId);
        if (previous) {
          invariant(previous.request_hash === hash, 'OPERATION_ID_CONFLICT', 'An operation ID cannot be reused with different input', 409);
          db.exec('COMMIT'); return previous;
        }
        const busy = db.prepare("SELECT id FROM operations WHERE workspace_id=? AND status IN ('QUEUED','RUNNING','CANCELLING')").get(request.workspaceId);
        invariant(!busy, 'WORKSPACE_BUSY', `Workspace already has active operation ${busy?.id ?? ''}`, 409);
        db.prepare("INSERT INTO operations(id,workspace_id,request_hash,request_json,status,created_at) VALUES(?,?,?,?,'QUEUED',?)")
          .run(request.operationId, request.workspaceId, hash, JSON.stringify(request), new Date().toISOString());
        db.exec('COMMIT'); return get(request.operationId);
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    claim(operationId) {
      return db.prepare("UPDATE operations SET status='RUNNING',worker_pid=?,started_at=? WHERE id=? AND status='QUEUED'")
        .run(process.pid, new Date().toISOString(), operationId).changes === 1;
    },
    requestCancellation(operationId) {
      db.prepare("UPDATE operations SET status='CANCELLING' WHERE id=? AND status IN ('QUEUED','RUNNING')").run(operationId);
      return get(operationId);
    },
    finish(operationId, status, result, error) {
      if (get(operationId)?.status === 'CANCELLING' && status !== 'CANCELLED') return get(operationId);
      db.prepare("UPDATE operations SET status=?,result_json=?,error_json=?,finished_at=? WHERE id=? AND status IN ('QUEUED','RUNNING','CANCELLING')")
        .run(status, result === undefined ? null : JSON.stringify(result), error ? JSON.stringify(errorResult(error)) : null, new Date().toISOString(), operationId);
      return get(operationId);
    },
    recover() {
      const active = db.prepare("SELECT * FROM operations WHERE status IN ('RUNNING','CANCELLING')").all();
      for (const operation of active) {
        let alive = false;
        try { if (operation.worker_pid) { process.kill(operation.worker_pid, 0); alive = true; } } catch {}
        if (!alive) this.finish(operation.id, operation.status === 'CANCELLING' ? 'CANCELLED' : 'INTERRUPTED', undefined, { code: 'WORKER_INTERRUPTED', message: 'Worker ended without a durable completion receipt; inspect the workspace before retrying' });
      }
      return db.prepare("SELECT id FROM operations WHERE status='QUEUED' ORDER BY created_at").all().map(x => x.id);
    },
    indexReport(workspaceId, entry) {
      const previous = db.prepare('SELECT manifest_hash FROM report_index WHERE workspace_id=? AND report_key=?').get(workspaceId, entry.key);
      if (previous && previous.manifest_hash !== entry.manifestHash) {
        db.prepare("UPDATE report_index SET invalid_reason='REPORT_ID_CONFLICT' WHERE workspace_id=? AND report_key=?").run(workspaceId, entry.key);
        invariant(false, 'REPORT_ID_CONFLICT', 'Different evidence reused the same requirement/feature/run ID', 409);
      }
      db.prepare('INSERT INTO report_index(workspace_id,report_key,run_id,requirement_id,feature_id,manifest_hash,entry_json,indexed_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,report_key) DO UPDATE SET entry_json=excluded.entry_json,indexed_at=excluded.indexed_at')
        .run(workspaceId, entry.key, entry.runId, entry.requirementId, entry.featureId, entry.manifestHash, JSON.stringify(entry), new Date().toISOString());
    },
    reports(workspaceId) {
      return db.prepare('SELECT entry_json,invalid_reason,indexed_at FROM report_index WHERE workspace_id=? ORDER BY indexed_at DESC,report_key').all(workspaceId)
        .map(x => ({ ...JSON.parse(x.entry_json), invalidReason: x.invalid_reason, indexedAt: x.indexed_at }));
    },
    recordRun(workspaceId, result, state) {
      db.prepare('INSERT INTO runs(id,workspace_id,state,result_json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,result_json=excluded.result_json,updated_at=excluded.updated_at')
        .run(result.runId, workspaceId, state, JSON.stringify(result), new Date().toISOString());
    },
    runs(workspaceId) { return db.prepare('SELECT id,state,result_json,updated_at updatedAt FROM runs WHERE workspace_id=? ORDER BY updated_at DESC').all(workspaceId).map(x => ({ id: x.id, state: x.state, result: JSON.parse(x.result_json), updatedAt: x.updatedAt })); }
  };
}
