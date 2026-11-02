/** Frozen, job-scoped context. CLI processes receive tools rather than an expanded brief. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile, mkdir } from 'node:fs/promises';
import { id, identity, invariant } from '../contracts/index.mjs';
import { validateAgentSettings, renderAgentPrompt } from './agent-settings.mjs';
import {negotiateProtocolVersion} from './mcp-protocol.mjs';

export function previewAgentPrompt(snapshot, repositoryId, root, input) {
  const {purpose,requirementId,featureId}=input;
  invariant(['development','testPlan'].includes(purpose),'INVALID_AGENT','未知 Agent 任務。');
  const key=`${id(requirementId)}/${id(featureId)}`;
  invariant(snapshot.files.some(f=>f.target==='spec'&&f.path===`spec/${key}/${featureId}.feature`),'FEATURE_NOT_FOUND','找不到需求。',404);
  const agent=validateAgentSettings(snapshot.settings.agent);
  const values={requirementId,featureId,spec:root,projects:'See workbench MCP task',feedback:'See workbench MCP task',previousFailure:'See workbench MCP task'};
  return {prompt:renderAgentPrompt(agent,values,purpose),promptDigest:identity({repositoryId,root,revision:snapshot.revision,agent,key,purpose})};
}

export function approvedAgentPrompt(snapshot, context, purpose) {
  const input=context.request.input;
  const preview=previewAgentPrompt(snapshot,context.request.repositoryId,context.root,{...input,purpose});
  invariant(typeof input.prompt==='string'&&input.prompt.trim()&&Buffer.byteLength(input.prompt)<=64*1024&&!input.prompt.includes('\0'),'PROMPT_REQUIRED','請先預覽 Prompt，再送出派工。',409);
  invariant(input.promptDigest===preview.promptDigest,'PROMPT_CHANGED','內容或設定已更新，請重新預覽 Prompt。',409);
  assertTaskTransport(validateAgentSettings(snapshot.settings.agent));
  return input.prompt;
}

export async function writeAgentTask(directory, snapshot, {purpose,requirementId,featureId,workspace,products,feedback,previousFailure=''}) {
  const key=`${id(requirementId)}/${id(featureId)}`,prefix=`tests/${key}/`;
  const artifacts=Object.fromEntries(snapshot.files.filter(f=>f.target==='spec'&&(
    f.path.startsWith(`spec/${key}/`)||f.path.startsWith(prefix)||f.path.startsWith('tests/_shared/')||f.path.startsWith(`tests/${requirementId}/_shared/`)
  )).map(f=>[f.path,f.content]));
  const task={purpose,key,workspace,products,writable:purpose==='testPlan'?[path.join(workspace,prefix)]:products,
    rules:purpose==='testPlan'
      ?'Gherkin and design are approved. Complete tests with real assertions and AfterStep screenshots. Approved artifacts and products are read-only. No skipped or placeholder steps.'
      :'Implement approved behavior. Gherkin, design, tests and reviews are read-only. Preserve unrelated work; do not push or weaken tests.',
    verification:{owner:'workstation',requirementId,featureId,entry:'.workbench-tools/spec-toolkit/cli.mjs',scope:'all selected feature cases/profiles'},
    feedback,previousFailure};
  await mkdir(directory,{recursive:true,mode:0o700});
  const file=path.join(directory,'task.json');
  await writeFile(file,JSON.stringify({task,artifacts}),{mode:0o600});
  return file;
}

export function agentArguments(agent, {prompt,spec,project,task}) {
  assertTaskTransport(agent);
  const script=fileURLToPath(new URL('../../scripts/mcp-agent-task.mjs',import.meta.url));
  const replacements={'{prompt}':prompt,'{spec}':spec,'{project}':project,'{task}':task};
  const config=`mcp_servers.workbench_task={command=${JSON.stringify(process.execPath)},args=${JSON.stringify([script,task])},required=true,enabled=true}`;
  const args=agent.args.flatMap(arg=>arg==='{mcp}'?['-c',config]:[Object.hasOwn(replacements,arg)?replacements[arg]:arg]);
  if(!agent.args.includes('{prompt}'))args.push(prompt);
  return args;
}

function assertTaskTransport(agent) {
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
