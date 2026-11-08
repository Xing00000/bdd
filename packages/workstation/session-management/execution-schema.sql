-- Execution schema v2. Loaded only by the SessionManager migration owner.
CREATE TABLE sm_execution_host(
  workstation_id TEXT PRIMARY KEY REFERENCES sm_workstations(id),
  owner TEXT NOT NULL UNIQUE, pid INTEGER NOT NULL CHECK(pid>0),
  state TEXT NOT NULL CHECK(state IN ('ACTIVE','UNKNOWN','STOPPED')),
  recorded_at TEXT NOT NULL
);
CREATE TABLE sm_execution_control(
  task_id TEXT PRIMARY KEY REFERENCES sm_tasks(id),
  requested_state TEXT NOT NULL CHECK(requested_state IN ('RUNNING','PAUSED','CANCELLED')),
  version INTEGER NOT NULL CHECK(version>0), requested_at TEXT NOT NULL
);
-- Profile definitions remain owned by immutable sm_catalog revisions.
CREATE TABLE sm_execution_profiles(
  task_id TEXT NOT NULL REFERENCES sm_tasks(id), profile_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0),
  PRIMARY KEY(task_id,profile_id,revision)
);
CREATE TRIGGER sm_execution_profile_scope BEFORE INSERT ON sm_execution_profiles BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM sm_tasks t JOIN sm_catalog c ON c.workstation_id=t.workstation_id
    WHERE t.id=NEW.task_id AND c.kind='profile' AND c.id=NEW.profile_id AND c.revision=NEW.revision
  ) THEN RAISE(ABORT,'execution profile scope mismatch') END;
END;
CREATE TRIGGER sm_execution_profile_immutable BEFORE UPDATE ON sm_execution_profiles BEGIN SELECT RAISE(ABORT,'immutable execution profile'); END;
CREATE TABLE sm_execution_turns(
  id TEXT PRIMARY KEY, node_id TEXT NOT NULL REFERENCES sm_nodes(id),
  logical_session_id TEXT NOT NULL REFERENCES sm_bot_task_sessions(id),
  generation INTEGER NOT NULL CHECK(generation>0), input_revision INTEGER NOT NULL CHECK(input_revision>0),
  room_seq INTEGER NOT NULL CHECK(room_seq>=0), attempt INTEGER NOT NULL CHECK(attempt>0),
  state TEXT NOT NULL CHECK(state IN ('RUNNING','WAITING','COMPLETED','FAILED','UNKNOWN')),
  disposition TEXT CHECK(disposition IS NULL OR json_valid(disposition)),
  native_id TEXT, error TEXT, created_at TEXT NOT NULL, finished_at TEXT,
  input_context TEXT CHECK(input_context IS NULL OR json_valid(input_context)),
  UNIQUE(node_id,attempt)
);
CREATE UNIQUE INDEX sm_one_live_session_turn ON sm_execution_turns(logical_session_id) WHERE state IN ('RUNNING','UNKNOWN');
CREATE INDEX sm_execution_turns_node ON sm_execution_turns(node_id,created_at);
CREATE TRIGGER sm_execution_turn_identity BEFORE UPDATE OF node_id,logical_session_id,generation,input_revision,room_seq,attempt ON sm_execution_turns BEGIN
  SELECT RAISE(ABORT,'immutable execution turn identity');
END;
CREATE TRIGGER sm_execution_turn_live_update BEFORE UPDATE OF state ON sm_execution_turns WHEN NEW.state IN ('RUNNING','UNKNOWN') BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM sm_execution_turns t JOIN sm_nodes n ON n.id=t.node_id
    WHERE t.id<>NEW.id AND n.task_id=(SELECT task_id FROM sm_nodes WHERE id=NEW.node_id) AND t.state IN ('RUNNING','UNKNOWN'))
  THEN RAISE(ABORT,'task already has a live execution') END;
END;
CREATE TRIGGER sm_execution_turn_scope BEFORE INSERT ON sm_execution_turns BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM sm_nodes n JOIN sm_bot_task_sessions s ON s.task_id=n.task_id AND s.bot_id=n.bot_id
    WHERE n.id=NEW.node_id AND s.id=NEW.logical_session_id
  ) THEN RAISE(ABORT,'execution turn scope mismatch') END;
  SELECT CASE WHEN NEW.state IN ('RUNNING','UNKNOWN') AND EXISTS(
    SELECT 1 FROM sm_execution_turns r JOIN sm_nodes n ON n.id=r.node_id
    WHERE n.task_id=(SELECT task_id FROM sm_nodes WHERE id=NEW.node_id) AND r.state IN ('RUNNING','UNKNOWN')
  ) THEN RAISE(ABORT,'task already has a live execution') END;
END;
-- Worker high-water marks are atomic rows rather than a JSON map. The room
-- high-water mark is owned only by sm_execution_turns.room_seq.
CREATE TABLE sm_execution_turn_cursors(
  turn_id TEXT NOT NULL REFERENCES sm_execution_turns(id), source TEXT NOT NULL CHECK(source LIKE 'worker:%' AND length(source)>length('worker:')),
  seq INTEGER NOT NULL CHECK(seq>=0), PRIMARY KEY(turn_id,source)
);
CREATE TABLE sm_execution_waits(
  node_id TEXT PRIMARY KEY REFERENCES sm_nodes(id),
  turn_id TEXT NOT NULL UNIQUE REFERENCES sm_execution_turns(id),
  state TEXT NOT NULL CHECK(state IN ('WAITING','SIGNALED')), requested_at TEXT NOT NULL
);
CREATE TRIGGER sm_execution_wait_scope BEFORE INSERT ON sm_execution_waits BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM sm_execution_turns WHERE id=NEW.turn_id AND node_id=NEW.node_id AND state='WAITING')
  THEN RAISE(ABORT,'execution wait scope mismatch') END;
END;
CREATE TABLE sm_execution_worker_ops(
  id TEXT PRIMARY KEY, node_id TEXT NOT NULL REFERENCES sm_nodes(id),
  request_key TEXT NOT NULL, digest TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('START','SEND','CANCEL','STOP')),
  state TEXT NOT NULL CHECK(state IN ('PENDING','APPLIED','UNKNOWN','FAILED')),
  worker_id TEXT REFERENCES sm_workers(id), request TEXT NOT NULL CHECK(json_valid(request)),
  response TEXT CHECK(response IS NULL OR json_valid(response)), error TEXT,
  created_at TEXT NOT NULL, finished_at TEXT, UNIQUE(node_id,request_key)
);
CREATE TRIGGER sm_execution_worker_op_identity BEFORE UPDATE OF node_id,request_key,digest,operation,request ON sm_execution_worker_ops BEGIN
  SELECT RAISE(ABORT,'immutable worker operation request');
END;
CREATE TRIGGER sm_execution_worker_op_scope BEFORE INSERT ON sm_execution_worker_ops WHEN NEW.worker_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM sm_workers WHERE id=NEW.worker_id AND node_id=NEW.node_id)
  THEN RAISE(ABORT,'execution worker operation scope mismatch') END;
END;
CREATE TRIGGER sm_execution_worker_op_update_scope BEFORE UPDATE OF worker_id,node_id ON sm_execution_worker_ops WHEN NEW.worker_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM sm_workers WHERE id=NEW.worker_id AND node_id=NEW.node_id)
  THEN RAISE(ABORT,'execution worker operation scope mismatch') END;
END;
CREATE TABLE sm_execution_messages(
  event_id TEXT NOT NULL REFERENCES sm_events(id), turn_id TEXT NOT NULL REFERENCES sm_execution_turns(id),
  state TEXT NOT NULL CHECK(state IN ('QUEUED','DELIVERED','PROCESSED','UNKNOWN')),
  PRIMARY KEY(event_id,turn_id)
);
CREATE TRIGGER sm_execution_message_identity BEFORE UPDATE OF event_id,turn_id ON sm_execution_messages BEGIN SELECT RAISE(ABORT,'immutable execution delivery identity'); END;
CREATE TRIGGER sm_execution_message_scope BEFORE INSERT ON sm_execution_messages BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM sm_events e JOIN sm_rooms r ON r.id=e.room_id
    JOIN sm_nodes n ON n.task_id=r.task_id JOIN sm_execution_turns t ON t.node_id=n.id
    WHERE e.id=NEW.event_id AND t.id=NEW.turn_id
  ) THEN RAISE(ABORT,'execution message scope mismatch') END;
END;
CREATE TABLE sm_execution_verifications(
  id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES sm_tasks(id),
  task_version INTEGER NOT NULL,task_revision INTEGER NOT NULL,
  source_digest TEXT NOT NULL,results_digest TEXT NOT NULL,
  profile_id TEXT NOT NULL,profile_digest TEXT NOT NULL,
  total INTEGER NOT NULL CHECK(total>0),passed INTEGER NOT NULL,
  failed INTEGER NOT NULL,skipped INTEGER NOT NULL,
  receipt TEXT NOT NULL CHECK(json_valid(receipt)),created_at TEXT NOT NULL,
  CHECK(passed=total AND failed=0 AND skipped=0)
);
CREATE TABLE sm_execution_acceptances(
  task_id TEXT PRIMARY KEY REFERENCES sm_tasks(id),
  verification_id TEXT NOT NULL UNIQUE REFERENCES sm_execution_verifications(id),
  expected_version INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN ('COMMITTING','COMPLETED','UNKNOWN')),
  commit_sha TEXT,error TEXT,created_at TEXT NOT NULL
);
CREATE TRIGGER sm_execution_verification_immutable_update BEFORE UPDATE ON sm_execution_verifications BEGIN SELECT RAISE(ABORT,'immutable verification evidence'); END;
CREATE TRIGGER sm_execution_verification_immutable_delete BEFORE DELETE ON sm_execution_verifications BEGIN SELECT RAISE(ABORT,'immutable verification evidence'); END;
CREATE TRIGGER sm_execution_acceptance_identity BEFORE UPDATE OF task_id,verification_id,expected_version ON sm_execution_acceptances BEGIN SELECT RAISE(ABORT,'immutable acceptance identity'); END;
CREATE TRIGGER sm_execution_acceptance_scope BEFORE INSERT ON sm_execution_acceptances BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM sm_execution_verifications WHERE id=NEW.verification_id AND task_id=NEW.task_id AND task_version=NEW.expected_version)
  THEN RAISE(ABORT,'execution acceptance scope mismatch') END;
END;
CREATE TABLE sm_execution_wakes(task_id TEXT PRIMARY KEY REFERENCES sm_tasks(id),requested_at TEXT NOT NULL);
-- Read-only legacy names share the canonical rows; they are not duplicate stores.
CREATE VIEW sm_verification_evidence AS SELECT * FROM sm_execution_verifications;
CREATE VIEW sm_acceptance_checkpoints AS SELECT * FROM sm_execution_acceptances;
CREATE VIEW sm_execution_deliveries AS SELECT m.event_id,t.logical_session_id,m.turn_id,m.state FROM sm_execution_messages m JOIN sm_execution_turns t ON t.id=m.turn_id;
