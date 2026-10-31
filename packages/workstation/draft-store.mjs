/** SQLite is the authoring source of truth. Git is a projection, never a save precondition. */
import { digest, identity, invariant } from '../contracts/index.mjs';

export function installDraftSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS authoring_state (
      repository_id TEXT PRIMARY KEY REFERENCES spec_repositories(id),
      revision INTEGER NOT NULL, settings_json TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS authoring_files (
      repository_id TEXT NOT NULL REFERENCES spec_repositories(id),
      target TEXT NOT NULL, path TEXT NOT NULL, content TEXT NOT NULL, sha256 TEXT NOT NULL,
      base_hash TEXT, PRIMARY KEY(repository_id,target,path)
    );
    CREATE TABLE IF NOT EXISTS authoring_history (
      repository_id TEXT NOT NULL REFERENCES spec_repositories(id), revision INTEGER NOT NULL,
      operation_id TEXT NOT NULL, request_hash TEXT NOT NULL, changes_json TEXT NOT NULL,
      settings_json TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(repository_id,revision), UNIQUE(repository_id,operation_id)
    );
    CREATE TABLE IF NOT EXISTS repository_projection (
      repository_id TEXT PRIMARY KEY REFERENCES spec_repositories(id), receipt_json TEXT NOT NULL
    );
  `);
}
export function draftMethods(db) {
  const read = repositoryId => {
    const state = db.prepare('SELECT * FROM authoring_state WHERE repository_id=?').get(repositoryId);
    return state ? { revision: state.revision, settings: JSON.parse(state.settings_json), updatedAt: state.updated_at,
      files: db.prepare('SELECT target,path,content,sha256,base_hash baseHash FROM authoring_files WHERE repository_id=? ORDER BY target,path').all(repositoryId) } : null;
  };
  return {
    draft: read,
    draftSeed(repositoryId) {
      const row=db.prepare('SELECT changes_json FROM authoring_history WHERE repository_id=? ORDER BY revision LIMIT 1').get(repositoryId);
      return row ? JSON.parse(row.changes_json) : [];
    },
    draftReceipt(repositoryId, operationId, request) {
      const row = db.prepare('SELECT request_hash,result_json FROM authoring_history WHERE repository_id=? AND operation_id=?').get(repositoryId, operationId);
      if (!row) return null;
      invariant(row.request_hash === identity(request), 'OPERATION_ID_CONFLICT', '操作識別碼已被其他內容使用。', 409);
      return JSON.parse(row.result_json);
    },
    /** One SQLite transaction includes content, settings, history and the durable save receipt. */
    saveDraft(repositoryId, { expectedRevision, settings, files, operationId, request, result = {}, proposalKey }) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const previous = this.draftReceipt(repositoryId, operationId, request);
        if (previous) { db.exec('COMMIT'); return previous; }
        const current = read(repositoryId);
        invariant((current?.revision ?? null) === expectedRevision, 'DRAFT_REVISION_CHANGED', '內容剛被另一個操作更新。你的畫面草稿未被覆蓋，請重新讀取後合併。', 409);
        const revision = (current?.revision ?? 0) + 1, at = new Date().toISOString();
        const value = settings ?? current?.settings ?? {};
        const seen = new Set();
        for (const file of files) {
          const key = `${file.target}\0${file.path}`;
          invariant(!seen.has(key), 'DUPLICATE_DRAFT_PATH', file.path); seen.add(key);
          invariant(typeof file.content === 'string' && !file.content.includes('\0') && Buffer.byteLength(file.content) <= 4 * 1024 * 1024, 'INVALID_CONTENT', '文字檔案超過上限或包含二進位內容。');
          const old = current?.files.find(x => x.target === file.target && x.path === file.path);
          db.prepare(`INSERT INTO authoring_files VALUES(?,?,?,?,?,?) ON CONFLICT(repository_id,target,path)
            DO UPDATE SET content=excluded.content,sha256=excluded.sha256,base_hash=COALESCE(authoring_files.base_hash,excluded.base_hash)`).run(repositoryId,file.target,file.path,file.content,digest(file.content),old?.baseHash ?? file.baseHash ?? null);
        }
        const receipt = { ...result, saved: true, storage: 'sqlite', revision, synchronized: false };
        db.prepare(`INSERT INTO authoring_state VALUES(?,?,?,?) ON CONFLICT(repository_id)
          DO UPDATE SET revision=excluded.revision,settings_json=excluded.settings_json,updated_at=excluded.updated_at`).run(repositoryId,revision,JSON.stringify(value),at);
        db.prepare(`INSERT INTO repository_preferences(repository_id,settings_json) VALUES(?,?) ON CONFLICT(repository_id)
          DO UPDATE SET settings_json=excluded.settings_json`).run(repositoryId,JSON.stringify(value));
        db.prepare('INSERT INTO authoring_history VALUES(?,?,?,?,?,?,?,?)').run(repositoryId,revision,operationId,identity(request),JSON.stringify(files),JSON.stringify(value),JSON.stringify(receipt),at);
        if(proposalKey && result.key) db.prepare('UPDATE requirement_proposals SET editor_key=? WHERE repository_id=? AND editor_key=?').run(result.key,repositoryId,proposalKey);
        db.exec('COMMIT'); return receipt;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    projection(repositoryId) {
      const row = db.prepare('SELECT receipt_json FROM repository_projection WHERE repository_id=?').get(repositoryId);
      return row ? JSON.parse(row.receipt_json) : null;
    },
    setProjection(repositoryId, receipt) {
      db.prepare('INSERT INTO repository_projection VALUES(?,?) ON CONFLICT(repository_id) DO UPDATE SET receipt_json=excluded.receipt_json').run(repositoryId,JSON.stringify(receipt));
    }
  };
}

export const isLocalSave = request => ['repository.setup','repository.save','workflow.create','workflow.draft','workflow.requirement.save'].includes(request.operation)
  || request.operation === 'workflow.review' && ['gherkin','sd'].includes(request.input?.stage);
export const projectionJobPredicate = `NOT (json_extract(request_json,'$.operation') IN ('repository.setup','repository.save','workflow.create','workflow.draft','workflow.requirement.save') OR (json_extract(request_json,'$.operation')='workflow.review' AND json_extract(request_json,'$.input.stage') IN ('gherkin','sd')))`;
