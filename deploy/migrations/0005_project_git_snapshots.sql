PRAGMA foreign_keys=OFF;
BEGIN IMMEDIATE;
CREATE TABLE git_snapshots_new (
 spec_version_id TEXT NOT NULL REFERENCES document_versions(id),
 project_id TEXT REFERENCES projects(id),
 repository_url TEXT NOT NULL,branch_ref TEXT NOT NULL,commit_sha TEXT NOT NULL,file_path TEXT NOT NULL,
 PRIMARY KEY(spec_version_id,project_id)
);
INSERT INTO git_snapshots_new
SELECT g.spec_version_id,
 CASE WHEN d.project_id IS NOT NULL THEN d.project_id
 WHEN (SELECT count(*) FROM projects WHERE workspace_ref=g.repository_url)=1
 THEN (SELECT id FROM projects WHERE workspace_ref=g.repository_url)
 ELSE NULL END,
 g.repository_url,g.branch_ref,g.commit_sha,g.file_path
FROM git_snapshots g JOIN document_versions v ON v.id=g.spec_version_id JOIN documents d ON d.id=v.document_id;
DROP TABLE git_snapshots; ALTER TABLE git_snapshots_new RENAME TO git_snapshots;
CREATE TEMP TABLE migration_fk_check(failures INTEGER CHECK(failures=0));
INSERT INTO migration_fk_check SELECT count(*) FROM pragma_foreign_key_check;
DROP TABLE migration_fk_check;
PRAGMA user_version=5;
COMMIT;
PRAGMA foreign_keys=ON;
