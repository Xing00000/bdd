/** Read-only execution viewer with structured messages queued for the next SDK turn. */
export function operationTerminal({api,note,onInteractions}){
  const $=s=>document.querySelector(s),active=s=>['QUEUED','RUNNING','CANCELLING'].includes(s);
  const drafts=new Map();let current=null,terminal=null,observer=null,timer,library;
  const canSend=session=>session?.status==='RUNNING'&&session.phase==='RUNNING'&&!session.sending;
  function inputState(session){
    $('#operation-sdk-input').hidden=session.sdk!==true;
    $('#operation-sdk-send').disabled=!canSend(session)||!$('#operation-sdk-message').value.trim();
  }
  $('#operation-sdk-message').addEventListener('input',()=>{if(current){drafts.set(current.id,$('#operation-sdk-message').value);inputState(current);}});
  $('#operation-sdk-input').addEventListener('submit',async event=>{
    event.preventDefault();const session=current,message=$('#operation-sdk-message').value;
    if(!session?.sdk||!canSend(session)||!message.trim())return;
    session.sending=true;inputState(session);$('#operation-sdk-input-status').textContent='正在送出…';
    try{
      const value=await api(`/operations/${session.id}/input`,'POST',{message});
      if(drafts.get(session.id)===message)drafts.delete(session.id);
      if(current===session){
        onInteractions?.(value.interactions??[]);
        if($('#operation-sdk-message').value===message)$('#operation-sdk-message').value='';
        $('#operation-sdk-input-status').textContent='已排入佇列；實際處理結果會顯示於互動歷程。';
      }
    }catch(error){if(current===session){$('#operation-sdk-input-status').textContent=error.message;note(error.message,true);}}
    finally{session.sending=false;if(current===session)inputState(session);}
  });
  function leave(){clearTimeout(timer);current=null;observer?.disconnect();terminal?.dispose();terminal=null;$('#development-terminal').replaceChildren();$('#development-terminal').hidden=true;$('#operation-input-help').hidden=true;$('#operation-sdk-input').hidden=true;}
  async function load(){
    if(window.Terminal)return;
    if(!library)library=new Promise((resolve,reject)=>{
      const link=document.createElement('link');link.rel='stylesheet';link.href='/repositories/xterm.css';document.head.append(link);
      const script=document.createElement('script');script.src='/repositories/xterm.js';script.onload=resolve;script.onerror=()=>{library=null;reject(new Error('終端元件載入失敗。'));};document.head.append(script);
    });await library;
  }
  async function open(op){
    if(current?.id===op.id){$('#development-terminal').hidden=false;return;}
    leave();const runtime=op.request?.input?.agentSnapshot?.settings?.runtime;
    const session=current={id:op.id,offset:0,status:op.status,phase:'PREPARING',sdk:runtime?runtime==='codex-sdk':undefined};
    await load();if(current!==session)return;
    const container=$('#development-terminal');container.hidden=false;
    const help=$('#operation-input-help');help.hidden=false;
    const showInput=()=>{help.textContent=session.sdk?'下方補充訊息會在目前回合結束後交給 Agent；停止會取消整個作業。':session.sdk===false?'舊版執行紀錄僅供檢視；新任務統一由 Codex SDK 執行。':'正在連接執行紀錄…';inputState(session);};
    $('#operation-sdk-message').value=drafts.get(session.id)??'';$('#operation-sdk-input-status').textContent='';showInput();
    terminal=new window.Terminal({cols:100,rows:30,convertEol:false,scrollback:5000,fontSize:13,screenReaderMode:true,disableStdin:true});terminal.open(container);
    observer=new ResizeObserver(()=>{if(current!==session||!terminal)return;const cols=Math.min(300,Math.max(20,Math.floor((container.clientWidth-24)/8)));terminal.resize(cols,30);});observer.observe(container);
    async function poll(){
      if(current!==session)return;
      try{
        const value=await api(`/operations/${session.id}/terminal?offset=${session.offset}`);if(current!==session)return;
        session.status=value.status;session.phase=value.phase;if(value.runtime)session.sdk=value.runtime==='codex-sdk';showInput();terminal.write(value.output);session.offset=value.nextOffset;
        $('#operation-terminal-status').textContent=[value.status,value.phase,value.latestExit&&`exit ${value.latestExit.exitCode}`,value.error?.message].filter(Boolean).join(' · ');
        if(active(value.status)||value.hasMore)timer=setTimeout(poll,value.hasMore?0:350);
      }catch(error){if(current===session){$('#operation-terminal-status').textContent=error.message;timer=setTimeout(poll,1000);}}
    }void poll();
  }
  return {open,leave};
}
