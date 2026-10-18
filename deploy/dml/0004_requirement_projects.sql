INSERT INTO requirement_projects SELECT id,project_id FROM requirements;
INSERT INTO requirements_new SELECT id,requirement_key FROM requirements;
INSERT INTO documents_new SELECT id,CASE WHEN purpose IN ('requirement','target_ci') THEN NULL ELSE project_id END,requirement_id,kind,purpose,file_name,feature_id FROM documents;
INSERT INTO runs_new SELECT id,project_id,requirement_id,origin,execution_scope,baseline_id,script_version_id,connection_id,candidate_commit,tested_commit,source_ref,definition_snapshot_json,environment_snapshot_json,status,feature_id FROM runs;
