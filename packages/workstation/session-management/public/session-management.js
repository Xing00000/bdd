const $=selector=>document.querySelector(selector);
const api='/repository-api/v1/session-management';
let state,selected,detail;
async function request(route='',options={}){
  const response=await fetch(api+route,{...options,headers:{'content-type':'application/json','x-workbench-request':'1',...options.headers}});
  const data=await response.json();if(!response.ok)throw Error(`${data.code}: ${data.message}`);return data;
}
const command=(name,input)=>request('/commands',{method:'POST',body:JSON.stringify({command:name,input,requestId:crypto.randomUUID()})});
async function action(fn){$('#status').textContent='處理中…';try{await fn();$('#status').textContent='已保存。';}catch(error){$('#status').textContent=error.message;}}
function option(value,label){const node=document.createElement('option');node.value=value;node.textContent=label;return node;}
function selectOptions(element,rows,value,label){const prior=element.value;element.replaceChildren(...rows.map(row=>option(value(row),label(row))));if([...element.options].some(o=>o.value===prior))element.value=prior;}
function updateProject(){
  const ids=new Set(state.links.filter(r=>r.project_id===$('#project').value).map(r=>r.repository_id));
  selectOptions($('#repository'),state.repositories.filter(r=>ids.has(r.id)),r=>r.id,r=>r.name);
}
async function refresh(){
  state=await request();selectOptions($('#project'),state.projects,r=>r.id,r=>r.name);updateProject();
  selectOptions($('#workflow'),state.catalog.filter(r=>r.kind==='workflow'),r=>`${r.id}@${r.revision}`,r=>`${r.body.name} (${r.id}@${r.revision})`);
  $('#catalog').textContent=JSON.stringify(state.catalog,null,2);$('#tasks').replaceChildren();
  for(const task of state.tasks){const button=document.createElement('button');button.className='task';button.textContent=`${task.title} — ${task.state}`;button.onclick=()=>action(()=>loadTask(task.id));$('#tasks').append(button);}
  if(selected)await loadTask(selected);
}
async function loadTask(taskId){
  selected=taskId;detail=await request(`/tasks/${encodeURIComponent(taskId)}`);
  $('#task-summary').textContent=`${detail.task.title}｜${detail.task.state}｜聊天室 ${detail.room.id}`;
  $('#detail').textContent=JSON.stringify(detail,null,2);
  $('#target').replaceChildren(option('room','任務聊天室'),...detail.participants.map(bot=>option(`bot:${bot}`,bot)));
  const {events}=await request(`/tasks/${encodeURIComponent(taskId)}/events?limit=500`);$('#events').replaceChildren();
  for(const event of events){const div=document.createElement('div');div.className='event';div.textContent=`#${event.seq} ${event.actor_kind}:${event.actor_id} — ${event.type}\n${event.payload.text??JSON.stringify(event.payload)}\n${event.id}`;$('#events').append(div);}
  $('#task-actions').replaceChildren();
  if(detail.task.state==='PROVISIONING'){const button=document.createElement('button');button.textContent='重試建立 Worktree';button.onclick=()=>action(async()=>{await request(`/tasks/${encodeURIComponent(taskId)}/provision`,{method:'POST',body:'{}'});await refresh();});$('#task-actions').append(button);}
  if(!['CANCELLED','COMPLETED'].includes(detail.task.state)){const button=document.createElement('button');button.textContent='取消任務（不自動刪除 Worktree）';button.onclick=()=>{if(confirm('取消任務並保留對話與工作目錄？'))action(async()=>{await command('task.cancel',{taskId,expectedVersion:detail.task.version});await refresh();});};$('#task-actions').append(button);}
}
$('#refresh').onclick=()=>action(refresh);$('#project').onchange=updateProject;
$('#project-form').onsubmit=event=>{event.preventDefault();action(async()=>{await command('project.create',{name:new FormData(event.target).get('name')});event.target.reset();await refresh();});};
$('#repo-form').onsubmit=event=>{event.preventDefault();action(async()=>{const data=new FormData(event.target);await command('repository.register',{projectId:$('#project').value,name:data.get('name'),rootPath:data.get('rootPath')});event.target.reset();await refresh();});};
$('#task-form').onsubmit=event=>{event.preventDefault();action(async()=>{const data=new FormData(event.target),[id,rev]=String(data.get('workflow')).split('@');const result=await command('task.create',{projectId:$('#project').value,repositoryId:data.get('repositoryId'),title:data.get('title'),workflow:{id,revision:Number(rev)}});selected=result.task.id;await refresh();});};
$('#message-form').onsubmit=event=>{event.preventDefault();action(async()=>{if(!selected)throw Error('請先選擇任務。');const result=await command('room.message',{taskId:selected,target:$('#target').value,text:new FormData(event.target).get('text')});event.target.reset();await loadTask(selected);$('#status').textContent=`${result.delivery} #${result.seq}`;});};
$('#catalog-form').onsubmit=event=>{event.preventDefault();action(async()=>{const data=new FormData(event.target);const result=await command('catalog.save',{kind:data.get('kind'),id:data.get('id'),expectedRevision:Number(data.get('revision')),body:JSON.parse(data.get('body'))});event.target.elements.revision.value=result.revision;await refresh();});};
$('#memory-form').onsubmit=event=>{event.preventDefault();action(async()=>{const data=new FormData(event.target);await command('memory.summarize',{soulId:data.get('soulId'),projectId:$('#project').value,category:data.get('category'),summary:data.get('summary'),sourceEventIds:String(data.get('sources')).split(',').map(v=>v.trim()).filter(Boolean)});event.target.reset();});};
$('#portfolio-button').onclick=()=>action(async()=>{$('#portfolio').textContent=JSON.stringify(await request('/portfolio'),null,2);});
const schema={type:'object',properties:{summary:{type:'string',minLength:1,maxLength:2000}},required:['summary'],additionalProperties:false};
const examples={skill:{name:'需求分析',instructions:'先核對使用者目標與驗收條件。'},profile:{name:'Copilot ACP',transport:'acp',connectionRef:'chat-default'},soul:{name:'系統分析師',roleTags:['sa'],thinkingStyle:'先確認證據，再提出設計。',avatarAssetId:'avatar:sa',skills:[]},bot:{name:'SA Bot',soul:{id:'sa-soul',revision:1},runtime:'codex-sdk',acpProfile:{id:'copilot',revision:1},model:'請填入實際模型 ID'},contract:{name:'需求結果',schema},workflow:{name:'需求分析',nodes:[{key:'sa',bot:{id:'sa',revision:1},goal:'產出需求分析結果',dependsOn:[],output:{id:'requirement-result',revision:1},cliPolicy:{steps:['PLAN','REVIEW'],allowedProfiles:['copilot'],maxConcurrent:1,maxTotal:2,maxTurns:20,timeoutMs:60000},requiresHumanApproval:true}]}};
$('#example').onclick=()=>{$('#catalog-body').value=JSON.stringify(examples[$('#kind').value],null,2);};
action(refresh);
