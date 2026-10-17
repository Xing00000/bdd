import { execFileSync } from 'node:child_process';
import { symlink, lstat, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const product = fileURLToPath(new URL('..', import.meta.url));
const root = path.resolve(product, '..');
for (const folder of ['src', 'ui']) {
  const link = path.join(root, folder, 'node_modules');
  await mkdir(path.dirname(link), {recursive:true});
  try { await lstat(link); } catch { await symlink(path.join(product, 'node_modules'), link, 'dir'); }
}
execFileSync(process.execPath, [path.join(product,'node_modules/typescript/bin/tsc'), '-p', path.join(product,'tsconfig.json')], {cwd:root,stdio:'inherit'});
execFileSync(process.execPath, [path.join(product,'node_modules/vite/bin/vite.js'), 'build', '--config', path.join(root,'ui/vite.config.ts'), '--outDir', path.join(product,'public')], {cwd:root,stdio:'inherit'});
