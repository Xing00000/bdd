import { test as base } from 'playwright-bdd';
import { WorkbenchWorld } from './world.ts';
export const test = base.extend<{ sut: WorkbenchWorld }>({
  sut: async ({ page, context }, use, testInfo) => {
    const sut = await WorkbenchWorld.open(page, context, testInfo);
    try { await use(sut); } finally { await sut.close(); }
  },
});
