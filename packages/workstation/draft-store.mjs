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
    authoringChanges(){
      return db.prepare(`SELECT * FROM (
        SELECT h.repository_id,h.revision,h.operation_id,h.result_json,h.created_at,o.request_json,o.error_json,
          ROW_NUMBER() OVER(PARTITION BY h.repository_id ORDER BY h.revision DESC) AS position
        FROM authoring_history h JOIN operations o ON o.id=h.operation_id
      ) WHERE position=1`).all().map(row=>({...row,result:JSON.parse(row.result_json),request:JSON.parse(row.request_json),error:row.error_json?JSON.parse(row.error_json):null}));
    },
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
    creationReceipt(repositoryId, editorKey) {
      const row=db.prepare("SELECT result_json FROM authoring_history WHERE repository_id=? AND json_extract(result_json,'$.creationEditorKey')=? ORDER BY revision DESC LIMIT 1").get(repositoryId,editorKey);
      return row?JSON.parse(row.result_json):null;
    },
    /** One SQLite transaction includes content, settings, history and the durable save receipt. */
    saveDraft(repositoryId, { expectedRevision, settings, files, deleteFiles = [], operationId, request, result = {}, proposalKey, acceptIncomingBases = false }) {
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
            DO UPDATE SET content=excluded.content,sha256=excluded.sha256,base_hash=${acceptIncomingBases?'excluded.base_hash':'COALESCE(authoring_files.base_hash,excluded.base_hash)'}`).run(repositoryId,file.target,file.path,file.content,digest(file.content),acceptIncomingBases?file.baseHash??null:old?.baseHash??file.baseHash??null);
        }
        for (const file of deleteFiles) {
          invariant(file.target.startsWith('project:') && !seen.has(`${file.target}\0${file.path}`), 'INVALID_DELETE', 'Only unambiguous product deletions are allowed');
          db.prepare('DELETE FROM authoring_files WHERE repository_id=? AND target=? AND path=?').run(repositoryId,file.target,file.path);
        }
        const receipt = { ...result, saved: true, storage: 'sqlite', revision, synchronized: false };
        db.prepare(`INSERT INTO authoring_state VALUES(?,?,?,?) ON CONFLICT(repository_id)
          DO UPDATE SET revision=excluded.revision,settings_json=excluded.settings_json,updated_at=excluded.updated_at`).run(repositoryId,revision,JSON.stringify(value),at);
        db.prepare(`INSERT INTO repository_preferences(repository_id,settings_json) VALUES(?,?) ON CONFLICT(repository_id)
          DO UPDATE SET settings_json=excluded.settings_json`).run(repositoryId,JSON.stringify(value));
        db.prepare('INSERT INTO authoring_history VALUES(?,?,?,?,?,?,?,?)').run(repositoryId,revision,operationId,identity(request),JSON.stringify([...files,...deleteFiles.map(f=>({...f,deleted:true}))]),JSON.stringify(value),JSON.stringify(receipt),at);
        if(proposalKey && result.key){
          db.prepare('UPDATE requirement_proposals SET editor_key=? WHERE repository_id=? AND editor_key=?').run(result.key,repositoryId,proposalKey);
          db.prepare('UPDATE operations SET interaction_key=? WHERE repository_id=? AND interaction_key=?').run(result.key,repositoryId,proposalKey);
        }
        db.exec('COMMIT'); return receipt;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    /** Repair legacy COALESCE baselines using successful, immutable checkout imports only. */
    repairImportBaselines(repositoryId) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const rows=db.prepare(`SELECT revision,changes_json FROM authoring_history
          WHERE repository_id=? AND operation_id LIKE 'import-%' AND json_extract(result_json,'$.imported')=1 ORDER BY revision`).all(repositoryId);
        const bases=new Map();
        for(const row of rows)for(const file of JSON.parse(row.changes_json))if(file.origin==='checkout'&&Object.hasOwn(file,'baseHash'))bases.set(`${file.target}\0${file.path}`,file);
        const checkpoint=this.projection(repositoryId),importRow=rows.find(row=>row.revision===checkpoint?.revision);
        const accepted=new Map(importRow?JSON.parse(importRow.changes_json).filter(file=>file.origin==='checkout'&&Object.hasOwn(file,'baseHash')).map(file=>[`${file.target}\0${file.path}`,file.baseHash]):[]);
        const corrected=new Map();
        for(const file of bases.values()) {
          const previous=db.prepare('SELECT base_hash FROM authoring_files WHERE repository_id=? AND target=? AND path=?').get(repositoryId,file.target,file.path);
          if(previous&&previous.base_hash!==file.baseHash) {
            corrected.set(`${file.target}\0${file.path}`,previous.base_hash);
            db.prepare('UPDATE authoring_files SET base_hash=? WHERE repository_id=? AND target=? AND path=?').run(file.baseHash,repositoryId,file.target,file.path);
          }
        }
        if(checkpoint&&importRow) {
          let changed=false;
          checkpoint.files=(checkpoint.files??[]).map(file=>{
            const key=`${file.target}\0${file.path}`;
            const latest=bases.get(key)?.baseHash;
            if(bases.has(key)&&file.sha256!==latest&&(file.sha256===corrected.get(key)||accepted.has(key)&&file.sha256===accepted.get(key))) {changed=true;return {...file,sha256:latest};}
            return file;
          });
          if(changed)this.setProjection(repositoryId,checkpoint);
        }
        db.exec('COMMIT');return {corrected:corrected.size};
      } catch(error) {db.exec('ROLLBACK');throw error;}
    },
    projection(repositoryId) {
      const row = db.prepare('SELECT receipt_json FROM repository_projection WHERE repository_id=?').get(repositoryId);
      return row ? JSON.parse(row.receipt_json) : null;
    },
    setProjection(repositoryId, receipt) {
      db.prepare('INSERT INTO repository_projection VALUES(?,?) ON CONFLICT(repository_id) DO UPDATE SET receipt_json=excluded.receipt_json').run(repositoryId,JSON.stringify(receipt));
    },
    completeAcceptanceCheckpoint(repositoryId, expectedRevision, acceptanceId) {
      db.exec('BEGIN IMMEDIATE');
      try {
        invariant(read(repositoryId)?.revision === expectedRevision, 'CONTENT_CHANGED', '驗收期間已儲存新草稿；沒有標記新內容已驗收，請重新檢視後重試。', 409);
        const checkpoint = this.projection(repositoryId);
        invariant(checkpoint?.checkpointRevision === expectedRevision && checkpoint.head, 'ACCEPTANCE_CHECKPOINT_REQUIRED', '驗收版本尚未完成，請重試。', 409);
        this.setProjection(repositoryId, { ...checkpoint, checkpointKind: 'ACCEPTED', completedAcceptances: [...new Set([...(checkpoint.completedAcceptances ?? []), acceptanceId])] });
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
  };
}

export const localSaveOperations=Object.freeze(['workflow.delete','repository.setup','repository.save','repository.upgrade.apply','workflow.create','workflow.draft','workflow.requirement.save','workflow.feedback','workflow.accept','workflow.restart','interaction.requirement.generate','interaction.document.import','interaction.cli.input','interaction.cancel']);
export const isLocalSave = request => localSaveOperations.includes(request.operation)
  || request.operation === 'workflow.review' && request.input?.stage === 'gherkin';
const exclusiveLocalSaves=Object.freeze(['workflow.delete','workflow.create','workflow.accept']);
const createsRequirement=request=>request.operation==='workflow.requirement.save'&&!request.input?.requirementId&&!request.input?.featureId;
export const requiresRepositoryLock=request=>!isLocalSave(request)||exclusiveLocalSaves.includes(request.operation)||createsRequirement(request);
export const projectionJobPredicate = `(json_extract(request_json,'$.operation') IN (${exclusiveLocalSaves.map(name=>`'${name}'`).join(',')}) OR (json_extract(request_json,'$.operation')='workflow.requirement.save' AND json_extract(request_json,'$.input.requirementId') IS NULL AND json_extract(request_json,'$.input.featureId') IS NULL) OR NOT (json_extract(request_json,'$.operation') IN (${localSaveOperations.map(name=>`'${name}'`).join(',')}) OR (json_extract(request_json,'$.operation')='workflow.review' AND json_extract(request_json,'$.input.stage')='gherkin')))`;
