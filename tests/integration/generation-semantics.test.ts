import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGenerationAdapters } from '../../src/adapters/generation/index.js';

const root = resolve(process.cwd());
const manifest = { specPath: 'generated/semantic.spec.ts', mappings: [{ testKey: 'semantic-a', scenarioId: 'AC-SEM-001', caseId: 'default' }] };
const spec = (body: string, extra = '') => `import {test,expect} from '@playwright/test';\n${extra}\ntest('semantic a',{annotation:{type:'workbenchTestId',description:'semantic-a'}},async({page})=>{${body}});\n`;
async function validator() {
  const { generator } = createGenerationAdapters({ root, artifactRoot: await mkdtemp(join(tmpdir(), 'workbench-semantics-')) });
  return (rawText: string, options: Record<string, unknown> = {}) => generator.validateCompletion({ rawText, manifest, ...options });
}

test('completion refuses waits, constants, fake action names, dead assertions and swallowed failures', async () => {
  const validate = await validator();
  const candidates = [
    spec('await Promise.resolve();'),
    spec("await page.goto('http://127.0.0.1:9999');expect(1).toBe(1);"),
    spec("await page.goto('http://127.0.0.1:9999');const expected=1;expect(expected).toBe(expected);"),
    spec("await page.goto('http://127.0.0.1:9999');const actual=await page.getByTestId('result').innerText();expect(actual).toBe(actual);"),
    spec("await page.goto('http://127.0.0.1:9999');const actual=await page.getByTestId('result').innerText();expect(actual===actual).toBe(true);"),
    spec("await page.goto('http://127.0.0.1:9999');expect(page.getByTestId('result')).toBeTruthy();"),
    spec("await page.goto('http://127.0.0.1:9999');const deferred=async()=>{await expect(page.getByTestId('result')).toHaveText('saved');};"),
    spec("await page.goto('http://127.0.0.1:9999');if(Math.random()>0.5)await expect(page.getByTestId('result')).toHaveText('saved');"),
    spec("await page.goto('http://127.0.0.1:9999');try{await expect(page.getByTestId('result')).toHaveText('saved');}catch{}"),
    spec("await page.goto('http://127.0.0.1:9999');expect(page.getByTestId('result')).toHaveText('saved');"),
    spec("const fake={async goto(url:string){},async innerText(){return 'saved';}};await fake.goto('fixture');expect(await fake.innerText()).toBe('saved');"),
  ];
  for (const [index, candidate] of candidates.entries()) {
    const receipt = await validate(candidate);
    assert.equal(receipt.checks.typecheck, true, `candidate ${index} must reach semantic guard: ${JSON.stringify(receipt.diagnostics)}`);
    assert.equal(receipt.passed, false, `candidate ${index} falsely completed`);
    assert.equal(receipt.checks.acceptanceImplementation, false);
    assert.equal(receipt.checks.discovery, false);
    assert.match(JSON.stringify(receipt.diagnostics), /無法證明/);
  }
});

test('genuine page actions and observed assertions are discoverable without launching a browser', async () => {
  const validate = await validator();
  const receipt = await validate(spec("await page.goto('http://127.0.0.1:9999');await page.getByTestId('editor').fill('saved');const actual=await page.getByTestId('result').innerText();expect(actual).toBe('saved');"));
  assert.equal(receipt.passed, true, JSON.stringify(receipt.diagnostics));
  assert.equal(receipt.checks.acceptanceImplementation, true);
  assert.equal(receipt.productE2E, 'NOT_RUN');
});

test('switch proof covers every successful dispatch and respects break, fallthrough and return',async()=>{
 const validate=await validator();
 const action="await page.getByTestId('save').click();",outcome="await expect(page.getByTestId('result')).toHaveText('saved');";
 const prefix="const role=await page.getByTestId('role').innerText();";
 for(const body of [
  `${prefix}switch(role){case 'A':${action}break;case 'B':${action}break;default:throw Error('Unsupported role');}${outcome}`,
  `${prefix}switch(role){case 'A':case 'B':${action}${outcome}return;default:throw Error('Unsupported role');}`,
  `switch('A'){case 'A':${action}${outcome}break;default:break;}`,
 ]){const receipt=await validate(spec(body));assert.equal(receipt.passed,true,JSON.stringify(receipt.diagnostics));}
 for(const body of [
  `${prefix}switch(role){case 'A':${action}${outcome}break;}`,
  `${prefix}switch(role){case 'A':${action}${outcome}break;default:break;}`,
  `${prefix}switch(role){case 'A':${action}${outcome}break;case 'B':${action}break;default:throw Error('Unsupported role');}`,
  `${prefix}switch(role){case 'A':if(role==='A')break;${action}${outcome}break;default:throw Error('Unsupported role');}`,
  `${prefix}switch(role){case 'A':${action}return;case 'B':${action}break;default:throw Error('Unsupported role');}${outcome}`,
  `${prefix}let stop=false;switch(role){case 'A':stop=true;break;default:break;}if(stop)return;${action}${outcome}`,
  `${prefix}let stop=false;switch(role){case 'A':if(await page.getByTestId('stop').isVisible())stop=true;break;default:break;}if(stop)return;${action}${outcome}`,
 ]){const receipt=await validate(spec(body));assert.equal(receipt.checks.typecheck,true,JSON.stringify(receipt.diagnostics));assert.equal(receipt.passed,false,'Every successful switch path needs real operations and assertions');}
});

test('catch entry never reuses state from before a possibly mutating try',async()=>{
 const validate=await validator();
 const action="await page.getByTestId('save').click();",outcome="await expect(page.getByTestId('result')).toHaveText('saved');";
 for(const body of [
  `let stop=false;try{stop=true;throw Error('x');}catch{}if(stop)return;${action}${outcome}`,
  `let stop=false;const fail=async()=>{stop=true;throw Error('x');};try{await fail();}catch{}if(stop)return;${action}${outcome}`,
  `let stop=0;try{stop++;throw Error('x');}catch{}if(stop)return;${action}${outcome}`,
  `try{stop=true;throw Error('x');}catch{}if(stop)return;${action}${outcome}`,
 ]){
  const helper=body.startsWith('try')?'let stop=false;':'';
  const receipt=await validate(spec(body,helper));
  assert.equal(receipt.checks.typecheck,true,JSON.stringify(receipt.diagnostics));
  assert.equal(receipt.passed,false,'Caught mutations cannot hide a successful path that skips operations and assertions');
 }
 for(const body of [
  `try{throw Error('x');}catch{${action}${outcome}}`,
  `try{throw Error('x');}catch{}${action}${outcome}`,
  `const expected='saved';try{await page.screenshot();}catch{}${action}await expect(page.getByTestId('result')).toHaveText(expected);`,
 ]){
  const receipt=await validate(spec(body));
  assert.equal(receipt.passed,true,JSON.stringify(receipt.diagnostics));
 }
});

test('official BDD invocations resolve reachable registered steps and preserve outcome proof',async()=>{
 const validate=await validator();
 const rawText=`import {test} from './semantic.steps.ts';
test('semantic a',{annotation:{type:'workbenchTestId',description:'semantic-a'}},async({Given,When,Then})=>{
 await Given('the editor is open');await When('the value is "saved"');await Then('the result is "saved"');
});`;
 const steps=(outcome:string,pattern="'the result is {string}'")=>`import {test,createBdd} from 'playwright-bdd';
import {expect} from '@playwright/test';export {test};const {Given,When,Then}=createBdd(test);
Given('the editor is open',async({page})=>{await page.goto('http://fixture.invalid');});
When('the value is {string}',async({page},value:string)=>{await page.getByTestId('editor').fill(value);});
Then(${pattern},async({page},expected:string)=>{${outcome}});`;
 const real="await expect(page.getByTestId('result')).toHaveText(expected);";
 const check=(raw:string,source:string,extra:{path:string;rawText:string}[]=[])=>validate(raw,{files:[{path:'generated/semantic.steps.ts',rawText:source},...extra]});
 for(const pattern of ["'the result is {string}'",'/^the result is "([^\\"]*)"$/']){
  const receipt=await check(rawText,steps(real,pattern));assert.equal(receipt.passed,true,JSON.stringify(receipt.diagnostics));assert.equal(receipt.productE2E,'NOT_RUN');
 }
 const and=await check(rawText.replace('{Given,When,Then}','{Given,When,And}').replace('await Then(','await And('),steps(real));assert.equal(and.passed,true,JSON.stringify(and.diagnostics));
 for(const outcome of ["await Promise.resolve();","const value='saved';","expect('saved').toBe('saved');",`try{${real}}catch{}`]){
  const receipt=await check(rawText,steps(outcome));assert.equal(receipt.passed,false,'BDD outcomes must retain executed observable assertions');
 }
 const unawaited=await check(rawText.replace("await Then(","Then("),steps(real));assert.equal(unawaited.passed,false);
 const ambiguous=await check(rawText,steps(real)+`\nThen('the result is {string}',async({page},expected:string)=>{${real}});`);assert.equal(ambiguous.passed,false);
 const noOutcome=steps(real).split('Then(\'the result')[0];
 const detached=`import {test} from './semantic.steps.ts';import {createBdd} from 'playwright-bdd';import {expect} from '@playwright/test';const {Then}=createBdd(test);Then('the result is {string}',async({page},expected:string)=>{${real}});`;
 const unreachable=await check(rawText,noOutcome,[{path:'generated/unimported.steps.ts',rawText:detached}]);assert.equal(unreachable.passed,false,'Unimported registrations never prove an invoked step');
 const spoof=steps(real).replace("import {test,createBdd}","import {test as base,createBdd}").replace('export {test};',"const test=base.extend({Then:async({},use)=>{await use(async()=>{});}});export {test};");
 const spoofed=await check(rawText,spoof);assert.equal(spoofed.checks.typecheck,true,JSON.stringify(spoofed.diagnostics));assert.equal(spoofed.passed,false,'Overridden BDD invokers cannot borrow registered assertions');
 const useOverride=await check(rawText,steps(real)+"\ntest.use({Then:async({},use)=>{await use(async()=>{});}});");assert.equal(useOverride.checks.typecheck,true,JSON.stringify(useOverride.diagnostics));assert.equal(useOverride.passed,false,'test.use cannot replace a proven BDD invoker');
 const metadata=await check(rawText+"\ntest.use({$test:[({},use)=>use(test),{scope:'test',box:true}]});",steps(real));assert.equal(metadata.passed,true,JSON.stringify(metadata.diagnostics));
 const fakeTest=await check(rawText+"\ntest.use({$test:[async({},use)=>{await use(Object.assign(test,{step:async()=>undefined}));},{scope:'test',box:true}]});",steps(real));assert.equal(fakeTest.checks.typecheck,true,JSON.stringify(fakeTest.diagnostics));assert.equal(fakeTest.passed,false,'Metadata cannot replace the real test.step dispatcher');
 const mutable=await check(rawText,steps(real).replace('const {Given,When,Then}','let {Given,When,Then}').replace("Then('the result", "Then=(()=>{}) as typeof Then;Then('the result"));assert.equal(mutable.passed,false,'Reassigned registrars do not register callbacks');
 for(const statement of ["import type {Marker} from './hidden.steps.ts';","import {type Marker} from './hidden.steps.ts';","export type {Marker} from './hidden.steps.ts';"]){
  const typeOnly=rawText.replace("import {test} from './semantic.steps.ts';",`import {test} from 'playwright-bdd';${statement}`);
  const receipt=await validate(typeOnly,{files:[{path:'generated/hidden.steps.ts',rawText:steps(real)+'\nexport type Marker=string;'}]});assert.equal(receipt.checks.typecheck,true,JSON.stringify(receipt.diagnostics));assert.equal(receipt.passed,false,'Type-only imports/exports never load runtime registrations');
 }
});

test('Playwright-BDD configuration loads registered steps that are not imported by the spec',async()=>{
 const validate=await validator();
 const rawText=`import {test} from 'playwright-bdd';
test('semantic a',{annotation:{type:'workbenchTestId',description:'semantic-a'}},async({Given,When,Then})=>{
 await Given('the editor is open');await When('the editor is saved');await Then('the result is "saved"');
});`;
 const config=`import {defineConfig} from '@playwright/test';
import {defineBddConfig} from 'playwright-bdd';
const generated=defineBddConfig({features:'semantic.feature',featuresRoot:'.',steps:['semantic.steps.ts'],outputDir:'.'});
export default defineConfig({testDir:generated});`;
 const steps=`import {test,createBdd} from 'playwright-bdd';
import {expect} from '@playwright/test';
const {Given,When,Then}=createBdd(test);
Given('the editor is open',async({page})=>{await page.goto('http://127.0.0.1:9999');});
When('the editor is saved',async({page})=>{await page.getByTestId('save').click();});
Then('the result is {string}',async({page},expected:string)=>{await expect(page.getByTestId('result')).toHaveText(expected);});`;
 const receipt=await validate(rawText,{manifest:{...manifest,configPath:'generated/bdd.config.ts'},files:[
  {path:'generated/bdd.config.ts',rawText:config},
  {path:'generated/semantic.steps.ts',rawText:steps},
 ]});
 assert.equal(receipt.checks.typecheck,true,JSON.stringify(receipt.diagnostics));
 assert.equal(receipt.checks.acceptanceImplementation,true,JSON.stringify(receipt.diagnostics));
 assert.equal(receipt.passed,true,JSON.stringify(receipt.diagnostics));
 assert.equal(receipt.productE2E,'NOT_RUN');
});

test('Playwright-BDD registered steps accept statically declared provided options',async()=>{
 const validate=await validator();
 const rawText=`import {test} from './semantic.steps.ts';
test('semantic a',{annotation:{type:'workbenchTestId',description:'semantic-a'}},async({Given,When,Then})=>{
 await Given('the editor is open');await When('the editor is saved');await Then('the result is "saved"');
});`;
 const config=`import {defineConfig} from '@playwright/test';
import {defineBddConfig} from 'playwright-bdd';
export default defineConfig({testDir:defineBddConfig({features:'semantic.feature',featuresRoot:'.',steps:['semantic.steps.ts'],outputDir:'.'})});`;
 const steps=(options:string)=>`import {test,createBdd} from 'playwright-bdd';
import {expect} from '@playwright/test';
const {Given,When,Then}=createBdd(test);
export {test};
Given('the editor is open',${options},async({page})=>{await page.goto('http://127.0.0.1:9999');});
When('the editor is saved',${options},async({page})=>{await page.getByTestId('save').click();});
Then('the result is {string}',${options},async({page},expected:string)=>{await expect(page.getByTestId('result')).toHaveText(expected);});`;
 const check=(source:string)=>validate(rawText,{manifest:{...manifest,configPath:'generated/bdd.config.ts'},files:[
  {path:'generated/bdd.config.ts',rawText:config},{path:'generated/semantic.steps.ts',rawText:source},
 ]});
 const accepted=await check(steps('{arityCheck:false}'));
 assert.equal(accepted.checks.typecheck,true,JSON.stringify(accepted.diagnostics));
 assert.equal(accepted.checks.acceptanceImplementation,true,JSON.stringify(accepted.diagnostics));
 assert.equal(accepted.passed,true,JSON.stringify(accepted.diagnostics));
 const dynamic=await check(`const options={arityCheck:false};\n${steps('options')}`);
 assert.equal(dynamic.checks.typecheck,true,JSON.stringify(dynamic.diagnostics));
 assert.equal(dynamic.checks.acceptanceImplementation,false,'Dynamic provided options must not prove which step registration runs');
 assert.equal(dynamic.passed,false);
 const tagFiltered=await check(steps("{tags:'@never-present'}"));
 assert.equal(tagFiltered.checks.typecheck,true,JSON.stringify(tagFiltered.diagnostics));
 assert.equal(tagFiltered.checks.acceptanceImplementation,false,'A tagged definition cannot prove its callback runs without scenario tag evidence');
 assert.equal(tagFiltered.passed,false);
});

test('Playwright-BDD step registrations must be reachable from the exported Playwright config',async()=>{
 const validate=await validator();
 const rawText=`import {test} from 'playwright-bdd';
test('semantic a',{annotation:{type:'workbenchTestId',description:'semantic-a'}},async({Given,When,Then})=>{
 await Given('the editor is open');await When('the editor is saved');await Then('the result is "saved"');
});`;
 const config=`import {defineConfig} from '@playwright/test';
import {defineBddConfig} from 'playwright-bdd';
const unused=defineBddConfig({features:'semantic.feature',featuresRoot:'.',steps:['semantic.steps.ts'],outputDir:'.'});
export default defineConfig({testDir:'.'});`;
 const steps=`import {test,createBdd} from 'playwright-bdd';
import {expect} from '@playwright/test';
const {Given,When,Then}=createBdd(test);
Given('the editor is open',async({page})=>{await page.goto('http://127.0.0.1:9999');});
When('the editor is saved',async({page})=>{await page.getByTestId('save').click();});
Then('the result is {string}',async({page},expected:string)=>{await expect(page.getByTestId('result')).toHaveText(expected);});`;
 const check=(configText:string)=>validate(rawText,{manifest:{...manifest,configPath:'generated/bdd.config.ts'},files:[
  {path:'generated/bdd.config.ts',rawText:configText},{path:'generated/semantic.steps.ts',rawText:steps},
 ]});
 const receipt=await check(config);
 assert.equal(receipt.checks.typecheck,true,JSON.stringify(receipt.diagnostics));
 assert.equal(receipt.checks.acceptanceImplementation,false,'An unused defineBddConfig call must not register steps for the exported Playwright config');
 assert.equal(receipt.passed,false);
 const overriddenSteps=await check(`import {defineConfig} from '@playwright/test';
import {defineBddConfig} from 'playwright-bdd';
const override:object={steps:[] as string[]};
const generated=defineBddConfig({features:'semantic.feature',featuresRoot:'.',steps:['semantic.steps.ts'],...override,outputDir:'.'});
export default defineConfig({testDir:generated});`);
 assert.equal(overriddenSteps.checks.typecheck,true,JSON.stringify(overriddenSteps.diagnostics));
 assert.equal(overriddenSteps.checks.acceptanceImplementation,false,'A spread cannot override the statically inspected BDD steps list');
 assert.equal(overriddenSteps.passed,false);
 const overriddenTestDir=await check(`import {defineConfig} from '@playwright/test';
import {defineBddConfig} from 'playwright-bdd';
const override:object={testDir:'.'};
export default defineConfig({testDir:defineBddConfig({features:'semantic.feature',featuresRoot:'.',steps:['semantic.steps.ts'],outputDir:'.'}),...override});`);
 assert.equal(overriddenTestDir.checks.typecheck,true,JSON.stringify(overriddenTestDir.diagnostics));
 assert.equal(overriddenTestDir.checks.acceptanceImplementation,false,'A spread cannot replace the exported config testDir proof');
 assert.equal(overriddenTestDir.passed,false);
});

test('Playwright-BDD specs must reuse the test object bound to custom step registrations',async()=>{
 const validate=await validator();
 const config=`import {defineConfig} from '@playwright/test';
import {defineBddConfig} from 'playwright-bdd';
export default defineConfig({testDir:defineBddConfig({features:'semantic.feature',featuresRoot:'.',steps:['semantic.steps.ts'],outputDir:'.'})});`;
 const steps=`import {test as base,createBdd} from 'playwright-bdd';
import {expect} from '@playwright/test';
export const test=base.extend<{registeredFixture:string}>({registeredFixture:async({},use)=>{await use('registered');}});
const {Given,When,Then}=createBdd(test);
Given('the editor is open',async({page})=>{await page.goto('http://127.0.0.1:9999');});
When('the editor is saved',async({page})=>{await page.getByTestId('save').click();});
Then('the result is {string}',async({page},expected:string)=>{await expect(page.getByTestId('result')).toHaveText(expected);});`;
 const specWith=(testImport:string)=>`${testImport}
test('semantic a',{annotation:{type:'workbenchTestId',description:'semantic-a'}},async({Given,When,Then})=>{
 await Given('the editor is open');await When('the editor is saved');await Then('the result is "saved"');
});`;
 const check=(rawText:string)=>validate(rawText,{manifest:{...manifest,configPath:'generated/bdd.config.ts'},files:[
  {path:'generated/bdd.config.ts',rawText:config},{path:'generated/semantic.steps.ts',rawText:steps},
 ]});
 const shared=await check(specWith("import {test} from './semantic.steps.ts';"));
 assert.equal(shared.checks.typecheck,true,JSON.stringify(shared.diagnostics));
 assert.equal(shared.checks.acceptanceImplementation,true,JSON.stringify(shared.diagnostics));
 const mismatched=await check(specWith("import {test as base} from 'playwright-bdd';const test=base.extend<{specFixture:string}>({specFixture:async({},use)=>{await use('separate');}});"));
 assert.equal(mismatched.checks.typecheck,true,JSON.stringify(mismatched.diagnostics));
 assert.equal(mismatched.checks.acceptanceImplementation,false,'Steps bound to a custom test object cannot prove a spec using a separate test object');
 assert.equal(mismatched.passed,false);
});

test('resolved local helpers count only executed callbacks and preserve final outcome assertions', async () => {
  const validate = await validator();
  const helper = `import type {Page} from '@playwright/test';
async function capture(action:()=>Promise<void>){await action();}
async function setup(page:Page){await page.goto('http://127.0.0.1:9999');await expect(page.getByTestId('ready')).toBeVisible();}
async function outcome(page:Page){await capture(async()=>{await expect(page.getByTestId('result')).toHaveText('saved');});}
async function weakened(page:Page){await Promise.resolve();}
`;
  const good = await validate(spec('await setup(page);await outcome(page);', helper));
  assert.equal(good.passed, true, JSON.stringify(good.diagnostics));
  const weakened = await validate(spec('await setup(page);await page.getByTestId(\'save\').click();await weakened(page);', helper));
  assert.equal(weakened.passed, false, 'Setup assertion cannot replace a removed outcome after the final action');
  const removed = await validate(spec('await setup(page);await weakened(page);', helper));
  assert.equal(removed.passed, false, 'A setup assertion cannot cover a final helper whose outcome assertion was removed');
  for (const deadOutcome of ['await setup(page);if(false){await outcome(page);}', 'await setup(page);const later=()=>outcome(page);']) {
    const receipt = await validate(spec(deadOutcome, helper));
    assert.equal(receipt.passed, false, 'A setup assertion cannot cover an unexecuted final outcome');
  }
});

test('approved absolute imported managed-runner helpers retain real operations and outcome assertions', async () => {
  const content = await import(pathToFileURL(resolve(root, 'spec/REQ-WB-001/workbench/testing/fixtures/content.ts')).href);
  const rawText = content.specText('http://127.0.0.1:9999', true);
  const validate = await validator();
  const mapped = { specPath: 'generated/managed.spec.ts', mappings: [
    { testKey: 'test-a', scenarioId: 'AC-DEMO-001', caseId: 'a' },
    { testKey: 'test-b', scenarioId: 'AC-DEMO-001', caseId: 'b' },
    { testKey: 'test-a-extra', scenarioId: 'AC-DEMO-001', caseId: 'a' },
  ] };
  const receipt = await validate(rawText, { manifest: mapped });
  assert.equal(receipt.passed, true, JSON.stringify(receipt.diagnostics));
  assert.deepEqual(new Set(receipt.discoveredTestKeys), new Set(['test-a', 'test-b', 'test-a-extra']));
  assert.equal(receipt.productE2E, 'NOT_RUN');
});
