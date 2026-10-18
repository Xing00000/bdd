INSERT INTO git_snapshots_new
SELECT g.spec_version_id,
 CASE WHEN d.project_id IS NOT NULL THEN d.project_id
 WHEN (SELECT count(*) FROM projects WHERE workspace_ref=g.repository_url)=1
 THEN (SELECT id FROM projects WHERE workspace_ref=g.repository_url)
 ELSE NULL END,
 g.repository_url,g.branch_ref,g.commit_sha,g.file_path
FROM git_snapshots g JOIN document_versions v ON v.id=g.spec_version_id JOIN documents d ON d.id=v.document_id;
