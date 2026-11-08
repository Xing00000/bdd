-- Additive schema. Never use PRAGMA user_version: the existing workbench owns it.
-- Historical v1 bootstrap. SessionManager applies execution v2 and normalization
-- v3 in the same initialization transaction; this file alone is not current DDL.
CREATE TABLE sm_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE sm_workstations(id TEXT PRIMARY KEY, max_workers INTEGER NOT NULL CHECK(max_workers BETWEEN 1 AND 64));
CREATE TABLE sm_projects(
  workstation_id TEXT NOT NULL REFERENCES sm_workstations(id), id TEXT NOT NULL, name TEXT NOT NULL,
  PRIMARY KEY(workstation_id,id)
);
CREATE TABLE sm_repositories(
  workstation_id TEXT NOT NULL REFERENCES sm_workstations(id), id TEXT NOT NULL, name TEXT NOT NULL,
  root_path TEXT NOT NULL, remote_url TEXT NOT NULL,
  PRIMARY KEY(workstation_id,id), UNIQUE(workstation_id,root_path)
);
CREATE TABLE sm_project_repositories(
  workstation_id TEXT NOT NULL, project_id TEXT NOT NULL, repository_id TEXT NOT NULL,
  PRIMARY KEY(workstation_id,project_id,repository_id),
  FOREIGN KEY(workstation_id,project_id) REFERENCES sm_projects(workstation_id,id),
  FOREIGN KEY(workstation_id,repository_id) REFERENCES sm_repositories(workstation_id,id)
);
CREATE TABLE sm_catalog(
  workstation_id TEXT NOT NULL REFERENCES sm_workstations(id), kind TEXT NOT NULL CHECK(kind IN ('skill','soul','bot','workflow','contract','profile')),
  id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), body TEXT NOT NULL CHECK(json_valid(body)),
  digest TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(workstation_id,kind,id,revision)
);
CREATE TRIGGER sm_catalog_immutable_update BEFORE UPDATE ON sm_catalog BEGIN SELECT RAISE(ABORT,'immutable catalog revision'); END;
CREATE TRIGGER sm_catalog_immutable_delete BEFORE DELETE ON sm_catalog BEGIN SELECT RAISE(ABORT,'immutable catalog revision'); END;
CREATE TABLE sm_soul_memory(
  workstation_id TEXT NOT NULL REFERENCES sm_workstations(id), soul_id TEXT NOT NULL, id TEXT NOT NULL UNIQUE,
  PRIMARY KEY(workstation_id,soul_id)
);
CREATE TABLE sm_tasks(
  workstation_id TEXT NOT NULL, id TEXT NOT NULL UNIQUE, project_id TEXT NOT NULL, repository_id TEXT NOT NULL,
  title TEXT NOT NULL, input_revision INTEGER NOT NULL DEFAULT 1 CHECK(input_revision>0),
  state TEXT NOT NULL CHECK(state IN ('PROVISIONING','ACTIVE','WAITING_ACCEPTANCE','COMPLETED','CANCELLED','ERROR')),
  version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
  PRIMARY KEY(workstation_id,id),
  FOREIGN KEY(workstation_id,project_id,repository_id) REFERENCES sm_project_repositories(workstation_id,project_id,repository_id)
);
CREATE TABLE sm_workflows(
  task_id TEXT PRIMARY KEY REFERENCES sm_tasks(id), template_id TEXT NOT NULL, template_revision INTEGER NOT NULL,
  snapshot TEXT NOT NULL CHECK(json_valid(snapshot)), digest TEXT NOT NULL
);
CREATE TABLE sm_worktrees(
  task_id TEXT PRIMARY KEY REFERENCES sm_tasks(id), path TEXT NOT NULL UNIQUE, branch TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('PENDING','READY','ERROR','CLEANUP_PENDING')),
  base_sha TEXT, receipt TEXT CHECK(receipt IS NULL OR json_valid(receipt)), error TEXT
);
CREATE TABLE sm_rooms(id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE REFERENCES sm_tasks(id), next_seq INTEGER NOT NULL DEFAULT 1);
CREATE TABLE sm_nodes(
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES sm_tasks(id), node_key TEXT NOT NULL, bot_id TEXT NOT NULL,
  config TEXT NOT NULL CHECK(json_valid(config)), state TEXT NOT NULL CHECK(state IN ('BLOCKED','READY','RUNNING','WAITING_HUMAN','SUCCEEDED','FAILED','CANCELLED')),
  version INTEGER NOT NULL DEFAULT 1, UNIQUE(task_id,node_key), UNIQUE(task_id,id)
);
CREATE TABLE sm_bot_task_sessions(
  id TEXT PRIMARY KEY, workstation_id TEXT NOT NULL, bot_id TEXT NOT NULL, task_id TEXT NOT NULL,
  generation INTEGER NOT NULL DEFAULT 0, active_node_id TEXT, native_session_id TEXT,
  UNIQUE(workstation_id,bot_id,task_id),
  FOREIGN KEY(workstation_id,task_id) REFERENCES sm_tasks(workstation_id,id),
  FOREIGN KEY(task_id,active_node_id) REFERENCES sm_nodes(task_id,id)
);
CREATE TABLE sm_native_sessions(
  id TEXT PRIMARY KEY, workstation_id TEXT NOT NULL REFERENCES sm_workstations(id), logical_session_id TEXT NOT NULL REFERENCES sm_bot_task_sessions(id),
  generation INTEGER NOT NULL, adapter TEXT NOT NULL, native_id TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(logical_session_id,generation), UNIQUE(workstation_id,adapter,native_id)
);
CREATE TABLE sm_cursors(
  logical_session_id TEXT NOT NULL REFERENCES sm_bot_task_sessions(id), source TEXT NOT NULL, seq INTEGER NOT NULL CHECK(seq>=0),
  PRIMARY KEY(logical_session_id,source)
);
CREATE TABLE sm_events(
  id TEXT NOT NULL UNIQUE, room_id TEXT NOT NULL REFERENCES sm_rooms(id), seq INTEGER NOT NULL,
  actor_kind TEXT NOT NULL, actor_id TEXT NOT NULL, type TEXT NOT NULL, target TEXT,
  payload TEXT NOT NULL CHECK(json_valid(payload)), created_at TEXT NOT NULL,
  PRIMARY KEY(room_id,seq)
);
CREATE TRIGGER sm_events_immutable_update BEFORE UPDATE ON sm_events BEGIN SELECT RAISE(ABORT,'immutable event'); END;
CREATE TRIGGER sm_events_immutable_delete BEFORE DELETE ON sm_events BEGIN SELECT RAISE(ABORT,'immutable event'); END;
CREATE TABLE sm_commands(
  workstation_id TEXT NOT NULL, actor TEXT NOT NULL, request_id TEXT NOT NULL, digest TEXT NOT NULL,
  response TEXT NOT NULL CHECK(json_valid(response)), PRIMARY KEY(workstation_id,actor,request_id)
);
CREATE TABLE sm_summaries(
  id TEXT PRIMARY KEY, workstation_id TEXT NOT NULL, memory_session_id TEXT NOT NULL REFERENCES sm_soul_memory(id),
  project_id TEXT, category TEXT NOT NULL, summary TEXT NOT NULL CHECK(length(summary) BETWEEN 1 AND 2000),
  source_events TEXT NOT NULL CHECK(json_valid(source_events)), created_at TEXT NOT NULL,
  FOREIGN KEY(workstation_id,project_id) REFERENCES sm_projects(workstation_id,id)
);
CREATE TABLE sm_candidates(
  id TEXT PRIMARY KEY, node_id TEXT NOT NULL UNIQUE REFERENCES sm_nodes(id), task_revision INTEGER NOT NULL,
  generation INTEGER NOT NULL, digest TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)),
  producer TEXT NOT NULL CHECK(json_valid(producer))
);
CREATE TABLE sm_results(
  id TEXT PRIMARY KEY, node_id TEXT NOT NULL UNIQUE REFERENCES sm_nodes(id), task_id TEXT NOT NULL REFERENCES sm_tasks(id),
  task_revision INTEGER NOT NULL, contract TEXT NOT NULL CHECK(json_valid(contract)), data TEXT NOT NULL CHECK(json_valid(data)),
  digest TEXT NOT NULL, producer TEXT NOT NULL CHECK(json_valid(producer)), approved_by TEXT, published_at TEXT NOT NULL
);
CREATE TRIGGER sm_results_immutable_update BEFORE UPDATE ON sm_results BEGIN SELECT RAISE(ABORT,'immutable result'); END;
CREATE TRIGGER sm_results_immutable_delete BEFORE DELETE ON sm_results BEGIN SELECT RAISE(ABORT,'immutable result'); END;
CREATE TABLE sm_workers(
  id TEXT PRIMARY KEY, node_id TEXT NOT NULL REFERENCES sm_nodes(id), task_id TEXT NOT NULL REFERENCES sm_tasks(id),
  profile TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('RESERVED','RUNNING','UNKNOWN','STOPPED','FAILED')),
  write_access INTEGER NOT NULL CHECK(write_access IN (0,1)), external_id TEXT UNIQUE, turns INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX sm_one_workspace_writer ON sm_workers(task_id) WHERE write_access=1 AND state IN ('RESERVED','RUNNING','UNKNOWN');
CREATE INDEX sm_workers_node ON sm_workers(node_id,state);
CREATE INDEX sm_events_room ON sm_events(room_id,seq);
CREATE INDEX sm_summaries_scope ON sm_summaries(memory_session_id,project_id);
CREATE TABLE sm_worker_events(
  worker_id TEXT NOT NULL REFERENCES sm_workers(id), seq INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(worker_id,seq)
);
CREATE TABLE sm_git_jobs(
  task_id TEXT PRIMARY KEY REFERENCES sm_tasks(id), state TEXT NOT NULL CHECK(state IN ('RUNNING','ERROR','DONE')),
  owner TEXT NOT NULL, deadline INTEGER NOT NULL, planned_base_sha TEXT, error TEXT
);
CREATE TRIGGER sm_workflows_immutable_update BEFORE UPDATE ON sm_workflows BEGIN SELECT RAISE(ABORT,'immutable workflow snapshot'); END;
CREATE TRIGGER sm_nodes_frozen_config BEFORE UPDATE OF task_id,node_key,bot_id,config ON sm_nodes BEGIN SELECT RAISE(ABORT,'immutable node configuration'); END;
CREATE TRIGGER sm_candidates_immutable_update BEFORE UPDATE ON sm_candidates BEGIN SELECT RAISE(ABORT,'immutable candidate'); END;
CREATE TRIGGER sm_worktree_identity BEFORE UPDATE OF task_id,path,branch ON sm_worktrees BEGIN SELECT RAISE(ABORT,'immutable worktree identity'); END;
