CREATE TABLE workflow_agent_assignments (
 stage TEXT NOT NULL CHECK(stage IN ('GHERKIN','SD','TESTS','IMPLEMENTATION')),
 agent_id TEXT NOT NULL REFERENCES llm_agents(id) ON DELETE CASCADE,
 position INTEGER NOT NULL CHECK(position>=0),
 PRIMARY KEY(stage,agent_id),
 UNIQUE(stage,position)
);
CREATE INDEX workflow_agent_assignments_by_agent ON workflow_agent_assignments(agent_id,stage);
