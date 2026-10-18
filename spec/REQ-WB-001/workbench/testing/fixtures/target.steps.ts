import { test as base, createBdd } from 'playwright-bdd';
import { runnerFixture, type ManagedRunner } from './managed-runner.ts';
export const test=base.extend<{runner:ManagedRunner}>({runner:runnerFixture});
const { Given, When, Then }=createBdd(test);
Given('the account has role {string}',async({runner},role:string)=>{await runner.login(process.env.WB_TARGET_BASE_URL!,role);});
When('the account edits the document',async({runner})=>{const role=await runner.appPage.getByTestId('account-role').innerText();await runner.edit(role==='A'?'denied':'saved');});
Then('the result is {string}',async({runner},expected:string)=>{await runner.assertOutcome(expected);});
