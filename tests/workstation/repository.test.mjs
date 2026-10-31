import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture, toolkitRoot } from './helpers.mjs';
import { checkRepository, generatedPath } from '../../scripts/check-repository.mjs';

async function repositoryFixture(t) {
  const f = await fixture(t); await mkdir(f.repo);
  await writeFile(path.join(f.repo, 'package.json'), JSON.stringify({ scripts: { 'test:core': 'node --test' } }));
  await writeFile(path.join(f.repo, 'README.md'), '# Example\n\nnpm run test:core\n');
  return f;
}
test('maintained repository documentation and tracked source pass the cleanup policy', async () => {
  const result = await checkRepository(toolkitRoot);
  assert.deepEqual(result.errors, []); assert.equal(result.ok, true);
});
test('generated copies and superseded guides cannot be committed again', async t => {
  const f = await repositoryFixture(t);
  const files = ['deploy/migrate.mjs', 'dist/src/removed.js', 'spec/REQ-WB-001/workbench/workbench.feature.spec.ts', 'docs/architecture/git-workstation-v1.md'];
  const result = await checkRepository(f.repo, { trackedFiles: files, docs: ['README.md'] });
  assert.equal(result.ok, false); assert.equal(result.errors.length, files.length);
});
test('canonical migrations and authored acceptance tests are not misclassified as generated', () => {
  for (const file of ['src/adapters/sqlite/migrations.ts', 'tools/migrate.mjs', 'tools/deploy.mjs', 'spec/REQ-WB-001/workbench/workbench.steps.ts', 'spec/REQ-WB-001/mcp/mcp.feature.spec.ts']) assert.equal(generatedPath(file), false, file);
});
test('a broken maintained document link fails with its source filename', async t => {
  const f = await repositoryFixture(t); await writeFile(path.join(f.repo, 'README.md'), '[Old guide](docs/missing.md)\n');
  const result = await checkRepository(f.repo, { trackedFiles: [], docs: ['README.md'] });
  assert.equal(result.ok, false); assert.match(result.errors[0], /README.md: broken relative link/);
});
test('relative heading links validate Unicode anchors, not only filenames', async t => {
  const f = await repositoryFixture(t); await writeFile(path.join(f.repo, 'README.md'), '# Example\n\n[正確](#部署與資料保護)\n\n## 部署與資料保護\n');
  assert.equal((await checkRepository(f.repo, { trackedFiles: [], docs: ['README.md'] })).ok, true);
  await writeFile(path.join(f.repo, 'README.md'), '[錯誤](#不存在的標題)\n');
  assert.match((await checkRepository(f.repo, { trackedFiles: [], docs: ['README.md'] })).errors[0], /missing heading/);
});
test('documentation cannot advertise removed npm commands', async t => {
  const f = await repositoryFixture(t); await writeFile(path.join(f.repo, 'README.md'), '```sh\nnpm run removed:command\n```\n');
  assert.match((await checkRepository(f.repo, { trackedFiles: [], docs: ['README.md'] })).errors[0], /unknown npm script removed:command/);
});
test('npm aliases and CLI file paths must resolve', async t => {
  const f = await repositoryFixture(t);
  await writeFile(path.join(f.repo, 'package.json'), JSON.stringify({ scripts: { 'test:core': 'npm run missing:alias', stale: 'node tools/deleted.mjs' } }));
  const result = await checkRepository(f.repo, { trackedFiles: [], docs: ['README.md'] });
  assert.equal(result.errors.length, 2); assert.ok(result.errors.some(x => x.includes('missing CLI entry')));
});
test('clean-clone listing and tooling explicitly regenerate the retained legacy acceptance source', async () => {
  const pkg = JSON.parse(await readFile(path.join(toolkitRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['prespec:list'], 'npm run spec:generate');
  assert.equal(pkg.scripts['pretest:tooling'], 'npm run spec:generate');
});
