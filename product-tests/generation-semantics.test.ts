import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGenerationAdapters } from '../src/adapters/generation/index.js';

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
  const content = await import(pathToFileURL(resolve(root, 'tests/completion/fixtures/content.ts')).href);
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
