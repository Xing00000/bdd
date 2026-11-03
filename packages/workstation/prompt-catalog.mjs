/** Independent task templates; historical combined Agent rows remain immutable. */
import {randomUUID} from 'node:crypto';
import {invariant} from '../contracts/index.mjs';
import {agentPromptFields,validatePromptTemplate,validateAgentRuntimeSettings} from './agent-settings.mjs';
const purposes=Object.keys(agentPromptFields);
export function installPromptCatalog(db){
 db.exec(`CREATE TABLE IF NOT EXISTS prompts(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0,origin_agent_id TEXT,origin_purpose TEXT,UNIQUE(origin_agent_id,origin_purpose));
 CREATE TABLE IF NOT EXISTS prompt_revisions(id TEXT PRIMARY KEY,prompt_id TEXT NOT NULL REFERENCES prompts(id),version INTEGER NOT NULL,content TEXT NOT NULL,purposes_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(prompt_id,version));
 CREATE TABLE IF NOT EXISTS prompt_migrations(agent_revision_id TEXT NOT NULL REFERENCES agent_revisions(id),purpose TEXT NOT NULL,prompt_revision_id TEXT NOT NULL REFERENCES prompt_revisions(id),PRIMARY KEY(agent_revision_id,purpose));`);
 if(!db.prepare('PRAGMA table_info(agent_task_defaults)').all().some(c=>c.name==='prompt_revision_id'))db.exec('ALTER TABLE agent_task_defaults ADD COLUMN prompt_revision_id TEXT REFERENCES prompt_revisions(id)');
}
export function promptCatalogMethods(db,atomic){
 const list=()=>db.prepare('SELECT * FROM prompts ORDER BY rowid').all().map(p=>({...p,archived:Boolean(p.archived),revisions:db.prepare('SELECT * FROM prompt_revisions WHERE prompt_id=? ORDER BY version DESC').all(p.id).map(r=>({...r,purposes:JSON.parse(r.purposes_json)}))}));
 const save=input=>atomic(()=>{
  invariant(input&&typeof input==='object'&&!Array.isArray(input)&&(input.archived===undefined||typeof input.archived==='boolean'),'INVALID_PROMPT','Prompt 設定格式無效');
  invariant(typeof input.name==='string'&&input.name.trim()&&!input.name.includes('\0')&&Buffer.byteLength(input.name)<=160,'INVALID_PROMPT','Prompt 名稱無效');
  const description=input.description??'';invariant(typeof description==='string'&&description.length<=2000,'INVALID_PROMPT','Prompt 說明過長');
  const content=validatePromptTemplate(input.content),allowed=input.purposes??purposes;
  invariant(Array.isArray(allowed)&&allowed.length&&allowed.every(p=>purposes.includes(p))&&new Set(allowed).size===allowed.length,'INVALID_PROMPT_PURPOSE','Prompt 適用任務無效');
  const id=input.id??randomUUID(),prior=db.prepare('SELECT * FROM prompts WHERE id=?').get(id);
  if(input.id){invariant(prior,'PROMPT_NOT_FOUND','找不到 Prompt',404);invariant(db.prepare('SELECT id FROM prompt_revisions WHERE prompt_id=? ORDER BY version DESC LIMIT 1').get(id).id===input.expectedRevision,'CATALOG_CHANGED','Prompt 已更新，請重新讀取',409);}
  if(prior)db.prepare('UPDATE prompts SET name=?,description=?,archived=? WHERE id=?').run(input.name,description,Number(input.archived??false),id);
  else db.prepare('INSERT INTO prompts(id,name,description,archived) VALUES(?,?,?,?)').run(id,input.name,description,Number(input.archived??false));
  const version=(db.prepare('SELECT MAX(version) n FROM prompt_revisions WHERE prompt_id=?').get(id).n??0)+1;
  db.prepare('INSERT INTO prompt_revisions VALUES(?,?,?,?,?,?)').run(randomUUID(),id,version,content,JSON.stringify(allowed),new Date().toISOString());return list().find(p=>p.id===id);
 });
 return {
  listPrompts:list,saveCatalogPrompt:save,
  resolvePrompt(revisionId,purpose){
   invariant(typeof revisionId==='string'&&revisionId,'PROMPT_SELECTION_REQUIRED','請選擇 Prompt');
   const row=db.prepare('SELECT r.*,p.name,p.archived FROM prompt_revisions r JOIN prompts p ON p.id=r.prompt_id WHERE r.id=?').get(revisionId);
   invariant(row,'PROMPT_NOT_FOUND','找不到 Prompt 版本',404);invariant(!row.archived&&db.prepare('SELECT id FROM prompt_revisions WHERE prompt_id=? ORDER BY version DESC LIMIT 1').get(row.prompt_id).id===revisionId,'CATALOG_CHANGED','Prompt 已更新或封存，請重新選擇',409);
   const allowed=JSON.parse(row.purposes_json);invariant(allowed.includes(purpose),'PROMPT_PURPOSE_MISMATCH','此 Prompt 不適用目前任務');
   return {id:row.prompt_id,revisionId:row.id,name:row.name,version:row.version,content:row.content,purposes:allowed};
  },
 };
}
export function migrateAgentPrompts(db){
 const records=db.prepare('SELECT r.*,a.name,a.archived FROM agent_revisions r JOIN agent_profiles a ON a.id=r.agent_id ORDER BY r.agent_id,r.version').all();
 for(const row of records){
  const settings=JSON.parse(row.settings_json);if(!Object.values(agentPromptFields).some(field=>Object.hasOwn(settings,field)))continue;
  for(const [purpose,field] of Object.entries(agentPromptFields)){
   if(db.prepare('SELECT 1 FROM prompt_migrations WHERE agent_revision_id=? AND purpose=?').get(row.id,purpose))continue;
   const content=validatePromptTemplate(settings[field]);let profile=db.prepare('SELECT id FROM prompts WHERE origin_agent_id=? AND origin_purpose=?').get(row.agent_id,purpose);
   if(!profile){profile={id:randomUUID()};db.prepare('INSERT INTO prompts VALUES(?,?,?,?,?,?)').run(profile.id,`${row.name} · ${purpose}`,'由既有 Agent Prompt 原文遷入',row.archived,row.agent_id,purpose);}
   const version=(db.prepare('SELECT MAX(version) n FROM prompt_revisions WHERE prompt_id=?').get(profile.id).n??0)+1,id=randomUUID();
   db.prepare('INSERT INTO prompt_revisions VALUES(?,?,?,?,?,?)').run(id,profile.id,version,content,JSON.stringify([purpose]),row.created_at);
   db.prepare('INSERT INTO prompt_migrations VALUES(?,?,?)').run(row.id,purpose,id);
  }
 }
 db.exec(`UPDATE agent_task_defaults SET prompt_revision_id=(SELECT prompt_revision_id FROM prompt_migrations WHERE agent_revision_id=agent_task_defaults.agent_revision_id AND purpose=agent_task_defaults.purpose) WHERE prompt_revision_id IS NULL`);
 for(const agent of db.prepare('SELECT id FROM agent_profiles').all()){
  const latest=db.prepare('SELECT * FROM agent_revisions WHERE agent_id=? ORDER BY version DESC LIMIT 1').get(agent.id),settings=JSON.parse(latest.settings_json);
  if(!Object.values(agentPromptFields).some(field=>Object.hasOwn(settings,field)))continue;
  const revisionId=randomUUID();db.prepare('INSERT INTO agent_revisions VALUES(?,?,?,?,?)').run(revisionId,agent.id,latest.version+1,JSON.stringify(validateAgentRuntimeSettings(settings)),new Date().toISOString());
  db.prepare('INSERT INTO agent_skill_bindings SELECT ?,skill_revision_id,position FROM agent_skill_bindings WHERE agent_revision_id=?').run(revisionId,latest.id);
  db.prepare('UPDATE agent_task_defaults SET agent_revision_id=? WHERE agent_revision_id=?').run(revisionId,latest.id);
 }
}
