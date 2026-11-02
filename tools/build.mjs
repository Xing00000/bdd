import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {copyFile,mkdir,rm} from 'node:fs/promises';
const root = fileURLToPath(new URL('..', import.meta.url));
// These are compiler-owned outputs, never runtime workspaces or user databases.
for(const directory of ['dist/src','dist/tests','dist/public']) await rm(path.join(root,directory),{recursive:true,force:true});
execFileSync(process.execPath, [path.join(root,'node_modules/typescript/bin/tsc'), '-p', path.join(root,'tsconfig.build.json')], {cwd:root,stdio:'inherit'});
const sqliteOutput=path.join(root,'dist/src/adapters/sqlite');
await mkdir(sqliteOutput,{recursive:true});
await copyFile(path.join(root,'src/adapters/sqlite/seed.sql'),path.join(sqliteOutput,'seed.sql'));
