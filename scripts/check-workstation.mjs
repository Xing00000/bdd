import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as vm from 'node:vm';
// Parse each ESM source without linking or executing it, in one process.
// Spawning a Node interpreter per file makes validation needlessly expensive.
if (!vm.SourceTextModule) {
  const result = spawnSync(process.execPath, ['--experimental-vm-modules', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
const root = fileURLToPath(new URL('../', import.meta.url));
let count = 0;
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await check(file);
    else if (/\.(mjs|js)$/.test(entry.name)) {
      try { new vm.SourceTextModule(await readFile(file, 'utf8'), { identifier: file }); count++; }
      catch (error) { process.stderr.write(`${file}: ${error.message}\n`); process.exitCode = 1; }
    }
  }
}
for (const directory of ['packages', 'scripts', 'tests/workstation', 'tests/workstation-e2e']) await check(path.join(root, directory));
if (!process.exitCode) process.stdout.write(`Workstation JavaScript syntax checks passed (${count} files).\n`);
