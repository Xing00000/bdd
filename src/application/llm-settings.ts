import {randomUUID} from 'node:crypto';
import type {Store} from '../ports/store.ts';

type LlmCliCommand={id:string;name:string;executable:string;args:string[]};
type LlmSkill={id:string;name:string;instructions:string};
type LlmAgent={id:string;name:string;cliCommandId:string;skillId:string|null;prompt:string;cliCommand:LlmCliCommand;skill:LlmSkill|null};

function invalid(message:string):never{throw Object.assign(new Error(message),{statusCode:422,code:'LLM_SETTING_INVALID'});}
function missing(message:string):never{throw Object.assign(new Error(message),{statusCode:404,code:'LLM_SETTING_NOT_FOUND'});}
function conflict(message:string):never{throw Object.assign(new Error(message),{statusCode:409,code:'LLM_SETTING_IN_USE'});}
function text(value:unknown,label:string,trim=true):string{
 if(typeof value!=='string'||!value.trim()||value.includes('\0'))invalid(`${label} 必須是非空文字。`);
 return trim?value.trim():value;
}
function commandArguments(value:unknown):string[]{
 if(!Array.isArray(value)||value.some(item=>typeof item!=='string'||item.includes('\0')))invalid('CLI 參數必須是字串陣列，且不能包含 NUL。');
 return value as string[];
}

export function createLlmSettingsService(store:Store){
 async function commands():Promise<LlmCliCommand[]>{
  return (await store.all('SELECT id,name,executable,args_json argsJson FROM llm_cli_commands ORDER BY name')).map(row=>({id:String(row.id),name:String(row.name),executable:String(row.executable),args:JSON.parse(String(row.argsJson))}));
 }
 async function skills():Promise<LlmSkill[]>{
  return (await store.all('SELECT id,name,instructions FROM llm_skills ORDER BY name')).map(row=>({id:String(row.id),name:String(row.name),instructions:String(row.instructions)}));
 }
 async function agents():Promise<LlmAgent[]>{
  return (await store.all(`SELECT a.id,a.name,a.cli_command_id cliCommandId,a.skill_id skillId,a.prompt,
   c.name cliName,c.executable,c.args_json argsJson,s.name skillName,s.instructions skillInstructions
   FROM llm_agents a JOIN llm_cli_commands c ON c.id=a.cli_command_id
   LEFT JOIN llm_skills s ON s.id=a.skill_id ORDER BY a.name`)).map(row=>({
    id:String(row.id),name:String(row.name),cliCommandId:String(row.cliCommandId),skillId:row.skillId===null?null:String(row.skillId),prompt:String(row.prompt),
    cliCommand:{id:String(row.cliCommandId),name:String(row.cliName),executable:String(row.executable),args:JSON.parse(String(row.argsJson))},
    skill:row.skillId===null?null:{id:String(row.skillId),name:String(row.skillName),instructions:String(row.skillInstructions)},
   }));
 }
 async function getAgent(id:string):Promise<LlmAgent>{
  if(typeof id!=='string'||!id)missing('請選擇有效的 Agent 設定。');
  const item=(await agents()).find(agent=>agent.id===id);if(!item)missing('找不到選擇的 Agent 設定。');return item;
 }
 async function list(){return {cliCommands:await commands(),skills:await skills(),agents:await agents()};}
 async function saveCommand(input:any,id?:string):Promise<LlmCliCommand>{
  const name=text(input?.name,'CLI 名稱'),executable=text(input?.executable,'CLI 執行檔'),args=commandArguments(input?.args);
  const duplicate=(await store.all('SELECT id FROM llm_cli_commands WHERE name=?',[name])).some(row=>row.id!==id);
  if(duplicate)conflict('CLI 名稱已存在。');
  if(id){const result=await store.run('UPDATE llm_cli_commands SET name=?,executable=?,args_json=? WHERE id=?',[name,executable,JSON.stringify(args),id]);if(Number(result.changes)!==1)missing('找不到要更新的 CLI 設定。');return {id,name,executable,args};}
  const created={id:randomUUID(),name,executable,args};
  await store.run('INSERT INTO llm_cli_commands(id,name,executable,args_json) VALUES(?,?,?,?)',[created.id,name,executable,JSON.stringify(args)]);return created;
 }
 async function deleteCommand(id:string):Promise<void>{
  if((await store.all('SELECT id FROM llm_agents WHERE cli_command_id=?',[id])).length)conflict('此 CLI 指令仍被 Agent 使用，請先修改或刪除相關 Agent。');
  const result=await store.run('DELETE FROM llm_cli_commands WHERE id=?',[id]);if(Number(result.changes)!==1)missing('找不到要刪除的 CLI 設定。');
 }
 async function saveSkill(input:any,id?:string):Promise<LlmSkill>{
  const name=text(input?.name,'Skill 名稱'),instructions=text(input?.instructions,'Skill 指示',false);
  const duplicate=(await store.all('SELECT id FROM llm_skills WHERE name=?',[name])).some(row=>row.id!==id);
  if(duplicate)conflict('Skill 名稱已存在。');
  if(id){const result=await store.run('UPDATE llm_skills SET name=?,instructions=? WHERE id=?',[name,instructions,id]);if(Number(result.changes)!==1)missing('找不到要更新的 Skill。');return {id,name,instructions};}
  const created={id:randomUUID(),name,instructions};await store.run('INSERT INTO llm_skills(id,name,instructions) VALUES(?,?,?)',[created.id,name,instructions]);return created;
 }
 async function deleteSkill(id:string):Promise<void>{
  if((await store.all('SELECT id FROM llm_agents WHERE skill_id=?',[id])).length)conflict('此 Skill 仍被 Agent 使用，請先修改或刪除相關 Agent。');
  const result=await store.run('DELETE FROM llm_skills WHERE id=?',[id]);if(Number(result.changes)!==1)missing('找不到要刪除的 Skill。');
 }
 async function saveAgent(input:any,id?:string):Promise<Omit<LlmAgent,'cliCommand'|'skill'>>{
  const name=text(input?.name,'Agent 名稱'),cliCommandId=text(input?.cliCommandId,'CLI 啟動指令'),skillId=input?.skillId===null||input?.skillId===''?null:text(input?.skillId,'Skill'),prompt=text(input?.prompt,'Agent Prompt',false);
  const duplicate=(await store.all('SELECT id FROM llm_agents WHERE name=?',[name])).some(row=>row.id!==id);
  if(duplicate)conflict('Agent 名稱已存在。');
  if(!(await store.all('SELECT id FROM llm_cli_commands WHERE id=?',[cliCommandId])).length)missing('找不到選擇的 CLI 啟動指令。');
  if(skillId&&!(await store.all('SELECT id FROM llm_skills WHERE id=?',[skillId])).length)missing('找不到選擇的 Skill。');
  if(id){const result=await store.run('UPDATE llm_agents SET name=?,cli_command_id=?,skill_id=?,prompt=? WHERE id=?',[name,cliCommandId,skillId,prompt,id]);if(Number(result.changes)!==1)missing('找不到要更新的 Agent。');return {id,name,cliCommandId,skillId,prompt};}
  const created={id:randomUUID(),name,cliCommandId,skillId,prompt};
  await store.run('INSERT INTO llm_agents(id,name,cli_command_id,skill_id,prompt) VALUES(?,?,?,?,?)',[created.id,name,cliCommandId,skillId,prompt]);return created;
 }
 async function deleteAgent(id:string):Promise<void>{const result=await store.run('DELETE FROM llm_agents WHERE id=?',[id]);if(Number(result.changes)!==1)missing('找不到要刪除的 Agent。');}
 return {list,commands,skills,agents,getAgent,saveCommand,deleteCommand,saveSkill,deleteSkill,saveAgent,deleteAgent};
}
