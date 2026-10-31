const $ = selector => document.querySelector(selector);
const all = selector => [...document.querySelectorAll(selector)];
const API = '/repository-api/v1';
const stages = [
  ['GHERKIN','需求','定義可驗收的行為','編寫 Gherkin，確認實際要觀察的結果；不要先用實作方式取代需求。'],
  ['SD','設計','設計產品與測試的介面','描述系統設計、資料變更、產品界線與可操作的測試契約。'],
  ['TESTS','測試','實作真正的操作與斷言','補齊 Steps／Hooks。先驗證案例接線，再確認測試基線；接線通過不代表產品通過。'],
  ['IMPLEMENTATION','開發','讓產品符合已確認的測試','編輯 Project、提交並 Push 產品版本，再固定 submodule 指標，提交 Spec 候選。'],
  ['VERIFICATION','驗收','執行固定版本，保留實際證據','完整執行後才能判斷驗收；失敗也會保留報告，不會被下一次執行覆蓋。']
];
const labels = { 'repository.clone':'取得 Spec Repo', 'repository.initialize':'初始化結構', 'repository.validate':'檢查結構', 'repository.dependencies.install':'安裝測試依賴', 'repository.browsers.install':'安裝 Chromium', 'spec.feature.create':'建立需求功能', 'spec.file.save':'保存文件', 'project.file.save':'保存產品檔案', 'spec.review.confirm':'確認階段', 'spec.tests.check':'檢查測試接線', 'spec.feature.configure':'保存案例範圍', 'spec.execution.configure':'保存驗收環境', 'git.commit':'提交選取檔案', 'git.push':'Push', 'git.branch':'建立開發分支', 'git.fetch':'Fetch', 'git.remote':'更新 Remote', 'submodule.add':'加入 Project', 'submodule.pin':'固定產品版本', 'run.prepare':'準備驗收候選', 'run.execute':'執行驗收', 'run.publish':'發布報告', 'reports.reindex':'重建報告索引' };
const state = { repositories: [], repositoryId: null, detail: null, view:'overview', stage:'GHERKIN', featureKey:null, projectId:null, gitTarget:'', editor:null, projectEditor:null, git:null, capabilities:null, busy:null, epoch:0, config:null, scope:null, formDirty:false };
let upgradePlan, legacyPlan, dialogResolve;
function element(tag, text, className) { const n = document.createElement(tag); if(text!==undefined) n.textContent=text; if(className) n.className=className; return n; }
function button(text, action, {primary=false,disabled=false,mutate=false}={}) { const n=element('button',text,primary?'primary':undefined); n.type='button'; n.disabled=disabled; if(mutate)n.dataset.mutate=''; n.onclick=()=>safe(action); return n; }
function badge(text) { return element('span',text,`pill ${['VERIFIED','PASSED','PUBLISHED','已確認','乾淨'].includes(text)?'good':['FAILED','NOT_VERIFIED','失敗'].includes(text)?'bad':['STALE','PREVIEW','有未提交變更'].includes(text)?'warning':''}`); }
function note(message,error=false) { $('#notice').textContent=message; $('#notice').classList.toggle('error',error); $('#notice').setAttribute('role',error?'alert':'status'); }
async function safe(action) { try { await action(); } catch(e) { note(e.message,true); } }
async function api(route,method='GET',body) {
  const response=await fetch(API+route,{method,headers:{'content-type':'application/json','x-workbench-request':'1'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const value=await response.json(); if(!response.ok) throw new Error(`${value.code??response.status}：${value.message??'操作失敗'}`); return value;
}
const feature=()=>state.detail?.spec?.features.find(f=>f.key===state.featureKey);
const dirty=()=>Boolean(state.editor && $('#source-editor').value!==state.editor.content || state.projectEditor && $('#project-editor').value!==state.projectEditor.content || state.formDirty);
function closeDialog(confirmed=false) { $('#form-dialog').close(); if(dialogResolve){dialogResolve(confirmed);dialogResolve=null;} }
function field(label,name,value='',options={}) {
  const l=element('label',label), input=document.createElement(options.rows?'textarea':options.options?'select':'input'); input.name=name;
  if(options.options) for(const o of options.options) input.append(new Option(o.label,o.value));
  if(options.rows)input.rows=options.rows;
  if(options.required!==false)input.required=true;
  input.value=value; if(options.placeholder)input.placeholder=options.placeholder;
  l.append(input);return l;
}
function formDialog(title,description,fields,submit,onSubmit) {
  $('#dialog-title').textContent=title;$('#dialog-description').textContent=description;$('#dialog-fields').replaceChildren(...fields);$('#dialog-error').textContent='';$('#dialog-submit').textContent=submit;$('#dialog-submit').disabled=false;
  $('#dialog-form').onsubmit=async event=>{event.preventDefault();$('#dialog-submit').disabled=true;try{await onSubmit(new FormData(event.target));closeDialog(true);}catch(e){$('#dialog-error').textContent=e.message;}finally{$('#dialog-submit').disabled=false;}};
  $('#form-dialog').showModal();
}
function ask(title,description,submit='確認') { return new Promise(resolve=>{dialogResolve=resolve;formDialog(title,description,[],submit,async()=>{});}); }
async function guardDraft() { if(!dirty())return true; if(!await ask('有尚未保存的編輯','離開會捨棄目前文件或表單中的未保存內容；已寫入 Repo 的內容不受影響。','捨棄編輯並離開'))return false; state.editor=null;state.projectEditor=null;state.formDirty=false;return true; }
async function navigate(patch,{replace=false,guard=true}={}) {
  if(guard&&!await guardDraft())return;
  Object.assign(state,patch); state.editor=null;state.projectEditor=null;state.formDirty=false;
  const url=new URL(location.href);url.pathname='/';url.search='';
  if(state.repositoryId){url.searchParams.set('repo',state.repositoryId);url.searchParams.set('view',state.view);if(state.featureKey)url.searchParams.set('feature',state.featureKey);if(state.stage)url.searchParams.set('stage',state.stage);if(state.projectId)url.searchParams.set('project',state.projectId);if(state.gitTarget)url.searchParams.set('target',state.gitTarget);}
  history[replace?'replaceState':'pushState']({},'',url);$('#sidebar').classList.remove('open');$('#menu-toggle').setAttribute('aria-expanded','false');await refresh();
}
async function readRoute() { const q=new URLSearchParams(location.search);Object.assign(state,{repositoryId:q.get('repo'),view:q.get('view')??'overview',featureKey:q.get('feature'),stage:q.get('stage')??'GHERKIN',projectId:q.get('project'),gitTarget:q.get('target')??''});await refresh(); }
function applyBusy() { const busy=Boolean(state.busy);all('[data-mutate]').forEach(n=>{if(busy){n.dataset.wasDisabled=String(n.disabled);n.disabled=true;}else if(n.dataset.wasDisabled!==undefined){n.disabled=n.dataset.wasDisabled==='true';delete n.dataset.wasDisabled;}});$('#source-editor').readOnly=busy;$('#project-editor').readOnly=busy;$('#job-progress').hidden=!busy;if(busy){$('#job-title').textContent=labels[state.busy.name]??state.busy.name;$('#job-id').textContent=`${state.busy.repositoryTitle} · ${state.busy.id}`;} }
async function operation(name,input={},options={}) {
  if(state.busy)throw new Error('已有作業執行中；可查看進度或取消，不會重複送出。');
  if(dirty()&&!options.allowDraft)throw new Error('請先保存目前的編輯，再執行此操作。');
  const repositoryId=state.repositoryId, expected=options.expected??(typeof state.detail?.state==='object'?{head:state.detail.state.head,branch:state.detail.state.branch,fingerprint:state.detail.state.fingerprint}:{head:null});
  const request={schemaVersion:1,operationId:`OP-${crypto.randomUUID()}`,repositoryId,operation:name,input,expected,...(options.target?{target:options.target}:{})};
  const accepted=await api('/operations','POST',request);state.busy={id:accepted.id,name,repositoryId,repositoryTitle:state.detail.title};applyBusy();
  let result=accepted;
  try {
    while(['QUEUED','RUNNING','CANCELLING'].includes(result.status)){await new Promise(r=>setTimeout(r,450));result=await api(`/operations/${accepted.id}`);}
    if(result.status!=='SUCCEEDED')throw new Error(`${result.error?.code??result.status}：${result.error?.message??'作業沒有完成；原檔案與證據會保留。'}`);
    note(`${labels[name]??name}完成。${name==='git.push'||name==='run.publish'&&input.push?'遠端已核對。':'未自動 Push。'}`);
    return result.result;
  } finally {
    state.busy=null;applyBusy();
    if(options.refresh!==false&&state.repositoryId===repositoryId)await refresh();
    $('#notice').dataset.operation=name;$('#notice').dataset.jobId=accepted.id;$('#notice').dataset.outcome=result.status;
  }
}
async function refresh() {
  const epoch=++state.epoch; const list=await api('/spec-repositories'); if(epoch!==state.epoch)return;state.repositories=list;
  if(state.repositoryId){const detail=await api(`/spec-repositories/${state.repositoryId}`);if(epoch!==state.epoch)return;state.detail=detail;}
  else state.detail=null;
  renderNavigation();$('#home-view').hidden=Boolean(state.detail);$('#repository-view').hidden=!state.detail;
  if(!state.detail){renderHome();return;}
  const d=state.detail;$('#repository-title').textContent=d.title;$('#repository-origin').textContent=d.remoteUrl;
  $('#breadcrumbs').textContent=`工作台 / ${d.title}${state.projectId&&state.view==='projects'?` / projects/${state.projectId}`:state.featureKey&&state.view==='features'?` / ${state.featureKey}`:''}`;
  $('#version-bar').replaceChildren(badge(d.state==='NOT_CLONED'?'尚未取得 Repo':d.state.branch??'Detached HEAD'),element('code',d.state?.head??'尚無 Commit'),badge(d.state?.clean?'乾淨':d.state==='NOT_CLONED'?'未建立本機副本':'有未提交變更'));
  $('#repository-error').hidden=!d.specError&&!d.moduleError;$('#repository-error').textContent=[d.specError,d.moduleError].filter(Boolean).map(x=>`${x.code}：${x.message}`).join('\n');
  if(!['overview','features','projects','git','reports','maintenance'].includes(state.view))state.view='overview';
  all('.view').forEach(n=>n.hidden=n.id!==`${state.view}-view`);all('[data-view]').forEach(n=>n.setAttribute('aria-current',n.dataset.view===state.view?'page':'false'));
  if(state.view==='overview')await renderOverview(epoch);
  if(state.view==='features')await renderWorkflow(epoch);
  if(state.view==='projects')await renderProjects(epoch);
  if(state.view==='git')await inspectGit(epoch);
  if(state.view==='reports')renderRuns();
  if(state.view==='maintenance')renderMaintenance();
  if(epoch===state.epoch&&state.busy)applyBusy();
}
function renderNavigation() {
  $('#repository-list').replaceChildren();
  for(const r of state.repositories){const n=button('',()=>navigate({repositoryId:r.id,view:'overview',featureKey:null,projectId:null,gitTarget:''}));n.className=`repo-nav ${r.id===state.repositoryId?'active':''}`;n.setAttribute('aria-label',`開啟規格庫 ${r.title}`);n.append(element('strong',r.title),element('small',r.remoteUrl));$('#repository-list').append(n);
    if(r.id===state.repositoryId)for(const p of state.detail?.modules??[]){const child=button(`↳ ${p.id}`,()=>navigate({view:'projects',projectId:p.id}));child.className='project-nav';child.setAttribute('aria-label',`開啟 Project ${p.id}`);$('#repository-list').append(child);}}
}
function renderHome() {
  $('#breadcrumbs').textContent='工作台';$('#repo-count').textContent=state.repositories.length;$('#empty-state').hidden=state.repositories.length>0;$('#repository-cards').replaceChildren();
  for(const r of state.repositories){const c=element('article',undefined,'card');c.append(element('p','SPEC REPOSITORY','eyebrow'),element('h3',r.title),element('p',r.remoteUrl,'mono muted'),button('進入規格庫',()=>navigate({repositoryId:r.id,view:'overview',featureKey:null,projectId:null,gitTarget:''}),{primary:true}));$('#repository-cards').append(c);}
}
function bindRepository() { formDialog('綁定 Spec Repo','工作台可連結多個規格庫。請提供已建立的 remote；不會在工作台直接建立全域 Project。',[
  field('規格庫名稱','title',''),field('Git remote URL','remoteUrl','',{placeholder:'git@github.com:Xing00000/bdd-spec.git'}),field('預設分支（空 Repo 請留白）','branch','',{required:false,placeholder:'遠端預設分支'})
],'綁定規格庫',async form=>{const input=Object.fromEntries(form);if(!input.branch)delete input.branch;const r=await api('/spec-repositories','POST',input);await navigate({repositoryId:r.id,view:'overview',featureKey:null,projectId:null,gitTarget:''},{guard:false});note('Spec Repo 已綁定。接著取得遠端內容。');}); }
async function renderOverview(epoch) {
  const d=state.detail,panel=$('#onboarding');panel.replaceChildren();
  if(d.state==='NOT_CLONED')panel.append(element('p','01 / CONNECT','eyebrow'),element('h2','取得這個 Spec Repo'),element('p','從已綁定的 Git remote 建立受管理的本機副本。規格庫與產品有各自的 Git 歷史。','muted'),button('取得 Repo',()=>operation('repository.clone'),{primary:true,mutate:true}));
  else if(!d.initialized)panel.append(element('p','02 / INITIALIZE','eyebrow'),element('h2','建立規格與驗收結構'),element('p','空 Repo 可由範本初始化；非空且結構不相容的 Repo 不會被覆寫。','muted'),button('初始化 Spec 結構',()=>operation('repository.initialize'),{primary:true,mutate:true}));
  else if(!d.state.head)panel.append(element('p','03 / FIRST COMMIT','eyebrow'),element('h2','先提交規格庫的初始結構'),element('p','確認範本後建立第一個 Commit，才能加入產品 submodule。','muted'),button('檢視並提交初始結構',()=>navigate({view:'git',gitTarget:''}),{primary:true}));
  else panel.append(element('p','READY TO DEVELOP','eyebrow'),element('h2',`${d.modules?.length??0} 個 Projects · ${d.spec?.features.length??0} 個功能`),element('p','先加入產品、設定驗收環境與依賴，再開始需求 → 設計 → 測試 → 開發 → 驗收。','muted'),button('加入／管理 Projects',()=>navigate({view:'projects'})),document.createTextNode(' '),button('開始需求流程',()=>navigate({view:'features'}),{primary:true}));
  $('#validate-repo').disabled=!d.initialized;$('#install-dependencies').disabled=!d.initialized||!state.capabilities.executionEnabled;
  $('#install-browsers').disabled=!d.dependencies?.installed||!state.capabilities.executionEnabled;
  $('#dependency-state').textContent=!d.initialized?'初始化 Spec Repo 後可安裝。':`${d.dependencies?.installed?'依賴已安裝':'尚未安裝依賴'} · ${d.dependencies?.locked?'已有 package-lock.json':'尚無 lockfile'}${!state.capabilities.executionEnabled?'。伺服器尚未啟用受信任執行。':''}`;
  $('#execution-form').querySelector('button').disabled=!d.initialized;
  $('#service-project').replaceChildren(...(d.modules??[]).map(p=>new Option(p.id,p.id)));
  if(d.initialized){const file=await api(`/spec-repositories/${d.id}/file?path=workbench.yaml`);if(epoch!==state.epoch)return;state.config=file;
    if(!state.formDirty){const config=JSON.parse(file.content);$('#service-project').value=config.execution.service?.projectId??d.modules?.[0]?.id??'';$('#base-url').value=config.execution.environment?.WB_TARGET_BASE_URL??'';$('#health-url').value=config.execution.service?.healthUrl??'';$('#service-executable').value=config.execution.service?.command[0]??'node';$('#service-arguments').value=config.execution.service?.command.slice(1).join('\n')??'';}}
}
function createFeature() {
  const d=state.detail;if(!d.initialized)throw new Error('請先取得並初始化這個 Spec Repo。');
  const projects=element('fieldset');projects.append(element('legend','此功能使用的 Projects'));for(const p of d.modules??[]){const l=element('label',undefined,'check'),i=document.createElement('input');i.type='checkbox';i.name='projectIds';i.value=p.id;l.append(i,document.createTextNode(p.id));projects.append(l);}
  formDialog('建立需求功能','相同的 Requirement／Feature ID 會對應 spec、tests、reports 三個目錄。',[
    field('需求 ID','requirementId','REQ-001'),field('功能 ID','featureId','',{placeholder:'login'}),field('功能標題','title',''),projects
  ],'建立功能',async form=>{const result=await operation('spec.feature.create',{requirementId:form.get('requirementId'),featureId:form.get('featureId'),title:form.get('title'),projectIds:form.getAll('projectIds')},{refresh:false});await navigate({view:'features',featureKey:result.key,stage:'GHERKIN'},{guard:false});});
}
async function renderWorkflow(epoch) {
  const d=state.detail, features=d.spec?.features??[];$('#new-feature').disabled=!d.initialized;
  if(!features.some(f=>f.key===state.featureKey))state.featureKey=features[0]?.key??null;
  $('#feature-select').replaceChildren(...features.map(f=>new Option(`${f.key} · ${f.title}`,f.key)));$('#feature-select').value=state.featureKey??'';
  $('#workflow').hidden=!feature();$('#feature-empty').hidden=Boolean(feature());if(!feature())return;
  const f=feature();if(!stages.some(x=>x[0]===state.stage))state.stage='GHERKIN';
  $('#stage-nav').replaceChildren();stages.forEach(([key,title],i)=>{const n=button('',()=>navigate({stage:key}));n.setAttribute('aria-label',`${i+1} ${title}`);n.setAttribute('aria-current',key===state.stage?'step':'false');const confirmed=i<3?f.review.confirmed[['gherkin','sd','tests'][i]]:i===4&&f.verification.status==='VERIFIED';n.classList.toggle('complete',Boolean(confirmed));n.append(element('span',confirmed?'✓':String(i+1),'step-number'),element('span',title));$('#stage-nav').append(n);});
  const phase=stages.find(x=>x[0]===state.stage);$('#phase-title').textContent=phase[2];$('#phase-description').textContent=phase[3];$('#feature-status').replaceWith(Object.assign(badge(f.verification?.status==='VERIFIED'?'VERIFIED':f.review.stage),{id:'feature-status'}));
  const sources=state.stage==='GHERKIN'?[`spec/${f.key}/${f.id}.feature`]:state.stage==='SD'?[`spec/${f.key}/${f.id}.sd.md`]:[`tests/${f.key}/${f.id}.steps.ts`,`tests/${f.key}/${f.id}.hooks.ts`];
  const selected=state.editor?.repositoryId===d.id&&sources.includes(state.editor.path)?state.editor.path:sources[0];
  $('#source-select').replaceChildren(...sources.map(x=>new Option(x.split('/').at(-1),x)));$('#source-select').value=selected;
  const editing=['GHERKIN','SD','TESTS'].includes(state.stage);$('#source-panel').hidden=!editing;$('#implementation-panel').hidden=state.stage!=='IMPLEMENTATION';$('#verification-panel').hidden=state.stage!=='VERIFICATION';
  $('#check-tests').hidden=state.stage!=='TESTS';$('#reviewer-label').hidden=!editing;
  if(!$('#reviewer').value)$('#reviewer').value=localStorage.getItem('bdd-reviewer')??'';
  if(!state.formDirty){$('#case-ids').value=f.caseIds.join('\n');all('[name=profile]').forEach(n=>n.checked=f.profiles.includes(n.value));$('#feature-projects').replaceChildren(element('legend','關聯的 Projects'));for(const p of d.modules??[]){const l=element('label',undefined,'check'),i=document.createElement('input');i.type='checkbox';i.value=p.id;i.name='feature-project';i.checked=f.projectIds.includes(p.id);l.append(i,document.createTextNode(p.id));$('#feature-projects').append(l);}}
  const scope=await api(`/spec-repositories/${d.id}/file?path=${encodeURIComponent(`spec/${f.key}/feature.yaml`)}`);if(epoch!==state.epoch)return;state.scope=scope;
  $('#implementation-projects').replaceChildren();for(const p of (d.modules??[]).filter(p=>f.projectIds.includes(p.id))){const c=element('div',undefined,'card');c.append(element('h3',p.id),element('p',`固定 ${p.commit}`,'mono muted'),button('開啟產品原始碼',()=>navigate({view:'projects',projectId:p.id})));$('#implementation-projects').append(c);}
  if(editing)await openSource(selected,epoch);if(epoch!==state.epoch)return;
  renderNextAction();
}
function renderNextAction() {
  const f=feature();if(!f)return;const stage=state.stage,d=state.detail;
  const checkValid=f.tooling?.status==='CHECKED'&&f.tooling.digest===f.review.hashes.tests;
  const blockers=[];
  if(stage==='SD'&&!f.review.confirmed.gherkin)blockers.push('先確認目前的 Gherkin。');
  if(stage==='TESTS'){if(!f.review.confirmed.gherkin||!f.review.confirmed.sd)blockers.push('先確認需求與系統設計。');if(!checkValid)blockers.push('先執行「檢查測試接線」，讓實際案例與設定一致。');}
  if(stage==='IMPLEMENTATION'||stage==='VERIFICATION'){if(!Object.values(f.review.confirmed).every(Boolean))blockers.push('需求、設計與測試尚未全部確認。');if(!d.state.clean)blockers.push('請先提交 Spec Repo 與產品變更，固定候選版本。');if(!d.dependencies?.locked)blockers.push('先安裝測試依賴並提交 lockfile。');if((d.modules??[]).some(p=>!p.actual||p.actual!==p.commit||p.dirty))blockers.push('Projects 必須乾淨且對應固定的 gitlink。');}
  $('#next-title').textContent=stage==='IMPLEMENTATION'||stage==='VERIFICATION'?'下一步：建立固定版本驗收候選':`下一步：確認${stages.find(x=>x[0]===stage)[1]}`;
  $('#next-reason').textContent=blockers.length?blockers.join(' '):stage==='IMPLEMENTATION'||stage==='VERIFICATION'?'可以建立候選；接著在驗收紀錄中啟動真正的測試。':'確認的是目前內容摘要。上游文件變更後，下游需要重新確認。';
  $('#check-state').textContent=f.tooling?`${checkValid?'目前接線已檢查':'先前接線檢查已過期'} · ${f.tooling.tests} 個測試 · 產品尚未因此通過驗收。`:'';
  $('#advance').textContent=stage==='IMPLEMENTATION'||stage==='VERIFICATION'?'準備驗收候選':`確認${stage==='GHERKIN'?' Gherkin':stage==='SD'?'系統設計':'測試基線'}`;
  $('#advance').disabled=blockers.length>0;$('#advance').title=blockers.join(' ');
  $('#check-tests').disabled=!state.capabilities.executionEnabled||!d.dependencies?.installed||!f.review.confirmed.sd;
  $('#candidate-state').textContent=blockers.length?blockers.join(' '):`目前 Spec commit：${d.state.head}`;
}
async function openSource(relative,epoch=state.epoch) {
  if(state.editor?.repositoryId===state.repositoryId&&state.editor.path===relative&&$('#source-editor').value!==state.editor.content)return;
  const repositoryId=state.repositoryId,file=await api(`/spec-repositories/${repositoryId}/file?path=${encodeURIComponent(relative)}`);if(epoch!==state.epoch||repositoryId!==state.repositoryId)return;
  state.editor={...file,repositoryId};$('#source-editor').value=file.content;$('#source-path').textContent=relative;$('#source-hash').textContent=file.sha256.slice(0,16);$('#editor-state').textContent='已保存';
}
async function saveSource() {
  if(!state.editor)return;const content=$('#source-editor').value,original=state.editor;
  const result=await operation('spec.file.save',{path:original.path,content,expectedHash:original.sha256},{allowDraft:true,refresh:false});state.editor={...original,content,sha256:result.sha256};await refresh();
}
async function advance() {
  const f=feature();if(!f)return;
  if(['IMPLEMENTATION','VERIFICATION'].includes(state.stage)){await operation('run.prepare',{requirementId:f.requirementId,featureId:f.id},{refresh:false});await navigate({view:'reports',stage:'VERIFICATION'},{guard:false});return;}
  const stage={GHERKIN:'gherkin',SD:'sd',TESTS:'tests'}[state.stage],name=$('#reviewer').value.trim();if(!name)throw new Error('請填寫人工確認者名稱。');
  if(!await ask('確認這一版內容',`${f.key} · ${stage}\n來源摘要：${f.review.hashes[stage]}\n此操作不會自動 Commit 或 Push。`,'確認目前版本'))return;
  await operation('spec.review.confirm',{requirementId:f.requirementId,featureId:f.id,stage,expectedDigest:f.review.hashes[stage],confirmedBy:name},{refresh:false});localStorage.setItem('bdd-reviewer',name);
  await navigate({stage:stage==='gherkin'?'SD':stage==='sd'?'TESTS':'IMPLEMENTATION'},{guard:false});
}
function addProject() {
  if(!state.detail?.state?.head||!state.detail.state.clean)throw new Error('加入 Project 前，請先在 Git 頁提交 Spec Repo 的初始結構與現有變更。');
  formDialog('加入 Project','產品會成為這個 Spec Repo 下的 projects/<id> submodule。選擇遠端分支後，系統會解析並固定實際 commit。',[
    field('Project ID','projectId','',{placeholder:'frontend'}),field('產品 Git remote URL','url',''),field('產品來源分支','ref','main')
  ],'加入產品',async form=>{await operation('submodule.add',Object.fromEntries(form));});
}
async function renderProjects(epoch) {
  const d=state.detail;$('#add-project').disabled=!d.initialized||!d.state?.head||!d.state?.clean;
  $('#add-project').title=!d.state?.clean?'先提交 Spec Repo 現有變更':'';$('#project-cards').replaceChildren();
  for(const p of d.modules??[]){const c=element('article',undefined,'card');c.append(element('p',`projects/${p.id}`,'eyebrow'),element('h3',p.id),element('p',p.url,'mono muted'),badge(p.dirty?'有未提交變更':p.actual===p.commit?'乾淨':'版本尚未固定'),element('p',`固定 ${p.commit}`,'mono muted'));
    const actions=element('div',undefined,'toolbar');actions.append(button('編輯產品',()=>navigate({projectId:p.id})),button('固定目前產品 Commit',async()=>{if(await ask('固定產品版本',`${p.id}\n目前 ${p.actual}\n只改 Spec Repo 的 gitlink，不會 Push。`,'固定版本'))await operation('submodule.pin',{projectId:p.id});},{mutate:true,disabled:!p.actual||p.dirty}));c.append(actions);$('#project-cards').append(c);}
  if(!d.modules?.length)$('#project-cards').append(element('p','此 Spec Repo 尚未加入任何 Project。','muted'));
  const p=d.modules?.find(p=>p.id===state.projectId);$('#project-editor-panel').hidden=!p;if(!p)return;
  $('#project-title').textContent=`${p.id} · 原始碼`;const files=await api(`/spec-repositories/${d.id}/projects/${p.id}/files`);if(epoch!==state.epoch)return;
  state.projectState=files.state;$('#project-head').textContent=`${files.state.branch??'Detached HEAD'} · ${files.state.head}`;
  $('#project-write-hint').textContent=files.state.branch?'只修改此 Project Repo；完成後分別 Commit、Push，再固定 Spec Repo 的指標。':'目前是固定版本的 Detached HEAD。先按「此 Project 的 Git」建立開發分支，才能保存產品修改。';
  const previous=state.projectEditor?.projectId===p.id?state.projectEditor.path:null;$('#project-file-select').replaceChildren(...files.files.map(x=>new Option(x,x)));if(previous&&files.files.includes(previous))$('#project-file-select').value=previous;
  $('#save-project-file').disabled=!files.state.branch;
  if(files.files.length)await openProjectFile($('#project-file-select').value,epoch);
}
async function openProjectFile(relative,epoch=state.epoch) {
  if(state.projectEditor?.repositoryId===state.repositoryId&&state.projectEditor?.projectId===state.projectId&&state.projectEditor?.path===relative&&$('#project-editor').value!==state.projectEditor.content)return;
  const repositoryId=state.repositoryId,projectId=state.projectId,file=await api(`/spec-repositories/${repositoryId}/projects/${projectId}/file?path=${encodeURIComponent(relative)}`);if(epoch!==state.epoch)return;
  state.projectEditor={...file,repositoryId};$('#project-editor').value=file.content;$('#project-file-path').textContent=`projects/${projectId}/${relative}`;
}
async function saveProduct() {
  const original=state.projectEditor;if(!original)return;const content=$('#project-editor').value;
  const result=await operation('project.file.save',{projectId:original.projectId,path:original.path,content,expectedHash:original.sha256},{expected:state.projectState,allowDraft:true,refresh:false});state.projectEditor={...original,content,sha256:result.sha256};await refresh();
}
async function inspectGit(epoch=state.epoch) {
  if(state.detail.state==='NOT_CLONED'){$('#git-head').textContent='請先取得 Spec Repo。';$('#changed-files').replaceChildren();return;}
  const d=state.detail,targets=[new Option('Spec Repo',''),...(d.modules??[]).map(p=>new Option(`Project / ${p.id}`,p.id))];$('#git-target').replaceChildren(...targets);if(!targets.some(o=>o.value===state.gitTarget))state.gitTarget='';$('#git-target').value=state.gitTarget;
  const value=await api(`/spec-repositories/${d.id}/git${state.gitTarget?`?projectId=${encodeURIComponent(state.gitTarget)}`:''}`);if(epoch!==state.epoch)return;state.git=value;
  $('#git-head').textContent=`${state.gitTarget?`Project ${state.gitTarget}`:'Spec Repo'} · ${value.state.branch??'Detached HEAD'} · ${value.state.head??'尚無 Commit'}`;
  $('#changed-files').replaceChildren();for(const c of value.state.changes){const l=element('label',undefined,'check file-row'),i=document.createElement('input');i.type='checkbox';i.value=c.path;i.setAttribute('aria-label',`選取檔案 ${c.path}`);l.append(i,element('code',`${c.code} ${c.path}`));$('#changed-files').append(l);}
  if(!value.state.changes.length)$('#changed-files').append(element('p','沒有待提交的變更。','muted'));
  $('#commit-selected').disabled=!value.state.branch||!value.state.changes.length;$('#create-branch').disabled=!value.state.clean;
  $('#diff').textContent=`STAGED\n${value.staged||'（無）'}\n\nUNSTAGED\n${value.unstaged||'（無）'}`;
  const previous=$('#push-remote').value;$('#push-remote').replaceChildren(...value.remotes.map(x=>new Option(x.name,x.name)));if(value.remotes.some(r=>r.name===previous))$('#push-remote').value=previous;
  $('#push-branch').value=value.state.branch??'';$('#push').disabled=!value.state.head||!value.state.branch;updatePushDestination();
  $('#remote-list').replaceChildren();for(const r of value.remotes){const row=element('div',undefined,'remote-row'),info=element('div');info.append(element('strong',r.name),element('code',`Fetch ${r.url}`),element('code',`Push ${r.pushUrl}`));const actions=element('div',undefined,'toolbar');actions.append(button('編輯 Remote',()=>editRemote(r),{mutate:true}));if(r.name!=='origin')actions.append(button('移除 Remote',async()=>{if(await ask('移除 Remote',`只移除本機 ${r.name} 的連線設定，不刪除遠端 Repo。`,'移除連線'))await operation('git.remote',{action:'remove',name:r.name,previous:r},{target:gitTarget(),expected:state.git.state});},{mutate:true}));row.append(info,actions);$('#remote-list').append(row);}
}
const gitTarget=()=>state.gitTarget?{kind:'project',projectId:state.gitTarget}:{kind:'spec'};
function updatePushDestination(){const r=state.git?.remotes.find(x=>x.name===$('#push-remote').value);$('#push-destination').textContent=r?`${r.pushUrl}\nrefs/heads/${$('#push-branch').value}`:'';}
function editRemote(previous) { const fields=[field('Remote 名稱','name',previous?.name??''),field('Fetch URL','url',previous?.url??''),field('Push URL（可不同）','pushUrl',previous?.pushUrl??'',{required:false})];if(previous)fields[0].querySelector('input').readOnly=true;
  formDialog(previous?'編輯 Git Remote':'新增 Git Remote',`目標：${state.gitTarget?`Project ${state.gitTarget}`:'Spec Repo'}。修改連線不會自動 Fetch、Merge 或 Push。`,fields,'保存 Remote',async form=>{const input=Object.fromEntries(form);if(!input.pushUrl)delete input.pushUrl;await operation('git.remote',{...input,action:previous?'update':'add',...(previous?{previous}:{})},{target:gitTarget(),expected:state.git.state});}); }
async function commitSelected() { const paths=all('#changed-files input:checked').map(n=>n.value);if(!paths.length)throw new Error('請先勾選要提交的檔案。');const message=$('#commit-message').value.trim();if(!message)throw new Error('請填寫提交訊息。');await operation('git.commit',{paths,message},{target:gitTarget(),expected:state.git.state});$('#commit-message').value=''; }
async function pushSelected() { const remote=$('#push-remote').value,branch=$('#push-branch').value,r=state.git.remotes.find(x=>x.name===remote);
  if(!await ask('確認推送版本',`${state.gitTarget?`Project ${state.gitTarget}`:'Spec Repo'}\n${state.git.state.head}\n→ ${r?.pushUrl}\n→ ${branch}\n不使用 Force Push。`,'確認 Push'))return;
  const receipt=await operation('git.push',{remote,branch},{target:gitTarget(),expected:state.git.state});$('#push-receipt').textContent=`遠端已核對：${receipt.remote} / ${receipt.branch} · ${receipt.remoteCommit}`;
}
function artifactUrl(runId,file,key){return `${API}/spec-repositories/${state.repositoryId}/runs/${runId}/artifact?path=${encodeURIComponent(file)}${key?'&reportKey='+encodeURIComponent(key):''}`;}
function renderRuns(){
  const d=state.detail;$('#run-list').replaceChildren();$('#reindex-reports').disabled=d.state==='NOT_CLONED';
  if(!(d.runs?.length||d.reports?.length))$('#run-list').append(element('div','尚無執行紀錄。完成需求、設計與測試確認後，從「開發」階段準備驗收候選。','empty-state'));
  for(const r of d.runs??[]){const m=r.result,c=element('article',undefined,'card');c.dataset.runId=r.id;const heading=element('div',undefined,'run-header');heading.append(element('h3',`${m.requirementId} / ${m.featureId}`),badge(m.verification??r.state),badge(m.testOutcome??'NOT_RUN'));c.append(heading,element('p',r.id,'mono muted'));
    const facts=element('div',undefined,'run-facts');for(const [label,value] of [['受測 Spec Commit',m.testedSpecCommit],['產品版本',(m.projects??[]).map(p=>`${p.id} ${p.commit}`).join('\n')||'無產品'],['報告版本',r.publication?.reportCommit??'尚未提交'],['發布狀態',r.publication?.status??'尚未發布']]){const item=element('div');item.append(element('small',label),element('code',value));facts.append(item);}c.append(facts);
    if(m.failure||m.reasons?.length)c.append(element('p',m.failure?.message??m.reasons.join(' · '),'error'));
    const actions=element('div',undefined,'toolbar');if(r.state==='PREPARED')actions.append(button('執行此候選驗收',()=>operation('run.execute',{runId:r.id}),{primary:true,mutate:true,disabled:!state.capabilities.executionEnabled}));
    if(r.state==='SEALED'){actions.append(button('檢視證據',()=>showReport(r.id)),button('建立報告 Commit',()=>operation('run.publish',{runId:r.id,push:false}),{mutate:true,disabled:Boolean(r.publication)}),button('Push 報告分支',async()=>{if(await ask('確認推送報告',`${r.id}\n→ origin / evidence/${r.id}\n請確認截圖與 logs 不含不應公開的資料；不修改 main。`,'確認發布報告'))await operation('run.publish',{runId:r.id,push:true});},{primary:true,mutate:true,disabled:r.publication?.status==='PUBLISHED'}));}c.append(actions);$('#run-list').append(c);}
  for(const r of d.reports??[]){const c=element('article',undefined,'card');c.append(element('h3',r.key),badge(r.invalidReason??'GIT_INDEXED'),element('p',`${r.ref} · ${r.reportCommit}`,'mono muted'));if(!r.invalidReason)c.append(button('檢視 Git 證據',()=>showReport(r.runId,r.key)));$('#run-list').append(c);}
}
async function showReport(runId,key){
  const response=await fetch(artifactUrl(runId,'manifest.json',key)),m=await response.json();if(!response.ok)throw new Error(m.message);const panel=$('#report-view');panel.hidden=false;panel.replaceChildren(element('p','EXECUTION EVIDENCE','eyebrow'),element('h2',`${m.requirementId} / ${m.featureId}`),badge(m.testOutcome),document.createTextNode(' '),badge(m.verification),element('p',`受測 ${m.testedSpecCommit}`,'mono muted'));
  const table=element('table',undefined,'report-table'),head=element('tr');['案例','瀏覽器','結果','斷言'].forEach(x=>head.append(element('th',x)));table.append(head);for(const c of m.cases??[]){const row=element('tr');[c.caseId,c.profile,c.status,String(c.assertions)].forEach(x=>row.append(element('td',x)));table.append(row);}panel.append(table);
  const gallery=element('div',undefined,'gallery');for(const a of m.artifacts.filter(a=>a.path.startsWith('screenshots/'))){const figure=element('figure'),link=element('a'),img=document.createElement('img');link.href=artifactUrl(runId,a.path,key);link.target='_blank';link.rel='noopener';img.src=link.href;img.alt=a.path;img.loading='lazy';link.append(img);figure.append(link,element('figcaption',a.path));gallery.append(figure);}panel.append(gallery);
  const downloads=element('div',undefined,'toolbar');for(const a of m.artifacts.filter(a=>a.path==='report.html'||a.path.startsWith('traces/')||a.path.startsWith('logs/'))){const link=element('a',a.path);link.href=artifactUrl(runId,a.path,key);link.download=a.path.split('/').at(-1);downloads.append(link);}panel.append(downloads);
  const raw=element('details');raw.append(element('summary','完整 manifest 與檔案摘要'),element('pre',JSON.stringify(m,null,2)));panel.append(raw);panel.scrollIntoView({block:'start'});
}
function renderMaintenance(){
  const d=state.detail;$('#legacy-policy').textContent=state.capabilities.legacyImport?'已設定伺服器端唯讀舊 DB；匯入後需要重新確認，不沿用舊通過狀態。':'尚未設定 WB_LEGACY_DB；不接受瀏覽器指定任意伺服器路徑。';$('#preview-legacy').disabled=!state.capabilities.legacyImport;$('#apply-upgrade').disabled=!upgradePlan?.changed;$('#apply-legacy').disabled=!legacyPlan;$('#transactions').replaceChildren();
  for(const t of d.transactions??[]){const c=element('div',undefined,'card');c.append(element('h3',t.metadata.kind),element('p',t.transactionId,'mono muted'),badge(t.status));if(t.status!=='APPLIED')c.append(button('續做此交易',()=>operation('repository.transaction.resume',{transactionId:t.transactionId}),{mutate:true}));$('#transactions').append(c);}
  $('#operation-list').replaceChildren();for(const op of d.operations??[]){const item=element('details',undefined,'compact');item.append(element('summary',`${op.status} · ${labels[op.request.operation]??op.request.operation}`),element('pre',JSON.stringify({id:op.id,result:op.result,error:op.error},null,2)));$('#operation-list').append(item);}
}
function on(selector,event,action){$(selector).addEventListener(event,e=>{if(event==='submit')e.preventDefault();safe(()=>action(e));});}
all('[data-home]').forEach(n=>n.onclick=e=>{e.preventDefault();safe(()=>navigate({repositoryId:null,featureKey:null,projectId:null}));});
for(const selector of ['#bind-home','#bind-empty','#bind-sidebar'])on(selector,'click',bindRepository);
on('#close-dialog','click',()=>closeDialog());on('#cancel-dialog','click',()=>closeDialog());$('#form-dialog').addEventListener('cancel',e=>{e.preventDefault();closeDialog();});
on('#menu-toggle','click',()=>{const open=$('#sidebar').classList.toggle('open');$('#menu-toggle').setAttribute('aria-expanded',String(open));});
all('[data-view]').forEach(n=>n.onclick=()=>safe(()=>navigate({view:n.dataset.view})));
on('#refresh','click',async()=>{if(await guardDraft())await refresh();});
on('#cancel-job','click',async()=>{if(state.busy)await api(`/operations/${state.busy.id}/cancel`,'POST',{});});
on('#validate-repo','click',()=>operation('repository.validate'));
on('#install-dependencies','click',async()=>{if(await ask('安裝規格庫依賴','執行固定 npm 安裝，不執行 lifecycle scripts。產生的 lockfile 請審閱並提交。','安裝依賴'))await operation('repository.dependencies.install');});
on('#install-browsers','click',()=>operation('repository.browsers.install'));
on('#execution-form','input',()=>{state.formDirty=true;});
on('#execution-form','submit',async()=>{await operation('spec.execution.configure',{expectedHash:state.config.sha256,projectId:$('#service-project').value,baseUrl:$('#base-url').value,healthUrl:$('#health-url').value,command:[$('#service-executable').value,...$('#service-arguments').value.split('\n').map(x=>x.trim()).filter(Boolean)]},{allowDraft:true,refresh:false});state.formDirty=false;await refresh();});
on('#new-feature','click',createFeature);on('#feature-select','change',()=>navigate({featureKey:$('#feature-select').value,stage:'GHERKIN'}));
on('#source-select','change',async()=>{const value=$('#source-select').value;if(await guardDraft())await openSource(value);});
on('#source-editor','input',()=>{$('#editor-state').textContent=state.editor&&$('#source-editor').value!==state.editor.content?'尚未保存':'已保存';});
on('#save-source','click',saveSource);on('#advance','click',advance);
on('#feature-scope-form','input',()=>{state.formDirty=true;});
on('#feature-scope-form','submit',async()=>{const f=feature();await operation('spec.feature.configure',{requirementId:f.requirementId,featureId:f.id,expectedHash:state.scope.sha256,projectIds:all('[name=feature-project]:checked').map(x=>x.value),caseIds:$('#case-ids').value.split('\n').map(x=>x.trim()).filter(Boolean),profiles:all('[name=profile]:checked').map(x=>x.value)},{allowDraft:true,refresh:false});state.formDirty=false;await refresh();});
on('#check-tests','click',()=>operation('spec.tests.check',{requirementId:feature().requirementId,featureId:feature().id}));
on('#implementation-git','click',()=>navigate({view:'git',gitTarget:''}));on('#open-feature-runs','click',()=>navigate({view:'reports'}));
on('#add-project','click',addProject);on('#project-git','click',()=>navigate({view:'git',gitTarget:state.projectId}));on('#open-project-file','click',async()=>{const path=$('#project-file-select').value;if(await guardDraft())await openProjectFile(path);});on('#save-project-file','click',saveProduct);
on('#git-target','change',()=>navigate({gitTarget:$('#git-target').value}));on('#inspect-git','click',()=>inspectGit());
on('#create-branch','click',()=>operation('git.branch',{name:$('#branch-name').value,create:true},{target:gitTarget(),expected:state.git.state}));
on('#select-all','click',()=>{const inputs=all('#changed-files input');const selected=inputs.every(n=>n.checked);inputs.forEach(n=>n.checked=!selected);});on('#commit-selected','click',commitSelected);on('#push','click',pushSelected);
on('#push-remote','change',updatePushDestination);on('#push-branch','input',updatePushDestination);on('#fetch-remote','click',()=>operation('git.fetch',{remote:$('#push-remote').value},{target:gitTarget(),expected:state.git.state}));on('#add-remote','click',()=>editRemote());
on('#reindex-reports','click',async()=>{const result=await operation('reports.reindex');note(`已索引 ${result.indexed.length} 份報告；${result.errors.length} 項錯誤。`,result.errors.length>0);});
on('#preview-upgrade','click',async()=>{upgradePlan=await operation('repository.upgrade.preview');$('#maintenance-plan').textContent=JSON.stringify(upgradePlan,null,2);$('#apply-upgrade').disabled=!upgradePlan.changed;});on('#apply-upgrade','click',async()=>{if(await ask('套用工具升級','不覆寫自行編寫的規格與測試；測試基線需要重新確認。','套用差異')){await operation('repository.upgrade.apply',{planDigest:upgradePlan.digest});upgradePlan=null;renderMaintenance();}});
on('#preview-legacy','click',async()=>{const value=$('#legacy-selection').value.trim(),selection=value?{requirementIds:value.split(',').map(x=>x.trim())}:{};legacyPlan={selection,preview:await operation('legacy.preview',selection)};$('#maintenance-plan').textContent=JSON.stringify(legacyPlan.preview,null,2);$('#apply-legacy').disabled=false;});on('#apply-legacy','click',async()=>{if(await ask('匯入舊資料','舊測試封存為文字，需要重新接線與確認。來源 DB 保持不變。','匯入資料')){await operation('legacy.import',{...legacyPlan.selection,planDigest:legacyPlan.preview.digest,acknowledgeUnverified:true});legacyPlan=null;renderMaintenance();}});
window.addEventListener('beforeunload',event=>{if(dirty()){event.preventDefault();event.returnValue='';}});
window.addEventListener('popstate',()=>safe(async()=>{if(!await guardDraft()){history.forward();return;}state.editor=null;state.projectEditor=null;await readRoute();}));
await safe(async()=>{state.capabilities=await api('/capabilities');$('#worker-status').textContent=state.capabilities.executionEnabled?'受信任執行已啟用':'執行未啟用';$('#worker-status').classList.toggle('warning',!state.capabilities.executionEnabled);await readRoute();note('所有操作都綁定所選 Spec Repo；產品版本與報告各自明確提交。');});
