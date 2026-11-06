/** SQLite is the owner of reusable agent and skill versions. */
import path from 'node:path';
import {promptCatalogMethods} from './prompt-catalog.mjs';
import {randomUUID} from 'node:crypto';
import {invariant,identity} from '../contracts/index.mjs';
import {validateAgentSettings,validateAgentRuntimeSettings,agentPromptFields,seedAgentSettings,agentLimits} from './agent-settings.mjs';

export const agentPurposes=Object.freeze(['gherkin','design','testPlan','development']);
export const agentOperations=Object.freeze({'workflow.gherkin.generate':'gherkin','workflow.design.generate':'design','workflow.tests.complete':'testPlan','workflow.develop':'development'});
const skillBytes=agentLimits.skillBytes;
const text=(value,label,max=2000)=>{invariant(typeof value==='string'&&value.trim()&&!value.includes('\0')&&Buffer.byteLength(value)<=max,'INVALID_CATALOG',`${label}不可為空且不能超過 ${max} bytes`);return value;};
function resources(input=[]){
 invariant(Array.isArray(input),'INVALID_SKILL_RESOURCE','技能資源必須是檔案陣列');const seen=new Set();
 return input.map(file=>{
  invariant(file&&typeof file.path==='string'&&file.path&&Buffer.byteLength(file.path)<=2000&&file.path!=='SKILL.md'&&!file.path.includes('\\')&&!file.path.includes('\0')&&!path.posix.isAbsolute(file.path)&&file.path.split('/').every(p=>p&&p!=='.'&&p!=='..')&&!seen.has(file.path),'INVALID_SKILL_RESOURCE','技能資源路徑無效或重複');seen.add(file.path);
  invariant(typeof file.content==='string'&&!file.content.includes('\0'),'INVALID_SKILL_RESOURCE','資源必須為 UTF-8 文字');return {path:file.path,content:file.content};
 });
}
export function installAgentCatalog(db){db.exec(`
 CREATE TABLE IF NOT EXISTS agent_profiles(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS agent_revisions(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL REFERENCES agent_profiles(id),version INTEGER NOT NULL,settings_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(agent_id,version));
 CREATE TABLE IF NOT EXISTS skills(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS skill_revisions(id TEXT PRIMARY KEY,skill_id TEXT NOT NULL REFERENCES skills(id),version INTEGER NOT NULL,content TEXT NOT NULL,purposes_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(skill_id,version));
 CREATE TABLE IF NOT EXISTS skill_resources(revision_id TEXT NOT NULL REFERENCES skill_revisions(id),path TEXT NOT NULL,content TEXT NOT NULL,PRIMARY KEY(revision_id,path));
 CREATE TABLE IF NOT EXISTS agent_skill_bindings(agent_revision_id TEXT NOT NULL REFERENCES agent_revisions(id),skill_revision_id TEXT NOT NULL REFERENCES skill_revisions(id),position INTEGER NOT NULL,PRIMARY KEY(agent_revision_id,skill_revision_id),UNIQUE(agent_revision_id,position));
 CREATE TABLE IF NOT EXISTS agent_task_defaults(repository_id TEXT NOT NULL REFERENCES spec_repositories(id),purpose TEXT NOT NULL,agent_revision_id TEXT NOT NULL REFERENCES agent_revisions(id),skills_json TEXT NOT NULL,PRIMARY KEY(repository_id,purpose));
 `);}
export function agentCatalogMethods(db,atomic){
 const prompts=promptCatalogMethods(db,atomic);
 const listSkills=()=>db.prepare('SELECT * FROM skills ORDER BY rowid').all().map(row=>({...row,archived:Boolean(row.archived),revisions:db.prepare('SELECT * FROM skill_revisions WHERE skill_id=? ORDER BY version DESC').all(row.id).map(r=>({...r,purposes:JSON.parse(r.purposes_json),resources:db.prepare('SELECT path,content FROM skill_resources WHERE revision_id=? ORDER BY path').all(r.id)}))}));
 const listAgents=()=>db.prepare('SELECT * FROM agent_profiles ORDER BY rowid').all().map(row=>({...row,archived:Boolean(row.archived),revisions:db.prepare('SELECT * FROM agent_revisions WHERE agent_id=? ORDER BY version DESC').all(row.id).map((r,index)=>({...r,settings:index===0?validateAgentRuntimeSettings(JSON.parse(r.settings_json)):JSON.parse(r.settings_json),skillRevisionIds:db.prepare('SELECT skill_revision_id FROM agent_skill_bindings WHERE agent_revision_id=? ORDER BY position').all(r.id).map(b=>b.skill_revision_id)}))}));
 const skillVersion=(revisionId,current=true)=>{
  const row=db.prepare('SELECT r.*,s.name,s.archived FROM skill_revisions r JOIN skills s ON s.id=r.skill_id WHERE r.id=?').get(revisionId);
  invariant(row,'SKILL_NOT_FOUND','找不到技能版本',404);
  if(current)invariant(!row.archived&&db.prepare('SELECT id FROM skill_revisions WHERE skill_id=? ORDER BY version DESC LIMIT 1').get(row.skill_id).id===revisionId,'CATALOG_CHANGED','技能已更新或封存，請重新選擇',409);
  return {id:row.skill_id,revisionId:row.id,name:row.name,version:row.version,content:row.content,purposes:JSON.parse(row.purposes_json),resources:db.prepare('SELECT path,content FROM skill_resources WHERE revision_id=? ORDER BY path').all(row.id)};
 };
 const skillIds=input=>{invariant(Array.isArray(input)&&input.every(x=>typeof x==='string')&&new Set(input).size===input.length,'INVALID_SKILL_SELECTION','技能選擇不可重複');return input;};
 const saveSkill=input=>atomic(()=>{
  invariant(input&&typeof input==='object'&&!Array.isArray(input)&&(input.archived===undefined||typeof input.archived==='boolean'),'INVALID_CATALOG','技能設定格式無效');
  const name=text(input.name,'技能名稱',160),description=input.description??'',content=text(input.content,'技能內容',skillBytes),files=resources(input.resources);
  invariant(typeof description==='string'&&description.length<=2000,'INVALID_CATALOG','說明過長');
  invariant(Buffer.byteLength(content)+files.reduce((n,f)=>n+Buffer.byteLength(f.path)+Buffer.byteLength(f.content),0)<=skillBytes,'INVALID_SKILL_RESOURCE','技能及資源總量超過 256 KiB');
  const purposes=input.purposes??agentPurposes;invariant(Array.isArray(purposes)&&purposes.length&&purposes.every(p=>agentPurposes.includes(p))&&new Set(purposes).size===purposes.length,'INVALID_SKILL_PURPOSE','技能任務種類無效');
  const id=input.id??randomUUID(),prior=db.prepare('SELECT * FROM skills WHERE id=?').get(id);
  if(input.id){invariant(prior,'SKILL_NOT_FOUND','找不到技能',404);const latest=db.prepare('SELECT id FROM skill_revisions WHERE skill_id=? ORDER BY version DESC LIMIT 1').get(id);invariant(latest.id===input.expectedRevision,'CATALOG_CHANGED','技能已被更新，請重新讀取',409);}
  if(prior)db.prepare('UPDATE skills SET name=?,description=?,archived=? WHERE id=?').run(name,description,Number(Boolean(input.archived)),id);else db.prepare('INSERT INTO skills(id,name,description,archived) VALUES(?,?,?,?)').run(id,name,description,Number(input.archived??false));
  const version=(db.prepare('SELECT MAX(version) n FROM skill_revisions WHERE skill_id=?').get(id).n??0)+1,revisionId=randomUUID();db.prepare('INSERT INTO skill_revisions VALUES(?,?,?,?,?,?)').run(revisionId,id,version,content,JSON.stringify(purposes),new Date().toISOString());
  for(const file of files)db.prepare('INSERT INTO skill_resources VALUES(?,?,?)').run(revisionId,file.path,file.content);
  return listSkills().find(s=>s.id===id);
 });
 const saveAgent=input=>atomic(()=>{
  invariant(input&&typeof input==='object'&&!Array.isArray(input)&&(input.archived===undefined||typeof input.archived==='boolean'),'INVALID_CATALOG','Agent 設定格式無效');
  const name=text(input.name,'Agent 名稱',160),description=input.description??'',settings=validateAgentRuntimeSettings(input.settings),bindings=skillIds(input.skillRevisionIds??[]);
  invariant(typeof description==='string'&&description.length<=2000,'INVALID_CATALOG','說明過長');
  invariant(!input.settings?.skills,'LEGACY_SKILL_FIELD','請在 Skills 清單管理技能內容');
  invariant(!Object.values(agentPromptFields).some(field=>Object.hasOwn(input.settings??{},field)),'AGENT_PROMPT_SEPARATE','Prompt 請在獨立的 Prompts 管理');
  for(const revisionId of bindings)skillVersion(revisionId);
  const id=input.id??randomUUID(),prior=db.prepare('SELECT * FROM agent_profiles WHERE id=?').get(id);
  if(input.id){invariant(prior,'AGENT_NOT_FOUND','找不到 Agent',404);const latest=db.prepare('SELECT id FROM agent_revisions WHERE agent_id=? ORDER BY version DESC LIMIT 1').get(id);invariant(latest.id===input.expectedRevision,'CATALOG_CHANGED','Agent 已被更新，請重新讀取',409);}
  if(prior)db.prepare('UPDATE agent_profiles SET name=?,description=?,archived=? WHERE id=?').run(name,description,Number(Boolean(input.archived)),id);else db.prepare('INSERT INTO agent_profiles(id,name,description,archived) VALUES(?,?,?,?)').run(id,name,description,Number(input.archived??false));
  const version=(db.prepare('SELECT MAX(version) n FROM agent_revisions WHERE agent_id=?').get(id).n??0)+1,revisionId=randomUUID();db.prepare('INSERT INTO agent_revisions VALUES(?,?,?,?,?)').run(revisionId,id,version,JSON.stringify(settings),new Date().toISOString());
  bindings.forEach((skillId,index)=>db.prepare('INSERT INTO agent_skill_bindings VALUES(?,?,?)').run(revisionId,skillId,index));return listAgents().find(a=>a.id===id);
 });
 const resolve=(repositoryId,purpose,selection)=>{
  invariant(agentPurposes.includes(purpose),'INVALID_AGENT_PURPOSE','未知 Agent 任務');
  if(selection===undefined){const row=db.prepare('SELECT * FROM agent_task_defaults WHERE repository_id=? AND purpose=?').get(repositoryId,purpose);invariant(row,'AGENT_DEFAULT_REQUIRED','請先設定任務的 Agent',409);selection={agentRevisionId:row.agent_revision_id,promptRevisionId:row.prompt_revision_id,skillRevisionIds:JSON.parse(row.skills_json)};}
  invariant(selection&&typeof selection.agentRevisionId==='string','INVALID_AGENT_SELECTION','請選擇 Agent');
  const row=db.prepare('SELECT r.*,a.name,a.archived FROM agent_revisions r JOIN agent_profiles a ON a.id=r.agent_id WHERE r.id=?').get(selection.agentRevisionId);
  invariant(row,'AGENT_NOT_FOUND','找不到 Agent 版本',404);invariant(!row.archived&&db.prepare('SELECT id FROM agent_revisions WHERE agent_id=? ORDER BY version DESC LIMIT 1').get(row.agent_id).id===row.id,'CATALOG_CHANGED','Agent 已更新或封存，請重新選擇',409);
  const ids=skillIds(selection.skillRevisionIds??db.prepare('SELECT skill_revision_id FROM agent_skill_bindings WHERE agent_revision_id=? ORDER BY position').all(row.id).map(b=>b.skill_revision_id));
  const skills=ids.map(id=>skillVersion(id));for(const skill of skills)invariant(skill.purposes.includes(purpose),'SKILL_PURPOSE_MISMATCH',`${skill.name} 不適用此任務`);
  const prompt=prompts.resolvePrompt(selection.promptRevisionId,purpose),settings=validateAgentRuntimeSettings(JSON.parse(row.settings_json));
  const result={agentId:row.agent_id,agentRevisionId:row.id,agentName:row.name,agentVersion:row.version,promptRevisionId:prompt.revisionId,prompt,skillRevisionIds:ids,skills,settings};return {...result,digest:identity(result)};
 };
 return {
  agentCatalog(){return {agents:listAgents(),prompts:prompts.listPrompts(),skills:listSkills(),template:validateAgentRuntimeSettings(),promptTemplates:Object.fromEntries(Object.entries(agentPromptFields).map(([purpose,field])=>[purpose,seedAgentSettings()[field]])),purposes:agentPurposes};},
  saveCatalogAgent:saveAgent,saveCatalogSkill:saveSkill,saveCatalogPrompt:prompts.saveCatalogPrompt,
  ensureAgentDefaults(repositoryId,legacy){return atomic(()=>{
   const savedDefaults=db.prepare('SELECT * FROM agent_task_defaults WHERE repository_id=?').all(repositoryId);
   const existing=new Set(savedDefaults.map(row=>row.purpose));
   const missing=agentPurposes.filter(purpose=>!existing.has(purpose));
   if(!missing.length)return;
   const repository=db.prepare('SELECT title FROM spec_repositories WHERE id=?').get(repositoryId);invariant(repository,'REPOSITORY_NOT_FOUND','找不到規格庫',404);
   const settings=validateAgentSettings(legacy),runtime=validateAgentRuntimeSettings(settings),bindings=[];
   const agentSeed={name:repository.title+' Agent',description:'由原有規格庫設定遷入',settings:runtime};
   // Reuse only complete, current seed revisions; never change a user-edited
   // profile or revive an archived/historical version while repairing defaults.
   const matchingAgents=listAgents().filter(item=>!item.archived&&item.name===agentSeed.name&&item.description===agentSeed.description&&identity(item.revisions[0].settings)===identity(runtime));
   const preferReferenced=(items,ids)=>items.find(item=>ids.has(item.revisions[0].id))??items[0];
   if(settings.skills){
    const skillSeed={name:'匯入的技能指引',description:'保留規格庫原始 Skills',content:settings.skills};
    const references=new Set([...savedDefaults.flatMap(row=>JSON.parse(row.skills_json)),...matchingAgents.flatMap(item=>item.revisions[0].skillRevisionIds)]);
    const matchingSkills=listSkills().filter(item=>!item.archived&&item.name===skillSeed.name&&item.description===skillSeed.description&&item.revisions[0].content===settings.skills&&!item.revisions[0].resources.length&&identity(item.revisions[0].purposes)===identity(agentPurposes));
    const skill=preferReferenced(matchingSkills,references)??saveSkill(skillSeed);bindings.push(skill.revisions[0].id);
   }
   const agent=preferReferenced(matchingAgents.filter(item=>identity(item.revisions[0].skillRevisionIds)===identity(bindings)),new Set(savedDefaults.map(row=>row.agent_revision_id)))??saveAgent({...agentSeed,skillRevisionIds:bindings});
   const catalogPrompts=prompts.listPrompts();
   for(const purpose of missing){
    const promptSeed={name:repository.title+' · '+purpose,content:settings[agentPromptFields[purpose]],purposes:[purpose]};
    const prompt=catalogPrompts.find(item=>!item.archived&&item.name===promptSeed.name&&item.description===''&&item.revisions[0].content===promptSeed.content&&identity(item.revisions[0].purposes)===identity(promptSeed.purposes))??prompts.saveCatalogPrompt(promptSeed);
    db.prepare('INSERT INTO agent_task_defaults(repository_id,purpose,agent_revision_id,skills_json,prompt_revision_id) VALUES(?,?,?,?,?)').run(repositoryId,purpose,agent.revisions[0].id,JSON.stringify(bindings),prompt.revisions[0].id);
   }
  });},
  agentDefaults(repositoryId){return db.prepare('SELECT purpose,agent_revision_id agentRevisionId,prompt_revision_id promptRevisionId,skills_json FROM agent_task_defaults WHERE repository_id=? ORDER BY purpose').all(repositoryId).map(row=>({purpose:row.purpose,agentRevisionId:row.agentRevisionId,promptRevisionId:row.promptRevisionId,skillRevisionIds:JSON.parse(row.skills_json)}));},
  saveAgentDefault(repositoryId,input){const resolved=resolve(repositoryId,input.purpose,input);db.prepare('INSERT INTO agent_task_defaults(repository_id,purpose,agent_revision_id,skills_json,prompt_revision_id) VALUES(?,?,?,?,?) ON CONFLICT(repository_id,purpose) DO UPDATE SET agent_revision_id=excluded.agent_revision_id,skills_json=excluded.skills_json,prompt_revision_id=excluded.prompt_revision_id').run(repositoryId,input.purpose,resolved.agentRevisionId,JSON.stringify(resolved.skillRevisionIds),resolved.promptRevisionId);return resolved;},
  resolveAgent:resolve,
 };
}
