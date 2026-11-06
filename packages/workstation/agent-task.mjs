/** Frozen, job-scoped context shared by Codex SDK and explicitly configured CLIs. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile, mkdir } from 'node:fs/promises';
import { id, identity, invariant } from '../contracts/index.mjs';
import { validateAgentSettings, renderAgentPrompt,renderPromptTemplate,validateAgentRuntimeSettings,agentLimits } from './agent-settings.mjs';
import {negotiateProtocolVersion} from './mcp-protocol.mjs';
import {requirementText} from './requirements.mjs';

export const gherkinOutputFile='gherkin.feature';
const gitBoundaryRule=' Do not run any Git commands, including read-only inspection, clone, fetch, add, commit or push. The workstation owns Git only at feature creation and completed human acceptance.';
export function gherkinInput(input){
  invariant(typeof input.editorKey==='string'&&/^(?:new-[A-Za-z0-9-]+|[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+)$/.test(input.editorKey)&&input.editorKey.length<=180,'INVALID_EDITOR','需求編輯識別無效。');
  return {editorKey:input.editorKey,description:requirementText(input.description,'需求描述',{empty:false}),previousGherkin:requirementText(input.previousGherkin??'','Gherkin')};
}

export function previewAgentPrompt(snapshot, repositoryId, root, input) {
  const {purpose,requirementId,featureId}=input;
  invariant(['development','testPlan','gherkin','design'].includes(purpose),'INVALID_AGENT','未知 Agent 任務。');
  const source=purpose==='gherkin'?gherkinInput(input):purpose==='design'?{previousDesign:requirementText(input.previousDesign??'','系統文件')}:undefined;
  const key=source?.editorKey??`${id(requirementId)}/${id(featureId)}`;
  if(purpose!=='gherkin')invariant(snapshot.files.some(f=>f.target==='spec'&&f.path===`spec/${key}/${featureId}.feature`),'FEATURE_NOT_FOUND','找不到需求。',404);
  const separate=input.agentSnapshot?.prompt;
  const agent=separate?validateAgentRuntimeSettings(input.agentSnapshot.settings):validateAgentSettings(input.agentSnapshot?.settings??snapshot.settings.agent);
  const values={requirementId:requirementId??'',featureId:featureId??'',spec:root,projects:'See workbench MCP task',feedback:'See workbench MCP task',previousFailure:'See workbench MCP task'};
  const skills=(input.agentSnapshot?.skills??[]).map(s=>`# Skill: ${s.name} (v${s.version})\n${s.content}${s.resources.length?'\n技能資源由 workbench_read_artifact 提供，相對基底：skills/'+s.id+'；檔案：'+s.resources.map(f=>f.path).join('、'):''}`).join('\n\n');
  const prompt=separate?renderPromptTemplate(separate.content,values)+(skills?'\n\n'+skills:''):renderAgentPrompt(agent,values,purpose);invariant(Buffer.byteLength(prompt)<=agentLimits.promptBytes,'AGENT_PROMPT_TOO_LARGE','所選內容超過 64 KiB 派工限制，請將長文放入 Skill 資源檔');
  return {prompt,promptDigest:identity({repositoryId,root,revision:snapshot.revision,agent,agentSelection:input.agentSnapshot?.digest??null,key,purpose,...(source?{source}:{})})};
}

export function approvedAgentPrompt(snapshot, context, purpose) {
  const input=context.request.input;
  const preview=previewAgentPrompt(snapshot,context.request.repositoryId,context.root,{...input,purpose});
  invariant(typeof input.prompt==='string'&&input.prompt.trim()&&Buffer.byteLength(input.prompt)<=agentLimits.promptBytes&&!input.prompt.includes('\0'),'PROMPT_REQUIRED','請先預覽 Prompt，再送出派工。',409);
  invariant(input.promptDigest===preview.promptDigest,'PROMPT_CHANGED','內容或設定已更新，請重新預覽 Prompt。',409);
  assertTaskTransport(selectedAgent(snapshot,context));
  return input.prompt;
}

export function selectedAgent(snapshot,context){const frozen=context.request.input.agentSnapshot;return frozen?.prompt?validateAgentRuntimeSettings(frozen.settings):validateAgentSettings(frozen?.settings??snapshot.settings.agent);}
export function selectedTaskSnapshot(snapshot,context){return {...snapshot,catalogSkills:context.request.input.agentSnapshot?.skills??[]};}
function skillArtifacts(snapshot){return Object.fromEntries((snapshot.catalogSkills??[]).flatMap(skill=>[[`skills/${skill.id}/SKILL.md`,skill.content],...skill.resources.map(file=>[`skills/${skill.id}/${file.path}`,file.content])]));}

export async function writeAgentTask(directory, snapshot, {purpose,requirementId,featureId,workspace,products,feedback,previousFailure='',source,projectIds=[]}) {
  if(purpose==='gherkin'){
    const output=path.join(workspace,gherkinOutputFile);
    const task={purpose,key:source.editorKey,workspace,writable:[output],output,rules:'Read the requirement description and previous Gherkin using workbench_read_artifact. Write one complete UTF-8 Gherkin feature to output. Use English Gherkin keywords, Traditional Chinese domain language, a short Feature description and minimal complete user flows. Give each Scenario a unique stable @case:<id> tag. Preserve existing case tags when revising existing scenarios. Do not modify any other files. Do not claim tests passed.'+gitBoundaryRule};
    const artifacts={'requirement-description.txt':source.description,'previous.feature':source.previousGherkin};
    await mkdir(directory,{recursive:true,mode:0o700});const file=path.join(directory,'task.json');await writeFile(file,JSON.stringify({task:{...task,skills:(snapshot.catalogSkills??[]).map(s=>({name:s.name,version:s.version,base:`skills/${s.id}`}))},artifacts:{...artifacts,...skillArtifacts(snapshot)}}),{mode:0o600});return file;
  }
  const key=`${id(requirementId)}/${id(featureId)}`,prefix=`tests/${key}/`;
  const artifacts=Object.fromEntries(snapshot.files.filter(f=>f.target==='spec'&&(
    f.path.startsWith(`spec/${key}/`)||f.path.startsWith(prefix)||f.path.startsWith('tests/_shared/')||f.path.startsWith(`tests/${requirementId}/_shared/`)
  )).map(f=>[f.path,f.content]));
  if(purpose==='design'){
    const output=path.join(workspace,`${featureId}.sd.md`);
    for(const artifact of Object.keys(artifacts))if(!artifact.startsWith(`spec/${key}/`))delete artifacts[artifact];
    artifacts[`spec/${key}/${featureId}.sd.md`]=source.previousDesign;
    for(const file of snapshot.files.filter(f=>projectIds.some(projectId=>f.target===`project:${projectId}`)))artifacts[`projects/${file.target.slice('project:'.length)}/${file.path}`]=file.content;
    const task={purpose,key,workspace,output,writable:[output],decisionContract:{schemaVersion:1,format:'Exactly one fenced workbench-decisions JSON block in the Markdown; its data is {schemaVersion:1,items:[{id,question,context,options:[{id,label,description}],answer:null}]}. Use stable IDs. Each unresolved architectural or implementation contract must be a concrete question with at least one meaningful proposed option and explanation. Do not include an other option: the workstation always adds it with a custom input. All new answers must be null; never choose for the user. Preserve prior questions and human answers. If no questions remain, include items:[]. Proposed options are not claims of implemented behavior.'},rules:'Use approved Gherkin and the previous design from workbench_read_artifact. Write the complete system design as Traditional Chinese Markdown to output. Explain responsibilities, data flow, implementation and verification for the approved scenarios. Cite actual available source paths; mark missing or unverified facts explicitly instead of inventing APIs, paths or results. Preserve unrelated design content. Do not change approved behavior, other files, approvals or tests. This is a draft for human review.'+gitBoundaryRule};
    await mkdir(directory,{recursive:true,mode:0o700});const file=path.join(directory,'task.json');await writeFile(file,JSON.stringify({task:{...task,skills:(snapshot.catalogSkills??[]).map(s=>({name:s.name,version:s.version,base:`skills/${s.id}`}))},artifacts:{...artifacts,...skillArtifacts(snapshot)}}),{mode:0o600});return file;
  }
  const task={purpose,key,workspace,products,writable:purpose==='testPlan'?[path.join(workspace,prefix)]:products,
    rules:purpose==='testPlan'
      ?'Gherkin and design are approved. Complete tests with real assertions and AfterStep screenshots. Approved artifacts and products are read-only. No skipped or placeholder steps.'+gitBoundaryRule
      :'Implement approved behavior. Gherkin, design, tests and reviews are read-only. Preserve unrelated work; do not push or weaken tests.'+gitBoundaryRule,
    verification:{owner:'workstation',requirementId,featureId,entry:'.workbench-tools/spec-toolkit/cli.mjs',scope:'all selected feature cases/profiles'},
    feedback,previousFailure};
  await mkdir(directory,{recursive:true,mode:0o700});
  const file=path.join(directory,'task.json');
  await writeFile(file,JSON.stringify({task:{...task,skills:(snapshot.catalogSkills??[]).map(s=>({name:s.name,version:s.version,base:`skills/${s.id}`}))},artifacts:{...artifacts,...skillArtifacts(snapshot)}}),{mode:0o600});
  return file;
}

export function agentArguments(agent, {prompt,spec,project,task}) {
  agent=validateAgentRuntimeSettings(agent);
  invariant(agent.runtime==='custom-cli','AGENT_RUNTIME_MISMATCH','Codex SDK 使用結構化任務，不使用 CLI 參數。');
  assertTaskTransport(agent);
  const script=fileURLToPath(new URL('../../scripts/mcp-agent-task.mjs',import.meta.url));
  const replacements={'{prompt}':prompt,'{spec}':spec,'{project}':project,'{task}':task};
  const config=`mcp_servers.workbench_task={command=${JSON.stringify(process.execPath)},args=${JSON.stringify([script,task])},required=true,enabled=true}`;
  const args=agent.args.flatMap(arg=>arg==='{mcp}'?['-c',config]:[Object.hasOwn(replacements,arg)?replacements[arg]:arg]);
  if (/^codex(?:\.exe)?$/.test(path.basename(agent.command)) && args.includes('exec') && !args.includes('--skip-git-repo-check'))
    args.splice(args.indexOf('exec') + 1, 0, '--skip-git-repo-check');
  if(!agent.args.includes('{prompt}'))args.push(prompt);
  return args;
}

function assertTaskTransport(agent) {
  if(agent.runtime==='codex-sdk')return;
  invariant(agent.args.includes('{mcp}')||agent.args.includes('{task}'),'AGENT_MCP_REQUIRED','請在 CLI 參數加入 {mcp}（Codex），或使用 {task} 接上自訂 CLI 的任務 MCP adapter。',409);
}

export function taskRpc(bundle, request) {
  const reply=(result,error)=>({jsonrpc:'2.0',id:request?.id??null,...(error?{error}:{result})});
  if(!request||request.jsonrpc!=='2.0'||typeof request.method!=='string'||(request.id!==undefined&&typeof request.id!=='string'&&typeof request.id!=='number'))return reply(null,{code:-32600,message:'Invalid Request'});
  if(request.id===undefined)return null;
  if(request.method==='initialize') {
    if(typeof request.params?.protocolVersion!=='string'||!request.params.protocolVersion.trim())return reply(null,{code:-32602,message:'Protocol version is required'});
    return reply({protocolVersion:negotiateProtocolVersion(request.params.protocolVersion),capabilities:{tools:{}},serverInfo:{name:'workbench-task',version:'1.0.0'}});
  }
  if(request.method==='ping')return reply({});
  const tools=[
    {name:'workbench_get_task',description:'Read this dispatched task, write boundaries, verification, feedback and artifact names.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
    {name:'workbench_read_artifact',description:'Read one frozen artifact belonging to this task.',inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}}
  ].map(tool=>({...tool,annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true}}));
  if(request.method==='tools/list')return reply({tools});
  if(request.method!=='tools/call')return reply(null,{code:-32601,message:'Method not found'});
  const name=request.params?.name,args=request.params?.arguments??{};
  if(!args||typeof args!=='object'||Array.isArray(args))return reply(null,{code:-32602,message:'Invalid arguments'});
  let value;
  if(name==='workbench_get_task'&&Object.keys(args).length===0)value={...bundle.task,artifacts:Object.keys(bundle.artifacts)};
  else if(name==='workbench_read_artifact'&&Object.keys(args).length===1&&typeof args.path==='string'&&Object.hasOwn(bundle.artifacts,args.path))value={path:args.path,content:bundle.artifacts[args.path]};
  else return reply(null,{code:-32602,message:'Unknown tool or task artifact'});
  return reply({structuredContent:value,content:[{type:'text',text:JSON.stringify(value)}]});
}
