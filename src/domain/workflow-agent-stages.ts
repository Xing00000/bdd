import {workflowNodes} from './workflow-nodes.ts';
export const workflowAgentStages = workflowNodes.filter(node => node.key !== 'VERIFICATION');

export type WorkflowAgentStage = typeof workflowAgentStages[number]['key'];
export const workflowAgentStageKeys = workflowAgentStages.map(stage => stage.key);
export const interactiveWorkflowStages = ['GHERKIN', 'IMPLEMENTATION'] as const satisfies readonly WorkflowAgentStage[];

export const workflowStageOrder = [...workflowNodes.map(node => node.key), 'VERIFIED'] as const;
export type WorkflowStage = typeof workflowStageOrder[number];

export function isWorkflowAgentStage(value: unknown): value is WorkflowAgentStage {
  return typeof value === 'string' && workflowAgentStageKeys.some(key => key === value);
}

export function isWorkflowStage(value: unknown): value is WorkflowStage {
  return typeof value === 'string' && workflowStageOrder.some(stage => stage === value);
}
