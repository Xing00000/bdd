import {spawnSync,execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {root} from './environment.mjs';
const directory=path.join(root,'.workbench/receipts');await mkdir(directory,{recursive:true});
const checks=[];
for(const name of ['check','build','test']){const start=Date.now(),result=spawnSync('npm',['--prefix','product','run',name],{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024});const log=path.join(directory,`${name}.log`);await writeFile(log,result.stdout+result.stderr);checks.push({name,exitCode:result.status,durationMs:Date.now()-start,log,outputSha256:createHash('sha256').update(result.stdout+result.stderr).digest('hex')});console.log(`${name}: exit ${result.status} (${Date.now()-start}ms)`);if(result.status!==0){process.exitCode=result.status??1;break;}}
const manifest=JSON.parse(await readFile(path.join(root,'spec/REQ-WB-001/evidence/repair/generation-manifest.json'),'utf8'));
const altered=[];for(const [file,expected]of Object.entries(manifest.implementationHashes)){const actual=createHash('sha256').update(await readFile(path.join(root,file))).digest('hex');if(actual!==expected)altered.push(file);}
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','src','ui','product-tests','product'],{cwd:root,encoding:'utf8'}).split('\n').filter(file=>file&&!file.startsWith('product/evidence/'));
const sourceHashes={};for(const file of [...new Set(files)].sort())if((await lstat(path.join(root,file))).isFile())sourceHashes[file]=createHash('sha256').update(await readFile(path.join(root,file))).digest('hex');
const receipt={at:new Date().toISOString(),scope:'PRODUCT_COMPONENT_AND_HTTP_API_TESTS',checks,status:checks.length===3&&checks.every(c=>c.exitCode===0)&&!altered.length?'PASSED':'FAILED',approvedTestImplementationUnchanged:!altered.length,alteredApprovedFiles:altered,sourceHashes,productE2E:'NOT_RUN',browserIntegration:'BLOCKED_CHROMIUM_BINARY_UNAVAILABLE',realLlmCompletion:'BLOCKED_PROVIDER_UNCONFIGURED',limitations:['A passing unavailable-browser rejection test is not a browser integration pass','HTTP LLM protocol tests use an explicit unit fixture, not an actual model provider','44 approved product E2E cases have not run']};
await mkdir(path.join(root,'product/evidence'),{recursive:true});await writeFile(path.join(root,'product/evidence/verification.json'),JSON.stringify(receipt,null,2)+'\n');if(altered.length)process.exitCode=1;console.log(`Approved tests unchanged: ${!altered.length}; product E2E: NOT_RUN`);
