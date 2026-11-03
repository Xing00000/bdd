export const workstationNamespace='mcp__workbench';
export interface CopilotTool {name:string;namespace:string;description:string;parameters:Record<string,unknown>}
export interface CopilotCall {toolCallId:string;mcpServerName:string;mcpToolName:string;arguments:Record<string,unknown>}
export interface CopilotCompletion {text:string;calls:CopilotCall[]}

export function workstationTools(value:any,enabled:boolean):CopilotTool[]{
 if(!enabled)return [];
 if(value===undefined)return [];
 if(!Array.isArray(value))throw Error('Codex 工具目錄格式錯誤');
 return value.filter(t=>t.type==='namespace'&&t.name===workstationNamespace).flatMap(t=>{
  if(!Array.isArray(t.tools))throw Error('Codex 工作站工具目錄格式錯誤');
  return t.tools.map((f:any)=>{
   if(f.type!=='function'||typeof f.name!=='string'||typeof f.description!=='string'||!f.parameters||f.parameters.type!=='object')throw Error('Codex 工作站工具定義錯誤');
   return {name:f.name,namespace:t.name,description:f.description,parameters:f.parameters};
  });
 });
}

export function conversationInput(value:any,toolsEnabled:boolean){
 if(!Array.isArray(value))throw Error('Codex 必須傳送完整訊息歷史');
 const calls=new Set<string>(),outputs=new Set<string>();
 return value.map((item:any)=>{
  if(item?.type==='message'){
   if(!['user','assistant','developer','system'].includes(item.role)||!Array.isArray(item.content))throw Error('聊天訊息格式錯誤');
   const content=item.content.map((part:any)=>{if(!['input_text','output_text'].includes(part.type)||typeof part.text!=='string')throw Error('聊天只接受文字內容');return {type:part.type,text:part.text};});
   return {type:item.type,role:item.role,content};
  }
  if(!toolsEnabled)throw Error('此聊天執行環境不支援工具項目');
  if(item?.type==='function_call'){
   if(item.namespace!==workstationNamespace||typeof item.name!=='string'||typeof item.call_id!=='string'||!item.call_id||calls.has(item.call_id)||typeof item.arguments!=='string')throw Error('不支援工具或工具呼叫格式錯誤');
   const args=JSON.parse(item.arguments);if(!args||typeof args!=='object'||Array.isArray(args))throw Error('工具參數必須是物件');calls.add(item.call_id);
   return {type:item.type,namespace:item.namespace,name:item.name,call_id:item.call_id,arguments:item.arguments};
  }
  if(item?.type==='function_call_output'){
   if(!calls.has(item.call_id)||outputs.has(item.call_id))throw Error('工具結果缺少對應呼叫');
   let output=item.output;
   if(Array.isArray(output)&&output.every((p:any)=>p.type==='input_text'&&typeof p.text==='string'))output=output.map((p:any)=>p.text).join('\n');
   if(typeof output!=='string')throw Error('工具結果不是文字');outputs.add(item.call_id);
   return {type:item.type,call_id:item.call_id,output};
  }
  throw Error('聊天不支援此非文字協定項目');
 });
}
