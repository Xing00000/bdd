import fs from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { generateMessages } from '@cucumber/gherkin';
import { IdGenerator, SourceMediaType } from '@cucumber/messages';
export const reviewPath='spec/REQ-WB-001/review.json';
export const review=JSON.parse(fs.readFileSync(reviewPath,'utf8'));
export const feature=review.featurePath;
export const sd=review.sdPath;
export const approved={feature:review.featureSha256,sd:review.sdSha256};
export const hash=x=>createHash('sha256').update(x).digest('hex');
export function sourcesConfirmed(){
  const current=JSON.parse(fs.readFileSync(reviewPath,'utf8'));
  return current.sdStatus==='confirmed'&&current.sdApproval?.sha256===current.sdSha256
    &&hash(fs.readFileSync(feature))===current.featureSha256&&hash(fs.readFileSync(sd))===current.sdSha256;
}
export function sourceCases(){
  if(!sourcesConfirmed())throw Error('Source review is pending or hashes changed; confirm current Gherkin/SD before generation');
  const envelopes=generateMessages(fs.readFileSync(feature,'utf8'),feature,SourceMediaType.TEXT_X_CUCUMBER_GHERKIN_PLAIN,{newId:IdGenerator.incrementing(),includeGherkinDocument:true,includePickles:true,includeSource:false});
  const errors=envelopes.filter(e=>e.parseError);if(errors.length)throw Error(JSON.stringify(errors));
  const ast=envelopes.find(e=>e.gherkinDocument).gherkinDocument;
  const scenarios=new Map(), rows=new Map();
  const walk=children=>{for(const child of children){if(child.rule)walk(child.rule.children);if(!child.scenario)continue;const s=child.scenario;scenarios.set(s.id,s);for(const e of s.examples){const index=e.tableHeader.cells.findIndex(c=>c.value==='case_id');if(index<0)throw Error('Missing explicit case_id');for(const row of e.tableBody)rows.set(row.id,{line:row.location.line,caseId:row.cells[index].value});}}};
  walk(ast.feature.children);
  const cases=envelopes.filter(e=>e.pickle).map(({pickle})=>{
    const scenario=scenarios.get(pickle.astNodeIds[0]);if(!scenario)throw Error('Unknown source scenario');
    const ids=scenario.tags.filter(t=>/^@AC-WB-\d+$/.test(t.name));if(ids.length!==1)throw Error('Scenario needs exactly one ID');
    const row=rows.get(pickle.astNodeIds[1]);const scenarioId=ids[0].name.slice(1),caseId=row?.caseId??'default';
    if(!caseId)throw Error('Empty case_id');
    return {requirementId:'REQ-WB-001',scenarioId,caseId,scenarioLine:scenario.location.line,exampleLine:row?.line??null,pickleLine:row?.line??scenario.location.line,testKey:`REQ-WB-001/${scenarioId}/${caseId}`,expandedSteps:pickle.steps.map(s=>s.text)};
  });
  if(scenarios.size!==review.scenarioCount||cases.length!==review.expandedCaseCount||new Set(cases.map(c=>c.testKey)).size!==review.expandedCaseCount||JSON.stringify([...new Set(cases.map(c=>c.scenarioId))].sort())!==JSON.stringify([...review.scenarioIds].sort()))throw Error('Approved source coverage mismatch');
  return cases;
}
export function sourceSteps(){
  const envelopes=generateMessages(fs.readFileSync(feature,'utf8'),feature,SourceMediaType.TEXT_X_CUCUMBER_GHERKIN_PLAIN,{newId:IdGenerator.incrementing(),includeGherkinDocument:true,includePickles:false,includeSource:false});
  const doc=envelopes.find(e=>e.gherkinDocument).gherkinDocument;
  const entries=[];
  const collect=(steps,scenarioId)=>{
    let keyword='Given';
    for(const step of steps){
      const raw=step.keyword.trim();if(['Given','When','Then'].includes(raw))keyword=raw;
      const literal=part=>part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      const pattern='^'+step.text.split(/(<[^>]+>)/g).map(part=>/^<[^>]+>$/.test(part)?'([^\"]*)':literal(part)).join('')+'$';
      entries.push({scenarioId,line:step.location.line,keyword,text:step.text,pattern});
    }
  };
  const walk=children=>{for(const child of children){
    if(child.background)collect(child.background.steps,'Background');
    if(child.scenario){const id=child.scenario.tags.find(t=>/^@AC-WB-\d+$/.test(t.name));collect(child.scenario.steps,id.name.slice(1));}
    if(child.rule)walk(child.rule.children);
  }};
  walk(doc.feature.children);
  if(new Set(entries.map(e=>e.pattern)).size!==entries.length)throw Error('Ambiguous pending patterns');
  return entries;
}
export function readBddData(text){
  const section=text.split('// bdd-data-start\n')[1]?.split(']; // bdd-data-end')[0];if(!section)throw Error('Pinned bddgen metadata format changed');
  return section.trim().split('\n').map(line=>JSON.parse(line.trim().replace(/,$/,'')));
}
export function convert(raw,cases){
  const metadata=readBddData(raw);if(metadata.length!==cases.length)throw Error('Native generated case count differs from approved source');
  const source=ts.createSourceFile('native.spec.js',raw,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const calls=new Map();
  const walk=node=>{if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='test')calls.set(source.getLineAndCharacterOfPosition(node.getStart(source)).line+1,node);ts.forEachChild(node,walk);};walk(source);
  const edits=[], mapped=[];
  for(const item of metadata){
    const scenarioId=item.tags.filter(t=>/^@AC-WB-\d+$/.test(t));if(scenarioId.length!==1)throw Error('Missing/duplicate native scenario tags');
    const candidate=cases.filter(c=>c.scenarioId===scenarioId[0].slice(1)&&c.pickleLine===item.pickleLine);if(candidate.length!==1)throw Error('Missing/ambiguous source line mapping');
    const c=candidate[0],call=calls.get(item.pwTestLine);if(!call||call.arguments.length!==3||!ts.isObjectLiteralExpression(call.arguments[1]))throw Error('Pinned test declaration format changed');
    const details=call.arguments[1];if(details.properties.some(p=>p.name?.getText(source)==='annotation'))throw Error('Unexpected native annotation');
    const addition=`, annotation: [{ type: 'workbenchTestId', description: ${JSON.stringify(c.testKey)} }]`;
    edits.push({position:details.getEnd()-1,text:addition});
    for(const step of item.steps)if(!Number.isInteger(step.gherkinStepLine)||!Number.isInteger(step.pwStepLine)||!['Context','Action','Outcome','Unknown',undefined].includes(step.keywordType))throw Error('Invalid native step source mapping');
    mapped.push({...c,generatedLine:item.pwTestLine,steps:item.steps.map(s=>({sourceLine:s.gherkinStepLine,generatedLine:s.pwStepLine,keywordType:s.keywordType,expandedText:s.textWithKeyword,background:s.isBg??false}))});
  }
  if(new Set(mapped.map(c=>c.testKey)).size!==cases.length||cases.some(c=>!mapped.some(m=>m.testKey===c.testKey)))throw Error('Duplicate or missing generated source case mapping');
  let output=raw;for(const e of edits.sort((a,b)=>b.position-a.position))output=output.slice(0,e.position)+e.text+output.slice(e.position);
  const marker='use(bddFileData)';if(output.split(marker).length!==2)throw Error('Pinned fixture metadata format changed');
  output=output.replace(marker,"use(bddFileData as import('playwright-bdd').BddTestFixtures['$bddFileData'])");
  // 僅新增明確 annotation 與metadata型別斷言；移除annotation且擦除型別後，JS必須相同。
  output=output.replace(/[ \t]+$/gm,''); // deterministic whitespace only; behavior equivalence below still required
  let erasedInput=output;for(const e of edits)erasedInput=erasedInput.replace(e.text,'');
  const emit=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext}}).outputText;
  if(emit(erasedInput)!==emit(raw))throw Error('TS adapter changed native test behavior');
  if(output.split('\n').length!==raw.split('\n').length)throw Error('Source mapping line offsets changed');
  return {output,cases:mapped};
}
