import {interactionTypes} from '../contracts/schemas.mjs';
import {invariant} from '../contracts/index.mjs';

const stages={gherkin:'GHERKIN',sd:'SD',tests:'TESTS'};
const reviewType=value=>typeof value==='string'&&Object.hasOwn(stages,value)?stages[value]:'SYSTEM';
const fixed={
  'workflow.requirement.save':'GHERKIN','workflow.create':'GHERKIN','workflow.draft':'GHERKIN','interaction.requirement.generate':'GHERKIN','interaction.document.import':'GHERKIN','spec.feature.create':'GHERKIN',
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
