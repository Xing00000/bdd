import {selectedAgent,selectedTaskSnapshot} from './agent-task.mjs';
/** Agent-authored drafts are proposals, never an automatic requirement approval. */
import path from 'node:path';
import {createRequire} from 'node:module';
import {mkdir,readFile,lstat} from 'node:fs/promises';
import {invariant,identity,safePath} from '../contracts/index.mjs';
import {ensureDraft,inDraftView} from './authoring.mjs';
import {reviewState,assertFeatureActive} from '../spec-toolkit/index.mjs';
import {requirementText,requirementDiagnostics,MAX_REQUIREMENT_BYTES} from './requirements.mjs';
import {gherkinInput,gherkinOutputFile,approvedAgentPrompt,writeAgentTask} from './agent-task.mjs';
import {runAgentTask} from './agent-cli.mjs';

export async function generateGherkin(context){
  const {options,store,request}=context,source=gherkinInput(request.input);
  invariant(options.enableExecution,'EXECUTION_DISABLED','此主機已停用 Agent 執行。',403);
  const snapshot=await ensureDraft({...context,repositoryId:request.repositoryId});
  invariant(snapshot.settings.configured,'SETUP_REQUIRED','請先儲存規格庫設定。');
  if(!source.editorKey.startsWith('new-')){
    const [requirementId,featureId]=source.editorKey.split('/');
    await inDraftView(snapshot,async root=>{await assertFeatureActive(root,requirementId,featureId);invariant(!(await reviewState(root,requirementId,featureId)).records.gherkin,'STAGE_READ_ONLY','需求已確認，請先退回需求階段。',409);});
  }
  const prompt=approvedAgentPrompt(snapshot,context,'gherkin'),agent=selectedAgent(snapshot,context);
  const directory=await safePath(options.home,`gherkin-generations/${request.operationId}`),workspace=path.join(directory,'workspace');
  await mkdir(workspace,{recursive:true,mode:0o700});
  const task=await writeAgentTask(directory,selectedTaskSnapshot(snapshot,context),{purpose:'gherkin',workspace,source});
  const result=await runAgentTask(context,{agent,prompt,cwd:workspace,task});
  invariant(result.exitCode===0&&!result.signal&&!result.timedOut,'GHERKIN_AGENT_FAILED',`Agent 生成 Gherkin 失敗，原稿已保留。\n${result.output.slice(-12000)}`);
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
