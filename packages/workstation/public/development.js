/** Development view attaches to a real durable worker; page navigation never kills it. */
export function developmentView({api,view,feature,refresh,navigate,ask,previewAgent,note,showOperation,onInteractions,beginAction,actionVersion,canRecover}) {
  const $=s=>document.querySelector(s);
  let timer=null,current=null,offset=0;
  const active=status=>['QUEUED','RUNNING','CANCELLING'].includes(status);
  const selected=(repositoryId,key)=>view().repositoryId===repositoryId&&feature()?.key===key;
  function leave() {
    clearTimeout(timer);current=null;offset=0;
  }
  async function poll(session) {
    if(current!==session)return;
    try {
      const result=await api(`/operations/${session.id}/terminal?offset=${offset}`);if(current!==session)return;
      session.status=result.status;session.phase=result.phase;
      $('#development-status').textContent=({CANCELLED:'已停止',INTERRUPTED:'已中斷'}[result.status])??result.error?.message??({RUNNING:'開發中',PREPARING:'準備中',CHECKING:'BDD 檢查中',COMPLETED:'已通過',FAILED:'未通過'}[result.phase]??result.status);
      $('#develop').disabled=active(result.status)||feature()?.workflow?.status==='COMPLETE';$('#stop-development').hidden=!active(result.status);
      offset=result.nextOffset;
      if(active(result.status)||result.hasMore){timer=setTimeout(()=>void poll(session),350);return;}
      if(session.handled)return;session.handled=true;
      if(!session.autoAdvance||session.actionVersion!==actionVersion())return;
      $('#notice').dataset.operation='workflow.develop';$('#notice').dataset.outcome=result.status;$('#notice').dataset.jobId=session.id;
      if(result.error?.code==='INSTALL_REQUIRED'&&session.autoAdvance) {
        const plan=result.error.details.install;
        const text=plan.purpose==='terminal'?'安裝 PTY 終端元件（包含原生模組編譯）。':`安裝 ${Object.keys(plan.packages).join('、')} 與 ${plan.browsers.join('、')}。`;
        if(await ask('安裝必要套件並繼續',text,'安裝並繼續')){
          if(current!==session||session.actionVersion!==actionVersion()||session.key!==`${view().repositoryId}/${feature()?.key}`)return;
          let submitted;
          if(session.submitted){const repositoryId=view().repositoryId,f=feature(),preview=await api(`/spec-repositories/${repositoryId}/agent-preview`,'POST',{purpose:'development',requirementId:f.requirementId,featureId:f.id,agentSelection:session.submitted.agentSelection});if(!selected(repositoryId,f.key)||current!==session||session.actionVersion!==actionVersion())return;submitted={prompt:session.submitted.prompt,promptDigest:preview.promptDigest,agentSelection:preview.agentSelection};}
          await start({installConsent:plan.digest},submitted);
        }
        return;
      }
      if(result.error)note(result.error.message,true);
      if(session.autoAdvance) {
        session.autoAdvance=false;
        if(result.result?.testOutcome==='PASSED'&&result.result?.verification==='VERIFIED')await navigate({stage:'VERIFICATION'},{protect:false});
        else await refresh();
      }
    } catch(error){if(current===session){if(session.autoAdvance&&session.actionVersion===actionVersion())note(error.message,true);timer=setTimeout(()=>void poll(session),1000);}}
  }
  async function open() {
    const state=view(),f=feature();if(!f)return;
    const operation=(state.detail.operations??[]).find(x=>x.request?.operation==='workflow.develop'&&`${x.request.input.requirementId}/${x.request.input.featureId}`===f.key);
    const key=`${state.repositoryId}/${f.key}`;
    $('#develop').disabled=active(current?.status)||f.workflow?.status==='COMPLETE';
    if(current?.key===key&&(!operation||current.id===operation.id))return;
    leave();$('#develop').disabled=f.workflow?.status==='COMPLETE';$('#stop-development').hidden=true;$('#development-status').textContent=f.workflow?.status==='COMPLETE'?'本階段已完成，唯讀':'';
    if(operation){current={key,id:operation.id,status:operation.status,autoAdvance:active(operation.status)&&canRecover(),actionVersion:actionVersion()};void poll(current);}
  }
  async function start(extra={},submitted) {
    const repositoryId=view().repositoryId,f=feature();if(!f)return;const key=f.key;
    if(f.workflow?.status==='COMPLETE')throw new Error('本階段已完成，請先從驗收回報問題。');
    if(current&&active(current.status))return;
    const approved=submitted??await previewAgent('development');if(!approved)return;
    if(!selected(repositoryId,key))return;
    const version=beginAction();
    $('#develop').disabled=true;
    try {
      const result=await api('/operations','POST',{schemaVersion:1,operationId:`OP-${crypto.randomUUID()}`,repositoryId,operation:'workflow.develop',input:{requirementId:f.requirementId,featureId:f.id,...extra,...approved}});
      if(!selected(repositoryId,key)||version!==actionVersion())return result;
      showOperation({...result,request:{...result.request,repositoryId,operation:'workflow.develop'}});
      leave();current={key:`${repositoryId}/${key}`,id:result.id,status:result.status,autoAdvance:true,actionVersion:version,submitted};void poll(current);return result;
    } catch(error){if(selected(repositoryId,key)&&version===actionVersion())$('#develop').disabled=false;throw error;}
  }
  async function stop(){if(current&&active(current.status)){const result=await api(`/operations/${current.id}/cancel`,'POST',{});if(result.interaction)onInteractions?.([result.interaction]);}}
  window.addEventListener('pagehide',leave);
  return {open,start,stop,leave};
}
