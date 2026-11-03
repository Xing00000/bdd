import {mergeGeneratedDecisions} from '../spec-toolkit/design-decisions.mjs';
import {selectedAgent,selectedTaskSnapshot} from './agent-task.mjs';
/** Generate an isolated design draft; saving and approval remain explicit user actions. */
import path from 'node:path';
import {mkdir,readFile,lstat} from 'node:fs/promises';
import {id,invariant,safePath} from '../contracts/index.mjs';
import {execute,processEnvironment} from '../git-core/index.mjs';
import {ensureDraft,inDraftView} from './authoring.mjs';
import {reviewState,scan} from '../spec-toolkit/index.mjs';
import {requirementText,MAX_REQUIREMENT_BYTES} from './requirements.mjs';
import {validateAgentSettings} from './agent-settings.mjs';
import {agentExecutable} from './development.mjs';
import {approvedAgentPrompt,writeAgentTask,agentArguments} from './agent-task.mjs';
import {runInteractiveAgent} from './agent-cli.mjs';

export async function generateDesign(context){
  const {options,store,request}=context,input=request.input;
  const requirementId=id(input.requirementId),featureId=id(input.featureId),key=`${requirementId}/${featureId}`;
  invariant(options.enableExecution,'EXECUTION_DISABLED','此主機已停用 CLI 執行。',403);
  const snapshot=await ensureDraft({...context,repositoryId:request.repositoryId});
  invariant(snapshot.settings.configured,'SETUP_REQUIRED','請先儲存規格庫設定。');
  const feature=await inDraftView(snapshot,async root=>{
    const feature=(await scan(root)).features.find(f=>f.key===key);
    invariant(feature,'FEATURE_NOT_FOUND','找不到需求。',404);
    const review=await reviewState(root,requirementId,featureId);
    invariant(review.confirmed.gherkin,'UPSTREAM_NOT_CONFIRMED','請先確認需求。',409);
    invariant(!review.records.sd,'STAGE_READ_ONLY','系統設計已確認，請先退回設計階段。',409);
    return feature;
  });
  const prompt=approvedAgentPrompt(snapshot,context,'design'),agent=selectedAgent(snapshot,context),command=await agentExecutable(agent.command);
  const directory=await safePath(options.home,`design-generations/${request.operationId}`),workspace=path.join(directory,'workspace');
  await mkdir(workspace,{recursive:true,mode:0o700});
  const initialized=await execute('git',['init','--quiet','--template='],{cwd:workspace,env:processEnvironment({HOME:process.env.HOME},{git:true})});
  invariant(initialized.exitCode===0&&!initialized.timedOut&&!initialized.overflow,'DESIGN_WORKSPACE_FAILED','無法建立系統文件生成工作區。');
  const source={previousDesign:requirementText(input.previousDesign??'','系統文件')};
  const task=await writeAgentTask(directory,selectedTaskSnapshot(snapshot,context),{purpose:'design',requirementId,featureId,workspace,source,projectIds:feature.projectIds});
  const result=await runInteractiveAgent(context,command,agentArguments(agent,{prompt,spec:context.root,project:workspace,task}),workspace,agent.timeoutMs);
  invariant(result.exitCode===0&&!result.signal&&!result.timedOut,'DESIGN_AGENT_FAILED',`CLI 生成系統文件失敗，原稿已保留。\n${result.output.slice(-12000)}`);
  const output=await safePath(workspace,`${featureId}.sd.md`,{missing:false}),stat=await lstat(output);
  invariant(stat.isFile()&&stat.size<=MAX_REQUIREMENT_BYTES,'INVALID_DESIGN_OUTPUT','系統文件必須是大小限制內的 UTF-8 檔案。');
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(await readFile(output));}catch(error){invariant(false,'INVALID_DESIGN_OUTPUT',`無法讀取 UTF-8 系統文件：${error.message}`);}
  invariant(/^#\s+\S/m.test(text),'INVALID_DESIGN_OUTPUT','系統文件必須包含 Markdown 文件標題。');
  const content=requirementText(mergeGeneratedDecisions(source.previousDesign,requirementText(text,'系統文件',{empty:false})),'系統文件',{empty:false});
  invariant(/^#\s+\S/m.test(content),'INVALID_DESIGN_OUTPUT','系統文件必須包含 Markdown 文件標題。');
  invariant(store.draft(request.repositoryId).revision===snapshot.revision,'CONTENT_CHANGED','生成期間來源已更新；產出保留於作業工作區，未覆蓋目前文件。',409);
  return {path:`spec/${key}/${featureId}.sd.md`,content};
}
