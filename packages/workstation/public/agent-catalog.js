/** Shared selection UI and global catalog management. All content uses text nodes. */
export function agentCatalogView({api,el,button,note,ask,onDirty,onSaved}){
 let catalog;
 const title={gherkin:'Gherkin',design:'系統設計',testPlan:'測試計劃',development:'實作'};
 const input=(label,value='',type='text')=>{const wrapper=el('label',label),control=el(type==='textarea'?'textarea':'input');if(type!=='textarea')control.type=type;control.value=value;control.setAttribute('aria-label',label);wrapper.append(control);return {wrapper,control};};
 const load=async()=>catalog=await api('/agent-catalog');
 function skillChoices(ids=[],purpose){
  const group=el('fieldset'),legend=el('legend','Skills（依顯示順序套用）');group.append(legend);
  const ordered=[...ids,...catalog.skills.filter(s=>!s.archived&&(!purpose||s.revisions[0].purposes.includes(purpose))).map(s=>s.revisions[0].id).filter(id=>!ids.includes(id))];
  for(const id of ordered){const skill=catalog.skills.find(s=>s.revisions.some(r=>r.id===id));if(!skill)continue;const version=skill.revisions.find(r=>r.id===id),label=el('label',undefined,'check'),check=el('input');check.type='checkbox';check.value=id;check.checked=ids.includes(id);check.dataset.skill='1';const stale=skill.archived||version.id!==skill.revisions[0].id;check.setAttribute('aria-label',`${skill.name} · v${version.version}`);label.append(check,document.createTextNode(`${skill.name} · v${version.version}${stale?'（已更新或封存，請重新選擇）':''}`));const up=button('↑',()=>{const prior=label.previousElementSibling;if(prior?.tagName==='LABEL'){group.insertBefore(label,prior);group.dispatchEvent(new Event('change',{bubbles:true}));}}),down=button('↓',()=>{const next=label.nextElementSibling;if(next?.tagName==='LABEL'){group.insertBefore(next,label);group.dispatchEvent(new Event('change',{bubbles:true}));}});up.setAttribute('aria-label','上移 '+skill.name);down.setAttribute('aria-label','下移 '+skill.name);label.append(up,down);group.append(label);}
  if(!ordered.length)group.append(el('p','尚未建立適用的 Skill，可先不選。','muted'));
  return group;
 }
 const checked=group=>[...group.querySelectorAll('[data-skill]:checked')].map(n=>n.value);
 async function selector(repositoryId,purpose,selection){
  const defaults=await api(`/spec-repositories/${repositoryId}/agent-defaults`);await load();
  const initial=selection??defaults.find(d=>d.purpose===purpose),root=el('div',undefined,'agent-selection'),label=el('label','Agent'),select=el('select');select.setAttribute('aria-label','Agent');label.append(select);
  for(const agent of catalog.agents.filter(a=>!a.archived)){const r=agent.revisions[0];select.append(new Option(`${agent.name} · v${r.version}`,r.id));}
  if(initial?.agentRevisionId&&!Array.from(select.options).some(o=>o.value===initial.agentRevisionId))select.prepend(new Option('原選擇已更新或封存，請重新選擇',initial.agentRevisionId));
  if(initial)select.value=initial.agentRevisionId;
  const promptLabel=el('label','Prompt'),promptSelect=el('select');promptSelect.setAttribute('aria-label','Prompt');promptLabel.append(promptSelect);
  for(const prompt of catalog.prompts.filter(p=>!p.archived&&p.revisions[0].purposes.includes(purpose))){const r=prompt.revisions[0];promptSelect.append(new Option(`${prompt.name} · v${r.version}`,r.id));}
  if(initial?.promptRevisionId&&!Array.from(promptSelect.options).some(o=>o.value===initial.promptRevisionId))promptSelect.prepend(new Option('原 Prompt 已更新或封存，請重新選擇',initial.promptRevisionId));
  if(initial?.promptRevisionId)promptSelect.value=initial.promptRevisionId;
  let group=skillChoices(initial?.skillRevisionIds??catalog.agents.find(a=>a.revisions[0].id===select.value)?.revisions[0].skillRevisionIds??[],purpose);
  root.append(label,promptLabel,group);

  return {root,value:()=>({agentRevisionId:select.value,promptRevisionId:promptSelect.value,skillRevisionIds:checked(group)})};
 }
 async function render(repositories){
  await load();const root=document.querySelector('#agent-manager-view');root.replaceChildren();
  const heading=el('div',undefined,'page-heading');heading.append(el('h1','Agent、Prompt 與 Skill 管理'));root.append(heading,el('p','統一保存可重用的設定。每次儲存建立新版本，已派工的內容不受影響。','muted'));
  const toolbar=el('div',undefined,'toolbar'),list=el('div',undefined,'catalog-list'),editor=el('section',undefined,'panel catalog-editor'),layout=el('div',undefined,'catalog-layout');layout.append(list,editor);root.append(toolbar,layout);
  const run=fn=>async()=>{try{await fn();}catch(error){note(error.message,true);}};
  let editingDirty=false,defaultsDirty=false;const syncDirty=()=>{if(editingDirty||defaultsDirty)onDirty();else onSaved();};editor.oninput=()=>{editingDirty=true;syncDirty();};editor.onchange=editor.oninput;
  const edit=async(kind,item)=>{
   if(editingDirty&&!await ask('尚未儲存的設定','切換項目會捨棄編輯內容。','捨棄並切換'))return;
   editingDirty=false;syncDirty();
   const revision=item?.revisions[0];editor.replaceChildren(el('h2',`${item?'編輯':'新增'} ${kind==='agents'?'Agent':kind==='prompts'?'Prompt':'Skill'}`));
   const form=el('form'),name=input('名稱',item?.name??''),description=input('說明',item?.description??'','textarea');name.control.required=true;form.append(name.wrapper,description.wrapper);
   let fields={},skills,body,purposes,files=[];
   if(kind==='agents'){
    const settings=revision?.settings??catalog.template;
    for(const [key,label,type] of [['command','CLI 執行檔','text'],['args','CLI 參數（每行一個）','textarea'],['maxAttempts','最大嘗試次數','number'],['timeoutMs','逾時毫秒','number']]){const field=input(label,key==='args'?settings.args.join('\n'):settings[key],type);fields[key]=field.control;form.append(field.wrapper);}

   }else if(kind==='prompts'){
    body=input('Prompt 內容',revision?.content??catalog.promptTemplates.gherkin,'textarea');body.control.rows=12;body.control.required=true;form.append(body.wrapper);
    purposes=el('fieldset');purposes.append(el('legend','適用任務'));for(const purpose of catalog.purposes){const label=el('label',undefined,'check'),check=el('input');check.type='checkbox';check.value=purpose;check.checked=revision?revision.purposes.includes(purpose):purpose==='gherkin';label.append(check,document.createTextNode(title[purpose]));purposes.append(label);}form.append(purposes,el('p','模板變數：{requirementId}、{featureId}、{spec}、{projects}、{feedback}、{previousFailure}。','muted'));
   }else{
    body=input('Skill 內容',revision?.content??'','textarea');body.control.rows=12;body.control.required=true;form.append(body.wrapper);
    purposes=el('fieldset');purposes.append(el('legend','適用任務'));for(const purpose of catalog.purposes){const label=el('label',undefined,'check'),check=el('input');check.type='checkbox';check.value=purpose;check.checked=!revision||revision.purposes.includes(purpose);label.append(check,document.createTextNode(title[purpose]));purposes.append(label);}form.append(purposes);
    files=(revision?.resources??[]).map(f=>({...f}));const resourceList=el('div'),upload=input('加入 Skill 資源檔','','file'),importSkill=input('匯入 SKILL.md','','file');upload.control.multiple=true;
    const redraw=()=>{resourceList.replaceChildren();for(const file of files){const row=el('div',undefined,'catalog-resource'),name=input('資源相對路徑',file.path);name.control.oninput=()=>file.path=name.control.value;row.append(name.wrapper,button('移除',()=>{files=files.filter(f=>f!==file);editingDirty=true;syncDirty();redraw();}));resourceList.append(row);}};redraw();
    upload.control.onchange=run(async()=>{const added=[];for(const file of upload.control.files){const content=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());added.push({path:file.webkitRelativePath||file.name,content});}files.push(...added);editingDirty=true;syncDirty();upload.control.value='';redraw();});
    importSkill.control.onchange=run(async()=>{const file=importSkill.control.files[0];if(file){body.control.value=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());editingDirty=true;syncDirty();}});
    form.append(importSkill.wrapper,upload.wrapper,resourceList,el('p','資源支援 UTF-8 文字檔，以相對路徑保存；透過本次唯讀任務 MCP 提供給 Agent，不會自動執行。','muted'));
   }
   const actions=el('div',undefined,'inline-actions'),save=el('button','儲存新版本');save.type='submit';actions.append(save);
   const submit=async archived=>{
    const data={...(item?{id:item.id,expectedRevision:revision.id}:{}),name:name.control.value,description:description.control.value,archived};
    if(kind==='agents'){data.settings=Object.fromEntries(Object.entries(fields).map(([key,n])=>[key,key==='args'?n.value.split('\n').filter(Boolean):['timeoutMs','maxAttempts'].includes(key)?Number(n.value):n.value]));}
    else{data.content=body.control.value;data.purposes=[...purposes.querySelectorAll('input:checked')].map(n=>n.value);if(kind==='skills')data.resources=files;}
    const saved=await api('/agent-catalog/'+kind,'POST',data);await load();editingDirty=false;syncDirty();drawList();await edit(kind,catalog[kind].find(x=>x.id===saved.id));note('已保存新版本');
   };
   if(item)actions.append(button(item.archived?'重新啟用':'封存',run(()=>submit(!item.archived))));
   form.append(actions);form.onsubmit=event=>{event.preventDefault();save.disabled=true;void run(()=>submit(Boolean(item?.archived)))().finally(()=>save.disabled=false);};editor.append(form);
   if(item){const history=el('details');history.append(el('summary','版本紀錄'));for(const old of item.revisions){const detail=el('details');detail.append(el('summary',`v${old.version} · ${old.created_at}`),el('pre',JSON.stringify(kind==='agents'?{settings:old.settings}:kind==='prompts'?{content:old.content,purposes:old.purposes}:{content:old.content,resources:old.resources},null,2)));history.append(detail);}editor.append(history);}
  };
  const drawList=()=>{list.replaceChildren();for(const [kind,label] of [['agents','Agents'],['prompts','Prompts'],['skills','Skills']]){const section=el('section',undefined,'panel');section.append(el('h2',label));for(const item of catalog[kind]){const row=el('div',undefined,'catalog-row');row.append(el('div',`${item.name} · v${item.revisions[0].version}${item.archived?' · 已封存':''}`),button('編輯 '+item.name,()=>edit(kind,item)));section.append(row);}if(!catalog[kind].length)section.append(el('p','尚無項目','muted'));list.append(section);}};
  toolbar.append(button('新增 Agent',()=>edit('agents')),button('新增 Prompt',()=>edit('prompts')),button('新增 Skill',()=>edit('skills')));drawList();editor.append(el('p','選擇一個項目編輯，或新增 Agent／Prompt／Skill。','muted'));
  const defaults=el('section',undefined,'panel'),repoLabel=el('label','規格庫任務預設'),repoSelect=el('select'),defaultsBody=el('div');repoSelect.setAttribute('aria-label','規格庫任務預設');repoSelect.append(new Option('選擇規格庫',''));for(const repo of repositories)repoSelect.append(new Option(repo.title,repo.id));repoLabel.append(repoSelect);defaults.append(el('h2','各任務的預設組合'),repoLabel,defaultsBody);root.append(defaults);
  let defaultsRepository='';defaultsBody.onchange=()=>{defaultsDirty=true;syncDirty();};
  repoSelect.onchange=run(async()=>{if(defaultsDirty&&!await ask('尚未儲存的任務預設','切換規格庫會捨棄尚未儲存的選擇。','捨棄並切換')){repoSelect.value=defaultsRepository;return;}defaultsRepository=repoSelect.value;defaultsDirty=false;syncDirty();defaultsBody.replaceChildren();if(!repoSelect.value)return;const repositoryId=repoSelect.value;for(const purpose of catalog.purposes){const selection=await selector(repositoryId,purpose),section=el('section',undefined,'catalog-default');section.append(el('h3',title[purpose]),selection.root,button('儲存 '+title[purpose]+' 預設',run(async()=>{await api(`/spec-repositories/${repositoryId}/agent-defaults`,'PUT',{purpose,...selection.value()});defaultsDirty=false;syncDirty();note('任務預設已保存');})));defaultsBody.append(section);}});
 }
 return {selector,render};
}
