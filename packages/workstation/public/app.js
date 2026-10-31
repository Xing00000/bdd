const $ = selector => document.querySelector(selector);
const all = selector => [...document.querySelectorAll(selector)];
const API = '/repository-api/v1';
const stages = [
  ['GHERKIN', '需求', '定義產品應該做到的事', '由你確認需求意圖。儲存與版本紀錄由系統處理。'],
  ['SD', '設計', '確認系統設計', '審閱介面、資料變更與驗收方式，確認後直接繼續。'],
  ['TESTS', '測試', '確認真正的操作與斷言', '系統會自動檢查測試接線；缺少套件時，一次確認安裝並繼續。'],
  ['IMPLEMENTATION', '開發', '讓產品符合已確認的測試', '修改產品後按儲存，再開始驗收。不需要先遠端同步。'],
  ['VERIFICATION', '驗收', '用實際執行證明結果', '系統自動準備固定版本、執行並保存報告；失敗可修正後再驗收。']
];
const labels = { 'repository.setup':'完成設定', 'repository.save':'儲存', 'repository.sync':'遠端同步', 'workflow.create':'建立需求功能', 'workflow.review':'確認並繼續', 'workflow.verify':'執行驗收' };
const state = { repositories:[], repositoryId:null, detail:null, view:'features', stage:'GHERKIN', featureKey:null, projectId:null, editor:null, product:null, busy:false, loading:false, epoch:0, sourceRequest:0, productRequest:0, reportRequest:0, formDirty:false, capabilities:null, scope:null };
function el(tag,text,cls) { const n=document.createElement(tag); if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n; }
function button(text, action, cls) { const n=el('button',text,cls);n.type='button';n.onclick=()=>safe(action);return n; }
function badge(text) { return el('span',text,`pill ${['VERIFIED','PASSED','已同步','已儲存'].includes(text)?'good':['FAILED','NOT_VERIFIED'].includes(text)?'bad':'warning'}`); }
function note(text,error=false) { $('#notice').textContent=text;$('#notice').classList.toggle('error',error); }
async function safe(fn) { try { await fn(); } catch(error) { note(error.message,true); } }
async function api(route,method='GET',body) {
  const r=await fetch(API+route,{method,headers:{'content-type':'application/json','x-workbench-request':'1'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const value=await r.json();if(!r.ok)throw Object.assign(new Error(value.message??'操作失敗'),value);return value;
}
const feature=()=>state.detail?.spec?.features.find(f=>f.key===state.featureKey);
const dirty=()=>state.formDirty||Boolean(state.editor&&$('#source-editor').value!==state.editor.content||state.product&&$('#project-editor').value!==state.product.content);
function block() {
  const value=state.busy||state.loading;
  $('#content').inert=value;$('#content').setAttribute('aria-busy',String(value));$('#repository-view').setAttribute('aria-busy',String(value));
  $('#sidebar').inert=value;$('#source-editor').readOnly=value;$('#project-editor').readOnly=value;
  $('#sync').disabled=value||dirty()||!state.detail?.preferences?.configured;
}
let dialogResolve;
function closeDialog(value=false) { $('#form-dialog').close();if(dialogResolve){const resolve=dialogResolve;dialogResolve=null;resolve(value);} }
function field(label,name,value='',options={}) {
  const wrapper=el('label',label),n=document.createElement(options.rows?'textarea':'input');n.name=name;n.value=value;n.required=options.required!==false;n.setAttribute('aria-label',label);if(options.rows)n.rows=options.rows;if(options.placeholder)n.placeholder=options.placeholder;wrapper.append(n);return wrapper;
}
function dialog(title,description,fields,submit,action) {
  $('#dialog-title').textContent=title;$('#dialog-description').textContent=description;$('#dialog-fields').replaceChildren(...fields);$('#dialog-submit').textContent=submit;$('#dialog-error').textContent='';$('#dialog-submit').disabled=false;
  $('#dialog-form').onsubmit=async event=>{event.preventDefault();$('#dialog-submit').disabled=true;try{await action(new FormData(event.target));closeDialog(true);}catch(error){$('#dialog-error').textContent=error.message;}finally{$('#dialog-submit').disabled=false;}};$('#form-dialog').showModal();
}
function ask(title,text,submit) { return new Promise(resolve=>{dialogResolve=resolve;dialog(title,text,[],submit,async()=>{});}); }
async function guard() { if(!dirty())return true;if(!await ask('有尚未儲存的編輯','離開會捨棄畫面中的草稿；已儲存版本不受影響。','捨棄草稿並離開'))return false;state.editor=null;state.product=null;state.formDirty=false;return true; }
async function navigate(patch,{protect=true,replace=false}={}) {
  if(state.busy)return;if(protect&&!await guard())return;
  const old=state.repositoryId;Object.assign(state,patch);state.editor=null;state.product=null;state.scope=null;state.formDirty=false;state.sourceRequest++;state.productRequest++;state.reportRequest++;
  if(old!==state.repositoryId){$('#report-view').hidden=true;$('#report-view').replaceChildren();}
  const url=new URL(location.href);url.pathname='/';url.search='';
  if(state.repositoryId){url.searchParams.set('repo',state.repositoryId);url.searchParams.set('view',state.view);if(state.featureKey)url.searchParams.set('feature',state.featureKey);url.searchParams.set('stage',state.stage);if(state.projectId)url.searchParams.set('project',state.projectId);}
  history[replace?'replaceState':'pushState']({},'',url);$('#sidebar').classList.remove('open');$('#menu-toggle').setAttribute('aria-expanded','false');await refresh();
}
async function route() { const q=new URLSearchParams(location.search);await navigate({repositoryId:q.get('repo'),view:q.get('view')??'features',featureKey:q.get('feature'),projectId:q.get('project'),stage:q.get('stage')??'GHERKIN'},{protect:false,replace:true}); }
async function refresh() {
  const epoch=++state.epoch;state.loading=true;block();
  try {
    const repositories=await api('/spec-repositories');if(epoch!==state.epoch)return;state.repositories=repositories;
    const detail=state.repositoryId?await api(`/spec-repositories/${state.repositoryId}`):null;if(epoch!==state.epoch)return;state.detail=detail;
    renderNavigation();$('#home-view').hidden=Boolean(detail);$('#repository-view').hidden=!detail;
    if(!detail){renderHome();return;}
    if(!['features','projects','reports','settings'].includes(state.view))state.view='features';if(!detail.preferences?.configured)state.view='settings';
    $('#repository-title').textContent=detail.title;$('#repository-origin').textContent=detail.remoteUrl;$('#breadcrumbs').textContent=`工作台 / ${detail.title}`;
    $('#repository-error').hidden=!detail.specError&&!detail.moduleError;$('#repository-error').textContent=[detail.specError,detail.moduleError].filter(Boolean).map(x=>x.message).join('\n');
    const allReportsSynced=(detail.runs??[]).filter(r=>r.state==='SEALED').every(r=>r.publication?.status==='PUBLISHED');
    $('#sync-state').textContent=detail.sync?.status==='PARTIAL'?'上次同步未完成；本機內容已保留，可重試。':detail.sync?.head===detail.state?.head&&allReportsSynced?'已同步至遠端':'已儲存內容留在本機，尚未同步';
    all('[data-view]').forEach(n=>{n.classList.toggle('active',n.dataset.view===state.view);n.setAttribute('aria-current',n.dataset.view===state.view?'page':'false');});
    all('.view').forEach(n=>n.hidden=n.id!==`${state.view}-view`);
    if(state.view==='features')await renderWorkflow(epoch);
    if(state.view==='projects')await renderProjects(epoch);
    if(state.view==='reports')renderReports();
    if(state.view==='settings')renderSettings();
  } finally {if(epoch===state.epoch){state.loading=false;block();}}
}
async function executeJob(name,input, {refreshAfter=true}={}) {
  if(state.busy)throw new Error('目前流程正在執行，請勿重複送出。');
  const repositoryId=state.repositoryId, d=state.detail;
  const expected=typeof d?.state==='object'?{head:d.state.head,branch:d.state.branch,fingerprint:d.state.fingerprint}:{head:null};
  state.busy=true;block();$('#job-progress').hidden=false;$('#job-title').textContent=labels[name]??'處理中';
  $('#job-step').textContent=name==='workflow.verify'?'自動準備版本 → 執行測試 → 儲存報告':name==='repository.sync'?'同步已儲存產品 → 規格 → 報告；不會覆寫衝突內容':name==='workflow.review'?'檢查必要環境與內容，再推進下一步':'系統正在處理，不需要操作版本工具。';
  let result;
  try {
    result=await api('/operations','POST',{schemaVersion:1,operationId:`OP-${crypto.randomUUID()}`,repositoryId,operation:name,input,expected});state.jobId=result.id;
    while(['QUEUED','RUNNING','CANCELLING'].includes(result.status)){await new Promise(r=>setTimeout(r,350));result=await api(`/operations/${result.id}`);}
    if(result.status!=='SUCCEEDED')throw Object.assign(new Error(result.error?.message??'流程未完成，內容已保留。'),result.error??{});
    note(name==='repository.sync'?'已同步至遠端。':name==='workflow.verify'?'驗收完成，報告已自動儲存。':'已儲存至本機。');return result.result;
  } finally {
    state.busy=false;state.jobId=null;$('#job-progress').hidden=true;
    if(refreshAfter&&repositoryId===state.repositoryId)await refresh();block();
    $('#notice').dataset.operation=name;$('#notice').dataset.outcome=result?.status??'FAILED';$('#notice').dataset.jobId=result?.id??'';
  }
}
async function flow(name,input) {
  try { return await executeJob(name,input); }
  catch(error) {
    if(error.code!=='INSTALL_REQUIRED')throw error;
    const plan=error.details.install;
    const names=Object.entries(plan.packages).map(([name,v])=>`${name} ${v}`).join('\n');
    const approved=await ask('安裝必要套件並繼續',`這個步驟需要以下套件與瀏覽器：\n${names}\n瀏覽器：${plan.browsers.join('、')}\n\n不執行套件安裝腳本，不要求系統管理員權限。完成後自動接續，不必另外按安裝或測試檢查。`,'安裝並繼續');
    if(!approved){note('已取消安裝；已儲存內容保留，流程尚未推進。');return null;}
    return executeJob(name,{...input,installConsent:plan.digest});
  }
}
function renderNavigation() {
  $('#repository-nav').replaceChildren();for(const r of state.repositories){const n=button('',()=>navigate({repositoryId:r.id,featureKey:null,projectId:null,view:'features',stage:'GHERKIN'}),'repo-nav');n.setAttribute('aria-label',`開啟規格庫 ${r.title}`);n.append(el('strong',r.title),el('small',r.remoteUrl));n.classList.toggle('active',r.id===state.repositoryId);$('#repository-nav').append(n);if(r.id===state.repositoryId)for(const p of state.detail?.modules??[]){const child=button(`↳ ${p.id}`,()=>navigate({view:'projects',projectId:p.id}),'project-nav');child.setAttribute('aria-label',`開啟產品 ${p.id}`);$('#repository-nav').append(child);}}
}
function renderHome() {
  $('#breadcrumbs').textContent='工作台';$('#repository-cards').replaceChildren();$('#empty-state').hidden=state.repositories.length>0;
  for(const r of state.repositories){const c=el('article',undefined,'card');c.append(el('p','SPEC REPOSITORY','eyebrow'),el('h2',r.title),el('p',r.remoteUrl,'mono muted'),button('開始工作',()=>navigate({repositoryId:r.id,view:'features',featureKey:null,projectId:null,stage:'GHERKIN'}),'primary'));$('#repository-cards').append(c);}
}
function productFields(products=[]) {
  const container=el('div');container.id='bind-products';
  const add=(p={})=>{const row=el('div',undefined,'form-grid product-row');row.append(field('產品名稱','productId',p.id??'',{required:false,placeholder:'product'}),field('產品來源網址','productUrl',p.url??'',{required:false}));container.append(row);};
  products.forEach(add);if(!products.length)add();container.append(button('＋ 增加產品來源',()=>add()));return container;
}
function formProducts(form) { const ids=form.getAll('productId'),urls=form.getAll('productUrl');return ids.map((id,i)=>({id:id.trim(),url:urls[i].trim()})).filter(p=>p.id||p.url); }
async function bindRepository() {
  if(!await guard())return;const fields=[field('規格庫名稱','title'),field('規格庫網址','remoteUrl','',{placeholder:'git@github.com:Xing00000/bdd-spec.git'}),field('確認者名稱','reviewer',localStorage.getItem('bdd-reviewer')??''),productFields(),field('產品網址','baseUrl','',{required:false,placeholder:'http://127.0.0.1:4311'}),field('啟動程式','program','node',{required:false}),field('啟動參數（每行一個）','args','',{required:false,rows:3})];
  let registered;
  dialog('一次設定，開始工作','填寫你知道的產品來源與啟動方式。系統會自動取得規格庫、建立結構與產品連結；需要的套件會在流程中一次詢問。',fields,'完成設定',async form=>{
    const projects=formProducts(form),baseUrl=form.get('baseUrl').trim();
    if(!registered)registered=await api('/spec-repositories','POST',{title:form.get('title'),remoteUrl:form.get('remoteUrl')});
    state.repositoryId=registered.id;state.detail={...registered,state:'NOT_CLONED'};
    const input={reviewer:form.get('reviewer'),projects};
    if(baseUrl&&projects.length)input.execution={projectId:projects[0].id,baseUrl,healthUrl:new URL('/health',baseUrl).href,command:[form.get('program'),...form.get('args').split('\n').map(x=>x.trim()).filter(Boolean)]};
    await executeJob('repository.setup',input,{refreshAfter:false});localStorage.setItem('bdd-reviewer',input.reviewer);await navigate({repositoryId:registered.id,view:'features',stage:'GHERKIN',featureKey:null,projectId:null},{protect:false});
  });
}
function renderSettings() {
  const d=state.detail,c=d.spec?.config;$('#settings-reviewer').value=d.preferences?.reviewer??localStorage.getItem('bdd-reviewer')??'';$('#settings-remote').textContent=d.remoteUrl;$('#settings-products').replaceChildren();
  for(const p of d.modules??[])addSettingsProduct(p);if(!d.modules?.length)addSettingsProduct();
  updateServices();$('#settings-service').value=c?.execution.service?.projectId??'';$('#settings-url').value=c?.execution.environment?.WB_TARGET_BASE_URL??'';$('#settings-health').value=c?.execution.service?.healthUrl??'';$('#settings-program').value=c?.execution.service?.command[0]??'node';$('#settings-args').value=c?.execution.service?.command.slice(1).join('\n')??'';
  $('#operation-list').replaceChildren();for(const op of d.operations??[]){const item=el('details');item.append(el('summary',`${labels[op.request.operation]??'系統操作'} · ${op.status}`),el('pre',JSON.stringify({id:op.id,result:op.result,error:op.error},null,2)));$('#operation-list').append(item);}
}
function addSettingsProduct(p={}) { const row=el('div',undefined,'form-grid product-row');row.append(field('產品名稱','productId',p.id??'',{required:false}),field('產品來源網址','productUrl',p.url??'',{required:false}));if(p.id)row.querySelector('[name=productId]').readOnly=true;$('#settings-products').append(row);row.oninput=updateServices; }
function updateServices() { const select=$('#settings-service'),previous=select.value;select.replaceChildren(new Option('暫不設定',''));all('#settings-products [name=productId]').forEach(n=>{if(n.value.trim())select.append(new Option(n.value.trim(),n.value.trim()));});select.value=previous; }
async function saveSettings() {
  const form=new FormData($('#settings-form')),input={reviewer:$('#settings-reviewer').value,projects:formProducts(form)};
  if($('#settings-service').value){const baseUrl=$('#settings-url').value;input.execution={projectId:$('#settings-service').value,baseUrl,healthUrl:$('#settings-health').value||new URL('/health',baseUrl).href,command:[$('#settings-program').value,...$('#settings-args').value.split('\n').map(x=>x.trim()).filter(Boolean)]};}
  await executeJob('repository.setup',input,{refreshAfter:false});state.formDirty=false;localStorage.setItem('bdd-reviewer',input.reviewer);await refresh();
}
async function createFeature() {
  const d=state.detail;
  dialog('建立需求功能','預設使用此規格庫的產品與 Chromium；需要不同範圍時再調整。',[field('需求 ID','requirementId','REQ-001'),field('功能 ID','featureId','',{placeholder:'login'}),field('功能標題','title')],'建立功能',async form=>{
    const result=await executeJob('workflow.create',{...Object.fromEntries(form),projectIds:(d.modules??[]).map(p=>p.id)},{refreshAfter:false});await navigate({view:'features',featureKey:result.key,stage:'GHERKIN'},{protect:false});
  });
}
async function renderWorkflow(epoch) {
  const d=state.detail,features=d.spec?.features??[];$('#new-feature').disabled=!d.preferences?.configured;
  if(!features.some(f=>f.key===state.featureKey))state.featureKey=features[0]?.key??null;
  $('#feature-select').replaceChildren(...features.map(f=>new Option(`${f.key} · ${f.title}`,f.key)));$('#feature-select').value=state.featureKey??'';
  const f=feature();$('#workflow').hidden=!f;$('#feature-empty').hidden=Boolean(f);if(!f)return;
  if(!stages.some(x=>x[0]===state.stage))state.stage='GHERKIN';$('#stage-nav').replaceChildren();
  stages.forEach(([key,title],i)=>{const n=button('',()=>navigate({stage:key}));n.setAttribute('aria-label',`${i+1} ${title}`);n.setAttribute('aria-current',key===state.stage?'step':'false');const done=i<3?f.review.confirmed[['gherkin','sd','tests'][i]]:i===4&&f.verification.status==='VERIFIED';n.classList.toggle('complete',Boolean(done));n.append(el('span',done?'✓':String(i+1),'step-number'),el('span',title));$('#stage-nav').append(n);});
  const phase=stages.find(x=>x[0]===state.stage);$('#phase-title').textContent=phase[2];$('#phase-description').textContent=phase[3];$('#feature-status').replaceWith(Object.assign(badge(f.verification.status==='VERIFIED'?'VERIFIED':f.review.stage),{id:'feature-status'}));
  const editing=['GHERKIN','SD','TESTS'].includes(state.stage);$('#source-panel').hidden=!editing;$('#implementation-panel').hidden=state.stage!=='IMPLEMENTATION';$('#verification-panel').hidden=state.stage!=='VERIFICATION';
  const sources=state.stage==='GHERKIN'?[`spec/${f.key}/${f.id}.feature`]:state.stage==='SD'?[`spec/${f.key}/${f.id}.sd.md`]:[`tests/${f.key}/${f.id}.steps.ts`,`tests/${f.key}/${f.id}.hooks.ts`];
  const selected=sources.includes(state.editor?.path)?state.editor.path:sources[0];$('#source-select').replaceChildren(...sources.map(x=>new Option(x.split('/').at(-1),x)));$('#source-select').value=selected;
  $('#implementation-projects').replaceChildren();for(const p of (d.modules??[]).filter(p=>f.projectIds.includes(p.id)))$('#implementation-projects').append(button(`編輯 ${p.id}`,()=>navigate({view:'projects',projectId:p.id})));
  if(!state.formDirty){$('#case-ids').value=f.caseIds.join('\n');all('[name=profile]').forEach(n=>n.checked=f.profiles.includes(n.value));$('#feature-projects').replaceChildren(el('legend','關聯產品'));for(const p of d.modules??[]){const l=el('label',undefined,'check'),n=document.createElement('input');n.type='checkbox';n.name='feature-project';n.value=p.id;n.checked=f.projectIds.includes(p.id);l.append(n,document.createTextNode(p.id));$('#feature-projects').append(l);}}
  state.scope=await api(`/spec-repositories/${d.id}/file?path=${encodeURIComponent(`spec/${f.key}/feature.yaml`)}`);if(epoch!==state.epoch)return;
  if(editing)await openSource(selected);if(epoch!==state.epoch)return;renderNext();
}
function renderNext() {
  const f=feature();if(!f)return;const stage=state.stage,blockers=[];
  if(stage!=='GHERKIN'&&!f.review.confirmed.gherkin)blockers.push('先確認需求。');
  if(['TESTS','IMPLEMENTATION','VERIFICATION'].includes(stage)&&!f.review.confirmed.sd)blockers.push('先確認設計。');
  if(['IMPLEMENTATION','VERIFICATION'].includes(stage)&&!f.review.confirmed.tests)blockers.push('先確認測試。');
  if(['TESTS','IMPLEMENTATION','VERIFICATION'].includes(stage)&&!state.capabilities.executionEnabled)blockers.push('管理者需先啟用受信任執行。');
  if(['IMPLEMENTATION','VERIFICATION'].includes(stage)&&!state.detail.spec.config.execution.service)blockers.push('請在設定中補上產品啟動方式。');
  $('#advance').textContent={GHERKIN:'確認需求並繼續',SD:'確認設計並繼續',TESTS:'確認測試並繼續',IMPLEMENTATION:'開始驗收',VERIFICATION:'再次驗收'}[stage];$('#advance').disabled=blockers.length>0;$('#advance').title=blockers.join(' ');
  $('#next-title').textContent=['IMPLEMENTATION','VERIFICATION'].includes(stage)?'準備、執行、報告，一次完成':'只確認內容，不處理版本操作';$('#next-reason').textContent=blockers.join(' ')||(['IMPLEMENTATION','VERIFICATION'].includes(stage)?'系統會使用目前已儲存的產品與規格，自動保存這次驗收證據。':'按下確認即代表你已審閱目前內容，系統會儲存並推進；不再重複彈出確認。');
  $('#check-state').textContent=stage==='TESTS'?'測試接線會自動檢查，通過才會推進。缺少依賴時只需一次安裝確認。':'';
}
async function openSource(relative) {
  if(state.editor?.path===relative&&state.editor.repositoryId===state.repositoryId&&$('#source-editor').value!==state.editor.content)return;
  const repositoryId=state.repositoryId,request=++state.sourceRequest;$('#source-editor').readOnly=true;
  const file=await api(`/spec-repositories/${repositoryId}/file?path=${encodeURIComponent(relative)}`);if(request!==state.sourceRequest||repositoryId!==state.repositoryId)return;
  state.editor={...file,repositoryId};$('#source-editor').value=file.content;$('#source-path').textContent=relative;$('#editor-state').textContent='已儲存';block();
}
async function saveSource() {
  if(!state.editor)return;const e=state.editor,content=$('#source-editor').value;
  const r=await executeJob('repository.save',{kind:'source',path:e.path,content,expectedHash:e.sha256},{refreshAfter:false});state.editor={...e,content,sha256:r.sha256};await refresh();
}
async function advance() {
  if(state.formDirty)throw new Error('請先儲存範圍設定。');
  if(state.editor&&$('#source-editor').value!==state.editor.content)await saveSource();
  const f=feature(), stage=state.stage;
  if(['IMPLEMENTATION','VERIFICATION'].includes(stage)){
    const result=await flow('workflow.verify',{requirementId:f.requirementId,featureId:f.id});if(result)await navigate({view:'reports',stage:'VERIFICATION'},{protect:false});return;
  }
  const name={GHERKIN:'gherkin',SD:'sd',TESTS:'tests'}[stage];
  const result=await flow('workflow.review',{requirementId:f.requirementId,featureId:f.id,stage:name,expectedDigest:f.review.hashes[name]});
  if(result)await navigate({stage:result.nextStage},{protect:false});
}
async function renderProjects(epoch) {
  const d=state.detail;$('#project-cards').replaceChildren();for(const p of d.modules??[]){const c=el('article',undefined,'card');c.append(el('h3',p.id),el('p',p.url,'mono muted'),button('編輯產品',()=>navigate({projectId:p.id}),'primary'));$('#project-cards').append(c);}
  if(!d.modules?.length)$('#project-cards').append(el('p','此規格庫尚未設定產品來源。','muted'));
  const p=d.modules?.find(x=>x.id===state.projectId);$('#project-editor-panel').hidden=!p;if(!p)return;
  $('#project-title').textContent=p.id;$('#product-state').textContent=p.dirty?'有本機變更':'已儲存';
  const list=await api(`/spec-repositories/${d.id}/projects/${p.id}/files`);if(epoch!==state.epoch)return;
  const previous=state.product?.projectId===p.id?state.product.path:null;$('#project-file-select').replaceChildren(...list.files.map(x=>new Option(x,x)));if(previous&&list.files.includes(previous))$('#project-file-select').value=previous;if(list.files.length)await openProduct($('#project-file-select').value);
}
async function openProduct(relative) {
  const repositoryId=state.repositoryId,projectId=state.projectId,request=++state.productRequest;$('#project-editor').readOnly=true;
  const file=await api(`/spec-repositories/${repositoryId}/projects/${projectId}/file?path=${encodeURIComponent(relative)}`);if(request!==state.productRequest||repositoryId!==state.repositoryId||projectId!==state.projectId)return;
  state.product={...file,repositoryId};$('#project-editor').value=file.content;$('#project-file-path').textContent=relative;block();
}
async function saveProduct() { const e=state.product;if(!e)return;const content=$('#project-editor').value;const result=await executeJob('repository.save',{kind:'project',projectId:e.projectId,path:e.path,content,expectedHash:e.sha256},{refreshAfter:false});state.product={...e,content,sha256:result.sha256};await refresh(); }
function artifact(runId,file,key){return `${API}/spec-repositories/${state.repositoryId}/runs/${runId}/artifact?path=${encodeURIComponent(file)}${key?'&reportKey='+encodeURIComponent(key):''}`;}
function renderReports() {
  $('#run-list').replaceChildren();const d=state.detail;
  if(!d.runs?.length&&!d.reports?.length)$('#run-list').append(el('p','尚無驗收紀錄。完成內容確認後，按「開始驗收」即可。','empty-state'));
  for(const r of d.runs??[]){const m=r.result,c=el('article',undefined,'card');c.dataset.runId=r.id;c.append(el('h3',`${m.requirementId} / ${m.featureId}`),badge(m.testOutcome??r.state),document.createTextNode(' '),badge(m.verification??'NOT_VERIFIED'),el('p',r.publication?.status==='PUBLISHED'?'已同步至遠端':'報告已儲存於本機，遠端同步時一併分享。','muted'));
    if(r.state==='SEALED')c.append(button('檢視證據',()=>showReport(r.id)));else c.append(el('p','這次執行未完成，原紀錄已保留。回到功能再次驗收可建立新結果。','muted'));$('#run-list').append(c);}
  for(const r of d.reports??[]){if(d.runs?.some(x=>x.id===r.runId))continue;const c=el('article',undefined,'card');c.append(el('h3',r.key),badge(r.invalidReason??r.manifest.verification));if(!r.invalidReason)c.append(button('檢視證據',()=>showReport(r.runId,r.key)));$('#run-list').append(c);}
}
async function showReport(runId,key) {
  const repositoryId=state.repositoryId,token=++state.reportRequest,panel=$('#report-view');panel.hidden=false;panel.setAttribute('aria-busy','true');delete panel.dataset.runId;panel.replaceChildren(el('p','正在讀取這次驗收的證據…'));
  try{const r=await fetch(artifact(runId,'manifest.json',key)),m=await r.json();if(!r.ok)throw new Error(m.message);if(token!==state.reportRequest||repositoryId!==state.repositoryId)return;
    panel.replaceChildren(el('h2',`${m.requirementId} / ${m.featureId}`),badge(m.testOutcome),document.createTextNode(' '),badge(m.verification),el('p',runId,'mono muted'));
    if(m.failure)panel.append(el('p',m.failure.message,'error'));const table=el('table',undefined,'report-table');const head=el('tr');['案例','瀏覽器','結果','斷言'].forEach(x=>head.append(el('th',x)));table.append(head);for(const c of m.cases??[]){const row=el('tr');[c.caseId,c.profile,c.status,String(c.assertions)].forEach(x=>row.append(el('td',x)));table.append(row);}panel.append(table);
    const gallery=el('div',undefined,'gallery');for(const a of m.artifacts.filter(x=>x.path.startsWith('screenshots/'))){const fig=el('figure'),img=document.createElement('img');img.src=artifact(runId,a.path,key);img.alt=a.path;img.loading='lazy';fig.append(img,el('figcaption',a.path));gallery.append(fig);}panel.append(gallery);
    const details=el('details');details.append(el('summary','技術診斷與版本來源'),el('pre',JSON.stringify(m,null,2)));panel.append(details);panel.dataset.runId=runId;
  }finally{if(token===state.reportRequest&&repositoryId===state.repositoryId)panel.setAttribute('aria-busy','false');}
}
function on(selector,event,fn) { $(selector).addEventListener(event,e=>{if(event==='submit')e.preventDefault();safe(()=>fn(e));}); }
for(const s of ['#bind-home','#bind-empty','#bind-sidebar'])on(s,'click',bindRepository);
all('[data-home]').forEach(n=>n.onclick=e=>{e.preventDefault();safe(()=>navigate({repositoryId:null,featureKey:null,projectId:null}));});all('[data-view]').forEach(n=>n.onclick=()=>safe(()=>navigate({view:n.dataset.view})));
on('#menu-toggle','click',()=>{$('#menu-toggle').setAttribute('aria-expanded',String($('#sidebar').classList.toggle('open')));});
on('#close-dialog','click',()=>closeDialog());on('#cancel-dialog','click',()=>closeDialog());
$('#form-dialog').addEventListener('cancel',e=>{e.preventDefault();closeDialog();});
on('#cancel-job','click',()=>state.jobId&&api(`/operations/${state.jobId}/cancel`,'POST',{}));
on('#sync','click',()=>{if(dirty())throw new Error('請先儲存畫面中的草稿，遠端同步只處理已儲存內容。');return executeJob('repository.sync',{});});
on('#new-feature','click',createFeature);on('#feature-select','change',()=>navigate({featureKey:$('#feature-select').value,stage:'GHERKIN'}));on('#save-source','click',saveSource);on('#advance','click',advance);
on('#source-select','change',async()=>{const value=$('#source-select').value;if(await guard())await openSource(value);});
on('#source-editor','input',()=>{$('#editor-state').textContent=dirty()?'尚未儲存':'已儲存';block();});on('#project-editor','input',()=>{$('#product-state').textContent=dirty()?'尚未儲存':'已儲存';block();});
on('#project-file-select','change',async()=>{const value=$('#project-file-select').value;if(await guard())await openProduct(value);});on('#save-project','click',saveProduct);on('#project-settings','click',()=>navigate({view:'settings'}));
on('#settings-add-product','click',()=>{addSettingsProduct();state.formDirty=true;});on('#settings-form','input',()=>{state.formDirty=true;block();});on('#settings-form','submit',saveSettings);
on('#scope-form','input',()=>{state.formDirty=true;block();});on('#scope-form','submit',async()=>{const f=feature();await executeJob('repository.save',{kind:'scope',requirementId:f.requirementId,featureId:f.id,expectedHash:state.scope.sha256,projectIds:all('[name=feature-project]:checked').map(x=>x.value),profiles:all('[name=profile]:checked').map(x=>x.value),caseIds:$('#case-ids').value.split('\n').map(x=>x.trim()).filter(Boolean)},{refreshAfter:false});state.formDirty=false;await refresh();});
window.addEventListener('beforeunload',e=>{if(dirty()){e.preventDefault();e.returnValue='';}});window.addEventListener('popstate',()=>safe(async()=>{if(!await guard()){history.forward();return;}await route();}));
await safe(async()=>{state.capabilities=await api('/capabilities');$('#worker-status').textContent=state.capabilities.executionEnabled?'可執行驗收':'主機尚未啟用執行';await route();});
