export function chatRoomsView({api,el,button,navigate,workspace,note}) {
  const $=selector=>document.querySelector(selector);
  const roomsNode=$('#chat-room-list'),tabs=$('#chat-tabs'),view=$('#chat-view');
  const drafts=new Map(),opened=new Set();let rooms=[],current=null,version=0,source;
  const report=error=>note(error.message,true);
  function renderTabs(){
    tabs.hidden=!opened.size;tabs.replaceChildren(button('工作台',workspace));
    for(const id of opened){const room=rooms.find(item=>item.id===id),label='對話 · '+(room?.title??'聊天室'),group=el('div',undefined,'chat-tab');
      const select=button(label,()=>navigate(id));select.setAttribute('aria-current',current===id?'page':'false');
      const close=button('×',async()=>{opened.delete(id);if(current===id){const next=[...opened].at(-1);if(next)await navigate(next);else await workspace();}renderTabs();});close.setAttribute('aria-label','關閉 '+label);group.append(select,close);tabs.append(group);
    }
  }
  async function refreshList(){
    rooms=await api('/chat-rooms');roomsNode.replaceChildren();
    for(const room of rooms){const item=button(room.title,()=>navigate(room.id),'chat-room-link');item.dataset.testid='chat-room-'+room.id;item.setAttribute('aria-current',room.id===current?'page':'false');if(room.pending)item.append(el('span',' ●'));roomsNode.append(item);}
    if(!rooms.length)roomsNode.append(el('p','建立聊天室，開始對話。','muted'));
    renderTabs();if(!source)connect();
  }
  function connect(roomId,renderMessages,renderStreaming,connection){
    source?.close();const stream=new EventSource('/repository-api/v1/chat-events'+(roomId?'?roomId='+encodeURIComponent(roomId):''));source=stream;
    let revision=-1;
    stream.onopen=()=>{revision=-1;if(connection)connection.textContent='';};
    stream.onerror=()=>{if(connection)connection.textContent='連線中斷，正在重新連線…';};
    stream.onmessage=event=>{
      if(source!==stream)return;
      try{
        const value=JSON.parse(event.data);if(value.revision<revision)return;revision=value.revision;
        if(value.type==='snapshot'){
          rooms=value.rooms;roomsNode.replaceChildren();
          for(const room of rooms){const item=button(room.title,()=>navigate(room.id),'chat-room-link');item.dataset.testid='chat-room-'+room.id;item.setAttribute('aria-current',room.id===current?'page':'false');if(room.pending)item.append(el('span',' ●'));roomsNode.append(item);}
          if(!rooms.length)roomsNode.append(el('p','建立聊天室，開始對話。','muted'));
          renderTabs();if(value.room)renderMessages?.(value.room);
        }else if(value.type==='delta'&&value.roomId===roomId)renderStreaming?.(value);
        else throw Error('未知的聊天串流事件');
      }catch(error){stream.close();if(source===stream)source=null;report(error);}
    };
  }
  function modelPicker(settings,{isBusy,save,active}){
    const node=el('div',undefined,'chat-model-picker'),label=el('label'),select=el('select'),status=el('span',undefined,'muted');
    select.setAttribute('aria-label','對話模型');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    label.append(select);node.append(label,status);
    let loading=false,saving=false,loaded=false,refreshAgain=false;
    const update=()=>{select.disabled=loading||saving||isBusy()||!loaded;};
    const currentOption=()=>{select.replaceChildren(new Option(settings.model,settings.model));select.value=settings.model;};currentOption();
    async function load(){
      if(loading||saving){refreshAgain=true;return;}loading=true;status.textContent='正在取得 Copilot 模型…';update();
      try{
        const catalog=await api('/chat-models');if(!active()||refreshAgain)return;
        const options=[new Option('自動選擇',catalog.automaticModel),...catalog.models.filter(m=>m.id!==catalog.automaticModel).map(m=>{const option=new Option(m.name,m.id);option.disabled=!m.selectable;return option;})];
        if(!options.some(o=>o.value===settings.model)){const current=new Option(settings.model+'（目前清單未提供）',settings.model);current.disabled=true;options.push(current);}
        select.replaceChildren(...options);select.value=settings.model;loaded=true;
        status.textContent=catalog.models.length?`已取得 ${catalog.models.length} 個模型`:'Copilot 目前未提供可手選模型，仍可使用自動選擇。';
      }catch(error){if(active()){loaded=false;currentOption();status.textContent='無法取得模型清單：'+error.message;}}
      finally{loading=false;update();if(refreshAgain&&active()){refreshAgain=false;void load();}}
    }
    select.onchange=async()=>{
      const model=select.value;if(model===settings.model)return;saving=true;update();
      try{await save({model});if(active())status.textContent='模型已保存，供後續訊息使用。';}
      catch(error){select.value=settings.model;if(active()){status.textContent='模型未變更：'+error.message;report(error);}}
      finally{saving=false;update();if(refreshAgain&&active()){refreshAgain=false;void load();}}
    };
    void load();return {node,update,refresh:load};
  }
  function settingsPanel(settings,onSave,saveSettings){
    const details=el('details',undefined,'chat-settings');details.append(el('summary','對話設定'));const form=el('form',undefined,'chat-settings-form'),fields={};
    for(const [key,label] of [['codexExecutable','Codex 執行檔'],['copilotExecutable','Copilot ACP 執行檔'],['copilotArgs','Copilot ACP 啟動參數'],['timeoutMs','逾時']]){
      const wrapper=el('label',label),input=el('input');input.setAttribute('aria-label','對話 '+label);input.value=key==='copilotArgs'?JSON.stringify(settings[key]):String(settings[key]);input.required=true;fields[key]=input;wrapper.append(input);form.append(wrapper);
    }
    const save=el('button','儲存對話設定');save.type='submit';form.append(save);
    form.onsubmit=async event=>{event.preventDefault();save.disabled=true;try{const value={};for(const [key,input] of Object.entries(fields))value[key]=key==='copilotArgs'?JSON.parse(input.value):key==='timeoutMs'?Number(input.value):input.value;await saveSettings(value);note('對話設定已儲存');onSave?.();}catch(error){report(error);}finally{save.disabled=false;}};
    details.append(form);return details;
  }
  async function open(id){
    const epoch=++version;source?.close();source=null;current=id;opened.add(id);renderTabs();view.replaceChildren(el('p','載入對話…'));
    const [room,settings]=await Promise.all([api(`/chat-rooms/${encodeURIComponent(id)}`),api('/chat-settings')]);if(epoch!==version)return;
    const log=el('div',undefined,'chat-messages');log.setAttribute('role','log');log.setAttribute('aria-label','對話訊息');log.setAttribute('aria-live','polite');
    const form=el('form',undefined,'chat-composer'),input=el('textarea'),actions=el('div',undefined,'chat-composer-actions'),send=el('button','送出'),hint=el('span','Ctrl / ⌘ + Enter 送出');
    input.setAttribute('aria-label','對話訊息輸入');input.placeholder='輸入訊息…';input.rows=3;input.value=drafts.get(id)??'';send.type='submit';send.className='chat-send';hint.className='chat-send-hint';actions.append(hint,send);form.append(input,actions);
    const connection=el('p',undefined,'muted');connection.setAttribute('role','status');
    let pending=false,sending=false,settingsSaving=0,settingsTail=Promise.resolve(),streamedText;
    const updateButton=()=>{send.disabled=Boolean(settingsSaving)||sending||pending||!input.value.trim();send.textContent=sending?'送出中…':pending?'回覆中…':'送出';picker.update();};
    const saveSettings=patch=>{
      settingsSaving++;updateButton();
      const job=settingsTail.then(async()=>{if(epoch!==version)throw Error('對話已切換，設定尚未保存');const saved=await api('/chat-settings','PATCH',patch);Object.assign(settings,saved);return saved;}).finally(()=>{settingsSaving--;updateButton();});
      // The caller observes each failure; only the queue lock is released here.
      settingsTail=job.then(()=>undefined,()=>undefined);return job;
    };
    const picker=modelPicker(settings,{isBusy:()=>pending||sending||Boolean(settingsSaving),save:saveSettings,active:()=>epoch===version});
    input.oninput=()=>{drafts.set(id,input.value);updateButton();};
    input.onkeydown=event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)&&!event.isComposing){event.preventDefault();form.requestSubmit();}};
    const renderStreaming=value=>{
      if(!value)return;
      pending=true;
      if(!streamedText){const article=el('article',undefined,'chat-message chat-message-assistant');article.dataset.testid='chat-message-assistant-streaming';streamedText=el('p',undefined,'chat-message-content');article.append(el('strong','助手 · 回覆中'),streamedText);log.append(article);}
      if(value.type==='delta'){if(streamedText.textContent.length!==value.offset)throw Error('聊天串流文字位置不一致');streamedText.append(document.createTextNode(value.delta));}else streamedText.textContent=value.text;updateButton();log.scrollTop=log.scrollHeight;
    };
    const renderMessages=value=>{
      log.replaceChildren();streamedText=null;pending=value.messages.some(message=>message.status==='pending');
      if(!value.messages.length){const empty=el('div',undefined,'chat-empty');empty.append(el('h2','開始這段對話'),el('p','在下方輸入訊息，對話會自動儲存。'));log.append(empty);}
      for(const message of value.messages){const article=el('article',undefined,'chat-message chat-message-'+message.role);article.dataset.testid='chat-message-'+message.role;article.append(el('strong',message.role==='user'?'你':'助手'),el('p',message.content,'chat-message-content'));if(message.error){const error=el('p',`${message.status==='interrupted'?'回覆已中斷':'回覆失敗'}：${message.error}`,'error');error.setAttribute('role','alert');article.append(error);}log.append(article);}
      if(pending)log.append(el('p','助手正在回覆，訊息已儲存。','muted'));renderStreaming(value.streaming);updateButton();log.scrollTop=log.scrollHeight;
    };

    form.onsubmit=async event=>{
      event.preventDefault();if(settingsSaving||pending||sending||!input.value.trim())return;const content=input.value;sending=true;updateButton();
      try{await api(`/chat-rooms/${encodeURIComponent(id)}/messages`,'POST',{content});if(input.value===content){input.value='';drafts.set(id,'');}}
      catch(error){report(error);}finally{sending=false;updateButton();}
    };
    actions.insertBefore(picker.node,send);view.replaceChildren(settingsPanel(settings,()=>void picker.refresh(),saveSettings),connection,log,form);renderMessages(room);input.focus();connect(id,renderMessages,renderStreaming,connection);
  }
  $('#new-chat-room').onclick=async()=>{const submit=$('#new-chat-room');submit.disabled=true;try{const room=await api('/chat-rooms','POST',{});await refreshList();await navigate(room.id);}catch(error){report(error);}finally{submit.disabled=false;}};
  return {open,refreshList,leave(){version++;current=null;source?.close();source=null;renderTabs();connect();}};
}
