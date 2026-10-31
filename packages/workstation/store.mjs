import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { existsSync, chmodSync } from 'node:fs';
import { normalizeStoredRequest } from './migrate.mjs';
import { invariant, identity, errorResult } from '../contracts/index.mjs';

export function openStore(home) {
  const db = new DatabaseSync(path.join(home, 'metadata.sqlite'));
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  invariant(version >= 0 && version <= 3, 'METADATA_VERSION_UNSUPPORTED', 'Do not open a newer workstation database with an older binary');
  if (version > 0 && version < 3) {
    const backup = path.join(home, 'before-repository-model-v3.sqlite');
    if (!existsSync(backup)) { db.prepare('VACUUM INTO ?').run(backup); chmodSync(backup, 0o600); }
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const old = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='workspaces'").get();
    if (old) {
      invariant(!db.prepare("SELECT id FROM operations WHERE status IN ('RUNNING','CANCELLING') LIMIT 1").get(), 'ACTIVE_LEGACY_WORKER', 'Stop old workers before migrating the repository model', 409);
      db.exec('ALTER TABLE workspaces RENAME TO spec_repositories;');
      for (const table of ['operations', 'runs', 'report_index']) {
        if (db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name=?").get(table)) db.exec(`ALTER TABLE ${table} RENAME COLUMN workspace_id TO repository_id`);
      }
      db.exec('ALTER TABLE operations ADD COLUMN original_request_json TEXT');
      for (const row of db.prepare('SELECT id,request_json FROM operations').all()) {
        const normalized = normalizeStoredRequest(JSON.parse(row.request_json));
        db.prepare('UPDATE operations SET original_request_json=request_json,request_json=?,request_hash=? WHERE id=?').run(JSON.stringify(normalized), identity(normalized), row.id);
      }
    }
  db.exec(`
    CREATE TABLE IF NOT EXISTS spec_repositories (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, remote_url TEXT NOT NULL,
      branch TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS operations (
      id TEXT PRIMARY KEY, repository_id TEXT NOT NULL REFERENCES spec_repositories(id),
      request_hash TEXT NOT NULL, request_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('QUEUED','RUNNING','CANCELLING','SUCCEEDED','FAILED','INTERRUPTED','CANCELLED')),
      worker_pid INTEGER, result_json TEXT, error_json TEXT,
      created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_writer_per_repository ON operations(repository_id)
      WHERE status IN ('QUEUED','RUNNING','CANCELLING');
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, repository_id TEXT NOT NULL REFERENCES spec_repositories(id),
      state TEXT NOT NULL, result_json TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS report_index (
      repository_id TEXT NOT NULL REFERENCES spec_repositories(id),
      report_key TEXT NOT NULL, run_id TEXT NOT NULL, requirement_id TEXT NOT NULL,
      feature_id TEXT NOT NULL, manifest_hash TEXT NOT NULL, entry_json TEXT NOT NULL,
      invalid_reason TEXT, indexed_at TEXT NOT NULL,
      PRIMARY KEY(repository_id, report_key)
    );
    CREATE TABLE IF NOT EXISTS tooling_checks (
      repository_id TEXT NOT NULL REFERENCES spec_repositories(id),
      feature_key TEXT NOT NULL, digest TEXT NOT NULL, result_json TEXT NOT NULL,
      PRIMARY KEY(repository_id,feature_key)
    );
    PRAGMA user_version=3;
  `);
  db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  const decode = row => row ? { ...row, request: JSON.parse(row.request_json), result: row.result_json ? JSON.parse(row.result_json) : null, error: row.error_json ? JSON.parse(row.error_json) : null } : null;
  const get = operationId => decode(db.prepare('SELECT * FROM operations WHERE id=?').get(operationId));
  return {
    close() { db.close(); },
    repositories() { return db.prepare('SELECT id,title,remote_url remoteUrl,branch,created_at createdAt FROM spec_repositories ORDER BY created_at').all(); },
    repository(repositoryId) {
      const row = db.prepare('SELECT id,title,remote_url remoteUrl,branch,created_at createdAt FROM spec_repositories WHERE id=?').get(repositoryId);
      invariant(row, 'REPOSITORY_NOT_FOUND', 'Spec repository not found', 404); return row;
    },
    register(input) {
      invariant(!db.prepare('SELECT id FROM spec_repositories WHERE id=?').get(input.id), 'REPOSITORY_EXISTS', 'Spec repository ID already exists', 409);
      db.prepare('INSERT INTO spec_repositories(id,title,remote_url,branch,created_at) VALUES(?,?,?,?,?)')
        .run(input.id, input.title, input.remoteUrl, input.branch ?? null, new Date().toISOString());
      return this.repository(input.id);
    },
    updateOrigin(repositoryId, url) { db.prepare('UPDATE spec_repositories SET remote_url=? WHERE id=?').run(url, repositoryId); },
    check(repositoryId, featureKey) {
      const value = db.prepare('SELECT result_json FROM tooling_checks WHERE repository_id=? AND feature_key=?').get(repositoryId, featureKey);
      return value ? JSON.parse(value.result_json) : null;
    },
    recordCheck(repositoryId, featureKey, value) {
      db.prepare('INSERT INTO tooling_checks VALUES(?,?,?,?) ON CONFLICT(repository_id,feature_key) DO UPDATE SET digest=excluded.digest,result_json=excluded.result_json').run(repositoryId, featureKey, value.digest, JSON.stringify(value));
    },
    get,
    operations(repositoryId) { return db.prepare('SELECT * FROM operations WHERE repository_id=? ORDER BY created_at DESC LIMIT 100').all(repositoryId).map(decode); },
    enqueue(request) {
      const hash = identity(request);
      db.exec('BEGIN IMMEDIATE');
      try {
        const previous = get(request.operationId);
        if (previous) {
          invariant(previous.request_hash === hash, 'OPERATION_ID_CONFLICT', 'An operation ID cannot be reused with different input', 409);
          db.exec('COMMIT'); return previous;
        }
        const busy = db.prepare("SELECT id FROM operations WHERE repository_id=? AND status IN ('QUEUED','RUNNING','CANCELLING')").get(request.repositoryId);
        invariant(!busy, 'REPOSITORY_BUSY', `Spec repository has an active operation ${busy?.id ?? ''}`, 409);
        db.prepare("INSERT INTO operations(id,repository_id,request_hash,request_json,status,created_at) VALUES(?,?,?,?,'QUEUED',?)")
          .run(request.operationId, request.repositoryId, hash, JSON.stringify(request), new Date().toISOString());
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
    indexReport(repositoryId, entry) {
      const previous = db.prepare('SELECT manifest_hash FROM report_index WHERE repository_id=? AND report_key=?').get(repositoryId, entry.key);
      if (previous && previous.manifest_hash !== entry.manifestHash) {
        db.prepare("UPDATE report_index SET invalid_reason='REPORT_ID_CONFLICT' WHERE repository_id=? AND report_key=?").run(repositoryId, entry.key);
        invariant(false, 'REPORT_ID_CONFLICT', 'Different evidence reused the same requirement/feature/run ID', 409);
      }
      db.prepare('INSERT INTO report_index(repository_id,report_key,run_id,requirement_id,feature_id,manifest_hash,entry_json,indexed_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(repository_id,report_key) DO UPDATE SET entry_json=excluded.entry_json,indexed_at=excluded.indexed_at')
        .run(repositoryId, entry.key, entry.runId, entry.requirementId, entry.featureId, entry.manifestHash, JSON.stringify(entry), new Date().toISOString());
    },
    reports(repositoryId) {
      return db.prepare('SELECT entry_json,invalid_reason,indexed_at FROM report_index WHERE repository_id=? ORDER BY indexed_at DESC,report_key').all(repositoryId)
        .map(x => ({ ...JSON.parse(x.entry_json), invalidReason: x.invalid_reason, indexedAt: x.indexed_at }));
    },
    recordRun(repositoryId, result, state) {
      db.prepare('INSERT INTO runs(id,repository_id,state,result_json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,result_json=excluded.result_json,updated_at=excluded.updated_at')
        .run(result.runId, repositoryId, state, JSON.stringify(result), new Date().toISOString());
    },
    runs(repositoryId) { return db.prepare('SELECT id,state,result_json,updated_at updatedAt FROM runs WHERE repository_id=? ORDER BY updated_at DESC').all(repositoryId).map(x => ({ id: x.id, state: x.state, result: JSON.parse(x.result_json), updatedAt: x.updatedAt })); }
  };
}
