import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {TerminalRuntimePort} from '../../src/ports/runtime.ts';
import type {LlmOptions} from '../../src/adapters/generation/types.ts';
import { createGenerationAdapters } from '../../src/adapters/generation/index.js';
import {createGitAdapter} from '../../src/adapters/git/index.ts';

const execute = promisify(execFile), root = resolve(process.cwd());
const feature = `Feature: A generation fixture
  @AC-GEN-001
  Scenario Outline: Preserve source cases
    Given a value "<value>"
    When it is inspected
    Then its outcome is "<outcome>"
    Examples:
      | case_id | value | outcome |
      | a | first | expected-a |
      | b | second | expected-b |
`;
const steps = `import {createBdd} from 'playwright-bdd';
throw new Error('UPLOADED_TOP_LEVEL_MUST_NOT_RUN');
const {Given,When,Then}=createBdd();
Given('a value {string}',async({page},value)=>{await page.goto('BUSINESS_LOCATOR_MUST_NOT_APPEAR');});
When('it is inspected',async()=>{throw Error('BUSINESS_IMPLEMENTATION_MUST_NOT_APPEAR');});
Then('its outcome is {string}',async()=>{});
`;
const sourceCases = [{ sourceCaseId: 'case-a', scenarioId: 'AC-GEN-001', caseId: 'a' }, { sourceCaseId: 'case-b', scenarioId: 'AC-GEN-001', caseId: 'b' }];

test('two sibling generated bundles remain together in Git with dedicated source, SD, steps, spec and config',async()=>{
 const {generator}=await adapters();
 const repository=await mkdtemp(join(tmpdir(),'workbench-sibling-git-'));
 await execute('git',['init','-b','main',repository]);
 await execute('git',['-C',repository,'config','user.name','Fixture']);
 await execute('git',['-C',repository,'config','user.email','fixture@localhost']);
 const git=createGitAdapter({workspaceRoot:repository});
 const bundles=[];
 for(const featureKey of ['checkout','refund']){
  const output=await generator.generate({requirementKey:'REQ-SIBLING',featureKey,sd:`# ${featureKey} design`,feature,stepDefinitions:steps,sourceCases});
  assert.equal(output.specPath,`spec/REQ-SIBLING/${featureKey}/${featureKey}.feature.spec.ts`);
  await git.save({repo:repository,files:output.files});bundles.push(output);
 }
 const tracked=(await execute('git',['-C',repository,'ls-tree','-r','--name-only','HEAD'])).stdout.trim().split('\n');
 assert.equal(tracked.length,10);
 for(const bundle of bundles)for(const file of bundle.files){
  assert.ok(tracked.includes(file.path));
  assert.equal(await readFile(join(repository,file.path),'utf8'),file.rawText);
 }
});
async function adapters(llm?:LlmOptions,terminal?:TerminalRuntimePort) {
  return createGenerationAdapters({ root, artifactRoot: await mkdtemp(join(tmpdir(), 'workbench-generation-tests-')), llm,terminal });
}

test('real bddgen creates discoverable pending TS with exact case mappings without executing uploaded code', async () => {
  const { generator } = await adapters();
  const output = await generator.generate({requirementKey:'REQ-GEN',featureKey:'generation',sd:'# Dedicated design', feature, stepDefinitions: [{ path: 'upload.steps.ts', rawText: steps }], sourceCases });
  assert.equal(output.manifest.generator.name, 'playwright-bdd');
  assert.equal(output.manifest.generator.version, '9.2.1');
  assert.equal(output.manifest.completionStatus, 'PENDING');
  assert.equal(output.manifest.productE2E, 'NOT_RUN');
  assert.equal(output.manifest.runtimeBehaviorPreserved, true);
  assert.deepEqual(output.manifest.cases.map((entry: any) => [entry.scenarioId, entry.caseId, entry.sourceCaseId]),
    [['AC-GEN-001', 'a', 'case-a'], ['AC-GEN-001', 'b', 'case-b']]);
  assert.equal(output.manifest.pendingSlots.length, 3);
  assert.deepEqual(output.manifest.bundleFiles, output.files);
  assert.match(output.rawText, /workbenchTestId/);
  assert.doesNotMatch(output.files.map(file => file.rawText).join('\n'), /UPLOADED_TOP_LEVEL|BUSINESS_LOCATOR|BUSINESS_IMPLEMENTATION/);
  const directory = await mkdtemp(join(tmpdir(), 'workbench-export-tests-'));
  const require = createRequire(join(root, 'package.json')), packagePath = require.resolve('@playwright/test/package.json');
  await symlink(dirname(dirname(dirname(packagePath))), join(directory, 'node_modules'), 'dir');
  for (const file of output.files) { await mkdir(dirname(join(directory, file.path)), { recursive: true }); await writeFile(join(directory, file.path), file.rawText); }
  await writeFile(join(directory, 'package.json'), '{"type":"module"}');
  await writeFile(join(directory, 'fixture.config.ts'), `export default {testDir:'.',testMatch:'**/*.spec.ts',forbidOnly:true,reporter:'json'};`);
  const result = await execute(process.execPath, [join(dirname(packagePath), 'cli.js'), 'test', '--config', join(directory, 'fixture.config.ts'), '--list', '--reporter=json'], { cwd: directory });
  const report = JSON.parse(result.stdout), discovered: string[] = [];
  const visit = (suite: any) => { for (const spec of suite.specs ?? []) discovered.push(spec.title); for (const child of suite.suites ?? []) visit(child); };
  for (const suite of report.suites) visit(suite);
  assert.deepEqual(discovered, ['a', 'b']);
  await assert.rejects(() => execute(process.execPath, [join(dirname(packagePath), 'cli.js'), 'test', '--config',
    join(directory, output.manifest.configPath), '--reporter=line', '--workers=1', '--retries=0'], { cwd: directory }),
  (error: any) => error.code === 1 && /UnimplementedStepError: PENDING_COMPLETION/.test(error.stdout)
    && /2 failed/.test(error.stdout));
  const receipt = await generator.validateCompletion({ rawText: output.rawText, files: output.files, manifest: output.manifest });
  assert.equal(receipt.passed, false); assert.equal(receipt.productE2E, 'NOT_RUN');
  assert.match(JSON.stringify(receipt.diagnostics), /Unimplemented|completion slot/);
});

test('undefined and ambiguous definitions block generation with actual bddgen diagnostics', async () => {
  const { generator } = await adapters();
  await assert.rejects(() => generator.generate({requirementKey:'REQ-GEN',featureKey:'generation',sd:'# Dedicated design', feature, stepDefinitions: [], sourceCases }), (error: any) =>
    error.statusCode === 422 && /UNDEFINED|INVALID/.test(error.code) && /it is inspected/.test(error.message));
  await assert.rejects(() => generator.generate({requirementKey:'REQ-GEN',featureKey:'generation',sd:'# Dedicated design', feature, stepDefinitions: steps + "\nWhen('it is inspected',async()=>{});", sourceCases }),
    (error: any) => error.statusCode === 422 && /AMBIGUOUS/i.test(error.code + error.message));
});

test('source projection mismatch and computed step patterns are rejected before code execution', async () => {
  const { generator } = await adapters();
  await assert.rejects(() => generator.generate({requirementKey:'REQ-GEN',featureKey:'generation',sd:'# Dedicated design', feature, stepDefinitions: steps, sourceCases: sourceCases.slice(0, 1) }),
    (error: any) => error.code === 'MAPPING_INVALID');
  await assert.rejects(() => generator.generate({requirementKey:'REQ-GEN',featureKey:'generation',sd:'# Dedicated design', feature, stepDefinitions: 'Given(process.env.PATTERN,async()=>{});', sourceCases }),
    (error: any) => error.code === 'STEP_DEFINITIONS_INVALID');
});

test('completion structural validation runs true typecheck and exact Playwright discovery without claiming runtime success', async () => {
  const { generator } = await adapters();
  const rawText = `import {test,expect} from '@playwright/test';
test('a',{annotation:{type:'workbenchTestId',description:'test-a'}},async({page})=>{await page.goto('http://127.0.0.1:9999');await page.getByTestId('title').fill('saved');await expect(page.getByTestId('title')).toHaveValue('saved');});\n`;
  const manifest = { specPath: 'generated/check.spec.ts', mappings: [{ testKey: 'test-a', scenarioId: 'AC-GEN-001', caseId: 'a' }] };
  const receipt = await generator.validateCompletion({ rawText, manifest });
  assert.equal(receipt.passed, true, JSON.stringify(receipt.diagnostics));
  assert.deepEqual(receipt.discoveredTestKeys, ['test-a']);
  assert.equal(receipt.productE2E, 'NOT_RUN');
  const invalid = await generator.validateCompletion({ rawText: "const n:number='invalid';\n" + rawText, manifest });
  assert.equal(invalid.passed, false); assert.equal(invalid.checks.typecheck, false); assert.equal(invalid.checks.discovery, false);
  assert.match(JSON.stringify(invalid.diagnostics), /not assignable/);
  const disabled = await generator.validateCompletion({ rawText: rawText.replace("test('a'", "test.skip('a'"), manifest });
  assert.equal(disabled.passed, false); assert.match(JSON.stringify(disabled.diagnostics), /Disabled/);
});

test('missing LLM configuration is explicit and never returns fabricated content', async () => {
  const { llm } = await adapters();
  await assert.rejects(() => llm.generateSd({ gherkin: feature }), (error: any) => error.statusCode === 503 && error.code === 'LLM_UNCONFIGURED');
  await assert.rejects(() => llm.complete({ gherkin: feature, sd: 'SD', skeleton: "test('a',{annotation:{type:'workbenchTestId',description:'test-a'}},async()=>{});" }),
    (error: any) => error.code === 'LLM_UNCONFIGURED');
  const missing = await llm.complete({ gherkin: '', sd: '', skeleton: '' });
  assert.equal(missing.status, 'needs_input'); assert.equal(missing.questions.length, 3);
});

// Controlled terminal port for proposal validation only; not a real CLI/E2E claim.
function proposalTerminal(proposal:()=>unknown,requests:{task:string}[]):TerminalRuntimePort {
 return {async create({workspaceRef}){
   requests.push({task:await readFile(join(workspaceRef,'task.md'),'utf8')});
   setImmediate(()=>{void(async()=>{await writeFile(join(workspaceRef,'proposal.json'),JSON.stringify(proposal()));await writeFile(join(workspaceRef,'proposal.ready'),'');})();});
   return {id:'controlled-terminal-port'};
 },input(){},resize(){},subscribe(){return ()=>{};},closeTerminal(){},close(){}};
}
test('terminal proposals preserve questions and reject removed acceptance IDs', async () => {
  const requests:{task:string}[]=[];
  let proposal:any={status:'needs_input',questions:['請補充預期結果。']};
  const {llm}=await adapters({executable:'controlled-terminal-port'},proposalTerminal(()=>proposal,requests));
    const skeleton = "test('a',{annotation:{type:'workbenchTestId',description:'test-a'}},async()=>{});";
    const result = await llm.complete({ gherkin: feature, sd: 'Expected outcome is not specified.', skeleton });
    assert.equal(result.status, 'needs_input'); assert.deepEqual(result.questions, ['請補充預期結果。']);
    assert.equal(result.proposalOnly, true); assert.equal(result.rawText, undefined);
    assert.match(requests[0].task, /Do not remove/);
    proposal = { status: 'completed', questions: [], rawText: "test('other',{annotation:{type:'workbenchTestId',description:'other'}},async()=>{});" };
    await assert.rejects(() => llm.complete({ gherkin: feature, sd: 'SD', skeleton }), (error: any) => error.code === 'LLM_ACCEPTANCE_CHANGED');
    const mapping = { testKey: 'test-extra', scenarioId: 'AC-GEN-001', caseId: 'a' };
    proposal = { status: 'completed', questions: [], rawText: skeleton + "\ntest('extra',{annotation:{type:'workbenchTestId',description:'test-extra'}},async()=>{});", mappings: [mapping] };
    const additional = await llm.complete({ gherkin: feature, sd: 'SD', skeleton });
    assert.deepEqual(additional.mappings, [mapping]);
    assert.equal(additional.proposalOnly, true);
    assert.match(requests.at(-1)!.task, /explicit mappings to known source/);
    proposal.mappings = [{ testKey: 'test-extra', caseId: 'a' }];
    await assert.rejects(() => llm.complete({ gherkin: feature, sd: 'SD', skeleton }),
      (error: any) => error.code === 'LLM_RESPONSE_INVALID' && /未猜測來源/.test(error.message));
});

test('generated SD proposals must pass canonical structural validation before acceptance', async () => {
  let rawText='# SD without required chapters';
  const {llm}=await adapters({executable:'controlled-terminal-port'},proposalTerminal(()=>({status:'completed',questions:[],rawText}),[]));
    await assert.rejects(()=>llm.generateSd({gherkin:feature}),(error:any)=>error.code==='SD_FORMAT_INVALID'&&error.diagnostics.length>0);
    rawText=await readFile(join(root,'spec/REQ-WB-001/workbench/workbench.sd.md'),'utf8');
    const result=await llm.generateSd({gherkin:feature});
    assert.equal(result.status,'completed');assert.equal(result.rawText,rawText);assert.equal(result.proposalOnly,true);
});
