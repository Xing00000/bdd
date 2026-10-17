import { resolve } from 'node:path';
import {readFileSync} from 'node:fs';
export function completionContext(){
 const module=resolve('spec/REQ-WB-001/workbench/testing/fixtures/managed-runner.ts');
 return {runnerFixtureModule:module,runnerFixtureSource:readFileSync(module,'utf8'),
  instructions:'The supplied managed runner is existing project infrastructure. Import runnerFixture and ManagedRunner from runnerFixtureModule; extend Playwright test with runner:runnerFixture. Use runner.login(target URL, source role), runner.edit(source expected outcome), runner.assertOutcome(source expected outcome). These methods capture real DB UI, application actions and assertions. Preserve every source mapping and test ID. The helper is context, never alter its source or fabricate missing product outcomes.'};
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
export const malformedFeature='Feature: invalid\n  Scenario: broken\n    Given value\n      """\n      unterminated\n';
export const malformedSpec="import { test } from '@playwright/test';\ntest('broken', async ({ page }) => {\n  await page.goto( ;\n});\n";
export const fixtureSql=`CREATE TABLE IF NOT EXISTS test_accounts(username TEXT PRIMARY KEY NOT NULL,role_code TEXT NOT NULL,state TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS test_documents(document_key TEXT PRIMARY KEY NOT NULL,content TEXT NOT NULL);
INSERT INTO test_accounts VALUES ('scenario_user','A','active') ON CONFLICT(username) DO UPDATE SET role_code='A',state='active';
INSERT INTO test_documents VALUES ('scenario_document','initial') ON CONFLICT(document_key) DO UPDATE SET content='initial';`;
