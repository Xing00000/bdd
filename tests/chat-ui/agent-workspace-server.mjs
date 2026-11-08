import path from 'node:path';
import {mkdir,symlink,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {projectFixture} from '../workstation/agent-workspace-fixture.mjs';
import {createStandaloneServer} from '../../packages/workstation/http.mjs';
// A real CLI verifies cwd and filesystem writes; no model inference is claimed.
const f=await projectFixture(),peer=path.join(f.base,'cli-peer.mjs');
await writeFile(peer,"import {createInterface} from 'node:readline';import {writeFileSync} from 'node:fs';console.log('WORKSPACE='+process.cwd());createInterface({input:process.stdin}).on('line',message=>{if(!message.trim())return;writeFileSync('cli-proof.json',JSON.stringify({cwd:process.cwd(),message}));console.log('SAVED '+message);});\n");
process.env.WB_AGENT_SUPERVISOR_COMMAND=process.execPath;
process.env.WB_AGENT_SUPERVISOR_ARGS_JSON=JSON.stringify([peer]);
const outside=path.join(f.base,'unregistered');await mkdir(outside);await symlink(outside,path.join(f.root,'projects','alpha','escape'),'dir');
let app;
try{
 app=await createStandaloneServer({home:f.home,toolkitRoot:fileURLToPath(new URL('../../',import.meta.url)),enableExecution:false});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 process.stdout.write(JSON.stringify({url:`http://127.0.0.1:${app.server.address().port}`})+'\n');
}catch(error){await app?.close();await f.close();throw error;}
let closing=false;
async function close(){if(closing)return;closing=true;await app.close();await f.close();}
process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());
