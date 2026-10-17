import { createBdd } from 'playwright-bdd';
import registry from './registry.json' with { type: 'json' };
import { pendingStep } from './pending.ts';
const { Given, When, Then } = createBdd();
const register = { Given, When, Then };
// bddgen needs exact registered patterns. No product fixture or step implementation is loaded.
for (const entry of registry) {
  register[entry.keyword as keyof typeof register](new RegExp(entry.pattern),
    { arityCheck: false }, async ({}, ..._args: string[]) => {
      pendingStep(`${entry.scenarioId}:L${entry.line}`);
    });
}
