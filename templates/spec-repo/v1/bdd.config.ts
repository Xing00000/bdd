import { defineConfig } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const requirement = process.env.WB_REQUIREMENT_ID;
const feature = process.env.WB_FEATURE_ID;
if (![requirement, feature].every(value => value && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value))) {
  throw new Error('Run bdd:generate/list/test -- <REQ-ID> <feature-id>; one feature per process');
}
const key = `${requirement}/${feature}`;
const metadata = JSON.parse(readFileSync(`spec/${key}/feature.yaml`, 'utf8'));
const output = process.env.WB_TASK_OUTPUT ?? path.resolve(`.runtime/${key}`);
const generated = defineBddConfig({
  features: `spec/${key}/${feature}.feature`,
  steps: ['tests/_shared/**/*.ts', `tests/${requirement}/_shared/**/*.ts`, `tests/${key}/**/*.ts`],
  outputDir: `.generated/${key}`,
  missingSteps: 'fail-on-gen',
  examplesTitleFormat: '[case:<case_id>]',
});
export default defineConfig({
  testDir: generated,
  outputDir: path.join(output, 'raw'),
  forbidOnly: true,
  retries: 0,
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  globalTimeout: 180000,
  projects: metadata.profiles.map((name: 'chromium' | 'firefox' | 'webkit') => ({ name, use: { browserName: name } })),
  use: { baseURL: process.env.WB_TARGET_BASE_URL, screenshot: 'only-on-failure', trace: 'retain-on-failure', launchOptions: { chromiumSandbox: true } },
  reporter: [
    ['list'],
    ['./.workbench-tools/spec-toolkit/reporter.mjs'],
    ['html', { outputFolder: path.join(output, 'native'), open: 'never' }],
  ],
});
