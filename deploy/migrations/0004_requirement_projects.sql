PRAGMA foreign_keys=OFF;
BEGIN IMMEDIATE;
CREATE TABLE requirement_projects (
 requirement_id TEXT NOT NULL REFERENCES requirements(id),
 project_id TEXT NOT NULL REFERENCES projects(id),
 PRIMARY KEY(requirement_id,project_id)
);
CREATE TABLE requirements_new (
 id TEXT PRIMARY KEY NOT NULL,
 requirement_key TEXT NOT NULL CHECK(length(trim(requirement_key))>0)
);
CREATE TABLE documents_new (
 id TEXT PRIMARY KEY NOT NULL,
 project_id TEXT REFERENCES projects(id),
 requirement_id TEXT REFERENCES requirements(id),
 kind TEXT NOT NULL CHECK(kind IN ('gherkin','sd','spec')),
 purpose TEXT NOT NULL CHECK(purpose IN ('requirement','target_ci','integration','recording')),
 file_name TEXT NOT NULL,
 feature_id TEXT REFERENCES features(id),
 CHECK((purpose='requirement' AND kind IN ('gherkin','sd') AND requirement_id IS NOT NULL AND project_id IS NULL)
 OR (purpose='target_ci' AND kind='spec' AND requirement_id IS NOT NULL AND project_id IS NULL)
 OR (purpose IN ('integration','recording') AND kind='spec' AND project_id IS NOT NULL))
);
CREATE TABLE runs_new (
 id TEXT PRIMARY KEY NOT NULL,
 project_id TEXT REFERENCES projects(id),
 requirement_id TEXT REFERENCES requirements(id),
 origin TEXT NOT NULL CHECK(origin IN ('target_ci','integration','recording')),
 execution_scope TEXT NOT NULL CHECK(execution_scope IN ('SELECTED_CASES','ALL_REQUIRED','INDEPENDENT')),
 baseline_id TEXT REFERENCES baselines(id),
 script_version_id TEXT REFERENCES document_versions(id),
 connection_id TEXT REFERENCES target_connections(id),
 candidate_commit TEXT,tested_commit TEXT,source_ref TEXT,
 definition_snapshot_json TEXT NOT NULL,environment_snapshot_json TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('NOT_RUN','RUNNING','PASSED','FAILED','INCOMPLETE','INVALID')),
 feature_id TEXT REFERENCES features(id),
 CHECK((origin='target_ci' AND requirement_id IS NOT NULL AND baseline_id IS NOT NULL AND execution_scope IN ('SELECTED_CASES','ALL_REQUIRED'))
 OR (origin IN ('integration','recording') AND project_id IS NOT NULL AND script_version_id IS NOT NULL AND execution_scope='INDEPENDENT'))
);
INSERT INTO requirement_projects SELECT id,project_id FROM requirements;
INSERT INTO requirements_new SELECT id,requirement_key FROM requirements;
INSERT INTO documents_new SELECT id,CASE WHEN purpose IN ('requirement','target_ci') THEN NULL ELSE project_id END,requirement_id,kind,purpose,file_name,feature_id FROM documents;
INSERT INTO runs_new SELECT id,project_id,requirement_id,origin,execution_scope,baseline_id,script_version_id,connection_id,candidate_commit,tested_commit,source_ref,definition_snapshot_json,environment_snapshot_json,status,feature_id FROM runs;
DROP TABLE documents;
DROP TABLE runs;
DROP TABLE requirements;
ALTER TABLE requirements_new RENAME TO requirements;
ALTER TABLE documents_new RENAME TO documents;
ALTER TABLE runs_new RENAME TO runs;
CREATE UNIQUE INDEX one_feature_document ON documents(feature_id,kind) WHERE purpose IN ('requirement','target_ci');
CREATE INDEX requirements_by_key ON requirements(requirement_key);
CREATE INDEX requirements_by_project ON requirement_projects(project_id,requirement_id);
CREATE TRIGGER documents_feature_insert BEFORE INSERT ON documents
WHEN NEW.purpose IN ('requirement','target_ci')
BEGIN
 SELECT CASE WHEN NEW.feature_id IS NULL OR NOT EXISTS(SELECT 1 FROM features WHERE id=NEW.feature_id AND requirement_id=NEW.requirement_id)
 THEN RAISE(ABORT,'Feature must belong to requirement') END;
END;
CREATE TRIGGER documents_feature_update BEFORE UPDATE ON documents
WHEN NEW.purpose IN ('requirement','target_ci')
BEGIN
 SELECT CASE WHEN NEW.feature_id IS NULL OR NOT EXISTS(SELECT 1 FROM features WHERE id=NEW.feature_id AND requirement_id=NEW.requirement_id)
 THEN RAISE(ABORT,'Feature must belong to requirement') END;
END;
CREATE TRIGGER runs_feature_insert BEFORE INSERT ON runs
WHEN NEW.origin='target_ci'
BEGIN
 SELECT CASE WHEN NEW.feature_id IS NULL OR NOT EXISTS(SELECT 1 FROM features WHERE id=NEW.feature_id AND requirement_id=NEW.requirement_id)
 THEN RAISE(ABORT,'Feature must belong to requirement') END;
END;
CREATE TRIGGER runs_feature_update BEFORE UPDATE ON runs
WHEN NEW.origin='target_ci'
BEGIN
 SELECT CASE WHEN NEW.feature_id IS NULL OR NOT EXISTS(SELECT 1 FROM features WHERE id=NEW.feature_id AND requirement_id=NEW.requirement_id)
 THEN RAISE(ABORT,'Feature must belong to requirement') END;
END;
CREATE TEMP TABLE migration_fk_check(failures INTEGER CHECK(failures=0));
INSERT INTO migration_fk_check SELECT count(*) FROM pragma_foreign_key_check;
DROP TABLE migration_fk_check;
PRAGMA user_version=4;
COMMIT;
PRAGMA foreign_keys=ON;
