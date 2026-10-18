PRAGMA foreign_keys=ON;
BEGIN IMMEDIATE;
CREATE TABLE workflow_agent_assignments (
 stage TEXT NOT NULL CHECK(stage IN ('GHERKIN','SD','TESTS','IMPLEMENTATION')),
 agent_id TEXT NOT NULL REFERENCES llm_agents(id) ON DELETE CASCADE,
 position INTEGER NOT NULL CHECK(position>=0),
 PRIMARY KEY(stage,agent_id),
 UNIQUE(stage,position)
);
CREATE INDEX workflow_agent_assignments_by_agent ON workflow_agent_assignments(agent_id,stage);
INSERT INTO workflow_agent_assignments(stage,agent_id,position)
SELECT 'GHERKIN',id,0 FROM llm_agents WHERE name='需求確認 Agent';
CREATE TEMP TABLE migration_fk_check(failures INTEGER CHECK(failures=0));
INSERT INTO migration_fk_check SELECT count(*) FROM pragma_foreign_key_check;
DROP TABLE migration_fk_check;
PRAGMA user_version=11;
COMMIT;
PRAGMA foreign_keys=ON;
