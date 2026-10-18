import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
export const root=fileURLToPath(new URL('..',import.meta.url));
export async function fixtureEnvironment(){const raw=await readFile(path.join(root,'.test-fixtures/product.env'),'utf8');const env={};for(const line of raw.split('\n').filter(Boolean)){const at=line.indexOf('=');env[line.slice(0,at)]=JSON.parse(line.slice(at+1));}return env;}
