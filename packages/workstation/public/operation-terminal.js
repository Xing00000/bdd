/** One interactive PTY viewer, attached to the selected stage's durable log card. */
export function operationTerminal({api,note,onInteractions}){
  const $=s=>document.querySelector(s),active=s=>['QUEUED','RUNNING','CANCELLING'].includes(s);
  let current=null,terminal=null,subscription=null,observer=null,timer,library;
  function leave(){clearTimeout(timer);current=null;subscription?.dispose();observer?.disconnect();terminal?.dispose();terminal=null;$('#development-terminal').replaceChildren();$('#development-terminal').hidden=true;}
  async function load(){
    if(window.Terminal)return;
    if(!library)library=new Promise((resolve,reject)=>{
      const link=document.createElement('link');link.rel='stylesheet';link.href='/repositories/xterm.css';document.head.append(link);
      const script=document.createElement('script');script.src='/repositories/xterm.js';script.onload=resolve;script.onerror=()=>{library=null;reject(new Error('終端元件載入失敗。'));};document.head.append(script);
    });await library;
  }
  async function open(op){
    if(current?.id===op.id){$('#development-terminal').hidden=false;return;}
    leave();const session=current={id:op.id,offset:0,status:op.status,phase:'PREPARING'};
    await load();if(current!==session)return;
    const container=$('#development-terminal');container.hidden=false;
    terminal=new window.Terminal({cols:100,rows:30,convertEol:false,scrollback:5000,fontSize:13,screenReaderMode:true});terminal.open(container);
    const send=input=>api(`/operations/${session.id}/input`,'POST',input).then(value=>{if(current===session)onInteractions?.(value.interactions??[]);}).catch(error=>{if(current===session&&active(session.status))note(error.message,true);});
    subscription=terminal.onData(data=>{if(active(session.status)&&session.phase==='RUNNING')void send({data});});
    observer=new ResizeObserver(()=>{if(current!==session||!terminal)return;const cols=Math.min(300,Math.max(20,Math.floor((container.clientWidth-24)/8)));terminal.resize(cols,30);if(active(session.status)&&session.phase==='RUNNING')void send({cols,rows:30});});observer.observe(container);
    async function poll(){
      if(current!==session)return;
      try{
        const value=await api(`/operations/${session.id}/terminal?offset=${session.offset}`);if(current!==session)return;
        session.status=value.status;session.phase=value.phase;terminal.write(value.output);session.offset=value.nextOffset;
        $('#operation-terminal-status').textContent=[value.status,value.phase,value.latestExit&&`exit ${value.latestExit.exitCode}`,value.error?.message].filter(Boolean).join(' · ');
        if(active(value.status)||value.hasMore)timer=setTimeout(poll,value.hasMore?0:350);
      }catch(error){if(current===session){$('#operation-terminal-status').textContent=error.message;timer=setTimeout(poll,1000);}}
    }void poll();
  }
  return {open,leave};
}
