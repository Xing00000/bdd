/** CLI-authored drafts are proposals, never an automatic requirement approval. */
import path from 'node:path';
import {createRequire} from 'node:module';
import {mkdir,readFile,lstat} from 'node:fs/promises';
import {invariant,identity,safePath} from '../contracts/index.mjs';
import {execute,processEnvironment} from '../git-core/index.mjs';
import {ensureDraft,inDraftView} from './authoring.mjs';
import {reviewState} from '../spec-toolkit/index.mjs';
import {requirementText,requirementDiagnostics,MAX_REQUIREMENT_BYTES} from './requirements.mjs';
import {validateAgentSettings} from './agent-settings.mjs';
import {agentExecutable} from './development.mjs';
import {gherkinInput,gherkinOutputFile,approvedAgentPrompt,writeAgentTask,agentArguments} from './agent-task.mjs';
import {runInteractiveAgent} from './agent-cli.mjs';

export async function generateGherkin(context){
  const {options,store,request}=context,source=gherkinInput(request.input);
  invariant(options.enableExecution,'EXECUTION_DISABLED','此主機已停用 CLI 執行。',403);
  const snapshot=await ensureDraft({...context,repositoryId:request.repositoryId});
  invariant(snapshot.settings.configured,'SETUP_REQUIRED','請先儲存規格庫設定。');
  if(!source.editorKey.startsWith('new-')){
    const [requirementId,featureId]=source.editorKey.split('/');
    await inDraftView(snapshot,async root=>invariant(!(await reviewState(root,requirementId,featureId)).records.gherkin,'STAGE_READ_ONLY','需求已確認，請先退回需求階段。',409));
  }
  const prompt=approvedAgentPrompt(snapshot,context,'gherkin'),agent=validateAgentSettings(snapshot.settings.agent),command=await agentExecutable(agent.command);
  const directory=await safePath(options.home,`gherkin-generations/${request.operationId}`),workspace=path.join(directory,'workspace');
  await mkdir(workspace,{recursive:true,mode:0o700});
  const initialized=await execute('git',['init','--quiet','--template='],{cwd:workspace,env:processEnvironment({HOME:process.env.HOME},{git:true})});
  invariant(initialized.exitCode===0&&!initialized.timedOut&&!initialized.overflow,'GHERKIN_WORKSPACE_FAILED','無法建立 Gherkin 生成工作區。');
  const task=await writeAgentTask(directory,snapshot,{purpose:'gherkin',workspace,source});
  const result=await runInteractiveAgent(context,command,agentArguments(agent,{prompt,spec:context.root,project:workspace,task}),workspace,agent.timeoutMs);
  invariant(result.exitCode===0&&!result.signal&&!result.timedOut,'GHERKIN_AGENT_FAILED',`CLI 生成 Gherkin 失敗，原稿已保留。\n${result.output.slice(-12000)}`);
  const output=await safePath(workspace,gherkinOutputFile,{missing:false}),stat=await lstat(output);
  invariant(stat.isFile()&&stat.size<=MAX_REQUIREMENT_BYTES,'INVALID_GHERKIN_OUTPUT','Gherkin 產出必須是大小限制內的 UTF-8 檔案。');
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(await readFile(output));}catch(error){invariant(false,'INVALID_GHERKIN_OUTPUT',`無法讀取 UTF-8 Gherkin：${error.message}`);}
  const gherkin=requirementText(text,'Gherkin',{empty:false}),diagnostics=requirementDiagnostics(gherkin);
  invariant(!diagnostics.length,'GHERKIN_INVALID',diagnostics.map(d=>`第 ${d.line} 行：${d.message}`).join('\n'));
  const require=createRequire(path.join(options.toolkitRoot,'package.json'));
  const {Parser,AstBuilder,GherkinClassicTokenMatcher}=require('@cucumber/gherkin'),{IdGenerator}=require('@cucumber/messages');
  try{new Parser(new AstBuilder(IdGenerator.incrementing()),new GherkinClassicTokenMatcher()).parse(gherkin);}
  catch(error){invariant(false,'GHERKIN_INVALID',error.message);}
  invariant(store.draft(request.repositoryId).revision===snapshot.revision,'CONTENT_CHANGED','生成期間來源已更新；提案保留於作業工作區，未覆蓋目前草稿。',409);
  const receipt=store.saveRequirementProposal(request.repositoryId,{...source,gherkin});
  return {gherkin,...receipt,sourceDigest:identity(source)};
}
