export function chatRoomsView({api,el,button,navigate,workspace,note}) {
  const $=selector=>document.querySelector(selector);
  const roomsNode=$('#chat-room-list'),tabs=$('#chat-tabs'),view=$('#chat-view');
  const drafts=new Map(),opened=new Set();let rooms=[],current=null,version=0,timer,listTimer;
  const report=error=>note(error.message,true);
  function renderTabs(){
    tabs.hidden=!opened.size;tabs.replaceChildren(button('工作台',workspace));
    for(const id of opened){const room=rooms.find(item=>item.id===id),label='對話 · '+(room?.title??'聊天室'),group=el('div',undefined,'chat-tab');
      const select=button(label,()=>navigate(id));select.setAttribute('aria-current',current===id?'page':'false');
      const close=button('×',async()=>{opened.delete(id);if(current===id){const next=[...opened].at(-1);if(next)await navigate(next);else await workspace();}renderTabs();});close.setAttribute('aria-label','關閉 '+label);group.append(select,close);tabs.append(group);
    }
  }
  async function refreshList(){
    clearTimeout(listTimer);
    rooms=await api('/chat-rooms');roomsNode.replaceChildren();
    for(const room of rooms){const item=button(room.title,()=>navigate(room.id),'chat-room-link');item.dataset.testid='chat-room-'+room.id;item.setAttribute('aria-current',room.id===current?'page':'false');if(room.pending)item.append(el('span',' ●'));roomsNode.append(item);}
    if(!rooms.length)roomsNode.append(el('p','建立聊天室，開始對話。','muted'));
    renderTabs();if(rooms.some(room=>room.pending))listTimer=setTimeout(()=>refreshList().catch(report),1000);
  }
  function settingsPanel(settings){
    const details=el('details',undefined,'chat-settings');details.append(el('summary','對話設定'));const form=el('form',undefined,'chat-settings-form'),fields={};
    for(const [key,label] of [['codexExecutable','Codex 執行檔'],['copilotExecutable','Copilot 執行檔'],['copilotArgs','Copilot 參數'],['model','模型'],['timeoutMs','逾時']]){
      const wrapper=el('label',label),input=el('input');input.setAttribute('aria-label','對話 '+label);input.value=key==='copilotArgs'?JSON.stringify(settings[key]):String(settings[key]);input.required=true;fields[key]=input;wrapper.append(input);form.append(wrapper);
    }
    const save=el('button','儲存對話設定');save.type='submit';form.append(save);
    form.onsubmit=async event=>{event.preventDefault();save.disabled=true;try{const value={...settings};for(const [key,input] of Object.entries(fields))value[key]=key==='copilotArgs'?JSON.parse(input.value):key==='timeoutMs'?Number(input.value):input.value;await api('/chat-settings','PUT',value);note('對話設定已儲存');}catch(error){report(error);}finally{save.disabled=false;}};
    details.append(form);return details;
  }
  async function open(id){
    const epoch=++version;clearTimeout(timer);current=id;opened.add(id);renderTabs();view.replaceChildren(el('p','載入對話…'));
    const [room,settings]=await Promise.all([api(`/chat-rooms/${encodeURIComponent(id)}`),api('/chat-settings')]);if(epoch!==version)return;
    const log=el('div',undefined,'chat-messages');log.setAttribute('role','log');log.setAttribute('aria-label','對話訊息');log.setAttribute('aria-live','polite');
    const form=el('form',undefined,'chat-composer'),input=el('textarea'),actions=el('div',undefined,'chat-composer-actions'),send=el('button','送出'),hint=el('span','Ctrl / ⌘ + Enter 送出');
    input.setAttribute('aria-label','對話訊息輸入');input.placeholder='輸入訊息…';input.rows=3;input.value=drafts.get(id)??'';send.type='submit';actions.append(hint,send);form.append(input,actions);
    let pending=false,sending=false;
    const updateButton=()=>{send.disabled=sending||pending||!input.value.trim();send.textContent=sending?'送出中…':pending?'回覆中…':'送出';};
    input.oninput=()=>{drafts.set(id,input.value);updateButton();};
    input.onkeydown=event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)&&!event.isComposing){event.preventDefault();form.requestSubmit();}};
    const renderMessages=value=>{
      log.replaceChildren();pending=value.messages.some(message=>message.status==='pending');
      if(!value.messages.length){const empty=el('div',undefined,'chat-empty');empty.append(el('h2','開始這段對話'),el('p','在下方輸入訊息，對話會自動儲存。'));log.append(empty);}
      for(const message of value.messages){const article=el('article',undefined,'chat-message chat-message-'+message.role);article.dataset.testid='chat-message-'+message.role;article.append(el('strong',message.role==='user'?'你':'助手'),el('p',message.content,'chat-message-content'));if(message.error){const error=el('p',`${message.status==='interrupted'?'回覆已中斷':'回覆失敗'}：${message.error}`,'error');error.setAttribute('role','alert');article.append(error);}log.append(article);}
      if(pending)log.append(el('p','助手正在回覆，訊息已儲存。','muted'));updateButton();log.scrollTop=log.scrollHeight;
    };
    const poll=async()=>{clearTimeout(timer);try{const value=await api(`/chat-rooms/${encodeURIComponent(id)}`);if(epoch!==version)return;renderMessages(value);await refreshList();if(pending)timer=setTimeout(poll,1000);}catch(error){report(error);}};
    form.onsubmit=async event=>{
      event.preventDefault();if(pending||sending||!input.value.trim())return;const content=input.value;sending=true;updateButton();
      try{await api(`/chat-rooms/${encodeURIComponent(id)}/messages`,'POST',{content});if(input.value===content){input.value='';drafts.set(id,'');}if(epoch===version)await poll();}
      catch(error){report(error);}finally{sending=false;updateButton();}
    };
    view.replaceChildren(settingsPanel(settings),log,form);renderMessages(room);input.focus();await refreshList();if(pending)timer=setTimeout(poll,1000);
  }
  $('#new-chat-room').onclick=async()=>{const submit=$('#new-chat-room');submit.disabled=true;try{const room=await api('/chat-rooms','POST',{});await refreshList();await navigate(room.id);}catch(error){report(error);}finally{submit.disabled=false;}};
  return {open,refreshList,leave(){version++;current=null;clearTimeout(timer);renderTabs();}};
}
