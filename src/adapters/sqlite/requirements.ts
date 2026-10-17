import type {MetadataMigration} from './migrations.ts';

export const requirementMigration:MetadataMigration={
 id:'0004_requirement_projects',fromVersion:3,toVersion:4,rebuildTables:true,
 dmlReason:'Preserve existing requirement identities and associate their former project through the many-to-many relation; preserve all document and run evidence.',
 steps:[{kind:'ddl',sql:`
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
);`},{kind:'dml',sql:`
INSERT INTO requirement_projects SELECT id,project_id FROM requirements;
INSERT INTO requirements_new SELECT id,requirement_key FROM requirements;
INSERT INTO documents_new SELECT id,CASE WHEN purpose IN ('requirement','target_ci') THEN NULL ELSE project_id END,requirement_id,kind,purpose,file_name,feature_id FROM documents;
INSERT INTO runs_new SELECT id,project_id,requirement_id,origin,execution_scope,baseline_id,script_version_id,connection_id,candidate_commit,tested_commit,source_ref,definition_snapshot_json,environment_snapshot_json,status,feature_id FROM runs;
`},{kind:'ddl',sql:`
DROP TABLE documents;
DROP TABLE runs;
DROP TABLE requirements;
ALTER TABLE requirements_new RENAME TO requirements;
ALTER TABLE documents_new RENAME TO documents;
ALTER TABLE runs_new RENAME TO runs;
CREATE UNIQUE INDEX one_feature_document ON documents(feature_id,kind) WHERE purpose IN ('requirement','target_ci');
CREATE INDEX requirements_by_key ON requirements(requirement_key);
CREATE INDEX requirements_by_project ON requirement_projects(project_id,requirement_id);
`},...(['documents','runs'] as const).flatMap(table=>(['INSERT','UPDATE'] as const).map(operation=>({kind:'ddl' as const,sql:`
CREATE TRIGGER ${table}_feature_${operation.toLowerCase()} BEFORE ${operation} ON ${table}
WHEN ${table==='documents'?"NEW.purpose IN ('requirement','target_ci')":"NEW.origin='target_ci'"}
BEGIN
 SELECT CASE WHEN NEW.feature_id IS NULL OR NOT EXISTS(SELECT 1 FROM features WHERE id=NEW.feature_id AND requirement_id=NEW.requirement_id)
 THEN RAISE(ABORT,'Feature must belong to requirement') END;
END;`})))],
};

export const projectGitMigration:MetadataMigration={
 id:'0005_project_git_snapshots',fromVersion:4,toVersion:5,rebuildTables:true,
 dmlReason:'Preserve legacy Git receipts under an exact registered repository owner when identifiable; retain unmatched historical receipts without inventing a project association, and retain separate receipts when one BDD version is exported to multiple repositories.',
 steps:[{kind:'ddl',sql:`CREATE TABLE git_snapshots_new (
 spec_version_id TEXT NOT NULL REFERENCES document_versions(id),
 project_id TEXT REFERENCES projects(id),
 repository_url TEXT NOT NULL,branch_ref TEXT NOT NULL,commit_sha TEXT NOT NULL,file_path TEXT NOT NULL,
 PRIMARY KEY(spec_version_id,project_id)
);`},{kind:'dml',sql:`INSERT INTO git_snapshots_new
SELECT g.spec_version_id,
 CASE WHEN d.project_id IS NOT NULL THEN d.project_id
 WHEN (SELECT count(*) FROM projects WHERE workspace_ref=g.repository_url)=1
 THEN (SELECT id FROM projects WHERE workspace_ref=g.repository_url)
 ELSE NULL END,
 g.repository_url,g.branch_ref,g.commit_sha,g.file_path
FROM git_snapshots g JOIN document_versions v ON v.id=g.spec_version_id JOIN documents d ON d.id=v.document_id;`},
 {kind:'ddl',sql:'DROP TABLE git_snapshots; ALTER TABLE git_snapshots_new RENAME TO git_snapshots;'}],
};

export const defaultExampleMigration:MetadataMigration={
 id:'0006_default_example',fromVersion:5,toVersion:6,
 dmlReason:'No seed rows are inserted by migration. The application creates its one-time default example through the metadata owner; soft deletion preserves its tombstone and evidence.',
 steps:[{kind:'ddl',sql:`
ALTER TABLE requirements ADD COLUMN is_default_example INTEGER NOT NULL DEFAULT 0 CHECK(is_default_example IN (0,1));
ALTER TABLE requirements ADD COLUMN deleted_at TEXT;
CREATE UNIQUE INDEX one_default_example ON requirements(is_default_example) WHERE is_default_example=1;`}],
};
