import {parseDesignDecisions,writeDesignDecisions,unresolvedDecisions,designPreviewMarkdown} from './design-decisions.js';

export function systemDesignView({el,onChange,onSave,onModeChange}){
 const editor=document.querySelector('#source-editor'),controls=document.querySelector('#design-controls'),frame=document.querySelector('#design-preview'),questions=document.querySelector('#design-questions'),previewButton=document.querySelector('#design-preview-button'),editButton=document.querySelector('#design-edit-button');
 const markdown=window.markdownit({html:false,linkify:false});let active=false,editable=false,mode='preview';
 function ready(){try{return unresolvedDecisions(editor.value).length===0;}catch{return false;}}
 function preview(){
  let content;try{content=designPreviewMarkdown(editor.value);}catch(error){content=editor.value;}
  const html=markdown.render(content);
  frame.srcdoc='<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; img-src data:"><style>body{font:14px/1.8 -apple-system,BlinkMacSystemFont,sans-serif;color:#262626;margin:20px;overflow-wrap:anywhere}h1{font-size:26px}h2{font-size:20px;border-bottom:1px solid #ddd;padding-bottom:6px}pre{white-space:pre-wrap;background:#f5f5f5;padding:12px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px}a{color:#225d9a}img{max-width:100%}</style></head><body>'+html+'</body></html>';
 }
 function renderQuestions(){
  questions.replaceChildren();let data;try{data=parseDesignDecisions(editor.value);}catch(error){const note=el('p',error.message,'error');note.setAttribute('role','alert');questions.append(note);return;}
  if(!data?.items.length)return;
  questions.append(el('h2','系統決策'),el('p','請回答未決項目。每題均可選「其他」自訂內容；不會預選或代替你確認。','muted'));
  const status=el('p',undefined,'muted');status.setAttribute('role','status');questions.append(status);
  const update=()=>{editor.value=writeDesignDecisions(editor.value,data);status.textContent=`未決項目：${data.items.filter(item=>item.answer===null).length} / ${data.items.length}`;onChange();preview();};
  for(const item of data.items){
   const fieldset=el('fieldset');fieldset.disabled=!editable;fieldset.append(el('legend',item.question));if(item.context)fieldset.append(el('p',item.context,'muted'));
   const custom=el('input');custom.type='text';custom.setAttribute('aria-label','其他：'+item.question);custom.placeholder='請輸入你的決策';custom.value=item.answer?.customText??'';custom.disabled=item.answer?.optionId!=='other'||!editable;
   const select=optionId=>{custom.disabled=optionId!=='other'||!editable;custom.required=optionId==='other';item.answer=optionId==='other'?(custom.value.trim()?{optionId,customText:custom.value}:null):{optionId};update();};
   for(const option of [...item.options,{id:'other',label:'其他'}]){const label=el('label',undefined,'check'),radio=el('input');radio.type='radio';radio.name='decision-'+item.id;radio.value=option.id;radio.checked=item.answer?.optionId===option.id;radio.onchange=()=>select(option.id);label.append(radio,document.createTextNode(option.label));fieldset.append(label);if(option.description)fieldset.append(el('p',option.description,'muted'));}
   custom.oninput=()=>select('other');fieldset.append(custom);questions.append(fieldset);
  }
  status.textContent=`未決項目：${data.items.filter(item=>item.answer===null).length} / ${data.items.length}`;
  if(editable){const save=el('button','儲存系統決策');save.type='button';save.onclick=()=>onSave();questions.append(save);}
 }
 function render(){controls.hidden=!active;frame.hidden=!active||mode!=='preview';questions.hidden=!active||mode!=='preview';editor.hidden=active&&mode==='preview';if(!active)return;editButton.hidden=!editable||mode==='edit';previewButton.setAttribute('aria-pressed',String(mode==='preview'));editButton.setAttribute('aria-pressed',String(mode==='edit'));if(mode==='preview'){preview();renderQuestions();}}
 previewButton.onclick=()=>{mode='preview';render();onModeChange();};editButton.onclick=()=>{if(editable){mode='edit';render();onModeChange();editor.focus();}};
 return {load({isDesign,canEdit}){active=isDesign;editable=canEdit;mode='preview';render();},generated(){mode='preview';render();},reset(){active=false;mode='preview';render();},editing:()=>active&&mode==='edit',ready};
}
