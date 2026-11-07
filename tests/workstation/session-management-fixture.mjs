import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {SessionManager} from '../../packages/workstation/session-management/core.mjs';

export const system={kind:'system',id:'test-controller'};
export const resultSchema={type:'object',properties:{summary:{type:'string',minLength:1,maxLength:1000},accepted:{type:'boolean'}},required:['summary','accepted'],additionalProperties:false};
export function fixture({approval=false,maxWorkers=8,workstationId='local'}={}) {
  const home=mkdtempSync(path.join(tmpdir(),'bdd-sessions-'));mkdirSync(path.join(home,'repo'));mkdirSync(path.join(home,'repo2'));
  const file=path.join(home,'metadata.sqlite'),options={workstationId,worktreeRoot:path.join(home,'worktrees'),maxWorkers};
  const m=new SessionManager(file,options);
  const save=(kind,id,body,revision=0)=>m.command('catalog.save',{kind,id,body,expectedRevision:revision});
  m.command('project.create',{id:'project-a',name:'Project A'});m.command('project.create',{id:'project-b',name:'Project B'});
  m.command('repository.register',{id:'repo-a',projectId:'project-a',name:'Repo A',rootPath:path.join(home,'repo')});
  m.command('repository.register',{id:'repo-b',projectId:'project-b',name:'Repo B',rootPath:path.join(home,'repo2')});
  save('skill','analysis',{name:'Analysis',instructions:'Read the approved requirements.'});
  save('profile','copilot',{name:'Copilot',transport:'acp',connectionRef:'chat-default'});
  const soul=roles=>({name:'Soul',roleTags:roles,thinkingStyle:'Verify evidence before conclusions.',avatarAssetId:'avatar:sa',skills:[{id:'analysis',revision:1,config:{}}]});
  save('soul','sa-soul',soul(['sa','secretary']));save('soul','sd-soul',soul(['sd']));
  const bot=soulId=>({name:'Bot',soul:{id:soulId,revision:1},runtime:'codex-sdk',acpProfile:{id:'copilot',revision:1},model:'test-model'});
  save('bot','sa',bot('sa-soul'));save('bot','sd',bot('sd-soul'));
  save('contract','requirement-result',{name:'Requirement',schema:resultSchema});
  const policy={steps:['PLAN','WORK','REVIEW'],allowedProfiles:['coding-acp'],maxConcurrent:1,maxTotal:2,maxTurns:3,timeoutMs:60000};
  const node=(key,botId,dependsOn)=>({key,bot:{id:botId,revision:1},goal:`Complete ${key}`,dependsOn,output:{id:'requirement-result',revision:1},cliPolicy:policy,requiresHumanApproval:approval});
  save('workflow','sa-sd',{name:'SA to SD',nodes:[node('analysis','sa',[]),node('design','sd',['analysis'])]});
  const create=(id='task-a',projectId='project-a',repositoryId='repo-a')=>m.command('task.create',{id,projectId,repositoryId,title:id,workflow:{id:'sa-sd',revision:1}});
  const ready=(taskId='task-a')=>{const d=m.detail(taskId);return m.command('worktree.ready',{taskId,path:d.worktree.path,branch:d.worktree.branch,baseSha:'a'.repeat(40)},{actor:system});};
  const start=(taskId='task-a',key='analysis')=>{const n=m.detail(taskId).nodes.find(n=>n.node_key===key);const c=m.command('node.start',{nodeId:n.id,expectedVersion:n.version},{actor:system});const s=m.command('runtime.attach',{sessionId:c.session.id,expectedGeneration:c.session.generation,adapter:'codex-sdk',nativeId:`fixture-${taskId}-${key}-${c.session.generation}`},{actor:system});return {node:m.node(n.id),session:s,actor:{kind:'bot',id:n.bot_id,taskId,nodeId:n.id,generation:s.generation}};};
  const submit=({node,session,actor},data={summary:'Analysed',accepted:true})=>m.command('node.submit',{nodeId:node.id,expectedVersion:m.node(node.id).version,inputRevision:1,generation:session.generation,data},{actor});
  return {m,home,file,options,save,create,ready,start,submit,close(){try{m.close();}catch{}rmSync(home,{recursive:true,force:true});}};
}
