import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import ts from 'typescript';
import { sourceFeature, sourceSd, missingFeature, missingSd, specText,completionContext } from '../fixtures/content.ts';
export const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
export type Row = Record<string, unknown>;
function placeholders(values:unknown[]){return values.map(()=>'?').join(',');}
function ids(db:DatabaseSync,sql:string,params:SQLInputValue[]=[]){return (db.prepare(sql).all(...params) as Row[]).map(row=>String(row.id));}
function cleanupFixtureRows(db:DatabaseSync,projectIds:string[],requirementIds:string[]){
  const projects=[...new Set(projectIds.filter(Boolean))],requirements=[...new Set(requirementIds.filter(Boolean))];
  const clauses:string[]=[],rootParams:SQLInputValue[]=[];
  if(requirements.length){clauses.push(`requirement_id IN (${placeholders(requirements)})`);rootParams.push(...requirements);}
  if(projects.length){clauses.push(`project_id IN (${placeholders(projects)})`);rootParams.push(...projects);}
  if(!clauses.length)return;
  const select=(sql:string,params:SQLInputValue[]=[])=>ids(db,sql,params);
  const remove=(table:string,column:string,values:string[])=>{if(values.length)db.prepare(`DELETE FROM ${table} WHERE ${column} IN (${placeholders(values)})`).run(...values);};
  const featureIds=requirements.length?select(`SELECT id FROM features WHERE requirement_id IN (${placeholders(requirements)})`,requirements):[];
  const documentIds=select(`SELECT id FROM documents WHERE ${clauses.join(' OR ')}`,rootParams);
  const versionIds=documentIds.length?select(`SELECT id FROM document_versions WHERE document_id IN (${placeholders(documentIds)})`,documentIds):[];
  const scenarioIds=requirements.length?select(`SELECT id FROM scenarios WHERE requirement_id IN (${placeholders(requirements)})`,requirements):[];
  const groupIds=versionIds.length?select(`SELECT id FROM step_groups WHERE gherkin_version_id IN (${placeholders(versionIds)})`,versionIds):[];
  const tableIds=versionIds.length?select(`SELECT id FROM example_tables WHERE gherkin_version_id IN (${placeholders(versionIds)})`,versionIds):[];
  const caseClauses:string[]=[],caseParams:SQLInputValue[]=[];
  if(versionIds.length){caseClauses.push(`gherkin_version_id IN (${placeholders(versionIds)})`);caseParams.push(...versionIds);}
  if(scenarioIds.length){caseClauses.push(`scenario_id IN (${placeholders(scenarioIds)})`);caseParams.push(...scenarioIds);}
  const caseIds=caseClauses.length?select(`SELECT id FROM source_cases WHERE ${caseClauses.join(' OR ')}`,caseParams):[];
  const definitionIds=versionIds.length?select(`SELECT id FROM test_definitions WHERE spec_version_id IN (${placeholders(versionIds)})`,versionIds):[];
  const runClauses:string[]=[],runParams:SQLInputValue[]=[];
  if(projects.length){runClauses.push(`project_id IN (${placeholders(projects)})`);runParams.push(...projects);}
  if(requirements.length){runClauses.push(`requirement_id IN (${placeholders(requirements)})`);runParams.push(...requirements);}
  const runIds=runClauses.length?select(`SELECT id FROM runs WHERE ${runClauses.join(' OR ')}`,runParams):[];
  const baselineClauses:string[]=[],baselineParams:SQLInputValue[]=[];
  if(requirements.length){baselineClauses.push(`requirement_id IN (${placeholders(requirements)})`);baselineParams.push(...requirements);}
  if(featureIds.length){baselineClauses.push(`feature_id IN (${placeholders(featureIds)})`);baselineParams.push(...featureIds);}
  const baselineIds=baselineClauses.length?select(`SELECT id FROM baselines WHERE ${baselineClauses.join(' OR ')}`,baselineParams):[];
  const resultIds=runIds.length?select(`SELECT id FROM case_results WHERE run_id IN (${placeholders(runIds)})`,runIds):[];
  const stepResultIds=resultIds.length?select(`SELECT id FROM step_results WHERE case_result_id IN (${placeholders(resultIds)})`,resultIds):[];

  remove('screenshots','step_result_id',stepResultIds);
  remove('run_browser_bindings','run_id',runIds);
  remove('step_results','case_result_id',resultIds);
  remove('case_results','run_id',runIds);
  remove('run_test_selection','run_id',runIds);
  remove('run_source_cases','run_id',runIds);
  remove('runs','id',runIds);
  remove('baseline_documents','baseline_id',baselineIds);
  remove('baselines','id',baselineIds);
  remove('test_case_mappings','test_definition_id',definitionIds);
  remove('test_case_mappings','source_case_id',caseIds);
  remove('test_definitions','id',definitionIds);
  remove('example_cells','source_case_id',caseIds);
  remove('steps','group_id',groupIds);
  remove('step_groups','id',groupIds);
  remove('source_cases','id',caseIds);
  remove('example_columns','table_id',tableIds);
  remove('example_tables','id',tableIds);
  remove('scenario_versions','scenario_id',scenarioIds);
  remove('scenarios','id',scenarioIds);
  remove('confirmations','feature_id',featureIds);
  remove('recording_actions','spec_version_id',versionIds);
  remove('git_snapshots','spec_version_id',versionIds);
  remove('document_heads','document_id',documentIds);
  remove('document_versions','id',versionIds);
  remove('documents','id',documentIds);
  remove('target_connections','project_id',projects);
  remove('terminal_sessions','project_id',projects);
  remove('requirement_projects','requirement_id',requirements);
  remove('requirement_projects','project_id',projects);
  remove('features','id',featureIds);
  remove('requirements','id',requirements);
  remove('projects','id',projects);
  const violations=db.prepare('PRAGMA foreign_key_check').all();
  if(violations.length)throw Error(`Fixture cleanup left ${violations.length} foreign-key violation(s)`);
}
export class FixtureDatabase {
  private static readonly cleanedFixtureFiles=new Set<string>();
  readonly db: DatabaseSync;
  readonly vars: Record<string, string>;
  constructor(file: string, targetUrl: string, targetDb: string, missingExpected=false) {
    const feature=missingExpected?missingFeature:sourceFeature, sd=missingExpected?missingSd:sourceSd;
    const allowed = resolve('.test-fixtures');
    const rel = relative(allowed, resolve(file));
    if (rel.startsWith('..') || !rel.endsWith('.e2e.sqlite') || !existsSync(file))
      throw new Error('WB_METADATA_DB must be an existing dedicated .test-fixtures/*.e2e.sqlite initialized by the product; no production DB is accepted.');
    for(const target of [targetDb,process.env.WB_TARGET_REPO].filter(Boolean) as string[]){if(relative(allowed,resolve(target)).startsWith('..'))throw Error('Only dedicated .test-fixtures target DB/repository is accepted by this test harness');}
    const absoluteFile=resolve(file);
    if(!FixtureDatabase.cleanedFixtureFiles.has(absoluteFile)){
      const staleDb=new DatabaseSync(absoluteFile);staleDb.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;');
      try{
        const fixtureRoot=resolve('.test-fixtures');
        const defaultProjects=new Set(ids(staleDb,'SELECT DISTINCT rp.project_id AS id FROM requirement_projects rp JOIN requirements r ON r.id=rp.requirement_id WHERE r.is_default_example=1'));
        const staleProjects=(staleDb.prepare('SELECT id,workspace_ref FROM projects').all() as Row[])
          .filter(row=>!defaultProjects.has(String(row.id))&&typeof row.workspace_ref==='string'&&!relative(fixtureRoot,resolve(row.workspace_ref)).startsWith('..'))
          .map(row=>String(row.id));
        const staleRequirements=ids(staleDb,'SELECT id FROM requirements WHERE is_default_example=0');
        cleanupFixtureRows(staleDb,staleProjects,staleRequirements);staleDb.exec('COMMIT;');FixtureDatabase.cleanedFixtureFiles.add(absoluteFile);
      }catch(error){if(staleDb.isTransaction)staleDb.exec('ROLLBACK;');throw error;}finally{staleDb.close();}
    }
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA foreign_keys=ON');
    mkdirSync(resolve('.test-fixtures/workspace'),{recursive:true});
    const suffix = randomUUID();
    this.vars = Object.fromEntries(['project','requirement','featureId','gherkinDoc','sdDoc','specDoc','recordingDoc','gherkinVersion','sdVersion','specVersion','specSkeletonVersion','testAExtra','scenario','caseA','caseB','testA','testB','connection','baseline','historicalRun'].map(k => [k, k+'-'+suffix]));
    Object.assign(this.vars,{sourceStepGivenId:'step-1-'+suffix,sourceStepWhenId:'step-2-'+suffix,sourceStepThenId:'step-3-'+suffix,missingExpected:String(missingExpected)});
    this.insert('projects',{id:this.vars.project,name:'E2E '+suffix,workspace_ref:process.env.WB_TARGET_REPO??resolve('.test-fixtures/workspace')});
    this.insert('requirements',{id:this.vars.requirement,requirement_key:'REQ-DEMO-001'});
    this.insert('requirement_projects',{requirement_id:this.vars.requirement,project_id:this.vars.project});
    this.insert('features',{id:this.vars.featureId,requirement_id:this.vars.requirement,feature_key:'demo',stage:'GHERKIN'});
    for (const [doc,kind,purpose,version,raw] of [
      ['gherkinDoc','gherkin','requirement','gherkinVersion',feature],
      ['sdDoc','sd','requirement','sdVersion',sd],

    ]) {
      this.insert('documents',{id:this.vars[doc],project_id:null,requirement_id:this.vars.requirement,feature_id:this.vars.featureId,kind,purpose,file_name:kind==='gherkin'?'demo.feature':kind==='sd'?'demo.sd.md':'demo.spec.ts'});
      this.insert('document_versions',{id:this.vars[version],document_id:this.vars[doc],version_no:1,raw_text:raw,raw_sha256:sha(raw),parser_name:kind==='sd'?null:kind==='gherkin'?'@cucumber/gherkin':'typescript',parser_version:kind==='sd'?null:kind==='gherkin'?'39.1.0':'5.9.3',projection_schema_version:1,source_gherkin_version_id:kind==='gherkin'?null:this.vars.gherkinVersion,created_at:new Date().toISOString()});
      this.insert('document_heads',{document_id:this.vars[doc],version_id:this.vars[version]});
    }
    this.insert('documents',{id:this.vars.specDoc,project_id:null,requirement_id:this.vars.requirement,feature_id:this.vars.featureId,kind:'spec',purpose:'target_ci',file_name:'demo.spec.ts'});
    const skeletonRaw="import { test } from '@playwright/test';\n"+['test-a','test-b','test-a-extra'].map(id=>`test('${id}',{annotation:{type:'workbenchTestId',description:'${id}'}},async()=>{throw Error('UnimplementedStepError: source fixture skeleton');});\n`).join('');
    const sourceStepIds={given:this.vars.sourceStepGivenId,when:this.vars.sourceStepWhenId,then:this.vars.sourceStepThenId},completion=completionContext(sourceStepIds,missingExpected);
    const mappings=[{testKey:'test-a',scenarioId:'AC-DEMO-001',caseId:'a',sourceCaseId:this.vars.caseA},{testKey:'test-a-extra',scenarioId:'AC-DEMO-001',caseId:'a',sourceCaseId:this.vars.caseA},{testKey:'test-b',scenarioId:'AC-DEMO-001',caseId:'b',sourceCaseId:this.vars.caseB}];
    const bundleDirectory='spec/REQ-DEMO-001/demo',specPath=`${bundleDirectory}/demo.feature.spec.ts`;
    const bundleFiles=[{path:specPath,rawText:skeletonRaw},{path:`${bundleDirectory}/demo.feature`,rawText:feature},{path:`${bundleDirectory}/demo.sd.md`,rawText:sd},...completion.files.map(file=>({path:`${bundleDirectory}/${file.path}`,rawText:file.rawText}))];
    const caseSteps=(role:string,expected:string)=>[
      {sourceStepId:sourceStepIds.given,sourceLine:4,keywordType:'Context',expandedText:`Given the account has role "${role}"`},
      {sourceStepId:sourceStepIds.when,sourceLine:5,keywordType:'Action',expandedText:'When the account edits the document'},
      {sourceStepId:sourceStepIds.then,sourceLine:6,keywordType:'Outcome',expandedText:missingExpected?'Then the result follows an unspecified product rule':`Then the result is "${expected}"`},
    ];
    const cases=[
      {scenarioId:'AC-DEMO-001',scenarioEntityId:this.vars.scenario,caseId:'a',testKey:'test-a',sourceCaseId:this.vars.caseA,scenarioLine:3,pickleLine:9,steps:caseSteps('A','denied')},
      {scenarioId:'AC-DEMO-001',scenarioEntityId:this.vars.scenario,caseId:'a',testKey:'test-a-extra',sourceCaseId:this.vars.caseA,scenarioLine:3,pickleLine:9,steps:caseSteps('A','denied')},
      {scenarioId:'AC-DEMO-001',scenarioEntityId:this.vars.scenario,caseId:'b',testKey:'test-b',sourceCaseId:this.vars.caseB,scenarioLine:3,pickleLine:10,steps:caseSteps('B','saved')},
    ];
    const skeletonManifest=JSON.stringify({stage:'SKELETON',bundleDirectory,specPath,bundleFiles,sourceGherkinVersionId:this.vars.gherkinVersion,gherkinSha256:sha(feature),sdSha256:sha(sd),specSha256:sha(skeletonRaw),mappings,cases,tests:['test-a','test-b','test-a-extra']});
    this.insert('document_versions',{id:this.vars.specSkeletonVersion,document_id:this.vars.specDoc,version_no:1,raw_text:skeletonRaw,raw_sha256:sha(skeletonRaw),parser_name:'typescript',parser_version:'5.9.3',projection_schema_version:1,source_gherkin_version_id:this.vars.gherkinVersion,test_stage:'SKELETON',test_manifest_json:skeletonManifest,test_manifest_sha256:sha(skeletonManifest),created_at:new Date().toISOString()});
    if(missingExpected)this.vars.specVersion=this.vars.specSkeletonVersion;
    else{
      const raw=specText(targetUrl,true), manifest=JSON.stringify({stage:'COMPLETED',sourceSkeletonVersionId:this.vars.specSkeletonVersion,sourceSkeletonSha256:sha(skeletonRaw),sourceSkeletonManifestSha256:sha(skeletonManifest),sourceGherkinVersionId:this.vars.gherkinVersion,gherkinSha256:sha(feature),sdSha256:sha(sd),specSha256:sha(raw),mappings,tests:['test-a','test-b','test-a-extra']});
      this.insert('document_versions',{id:this.vars.specVersion,document_id:this.vars.specDoc,version_no:2,raw_text:raw,raw_sha256:sha(raw),parser_name:'typescript',parser_version:'5.9.3',projection_schema_version:1,source_gherkin_version_id:this.vars.gherkinVersion,test_stage:'COMPLETED',source_skeleton_version_id:this.vars.specSkeletonVersion,test_manifest_json:manifest,test_manifest_sha256:sha(manifest),created_at:new Date().toISOString()});
    }
    if(!missingExpected)this.db.prepare('UPDATE document_versions SET execution_config_json=? WHERE id=?').run(JSON.stringify({completionContext:{stepDefinitions:completion.stepDefinitions,context:completion}}),this.vars.specSkeletonVersion);
    this.insert('document_heads',{document_id:this.vars.specDoc,version_id:this.vars.specVersion});
    this.insert('documents',{id:this.vars.recordingDoc,project_id:this.vars.project,requirement_id:null,kind:'spec',purpose:'recording',file_name:'recording.spec.ts'});
    this.insert('scenarios',{id:this.vars.scenario,requirement_id:this.vars.requirement,scenario_key:'AC-DEMO-001'});
    this.insert('scenario_versions',{gherkin_version_id:this.vars.gherkinVersion,scenario_id:this.vars.scenario,ordinal:1,scenario_kind:'outline',title:'Edit document',source_line:3,source_column:3});
    const group='group-'+suffix, table='examples-'+suffix;
    this.insert('step_groups',{id:group,gherkin_version_id:this.vars.gherkinVersion,scenario_id:this.vars.scenario,scope:'scenario',owner_key:'scenario:1'});
    for (const [i,keyword,text] of [[1,'Given','the account has role "<role>"'],[2,'When','the account edits the document'],[3,'Then',missingExpected?'the result follows an unspecified product rule':'the result is "<expected>"']] as const)
      this.insert('steps',{id:'step-'+i+'-'+suffix,group_id:group,ordinal:i,keyword,text,source_line:i+3,source_column:5});
    this.insert('example_tables',{id:table,gherkin_version_id:this.vars.gherkinVersion,scenario_id:this.vars.scenario,ordinal:1,title:''});
    for(const [i,name] of (missingExpected?['case_id','role']:['case_id','role','expected']).entries())this.insert('example_columns',{table_id:table,ordinal:i+1,name});
    for(const [i,values] of (missingExpected?[['a','A'],['b','B']]:[['a','A','denied'],['b','B','saved']]).entries()){
      const id=i===0?this.vars.caseA:this.vars.caseB;
      this.insert('source_cases',{id,gherkin_version_id:this.vars.gherkinVersion,scenario_id:this.vars.scenario,example_table_id:table,row_ordinal:i+1,case_key:values[0]});
      values.forEach((value,j)=>this.insert('example_cells',{source_case_id:id,example_table_id:table,column_ordinal:j+1,value}));
      const testId=i===0?this.vars.testA:this.vars.testB;
      for(const version of new Set([this.vars.specVersion,this.vars.specSkeletonVersion])){
        const definitionId=version===this.vars.specVersion?testId:testId+'-skeleton';
        this.insert('test_definitions',{id:definitionId,spec_version_id:version,test_key:i===0?'test-a':'test-b',title:i===0?'test-a':'test-b',source_line:this.sourceLine(version,i===0?'test-a':'test-b'),source_column:1});
        this.insert('test_case_mappings',{test_definition_id:definitionId,source_case_id:id});
      }
    }
    for(const version of new Set([this.vars.specVersion,this.vars.specSkeletonVersion])){
      const id=version===this.vars.specVersion?this.vars.testAExtra:this.vars.testAExtra+'-skeleton';
      this.insert('test_definitions',{id,spec_version_id:version,test_key:'test-a-extra',title:'test-a-extra',source_line:this.sourceLine(version,'test-a-extra'),source_column:1});
      this.insert('test_case_mappings',{test_definition_id:id,source_case_id:this.vars.caseA});
    }
    this.insert('target_connections',{id:this.vars.connection,project_id:this.vars.project,sqlite_file_ref:targetDb,environment_label:'test',app_base_url:targetUrl,dbgate_url:process.env.WB_DBGATE_URL??null,dbgate_connection_name:process.env.WB_DBGATE_URL?targetDb.split('/').at(-1)!:null});
  }
  insert(table:string,row:Record<string,SQLInputValue>){
    const fields=Object.keys(row);
    this.db.prepare(`INSERT INTO ${table}(${fields.join(',')}) VALUES (${fields.map(()=>'?').join(',')})`).run(...Object.values(row));
  }
  all(sql:string,params:SQLInputValue[]=[]):Row[]{return this.db.prepare(sql).all(...params) as Row[];}
  stage(stage:string){
    this.db.prepare('UPDATE features SET stage=? WHERE id=?').run(stage,this.vars.featureId);
    this.db.prepare('DELETE FROM confirmations WHERE requirement_id=?').run(this.vars.requirement);
    if(stage!=='GHERKIN')for(const kind of stage==='SD'?['gherkin']:['gherkin','sd']){
      const version=this.vars[kind+'Version'];
      const row=this.all('SELECT raw_sha256 FROM document_versions WHERE id=?',[version])[0];
      this.insert('confirmations',{requirement_id:this.vars.requirement,feature_id:this.vars.featureId,kind,version_id:version,raw_sha256:row.raw_sha256 as string,confirmed_at:new Date().toISOString()});
    }
  }
  baseline(historical=false){
    const manifest={gherkinVersionId:this.vars.gherkinVersion,sdVersionId:this.vars.sdVersion,tests:[{testKey:'test-a',sourceCaseId:this.vars.caseA},{testKey:'test-b',sourceCaseId:this.vars.caseB},{testKey:'test-a-extra',sourceCaseId:this.vars.caseA}]};
    if(!this.all('SELECT id FROM baselines WHERE id=?',[this.vars.baseline]).length){
      this.insert('baselines',{id:this.vars.baseline,requirement_id:this.vars.requirement,feature_id:this.vars.featureId,kind:'tests',manifest_json:JSON.stringify(manifest),sha256:sha(JSON.stringify(manifest)),valid:1});
      for(const key of ['gherkinVersion','sdVersion','specVersion'])this.insert('baseline_documents',{baseline_id:this.vars.baseline,document_version_id:this.vars[key]});
    }
    if(historical&&!this.all('SELECT id FROM runs WHERE id=?',[this.vars.historicalRun]).length){
      const sourceCases=this.all('SELECT c.*,s.scenario_key FROM source_cases c JOIN scenarios s ON s.id=c.scenario_id WHERE c.gherkin_version_id=? ORDER BY c.scenario_id,c.row_ordinal',[this.vars.gherkinVersion]);
      const definitions=this.all(`SELECT td.id,td.test_key AS testKey,m.source_case_id AS sourceCaseId,s.scenario_key AS scenarioId,s.id AS scenarioEntityId,c.case_key AS caseId,td.spec_version_id AS specVersionId
        FROM test_definitions td JOIN test_case_mappings m ON m.test_definition_id=td.id JOIN source_cases c ON c.id=m.source_case_id JOIN scenarios s ON s.id=c.scenario_id
        WHERE td.spec_version_id=? ORDER BY td.test_key`,[this.vars.specVersion]);
      const definitionSnapshot={gherkinVersionId:this.vars.gherkinVersion,versions:[this.vars.gherkinVersion,this.vars.sdVersion,this.vars.specVersion],definitions,required:definitions,sourceCases,materializations:[],discovery:[],createdAt:new Date().toISOString()};
      this.insert('runs',{id:this.vars.historicalRun,project_id:this.vars.project,requirement_id:this.vars.requirement,feature_id:this.vars.featureId,origin:'target_ci',execution_scope:'ALL_REQUIRED',baseline_id:this.vars.baseline,definition_snapshot_json:JSON.stringify(definitionSnapshot),environment_snapshot_json:'{"fixture":"historical-precondition-only"}',status:'FAILED',source_ref:'historical-precondition-not-current-evidence'});
    }
  }
  private sourceLine(version:string,key:string){
    const raw=String(this.all('SELECT raw_text FROM document_versions WHERE id=?',[version])[0].raw_text),offset=raw.indexOf("test('"+key+"'");
    if(offset<0)throw Error('Fixture declaration missing '+key);return raw.slice(0,offset).split('\n').length;
  }
  replaceFixtureSpec(raw:string){
    const old=this.all('SELECT * FROM document_versions WHERE id=?',[this.vars.specVersion])[0],id='fixture-completed-'+randomUUID();
    const manifest=JSON.parse(String(old.test_manifest_json));manifest.specSha256=sha(raw);const json=JSON.stringify(manifest);
    this.insert('document_versions',{...old,id,version_no:Number(old.version_no)+1,raw_text:raw,raw_sha256:sha(raw),test_manifest_json:json,test_manifest_sha256:sha(json),created_at:new Date().toISOString()} as Record<string,SQLInputValue>);
    const source=ts.createSourceFile('fixture.spec.ts',raw,ts.ScriptTarget.Latest,true);
    for(const statement of source.statements){if(!ts.isExpressionStatement(statement)||!ts.isCallExpression(statement.expression))continue;
      const call=statement.expression;if(!ts.isIdentifier(call.expression)||call.expression.text!=='test'||!ts.isStringLiteral(call.arguments[0]))continue;
      const key=call.arguments[0].text,definition='fixture-test-'+randomUUID();
      const variable=key==='test-a'?'testA':key==='test-b'?'testB':key==='test-a-extra'?'testAExtra':undefined;if(!variable)throw Error('Unexpected fixture test '+key);
      this.vars[variable]=definition;this.insert('test_definitions',{id:definition,spec_version_id:id,test_key:key,title:key,source_line:source.getLineAndCharacterOfPosition(call.getStart(source)).line+1,source_column:1});
      this.insert('test_case_mappings',{test_definition_id:definition,source_case_id:key==='test-b'?this.vars.caseB:this.vars.caseA});
    }
    this.vars.specVersion=id;this.db.prepare('UPDATE document_heads SET version_id=? WHERE document_id=?').run(id,this.vars.specDoc);
  }
  useSkeleton(){
    this.db.prepare('UPDATE document_heads SET version_id=? WHERE document_id=?').run(this.vars.specSkeletonVersion,this.vars.specDoc);
  }
  snapshot(){
    const p=this.vars.project,r=this.vars.requirement;
    return JSON.stringify({
      versions:this.all('SELECT v.* FROM document_versions v JOIN documents d ON d.id=v.document_id WHERE (d.project_id=? OR d.requirement_id IN (SELECT requirement_id FROM requirement_projects WHERE project_id=?)) ORDER BY v.id',[p,p]),
      heads:this.all('SELECT h.* FROM document_heads h JOIN documents d ON d.id=h.document_id WHERE (d.project_id=? OR d.requirement_id IN (SELECT requirement_id FROM requirement_projects WHERE project_id=?)) ORDER BY h.document_id',[p,p]),
      scenarios:this.all('SELECT sv.* FROM scenario_versions sv JOIN scenarios s ON s.id=sv.scenario_id WHERE s.requirement_id=? ORDER BY sv.gherkin_version_id,sv.ordinal',[r]),
      steps:this.all('SELECT st.* FROM steps st JOIN step_groups g ON g.id=st.group_id JOIN document_versions v ON v.id=g.gherkin_version_id JOIN documents d ON d.id=v.document_id WHERE (d.project_id=? OR d.requirement_id IN (SELECT requirement_id FROM requirement_projects WHERE project_id=?)) ORDER BY st.id',[p,p]),
      cases:this.all('SELECT c.* FROM source_cases c JOIN scenarios s ON s.id=c.scenario_id WHERE s.requirement_id=? ORDER BY c.id',[r]),
      cells:this.all('SELECT e.* FROM example_cells e JOIN source_cases c ON c.id=e.source_case_id JOIN scenarios s ON s.id=c.scenario_id WHERE s.requirement_id=? ORDER BY e.source_case_id,e.column_ordinal',[r]),
      testDefinitions:this.all('SELECT t.* FROM test_definitions t JOIN document_versions v ON v.id=t.spec_version_id JOIN documents d ON d.id=v.document_id WHERE (d.project_id=? OR d.requirement_id IN (SELECT requirement_id FROM requirement_projects WHERE project_id=?)) ORDER BY t.id',[p,p]),
      exampleTables:this.all('SELECT e.* FROM example_tables e JOIN scenarios s ON s.id=e.scenario_id WHERE s.requirement_id=? ORDER BY e.id',[r]),
      exampleColumns:this.all('SELECT col.* FROM example_columns col JOIN example_tables e ON e.id=col.table_id JOIN scenarios s ON s.id=e.scenario_id WHERE s.requirement_id=? ORDER BY col.table_id,col.ordinal',[r]),
      stepGroups:this.all('SELECT g.* FROM step_groups g JOIN document_versions v ON v.id=g.gherkin_version_id JOIN documents d ON d.id=v.document_id WHERE (d.project_id=? OR d.requirement_id IN (SELECT requirement_id FROM requirement_projects WHERE project_id=?)) ORDER BY g.id',[p,p]),
      mappings:this.all('SELECT m.* FROM test_case_mappings m JOIN test_definitions t ON t.id=m.test_definition_id JOIN document_versions v ON v.id=t.spec_version_id JOIN documents d ON d.id=v.document_id WHERE (d.project_id=? OR d.requirement_id IN (SELECT requirement_id FROM requirement_projects WHERE project_id=?)) ORDER BY m.test_definition_id,m.source_case_id',[p,p])
    });
  }
  close(){this.db.close();}
  cleanupOwnedTestData(projectIds:string[],requirementIds:string[],requirementKeys:string[]=[],workspaceRefs:string[]=[]){
    const keys=[...new Set(requirementKeys.filter(Boolean))],refs=[...new Set(workspaceRefs.filter(Boolean))];
    const keyedRequirements=keys.length?ids(this.db,`SELECT id FROM requirements WHERE requirement_key IN (${placeholders(keys)})`,keys):[];
    const workspaceProjects=refs.length?ids(this.db,`SELECT id FROM projects WHERE workspace_ref IN (${placeholders(refs)})`,refs):[];
    const allProjects=[this.vars.project,...projectIds,...workspaceProjects];
    const projectParams=[...new Set(allProjects.filter(Boolean))];
    const linkedRequirements=projectParams.length?ids(this.db,`SELECT DISTINCT r.id FROM requirements r JOIN requirement_projects rp ON rp.requirement_id=r.id WHERE rp.project_id IN (${placeholders(projectParams)}) AND r.is_default_example=0`,projectParams):[];
    const allRequirements=[this.vars.requirement,...requirementIds,...keyedRequirements,...linkedRequirements];
    this.db.exec('BEGIN IMMEDIATE;');
    try{cleanupFixtureRows(this.db,projectParams,allRequirements);this.db.exec('COMMIT;');}
    catch(error){if(this.db.isTransaction)this.db.exec('ROLLBACK;');throw error;}
  }
}
