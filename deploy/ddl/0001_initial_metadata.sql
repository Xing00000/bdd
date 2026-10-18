CREATE TABLE projects (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  workspace_ref TEXT NOT NULL
);
CREATE TABLE requirements (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  requirement_key TEXT NOT NULL,
  stage TEXT NOT NULL CHECK(stage IN
    ('GHERKIN','SD','TESTS','IMPLEMENTATION','VERIFICATION','VERIFIED')),
  UNIQUE(project_id, requirement_key),
  UNIQUE(id, project_id)
);
CREATE TABLE documents (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  requirement_id TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('gherkin','sd','spec')),
  purpose TEXT NOT NULL CHECK(purpose IN
    ('requirement','target_ci','integration','recording')),
  file_name TEXT NOT NULL,
  FOREIGN KEY(requirement_id, project_id) REFERENCES requirements(id, project_id),
  CHECK(
    (purpose='requirement' AND kind IN ('gherkin','sd') AND requirement_id IS NOT NULL)
    OR (purpose='target_ci' AND kind='spec' AND requirement_id IS NOT NULL)
    OR (purpose IN ('integration','recording') AND kind='spec')
  )
);
CREATE UNIQUE INDEX one_requirement_document
  ON documents(requirement_id, kind) WHERE purpose='requirement';
CREATE TABLE document_versions (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id),
  version_no INTEGER NOT NULL CHECK(version_no > 0),
  raw_text TEXT NOT NULL,
  raw_sha256 TEXT NOT NULL CHECK(length(raw_sha256)=64),
  parser_name TEXT,
  parser_version TEXT,
  projection_schema_version INTEGER NOT NULL CHECK(projection_schema_version > 0),
  source_gherkin_version_id TEXT REFERENCES document_versions(id),
  test_stage TEXT CHECK(test_stage IN ('SKELETON','COMPLETION_DRAFT','COMPLETED')),
  source_skeleton_version_id TEXT REFERENCES document_versions(id),
  test_manifest_json TEXT,
  test_manifest_sha256 TEXT CHECK(test_manifest_sha256 IS NULL OR length(test_manifest_sha256)=64),
  execution_config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(document_id, version_no),
  UNIQUE(id, document_id),
  UNIQUE(id, raw_sha256),
  CHECK((test_manifest_json IS NULL AND test_manifest_sha256 IS NULL)
    OR (test_manifest_json IS NOT NULL AND test_manifest_sha256 IS NOT NULL)),
  CHECK(
    (test_stage IS NULL AND source_skeleton_version_id IS NULL)
    OR (test_stage IS NOT NULL AND test_stage='SKELETON'
        AND source_skeleton_version_id IS NULL AND test_manifest_json IS NOT NULL)
    OR (test_stage IS NOT NULL AND test_stage IN ('COMPLETION_DRAFT','COMPLETED')
        AND source_skeleton_version_id IS NOT NULL AND test_manifest_json IS NOT NULL)
  )
);
CREATE TABLE document_heads (
  document_id TEXT PRIMARY KEY NOT NULL REFERENCES documents(id),
  version_id TEXT NOT NULL,
  FOREIGN KEY(version_id, document_id) REFERENCES document_versions(id, document_id)
);
CREATE TABLE confirmations (
  requirement_id TEXT NOT NULL REFERENCES requirements(id),
  kind TEXT NOT NULL CHECK(kind IN ('gherkin','sd')),
  version_id TEXT NOT NULL,
  raw_sha256 TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  PRIMARY KEY(requirement_id, kind),
  FOREIGN KEY(version_id, raw_sha256) REFERENCES document_versions(id, raw_sha256)
);
CREATE TABLE scenarios (
  id TEXT PRIMARY KEY NOT NULL,
  requirement_id TEXT NOT NULL REFERENCES requirements(id),
  scenario_key TEXT NOT NULL,
  UNIQUE(requirement_id, scenario_key)
);
CREATE TABLE scenario_versions (
  gherkin_version_id TEXT NOT NULL REFERENCES document_versions(id),
  scenario_id TEXT NOT NULL REFERENCES scenarios(id),
  ordinal INTEGER NOT NULL CHECK(ordinal > 0),
  scenario_kind TEXT NOT NULL CHECK(scenario_kind IN ('scenario','outline')),
  title TEXT NOT NULL,
  source_line INTEGER NOT NULL CHECK(source_line > 0),
  source_column INTEGER NOT NULL CHECK(source_column > 0),
  PRIMARY KEY(gherkin_version_id, scenario_id),
  UNIQUE(gherkin_version_id, ordinal)
);
CREATE TABLE step_groups (
  id TEXT PRIMARY KEY NOT NULL,
  gherkin_version_id TEXT NOT NULL REFERENCES document_versions(id),
  scenario_id TEXT,
  scope TEXT NOT NULL CHECK(scope IN
    ('feature_background','rule_background','scenario')),
  owner_key TEXT NOT NULL,
  FOREIGN KEY(gherkin_version_id, scenario_id)
    REFERENCES scenario_versions(gherkin_version_id, scenario_id),
  UNIQUE(gherkin_version_id, owner_key),
  CHECK((scope='scenario' AND scenario_id IS NOT NULL)
    OR (scope IN ('feature_background','rule_background') AND scenario_id IS NULL))
);
CREATE TABLE steps (
  id TEXT PRIMARY KEY NOT NULL,
  group_id TEXT NOT NULL REFERENCES step_groups(id),
  ordinal INTEGER NOT NULL CHECK(ordinal > 0),
  keyword TEXT NOT NULL,
  text TEXT NOT NULL,
  argument_json TEXT,
  source_line INTEGER NOT NULL CHECK(source_line > 0),
  source_column INTEGER NOT NULL CHECK(source_column > 0),
  UNIQUE(group_id, ordinal)
);
CREATE UNIQUE INDEX one_scenario_step_group
  ON step_groups(gherkin_version_id, scenario_id) WHERE scope='scenario';
CREATE TABLE example_tables (
  id TEXT PRIMARY KEY NOT NULL,
  gherkin_version_id TEXT NOT NULL,
  scenario_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal > 0),
  title TEXT NOT NULL,
  FOREIGN KEY(gherkin_version_id, scenario_id)
    REFERENCES scenario_versions(gherkin_version_id, scenario_id),
  UNIQUE(gherkin_version_id, scenario_id, ordinal),
  UNIQUE(id, gherkin_version_id, scenario_id)
);
CREATE TABLE example_columns (
  table_id TEXT NOT NULL REFERENCES example_tables(id),
  ordinal INTEGER NOT NULL CHECK(ordinal > 0),
  name TEXT NOT NULL,
  PRIMARY KEY(table_id, ordinal),
  UNIQUE(table_id, name)
);
CREATE TABLE source_cases (
  id TEXT PRIMARY KEY NOT NULL,
  gherkin_version_id TEXT NOT NULL,
  scenario_id TEXT NOT NULL,
  example_table_id TEXT,
  row_ordinal INTEGER NOT NULL,
  case_key TEXT NOT NULL,
  FOREIGN KEY(gherkin_version_id, scenario_id)
    REFERENCES scenario_versions(gherkin_version_id, scenario_id),
  FOREIGN KEY(example_table_id, gherkin_version_id, scenario_id)
    REFERENCES example_tables(id, gherkin_version_id, scenario_id),
  UNIQUE(gherkin_version_id, scenario_id, case_key),
  UNIQUE(example_table_id, row_ordinal),
  UNIQUE(id, example_table_id),
  CHECK(
    (example_table_id IS NULL AND row_ordinal=0 AND case_key='default')
    OR (example_table_id IS NOT NULL AND row_ordinal>0 AND length(case_key)>0)
  )
);
CREATE TABLE example_cells (
  source_case_id TEXT NOT NULL,
  example_table_id TEXT NOT NULL,
  column_ordinal INTEGER NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY(source_case_id, column_ordinal),
  FOREIGN KEY(source_case_id, example_table_id)
    REFERENCES source_cases(id, example_table_id),
  FOREIGN KEY(example_table_id, column_ordinal)
    REFERENCES example_columns(table_id, ordinal)
);

CREATE TABLE test_definitions (
  id TEXT PRIMARY KEY NOT NULL,
  spec_version_id TEXT NOT NULL REFERENCES document_versions(id),
  test_key TEXT NOT NULL CHECK(length(test_key)>0),
  title TEXT NOT NULL,
  source_line INTEGER NOT NULL CHECK(source_line > 0),
  source_column INTEGER NOT NULL CHECK(source_column > 0),
  UNIQUE(spec_version_id, test_key)
);
CREATE TABLE test_case_mappings (
  test_definition_id TEXT NOT NULL REFERENCES test_definitions(id),
  source_case_id TEXT NOT NULL REFERENCES source_cases(id),
  PRIMARY KEY(test_definition_id, source_case_id)
);
CREATE TABLE recording_actions (
  spec_version_id TEXT NOT NULL REFERENCES document_versions(id),
  ordinal INTEGER NOT NULL CHECK(ordinal > 0),
  page_key TEXT NOT NULL,
  action_kind TEXT NOT NULL,
  locator_json TEXT,
  payload_json TEXT NOT NULL,
  PRIMARY KEY(spec_version_id, ordinal)
);
CREATE TABLE git_snapshots (
  spec_version_id TEXT PRIMARY KEY NOT NULL REFERENCES document_versions(id),
  repository_url TEXT NOT NULL,
  branch_ref TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  file_path TEXT NOT NULL
);
CREATE TABLE target_connections (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  sqlite_file_ref TEXT NOT NULL,
  environment_label TEXT NOT NULL,
  app_base_url TEXT
);
CREATE TABLE baselines (
  id TEXT PRIMARY KEY NOT NULL,
  requirement_id TEXT NOT NULL REFERENCES requirements(id),
  kind TEXT NOT NULL CHECK(kind IN ('tests','source')),
  manifest_json TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  valid INTEGER NOT NULL CHECK(valid IN (0,1))
);
CREATE TABLE baseline_documents (
  baseline_id TEXT NOT NULL REFERENCES baselines(id),
  document_version_id TEXT NOT NULL REFERENCES document_versions(id),
  PRIMARY KEY(baseline_id, document_version_id)
);
CREATE TABLE runs (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  requirement_id TEXT,
  origin TEXT NOT NULL CHECK(origin IN ('target_ci','integration','recording')),
  execution_scope TEXT NOT NULL CHECK(execution_scope IN ('SELECTED_CASES','ALL_REQUIRED','INDEPENDENT')),
  baseline_id TEXT REFERENCES baselines(id),
  script_version_id TEXT REFERENCES document_versions(id),
  connection_id TEXT REFERENCES target_connections(id),
  candidate_commit TEXT,
  tested_commit TEXT,
  source_ref TEXT,
  definition_snapshot_json TEXT NOT NULL,
  environment_snapshot_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN
    ('NOT_RUN','RUNNING','PASSED','FAILED','INCOMPLETE','INVALID')),
  FOREIGN KEY(requirement_id, project_id) REFERENCES requirements(id, project_id),
  CHECK(
    (origin='target_ci' AND requirement_id IS NOT NULL AND baseline_id IS NOT NULL
      AND execution_scope IN ('SELECTED_CASES','ALL_REQUIRED'))
    OR (origin IN ('integration','recording') AND script_version_id IS NOT NULL
      AND execution_scope='INDEPENDENT')
  )
);
CREATE TABLE run_source_cases (
  run_id TEXT NOT NULL REFERENCES runs(id),
  source_case_id TEXT NOT NULL REFERENCES source_cases(id),
  PRIMARY KEY(run_id, source_case_id)
);
CREATE TABLE run_test_selection (
  run_id TEXT NOT NULL REFERENCES runs(id),
  test_definition_id TEXT NOT NULL REFERENCES test_definitions(id),
  PRIMARY KEY(run_id, test_definition_id)
);
CREATE TABLE case_results (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id),
  test_definition_id TEXT REFERENCES test_definitions(id),
  runtime_test_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN
    ('NOT_RUN','RUNNING','PASSED','FAILED','INCOMPLETE','INVALID')),
  UNIQUE(run_id, runtime_test_key),
  UNIQUE(run_id, test_definition_id),
  UNIQUE(id, run_id),
  FOREIGN KEY(run_id, test_definition_id)
    REFERENCES run_test_selection(run_id, test_definition_id)
);
CREATE TABLE run_browser_bindings (
  run_id TEXT PRIMARY KEY NOT NULL REFERENCES runs(id),
  case_result_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  context_ref TEXT NOT NULL,
  page_id TEXT NOT NULL,
  binding_seq INTEGER NOT NULL CHECK(binding_seq > 0),
  FOREIGN KEY(case_result_id, run_id) REFERENCES case_results(id, run_id)
);
CREATE TABLE step_results (
  id TEXT PRIMARY KEY NOT NULL,
  case_result_id TEXT NOT NULL REFERENCES case_results(id),
  source_step_id TEXT REFERENCES steps(id),
  browser_session_id TEXT,
  browser_context_ref TEXT,
  browser_page_id TEXT,
  binding_seq INTEGER,
  action_index INTEGER NOT NULL CHECK(action_index > 0),
  expected_json TEXT,
  actual_json TEXT,
  status TEXT NOT NULL CHECK(status IN
    ('NOT_RUN','RUNNING','PASSED','FAILED','INCOMPLETE','INVALID')),
  error_text TEXT,
  UNIQUE(case_result_id, action_index),
  CHECK(
    (browser_session_id IS NULL AND browser_context_ref IS NULL
      AND browser_page_id IS NULL AND binding_seq IS NULL)
    OR (browser_session_id IS NOT NULL AND browser_context_ref IS NOT NULL
      AND browser_page_id IS NOT NULL AND binding_seq IS NOT NULL AND binding_seq > 0)
  )
);
CREATE TABLE screenshots (
  id TEXT PRIMARY KEY NOT NULL,
  step_result_id TEXT NOT NULL REFERENCES step_results(id),
  moment TEXT NOT NULL CHECK(moment IN
    ('precondition','after_action','after_assertion','failure')),
  artifact_ref TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK(length(sha256)=64)
);
