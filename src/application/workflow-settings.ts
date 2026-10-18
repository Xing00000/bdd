import type {Store} from '../ports/store.ts';
import {workflowAgentStages,isWorkflowAgentStage,type WorkflowAgentStage} from '../domain/workflow-agent-stages.ts';

function invalid(message:string):never{throw Object.assign(new Error(message),{statusCode:422,code:'WORKFLOW_SETTING_INVALID'});}
function missing(message:string):never{throw Object.assign(new Error(message),{statusCode:404,code:'LLM_SETTING_NOT_FOUND'});}
function unassigned():never{throw Object.assign(new Error('此 Agent 尚未指派到目前流程階段。'),{statusCode:409,code:'WORKFLOW_AGENT_NOT_ASSIGNED'});}

export function createWorkflowSettingsService(store:Store,llmSettings:{agents:()=>Promise<any[]>;getAgent:(id:string)=>Promise<any>}){
 async function list(){
  const [agents,rows]=await Promise.all([
   llmSettings.agents(),
   store.all('SELECT stage,agent_id agentId FROM workflow_agent_assignments ORDER BY stage,position'),
  ]);
  return {agents,stages:workflowAgentStages.map(stage=>({
   ...stage,
   agentIds:rows.filter(row=>row.stage===stage.key).map(row=>String(row.agentId)),
  }))};
 }

 async function save(input:unknown){
  if(!input||typeof input!=='object'||Array.isArray(input))invalid('assignments 必須是各階段 Agent ID 陣列。');
  const assignments=(input as Record<string,unknown>).assignments;
  if(!assignments||typeof assignments!=='object'||Array.isArray(assignments))invalid('assignments 必須是各階段 Agent ID 陣列。');
  const values=assignments as Record<string,unknown>;
  if(Object.keys(values).some(key=>!isWorkflowAgentStage(key))||workflowAgentStages.some(stage=>!Object.hasOwn(values,stage.key)))
   invalid('必須明確提供所有可編輯流程階段的 Agent 清單。');
  const normalized=new Map<WorkflowAgentStage,string[]>();
  const ids=new Set<string>();
  for(const stage of workflowAgentStages){
   const value=values[stage.key];
   if(!Array.isArray(value)||value.some(id=>typeof id!=='string'||!id.trim()))invalid(`${stage.label}的 Agent 清單格式錯誤。`);
   const list=value as string[];
   if(new Set(list).size!==list.length)invalid(`${stage.label}不可重複指派同一個 Agent。`);
   for(const id of list)ids.add(id);
   normalized.set(stage.key,[...list]);
  }
  if(ids.size){
   const found=await store.all(`SELECT id FROM llm_agents WHERE id IN (${[...ids].map(()=>'?').join(',')})`,[...ids]);
   if(found.length!==ids.size)missing('其中一個選取的 Agent 已不存在。');
  }
  const commands:any[]=[{sql:'DELETE FROM workflow_agent_assignments'}];
  for(const [stage,agentIds] of normalized)agentIds.forEach((agentId,position)=>commands.push({
   sql:'INSERT INTO workflow_agent_assignments(stage,agent_id,position) VALUES(?,?,?)',params:[stage,agentId,position],
  }));
  await store.batch(commands);
  return list();
 }

 async function assignedAgent(stage:WorkflowAgentStage,agentId:unknown){
  if(!isWorkflowAgentStage(stage)||typeof agentId!=='string'||!agentId.trim())invalid('必須選擇已設定此流程階段的 Agent。');
  if(!(await store.all('SELECT agent_id FROM workflow_agent_assignments WHERE stage=? AND agent_id=?',[stage,agentId])).length)unassigned();
  return llmSettings.getAgent(agentId);
 }

 return {list,save,assignedAgent};
}
