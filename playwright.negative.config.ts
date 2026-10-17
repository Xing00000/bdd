import { defineConfig } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';
export default defineConfig({testDir:defineBddConfig({features:process.env.BDD_NEGATIVE_FEATURE!,steps:[process.env.BDD_NEGATIVE_KIND==='missing'?'tests/skeleton/missing.steps.ts':'tests/skeleton/negative.steps.ts'],outputDir:'.bddgen-negative/output',missingSteps:'fail-on-gen'}),reporter:'list'});
