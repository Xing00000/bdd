CREATE TABLE terminal_sessions (
 id TEXT PRIMARY KEY NOT NULL,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 session_key TEXT NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE(project_id,session_key)
);
CREATE INDEX terminal_sessions_by_project ON terminal_sessions(project_id,created_at DESC);
