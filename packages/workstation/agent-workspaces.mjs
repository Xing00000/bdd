import {stat} from 'node:fs/promises';
import {repositoryPath,canonicalLocation} from './locations.mjs';
import {configuration,validateConfiguration} from '../spec-toolkit/index.mjs';
import {exists,safePath,invariant} from '../contracts/index.mjs';
import {createGit} from '../git-core/index.mjs';

// Authoring owns configuration after import; checkout owns it before import.
export async function registeredAgentWorkspaces(home){
  const {openStore}=await import('./store.mjs');
  const store=openStore(home);
  try{
    const workspaces=[],git=createGit();let projectCount=0;
    for(const repository of store.repositories()){
      const root=await repositoryPath(home,repository.id,repository),snapshot=store.draft(repository.id);
      let config;
      if(snapshot){
        const source=snapshot.files.find(file=>file.target==='spec'&&file.path==='workbench.yaml');
        invariant(source,'INVALID_PROJECT_CONFIG','規格庫修訂缺少 workbench.yaml');
        config=validateConfiguration(JSON.parse(source.content));
      }else{
        if(!await exists(root)||!await exists(await safePath(root,'workbench.yaml')))continue;
        config=await configuration(root);
      }
      projectCount+=config.projects.length;
      if(!await exists(root))continue;
      invariant(canonicalLocation(root)===root,'LOCAL_PATH_CHANGED','規格庫目錄的實際位置已改變',409);
      for(const project of config.projects){
        let cwd;
        try{cwd=await safePath(root,project.path,{missing:false});}
        catch(error){if(error.code==='ENOENT')continue;throw error;}
        invariant((await stat(cwd)).isDirectory(),'INVALID_AGENT_CWD','專案工作目錄必須是資料夾');
        if(!await exists(cwd+'/.git'))continue;
        // Verify the product itself has a HEAD; Git must not resolve an empty
        // submodule directory to its enclosing Spec Repo. A pending gitlink
        // merge does not prevent working in an already checked-out product.
        invariant(await git.root(cwd)===cwd,'INVALID_AGENT_CWD','產品目錄不是獨立的 Git 工作目錄');
        await git.resolve(cwd);
        workspaces.push({repositoryId:repository.id,repositoryTitle:repository.title,projectId:project.id,cwd});
      }
    }
    return {workspaces,projectCount};
  }finally{store.close();}
}
