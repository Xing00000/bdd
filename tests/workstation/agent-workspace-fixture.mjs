import {mkdtemp,mkdir,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createAgentSupervisor} from '../../packages/workstation/agent-supervisor.mjs';
import {openStore} from '../../packages/workstation/store.mjs';
import {createGit} from '../../packages/git-core/index.mjs';
export async function projectFixture(){
 const base=await realpath(await mkdtemp(path.join(tmpdir(),'bdd-agent-workspaces-'))),home=path.join(base,'home'),root=path.join(base,'spec'),scratch=path.join(home,'chat','workspace');
 await mkdir(scratch,{recursive:true});await mkdir(root);
 const template=JSON.parse(await readFile(new URL('../../templates/spec-repo/v1/workbench.yaml',import.meta.url),'utf8'));
 const config={...template,specRepositoryId:'fixture-spec',projects:[{id:'alpha',path:'projects/alpha'},{id:'beta',path:'projects/beta'}]};
 const git=createGit();
 for(const project of config.projects){
  const directory=path.join(root,project.path);await mkdir(directory,{recursive:true});await git.init(directory);
  await writeFile(path.join(directory,'README.md'),'Workspace fixture\n');
  await git.commitSelected(directory,{paths:['README.md'],message:'Initialize product fixture'},{head:null,branch:'main'});
 }
 await writeFile(path.join(root,'workbench.yaml'),JSON.stringify(config));
 const store=openStore(home);try{store.register({id:'fixture-spec',title:'Project fixture',remoteUrl:'https://github.com/example/spec.git',localPath:root});}finally{store.close();}
 const supervisor=await createAgentSupervisor({home,defaultRepositoryId:'CHAT',defaultCwd:scratch});
 return {base,home,root,scratch,config,supervisor,async close(){await supervisor.close();await rm(base,{recursive:true,force:true});}};
}
