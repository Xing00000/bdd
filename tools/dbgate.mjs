import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
const execute=promisify(execFile);

export async function startDbGate(databaseFile){
 const root=path.dirname(databaseFile),name=path.basename(databaseFile);
 await execute('docker',['build','-f','tools/dbgate.Dockerfile','-t','bdd-dbgate:7.3.2','tools']);
 const username=randomBytes(12).toString('hex'),password=randomBytes(24).toString('base64url');
 const {stdout}=await execute('docker',['run','--rm','-d','-p','127.0.0.1::3000','--mount',`type=bind,src=${root},dst=/databases`,
  '-e','CONNECTIONS=target','-e',`LABEL_target=${name}`,'-e',`FILE_target=/databases/${name}`,'-e','ENGINE_target=sqlite@dbgate-plugin-sqlite',
  '-e',`LOGIN=${username}`,'-e','PASSWORD','-e','BASIC_AUTH=1','bdd-dbgate:7.3.2'],{env:{...process.env,PASSWORD:password}});
 const container=stdout.trim();
 try{
  const port=(await execute('docker',['port',container,'3000'])).stdout.trim().split(':').at(-1);
  const url=`http://127.0.0.1:${port}/`;
  const authorization='Basic '+Buffer.from(username+':'+password).toString('base64');
  await new Promise((resolve,reject)=>{
   const deadline=setTimeout(()=>{clearInterval(timer);reject(Error('DbGate did not become ready'));},30_000);
   const timer=setInterval(()=>{void fetch(url+'connections/list',{method:'POST',headers:{authorization,'content-type':'application/json'},body:'{}'})
    .then(async response=>{if(!response.ok)return;const connections=await response.json();if(!Array.isArray(connections)||!connections.some(c=>c.databaseFile===`/databases/${name}`))return;clearInterval(timer);clearTimeout(deadline);resolve();}).catch(()=>{});},100);
  });
  return {url,username,password,connectionName:name,databaseFile,close:()=>execute('docker',['stop',container])};
 }catch(error){await execute('docker',['stop',container]);throw error;}
}
