/** Browser/CLI-shared decision contract. The SD document is the canonical source. */
const marker='workbench-decisions';
const blockPattern=()=>/^```workbench-decisions\r?\n([\s\S]*?)^```[ \t]*$/gm;
const check=(condition,message,code='INVALID_DESIGN_DECISIONS',statusCode=422)=>{if(!condition)throw Object.assign(Error(message),{code,statusCode});};
const key=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value);
const text=value=>typeof value==='string'&&Boolean(value.trim())&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value);
export function validateDesignDecisions(data){
 check(data&&data.schemaVersion===1&&Array.isArray(data.items),'系統決策格式無效');const seen=new Set();
 for(const item of data.items){
  check(item&&key(item.id)&&!seen.has(item.id)&&text(item.question),'系統決策問題識別或內容無效');seen.add(item.id);
  check(Array.isArray(item.options)&&item.options.length>0,'每個未決項目須至少有一個具體選項');const options=new Set();
  if(item.context!==undefined)check(typeof item.context==='string','問題背景必須是文字');
  for(const option of item.options){check(option&&key(option.id)&&option.id!=='other'&&!options.has(option.id)&&text(option.label),'決策選項無效、重複或使用保留的 other');options.add(option.id);if(option.description!==undefined)check(typeof option.description==='string','選項說明必須是文字');}
  check(Object.hasOwn(item,'answer'),'問題必須明確標示尚未回答或已選答案');
  if(item.answer!==null){const answer=item.answer;check(answer&&typeof answer==='object'&&(options.has(answer.optionId)||answer.optionId==='other'),'所選答案不屬於本題');if(answer.optionId==='other')check(text(answer.customText),'選擇「其他」後請填寫自訂內容');else check(answer.customText===undefined,'預設選項不可混入自訂答案');}
 }
 return data;
}
export function parseDesignDecisions(content,{required=false}={}){
 check(typeof content==='string','系統文件必須是文字');const matches=[...content.matchAll(blockPattern())];
 if(!matches.length){check(!required&&!content.includes('```'+marker),'系統文件缺少有效的系統決策區塊');return null;}
 check(matches.length===1,'系統文件只能有一份系統決策區塊');let value;try{value=JSON.parse(matches[0][1]);}catch{check(false,'系統決策 JSON 無法解析');}return validateDesignDecisions(value);
}
export function writeDesignDecisions(content,data){
 validateDesignDecisions(data);const block='```'+marker+'\n'+JSON.stringify(data,null,2)+'\n```';const existing=parseDesignDecisions(content);
 return existing?content.replace(blockPattern(),()=>block):content.trimEnd()+'\n\n## 系統決策\n\n'+block+'\n';
}
export function decisionAnswer(item){return item.answer===null?null:item.answer.optionId==='other'?item.answer.customText:item.options.find(option=>option.id===item.answer.optionId).label;}
export function unresolvedDecisions(content){return parseDesignDecisions(content)?.items.filter(item=>item.answer===null)??[];}
export function assertDesignDecisionsResolved(content){const pending=unresolvedDecisions(content);check(!pending.length,'系統設計仍有未決項目：'+pending.map(item=>item.question).join('；'),'DESIGN_DECISIONS_REQUIRED',409);}
export function mergeGeneratedDecisions(previous,generated){
 const before=parseDesignDecisions(previous),next=parseDesignDecisions(generated,{required:true});
 for(const item of next.items){const prior=before?.items.find(p=>p.id===item.id);check(item.answer===null||(prior?.answer&&item.answer.optionId===prior.answer.optionId&&item.answer.customText===prior.answer.customText),'LLM 不可代替使用者回答系統決策');}
 for(const prior of before?.items??[]){const item=next.items.find(item=>item.id===prior.id);if(!item){next.items.push(prior);continue;}if(prior.answer!==null){check(item.question===prior.question&&item.options.length===prior.options.length&&item.options.every((option,index)=>['id','label','description'].every(field=>option[field]===prior.options[index][field])),'LLM 不可改寫已回答問題的語意或選項','DESIGN_DECISION_CHANGED',409);item.answer=prior.answer;}}
 return writeDesignDecisions(generated,next);
}
export function designPreviewMarkdown(content){
 const data=parseDesignDecisions(content);if(!data)return content;
 const summary=data.items.length?data.items.map(item=>`### ${item.question}\n\n${item.answer===null?'待決策':decisionAnswer(item)}`).join('\n\n'):'目前沒有未決項目。';return content.replace(blockPattern(),()=>summary);
}
