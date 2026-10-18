CREATE TABLE git_snapshots_new (
 spec_version_id TEXT NOT NULL REFERENCES document_versions(id),
 project_id TEXT REFERENCES projects(id),
 repository_url TEXT NOT NULL,branch_ref TEXT NOT NULL,commit_sha TEXT NOT NULL,file_path TEXT NOT NULL,
 PRIMARY KEY(spec_version_id,project_id)
);
DROP TABLE git_snapshots; ALTER TABLE git_snapshots_new RENAME TO git_snapshots;
