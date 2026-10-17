import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const output='spec/REQ-WB-001/evidence/checks';fs.mkdirSync(output,{recursive:true});
const commands=[['generate',['tools/generate.mjs']],['mapping',['tools/verify.mjs']],['list',['node_modules/@playwright/test/cli.js','test','--list']],['typecheck',['node_modules/typescript/bin/tsc','--noEmit']],['tooling',['--test','tools/tooling.test.mjs']]];
const checks=[];
for(const [name,args] of commands){
 const r=spawnSync(process.execPath,args,{encoding:'utf8',maxBuffer:10*1024*1024});
 const log=`$ node ${args.join(' ')}\nexitCode=${r.status}\n${r.stdout??''}${r.stderr??''}`;
 fs.writeFileSync(`${output}/${name}.log`,log);
 checks.push({name,command:`node ${args.join(' ')}`,exitCode:r.status,log:`${output}/${name}.log`});
 console.log(`${name}: exit ${r.status}`);
 if(r.error||r.status!==0){process.exitCode=1;break;}
}
const result={scope:'CODEGEN_SKELETON_ONLY',completionStatus:'PENDING',productE2E:'NOT_RUN',checks,allToolChecksPassed:checks.length===commands.length&&checks.every(c=>c.exitCode===0)};
fs.writeFileSync('spec/REQ-WB-001/evidence/check-results.json',JSON.stringify(result,null,2)+'\n');
