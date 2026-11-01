import { developmentView } from './development.js';
const $ = selector => document.querySelector(selector);
const all = selector => [...document.querySelectorAll(selector)];
const API = '/repository-api/v1';
const stages = [
  ['GHERKIN','需求','需求'],['SD','設計','設計'],['TESTS','測試','測試'],['IMPLEMENTATION','開發','開發'],['VERIFICATION','驗收','驗收']
];
const labels = { 'repository.acquire':'載入規格與歷史', 'repository.location':'套用本地目錄', 'regression.start':'整庫回歸', 'repository.setup':'儲存設定', 'repository.prepare':'取得產品原始碼', 'repository.save':'儲存', 'repository.sync':'遠端同步', 'workflow.create':'建立需求功能', 'workflow.requirement.save':'儲存需求', 'workflow.review':'確認並繼續', 'workflow.develop':'開發', 'workflow.feedback':'問題回報', 'workflow.verify':'執行驗收' };
const state = { repositories:[], repositoryId:null, detail:null, view:'features', stage:'GHERKIN', featureKey:null, projectId:null, editor:null, composer:null, composerRequest:0, transient:false, product:null, busy:false, loading:false, epoch:0, sourceRequest:0, productRequest:0, reportRequest:0, formDirty:false, capabilities:null, scope:null };
function el(tag,text,cls) { const n=document.createElement(tag); if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n; }
function button(text, action, cls) { const n=el('button',text,cls);n.type='button';n.onclick=()=>safe(action);return n; }
function badge(text) { return el('span',text,`pill ${['VERIFIED','PASSED','已同步','已儲存'].includes(text)?'good':['FAILED','NOT_VERIFIED'].includes(text)?'bad':'warning'}`); }
function note(text,error=false) { $('#notice').textContent=text;$('#notice').classList.toggle('error',error); }
function guessName(url) {
  const last=String(url??'').trim().replace(/\/?$/, '').split(/[/:]/).at(-1)?.replace(/\.git$/i,'')??'';
  return last.toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-|-$/g,'').slice(0,64);
}
function detailGroup(title,children,open=false,cls='') {
  const box=el('details',undefined,cls);box.open=open;box.append(el('summary',title),...children);return box;
}

async function safe(fn) { try { await fn(); } catch(error) { note(error.message,true); } }
async function api(route,method='GET',body) {
  const r=await fetch(API+route,{method,headers:{'content-type':'application/json','x-workbench-request':'1'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const value=await r.json();if(!r.ok)throw Object.assign(new Error(value.message??'操作失敗'),value);return value;
}
const feature=()=>state.detail?.spec?.features.find(f=>f.key===state.featureKey);
const composerInput=()=>({description:$('#requirement-description').value,gherkin:$('#requirement-gherkin').value});
const composerDirty=()=>Boolean(state.composer && (composerInput().description!==state.composer.description||composerInput().gherkin!==state.composer.gherkin));
const dirty=()=>state.formDirty||composerDirty()||Boolean(state.editor&&$('#source-editor').value!==state.editor.content||state.product&&$('#project-editor').value!==state.product.content);
function block() {
  const value=state.busy||state.loading||state.transient;
  $('#content').inert=value;$('#content').setAttribute('aria-busy',String(value));$('#repository-view').setAttribute('aria-busy',String(value));
  $('#sidebar').inert=value;$('#source-editor').readOnly=value;$('#project-editor').readOnly=value;$('#requirement-description').readOnly=value;$('#requirement-gherkin').readOnly=value;$('#generate-gherkin').disabled=value||!$('#requirement-description').value.trim();
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
async function guard() { if(!dirty())return true;if(!await ask('有尚未儲存的編輯','離開會捨棄畫面中的草稿；已存入 SQLite 的內容不受影響。','捨棄草稿並離開'))return false;state.editor=null;state.composer=null;state.composerRequest++;state.product=null;state.formDirty=false;return true; }
async function navigate(patch,{protect=true,replace=false}={}) {
  if(state.busy||state.transient)return;if(protect&&!await guard())return;
  if ((Object.hasOwn(patch,'repositoryId')&&patch.repositoryId!==state.repositoryId)
    ||(Object.hasOwn(patch,'featureKey')&&patch.featureKey!==state.featureKey)) {
    note('');
  }
  development.leave();
  Object.assign(state,patch);state.editor=null;state.composer=null;state.composerRequest++;state.product=null;state.scope=null;state.formDirty=false;state.sourceRequest++;state.productRequest++;state.reportRequest++;
  for(const panel of [$('#report-view'),$('#feature-report-view')]){panel.hidden=true;panel.replaceChildren();}
  $('#feature-report-list').replaceChildren();$('#feature-report-scope').textContent='';
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
    if(!detail){clearTimeout(terminalTimer);terminalSession=null;$('#operation-terminal-details').hidden=true;renderHome();return;}
    if(!['features','projects','reports','settings','versions'].includes(state.view))state.view='features';if(!detail.preferences?.configured && state.view!=='versions')state.view='settings';
    $('#repository-title').textContent=detail.title;$('#breadcrumbs').textContent=`工作台 / ${detail.title}`;
    $('#repository-error').hidden=!detail.specError&&!detail.moduleError;$('#repository-error').textContent=[detail.specError,detail.moduleError].filter(Boolean).map(x=>x.message).join('\n');
    const allReportsSynced=(detail.runs??[]).filter(r=>r.state==='SEALED').every(r=>r.publication?.status==='PUBLISHED');
    $('#sync-state').textContent=detail.sync?.status==='PARTIAL'?'上次同步未完成；本機內容已保留，可重試。':detail.sync?.sourceRevision===detail.authoring?.revision&&allReportsSynced?'已同步至遠端':'未同步';
    all('[data-view]').forEach(n=>{n.classList.toggle('active',n.dataset.view===state.view);n.setAttribute('aria-current',n.dataset.view===state.view?'page':'false');});
    all('.view').forEach(n=>n.hidden=n.id!==`${state.view}-view`);
    if(state.view==='features')await renderWorkflow(epoch);
    if(state.view==='projects')await renderProjects(epoch);
    if(state.view==='reports')renderReports();
    if(state.view==='settings')renderSettings();
    renderBinding();
    await selectOperation(detail,epoch);
    restoreRegression(detail);
    if(state.view==='versions')await renderVersions(epoch);
  } finally {if(epoch===state.epoch){state.loading=false;block();}}
}
const activeOperation = status => ['QUEUED','RUNNING','CANCELLING'].includes(status);
let actionVersion=0;
const beginAction=()=>++actionVersion;
const cliOperations = new Set(['repository.acquire','repository.location','repository.prepare','repository.sync','repository.history.more','workflow.review','workflow.verify','workflow.develop','regression.start','repository.dependencies.install','repository.browsers.install','spec.tests.check']);
let terminalSession = null, terminalTimer;
function showOperation(op) {
  if (!op || op.request?.repositoryId !== state.repositoryId) return;
  const details=$('#operation-terminal-details');details.hidden=false;details.dataset.operationId=op.id;
  if (terminalSession?.id === op.id) return;
  clearTimeout(terminalTimer);
  const session = terminalSession = {id:op.id, repositoryId:state.repositoryId, offset:0};
  const text=$('#operation-terminal-text');
  details.hidden=false;details.dataset.operationId=op.id;text.textContent='';
  text.hidden=false;
  if(op.request.operation!=='workflow.develop')$('#development-terminal').hidden=true;
  async function poll() {
    if (terminalSession!==session || session.repositoryId!==state.repositoryId) return;
    try {
      const result=await api(`/operations/${session.id}/terminal?offset=${session.offset}`);
      if (terminalSession!==session || session.repositoryId!==state.repositoryId) return;
      text.append(document.createTextNode(result.output));session.offset=result.nextOffset;
      const outcome=result.result?.testOutcome ?? result.result?.outcome;
      $('#operation-terminal-status').textContent=[result.status,outcome,result.latestExit && `${activeOperation(result.status)?'上一次程序 ':''}exit ${result.latestExit.exitCode} · signal ${result.latestExit.signal ?? 'none'}`,result.error?.message].filter(Boolean).join(' · ');
      if(activeOperation(result.status)||result.hasMore)terminalTimer=setTimeout(poll,result.hasMore?0:350);
    } catch(error) { if(terminalSession===session){$('#operation-terminal-status').textContent=error.message;terminalTimer=setTimeout(poll,1000);} }
  }
  void poll();
}
async function selectOperation(detail,epoch) {
  const operations=(detail.operations??[]).filter(op=>cliOperations.has(op.request?.operation));
  const f=feature();
  const preferred=state.view==='features'&&state.stage==='IMPLEMENTATION'&&f && operations.find(op=>op.request.operation==='workflow.develop'&&`${op.request.input.requirementId}/${op.request.input.featureId}`===f.key);
  const ordered=[preferred,...operations.filter(op=>activeOperation(op.status)),...operations].filter(Boolean);
  for(const op of new Map(ordered.map(op=>[op.id,op])).values()) {
    const result=await api(`/operations/${op.id}/terminal?offset=0`);
    if(epoch!==state.epoch)return;
    if(result.hasProgress){showOperation(op);return;}
  }
  if(terminalSession?.repositoryId===state.repositoryId){$('#operation-terminal-details').hidden=false;return;}
  clearTimeout(terminalTimer);terminalSession=null;$('#operation-terminal-details').hidden=true;
}
async function executeJob(name,input, {refreshAfter=true}={}) {
  if(state.busy)throw new Error('目前流程正在執行，請勿重複送出。');
  beginAction();
  const repositoryId=state.repositoryId, d=state.detail;
  const expected=typeof d?.state==='object'?{head:d.state.head,branch:d.state.branch,fingerprint:d.state.fingerprint}:{head:null};
  state.busy=true;block();$('#job-progress').hidden=false;$('#job-title').textContent=labels[name]??'處理中';
  $('#job-step').textContent=name==='workflow.verify'?'自動準備版本 → 執行測試 → 儲存報告':name==='repository.sync'?'同步已儲存產品 → 規格 → 報告；不會覆寫衝突內容':name==='workflow.review'?'檢查必要環境與內容，再推進下一步':'處理中…';
  let result;
  try {
    result=await api('/operations','POST',{schemaVersion:1,operationId:`OP-${crypto.randomUUID()}`,repositoryId,operation:name,input,expected});state.jobId=result.id;
    let selected=false;
    while(['QUEUED','RUNNING','CANCELLING'].includes(result.status)){
      if(!selected&&cliOperations.has(name)){const terminal=await api(`/operations/${result.id}/terminal?offset=0`);if(terminal.hasProgress){showOperation({...result,request:{repositoryId,operation:name}});selected=true;}}
      await new Promise(r=>setTimeout(r,350));result=await api(`/operations/${result.id}`);
    }
    if(!selected&&cliOperations.has(name)){const terminal=await api(`/operations/${result.id}/terminal?offset=0`);if(terminal.hasProgress)showOperation({...result,request:{repositoryId,operation:name}});}
    if(result.status!=='SUCCEEDED')throw Object.assign(new Error(result.error?.message??'流程未完成，內容已保留。'),result.error??{});
    note(result.result?.testOutcome==='FAILED'||result.result?.outcome==='FAILED'?'執行完成，但測試未通過。':name==='repository.sync'?'已同步至遠端。':name==='workflow.verify'?'驗收完成，報告已自動儲存。':'已儲存。');return result.result;
  } finally {
    state.busy=false;$('#job-progress').hidden=true;
    try { if(refreshAfter&&repositoryId===state.repositoryId)await refresh(); } finally { state.jobId=null;block(); }
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
    return executeJob(name,{...input,installConsent:plan.digest,...(plan.batchId?{batchId:plan.batchId}:{})});
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
  const add=(p={})=>{
    const row=el('div',undefined,'product-repo-input');
    const url=field('產品原始碼 Git 網址','productUrl',p.url??'',{required:false,placeholder:'https://github.com/owner/product.git'});
    const idField=field('專案代號（進階，可留空）','productId',p.id??'',{required:false,placeholder:'依網址自動填入'});
    const description=el('p','貼上網址後，系統會自動建立產品代號及程式碼連結。','muted');
    url.querySelector('input').oninput=()=>{description.textContent=url.querySelector('input').value?'將使用專案代號：'+(idField.querySelector('input').value||guessName(url.querySelector('input').value)||'無法辨識，請手動填寫'):'貼上網址後，自動辨識專案代號。';};
    const advanced=detailGroup('自行指定專案代號（選填）',[idField]);
    row.append(url,description,advanced);container.append(row);
  };
  products.forEach(add);if(!products.length)add();container.append(button('＋ 新增其他產品',()=>add()));return container;
}
function formProducts(form) {
  const ids=form.getAll('productId'),urls=form.getAll('productUrl');
  return urls.map((url,i)=>({id:String(ids[i]??'').trim()||guessName(url),url:String(url).trim()})).filter(p=>p.url);
}
async function bindRepository() {
  if(!await guard())return;
  const fields=[
    field('Spec Repo Git 網址','remoteUrl','',{placeholder:'https://github.com/owner/spec.git'}),
    field('Spec Repo 本地目錄','localPath','',{required:false,placeholder:'例如 ~/projects/bdd-spec；留空使用工作台資料夾'}),
    el('p','這是執行工作台的電腦上的規格庫資料夾，不是產品 bdd 的程式目錄。空目錄會取得內容；已有相同來源的 clone 會直接使用，保留原檔。','muted'),
    field('顯示名稱（選填，自動從網址帶入）','title','',{required:false,placeholder:'不填也可以'}),
    field('需求確認者','reviewer',localStorage.getItem('bdd-reviewer')??''),
    detailGroup('有產品原始碼嗎？可以現在加入，也可以稍後設定',[productFields(),el('p','例如 https://github.com/Xing00000/bdd.git；只需貼網址。','muted')],false,'advanced-ids'),
    detailGroup('進階：產品要怎麼啟動？需要測試時才設定',[
      field('產品服務網址','baseUrl','',{required:false,placeholder:'http://127.0.0.1:4311'}),
      field('啟動程式','program','node',{required:false}),
      field('啟動參數（每行一個）','args','',{required:false,rows:3})
    ],false,'advanced-ids')
  ];
  let registered;
  dialog('連接規格庫','綁定後自動建立本地目錄，載入既有需求、設計、產品與歷史。設定與草稿存 SQLite；連線失敗仍會保留，日後可重試。',fields,'開始使用',async form=>{
    const projects=formProducts(form),baseUrl=String(form.get('baseUrl')??'').trim(),remoteUrl=String(form.get('remoteUrl')).trim();
    const title=String(form.get('title')??'').trim()||guessName(remoteUrl);
    if(!title)throw new Error('無法從網址辨識名稱，請輸入顯示名稱。');
    if(!registered)registered=await api('/spec-repositories','POST',{title,remoteUrl,localPath:String(form.get('localPath')??'').trim()});
    state.repositoryId=registered.id;state.detail={...registered,state:'NOT_CLONED'};
    const input={reviewer:form.get('reviewer'),projects};
    if(baseUrl&&projects.length)input.execution={projectId:projects[0].id,baseUrl,healthUrl:new URL('/health',baseUrl).href,command:[form.get('program'),...form.get('args').split('\n').map(x=>x.trim()).filter(Boolean)]};
    await executeJob('repository.setup',input,{refreshAfter:false});
    if(registered.connection?.operationId) {
      $('#dialog-description').textContent='設定已儲存；正在取得規格、產品及歷史。';
      const panel=$('#operation-terminal-details');$('#dialog-form').insertBefore(panel,$('#dialog-error'));
      showOperation({id:registered.connection.operationId,request:{repositoryId:registered.id,operation:'repository.acquire'}});
      let loaded;
      try {
        loaded=await api(`/operations/${registered.connection.operationId}`);
        while(['QUEUED','RUNNING','CANCELLING'].includes(loaded.status)){await new Promise(r=>setTimeout(r,350));loaded=await api(`/operations/${registered.connection.operationId}`);}
      } finally { $('#content').before(panel); }
      if(loaded.status!=='SUCCEEDED')note('綁定與設定已保存，內容尚未取得：'+(loaded.error?.message??'請重試'),true);
    }
    localStorage.setItem('bdd-reviewer',input.reviewer);await navigate({repositoryId:registered.id,view:'features',stage:'GHERKIN',featureKey:null,projectId:null},{protect:false});
  });
}
function renderSettings() {
  const d=state.detail,c=d.spec?.config;$('#settings-reviewer').value=d.preferences?.reviewer??localStorage.getItem('bdd-reviewer')??'';$('#settings-remote').textContent=d.remoteUrl;$('#settings-local-path').value=d.localPath??d.connection?.localPath??'';$('#settings-products').replaceChildren();
  for(const p of d.modules??[])addSettingsProduct(p);if(!d.modules?.length)addSettingsProduct();
  $('#settings-global-timeout').value=d.preferences?.globalTimeoutMs??c?.execution?.globalTimeoutMs??'';
  const agent=d.preferences.agent;
  for(const key of ['command','prompt','skills','maxAttempts','timeoutMs'])$('#settings-agent-'+key).value=agent[key];
  $('#settings-agent-args').value=agent.args.join('\n');
  updateServices();$('#settings-service').value=c?.execution.service?.projectId??'';$('#settings-url').value=c?.execution.environment?.WB_TARGET_BASE_URL??'';$('#settings-health').value=c?.execution.service?.healthUrl??'';$('#settings-program').value=c?.execution.service?.command[0]??'node';$('#settings-args').value=c?.execution.service?.command.slice(1).join('\n')??'';
  $('#operation-list').replaceChildren();for(const op of d.operations??[]){const item=el('details');item.append(el('summary',`${labels[op.request.operation]??'系統操作'} · ${op.status}`));if(op.error)item.append(el('p',op.error.message??'這次操作未完成，已保留內容。','muted'));const technical=detailGroup('檢視技術細節',[el('pre',JSON.stringify({id:op.id,result:op.result,error:op.error},null,2))]);item.append(technical);if(cliOperations.has(op.request.operation))item.append(button('查看執行過程',()=>showOperation(op)));$('#operation-list').append(item);}
}
function addSettingsProduct(p={}) {
  const row=el('div',undefined,'product-repo-input');const url=field('產品原始碼 Git 網址','productUrl',p.url??'',{required:false,placeholder:'https://github.com/owner/product.git'});
  const name=field('專案代號（進階，可留空）','productId',p.id??'',{required:false,placeholder:'由網址自動帶入'});
  const hint=el('p',p.id?`已連結：projects/${p.id}/`:'貼上網址就會自動辨識產品代號。','muted');
  if(p.id)name.querySelector('input').readOnly=true;
  row.append(url,hint,detailGroup('專案代號（選填）',[name]));$('#settings-products').append(row);
  row.oninput=()=>{if(!p.id)hint.textContent='將建立：projects/'+(name.querySelector('input').value||guessName(url.querySelector('input').value)||'尚未提供網址')+'/';updateServices();};
}
function updateServices() { const select=$('#settings-service'),previous=select.value;select.replaceChildren(new Option('暫不設定',''));all('#settings-products .product-repo-input').forEach(row=>{const id=row.querySelector('[name=productId]').value.trim()||guessName(row.querySelector('[name=productUrl]').value);if(id)select.append(new Option(id,id));});select.value=previous; }
async function saveSettings() {
  const localPath=$('#settings-local-path').value.trim(),expectedLocalPath=state.detail.localPath;
  const form=new FormData($('#settings-form')),input={reviewer:$('#settings-reviewer').value,projects:formProducts(form),expectedSettings:state.detail.settingsToken,agent:{...state.detail.preferences?.agent,command:$('#settings-agent-command').value.trim()||'codex',args:$('#settings-agent-args').value.split('\n').filter(Boolean),prompt:$('#settings-agent-prompt').value,skills:$('#settings-agent-skills').value,maxAttempts:Number($('#settings-agent-maxAttempts').value),timeoutMs:Number($('#settings-agent-timeoutMs').value)}};
  input.globalTimeoutMs=$('#settings-global-timeout').value===''?null:Number($('#settings-global-timeout').value);
  if($('#settings-service').value){const baseUrl=$('#settings-url').value;input.execution={projectId:$('#settings-service').value,baseUrl,healthUrl:$('#settings-health').value||new URL('/health',baseUrl).href,command:[$('#settings-program').value,...$('#settings-args').value.split('\n').map(x=>x.trim()).filter(Boolean)]};}
  await executeJob('repository.setup',input,{refreshAfter:false});localStorage.setItem('bdd-reviewer',input.reviewer);
  if(localPath!==expectedLocalPath) {
    try { await executeJob('repository.location',{localPath,expectedLocalPath},{refreshAfter:false}); }
    catch(error) { state.detail=await api(`/spec-repositories/${state.repositoryId}`);state.formDirty=true;renderBinding();note('其他設定已儲存至 SQLite；本地目錄尚未就緒：'+error.message,true);return; }
  }
  state.formDirty=false;await refresh();
}
async function createFeature() {
  await navigate({view:'features',featureKey:'__new__',stage:'GHERKIN'});
  $('#requirement-description').focus();
}
async function renderWorkflow(epoch) {
  const d=state.detail,features=d.spec?.features??[];$('#new-feature').disabled=!d.preferences?.configured;
  if(state.featureKey!=='__new__'&&!features.some(f=>f.key===state.featureKey))state.featureKey=features[0]?.key??null;
  const titleCounts=new Map();for(const item of features)titleCounts.set(item.title,(titleCounts.get(item.title)??0)+1);
  $('#feature-select').replaceChildren(...features.map(f=>new Option(titleCounts.get(f.title)>1?`${f.title} (${f.requirementId})`:f.title,f.key)));$('#feature-select').value=state.featureKey??'';
  const f=feature();$('#workflow').hidden=false;$('#feature-empty').hidden=Boolean(f);
  $('#stage-nav').hidden=!f;$('#scope-details').hidden=!f||state.stage!=='TESTS';
  if(!f){
    state.stage='GHERKIN';$('#phase-title').textContent='需求';$('#feature-status').textContent='草稿';
    $('#requirement-panel').hidden=false;$('#source-panel').hidden=true;$('#implementation-panel').hidden=true;$('#verification-panel').hidden=true;
    await openComposer(null,epoch);renderNext();return;
  }
  if(!stages.some(x=>x[0]===state.stage))state.stage='GHERKIN';$('#stage-nav').replaceChildren();
  stages.forEach(([key,title],i)=>{const n=button('',()=>navigate({stage:key}));n.setAttribute('aria-label',`${i+1} ${title}`);n.setAttribute('aria-current',key===state.stage?'step':'false');const done=i<3?f.review.confirmed[['gherkin','sd','tests'][i]]:i===4&&f.verification.status==='VERIFIED';n.classList.toggle('complete',Boolean(done));n.append(el('span',done?'✓':String(i+1),'step-number'),el('span',title));$('#stage-nav').append(n);});
  const phase=stages.find(x=>x[0]===state.stage);$('#phase-title').textContent=phase[2];$('#feature-status').replaceWith(Object.assign(badge(f.verification.status==='VERIFIED'?'VERIFIED':f.review.stage),{id:'feature-status'}));
  const editing=['SD','TESTS'].includes(state.stage);$('#requirement-panel').hidden=state.stage!=='GHERKIN';$('#source-panel').hidden=!editing;$('#implementation-panel').hidden=state.stage!=='IMPLEMENTATION';$('#verification-panel').hidden=state.stage!=='VERIFICATION';
  const sources=state.stage==='GHERKIN'?[`spec/${f.key}/${f.id}.feature`]:state.stage==='SD'?[`spec/${f.key}/${f.id}.sd.md`]:[`tests/${f.key}/${f.id}.steps.ts`,`tests/${f.key}/${f.id}.hooks.ts`];
  const selected=sources.includes(state.editor?.path)?state.editor.path:sources[0];$('#source-select').replaceChildren(...sources.map(x=>new Option(x.split('/').at(-1),x)));$('#source-select').value=selected;
  if(!state.formDirty){$('#case-ids').value=f.caseIds.join('\n');all('[name=profile]').forEach(n=>n.checked=f.profiles.includes(n.value));$('#feature-projects').replaceChildren(el('legend','關聯產品'));for(const p of d.modules??[]){const l=el('label',undefined,'check'),n=document.createElement('input');n.type='checkbox';n.name='feature-project';n.value=p.id;n.checked=f.projectIds.includes(p.id);l.append(n,document.createTextNode(p.id));$('#feature-projects').append(l);}}
  state.scope=await api(`/spec-repositories/${d.id}/file?path=${encodeURIComponent(`spec/${f.key}/feature.yaml`)}`);if(epoch!==state.epoch)return;
  if(state.stage==='GHERKIN')await openComposer(f,epoch);else if(editing)await openSource(selected);if(epoch!==state.epoch)return;if(state.stage==='VERIFICATION')await renderFeatureReports();renderNext();if(state.stage==='IMPLEMENTATION')await development.open();else development.leave();
}
function renderNext() {
  const f=feature(),stage=state.stage,advance=$('#advance');
  advance.hidden=!['GHERKIN','SD','TESTS'].includes(stage);
  (stage==='GHERKIN'?$('#requirement-buttons'):$('#source-panel .editor-toolbar')).append(advance);
  advance.textContent={GHERKIN:'確認需求並繼續',SD:'確認設計並繼續',TESTS:'確認測試並繼續'}[stage]??'';
  advance.disabled=stage==='GHERKIN'&&!$('#requirement-gherkin').value.trim();
  advance.title='';
}
async function openSource(relative) {
  if(state.editor?.path===relative&&state.editor.repositoryId===state.repositoryId&&$('#source-editor').value!==state.editor.content)return;
  const repositoryId=state.repositoryId,request=++state.sourceRequest;$('#source-editor').readOnly=true;
  const file=await api(`/spec-repositories/${repositoryId}/file?path=${encodeURIComponent(relative)}`);if(request!==state.sourceRequest||repositoryId!==state.repositoryId)return;
  state.editor={...file,repositoryId};$('#source-editor').value=file.content;$('#source-path').textContent=relative;$('#editor-state').textContent='已儲存';
  block();
}
async function openComposer(f,epoch) {
  const repositoryId=state.repositoryId,request=++state.composerRequest;
  if(state.composer?.repositoryId===repositoryId&&state.composer.featureKey===(f?.key??null)&&composerDirty())return;
  let value;
  if(f) value=await api(`/spec-repositories/${repositoryId}/requirement?requirementId=${encodeURIComponent(f.requirementId)}&featureId=${encodeURIComponent(f.id)}`);
  else {
    const storageKey=`bdd-new-requirement:${repositoryId}`;
    let key=sessionStorage.getItem(storageKey);if(!key){key=`new-${crypto.randomUUID()}`;sessionStorage.setItem(storageKey,key);}
    value={description:'',gherkin:'',token:null,key,proposals:await api(`/spec-repositories/${repositoryId}/requirement/proposals?editorKey=${encodeURIComponent(key)}`)};
  }
  if(request!==state.composerRequest||epoch!==state.epoch||repositoryId!==state.repositoryId)return;
  state.composer={...value,repositoryId,featureKey:f?.key??null};
  $('#requirement-description').value=value.description;$('#requirement-gherkin').value=value.gherkin;
  $('#requirement-state').textContent=f?'已儲存':'尚未儲存';
  $('#document-info').textContent='TXT、Markdown、Gherkin、DOCX · 最大 1 MiB';
  renderRequirementHistory(value.proposals??[]);
  renderRequirementFeedback(value);
}
function renderRequirementFeedback(value) {
  const feedback=$('#requirement-feedback');
  if(value.diagnostics?.length) feedback.textContent='草稿可儲存；確認前請修正格式：'+value.diagnostics.map(x=>`第 ${x.line} 行：${x.message}`).join(' ');
  else if(value.suggestions?.length) feedback.textContent='內容提醒（不阻擋確認）：'+value.suggestions.map(x=>`第 ${x.line} 行：${x.message}`).join(' ');
  else feedback.textContent='';
  feedback.hidden=!feedback.textContent;
}
function renderRequirementHistory(proposals) {
  const area=$('#requirement-history-items');area.replaceChildren();$('#requirement-history').hidden=!proposals.length;
  for(const proposal of proposals) {
    const row=el('div',undefined,'requirement-history-row');row.append(el('span',new Date(proposal.createdAt).toLocaleString()));
    if(proposal.originalGherkin)row.append(button('還原產生前內容',()=>restoreRequirement(proposal.originalGherkin)));
    row.append(button('取回這份草稿',()=>restoreRequirement(proposal.generatedGherkin,proposal.description)));area.append(row);
  }
}
async function restoreRequirement(gherkin,description) {
  if($('#requirement-gherkin').value.trim()&&!await ask('還原先前草稿？','目前未儲存的編輯會被替換；已儲存版本與生成歷史不受影響。','還原草稿'))return;
  $('#requirement-gherkin').value=gherkin;if(description!==undefined)$('#requirement-description').value=description;composerChanged();
}
function composerChanged() {
  $('#requirement-state').textContent=composerDirty()?'尚未儲存':'已儲存';
  $('#requirement-feedback').textContent='';$('#requirement-feedback').hidden=true;renderNext();block();
}
async function generateGherkin() {
  const description=$('#requirement-description').value,previousGherkin=$('#requirement-gherkin').value;
  if(!description.trim())throw new Error('請先描述需求或上傳文件。');
  if(previousGherkin.trim()&&!await ask('重新產生 Gherkin 草稿？','原稿會保留在生成歷史。','保留原稿並產生'))return;
  state.transient=true;block();$('#generate-gherkin').textContent='正在產生…';
  const repositoryId=state.repositoryId,epoch=state.epoch;
  try {
    const result=await api(`/spec-repositories/${repositoryId}/requirement/generate`,'POST',{description,previousGherkin,editorKey:state.composer.key});
    if(epoch!==state.epoch||repositoryId!==state.repositoryId)return;
    $('#requirement-gherkin').value=result.gherkin;
    renderRequirementHistory(await api(`/spec-repositories/${repositoryId}/requirement/proposals?editorKey=${encodeURIComponent(state.composer.key)}`));
    composerChanged();renderRequirementFeedback(result);
    note('Gherkin 草稿已產生，請在下方直接編輯。');$('#requirement-panel').dataset.generation=result.proposalId;
  }finally{state.transient=false;$('#generate-gherkin').textContent='產生 Gherkin 草稿';block();}
  $('#requirement-gherkin').focus();
}
async function importDocument() {
  const file=$('#requirement-file').files[0];$('#requirement-file').value='';if(!file)return;
  if(file.size>1024*1024)throw new Error('文件最多 1 MiB；原有內容未被修改。');
  state.transient=true;block();
  try {
    const bytes=new Uint8Array(await file.arrayBuffer());let binary='';
    for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    const document=await api(`/spec-repositories/${state.repositoryId}/requirement/import`,'POST',{name:file.name,base64:btoa(binary)});
    const source=$('#requirement-description');source.value=source.value.trim()?source.value+'\n\n'+document.text:document.text;
    $('#document-info').textContent=`已匯入 ${document.name}；只加入上方描述，下方尚未變更。`;composerChanged();note('文件已加入需求描述，點「產生 Gherkin 草稿」才會更新下方。');
  }finally{state.transient=false;block();}
}
async function saveRequirement() {
  const c=state.composer;if(!c)return;
  const input={...composerInput(),expectedToken:c.token,editorKey:c.key,...(feature()?{requirementId:feature().requirementId,featureId:feature().id}:{projectIds:(state.detail.modules??[]).map(p=>p.id)})};
  const result=await executeJob('workflow.requirement.save',input,{refreshAfter:false});
  state.composer={...c,...input,token:result.token};
  if(!c.featureKey)sessionStorage.removeItem(`bdd-new-requirement:${state.repositoryId}`);
  await navigate({view:'features',featureKey:result.key,stage:'GHERKIN'},{protect:false});return result;
}
async function saveSource() {
  if(!state.editor)return;const e=state.editor,content=$('#source-editor').value;
  const r=await executeJob('repository.save',{kind:'source',path:e.path,content,expectedHash:e.sha256},{refreshAfter:false});state.editor={...e,content,sha256:r.sha256};await refresh();
}
async function advance() {
  if(state.formDirty)throw new Error('請先儲存範圍設定。');
  if(state.stage==='GHERKIN'&&(composerDirty()||!feature()))await saveRequirement();
  if(state.editor&&$('#source-editor').value!==state.editor.content)await saveSource();
  const f=feature(), stage=state.stage;
  if(!['GHERKIN','SD','TESTS'].includes(stage))return;
  const name={GHERKIN:'gherkin',SD:'sd',TESTS:'tests'}[stage];
  const result=await flow('workflow.review',{requirementId:f.requirementId,featureId:f.id,stage:name,expectedDigest:f.review.hashes[name]});
  if(result)await navigate({stage:result.nextStage},{protect:false});
}
async function renderProjects(epoch) {
  const d=state.detail;$('#project-cards').replaceChildren();for(const p of d.modules??[]){const c=el('article',undefined,'card');c.append(el('h3',p.id),el('p',p.url,'mono muted'),button('編輯產品',()=>navigate({projectId:p.id}),'primary'));$('#project-cards').append(c);}
  if(!d.modules?.length)$('#project-cards').append(el('p','此規格庫尚未設定產品來源。','muted'));
  const p=d.modules?.find(x=>x.id===state.projectId);$('#project-editor-panel').hidden=!p;if(!p)return;
  $('#project-title').textContent=p.id;$('#product-state').textContent=p.dirty?'有本機變更':'已儲存';
  let list=await api(`/spec-repositories/${d.id}/projects/${p.id}/files`);if(epoch!==state.epoch)return;
  if(!list.available && !p.actual) {
    await executeJob('repository.prepare',{}, {refreshAfter:false});
    if(epoch!==state.epoch)return;
    list=await api(`/spec-repositories/${d.id}/projects/${p.id}/files`);
  }
  if(epoch!==state.epoch)return;
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
  const list=$('#run-list');list.replaceChildren();const d=state.detail;
  if(Number.isInteger(d.connection?.nextHistoryOffset))list.append(button('載入更早的測試紀錄',()=>executeJob('repository.history.more',{})));
  let count=0;
  for(const f of d.spec?.features??[])for(const report of f.workflow?.reports??[]){list.append(reportCard(report,f.key));count++;}
  const known=new Set((d.spec?.features??[]).map(f=>f.key)),archived=new Map();
  for(const r of d.runs??[]){const m=r.result,k=`${m.requirementId}/${m.featureId}`;if(!known.has(k))archived.set(`${k}/${r.id}`,{key:`${k}/${r.id}`,runId:r.id,manifest:m,state:r.state,origin:'LOCAL',publication:r.publication});}
  for(const r of d.reports??[]){const k=`${r.requirementId}/${r.featureId}`;if(!known.has(k))archived.set(r.key,{...r,state:'SEALED',origin:'SPEC_REPO',reportKey:r.key});}
  for(const r of archived.values()){list.append(reportCard({...r,path:`reports/${r.key}/manifest.json`,testOutcome:r.manifest.testOutcome??'NOT_RUN',verification:r.manifest.verification??'NOT_VERIFIED',testedSpecCommit:r.manifest.testedSpecCommit,finishedAt:r.manifest.finishedAt,applicability:'HISTORICAL'},null));count++;}
  if(!count)list.append(el('p','尚無驗收紀錄。','empty-state'));
}

function reportCard(report,featureKey,inline=false) {
  const c=el('article',undefined,'card feature-report');c.dataset.runId=report.runId;c.dataset.reportKey=report.key;
  c.append(badge(report.testOutcome),document.createTextNode(' '),badge(report.applicability==='CURRENT'?'目前版本':'歷史版本'));
  if(report.finishedAt)c.append(el('time',new Date(report.finishedAt).toLocaleString()));
  const details=el('details');details.append(el('summary','版本與來源'),el('p',report.runId,'mono'),el('p',report.path,'mono report-path'),el('p',`受測版本：${report.testedSpecCommit??'未記錄'}`,'mono report-path'),el('p',report.origin==='SPEC_REPO'?(report.ref?.startsWith('refs/remotes/')?'已同步至遠端':'規格庫報告'):report.publication?.status==='PUBLISHED'?'已同步至遠端':'本機報告'),badge(report.verification));c.append(details);
  if(report.invalidReason)c.append(el('p','證據錯誤：'+report.invalidReason,'error'));
  else if(report.state==='SEALED')c.append(button('檢視證據',()=>showReport(report.runId,report.reportKey,inline?'feature-report-view':'report-view',inline?featureKey:null)));
  return c;
}
async function renderFeatureReports() {
  const f=feature(),d=state.detail,panel=$('#feature-report-list');panel.replaceChildren();
  $('#feature-report-scope').textContent=f.title;
  const reports=f.workflow?.reports??[];
  $('#report-problem').disabled=!reports.some(r=>r.state==='SEALED'&&!r.invalidReason);
  if(!reports.length)panel.append(el('p','尚無測試報告。','empty-state'));
  for(const r of reports)panel.append(reportCard(r,f.key,true));
  if(Number.isInteger(d.connection?.nextHistoryOffset))panel.append(button('更早紀錄',()=>executeJob('repository.history.more',{})));
  const latest=reports.find(r=>r.state==='SEALED'&&!r.invalidReason);
  if(latest)await showReport(latest.runId,latest.reportKey,'feature-report-view',f.key);
}
async function reportProblem() {
  const f=feature(),repositoryId=state.repositoryId,runId=$('#feature-report-view').dataset.runId??f.workflow?.reports?.[0]?.runId;
  dialog('問題回報','',[field('問題描述','message','',{rows:5})],'送回開發',async form=>{
    if(repositoryId!==state.repositoryId||f.key!==state.featureKey)throw new Error('需求已切換。');
    await executeJob('workflow.feedback',{requirementId:f.requirementId,featureId:f.id,runId,message:form.get('message')},{refreshAfter:false});
    await navigate({stage:'IMPLEMENTATION'},{protect:false});
  });
}
async function showReport(runId,key,panelId='report-view',expectedFeature=null) {
  const repositoryId=state.repositoryId,token=++state.reportRequest,panel=$('#'+panelId);
  panel.hidden=false;panel.setAttribute('aria-busy','true');delete panel.dataset.runId;panel.replaceChildren(el('p','正在核對並讀取這次驗收的證據…'));
  try {
    const r=await fetch(artifact(runId,'manifest.json',key)),m=await r.json();if(!r.ok)throw new Error(m.message);
    if(token!==state.reportRequest||repositoryId!==state.repositoryId||expectedFeature&&expectedFeature!==state.featureKey)return;
    if(expectedFeature&&`${m.requirementId}/${m.featureId}`!==expectedFeature)throw new Error('報告不屬於目前需求，未顯示其他功能的證據。');
    panel.replaceChildren(el('h2',`${m.requirementId} / ${m.featureId}`),badge(m.testOutcome),document.createTextNode(' '),badge(m.verification),el('p',runId,'mono muted'));
    panel.append(el('p',`受測版本：${m.testedSpecCommit}`,'mono report-path'));
    if(m.failure)panel.append(el('p',m.failure.message,'error'));
    const table=el('table',undefined,'report-table'),head=el('tr');['案例','瀏覽器','結果','斷言'].forEach(x=>head.append(el('th',x)));table.append(head);
    for(const c of m.cases??[]){const row=el('tr');[c.caseId,c.profile,c.status,String(c.assertions)].forEach(x=>row.append(el('td',x)));table.append(row);}panel.append(table);
    const gallery=el('div',undefined,'gherkin-results');
    const keyword=/^(Given|When|Then|And|But|假如|假設|假定|當|那麼|那么|而且|並且|并且|但是)\s+/;
    for(const c of m.cases??[]) {
      const scenario=el('section',undefined,'bdd-scenario');scenario.append(el('h3',c.title??c.caseId),badge(c.status),el('small',c.profile));
      const used=new Set();
      for(const step of (c.steps??[]).filter(s=>s.category==='test.step'&&keyword.test(s.title))) {
        const row=el('div',undefined,'bdd-step');row.append(el('p',(step.failed?'✗ ':'✓ ')+step.title));
        const names=new Set(['step-'+step.title,'step-'+step.title.replace(keyword,'')]);
        const a=(c.attachments??[]).find(a=>a.path.startsWith('screenshots/')&&names.has(a.name)&&!used.has(a.path));
        if(a&&m.artifacts.some(x=>x.path===a.path)){used.add(a.path);const img=document.createElement('img');img.src=artifact(runId,a.path,key);img.alt=step.title;img.loading='lazy';row.append(img);}
        scenario.append(row);
      }
      for(const error of c.errors??[])scenario.append(el('pre',error,'error'));
      gallery.append(scenario);
    }
    panel.append(gallery);
    if(m.artifacts.some(a=>a.path==='native/index.html')) {
      const native=el('details');native.append(el('summary','Playwright HTML 報告'));
      native.addEventListener('toggle',()=>{if(!native.open||native.querySelector('iframe'))return;const frame=document.createElement('iframe');frame.title='Playwright 測試報告';frame.sandbox='allow-scripts';frame.src=API+`/spec-repositories/${repositoryId}/runs/${runId}/report/native/index.html`;frame.className='native-report';native.append(frame);});panel.append(native);
    }
    const links=el('div',undefined,'toolbar');for(const a of m.artifacts.filter(x=>/\.(html|json|zip)$/.test(x.path))){const link=el('a',a.path);link.href=artifact(runId,a.path,key);link.download=a.path.split('/').at(-1);links.append(link);}panel.append(links);
    const details=el('details');details.append(el('summary','技術診斷與版本來源'),el('pre',JSON.stringify(m,null,2)));panel.append(details);panel.dataset.runId=runId;
  }catch(error){if(token===state.reportRequest&&repositoryId===state.repositoryId)panel.replaceChildren(el('p','報告無法讀取：'+error.message,'error'));throw error;}
  finally{if(token===state.reportRequest&&repositoryId===state.repositoryId)panel.setAttribute('aria-busy','false');}
}

function on(selector,event,fn) { $(selector).addEventListener(event,e=>{if(event==='submit')e.preventDefault();safe(()=>fn(e));}); }
for(const s of ['#bind-home','#bind-empty','#bind-sidebar'])on(s,'click',bindRepository);
all('[data-home]').forEach(n=>n.onclick=e=>{e.preventDefault();safe(()=>navigate({repositoryId:null,featureKey:null,projectId:null}));});all('[data-view]').forEach(n=>n.onclick=()=>safe(()=>navigate({view:n.dataset.view})));
on('#menu-toggle','click',()=>{$('#menu-toggle').setAttribute('aria-expanded',String($('#sidebar').classList.toggle('open')));});
on('#close-dialog','click',()=>closeDialog());on('#cancel-dialog','click',()=>closeDialog());
$('#form-dialog').addEventListener('cancel',e=>{e.preventDefault();closeDialog();});
on('#cancel-job','click',()=>state.jobId&&api(`/operations/${state.jobId}/cancel`,'POST',{}));
on('#sync','click',()=>{if(dirty())throw new Error('請先儲存畫面中的草稿，遠端同步只處理已儲存內容。');return executeJob('repository.sync',{});});
on('#new-feature','click',createFeature);
on('#upload-requirement','click',()=>$('#requirement-file').click());
on('#requirement-file','change',importDocument);
on('#requirement-description','input',composerChanged);on('#requirement-gherkin','input',composerChanged);
on('#generate-gherkin','click',generateGherkin);on('#save-requirement','click',saveRequirement);
on('#feature-select','change',()=>navigate({featureKey:$('#feature-select').value,stage:'GHERKIN'}));on('#save-source','click',saveSource);on('#advance','click',advance);on('#report-problem','click',reportProblem);
on('#source-select','change',async()=>{const value=$('#source-select').value;if(await guard())await openSource(value);});
on('#source-editor','input',()=>{$('#editor-state').textContent=dirty()?'尚未儲存':'已儲存';block();});on('#project-editor','input',()=>{$('#product-state').textContent=dirty()?'尚未儲存':'已儲存';block();});
on('#project-file-select','change',async()=>{const value=$('#project-file-select').value;if(await guard())await openProduct(value);});on('#save-project','click',saveProduct);on('#project-settings','click',()=>navigate({view:'settings'}));
on('#settings-add-product','click',()=>{addSettingsProduct();state.formDirty=true;});on('#settings-form','input',()=>{state.formDirty=true;block();});on('#settings-form','submit',saveSettings);
on('#scope-form','input',()=>{state.formDirty=true;block();});on('#scope-form','submit',async()=>{const f=feature();await executeJob('repository.save',{kind:'scope',requirementId:f.requirementId,featureId:f.id,expectedHash:state.scope.sha256,projectIds:all('[name=feature-project]:checked').map(x=>x.value),profiles:all('[name=profile]:checked').map(x=>x.value),caseIds:$('#case-ids').value.split('\n').map(x=>x.trim()).filter(Boolean)},{refreshAfter:false});state.formDirty=false;await refresh();});
window.addEventListener('beforeunload',e=>{if(dirty()){e.preventDefault();e.returnValue='';}});window.addEventListener('popstate',()=>safe(async()=>{if(!await guard()){history.forward();return;}await route();}));



function renderBinding() {
  const box=$('#binding-status'), c=state.detail?.connection; box.replaceChildren();
  if(!c){box.append(el('span','已綁定，尚未載入既有內容。'),el('span',state.detail.localPath??'','mono muted'),button('載入需求與歷史',()=>executeJob('repository.acquire',{})));return;}
  const label={QUEUED:'綁定已保存，等待取得內容',LOADING:'正在載入需求、產品與歷史',READY:'已連接',READY_WITH_WARNINGS:'內容已載入，部分項目需要注意',FAILED:'綁定已保存，內容取得失敗'}[c.status]??c.status;
  box.append(el('strong',label),el('span',state.detail.localPath??c.localPath??'','mono muted'));
  if(state.view!=='settings')box.append(button('設定本地目錄',()=>navigate({view:'settings'})));
  if(c.error)box.append(el('p',c.error.message,'error'));
  if(c.warnings?.length)box.append(detailGroup('查看載入提醒',c.warnings.map(w=>el('p',w.message))));
  if(c.status==='FAILED')box.append(button('重試載入',()=>executeJob('repository.acquire',{})));
}
let catalogRequest=0, currentCatalog=null;
const regressionJobs=new Map();
async function renderVersions(epoch) {
  const repositoryId=state.repositoryId;
  $('#start-regression').disabled=true;$('#catalog-source').hidden=true;
  const choices=await api(`/spec-repositories/${repositoryId}/versions`);
  if(epoch!==state.epoch)return;
  $('#spec-versions').replaceChildren(...choices.versions.map(v=>new Option(`${v.label} · ${v.commit.slice(0,8)} (${v.kind})`,v.ref)));
  const wanted=currentCatalog?.repositoryId===repositoryId?currentCatalog.ref:state.detail.connection?.catalog?.commit;
  $('#regression-spec').value=wanted??choices.versions.find(v=>v.kind==='branch')?.ref??choices.versions[0]?.ref??'';
  if(!$('#regression-spec').value){$('#catalog-count').textContent='規格庫尚無共享版本；先儲存需求並遠端同步，再選擇回歸基線。';return;}
  await loadVersion();renderRegressionHistory(state.detail.regressions??[]);
}
async function loadVersion() {
  const request=++catalogRequest, repositoryId=state.repositoryId,ref=$('#regression-spec').value.trim();
  $('#start-regression').disabled=true;$('#catalog-count').textContent='讀取固定版本…';
  const value=await api(`/spec-repositories/${repositoryId}/versions?ref=${encodeURIComponent(ref)}`);
  if(request!==catalogRequest||repositoryId!==state.repositoryId||state.view!=='versions')return;
  currentCatalog={...value,repositoryId,ref};$('#catalog-version').textContent=`規格版本 ${value.commit}`;
  $('#regression-products').replaceChildren();
  for(const p of value.projects) {
    const label=el('label',`產品 ${p.id} 的版本`),input=document.createElement('input'),list=document.createElement('datalist');
    input.dataset.projectId=p.id;input.placeholder=`使用規格記錄：${p.commit.slice(0,12)}`;input.setAttribute('aria-label',`產品 ${p.id} 的版本`);
    list.id=`project-versions-${p.id}`;input.setAttribute('list',list.id);
    list.append(...p.versions.map(v=>new Option(`${v.label} · ${v.commit.slice(0,8)} (${v.kind})`,v.ref)));label.append(input,list);
    if(p.error)label.append(el('span',p.error.message,'error'));$('#regression-products').append(label);
  }
  const count=value.spec.features.reduce((n,f)=>n+f.caseIds.length*f.profiles.length,0);
  $('#catalog-count').textContent=`全部 ${value.spec.features.length} 個功能，共 ${count} 個案例／環境組合`;
  $('#catalog-features').replaceChildren();$('#catalog-source').hidden=true;
  for(const f of value.spec.features) {
    const row=el('article',undefined,'catalog-feature');row.append(el('h4',f.title),el('span',f.key,'mono muted'));
    for(const [label,file] of [['Gherkin',`spec/${f.key}/${f.id}.feature`],['設計',`spec/${f.key}/${f.id}.sd.md`],['測試',`tests/${f.key}/${f.id}.steps.ts`],['Hooks',`tests/${f.key}/${f.id}.hooks.ts`]])row.append(button(label,async()=>{
      const data=await api(`/spec-repositories/${repositoryId}/version-file?ref=${value.commit}&path=${encodeURIComponent(file)}`);
      if(repositoryId!==state.repositoryId||currentCatalog?.commit!==value.commit)return;
      $('#catalog-source').textContent=`${file} @ ${data.commit}（唯讀）\n\n${data.content}`;$('#catalog-source').hidden=false;$('#catalog-source').scrollIntoView({block:'nearest'});
    }));$('#catalog-features').append(row);
  }
  $('#start-regression').disabled=!state.capabilities.executionEnabled||!value.spec.features.length||regressionJobs.has(repositoryId);
  $('#regression-status').textContent=state.capabilities.executionEnabled?'選擇版本後即可回歸，不需要重做歷史需求的人工確認。':'測試執行已被停用；移除 WB_ENABLE_TRUSTED_EXECUTION=0，正常使用 npm start 即可啟用。';
}
function renderRegressionHistory(batches) {
  $('#regression-list').replaceChildren();
  if(!batches.length)$('#regression-list').append(el('p','尚無整庫回歸紀錄。','muted'));
  for(const batch of batches) {
    const card=el('article',undefined,'panel regression-card');card.dataset.batchId=batch.batchId;
    card.append(el('h3',`${batch.outcome} · ${batch.status}`),el('p',batch.batchId,'mono muted'),el('p',`規格 ${batch.testedSpecCommit}`,'mono'),el('p',`通過 ${batch.counts?.passed??0} / 全部 ${batch.features.length}；失敗 ${batch.counts?.failed??0}；錯誤 ${batch.counts?.errors??0}`));
    for(const p of batch.projects)card.append(el('p',`${p.id}：${p.commit} (${p.requestedRef})`,'mono muted'));
    for(const r of batch.results) {
      const row=el('div',undefined,'regression-result');row.append(el('span',`${r.title} · ${r.outcome}`));
      if(r.error)row.append(el('p',r.error.message,'error'));
      if(r.runId&&r.testOutcome)row.append(button('查看這次證據',async()=>{await navigate({view:'reports'});await showReport(r.runId);}));
      card.append(row);
    }
    if(batch.differences?.length)card.append(el('p','與上一批差異：'+batch.differences.map(d=>`${d.key} ${d.before} → ${d.after}`).join('；')));
    if(batch.status==='COMPLETED')card.append(button('相同版本重跑',()=>startRegression({specRef:batch.testedSpecCommit,projects:Object.fromEntries(batch.projects.map(p=>[p.id,p.commit]))})));
    $('#regression-list').append(card);
  }
}
async function startRegression(selection) {
  const repositoryId=state.repositoryId;
  if(regressionJobs.has(repositoryId))throw new Error('這個規格庫已有回歸正在執行。');
  beginAction();
  const input=selection??{specRef:$('#regression-spec').value.trim(),projects:Object.fromEntries(all('#regression-products input').map(n=>[n.dataset.projectId,n.value.trim()]).filter(([,v])=>v))};
  const accepted=await api('/operations','POST',{schemaVersion:1,operationId:`OP-${crypto.randomUUID()}`,repositoryId,operation:'regression.start',input});
  showOperation({...accepted,request:{repositoryId,operation:'regression.start'}});
  return monitorRegression(repositoryId,accepted,input);
}
function restoreRegression(detail) {
  const op=(detail.operations??[]).find(x=>x.request.operation==='regression.start'&&activeOperation(x.status));
  if(op&&!regressionJobs.has(detail.id))void monitorRegression(detail.id,op,op.request.input).catch(error=>note(error.message,true));
}
async function monitorRegression(repositoryId,accepted,input) {
  regressionJobs.set(repositoryId,accepted.id);$('#cancel-regression').hidden=false;$('#start-regression').disabled=true;
  note('回歸正在執行；可以繼續編輯及儲存，這次仍使用開始時固定的版本。');
  let result=accepted;
  try {
    while(['QUEUED','RUNNING','CANCELLING'].includes(result.status)) {
      await new Promise(r=>setTimeout(r,700));result=await api(`/operations/${accepted.id}`);
      if(state.repositoryId===repositoryId&&state.view==='versions') {
        const data=await api(`/spec-repositories/${repositoryId}`);renderRegressionHistory(data.regressions??[]);
        $('#regression-status').textContent='回歸執行中；取消不會刪除已產生的證據。';
      }
    }
  } finally {regressionJobs.delete(repositoryId);if(state.repositoryId===repositoryId){$('#cancel-regression').hidden=true;$('#start-regression').disabled=false;}}
  if(result.error?.code==='INSTALL_REQUIRED') {
    const plan=result.error.details.install;
    if(await ask('安裝必要套件並繼續',`此固定版本需安裝測試套件及 ${plan.browsers.join('、')}。安裝只影響獨立回歸目錄，不更動編輯內容。`,'安裝並繼續'))return startRegression({...input,batchId:plan.batchId,installConsent:plan.digest});
    note('已取消安裝；固定版本計畫與已儲存內容保留。');return;
  }
  if(state.repositoryId===repositoryId) {
    if(state.view==='versions'){const data=await api(`/spec-repositories/${repositoryId}`);renderRegressionHistory(data.regressions??[]);}
    $('#regression-status').textContent=result.status==='SUCCEEDED'?`回歸完成：${result.result.outcome}`:result.error?.message??result.status;
    note(result.status==='SUCCEEDED'?`回歸完成：${result.result.outcome}，歷史已保留。`:result.error?.message??'回歸未完成。',result.status!=='SUCCEEDED'||result.result?.outcome==='FAILED');
    $('#notice').dataset.operation='regression.start';$('#notice').dataset.outcome=result.status;$('#notice').dataset.jobId=result.id;
  }
}
$('#regression-spec').addEventListener('change',()=>safe(loadVersion));
$('#refresh-versions').addEventListener('click',()=>safe(()=>executeJob('repository.acquire',{})));
$('#start-regression').addEventListener('click',()=>safe(()=>startRegression()));
$('#cancel-regression').addEventListener('click',()=>safe(async()=>{const job=regressionJobs.get(state.repositoryId);if(job)await api(`/operations/${job}/cancel`,'POST',{});}));

const development=developmentView({api,view:()=>state,feature,refresh,navigate,ask,note,safe,showOperation,beginAction,actionVersion:()=>actionVersion,canRecover:()=>!state.busy&&!state.jobId});
on('#develop','click',()=>development.start());on('#stop-development','click',()=>development.stop());

// Initialize the route only after every view state and handler exists.
await safe(async()=>{state.capabilities=await api('/capabilities');$('#worker-status').textContent=state.capabilities.executionEnabled?'可執行驗收':'測試執行已停用';await route();});
