/** One durable submission and its execution transcript per card. */
export function interactionHistory({api,labels}) {
  const section=document.querySelector('#interaction-history'),list=document.querySelector('#interaction-list'),more=document.querySelector('#interaction-more');
  const cards=new Map();let repositoryId=null,cursor=null,generation=0;
  const active=status=>['QUEUED','RUNNING','CANCELLING'].includes(status);
  const element=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
  function parkTerminal(){const terminal=document.querySelector('#operation-terminal-details');if(terminal){terminal.hidden=true;section.append(terminal);}for(const card of cards.values())card.log.hidden=false;}
  function reset(id){generation++;parkTerminal();for(const card of cards.values())clearTimeout(card.timer);cards.clear();list.replaceChildren();repositoryId=id;cursor=null;section.hidden=!id;more.hidden=true;}
  function ensure(entry) {
    let card=cards.get(entry.id);
    if(!card) {
      const article=element('article',undefined,'interaction-card');article.dataset.interactionId=entry.id;
      const heading=element('header'),title=element('strong'),time=element('time'),status=element('span',undefined,'pill');heading.append(title,time,status);
      const message=element('pre',undefined,'interaction-message'),full=element('button','顯示完整留言');full.type='button';full.hidden=true;
      const details=element('details'),summary=element('summary','執行過程'),body=element('div'),log=element('pre','', 'interaction-log'),result=element('pre','', 'interaction-result');result.hidden=true;
      body.append(log,result);details.append(summary,body);article.append(heading,message,full,details);
      card={article,title,time,status,message,full,details,body,log,result,offset:0,entry,timer:null,loading:false};cards.set(entry.id,card);
      details.addEventListener('toggle',()=>{clearTimeout(card.timer);if(details.open||active(card.entry.status))void poll(card);});
      full.addEventListener('click',async()=>{try{const value=await api(`/operations/${entry.id}/interaction`);if(!cards.has(entry.id))return;card.fullMessage=value.message;message.textContent=value.message;full.hidden=true;}catch(error){result.hidden=false;result.textContent=error.message;}});
    }
    card.entry={...card.entry,...entry};card.title.textContent=labels[card.entry.operation]??card.entry.operation;
    card.time.textContent=card.entry.createdAt?new Date(card.entry.createdAt).toLocaleString():'';card.time.dateTime=card.entry.createdAt??'';
    card.status.textContent=card.entry.status??'QUEUED';
    card.message.textContent=card.fullMessage??(card.entry.message||card.title.textContent);card.full.hidden=card.fullMessage!==undefined||!card.entry.messageTruncated;
    return card;
  }
  async function poll(card) {
    if(card.loading||!card.details.open&&!active(card.entry.status)||!cards.has(card.entry.id))return;
    card.loading=true;const epoch=generation;
    try {
      const value=await api(`/operations/${card.entry.id}/terminal?offset=${card.offset}`);
      if(epoch!==generation)return;
      card.log.append(document.createTextNode(value.output));card.offset=value.nextOffset;card.entry.status=value.status;card.status.textContent=value.status;
      card.result.hidden=value.result===null&&!value.error;card.result.textContent=value.error?.message??(value.result===null?'':JSON.stringify(value.result,null,2));
      if(active(value.status)||card.details.open&&value.hasMore)card.timer=setTimeout(()=>void poll(card),value.hasMore?0:350);
    } catch(error){if(epoch===generation){card.result.hidden=false;card.result.textContent=error.message;if(card.details.open)card.timer=setTimeout(()=>void poll(card),1000);}}
    finally{card.loading=false;}
  }
  async function load(id,{older=false}={}) {
    if(!id){reset(null);return;}if(repositoryId!==id)reset(id);
    const epoch=generation,value=await api(`/spec-repositories/${id}/interactions${older&&cursor?`?before=${cursor}`:''}`);
    if(epoch!==generation)return;
    const entries=[...value.entries].reverse();
    for(const entry of entries){const card=ensure(entry);if(!card.article.isConnected)list.append(card.article);if(active(entry.status)&&!card.timer)void poll(card);}
    // SQL cursors establish submission order, independently of response timing.
    [...cards.values()].sort((a,b)=>(a.entry.cursor??Number.MAX_SAFE_INTEGER)-(b.entry.cursor??Number.MAX_SAFE_INTEGER)).forEach((card,index)=>{if(list.children[index]!==card.article)list.insertBefore(card.article,list.children[index]??null);});
    cursor=value.nextCursor;more.hidden=!cursor;
    section.hidden=false;
  }
  async function accepted(op) {
    if(repositoryId!==op.request?.repositoryId)reset(op.request.repositoryId);
    const card=ensure({id:op.id,operation:op.request.operation,status:op.status,createdAt:op.created_at});list.append(card.article);card.details.open=true;
    await load(repositoryId);
  }
  function attach(op) {
    if(repositoryId!==op.request.repositoryId)reset(op.request.repositoryId);
    const card=ensure({id:op.id,operation:op.request.operation,status:op.status,createdAt:op.created_at});if(!card.article.isConnected)list.append(card.article);
    if(document.querySelector('#operation-terminal-details').parentElement===card.body)return;
    parkTerminal();card.log.hidden=true;card.body.prepend(document.querySelector('#operation-terminal-details'));card.details.open=true;section.hidden=false;
  }
  more.addEventListener('click',()=>{more.disabled=true;void load(repositoryId,{older:true}).catch(error=>{more.textContent=error.message;}).finally(()=>{more.disabled=false;});});
  return {load,accepted,attach,reset};
}
