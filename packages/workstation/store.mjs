import {installPromptCatalog,migrateAgentPrompts} from './prompt-catalog.mjs';
import {installAgentCatalog,agentCatalogMethods} from './agent-catalog.mjs';
import {installAgentSupervisorSchema} from './agent-supervisor.mjs';
import { DatabaseSync } from 'node:sqlite';
import { installDraftSchema, draftMethods, isLocalSave, requiresRepositoryLock, projectionJobPredicate } from './draft-store.mjs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync, chmodSync } from 'node:fs';
import { normalizeStoredRequest } from './migrate.mjs';
import { invariant, identity, errorResult } from '../contracts/index.mjs';
import {installProgressSchema,appendExecutionLog} from '../git-core/progress-store.mjs';
import {interactionType,interactionKey,validateInteractionKey,llmInteractionPredicate} from './interaction-types.mjs';
import {interactionTypes} from '../contracts/schemas.mjs';
const messageFields=['prompt','description','message','content','title','name'];
const interactionMessage=request=>messageFields.map(field=>request.input?.[field]).find(value=>typeof value==='string')??'';

export function openStore(home) {
  const db = new DatabaseSync(path.join(home, 'metadata.sqlite'));
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  invariant(version >= 0 && version <= 12, 'METADATA_VERSION_UNSUPPORTED', 'Do not open a newer workstation database with an older binary');
  if (version > 0 && version < 3) {
    const backup = path.join(home, 'before-repository-model-v3.sqlite');
    if (!existsSync(backup)) { db.prepare('VACUUM INTO ?').run(backup); chmodSync(backup, 0o600); }
  }
  if(version>0&&version<5) {
    const backup=path.join(home,'before-authoring-v5.sqlite');
    if(!existsSync(backup)){db.prepare('VACUUM INTO ?').run(backup);chmodSync(backup,0o600);}
  }
  if(version>0&&version<6) {
    const backup=path.join(home,'before-requirement-editor-v6.sqlite');
    if(!existsSync(backup)){db.prepare('VACUUM INTO ?').run(backup);chmodSync(backup,0o600);}
  }
  if(version>0&&version<7) { const backup=path.join(home,'before-catalog-regression-v7.sqlite'); if(!existsSync(backup)){db.prepare('VACUUM INTO ?').run(backup);chmodSync(backup,0o600);} }
  if(version>0&&version<8) { const backup=path.join(home,'before-local-directories-v8.sqlite'); if(!existsSync(backup)){db.prepare('VACUUM INTO ?').run(backup);chmodSync(backup,0o600);} }
  if(version>0&&version<11){const backup=path.join(home,'before-agent-catalog-v11.sqlite');if(!existsSync(backup)){db.prepare('VACUUM INTO ?').run(backup);chmodSync(backup,0o600);}}
  if(version>0&&version<12){const backup=path.join(home,'before-prompt-catalog-v12.sqlite');if(!existsSync(backup)){db.prepare('VACUUM INTO ?').run(backup);chmodSync(backup,0o600);}}
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
    CREATE TABLE IF NOT EXISTS repository_preferences (
      repository_id TEXT PRIMARY KEY REFERENCES spec_repositories(id), settings_json TEXT NOT NULL, sync_json TEXT
    );
    CREATE TABLE IF NOT EXISTS requirement_proposals (
      id TEXT PRIMARY KEY, repository_id TEXT NOT NULL REFERENCES spec_repositories(id),
      editor_key TEXT NOT NULL, description TEXT NOT NULL, original_gherkin TEXT NOT NULL,
      generated_gherkin TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS proposals_by_editor ON requirement_proposals(repository_id,editor_key,created_at);
    CREATE TABLE IF NOT EXISTS repository_connections (
      repository_id TEXT PRIMARY KEY REFERENCES spec_repositories(id), receipt_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS regressions (
      id TEXT NOT NULL, repository_id TEXT NOT NULL REFERENCES spec_repositories(id), operation_id TEXT NOT NULL,
      status TEXT NOT NULL, result_json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(repository_id,id)
    );
    CREATE TABLE IF NOT EXISTS repository_location_history (
      repository_id TEXT NOT NULL REFERENCES spec_repositories(id), operation_id TEXT NOT NULL,
      previous_path TEXT NOT NULL, local_path TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(repository_id,operation_id)
    );
    PRAGMA user_version=12;
  `);
  if(!db.prepare('PRAGMA table_info(spec_repositories)').all().some(c=>c.name==='local_path')) db.exec('ALTER TABLE spec_repositories ADD COLUMN local_path TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS unique_repository_local_path ON spec_repositories(local_path) WHERE local_path IS NOT NULL');
  installAgentCatalog(db);
  installPromptCatalog(db);
  installDraftSchema(db);
  installProgressSchema(db);
  installAgentSupervisorSchema(db);
  if(!db.prepare('PRAGMA table_info(operations)').all().some(column=>column.name==='interaction_type'))db.exec('ALTER TABLE operations ADD COLUMN interaction_type TEXT');
  const typeFor=request=>interactionType(request,request.input?.parentOperationId?db.prepare('SELECT interaction_type FROM operations WHERE id=?').get(request.input.parentOperationId)?.interaction_type:undefined);
  for(const row of db.prepare('SELECT id,request_json FROM operations WHERE interaction_type IS NULL ORDER BY rowid').iterate())db.prepare('UPDATE operations SET interaction_type=? WHERE id=?').run(typeFor(JSON.parse(row.request_json)),row.id);
  if(!db.prepare('PRAGMA table_info(operations)').all().some(column=>column.name==='interaction_key'))db.exec('ALTER TABLE operations ADD COLUMN interaction_key TEXT');
  for(const row of db.prepare(`SELECT id,request_json,result_json FROM operations WHERE interaction_key IS NULL AND ${llmInteractionPredicate()} ORDER BY rowid`).all())db.prepare('UPDATE operations SET interaction_key=? WHERE id=?').run(keyFor(JSON.parse(row.request_json),row.result_json?JSON.parse(row.result_json):null),row.id);
  db.exec('CREATE INDEX IF NOT EXISTS interactions_by_feature ON operations(repository_id,interaction_key,interaction_type)');
  db.exec(`DROP INDEX IF EXISTS one_writer_per_repository; CREATE UNIQUE INDEX one_writer_per_repository ON operations(repository_id) WHERE status IN ('QUEUED','RUNNING','CANCELLING') AND ${projectionJobPredicate};`);
  if(version<11){const catalog=agentCatalogMethods(db,callback=>callback());for(const row of db.prepare('SELECT repository_id,settings_json FROM repository_preferences').all())catalog.ensureAgentDefaults(row.repository_id,JSON.parse(row.settings_json).agent);}
  if(version<12)migrateAgentPrompts(db);
  db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  function keyFor(request,result){
    const parent=request.input?.parentOperationId?db.prepare('SELECT interaction_key FROM operations WHERE id=? AND repository_id=?').get(request.input.parentOperationId,request.repositoryId):null;
    let key=interactionKey(request,parent?.interaction_key);
    if(key?.startsWith('new-')){
      const proposal=result?.proposalId?db.prepare('SELECT editor_key FROM requirement_proposals WHERE id=? AND repository_id=?').get(result.proposalId,request.repositoryId):null;
      const saved=db.prepare("SELECT json_extract(history.result_json,'$.key') key FROM authoring_history history JOIN operations saved ON saved.id=history.operation_id AND saved.repository_id=history.repository_id AND saved.request_hash=history.request_hash WHERE history.repository_id=? AND json_extract(saved.request_json,'$.operation')='workflow.requirement.save' AND json_extract(saved.request_json,'$.input.editorKey')=? ORDER BY history.revision DESC LIMIT 1").get(request.repositoryId,key);
      key=proposal?.editor_key??saved?.key??key;
    }
    return key;
  }
  const decode = row => row ? { ...row,isLlmInteraction:Boolean(row.isLlmInteraction),interactionType:row.interaction_type,interactionKey:row.interaction_key, request: JSON.parse(row.request_json), result: row.result_json ? JSON.parse(row.result_json) : null, error: row.error_json ? JSON.parse(row.error_json) : null } : null;
  const operationColumns=`*,${llmInteractionPredicate()} isLlmInteraction`;
  const get = operationId => decode(db.prepare(`SELECT ${operationColumns} FROM operations WHERE id=?`).get(operationId));
  const atomic=callback=>{const own=!db.isTransaction;if(own)db.exec('BEGIN IMMEDIATE');try{const result=callback();if(own)db.exec('COMMIT');return result;}catch(error){if(own)db.exec('ROLLBACK');throw error;}};
  return {
    ...draftMethods(db),
    ...agentCatalogMethods(db,atomic),
    chatStorage(schemaSql) {
      atomic(()=>{if(!db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='chat_rooms'").get())db.exec(schemaSql);});
      const execute=command=>{const statement=db.prepare(command.sql),result=command.mode==='all'?statement.all(...(command.params??[])):statement.run(...(command.params??[]));
        if(command.expectChanges!==undefined)invariant(Number(result.changes)===command.expectChanges,'STATE_CHANGED','Chat state changed concurrently',409);
        if(command.expectRows!==undefined)invariant(result.length===command.expectRows,'STATE_CHANGED','Chat state changed concurrently',409);return result;};
      return {async all(sql,params=[]){return db.prepare(sql).all(...params);},async run(sql,params=[]){return db.prepare(sql).run(...params);},async batch(commands){return atomic(()=>commands.map(execute));}};
    },
    connection(repositoryId) { const row=db.prepare('SELECT receipt_json FROM repository_connections WHERE repository_id=?').get(repositoryId);return row?JSON.parse(row.receipt_json):null; },
    setConnection(repositoryId, value) { db.prepare('INSERT INTO repository_connections VALUES(?,?) ON CONFLICT(repository_id) DO UPDATE SET receipt_json=excluded.receipt_json').run(repositoryId,JSON.stringify(value)); },
    regression(repositoryId, batchId) { const row=db.prepare('SELECT result_json FROM regressions WHERE id=? AND repository_id=?').get(batchId,repositoryId);return row?JSON.parse(row.result_json):null; },
    regressions(repositoryId) { return db.prepare('SELECT result_json FROM regressions WHERE repository_id=? ORDER BY updated_at DESC LIMIT 100').all(repositoryId).map(x=>JSON.parse(x.result_json)); },
    recordRegression(repositoryId, value) { db.prepare('INSERT INTO regressions VALUES(?,?,?,?,?,?) ON CONFLICT(repository_id,id) DO UPDATE SET operation_id=excluded.operation_id,status=excluded.status,result_json=excluded.result_json,updated_at=excluded.updated_at').run(value.batchId,repositoryId,value.operationId,value.status,JSON.stringify(value),new Date().toISOString()); },
    interruptRegression(operationId, status) {
      for(const row of db.prepare("SELECT repository_id,result_json FROM regressions WHERE operation_id=? AND status='RUNNING'").all(operationId)) {
        const value=JSON.parse(row.result_json);value.status=status;value.outcome='INCOMPLETE';value.finishedAt=new Date().toISOString();
        value.results=value.results.map(x=>['RUNNING','PENDING'].includes(x.outcome)?{...x,outcome:status}:x);this.recordRegression(row.repository_id,value);
      }
    },
    saveRequirementProposal(repositoryId, { editorKey, description, previousGherkin, gherkin, creationOperationId }) {
      const proposalId=creationOperationId?`creation-${identity({repositoryId,creationOperationId})}`:randomUUID(), createdAt=new Date().toISOString();
      const previous=db.prepare('SELECT * FROM requirement_proposals WHERE id=?').get(proposalId);
      if(previous) {
        invariant(previous.repository_id===repositoryId&&previous.description===description&&previous.original_gherkin===previousGherkin&&previous.generated_gherkin===gherkin,
          'OPERATION_ID_CONFLICT','操作識別碼已被其他建立內容使用。',409);
        return {proposalId,createdAt:previous.created_at};
      }
      db.prepare('INSERT INTO requirement_proposals VALUES(?,?,?,?,?,?,?)').run(proposalId,repositoryId,editorKey,description,previousGherkin,gherkin,createdAt);
      return {proposalId,createdAt};
    },
    requirementProposals(repositoryId,editorKey) {
      return db.prepare('SELECT id,description,original_gherkin originalGherkin,generated_gherkin generatedGherkin,created_at createdAt FROM requirement_proposals WHERE repository_id=? AND editor_key=? ORDER BY created_at DESC,rowid DESC LIMIT 20').all(repositoryId,editorKey);
    },
    close() { db.close(); },
    repositories() { return db.prepare('SELECT id,title,remote_url remoteUrl,branch,local_path localPath,created_at createdAt FROM spec_repositories ORDER BY created_at').all(); },
    repository(repositoryId) {
      const row = db.prepare('SELECT id,title,remote_url remoteUrl,branch,local_path localPath,created_at createdAt FROM spec_repositories WHERE id=?').get(repositoryId);
      invariant(row, 'REPOSITORY_NOT_FOUND', 'Spec repository not found', 404); return row;
    },
    register(input) {
      invariant(!db.prepare('SELECT id FROM spec_repositories WHERE id=?').get(input.id), 'REPOSITORY_EXISTS', 'Spec repository ID already exists', 409);
      db.prepare('INSERT INTO spec_repositories(id,title,remote_url,branch,created_at,local_path) VALUES(?,?,?,?,?,?)')
        .run(input.id, input.title, input.remoteUrl, input.branch ?? null, new Date().toISOString(), input.localPath ?? null);
      return this.repository(input.id);
    },
    setRepositoryLocation(repositoryId, expectedStoredPath, localPath, previousPath, operationId, validate) {
      db.exec('BEGIN IMMEDIATE');
      try {
        validate();
        invariant(db.prepare('UPDATE spec_repositories SET local_path=? WHERE id=? AND local_path IS ?').run(localPath,repositoryId,expectedStoredPath??null).changes===1,'LOCAL_PATH_CHANGED','目錄設定已被更新，未覆寫。',409);
        db.prepare('INSERT INTO repository_location_history VALUES(?,?,?,?,?)').run(repositoryId,operationId,previousPath,localPath,new Date().toISOString());
        db.prepare('DELETE FROM repository_projection WHERE repository_id=?').run(repositoryId);
        db.prepare('DELETE FROM repository_connections WHERE repository_id=?').run(repositoryId);
        db.exec('COMMIT');
      } catch(error) { db.exec('ROLLBACK'); throw error; }
    },
    updateOrigin(repositoryId, url) { db.prepare('UPDATE spec_repositories SET remote_url=? WHERE id=?').run(url, repositoryId); },
    check(repositoryId, featureKey) {
      const value = db.prepare('SELECT result_json FROM tooling_checks WHERE repository_id=? AND feature_key=?').get(repositoryId, featureKey);
      return value ? JSON.parse(value.result_json) : null;
    },
    recordCheck(repositoryId, featureKey, value) {
      db.prepare('INSERT INTO tooling_checks VALUES(?,?,?,?) ON CONFLICT(repository_id,feature_key) DO UPDATE SET digest=excluded.digest,result_json=excluded.result_json').run(repositoryId, featureKey, value.digest, JSON.stringify(value));
    },
    preferences(repositoryId) { const row=db.prepare('SELECT settings_json FROM repository_preferences WHERE repository_id=?').get(repositoryId); return row ? JSON.parse(row.settings_json) : null; },
    setPreferences(repositoryId, settings) { db.prepare('INSERT INTO repository_preferences(repository_id,settings_json) VALUES(?,?) ON CONFLICT(repository_id) DO UPDATE SET settings_json=excluded.settings_json').run(repositoryId,JSON.stringify(settings)); },
    syncReceipt(repositoryId) { const row=db.prepare('SELECT sync_json FROM repository_preferences WHERE repository_id=?').get(repositoryId); return row?.sync_json ? JSON.parse(row.sync_json) : null; },
    setSyncReceipt(repositoryId, receipt) { db.prepare('UPDATE repository_preferences SET sync_json=? WHERE repository_id=?').run(JSON.stringify(receipt),repositoryId); },
    get,
    operations(repositoryId) { return db.prepare(`SELECT ${operationColumns} FROM operations WHERE repository_id=? ORDER BY created_at DESC LIMIT 100`).all(repositoryId).map(decode); },
    interactions(repositoryId,{before,limit=20,type,key}={}) {
      invariant(Number.isInteger(limit)&&limit>=1&&limit<=50&&(before===undefined||Number.isSafeInteger(before)&&before>0),'INVALID_HISTORY_CURSOR','Invalid history cursor');
      invariant(type===undefined||interactionTypes.includes(type),'INVALID_INTERACTION_TYPE','Invalid interaction type');
      if(key!==undefined)validateInteractionKey(key);
      const message=`COALESCE(${messageFields.map(field=>`json_extract(request_json,'$.input.${field}')`).join(',')},'')`;
      const rows=db.prepare(`SELECT rowid cursor,id,repository_id repositoryId,status,created_at createdAt,finished_at finishedAt,interaction_type interactionType,interaction_key interactionKey,1 isLlmInteraction,
        json_extract(request_json,'$.operation') operation,substr(${message},1,2000) message,length(${message})>2000 messageTruncated,
        json_extract(request_json,'$.input.requirementId') requirementId,json_extract(request_json,'$.input.featureId') featureId,json_extract(request_json,'$.input.parentOperationId') parentOperationId,
        json_extract(error_json,'$.message') error FROM operations WHERE repository_id=? AND ${llmInteractionPredicate()} AND (? IS NULL OR rowid<?) AND (? IS NULL OR interaction_type=?) AND (? IS NULL OR interaction_key=?) ORDER BY rowid DESC LIMIT ?`).all(repositoryId,before??null,before??null,type??null,type??null,key??null,key??null,limit+1);
      const hasMore=rows.length>limit;return {entries:rows.slice(0,limit),nextCursor:hasMore?rows[limit-1].cursor:null};
    },
    interaction(operationId){const operation=get(operationId);invariant(operation,'OPERATION_NOT_FOUND','Operation not found',404);return {id:operationId,message:interactionMessage(operation.request)};},
    enqueue(request) {
      const hash = identity(request);
      db.exec('BEGIN IMMEDIATE');
      try {
        const previous = get(request.operationId);
        if (previous) {
          invariant(previous.request_hash === hash, 'OPERATION_ID_CONFLICT', 'An operation ID cannot be reused with different input', 409);
          db.exec('COMMIT'); return previous;
        }
        const busy = requiresRepositoryLock(request) && db.prepare(`SELECT id FROM operations WHERE repository_id=? AND status IN ('QUEUED','RUNNING','CANCELLING') AND ${projectionJobPredicate}`).get(request.repositoryId);
        invariant(!busy, 'REPOSITORY_BUSY', `Spec repository has an active operation ${busy?.id ?? ''}`, 409);
        const type=interactionType(request,request.input?.parentOperationId?get(request.input.parentOperationId)?.interaction_type:undefined);
        db.prepare("INSERT INTO operations(id,repository_id,request_hash,request_json,status,created_at,interaction_type,interaction_key) VALUES(?,?,?,?,'QUEUED',?,?,?)")
          .run(request.operationId, request.repositoryId, hash, JSON.stringify(request), new Date().toISOString(),type,keyFor(request));
        appendExecutionLog(db,request.operationId,`[QUEUED] ${request.operation}\n`);
        db.exec('COMMIT'); return get(request.operationId);
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    claim(operationId) {
      return atomic(()=>{
      const changed=db.prepare("UPDATE operations SET status='RUNNING',worker_pid=?,started_at=? WHERE id=? AND status='QUEUED'")
        .run(process.pid, new Date().toISOString(), operationId).changes === 1;
      if(changed)appendExecutionLog(db,operationId,'[RUNNING]\n');return changed;
      });
    },
    requestCancellation(operationId) {
      db.prepare("UPDATE operations SET status='CANCELLING' WHERE id=? AND status IN ('QUEUED','RUNNING')").run(operationId);
      return get(operationId);
    },
    finish(operationId, status, result, error) {
      return atomic(()=>{
      if (get(operationId)?.status === 'CANCELLING' && status !== 'CANCELLED') return get(operationId);
      const changed=db.prepare("UPDATE operations SET status=?,result_json=?,error_json=?,finished_at=? WHERE id=? AND status IN ('QUEUED','RUNNING','CANCELLING')")
        .run(status, result === undefined ? null : JSON.stringify(result), error ? JSON.stringify(errorResult(error)) : null, new Date().toISOString(), operationId);
      if(changed.changes)appendExecutionLog(db,operationId,`[${status}]\n`);
      if(changed.changes)for(const row of db.prepare("SELECT id FROM operations WHERE json_extract(request_json,'$.operation')='interaction.cli.input' AND json_extract(request_json,'$.input.parentOperationId')=? AND status IN ('QUEUED','RUNNING','CANCELLING')").all(operationId)) {
        const child=get(row.id),delivered=child.result?.delivery==='sent';
        this.finish(child.id,!delivered&&status==='SUCCEEDED'?'FAILED':status,{...child.result,reason:delivered?'PARENT_FINISHED':'NOT_DELIVERED',parentStatus:status},!delivered?{code:'CLI_INPUT_NOT_DELIVERED',message:'輸入未取得 CLI 送達確認。'}:error);
      }
      if (['INTERRUPTED','CANCELLED','FAILED'].includes(status)) this.interruptRegression(operationId,status);
      return get(operationId);
      });
    },
    acknowledgeInput(parentId,operationId,previousId) {
      return atomic(()=>{
        const current=get(operationId);invariant(current?.request.operation==='interaction.cli.input'&&current.request.input.parentOperationId===parentId&&current.status==='RUNNING','INVALID_INPUT_RECEIPT','輸入不屬於此 CLI 作業。');
        if(current.result?.delivery==='sent')return;
        db.prepare('UPDATE operations SET result_json=? WHERE id=?').run(JSON.stringify({delivery:'sent',sentAt:new Date().toISOString()}),operationId);appendExecutionLog(db,operationId,'[INPUT SENT]\n');
        if(previousId){const previous=get(previousId);if(previous?.request.operation==='interaction.cli.input'&&previous.request.input.parentOperationId===parentId&&previous.result?.delivery==='sent')this.finish(previousId,'SUCCEEDED',{...previous.result,reason:'NEXT_INPUT'});}
      });
    },
    recover() {
      // A worker may die after committing SQLite but before updating its job row.
      // Recover the transaction receipt instead of falsely reporting a failed save.
      for(const row of db.prepare("SELECT id,repository_id,request_json FROM operations WHERE status IN ('QUEUED','RUNNING','INTERRUPTED')").all()) {
        const request=JSON.parse(row.request_json);
        if(!isLocalSave(request))continue;
        const receipt=this.draftReceipt(row.repository_id,row.id,request);
        if(receipt)db.prepare("UPDATE operations SET status='SUCCEEDED',result_json=?,error_json=NULL,finished_at=? WHERE id=?").run(JSON.stringify(receipt),new Date().toISOString(),row.id);
      }
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
