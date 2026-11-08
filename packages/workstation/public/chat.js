export function chatRoomsView({api,el,button,navigate,note,workspace=()=>({}),onNodeChanged}) {
  const $=selector=>document.querySelector(selector);
  const shell=$('.shell'),drawer=$('#assistant-drawer'),menuToggle=$('#assistant-menu-toggle'),rail=$('.assistant-rail'),roomsPanel=$('#assistant-rooms-panel'),roomsBackdrop=$('#assistant-rooms-backdrop'),roomsClose=$('#assistant-rooms-close'),roomsNode=$('#chat-room-list'),supervisorMenu=$('#assistant-supervisor-menu'),view=$('#chat-view'),sessionsView=$('#assistant-sessions-view');
  const drawerClose=$('#assistant-drawer-toggle'),drawerOpen=$('#assistant-drawer-open'),menuButtons=[...document.querySelectorAll('[data-assistant-nav]')];
  const drafts=new Map();let rooms=[],current=null,version=0,source,activePane='chat',roomsCollapsed=true,selectedMenu='workspace',settingsRequest=0;
  const savedReceipts=new Map();
  const report=error=>note(error.message,true);
  const selectedMenuButton=()=>menuButtons.find(button=>button.dataset.assistantNav===selectedMenu);
  function setRoomsModalOpen(openState){
    roomsCollapsed=!openState;
    drawer.classList.toggle('menu-open',openState);rail.hidden=!openState;
    menuToggle.setAttribute('aria-expanded',String(openState));menuToggle.setAttribute('aria-label',openState?'收合導覽':'展開導覽');menuToggle.title=openState?'收合導覽':'展開導覽';
    for(const button of menuButtons){const selected=button.dataset.assistantNav===selectedMenu;button.setAttribute('aria-current',selected?'page':'false');button.setAttribute('aria-expanded',String(selected&&openState));}
    for(const section of document.querySelectorAll('[data-menu-section]'))section.hidden=section.dataset.menuSection!==selectedMenu;
    const title=selectedMenuButton()?.getAttribute('aria-label');$('#assistant-menu-title').textContent=title;
    roomsPanel?.setAttribute('aria-label',title+'選單');
    if(roomsPanel)roomsPanel.hidden=!openState;
    if(roomsBackdrop)roomsBackdrop.hidden=!openState;
    const content=$('#assistant-drawer .assistant-content');if(content)content.inert=openState;
    if(openState)roomsPanel?.querySelector(`[data-menu-section="${selectedMenu}"] button`)?.focus();
    else if(roomsPanel?.contains(document.activeElement)||rail.contains(document.activeElement))menuToggle.focus();
    if(openState&&selectedMenu==='settings')void ensureSettingsMenu().catch(report);
    if(openState&&selectedMenu==='chat')void supervisorRoot.refresh();
  }
  function setDrawerCollapsed(collapsed){
    shell?.classList.toggle('assistant-collapsed',collapsed);
    if(drawerClose)drawerClose.setAttribute('aria-expanded',String(!collapsed));
    if(drawerOpen){drawerOpen.hidden=!collapsed;drawerOpen.setAttribute('aria-expanded',String(!collapsed));}
  }
  function showPane(pane){
    activePane=pane;
    setDrawerCollapsed(false);
    if(view)view.hidden=pane!=='chat'||!current;
    if(sessionsView)sessionsView.hidden=pane!=='session';
    if(pane==='session'||current){selectedMenu='chat';setRoomsModalOpen(false);}
  }
  setRoomsModalOpen(false);
  if(getComputedStyle(drawer).getPropertyValue('--assistant-overlay').trim()==='1')setDrawerCollapsed(true);
  menuToggle.onclick=()=>setRoomsModalOpen(roomsCollapsed);
  for(const button of menuButtons)button.onclick=()=>{const section=button.dataset.assistantNav,open=selectedMenu!==section||roomsCollapsed;selectedMenu=section;setRoomsModalOpen(open);};
  if(roomsClose)roomsClose.onclick=()=>setRoomsModalOpen(false);
  if(roomsBackdrop)roomsBackdrop.onclick=()=>setRoomsModalOpen(false);
  if(roomsPanel)roomsPanel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();setRoomsModalOpen(false);menuToggle.focus();}});
  if(drawerClose)drawerClose.onclick=()=>{setDrawerCollapsed(true);drawerOpen?.focus();};
  if(drawerOpen)drawerOpen.onclick=()=>{setDrawerCollapsed(false);menuToggle.focus();};
  function clearSettingsMenu(){settingsRequest++;$('#chat-settings-menu').replaceChildren();}
  async function ensureSettingsMenu(){
    const container=$('#chat-settings-menu');if(container.childElementCount)return;
    const request=++settingsRequest,settings=await api('/chat-settings');
    if(request!==settingsRequest||container.childElementCount)return;
    container.replaceChildren(settingsPanel(settings,null,async patch=>{const saved=await api('/chat-settings','PATCH',patch);Object.assign(settings,saved);return saved;}));
  }
  async function refreshList(){
    rooms=await api('/chat-rooms');roomsNode.replaceChildren();
    for(const room of rooms){const item=button(room.title,()=>{showPane('chat');void navigate(room.id);},'chat-room-link');item.dataset.testid='chat-room-'+room.id;item.setAttribute('aria-current',activePane==='chat'&&room.id===current?'page':'false');if(room.pending)item.append(el('span',' ●'));roomsNode.append(item);}
    if(!rooms.length)roomsNode.append(el('p','建立聊天室，開始對話。','muted'));
    if(!source)connect();
    void supervisorRoot.refresh();
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
          for(const room of rooms){const item=button(room.title,()=>{showPane('chat');void navigate(room.id);},'chat-room-link');item.dataset.testid='chat-room-'+room.id;item.setAttribute('aria-current',activePane==='chat'&&room.id===current?'page':'false');if(room.pending)item.append(el('span',' ●'));roomsNode.append(item);}
          if(!rooms.length)roomsNode.append(el('p','建立聊天室，開始對話。','muted'));
          if(value.room)renderMessages?.(value.room);
          if(onNodeChanged){
            for(const receipt of value.nodeChanges??[]){
              if(savedReceipts.get(receipt.repositoryId)===receipt.operationId)continue;
              savedReceipts.set(receipt.repositoryId,receipt.operationId);
              if(receipt.createdAt&&Date.parse(receipt.createdAt)<performance.timeOrigin)continue;
              Promise.resolve(onNodeChanged(receipt)).catch(error=>{if(savedReceipts.get(receipt.repositoryId)===receipt.operationId)savedReceipts.delete(receipt.repositoryId);report(error);});
            }
          }
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
        status.textContent=catalog.models.length?'':'Copilot 目前未提供可手選模型，仍可使用自動選擇。';
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
    const providerWrap=el('label','ACP 推論來源'),providerSelect=el('select');
    providerSelect.setAttribute('aria-label','對話 ACP 推論來源');
    providerSelect.append(new Option('GitHub Copilot ACP','copilot'),new Option('Kiro CLI ACP','kiro'));
    providerSelect.value=settings.acpProvider??'copilot';
    fields.acpProvider=providerSelect;providerWrap.append(providerSelect);form.append(providerWrap);
    for(const [key,label] of [['codexExecutable','Codex 執行檔'],['copilotExecutable','Copilot ACP 執行檔'],['copilotArgs','Copilot ACP 啟動參數'],['kiroExecutable','Kiro ACP 執行檔'],['kiroArgs','Kiro ACP 啟動參數'],['timeoutMs','逾時']]){
      const wrapper=el('label',label),input=el('input');input.setAttribute('aria-label','對話 '+label);input.value=(key==='copilotArgs'||key==='kiroArgs')?JSON.stringify(settings[key]??[]):String(settings[key]??'');input.required=true;fields[key]=input;wrapper.append(input);form.append(wrapper);
    }
    const save=el('button','儲存對話設定');save.type='submit';form.append(save);
    form.onsubmit=async event=>{event.preventDefault();save.disabled=true;try{const value={};for(const [key,input] of Object.entries(fields))value[key]=(key==='copilotArgs'||key==='kiroArgs')?JSON.parse(input.value):key==='timeoutMs'?Number(input.value):input.value;await saveSettings(value);note('對話設定已儲存');onSave?.();}catch(error){report(error);}finally{save.disabled=false;}};
    details.append(form);return details;
  }
  function agentSupervisorPanel(active){
    const menuContainer=el('div',undefined,'chat-agent-supervisor');menuContainer.dataset.testid='chat-agent-supervisor';
    const sectionHeader=el('div','CLI Agent Session','assistant-section-title');
    const startDetails=el('details',undefined,'chat-settings');
    startDetails.append(el('summary','＋ 啟動 CLI Agent'));
    const startForm=el('form',undefined,'chat-settings-form'),profileWrap=el('label','Agent Profile'),profileSelect=el('select');
    profileSelect.setAttribute('aria-label','CLI Agent Profile');
    for(const [val,label] of [['copilot','GitHub Copilot CLI (copilot)'],['kiro','Kiro CLI (kiro)'],['codex','OpenAI Codex CLI (codex)'],['claude','Claude Code CLI (claude)']])profileSelect.append(new Option(label,val));
    profileWrap.append(profileSelect);
    const protoWrap=el('label','互動協定'),protoSelect=el('select');
    protoSelect.setAttribute('aria-label','CLI Agent 協定');
    protoSelect.append(new Option('ACP 工作階段 (acp)','acp'),new Option('PTY 終端機 (pty)','pty'));
    protoWrap.append(protoSelect);
    const workspaceWrap=el('label','產品工作目錄'),workspaceSelect=el('select');
    workspaceSelect.setAttribute('aria-label','CLI Agent 工作目錄');workspaceSelect.append(new Option('預設工作目錄',''));workspaceWrap.append(workspaceSelect);
    const titleWrap=el('label','工作階段標題'),titleInput=el('input');
    titleInput.setAttribute('aria-label','CLI Agent 標題');titleInput.placeholder='選填標題…';titleWrap.append(titleInput);
    const promptWrap=el('label','初始派工指令'),promptInput=el('input');
    promptInput.setAttribute('aria-label','CLI Agent 初始指令');promptInput.placeholder='選填初始指令…';promptWrap.append(promptInput);
    const startBtn=el('button','啟動 CLI Agent','primary');startBtn.type='submit';
    const refreshBtn=button('重新整理工作階段',()=>void refreshSessions());
    startForm.append(profileWrap,protoWrap,workspaceWrap,titleWrap,promptWrap,startBtn,refreshBtn);
    startDetails.append(startForm);
    const listNode=el('div',undefined,'chat-agent-session-list');listNode.dataset.testid='agent-session-list';
    const detailNode=el('div',undefined,'chat-agent-session-detail');detailNode.dataset.testid='agent-session-detail';
    menuContainer.append(sectionHeader,startDetails,listNode);
    let sessions=[],selectedId=null,busy=false,terminal=null,terminalTimer,terminalResizeTimer,terminalSocket,detailVersion=0,refreshVersion=0,terminalLibrary,terminalObserver;
    async function loadTerminal(){
      if(window.Terminal&&window.FitAddon)return;
      if(!terminalLibrary)terminalLibrary=(async()=>{
        const link=document.createElement('link');link.rel='stylesheet';link.href='/repositories/xterm.css';document.head.append(link);
        await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/repositories/xterm.js';script.onload=resolve;script.onerror=reject;document.head.append(script);});
        await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/repositories/xterm-addon-fit.js';script.onload=resolve;script.onerror=reject;document.head.append(script);});
      })().catch(()=>{terminalLibrary=null;throw new Error('終端元件載入失敗。');});
      await terminalLibrary;
    }
    function clearDetail(){
      ++detailVersion;
      clearTimeout(terminalTimer);clearTimeout(terminalResizeTimer);terminalSocket?.close();terminalSocket=null;terminalObserver?.disconnect();terminalObserver=null;terminal?.dispose();terminal=null;
      detailNode.replaceChildren();
    }
    async function renderDetail(){
      clearDetail();
      const epoch=detailVersion,sessionId=selectedId;
      if(!sessionId)return;
      try{
        const snap=await api(`/agent-sessions/${encodeURIComponent(sessionId)}/events?afterSeq=0&limit=200`);
        await loadTerminal();
        if(!active()||epoch!==detailVersion)return;
        const header=el('div',undefined,'agent-session-toolbar');
        header.append(el('strong',`${snap.sessionId} · ${snap.agentName} (${snap.protocol.toUpperCase()}) · ${snap.status}${snap.pid?` · PID ${snap.pid}`:''}`));
        const live=!['STOPPED','FAILED'].includes(snap.status),actions=el('div',undefined,'agent-session-actions');
        const cancel=button('中斷目前工作',()=>void control('cancel')),stop=button('停止工作階段',()=>void control('stop'));
        cancel.disabled=stop.disabled=!live;actions.append(cancel,stop);header.append(actions);
        async function control(action){
          cancel.disabled=stop.disabled=true;
          try{await api(`/agent-sessions/${encodeURIComponent(sessionId)}/${action}`,'POST',{actor:'human'});if(epoch===detailVersion)await refreshSessions();}
          catch(error){if(epoch===detailVersion){cancel.disabled=stop.disabled=!live;report(error);}}
        }
        const screen=el('div',undefined,'agent-session-terminal');screen.dataset.testid='agent-session-terminal';
        screen.setAttribute('aria-label','CLI Agent 終端機');
        detailNode.append(header,screen);
        const interactive=live;
        const term=terminal=new window.Terminal({cursorBlink:true,scrollback:5000,fontSize:14,rightClickSelectsWord:true,disableStdin:true});
        const fitAddon=new window.FitAddon.FitAddon();
        term.loadAddon(fitAddon);
        term.open(screen);
        const fit=()=>{if(epoch===detailVersion)fitAddon.fit();};
        requestAnimationFrame(()=>requestAnimationFrame(fit));
        terminalObserver=new ResizeObserver(()=>{clearTimeout(terminalResizeTimer);terminalResizeTimer=setTimeout(fit,150);});
        terminalObserver.observe(screen);
        let painting=true,line='',inputQueue=Promise.resolve();
        const inputReady=()=>{
          const ready=interactive&&!painting&&terminalSocket?.readyState===WebSocket.OPEN;
          term.options.disableStdin=!ready;
          if(ready&&activePane==='session'&&roomsCollapsed)term.focus();
        };
        let cursor=0;
        const append=events=>{for(const event of events??[]){cursor=event.seq;if(event.kind==='output')term.write(event.content);}};
        append(snap.events);
        // Historical terminal queries must not send fresh replies to the CLI.
        term.write('',()=>{if(epoch===detailVersion){painting=false;inputReady();}});
        let finished=false;
        term.onData(data=>{
          if(painting)return;
          if(snap.protocol==='pty'){
            if(terminalSocket?.readyState===WebSocket.OPEN)terminalSocket.send(JSON.stringify({type:'input',data}));
            return;
          }
          // ACP accepts complete prompts; keep its input in the same xterm
          // surface while sending through the supervisor's message contract.
          for(const key of data.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/\r\n/g,'\r')){
            if(key==='\r'||key==='\n'){
              const message=line;line='';term.write('\r\n');
              if(message.trim())inputQueue=inputQueue.then(()=>api(`/agent-sessions/${encodeURIComponent(sessionId)}/messages`,'POST',{actor:'human',message,wait:false})).catch(report);
            }else if(key==='\x03'){line='';term.write('^C\r\n');void control('cancel');}
            else if(key==='\x7f'||key==='\b'){if(line){line=Array.from(line).slice(0,-1).join('');term.write('\b \b');}}
            else if(key>=' '){line+=key;term.write(key);}
          }
        });
        function connectTerminal(){
          if(epoch!==detailVersion)return;
          const url=new URL(`/repository-api/v1/agent-sessions/${encodeURIComponent(sessionId)}/terminal`,location.href);
          url.protocol=location.protocol==='https:'?'wss:':'ws:';url.searchParams.set('afterSeq',String(cursor));
          const socket=terminalSocket=new WebSocket(url);
          socket.onopen=()=>{if(epoch===detailVersion)inputReady();};
          socket.onmessage=event=>{
            if(epoch!==detailVersion)return;
            const message=JSON.parse(event.data);
            if(message.type==='event')append([message.event]);
            else if(message.type==='closed'){finished=true;term.options.disableStdin=true;void refreshSessions();}
            else if(message.type==='error')note(message.message,true);
          };
          socket.onclose=()=>{if(epoch===detailVersion){term.options.disableStdin=true;if(!finished)terminalTimer=setTimeout(connectTerminal,1000);}};
        }
        connectTerminal();
      }catch(e){report(e);}
    }
    async function refreshSessions(){
      const request=++refreshVersion;
      try{
        const [res,catalog]=await Promise.all([api('/agent-sessions?activeOnly=true'),api('/agent-sessions/workspaces')]);if(!active()||request!==refreshVersion)return;
        const prior=workspaceSelect.value,context=workspace(),workspaces=catalog.workspaces;
        workspaceSelect.replaceChildren(new Option(workspaces.length?'選擇產品專案':'預設工作目錄',''));
        for(const item of workspaces)workspaceSelect.append(new Option(`${item.repositoryTitle} / ${item.projectId} · ${item.cwd}`,JSON.stringify({repositoryId:item.repositoryId,projectId:item.projectId})));
        const selected=workspaces.find(item=>item.repositoryId===context.repositoryId&&item.projectId===context.projectId);
        const preferred=selected?JSON.stringify({repositoryId:selected.repositoryId,projectId:selected.projectId}):prior;
        if([...workspaceSelect.options].some(option=>option.value===preferred))workspaceSelect.value=preferred;
        if(!workspaceSelect.value&&workspaces.length===1)workspaceSelect.selectedIndex=1;
        workspaceSelect.required=workspaces.length>0;
        sessions=res.sessions??[];listNode.replaceChildren();
        if(!sessions.length){selectedId=null;listNode.append(el('p','尚無 CLI Agent Session','muted'));clearDetail();return;}
        if(!selectedId||!sessions.some(s=>s.sessionId===selectedId))selectedId=sessions[0].sessionId;
        for(const s of sessions){
          const item=button(`📁 ${s.agentName} · ${s.status}`,()=>{selectedId=s.sessionId;showPane('session');void refreshSessions();},'chat-room-link');
          item.dataset.testid='agent-session-'+s.sessionId;
          item.setAttribute('aria-current',activePane==='session'&&s.sessionId===selectedId?'true':'false');
          listNode.append(item);
        }
        if(activePane==='session')await renderDetail();
      }catch(e){if(active())report(e);}
    }
    startForm.onsubmit=async event=>{
      event.preventDefault();if(busy)return;busy=true;startBtn.disabled=true;
      try{
        const body={agentProfile:profileSelect.value,protocol:protoSelect.value};
        if(workspaceSelect.value)Object.assign(body,JSON.parse(workspaceSelect.value));
        if(titleInput.value.trim())body.title=titleInput.value.trim();
        if(promptInput.value.trim()){body.prompt=promptInput.value.trim();body.wait=true;}
        const created=await api('/agent-sessions','POST',body);
        selectedId=created.sessionId;titleInput.value='';promptInput.value='';startDetails.open=false;
        showPane('session');
        note(`已啟動 CLI Agent：${created.sessionId}`);await refreshSessions();
      }catch(e){report(e);}finally{busy=false;startBtn.disabled=false;}
    };
    return {menuNode:menuContainer,detailNode,refresh:refreshSessions};
  }
  const supervisorRoot=agentSupervisorPanel(()=>true);
  if(supervisorMenu)supervisorMenu.replaceChildren(supervisorRoot.menuNode);
  if(sessionsView)sessionsView.replaceChildren(supervisorRoot.detailNode);
  async function open(id){
    const epoch=++version;source?.close();source=null;current=id;clearSettingsMenu();showPane('chat');view.replaceChildren(el('p','載入對話…'));
    const [room,settings]=await Promise.all([api(`/chat-rooms/${encodeURIComponent(id)}`),api('/chat-settings')]);if(epoch!==version)return;
    const log=el('div',undefined,'chat-messages');log.setAttribute('role','log');log.setAttribute('aria-label','對話訊息');log.setAttribute('aria-live','polite');
    const form=el('form',undefined,'chat-composer'),input=el('textarea'),actions=el('div',undefined,'chat-composer-actions'),send=el('button','送出'),hint=el('span','Ctrl / ⌘ + Enter 送出');
    input.setAttribute('aria-label','對話訊息輸入');input.placeholder='詢問助手或派工…';input.rows=3;input.value=drafts.get(id)??'';send.type='submit';send.className='chat-send';hint.className='chat-send-hint';actions.append(hint,send);form.append(input,actions);
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
      for(const message of value.messages){const article=el('article',undefined,'chat-message chat-message-'+message.role);article.dataset.testid='chat-message-'+message.role;if(message.role!=='user')article.append(el('strong','助手'));article.append(el('p',message.content,'chat-message-content'));if(message.error){const error=el('p',`${message.status==='interrupted'?'回覆已中斷':'回覆失敗'}：${message.error}`,'error');error.setAttribute('role','alert');article.append(error);}log.append(article);}
      if(pending)log.append(el('p','助手正在回覆，訊息已儲存。','muted'));renderStreaming(value.streaming);updateButton();log.scrollTop=log.scrollHeight;
      void supervisorRoot.refresh();
    };

    form.onsubmit=async event=>{
      event.preventDefault();if(settingsSaving||pending||sending||!input.value.trim())return;const content=input.value;sending=true;updateButton();
      try{await api(`/chat-rooms/${encodeURIComponent(id)}/messages`,'POST',{content});if(input.value===content){input.value='';drafts.set(id,'');}}
      catch(error){report(error);}finally{sending=false;updateButton();}
    };
    actions.insertBefore(picker.node,send);$('#chat-settings-menu').replaceChildren(settingsPanel(settings,()=>void picker.refresh(),saveSettings));view.replaceChildren(connection,log,form);renderMessages(room);input.focus();connect(id,renderMessages,renderStreaming,connection);
  }
  $('#new-chat-room').onclick=async()=>{const submit=$('#new-chat-room');submit.disabled=true;try{showPane('chat');const room=await api('/chat-rooms','POST',{});await refreshList();await navigate(room.id);}catch(error){report(error);}finally{submit.disabled=false;}};
  return {open,refreshList,closeMenu({revealWorkspace=false}={}){setRoomsModalOpen(false);if(revealWorkspace&&getComputedStyle(drawer).getPropertyValue('--assistant-overlay').trim()==='1')setDrawerCollapsed(true);},leave(){version++;current=null;source?.close();source=null;view.replaceChildren();clearSettingsMenu();setRoomsModalOpen(false);connect();}};
}
