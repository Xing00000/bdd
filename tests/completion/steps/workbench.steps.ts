import { createBdd } from 'playwright-bdd';
import { test } from '../support/fixtures.ts';
import definitions from './definitions.json' with { type: 'json' };
const { Given, When, Then } = createBdd(test);
const register = { Given, When, Then };
// 每個 entry 是獨立的完整、錨定 pattern 與具體操作／斷言；沒有 catch-all。
for (const definition of definitions) {
  register[definition.keyword as keyof typeof register](new RegExp(definition.pattern),
    { arityCheck: false }, async ({ sut }, ...args: string[]) => {
      await sut.perform(definition, args);
    });
}
