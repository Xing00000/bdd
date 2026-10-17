import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
execFileSync(process.execPath, [path.join(root,'node_modules/typescript/bin/tsc'), '-p', path.join(root,'tsconfig.build.json')], {cwd:root,stdio:'inherit'});
execFileSync(process.execPath, [path.join(root,'node_modules/vite/bin/vite.js'), 'build', '--config', path.join(root,'ui/vite.config.ts')], {cwd:root,stdio:'inherit'});
