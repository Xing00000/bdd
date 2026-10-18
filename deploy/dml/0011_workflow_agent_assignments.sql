INSERT INTO workflow_agent_assignments(stage,agent_id,position)
SELECT 'GHERKIN',id,0 FROM llm_agents WHERE name='需求確認 Agent';
