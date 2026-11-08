/** Isolated real workstation host for UI-NAV-002 through WB_TARGET_BASE_URL.
 * Only Given data is provisioned here; browser steps perform all navigation.
 */
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStandaloneServer} from '../../packages/workstation/http.mjs';
import {openStore} from '../../packages/workstation/store.mjs';

const home=await mkdtemp(path.join(tmpdir(),'bdd-navigation-'));
const app=await createStandaloneServer({home,toolkitRoot:fileURLToPath(new URL('../../',import.meta.url)),enableExecution:false,autoAcquire:false,allowLocal:true});
try{
  const store=openStore(home);
  try{
    // Enough real repository cards to exercise document scrolling at desktop
    // widths; no DOM spacer or injected styling supplies the overflow.
    for(let index=0;index<24;index++){
      const repository=app.service.register({title:`Navigation fixture ${index+1}`,remoteUrl:path.join(home,`fixture-${index}.git`)});
      store.setPreferences(repository.id,{schemaVersion:1,configured:true,reviewer:'Fixture reviewer',projects:[]});
    }
  }finally{store.close();}
  await (await app.service.chat()).create({});
  await (await app.service.supervisor()).start({protocol:'pty',command:process.execPath,args:['-e','process.stdin.resume()'],cwd:home});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  process.stdout.write(JSON.stringify({url:`http://127.0.0.1:${app.server.address().port}`,home})+'\n');
}catch(error){await app.close();await rm(home,{recursive:true,force:true});throw error;}
let closing=false;
async function close(){if(closing)return;closing=true;await app.close();await rm(home,{recursive:true,force:true});}
process.on('SIGTERM',()=>void close());process.on('SIGINT',()=>void close());
