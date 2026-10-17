import { defineConfig } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';
const raw=process.env.WB_COMPLETION_RAW==='1';
const generated = defineBddConfig({
  features: 'spec/REQ-WB-001/workbench.feature',
  steps: ['tests/completion/support/fixtures.ts', 'tests/completion/steps/workbench.steps.ts'],
  outputDir: raw ? '.bddgen-negative/completion-native' : 'generated/completed', featuresRoot: 'spec',
  missingSteps: 'fail-on-gen', examplesTitleFormat: '<case_id>',
});
export default defineConfig({
  testDir: generated, testMatch: raw ? '**/*.spec.js' : '**/*.spec.ts',
  fullyParallel: false, workers: 1, retries: 0, forbidOnly: true,
  timeout: 180_000, expect: { timeout: 10_000 },
  use: { baseURL: process.env.WB_BASE_URL, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  outputDir: 'test-results/completion',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/completion', open: 'never' }], ['json', { outputFile: 'test-results/completion/playwright.json' }], ['./tests/completion/support/reporter.ts']],
});
