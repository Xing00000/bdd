import {spawnSync,execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {root} from './environment.mjs';
import {sourcesConfirmed} from './bdd/source.mjs';
const directory=path.join(root,'test-results/product/checks');await mkdir(directory,{recursive:true});
const checks=[];
for(const name of ['check','build','test:app']){const start=Date.now(),result=spawnSync('npm',['run',name],{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024});const log=path.join(directory,`${name}.log`);await writeFile(log,result.stdout+result.stderr);checks.push({name,exitCode:result.status,durationMs:Date.now()-start,log,outputSha256:createHash('sha256').update(result.stdout+result.stderr).digest('hex')});console.log(`${name}: exit ${result.status} (${Date.now()-start}ms)`);if(result.status!==0){process.exitCode=result.status??1;break;}}
let manifest;try{manifest=JSON.parse(await readFile(path.join(root,'test-results/bdd/manifest.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
const altered=[];
if(manifest)for(const [file,expected]of Object.entries(manifest.implementationHashes)){
  let bytes;try{bytes=await readFile(path.join(root,file));}catch(error){if(error.code!=='ENOENT')throw error;altered.push(file);continue;}
  if(createHash('sha256').update(bytes).digest('hex')!==expected)altered.push(file);
}
const approvedSources={};if(manifest)for(const [file,expected]of [['spec/REQ-WB-001/workbench/workbench.feature',manifest.featureSha256],['spec/REQ-WB-001/workbench/workbench.sd.md',manifest.sdSha256]]){const actual=createHash('sha256').update(await readFile(path.join(root,file))).digest('hex');approvedSources[file]={expected,actual,unchanged:actual===expected};if(actual!==expected)altered.push(file);}
const bindingCurrent=Boolean(manifest&&sourcesConfirmed()&&!altered.length);
const deleted=new Set(execFileSync('git',['ls-files','--deleted'],{cwd:root,encoding:'utf8'}).split('\n'));
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','src','ui','tests','tools','package.json','package-lock.json','tsconfig.json','tsconfig.build.json','.npmrc'],{cwd:root,encoding:'utf8'}).split('\n').filter(file=>file&&!deleted.has(file));
const sourceHashes={};for(const file of [...new Set(files)].sort())if((await lstat(path.join(root,file))).isFile())sourceHashes[file]=createHash('sha256').update(await readFile(path.join(root,file))).digest('hex');
const receipt={at:new Date().toISOString(),scope:'PRODUCT_COMPONENT_AND_HTTP_API_TESTS',checks,status:checks.length===3&&checks.every(c=>c.exitCode===0)&&bindingCurrent?'PASSED':'FAILED',bddSourceBinding:!manifest?'MISSING':bindingCurrent?'CURRENT':'STALE_OR_UNCONFIRMED',approvedTestImplementationUnchanged:Boolean(manifest&&!altered.length),alteredApprovedFiles:altered,approvedSources,sourceHashes,productE2E:'NOT_RUN',limitations:['This command runs component checks and does not execute product E2E','HTTP LLM protocol fixtures do not verify a real model provider']};
await mkdir(path.join(root,'test-results/product'),{recursive:true});await writeFile(path.join(root,'test-results/product/verification.json'),JSON.stringify(receipt,null,2)+'\n');if(!bindingCurrent)process.exitCode=1;console.log(`BDD source binding: ${receipt.bddSourceBinding}; product E2E: NOT_RUN`);
