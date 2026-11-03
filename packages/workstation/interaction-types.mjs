import {interactionTypes} from '../contracts/schemas.mjs';
import {invariant,id} from '../contracts/index.mjs';

const stages={gherkin:'GHERKIN',sd:'SD',tests:'TESTS'};
const reviewType=value=>typeof value==='string'&&Object.hasOwn(stages,value)?stages[value]:'SYSTEM';
// These operations invoke the real CLI agent; local drafting and saves do not.
export const llmTasks=Object.freeze(['workflow.design.generate','workflow.gherkin.generate','workflow.tests.complete','workflow.develop']);
export function llmInteractionPredicate(alias='operations') {
  const tasks=llmTasks.map(name=>`'${name}'`).join(',');
  return `(json_extract(${alias}.request_json,'$.operation') IN (${tasks}) OR (json_extract(${alias}.request_json,'$.operation')='interaction.cli.input' AND EXISTS (SELECT 1 FROM operations parent WHERE parent.id=json_extract(${alias}.request_json,'$.input.parentOperationId') AND parent.repository_id=${alias}.repository_id AND json_extract(parent.request_json,'$.operation') IN (${tasks}))))`;
}
const fixed={
  'workflow.design.generate':'SD',
  'workflow.gherkin.generate':'GHERKIN',
  'workflow.delete':'GHERKIN','workflow.requirement.save':'GHERKIN','workflow.create':'GHERKIN','workflow.draft':'GHERKIN','interaction.requirement.generate':'GHERKIN','interaction.document.import':'GHERKIN','spec.feature.create':'GHERKIN',
  'workflow.tests.generate':'TESTS','workflow.tests.complete':'TESTS','spec.tests.check':'TESTS',
  'workflow.develop':'IMPLEMENTATION','workflow.verify':'VERIFICATION','workflow.feedback':'VERIFICATION','workflow.next':'VERIFICATION',
  'run.prepare':'VERIFICATION','run.execute':'VERIFICATION','run.publish':'VERIFICATION',
  'regression.start':'VERSIONS','repository.history.more':'VERSIONS',
  'repository.setup':'SETTINGS','repository.tools.prepare':'SETTINGS','repository.upgrade.preview':'SETTINGS','repository.upgrade.apply':'SETTINGS',
  'repository.dependencies.install':'SETTINGS','repository.browsers.install':'SETTINGS',
  'project.file.save':'PROJECTS'
};
export function interactionType(request,parentType) {
  if(['interaction.cli.input','interaction.cancel'].includes(request.operation))return parentType??'SYSTEM';
  if(Object.hasOwn(fixed,request.operation))return fixed[request.operation];
  const input=request.input??{};
  if(['workflow.review','spec.review.confirm'].includes(request.operation))return reviewType(input.stage);
  if(['repository.save','spec.file.save'].includes(request.operation)) {
    if(input.kind==='project'||request.target?.kind==='project')return 'PROJECTS';
    if(input.kind==='scope')return 'SD';
    if(typeof input.path==='string') {
      if(input.path.startsWith('tests/'))return 'TESTS';
      if(input.path.endsWith('.sd.md'))return 'SD';
      if(input.path.endsWith('.feature'))return 'GHERKIN';
    }
  }
  if(request.interactionType!==undefined){invariant(interactionTypes.includes(request.interactionType),'INVALID_INTERACTION_TYPE','Invalid interaction type');return request.interactionType;}
  if(request.operation==='workflow.restart')return reviewType(input.stage);
  return 'SYSTEM';
}

/** Stable owner: saved feature key or the isolated new-requirement editor key. */
export function validateInteractionKey(key){
  invariant(typeof key==='string'&&key.length<=180&&/^(?:new-[A-Za-z0-9-]+|[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+)$/.test(key),'INVALID_INTERACTION_KEY','需求歷程識別無效。');
  return key;
}
export function interactionKey(request,parentKey){
  const input=request.input??{};
  if(input.parentOperationId)return parentKey??null;
  if(input.requirementId&&input.featureId)return `${id(input.requirementId)}/${id(input.featureId)}`;
  return input.editorKey===undefined?null:validateInteractionKey(input.editorKey);
}
