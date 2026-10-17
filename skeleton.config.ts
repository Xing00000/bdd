import { defineConfig } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';
const raw = process.env.BDDGEN_RAW === '1';
const generated = defineBddConfig({
  features: 'spec/REQ-WB-001/workbench.feature',
  steps: ['tests/skeleton/skeleton.steps.ts'],
  outputDir: raw ? '.bddgen-raw' : 'generated/skeleton', featuresRoot: 'spec',
  missingSteps: 'fail-on-gen', examplesTitleFormat: '<case_id>',
});
export default defineConfig({
  testDir: generated, testMatch: raw ? '**/*.spec.js' : '**/*.spec.ts',
  fullyParallel: false, workers: 1, retries: 0, forbidOnly: true,
  timeout: 10_000, reporter: 'list', outputDir: 'test-results',
});
