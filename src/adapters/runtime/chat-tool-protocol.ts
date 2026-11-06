export const workstationNamespace='mcp__workbench';
export const codexProposalNamespace='codex_proposals';
export type ProviderToolPolicy=boolean|'codex';
export interface CopilotTool {name:string;namespace:string;description:string;parameters:Record<string,unknown>}
export interface CopilotCall {toolCallId:string;mcpServerName:string;mcpToolName:string;arguments:Record<string,unknown>}
export interface CopilotCompletion {text:string;calls:CopilotCall[]}
interface CodexToolIdentity {type:'function'|'custom';name:string;namespace?:string}
export interface ProviderTool extends CopilotTool {source?:CodexToolIdentity}

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

const object=(value:any):value is Record<string,any>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const name=(value:any):value is string=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\u0000-\u001f\u007f]/.test(value);

/** Coding jobs opt in explicitly. The chat policy continues to expose only workbench tools. */
export function providerTools(value:any,policy:ProviderToolPolicy):ProviderTool[]{
 if(policy!=='codex')return workstationTools(value,policy);
 if(value===undefined)return [];
 if(!Array.isArray(value))throw Error('Codex 工具目錄格式錯誤');
 const tools:ProviderTool[]=[],identities=new Set<string>();
 const add=(tool:any,namespace?:string,namespaceDescription='')=>{
  if(!object(tool)||!['function','custom'].includes(tool.type))throw Error(`Codex API 不支援工具類型「${String(tool?.type)}」`);
  if(!name(tool.name)||(tool.description!==undefined&&typeof tool.description!=='string'))throw Error('Codex 工具定義格式錯誤');
  const source:CodexToolIdentity={type:tool.type,name:tool.name,...(namespace===undefined?{}:{namespace})};
  const key=JSON.stringify([source.type,source.namespace??null,source.name]);
  if(identities.has(key))throw Error('Codex 工具宣告重複');identities.add(key);
  let parameters:Record<string,unknown>,format='';
  if(tool.type==='function'){
   if(!object(tool.parameters)||tool.parameters.type!=='object')throw Error('Codex function 工具必須提供物件參數結構');
   parameters=structuredClone(tool.parameters);
  }else{
   if(tool.format!==undefined){
    if(!object(tool.format)||!['text','grammar'].includes(tool.format.type))throw Error('Codex custom 工具輸入格式不支援');
    if(tool.format.type==='grammar'&&(!['lark','regex'].includes(tool.format.syntax)||typeof tool.format.definition!=='string'))throw Error('Codex custom 工具語法格式錯誤');
    format='\nOriginal custom input format (follow this format exactly):\n'+JSON.stringify(tool.format);
   }
   // MCP carries a JSON object. This wrapper preserves a custom tool's raw
   // text; it does not claim to provide grammar-constrained model decoding.
   parameters={type:'object',properties:{input:{type:'string',description:'Exact raw input for the Codex custom tool. Preserve whitespace and newlines; do not JSON-encode the text again.'}},required:['input'],additionalProperties:false};
  }
  // Original namespace/name pairs can collide or exceed Copilot's 64-char
  // combined MCP name limit. Only this request's short aliases reach ACP.
  tools.push({name:'codex_tool_'+String(tools.length).padStart(4,'0'),namespace:codexProposalNamespace,source,parameters,
   description:`Propose the Codex tool ${JSON.stringify(source)}. Codex owns execution; this MCP endpoint only records the proposal.\n${namespaceDescription}\n${tool.description??''}${format}`});
 };
 for(const entry of value){
  if(entry?.type==='namespace'){
   if(!name(entry.name)||!Array.isArray(entry.tools)||(entry.description!==undefined&&typeof entry.description!=='string'))throw Error('Codex 工具命名空間格式錯誤');
   for(const tool of entry.tools)add(tool,entry.name,entry.description??'');
  }else add(entry);
 }
 return tools;
}

/** Only the documented text/function/custom history forms cross the model bridge. */
export function providerConversationInput(value:any,policy:ProviderToolPolicy){
 if(policy!=='codex')return conversationInput(value,policy);
 if(!Array.isArray(value))throw Error('Codex 必須傳送完整訊息歷史');
 const calls=new Map<string,CodexToolIdentity>(),outputs=new Set<string>();
 return value.map((item:any)=>{
  if(!object(item))throw Error('Codex 訊息格式錯誤');
  if(item.encrypted_content)throw Error('Copilot ACP 無法解讀 Codex 加密歷史');
  if(item.type==='message'){
   const message=conversationInput([item],false)[0];
   if(item.phase!==undefined&&typeof item.phase!=='string')throw Error('Codex 訊息階段格式錯誤');
   return {...message,...(item.phase===undefined?{}:{phase:item.phase})};
  }
  if(item.type==='reasoning'){
   const blocks=(parts:any,type:string)=>{if(!Array.isArray(parts)||parts.some(p=>p?.type!==type||typeof p.text!=='string'))throw Error('Codex 推理歷史必須是明文');return parts.map(p=>({type,text:p.text}));};
   return {type:item.type,summary:blocks(item.summary,'summary_text'),...(item.content===undefined?{}:{content:blocks(item.content,'reasoning_text')})};
  }
  if(item.type==='function_call'||item.type==='custom_tool_call'){
   if(!name(item.name)||(item.namespace!==undefined&&!name(item.namespace))||!name(item.call_id)||calls.has(item.call_id))throw Error('Codex 工具呼叫格式錯誤或識別重複');
   const type=item.type==='function_call'?'function':'custom';
   const identity:CodexToolIdentity={type,name:item.name,...(item.namespace===undefined?{}:{namespace:item.namespace})};
   const payload=type==='function'?item.arguments:item.input;
   if(typeof payload!=='string'||(type==='function'&&!object(JSON.parse(payload))))throw Error('Codex 工具輸入格式錯誤');
   calls.set(item.call_id,identity);
   return {type:item.type,name:identity.name,...(identity.namespace===undefined?{}:{namespace:identity.namespace}),call_id:item.call_id,...(type==='function'?{arguments:payload}:{input:payload})};
  }
  if(item.type==='function_call_output'||item.type==='custom_tool_call_output'){
   const call=calls.get(item.call_id);
   if(!call||outputs.has(item.call_id)||item.type!==(call.type==='function'?'function_call_output':'custom_tool_call_output'))throw Error('Codex 工具結果缺少同類型的對應呼叫');
   if((item.name!==undefined&&item.name!==call.name)||(item.namespace!==undefined&&item.namespace!==call.namespace))throw Error('Codex 工具結果的身分不一致');
   const output=typeof item.output==='string'?item.output:Array.isArray(item.output)&&item.output.every((part:any)=>part?.type==='input_text'&&typeof part.text==='string')?item.output.map((part:any)=>({type:part.type,text:part.text})):undefined;
   if(output===undefined)throw Error('Codex 工具結果只支援文字');outputs.add(item.call_id);
   return {type:item.type,call_id:item.call_id,output};
  }
  throw Error(`Copilot ACP 不支援 Codex 歷史類型「${String(item.type)}」`);
 });
}

/** Restore wire identity only from this request's catalog, never from model text. */
export function responseToolCall(call:CopilotCall,tools:ProviderTool[]){
 const tool=tools.find(tool=>tool.name===call.mcpToolName);
 if(!tool||!object(call.arguments))throw Error('Copilot 提出了本次未宣告的 Codex 工具');
 const source=tool.source??{type:'function',namespace:tool.namespace,name:tool.name};
 const identity={name:source.name,...(source.namespace===undefined?{}:{namespace:source.namespace}),call_id:call.toolCallId};
 if(source.type==='custom'){
  if(typeof call.arguments.input!=='string'||Object.keys(call.arguments).length!==1)throw Error('Copilot custom 工具提案必須只有原始 input 字串');
  return {type:'custom_tool_call' as const,...identity,input:call.arguments.input};
 }
 return {type:'function_call' as const,...identity,arguments:JSON.stringify(call.arguments)};
}
