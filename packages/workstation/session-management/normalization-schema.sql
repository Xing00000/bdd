-- Remove transitive scope fields; public read projections derive their values.
CREATE TABLE sm_bot_task_sessions_new(
 id TEXT PRIMARY KEY,bot_id TEXT NOT NULL,task_id TEXT NOT NULL REFERENCES sm_tasks(id),
 generation INTEGER NOT NULL DEFAULT 0,active_node_id TEXT,native_session_id TEXT,
 UNIQUE(bot_id,task_id),FOREIGN KEY(task_id,active_node_id) REFERENCES sm_nodes(task_id,id)
);
INSERT INTO sm_bot_task_sessions_new SELECT id,bot_id,task_id,generation,active_node_id,native_session_id FROM sm_bot_task_sessions;
DROP TABLE sm_bot_task_sessions;
ALTER TABLE sm_bot_task_sessions_new RENAME TO sm_bot_task_sessions;
CREATE TABLE sm_native_sessions_new(
 id TEXT PRIMARY KEY,logical_session_id TEXT NOT NULL REFERENCES sm_bot_task_sessions(id),
 generation INTEGER NOT NULL,adapter TEXT NOT NULL,native_id TEXT NOT NULL,created_at TEXT NOT NULL,
 UNIQUE(logical_session_id,generation)
);
INSERT INTO sm_native_sessions_new SELECT id,logical_session_id,generation,adapter,native_id,created_at FROM sm_native_sessions;
DROP TABLE sm_native_sessions;
ALTER TABLE sm_native_sessions_new RENAME TO sm_native_sessions;
CREATE TABLE sm_workers_new(
 id TEXT PRIMARY KEY,node_id TEXT NOT NULL REFERENCES sm_nodes(id),profile TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('RESERVED','RUNNING','UNKNOWN','STOPPED','FAILED')),
 write_access INTEGER NOT NULL CHECK(write_access IN (0,1)),external_id TEXT UNIQUE,turns INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL
);
INSERT INTO sm_workers_new SELECT id,node_id,profile,state,write_access,external_id,turns,created_at FROM sm_workers;
DROP TABLE sm_workers;
ALTER TABLE sm_workers_new RENAME TO sm_workers;
CREATE INDEX sm_workers_node ON sm_workers(node_id,state);
CREATE TABLE sm_results_new(
 id TEXT PRIMARY KEY,node_id TEXT NOT NULL UNIQUE REFERENCES sm_nodes(id),task_revision INTEGER NOT NULL,
 contract TEXT NOT NULL CHECK(json_valid(contract)),data TEXT NOT NULL CHECK(json_valid(data)),
 digest TEXT NOT NULL,producer TEXT NOT NULL CHECK(json_valid(producer)),approved_by TEXT,published_at TEXT NOT NULL
);
INSERT INTO sm_results_new SELECT id,node_id,task_revision,contract,data,digest,producer,approved_by,published_at FROM sm_results;
DROP TABLE sm_results;
ALTER TABLE sm_results_new RENAME TO sm_results;
CREATE TRIGGER sm_results_immutable_update BEFORE UPDATE ON sm_results BEGIN SELECT RAISE(ABORT,'immutable result'); END;
CREATE TRIGGER sm_results_immutable_delete BEFORE DELETE ON sm_results BEGIN SELECT RAISE(ABORT,'immutable result'); END;
CREATE TABLE sm_summary_sources(
 summary_id TEXT NOT NULL,ordinal INTEGER NOT NULL CHECK(ordinal>=0),event_id TEXT NOT NULL REFERENCES sm_events(id),
 PRIMARY KEY(summary_id,ordinal),FOREIGN KEY(summary_id) REFERENCES sm_summaries(id)
);
INSERT INTO sm_summary_sources SELECT s.id,CAST(j.key AS INTEGER),j.value FROM sm_summaries s,json_each(s.source_events) j;
CREATE TABLE sm_summaries_new(
 id TEXT PRIMARY KEY,memory_session_id TEXT NOT NULL REFERENCES sm_soul_memory(id),
 project_id TEXT,category TEXT NOT NULL,summary TEXT NOT NULL CHECK(length(summary) BETWEEN 1 AND 2000),created_at TEXT NOT NULL
);
INSERT INTO sm_summaries_new SELECT id,memory_session_id,project_id,category,summary,created_at FROM sm_summaries;
DROP TABLE sm_summaries;
ALTER TABLE sm_summaries_new RENAME TO sm_summaries;
CREATE INDEX sm_summaries_scope ON sm_summaries(memory_session_id,project_id);
CREATE VIEW sm_session_scope AS SELECT s.*,t.workstation_id FROM sm_bot_task_sessions s JOIN sm_tasks t ON t.id=s.task_id;
CREATE VIEW sm_native_session_scope AS SELECT n.*,s.workstation_id FROM sm_native_sessions n JOIN sm_session_scope s ON s.id=n.logical_session_id;
CREATE VIEW sm_worker_scope AS SELECT w.*,n.task_id FROM sm_workers w JOIN sm_nodes n ON n.id=w.node_id;
CREATE VIEW sm_result_scope AS SELECT r.*,n.task_id FROM sm_results r JOIN sm_nodes n ON n.id=r.node_id;
CREATE VIEW sm_summary_scope AS SELECT s.*,m.workstation_id,
 (SELECT json_group_array(event_id) FROM (SELECT event_id FROM sm_summary_sources WHERE summary_id=s.id ORDER BY ordinal)) source_events
 FROM sm_summaries s JOIN sm_soul_memory m ON m.id=s.memory_session_id;
CREATE TRIGGER sm_session_identity BEFORE UPDATE OF bot_id,task_id ON sm_bot_task_sessions BEGIN SELECT RAISE(ABORT,'immutable logical session identity'); END;
CREATE TRIGGER sm_worker_identity BEFORE UPDATE OF node_id ON sm_workers BEGIN SELECT RAISE(ABORT,'immutable worker owner'); END;
CREATE TRIGGER sm_summary_immutable BEFORE UPDATE ON sm_summaries BEGIN SELECT RAISE(ABORT,'immutable summary'); END;
CREATE TRIGGER sm_summary_source_immutable BEFORE UPDATE ON sm_summary_sources BEGIN SELECT RAISE(ABORT,'immutable summary source'); END;
CREATE TRIGGER sm_native_session_unique BEFORE INSERT ON sm_native_sessions BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM sm_native_session_scope n JOIN sm_session_scope s ON s.workstation_id=n.workstation_id
   WHERE s.id=NEW.logical_session_id AND n.adapter=NEW.adapter AND n.native_id=NEW.native_id)
 THEN RAISE(ABORT,'UNIQUE constraint failed: native session workstation adapter native_id') END;
END;
CREATE TRIGGER sm_native_session_immutable BEFORE UPDATE ON sm_native_sessions BEGIN SELECT RAISE(ABORT,'immutable native session'); END;
CREATE TRIGGER sm_worker_writer_insert BEFORE INSERT ON sm_workers WHEN NEW.write_access=1 AND NEW.state IN ('RESERVED','RUNNING','UNKNOWN') BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM sm_worker_scope WHERE task_id=(SELECT task_id FROM sm_nodes WHERE id=NEW.node_id) AND write_access=1 AND state IN ('RESERVED','RUNNING','UNKNOWN'))
 THEN RAISE(ABORT,'task already has an active writer') END;
END;
CREATE TRIGGER sm_worker_writer_update BEFORE UPDATE ON sm_workers WHEN NEW.write_access=1 AND NEW.state IN ('RESERVED','RUNNING','UNKNOWN') BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM sm_worker_scope WHERE id<>NEW.id AND task_id=(SELECT task_id FROM sm_nodes WHERE id=NEW.node_id) AND write_access=1 AND state IN ('RESERVED','RUNNING','UNKNOWN'))
 THEN RAISE(ABORT,'task already has an active writer') END;
END;
CREATE TRIGGER sm_summary_project_scope BEFORE INSERT ON sm_summaries WHEN NEW.project_id IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM sm_soul_memory m JOIN sm_projects p ON p.workstation_id=m.workstation_id
 WHERE m.id=NEW.memory_session_id AND p.id=NEW.project_id) THEN RAISE(ABORT,'summary project scope mismatch') END;
END;
CREATE TRIGGER sm_summary_source_scope BEFORE INSERT ON sm_summary_sources BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM sm_summary_scope s JOIN sm_events e ON e.id=NEW.event_id
 JOIN sm_rooms r ON r.id=e.room_id JOIN sm_tasks t ON t.id=r.task_id
 WHERE s.id=NEW.summary_id AND s.workstation_id=t.workstation_id AND (s.project_id IS NULL OR s.project_id=t.project_id))
 THEN RAISE(ABORT,'summary source scope mismatch') END;
END;
