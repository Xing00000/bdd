/** Generate a plan from the confirmed SQLite revision; checkout and products are context only. */
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { id, invariant, digest, identity, safePath, atomicWrite, writeJson, walk, exists } from '../contracts/index.mjs';
import { execute, processEnvironment } from '../git-core/index.mjs';
import { scan, reviewState } from '../spec-toolkit/index.mjs';
import { ensureDraft, inDraftView, sourceFiles, draftProjectFiles, readDraftFile } from './authoring.mjs';
import { validateAgentSettings, renderAgentPrompt } from './agent-settings.mjs';
import { agentExecutable } from './development.mjs';
import { useRepositoryTools } from './repository-tools.mjs';
import { checkTests } from './repository-actions.mjs';
import { refreshWorkflowFiles, draftModules } from './workflow-state.mjs';

export async function generateTestPlan(context) {
  const {options,store,request}=context,repositoryId=request.repositoryId,input=request.input;
  const receiptId=`plan-${identity(request).slice(0,40)}`;
  const prior=store.draftReceipt(repositoryId,receiptId,request);if(prior)return prior;
  const snapshot=await ensureDraft({...context,repositoryId});
  invariant(snapshot.settings.configured,'SETUP_REQUIRED','請先儲存基本設定。');
  const key=`${id(input.requirementId)}/${id(input.featureId)}`,prefix=`tests/${key}/`;
  const feature=await inDraftView(snapshot,async root=>{
    const feature=(await scan(root)).features.find(f=>f.key===key);
    invariant(feature,'FEATURE_NOT_FOUND','找不到需求。',404);
    invariant(!feature.authoringOnly,'TEST_RUNNER_NOT_CONFIGURED','此匯入規格尚未接線工作台測試執行器，請先建立對應的執行契約。',409);
    const review=await reviewState(root,input.requirementId,input.featureId);
    invariant(review.confirmed.gherkin&&review.confirmed.sd,'UPSTREAM_NOT_CONFIRMED','請先確認需求與系統設計。',409);
    invariant(!review.records.tests,'STAGE_READ_ONLY','測試計劃已確認，請先退回測試計劃。',409);
    return feature;
  });
  invariant(feature.testPlan.ready,'TEST_SKELETON_REQUIRED','請先產生測試計劃骨架。',409);
  const current=await inDraftView(snapshot,root=>reviewState(root,input.requirementId,input.featureId));
  invariant(input.expectedDigest===current.hashes.tests,'CONTENT_CHANGED','測試計劃已變更，請先重新讀取再交由 LLM 補齊。',409);
  invariant(options.enableExecution,'EXECUTION_DISABLED','主機尚未啟用測試計劃生成；系統設計已保存。',403);
  const agent=validateAgentSettings(snapshot.settings.agent),command=await agentExecutable(agent.command);
  const parent=await safePath(options.home,`test-plans/${request.operationId}`);await mkdir(parent,{recursive:true});
  const root=await mkdtemp(path.join(parent,'attempt-'));
  try {
    return await generateInView(context,snapshot,feature,root,prefix,receiptId,agent,command);
  } finally {
    for(const relative of ['node_modules','.generated','.runtime/dependencies/cache'])await rm(await safePath(root,relative),{recursive:true,force:true});
  }
}

async function generateInView(context,snapshot,feature,root,prefix,receiptId,agent,command) {
  const {options,store,request}=context,repositoryId=request.repositoryId,input=request.input;
  const scoped=file=>!file.path.startsWith('spec/')&&!file.path.startsWith('tests/')
    ||file.path.startsWith(`spec/${feature.key}/`)
    ||[`spec/${feature.requirementId}/requirement.yaml`,`spec/${feature.requirementId}/review.json`].includes(file.path)
    ||file.path.startsWith(prefix)||file.path.startsWith('tests/_shared/')||file.path.startsWith(`tests/${feature.requirementId}/_shared/`);
  for(const file of snapshot.files.filter(f=>f.target==='spec'&&scoped(f)))await atomicWrite(await safePath(root,file.path),file.content);
  const projects=[];
  for(const projectId of feature.projectIds) {
    const projectRoot=await safePath(root,`projects/${projectId}`);await mkdir(projectRoot,{recursive:true});projects.push(projectRoot);
    const listing=await draftProjectFiles({...context,repositoryId},projectId);
    invariant(listing.available||listing.files.length,'PROJECT_CONTEXT_REQUIRED',`產品 ${projectId} 尚未載入，請先取得產品內容。`,409);
    for(const relative of listing.files) {
      let content;
      try { content=(await readDraftFile({...context,repositoryId},relative,projectId,true)).content; }
      catch(error) {
        if(error.code!=='BINARY_FILE')throw error;
        const checkout=await safePath(context.root,`projects/${projectId}`,{missing:false});
        content=await readFile(await safePath(checkout,relative,{missing:false}));
      }
      await atomicWrite(await safePath(projectRoot,relative),content);
    }
  }
  await useRepositoryTools(root,options,request);
  for(const args of [['init','--quiet','--template='],['add','--all']]) {
    const result=await execute('git',args,{cwd:root,env:processEnvironment({HOME:process.env.HOME},{git:true})});
    invariant(result.exitCode===0&&!result.timedOut&&!result.overflow,'TEST_PLAN_WORKSPACE_FAILED',(result.stderr||result.stdout).slice(-4000));
  }
  const before=await sourceFiles(root),projectHashes=await contextHashes(root);
  const prompt=renderAgentPrompt(agent,{requirementId:input.requirementId,featureId:input.featureId,spec:root,projects:projects.join(', '),feedback:'',previousFailure:''},'testPlan');
  await atomicWrite(path.join(root,'.runtime/test-plan-prompt.txt'),prompt);
  const replacements={'{prompt}':prompt,'{spec}':root,'{project}':root};
  const args=agent.args.map(arg=>Object.hasOwn(replacements,arg)?replacements[arg]:arg);
  if(!agent.args.includes('{prompt}'))args.push(prompt);
  const result=await execute(command,args,{cwd:root,env:processEnvironment({HOME:process.env.HOME}),timeoutMs:agent.timeoutMs});
  await writeJson(path.join(root,'.runtime/test-plan-agent.json'),result);
  invariant(result.exitCode===0&&!result.signal&&!result.timedOut&&!result.overflow,'TEST_PLAN_AGENT_FAILED',`測試計劃生成失敗，原內容保留。\n${(result.stderr+result.stdout).slice(-12000)}`);
  const after=await sourceFiles(root),outside=files=>files.filter(f=>!f.path.startsWith(prefix)).map(f=>[f.path,digest(f.content)]).sort(([a],[b])=>a.localeCompare(b));
  invariant(identity(outside(before))===identity(outside(after))&&identity(projectHashes)===identity(await contextHashes(root)),'AGENT_CHANGED_INPUT','Agent 修改了測試計劃以外的內容；提案未保存。',409);
  const proposal=after.filter(file=>file.path.startsWith(prefix));
  invariant(before.filter(file=>file.path.startsWith(prefix)).every(file=>proposal.some(next=>next.path===file.path)),
    'AGENT_DELETED_TEST_SOURCE','Agent 刪除了既有測試來源；目前不接受刪除提案，原稿保留。',409);
  // Validate against the complete immutable SQL revision after the Agent exits.
  // Other features are never materialized in its working context.
  return inDraftView(snapshot,async validationRoot=>{
    for(const file of proposal)await atomicWrite(await safePath(validationRoot,file.path),file.content);
    await useRepositoryTools(validationRoot,options,request);
    const check=await checkTests(validationRoot,input,store,repositoryId,true);
    await refreshWorkflowFiles(validationRoot,{modules:draftModules(snapshot,store.projection(repositoryId)),runs:store.runs(repositoryId),reports:store.reports(repositoryId)});
    const changes=(await sourceFiles(validationRoot)).filter(file=>!snapshot.files.some(old=>old.target===file.target&&old.path===file.path&&old.sha256===digest(file.content)))
      .map(file=>({...file,baseHash:snapshot.files.find(old=>old.target===file.target&&old.path===file.path)?.baseHash??null}));
    return store.saveDraft(repositoryId,{expectedRevision:snapshot.revision,operationId:receiptId,request,files:changes,
      result:{nextStage:'TESTS',testPlan:{paths:feature.testPlan.paths,check},testOutcome:'NOT_RUN'}});
  });
}

async function contextHashes(root) {
  const directory=await safePath(root,'projects');if(!await exists(directory))return [];
  return Promise.all((await walk(directory)).sort().map(async relative=>[relative,digest(await readFile(await safePath(directory,relative)))]));
}
