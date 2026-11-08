/** BDD node definitions. Progress is derived from reviews/evidence, never submitted. */
import {workflowNodes as definitions,workflowReviewKinds as reviewKinds,workflowNodeContractVersion as contractVersion,workflowNodePaths as pathsForNode,workflowNodeResponseSchema as responseForNode} from '../../packages/spec-toolkit/workflow-nodes.ts';
export const workflowNodes = definitions;
export type WorkflowNodeStage = typeof workflowNodes[number]['key'];
export const workflowReviewKinds = reviewKinds;
export const workflowNodeContractVersion = contractVersion;

export function workflowNodePaths(stage: WorkflowNodeStage, key: string, featureId: string) {
  return pathsForNode(stage,key,featureId);
}

export function workflowNodeResponseSchema(stage: WorkflowNodeStage, paths: string[]) {
  return responseForNode(stage,paths);
}
