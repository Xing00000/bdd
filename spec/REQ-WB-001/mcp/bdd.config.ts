import {defineConfig} from '@playwright/test';
import {defineBddConfig} from 'playwright-bdd';
export default defineConfig({testDir:defineBddConfig({features:"mcp.feature",featuresRoot:'.',steps:["mcp.steps.ts"],outputDir:'.',missingSteps:'fail-on-gen',examplesTitleFormat:'<case_id>'}),testMatch:'**/*.spec.ts',workers:1,retries:0,forbidOnly:true});
