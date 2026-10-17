import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { generateMessages } from '@cucumber/gherkin';
import { IdGenerator, SourceMediaType } from '@cucumber/messages';
const require=createRequire(import.meta.url);
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const feature='spec/REQ-WB-001/workbench.feature';
export const sd='spec/REQ-WB-001/SD.md';
export const approved={feature:'88a51d341375ca58750df37cae184a81662469d9047354fd23b75a3006bbad66',sd:'a0bd73923884da67c0c71be2aaf945319fcb1a5bb380b7c704460989d3b565b4'};
export const hash=x=>createHash('sha256').update(x).digest('hex');
export function sourceCases(){
  if(hash(fs.readFileSync(feature))!==approved.feature||hash(fs.readFileSync(sd))!==approved.sd)throw Error('Approved source/hash changed; return for review');
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
  if(scenarios.size!==28||cases.length!==44||new Set(cases.map(c=>c.testKey)).size!==44)throw Error('Approved 28/44 source coverage mismatch');
  return cases;
}
export function writePendingRegistry(){
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
  fs.mkdirSync('tests/skeleton',{recursive:true});fs.writeFileSync('tests/skeleton/registry.json',JSON.stringify(entries,null,2)+'\n');
  return entries;
}
export function readBddData(text){
  const section=text.split('// bdd-data-start\n')[1]?.split(']; // bdd-data-end')[0];if(!section)throw Error('Pinned bddgen metadata format changed');
  return section.trim().split('\n').map(line=>JSON.parse(line.trim().replace(/,$/,'')));
}
export function convert(raw,cases){
  const metadata=readBddData(raw);if(metadata.length!==44)throw Error('Native generated case count is not 44');
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
export function generate(){
  const cases=sourceCases();
  writePendingRegistry();
  const cli=path.join(path.dirname(require.resolve('playwright-bdd/package.json')),'dist/cli/index.js');
  const result=spawnSync(process.execPath,[cli,'test','--config','playwright.config.ts'],{cwd:root,encoding:'utf8',env:{...process.env,BDDGEN_RAW:'1'}});
  if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);
  if(result.error)throw result.error;if(result.status!==0)throw Error(`bddgen exit ${result.status}`);
  const input='.bddgen-raw/REQ-WB-001/workbench.feature.spec.js',output='generated/skeleton/REQ-WB-001/workbench.feature.spec.ts';
  const raw=fs.readFileSync(input,'utf8');if(!raw.startsWith('// Generated from:'))throw Error('Unknown raw artifact');
  const converted=convert(raw,cases);
  if(fs.existsSync(output)&&!fs.readFileSync(output,'utf8').startsWith('// Generated from:'))throw Error('Refusing to overwrite hand-written file');
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,converted.output);
  const inputFiles=['package.json','package-lock.json','playwright.config.ts','tsconfig.json'];
  const scan=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())scan(file);else inputFiles.push(file);}};scan('tests/skeleton');
  const inputHashes=Object.fromEntries(inputFiles.sort().map(file=>[file,hash(fs.readFileSync(file))]));
  const manifest={schemaVersion:1,artifactStage:"CODEGEN_SKELETON",completionStatus:"PENDING",productE2E:"NOT_RUN",inputHashes,generator:{name:'playwright-bdd',version:'9.2.1',command:'BDDGEN_RAW=1 bddgen test --config playwright.config.ts',exitCode:result.status,adapter:'tools/generate.mjs',adapterSha256:hash(fs.readFileSync('tools/generate.mjs')),typescript:'5.9.3',playwright:'1.64.1'},requirementId:'REQ-WB-001',featurePath:feature,featureSha256:approved.feature,sdPath:sd,sdSha256:approved.sd,scenarioCount:28,caseCount:44,rawPath:input,rawSha256:hash(raw),specPath:output,specSha256:hash(converted.output),runtimeBehaviorPreserved:true,cases:converted.cases};
  manifest.testBundleSha256=hash(JSON.stringify({featureSha256:manifest.featureSha256,sdSha256:manifest.sdSha256,specSha256:manifest.specSha256,inputHashes,generatorAdapterSha256:manifest.generator.adapterSha256}));
  fs.mkdirSync('spec/REQ-WB-001/evidence',{recursive:true});fs.writeFileSync('spec/REQ-WB-001/evidence/generation-manifest.json',JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify({bddgenExit:result.status,spec:output,cases:44,scenarios:28,runtimeBehaviorPreserved:true}));
  return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))generate();
