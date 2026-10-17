import { defineConfig } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';
const raw=process.env.WB_COMPLETION_RAW==='1';
const generated = defineBddConfig({
  features: 'spec/REQ-WB-001/workbench/workbench.feature',
  steps: ['spec/REQ-WB-001/workbench/testing/support/fixtures.ts', 'spec/REQ-WB-001/workbench/workbench.steps.ts'],
  outputDir: 'spec/REQ-WB-001/workbench', featuresRoot: 'spec/REQ-WB-001/workbench',
  missingSteps: 'fail-on-gen', examplesTitleFormat: '<case_id>',
});
export default defineConfig({
  testDir: generated, testMatch: raw ? '**/*.spec.js' : '**/*.spec.ts',
  fullyParallel: false, workers: 1, retries: 0, forbidOnly: true,
  timeout: 180_000, expect: { timeout: 10_000 },
  use: { baseURL: process.env.WB_BASE_URL, launchOptions: {chromiumSandbox:true}, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  outputDir: 'test-results/bdd/artifacts',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/bdd', open: 'never' }], ['json', { outputFile: 'test-results/bdd/playwright.json' }], ['./spec/REQ-WB-001/workbench/testing/support/reporter.ts']],
});
