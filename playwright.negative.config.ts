import { defineConfig } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';
export default defineConfig({testDir:defineBddConfig({features:process.env.BDD_NEGATIVE_FEATURE!,steps:[process.env.BDD_NEGATIVE_KIND==='missing'?'tools/spec/REQ-WB-001/workbench/testing/fixtures/missing.steps.ts':'tools/spec/REQ-WB-001/workbench/testing/fixtures/ambiguous.steps.ts'],outputDir:'.bddgen-negative/output',missingSteps:'fail-on-gen'}),reporter:'list'});
