import { resolve } from 'node:path';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
export function designContext(){
 const files=['src/fixtures/target-app.ts','src/fixtures/setup.ts'];
 if(!process.env.WB_TARGET_DB)throw Error('WB_TARGET_DB is required for the actual target database design context');
 const db=new DatabaseSync(process.env.WB_TARGET_DB,{readOnly:true});
 let database;
 try{database={sqliteVersion:db.prepare('SELECT sqlite_version() AS version').get()!.version,userVersion:db.prepare('PRAGMA user_version').get()!.user_version,schema:db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name").all()};}finally{db.close();}
 return {purpose:'Dedicated document-editing test application, not the workbench metadata database',existingFiles:files.map(path=>({path,rawText:readFileSync(path,'utf8')})),
  nodeVersion:process.version,requiredNodeRange:JSON.parse(readFileSync('package.json','utf8')).engines.node,database,
  databaseLifecycle:'Canonical target initializer is initializeTargetDatabase in target-app.ts. It uses idempotent CREATE TABLE IF NOT EXISTS and seed INSERT ON CONFLICT DO NOTHING. The dedicated target fixture has no versioned migration owner or historical upgrade contract. Document that actual fact; do not invent a legacy production migration requirement. Production metadata migrations/deploy are a separate workbench concern.',
  fixtures:fixtureSql,instructions:'Use actual contracts, selectors and authorization from existingFiles. Distinguish this dedicated test database from production metadata. Proposed development or deployment files must be explicitly marked planned, not existing. Browser recording and PTY are not document-editing product capabilities. Draft a pending-review SD from the known implementation and source acceptance conditions; do not claim approval or execution.'};
}
export function completionContext(sourceStepIds:{given:string;when:string;then:string},missingExpected=false){
 const modules=['spec/REQ-WB-001/workbench/testing/fixtures/managed-runner.ts','spec/REQ-WB-001/workbench/testing/support/managed.ts','spec/REQ-WB-001/workbench/testing/support/dbgate.ts'];
 const files=modules.map(file=>({path:file.slice('spec/REQ-WB-001/workbench/'.length),rawText:readFileSync(file,'utf8')}));
 const stepDefinitionPath='spec/REQ-WB-001/workbench/testing/fixtures/target.steps.ts';
 const stepDefinitions=[{path:'testing/fixtures/target.steps.ts',rawText:readFileSync(stepDefinitionPath,'utf8')}];
 const sourceSteps=[
  {sourceStepId:sourceStepIds.given,keyword:'Given',text:'the account has role "<role>"',sourceLine:4},
  {sourceStepId:sourceStepIds.when,keyword:'When',text:'the account edits the document',sourceLine:5},
  {sourceStepId:sourceStepIds.then,keyword:'Then',text:missingExpected?'the result follows an unspecified product rule':'the result is "<expected>"',sourceLine:6},
 ];
 return {runnerFixtureModule:'./testing/fixtures/managed-runner.ts',files,stepDefinitions,sourceSteps,
  instructions:[
   'The supplied files are existing project helper modules and registered step definitions. Their exact bundle paths are bundleDirectory + each files[].path; the registered definitions and sourceSteps identify the approved source operations.',
   'Keep each supplied helper path and source unchanged; import runnerFixture and ManagedRunner from runnerFixtureModule and extend Playwright test with runner:runnerFixture. Use runner.login(target URL, source role), runner.edit(source expected outcome), runner.assertOutcome(source expected outcome). These methods capture real DB UI, application actions and assertions.',
   'When the supplied registered step definitions call createBdd(test) with a custom test, export that exact test object from the configured step module and make rawText import and reuse it for every test declaration. Do not create a second base.extend test object in rawText: the registered definitions are bound to the test object passed to createBdd, and completion validation rejects a different object.',
   'Preserve every source mapping, source step ID and test ID. Never request these supplied files or fabricate missing product outcomes.',
  ].join(' ')};
}
export const sourceFeature = `Feature: Document editing
  @AC-DEMO-001
  Scenario Outline: Edit document
    Given the account has role "<role>"
    When the account edits the document
    Then the result is "<expected>"
    Examples:
      | case_id | role | expected |
      | a       | A    | denied   |
      | b       | B    | saved    |
`;
export const missingFeature = `Feature: Document editing
  @AC-DEMO-001
  Scenario Outline: Edit document
    Given the account has role "<role>"
    When the account edits the document
    Then the result follows an unspecified product rule
    Examples:
      | case_id | role |
      | a       | A    |
      | b       | B    |
`;
export const sourceSd = '# SD fixture\nArchitecture: browser → API → SQLite\nRole A may read documents; B may edit documents, neither may manage accounts.\nDDL: CREATE TABLE test_accounts(username TEXT PRIMARY KEY NOT NULL,role_code TEXT NOT NULL,state TEXT NOT NULL); CREATE TABLE test_documents(document_key TEXT PRIMARY KEY NOT NULL,content TEXT NOT NULL);\nDML: UPDATE test_accounts SET role_code="B" WHERE username="scenario_user"; SELECT role_code,state FROM test_accounts WHERE username="scenario_user";\n';
export const missingSd = '# SD fixture\nArchitecture: browser → API → SQLite\nDDL: CREATE TABLE example(id TEXT);\nDML: SELECT id FROM example;\nThe document-editing outcome is unspecified.\n';
export function specText(baseURL:string,extra=false){
 const module=resolve('spec/REQ-WB-001/workbench/testing/fixtures/managed-runner.ts');
 const cases=[['test-a','a','A','denied'],['test-b','b','B','saved'],...(extra?[['test-a-extra','a','A','denied']]:[])];
 return `import { test, expect } from ${JSON.stringify(module)};\n`+cases.map(([id,key,role,expected])=>`test('${id}', { annotation: { type: 'workbenchTestId', description: '${id}' } }, async ({ runner }) => {
  await runner.login(${JSON.stringify(baseURL)}, '${role}');
  await runner.edit('${expected}');
  await runner.assertOutcome('${expected}');
}); // source-case: ${key}\n`).join('');
}
export function failingSpecText(baseURL:string){
 const failure=`import { test, expect } from ${JSON.stringify(resolve('spec/REQ-WB-001/workbench/testing/fixtures/managed-runner.ts'))};\ntest('test-a', { annotation: { type: 'workbenchTestId', description: 'test-a' } }, async ({ runner }) => {
  await runner.login(${JSON.stringify(baseURL)}, 'B');
  await runner.capture(6, 'role-mismatch', runner.appPage, async () => {
    const actual=await runner.appPage.getByTestId('account-role').innerText();
    expect(actual).toBe('A');
    return actual;
  }, 'A');
});\n`;
 const remainder=specText(baseURL,true);return failure+remainder.slice(remainder.indexOf("test('test-b'"));
}
export function dbgateSpecText(mode:'positive'|'mismatch'|'query-error'|'unavailable'|'not-loaded'){
 const module=resolve('spec/REQ-WB-001/workbench/testing/fixtures/managed-runner.ts');
 return `import {test,expect} from ${JSON.stringify(module)};\n`+['test-a','test-b','test-a-extra'].map(id=>`test('${id}',{annotation:{type:'workbenchTestId',description:'${id}'}},async({runner})=>{
  ${mode==='unavailable'?"await runner.dbPage.route('**/*',route=>route.abort('connectionrefused'));":''}
  ${mode==='not-loaded'?"await runner.dbPage.route('**/sessions/execute-query',route=>route.fulfill({json:{state:'ok'}}));":''}
  await runner.capture(4,'db-source',runner.dbPage,async()=>runner.dbPage.url());
  await runner.query(${JSON.stringify(mode==='query-error'?'SELECT * FROM missing_acceptance_table;':"SELECT role_code,state FROM test_accounts WHERE username='scenario_user';")},5);
  await runner.capture(6,'db-value',runner.dbPage,async()=>{
    const actual=await runner.dbPage.locator('td[data-row="0"][data-col="0"]').innerText();
    expect(actual).toBe(${JSON.stringify(mode==='mismatch'?'B':'A')});return actual;
  },${JSON.stringify(mode==='mismatch'?'B':'A')});
});\n`).join('');
}
export const malformedFeature='Feature: invalid\n  Scenario: broken\n    Given value\n      """\n      unterminated\n';
export const malformedSpec="import { test } from '@playwright/test';\ntest('broken', async ({ page }) => {\n  await page.goto( ;\n});\n";
export const fixtureSql=`CREATE TABLE IF NOT EXISTS test_accounts(username TEXT PRIMARY KEY NOT NULL,role_code TEXT NOT NULL,state TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS test_documents(document_key TEXT PRIMARY KEY NOT NULL,content TEXT NOT NULL);
INSERT INTO test_accounts VALUES ('scenario_user','A','active') ON CONFLICT(username) DO UPDATE SET role_code='A',state='active';
INSERT INTO test_documents VALUES ('scenario_document','initial') ON CONFLICT(document_key) DO UPDATE SET content='initial';`;
