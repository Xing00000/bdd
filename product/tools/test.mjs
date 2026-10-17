import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../..',import.meta.url)),directory=path.join(root,'product/dist/product-tests');
const files=readdirSync(directory).filter(f=>f.endsWith('.test.js')).map(f=>path.join(directory,f));
if(!files.length)throw new Error('No compiled product tests; run npm --prefix product run build first');
const result=spawnSync(process.execPath,['--test',...files],{cwd:root,stdio:'inherit'});process.exitCode=result.status??1;
