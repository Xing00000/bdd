/** Development view attaches to a real durable worker; page navigation never kills it. */
export function developmentView({api,view,feature,refresh,navigate,ask,note}) {
  const $=s=>document.querySelector(s);
  let terminal=null,subscription=null,resizeObserver=null,timer=null,current=null,offset=0,loadPromise;
  const active=status=>['QUEUED','RUNNING','CANCELLING'].includes(status);
  async function terminalLibrary() {
    if(window.Terminal)return;
    if(!loadPromise)loadPromise=new Promise((resolve,reject)=>{
      const link=document.createElement('link');link.rel='stylesheet';link.href='/repositories/xterm.css';document.head.append(link);
      const script=document.createElement('script');script.src='/repositories/xterm.js';script.onload=resolve;script.onerror=()=>{loadPromise=null;reject(new Error('終端元件載入失敗。'));};document.head.append(script);
    });
    await loadPromise;
  }
  function leave() {
    clearTimeout(timer);current=null;offset=0;subscription?.dispose();resizeObserver?.disconnect();terminal?.dispose();terminal=null;
    $('#development-terminal').replaceChildren();$('#development-terminal').hidden=true;
  }
  async function openTerminal(session) {
    if(terminal)return;
    await terminalLibrary();if(current!==session)return;
    const container=$('#development-terminal');container.hidden=false;
    terminal=new window.Terminal({cols:100,rows:30,convertEol:false,scrollback:5000,fontSize:13,screenReaderMode:true});terminal.open(container);
    const send=input=>api(`/operations/${session.id}/input`,'POST',input).catch(error=>{if(current===session&&active(session.status))note(error.message,true);});
    subscription=terminal.onData(data=>{if(session.phase==='RUNNING')void send({data});});
    resizeObserver=new ResizeObserver(()=>{if(!terminal||current!==session)return;const cols=Math.min(300,Math.max(20,Math.floor((container.clientWidth-24)/8)));terminal.resize(cols,30);if(session.phase==='RUNNING')void send({cols,rows:30});});resizeObserver.observe(container);
  }
  async function poll(session) {
    if(current!==session)return;
    try {
      const result=await api(`/operations/${session.id}/terminal?offset=${offset}`);if(current!==session)return;
      session.status=result.status;session.phase=result.phase;
      $('#development-status').textContent=({CANCELLED:'已停止',INTERRUPTED:'已中斷'}[result.status])??result.error?.message??({RUNNING:'開發中',PREPARING:'準備中',CHECKING:'BDD 檢查中',COMPLETED:'已通過',FAILED:'未通過'}[result.phase]??result.status);
      $('#develop').disabled=active(result.status);$('#stop-development').hidden=!active(result.status);
      if(result.output||result.phase==='RUNNING'){await openTerminal(session);if(current!==session)return;terminal?.write(result.output);offset=result.nextOffset;}
      if(active(result.status)||result.hasMore){timer=setTimeout(()=>void poll(session),350);return;}
      if(session.handled)return;session.handled=true;
      $('#notice').dataset.operation='workflow.develop';$('#notice').dataset.outcome=result.status;$('#notice').dataset.jobId=session.id;
      if(result.error?.code==='INSTALL_REQUIRED'&&session.autoAdvance) {
        const plan=result.error.details.install;
        const text=plan.purpose==='terminal'?'安裝 PTY 終端元件（包含原生模組編譯）。':`安裝 ${Object.keys(plan.packages).join('、')} 與 ${plan.browsers.join('、')}。`;
        if(await ask('安裝必要套件並繼續',text,'安裝並繼續'))await start({installConsent:plan.digest});
        return;
      }
      if(result.error)note(result.error.message,true);
      if(session.autoAdvance) {
        session.autoAdvance=false;
        if(result.result?.testOutcome==='PASSED'&&result.result?.verification==='VERIFIED')await navigate({stage:'VERIFICATION'},{protect:false});
        else await refresh();
      }
    } catch(error){if(current===session){note(error.message,true);timer=setTimeout(()=>void poll(session),1000);}}
  }
  async function open() {
    const state=view(),f=feature();if(!f)return;
    const operation=(state.detail.operations??[]).find(x=>x.request?.operation==='workflow.develop'&&`${x.request.input.requirementId}/${x.request.input.featureId}`===f.key);
    const key=`${state.repositoryId}/${f.key}`;
    if(current?.key===key&&(!operation||current.id===operation.id))return;
    leave();$('#develop').disabled=false;$('#stop-development').hidden=true;$('#development-status').textContent='';
    if(operation){current={key,id:operation.id,status:operation.status,autoAdvance:active(operation.status)};void poll(current);}
  }
  async function start(extra={}) {
    const s=view(),f=feature();if(!f)return;
    if(current&&active(current.status))return;
    $('#develop').disabled=true;
    try {
      const result=await api('/operations','POST',{schemaVersion:1,operationId:`OP-${crypto.randomUUID()}`,repositoryId:s.repositoryId,operation:'workflow.develop',input:{requirementId:f.requirementId,featureId:f.id,...extra}});
      leave();current={key:`${s.repositoryId}/${f.key}`,id:result.id,status:result.status,autoAdvance:true};void poll(current);
    } catch(error){$('#develop').disabled=false;throw error;}
  }
  async function stop(){if(current&&active(current.status))await api(`/operations/${current.id}/cancel`,'POST',{});}
  window.addEventListener('pagehide',leave);
  return {open,start,stop,leave};
}
