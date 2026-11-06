/** Settings prepares the Spec Repo toolchain; generation only consumes it. */
import { invariant, digest } from '../contracts/index.mjs';
import { materializeDependencies } from '../spec-toolkit/dependencies.mjs';
import { ensureDraft, inDraftView, sourceFiles } from './authoring.mjs';
import { ensureInstallation, repositoryToolsPath } from './flows.mjs';
import { refreshWorkflowFiles, draftModules, liveWorkflowSpecSourceDigest } from './workflow-state.mjs';
import { scan, defaultProfiles } from '../spec-toolkit/index.mjs';

export async function prepareRepositoryTools(context) {
  const {store,request}=context,repositoryId=request.repositoryId;
  const prior=store.draftReceipt(repositoryId,request.operationId,request);if(prior)return prior;
  const snapshot=await ensureDraft({...context,repositoryId});
  invariant(snapshot.settings.configured,'SETUP_REQUIRED','請先儲存設定。',409);
  return inDraftView(snapshot,async root=>{
    const features=(await scan(root)).features;
    const profiles=features.length?[...new Set(features.filter(feature=>!feature.authoringOnly).flatMap(feature=>feature.profiles))]:[...defaultProfiles];
    const installation=await ensureInstallation({...context,root,profiles,git:undefined});
    await refreshWorkflowFiles(root,{modules:draftModules(snapshot,store.projection(repositoryId)),runs:store.runs(repositoryId),reports:store.reports(repositoryId),checkpoint:store.projection(repositoryId),specSourceDigest:await liveWorkflowSpecSourceDigest(context,snapshot,root)});
    const files=(await sourceFiles(root)).filter(file=>!snapshot.files.some(old=>old.target===file.target&&old.path===file.path&&old.sha256===digest(file.content)))
      .map(file=>({...file,baseHash:snapshot.files.find(old=>old.target===file.target&&old.path===file.path)?.baseHash??null}));
    return store.saveDraft(repositoryId,{expectedRevision:snapshot.revision,operationId:request.operationId,request,files,result:{ready:true,...installation}});
  });
}

export async function useRepositoryTools(root,options,request) {
  invariant(options.enableExecution,'EXECUTION_DISABLED','主機尚未啟用受信任執行。',403);
  const tools=await repositoryToolsPath(options.home,request.repositoryId);
  try { await materializeDependencies(tools,root); }
  catch(error) {
    if(error.code!=='ENOENT'&&!['DEPENDENCIES_CHANGED','DEPENDENCIES_NOT_INSTALLED'].includes(error.code))throw error;
    invariant(false,'SETUP_TOOLS_REQUIRED','測試工具尚未準備完成或套件定義已更新；請到設定頁儲存並準備套件。',409);
  }
}
