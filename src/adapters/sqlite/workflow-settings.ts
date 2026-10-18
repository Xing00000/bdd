import type {MetadataMigration} from './migrations.ts';
import {workflowAgentStageKeys} from '../../domain/workflow-agent-stages.ts';

const stageCheck = workflowAgentStageKeys.map(stage => `'${stage}'`).join(',');

export const workflowSettingsMigration:MetadataMigration={
 id:'0011_workflow_agent_assignments',fromVersion:10,toVersion:11,
 dmlReason:'Create persistent many-to-many Agent assignments for editable workflow stages and bind the existing first-run Gherkin Agent when present; verification remains read-only.',
 steps:[{kind:'ddl',sql:`
CREATE TABLE workflow_agent_assignments (
 stage TEXT NOT NULL CHECK(stage IN (${stageCheck})),
 agent_id TEXT NOT NULL REFERENCES llm_agents(id) ON DELETE CASCADE,
 position INTEGER NOT NULL CHECK(position>=0),
 PRIMARY KEY(stage,agent_id),
 UNIQUE(stage,position)
);
CREATE INDEX workflow_agent_assignments_by_agent ON workflow_agent_assignments(agent_id,stage);`},{kind:'dml',sql:`
INSERT INTO workflow_agent_assignments(stage,agent_id,position)
SELECT 'GHERKIN',id,0 FROM llm_agents WHERE name='需求確認 Agent';`}],
};
