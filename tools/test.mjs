import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url)),directory=path.join(root,'dist/tests');
function collect(folder){return readdirSync(folder,{withFileTypes:true}).flatMap(entry=>{const file=path.join(folder,entry.name);return entry.isDirectory()?collect(file):entry.name.endsWith('.test.js')?[file]:[];});}
const files=collect(directory);
if(!files.length)throw new Error('No compiled application tests; run npm run build first');
const result=spawnSync(process.execPath,['--test',...files],{cwd:root,stdio:'inherit'});process.exitCode=result.status??1;
