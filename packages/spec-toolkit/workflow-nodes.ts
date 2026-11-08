/** BDD node definitions. Progress is derived from reviews/evidence, never submitted. */
export const workflowNodes = [
  { key: 'GHERKIN', label: '需求確認', shortLabel: '需求', review: 'gherkin', kind: 'requirement' },
  { key: 'SD', label: '系統設計', shortLabel: '設計', review: 'sd', kind: 'source' },
  { key: 'TESTS', label: '測試計劃', shortLabel: '測試', review: 'tests', kind: 'source' },
  { key: 'IMPLEMENTATION', label: '開發實作', shortLabel: '開發', review: null, kind: 'development' },
  { key: 'VERIFICATION', label: '驗收', shortLabel: '驗收', review: null, kind: 'verification' },
] as const;
export type WorkflowNodeStage = typeof workflowNodes[number]['key'];
export const workflowReviewKinds = workflowNodes.flatMap(node => node.review ? [node.review] : []);
export const workflowNodeContractVersion = 1;

export function workflowNodePaths(stage: WorkflowNodeStage, key: string, featureId: string) {
  if(stage==='GHERKIN') return [`spec/${key}/${featureId}.feature`];
  if(stage==='SD') return [`spec/${key}/${featureId}.sd.md`];
  if(stage==='TESTS') return [`tests/${key}/${featureId}.steps.ts`,`tests/${key}/${featureId}.hooks.ts`];
  return [];
}

export function workflowNodeResponseSchema(stage: WorkflowNodeStage, paths: string[]) {
  const text={type:'string',minLength:1};
  const properties: Record<string, unknown> = stage==='GHERKIN'
    ? {description:{type:'string',description:'Complete original requirement verbatim, including heading and every line.'},gherkin:{type:'string',description:'Complete raw Gherkin document with real line breaks, concrete Given/When/Then and case tags. No Markdown fences.'}}
    : stage==='SD'||stage==='TESTS' ? {path:{...text,enum:paths},content:{type:'string'}}
    : stage==='IMPLEMENTATION' ? {prompt:text} : {run:{type:'boolean',const:true}};
  const required=Object.keys(properties);
  if(stage==='GHERKIN')properties.draft={type:'boolean',const:true,description:'Explicitly save an unfinished manual draft with diagnostics. Omit when creating a complete authored requirement.'};
  return {type:'object',properties,required,additionalProperties:false};
}
