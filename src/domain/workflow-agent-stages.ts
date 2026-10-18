export const workflowAgentStages = [
  { key: 'GHERKIN', label: '需求確認' },
  { key: 'SD', label: '系統設計' },
  { key: 'TESTS', label: '測試情境' },
  { key: 'IMPLEMENTATION', label: '程式開發' },
] as const;

export type WorkflowAgentStage = typeof workflowAgentStages[number]['key'];
export const workflowAgentStageKeys = workflowAgentStages.map(stage => stage.key);
export const interactiveWorkflowStages = ['GHERKIN', 'IMPLEMENTATION'] as const satisfies readonly WorkflowAgentStage[];

export const workflowStageOrder = [...workflowAgentStages.map(stage => stage.key), 'VERIFICATION', 'VERIFIED'] as const;
export type WorkflowStage = typeof workflowStageOrder[number];

export function isWorkflowAgentStage(value: unknown): value is WorkflowAgentStage {
  return typeof value === 'string' && workflowAgentStageKeys.some(key => key === value);
}

export function isWorkflowStage(value: unknown): value is WorkflowStage {
  return typeof value === 'string' && workflowStageOrder.some(stage => stage === value);
}
