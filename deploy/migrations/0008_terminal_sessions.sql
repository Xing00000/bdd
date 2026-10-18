PRAGMA foreign_keys=ON;
BEGIN IMMEDIATE;
CREATE TABLE terminal_sessions (
 id TEXT PRIMARY KEY NOT NULL,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 session_key TEXT NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE(project_id,session_key)
);
CREATE INDEX terminal_sessions_by_project ON terminal_sessions(project_id,created_at DESC);
CREATE TEMP TABLE migration_fk_check(failures INTEGER CHECK(failures=0));
INSERT INTO migration_fk_check SELECT count(*) FROM pragma_foreign_key_check;
DROP TABLE migration_fk_check;
PRAGMA user_version=8;
COMMIT;
PRAGMA foreign_keys=ON;
