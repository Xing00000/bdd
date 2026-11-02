import {defineConfig} from '@playwright/test';
export default defineConfig({workers:1,retries:0,forbidOnly:true,timeout:300000,
 projects:[{name:'workstation',testDir:'tests/chat-ui',testMatch:'**/*.spec.mjs'}],
 use:{baseURL:process.env.WB_BASE_URL,viewport:{width:1440,height:1000},screenshot:'only-on-failure',trace:'retain-on-failure'},
 outputDir:'test-results/chat/artifacts',
 reporter:[['list'],['html',{outputFolder:'playwright-report/bdd',open:'never'}],['json',{outputFile:'test-results/chat/playwright.json'}]],
});
