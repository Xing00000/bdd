import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

export const workstationNamespace='mcp__workbench';
export const agentSupervisorNamespace='mcp__agent_supervisor';
export const codexProposalNamespace='codex_proposals';
export type ProviderToolPolicy=boolean|'codex';
export interface CopilotTool {name:string;namespace:string;description:string;parameters:Record<string,unknown>}
export interface CopilotCall {toolCallId:string;mcpServerName:string;mcpToolName:string;arguments:Record<string,unknown>}
export interface CopilotCompletion {text:string;calls:CopilotCall[];validation?:{rejectedProposals:number}}
interface CodexToolIdentity {type:'function'|'custom';name:string;namespace?:string}
export interface ProviderTool extends CopilotTool {source?:CodexToolIdentity}

const allowedChatNamespaces=new Set([workstationNamespace,agentSupervisorNamespace]);

export function workstationTools(value:any,enabled:boolean):ProviderTool[]{
 if(!enabled)return [];
 if(value===undefined)return [];
 if(!Array.isArray(value))throw Error('Codex 工具目錄格式錯誤');
 const out:ProviderTool[]=[];
 for(const t of value){
  if(t?.type==='namespace'&&allowedChatNamespaces.has(t.name)){
   if(!Array.isArray(t.tools))throw Error('Codex 工作站工具目錄格式錯誤');
   for(const f of t.tools){
    if(f?.type!=='function'||typeof f.name!=='string'||typeof f.description!=='string'||!f.parameters||f.parameters.type!=='object')throw Error('Codex 工作站工具定義錯誤');
    out.push({name:f.name,namespace:t.name,description:f.description,parameters:f.parameters});
   }
  }else if(t?.type==='function'&&typeof t.name==='string'&&(t.name.startsWith('mcp__workbench__')||t.name.startsWith('mcp__agent_supervisor__'))){
   if(typeof t.description!=='string'||!t.parameters||t.parameters.type!=='object')throw Error('Codex 工作站工具定義錯誤');
   const ns=t.name.startsWith('mcp__agent_supervisor__')?agentSupervisorNamespace:workstationNamespace;
   const shortName=t.name.slice(ns.length+2);
   out.push({name:shortName,namespace:ns,description:t.description,parameters:t.parameters,source:{type:'function',name:t.name}});
  }
 }
 return out;
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
   const validNamespace=allowedChatNamespaces.has(item.namespace)||(item.namespace===undefined&&typeof item.name==='string'&&(item.name.startsWith('mcp__workbench__')||item.name.startsWith('mcp__agent_supervisor__')));
   if(!validNamespace||typeof item.name!=='string'||typeof item.call_id!=='string'||!item.call_id||calls.has(item.call_id)||typeof item.arguments!=='string')throw Error('不支援工具或工具呼叫格式錯誤');
   const args=JSON.parse(item.arguments);if(!args||typeof args!=='object'||Array.isArray(args))throw Error('工具參數必須是物件');calls.add(item.call_id);
   return {type:item.type,...(item.namespace===undefined?{}:{namespace:item.namespace}),name:item.name,call_id:item.call_id,arguments:item.arguments};
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
   description:`Propose the Codex tool ${JSON.stringify(source)} by returning the JSON tool_calls text envelope. Codex owns execution.\n${namespaceDescription}\n${tool.description??''}${format}`});
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

function matchDeclaredTool(rawCall:any,tools:ProviderTool[]):ProviderTool|undefined{
 if(!object(rawCall)||typeof rawCall.name!=='string')return undefined;
 const direct=tools.find(tool=>tool.name===rawCall.name);
 if(direct)return direct;
 const bySource=tools.filter(tool=>tool.source&&tool.source.name===rawCall.name&&(rawCall.namespace===undefined||tool.source.namespace===rawCall.namespace));
 if(bySource.length===1)return bySource[0];
 return tools.find(tool=>tool.source?.namespace&&`${tool.source.namespace}__${tool.source.name}`===rawCall.name);
}

function isConflictingCodexBoilerplateOnly(text:string):boolean{
 if(text.includes('Do not invoke Git')||text.includes('<permissions instructions>')||text.includes('approval_policy')||text.includes('sandbox_mode')||text.includes('workbench_task')||text.includes('agent_supervisor'))return false;
 return (text.startsWith('You are a coding agent running in the Codex CLI')&&text.includes('How you work'))||text.startsWith('<skills_instructions>');
}

function validateValueAgainstPropSchema(value:unknown,propSchema:any):boolean{
 if(!object(propSchema))return true;
 if(Array.isArray(propSchema.enum)&&!propSchema.enum.includes(value))return false;
 const type=propSchema.type;
 if(type==='string'){
  if(typeof value!=='string')return false;
  if(typeof propSchema.minLength==='number'&&value.length<propSchema.minLength)return false;
  if(typeof propSchema.maxLength==='number'&&value.length>propSchema.maxLength)return false;
  return true;
 }
 if(type==='integer'){
  if(typeof value!=='number'||!Number.isInteger(value))return false;
  if(typeof propSchema.minimum==='number'&&value<propSchema.minimum)return false;
  if(typeof propSchema.maximum==='number'&&value>propSchema.maximum)return false;
  return true;
 }
 if(type==='number'){
  if(typeof value!=='number'||!Number.isFinite(value))return false;
  if(typeof propSchema.minimum==='number'&&value<propSchema.minimum)return false;
  if(typeof propSchema.maximum==='number'&&value>propSchema.maximum)return false;
  return true;
 }
 if(type==='boolean')return typeof value==='boolean';
 if(type==='array'){
  if(!Array.isArray(value))return false;
  if(object(propSchema.items))return value.every(item=>validateValueAgainstPropSchema(item,propSchema.items));
  return true;
 }
 if(type==='object')return validateArgumentsAgainstSchema(value,propSchema);
 return true;
}

function validateArgumentsAgainstSchema(args:unknown,schema:any):args is Record<string,unknown>{
 if(!object(args))return false;
 if(!object(schema))return true;
 const required=Array.isArray(schema.required)?schema.required:[];
 for(const key of required){
  if(typeof key==='string'&&(!Object.hasOwn(args,key)||args[key]===undefined))return false;
 }
 const properties=object(schema.properties)?schema.properties:undefined;
 if(schema.additionalProperties===false&&properties){
  for(const key of Object.keys(args)){
   if(!Object.hasOwn(properties,key))return false;
  }
 }
 if(properties){
  for(const [key,val] of Object.entries(args)){
   if(val!==undefined&&Object.hasOwn(properties,key)&&!validateValueAgainstPropSchema(val,properties[key]))return false;
  }
 }
 return true;
}

function normalizeHistoryForEnvelope(input:unknown,tools:ProviderTool[]){
 if(!Array.isArray(input))return [];
 return input.map((item:any)=>{
  if(!object(item))return item;
  if(item.type==='function_call'||item.type==='custom_tool_call'){
   const matched=matchDeclaredTool(item,tools),name=matched?.name??item.name;
   const args=item.type==='custom_tool_call'?{input:item.input}:JSON.parse(item.arguments??'{}');
   return {role:'assistant',call_id:item.call_id,envelope:{type:'tool_calls',calls:[{name,arguments:args}]}};
  }
  if(item.type==='function_call_output'||item.type==='custom_tool_call_output'){
   return {role:'tool_result',call_id:item.call_id,output:item.output};
  }
  if(item.type==='message'&&item.role==='developer'&&Array.isArray(item.content)){
   const text=item.content.map((part:any)=>part?.text??'').join('\n');
   if(isConflictingCodexBoilerplateOnly(text))return null;
  }
  return item;
 }).filter(Boolean);
}

/** Embed declared tools as a pure text/JSON inference contract without any Copilot MCP servers. */
export function formatInferencePrompt(prompt:string,tools:ProviderTool[]):string{
 if(!tools.length)return prompt;
 const catalog=tools.map(tool=>({name:tool.name,...(tool.source?{source:tool.source}:{}),description:tool.description,parameters:tool.parameters}));
 const responseContract={
  mode:'pure_inference_json_envelope',
  rule:'You have NO native or MCP tools on this transport. Output exactly one valid JSON value matching outputSchema, without preamble, Markdown fences or trailing text. Select only declared tools. Follow the selected tool parameters and the node responseSchema from its result. Serialize strings with JSON escaping and balance all object/array delimiters; never append another envelope or extra closing delimiters. Use the message variant only after all requested tool steps are complete.',
  outputSchema:{oneOf:[
   {type:'object',properties:{type:{const:'tool_calls'},calls:{type:'array',minItems:1,items:{oneOf:catalog.map(tool=>({type:'object',properties:{name:{const:tool.name},arguments:tool.parameters},required:['name','arguments'],additionalProperties:false}))}}},required:['type','calls'],additionalProperties:false},
   {type:'object',properties:{type:{const:'message'},text:{type:'string'}},required:['type','text'],additionalProperties:false}
  ]},
 };
 const newline=prompt.indexOf('\n{');
 if(newline>=0){
  try{
   const payload=JSON.parse(prompt.slice(newline+1));
   const sanitizedInput=Array.isArray(payload.input)?payload.input.map((item:any)=>{
    if(item?.type==='message'&&item.role==='developer'&&Array.isArray(item.content)){
     const text=item.content.map((part:any)=>part?.text??'').join('\n');
     if(isConflictingCodexBoilerplateOnly(text)){
      if(text.startsWith('<skills_instructions>'))return null;
      return {...item,content:[{type:'input_text',text:'You are a coding agent running in the Codex CLI. Follow responseContract and normalizedHistory strictly.'}]};
     }
    }
    return item;
   }).filter(Boolean):payload.input;
   return prompt.slice(0,newline+1)+JSON.stringify({...payload,input:sanitizedInput,tools:catalog,normalizedHistory:normalizeHistoryForEnvelope(payload.input,tools),responseContract});
  }catch{ /* Fall through to two-line wrapper if prompt tail is not JSON. */ }
 }
 return `${prompt}\n${JSON.stringify({tools:catalog,responseContract})}`;
}

const copilotStartupNotice=/^(?:Info: (?:Disabled tools: [^\n{]*|Unknown tool name in the tool allowlist: "[^"]*")\s*)+/;
const allowedCallKeys=new Set(['id','name','namespace','arguments','input']);

/** Serialization rejection is distinct from authorization and schema failures. */
export class InferenceEnvelopeJSONError extends Error {
 readonly toolProposal:boolean;
 constructor(toolProposal:boolean){super('Copilot 要求未授權或無效的工具提案：工具提案不是有效 JSON');this.toolProposal=toolProposal;}
}

/** Parse pure text inference output and validate any proposed tool calls against the declared catalog and JSON Schema. */
export function parseInferenceCompletion(rawText:string,tools:ProviderTool[]):CopilotCompletion{
 if(!tools.length){
  if(!rawText.trim())throw Error('Copilot 未完成回覆');
  return {text:rawText,calls:[]};
 }
 const cleaned=rawText.replace(copilotStartupNotice,'').trim();
 if(!cleaned)throw Error('Copilot 未完成回覆');
 const unfenced=cleaned.replace(/^```(?:json)?\s*|\s*```$/g,'').trim();
 const looksLikeEnvelope=unfenced.startsWith('{"type":')||unfenced.startsWith('{"type" :')||/\{\s*"type"\s*:\s*"tool_calls"/.test(unfenced);
 const envelopeIndex=Math.max(
  unfenced.lastIndexOf('{"type":"tool_calls"'),
  unfenced.lastIndexOf('{"type": "tool_calls"'),
  unfenced.lastIndexOf('{"type":"message"'),
  unfenced.lastIndexOf('{"type": "message"'),
 );
 const candidate=envelopeIndex>=0?unfenced.slice(envelopeIndex):(unfenced.startsWith('{')&&unfenced.endsWith('}')?unfenced:'');
 if(candidate||looksLikeEnvelope){
  let parsed:any;
  try{parsed=JSON.parse(candidate||unfenced);}catch{
   if(looksLikeEnvelope||envelopeIndex>=0)throw new InferenceEnvelopeJSONError(/\{\s*"type"\s*:\s*"tool_calls"/.test(candidate||unfenced));
   parsed=undefined;
  }
  if(!object(parsed)){
   if(looksLikeEnvelope||envelopeIndex>=0)throw Error('Copilot 要求未授權或無效的工具提案');
   return {text:rawText,calls:[]};
  }
  if(parsed.type==='tool_calls'){
   if(Object.keys(parsed).some(k=>k!=='type'&&k!=='calls')||!Array.isArray(parsed.calls)||!parsed.calls.length)throw Error('Copilot 要求未授權或無效的工具提案');
   const calls:CopilotCall[]=[],declared=new Map<string,{name:string;args:Record<string,unknown>}>();
   for(const rawCall of parsed.calls){
    if(!object(rawCall)||Object.keys(rawCall).some(k=>!allowedCallKeys.has(k)))throw Error('Copilot 要求未授權或無效的工具提案');
    const matched=matchDeclaredTool(rawCall,tools);
    const args=matched?.source?.type==='custom'&&rawCall?.arguments===undefined&&typeof rawCall?.input==='string'?{input:rawCall.input}:rawCall?.arguments;
    if(!matched)throw Error('Copilot 要求未授權的工具');
    if(!validateArgumentsAgainstSchema(args,matched.parameters))throw Error('Copilot 要求未授權或無效的工具提案：工具參數不符合契約');
    const explicitId=typeof rawCall.id==='string'&&rawCall.id?rawCall.id:undefined;
    if(explicitId&&declared.has(explicitId)){
     const known=declared.get(explicitId)!;
     if(known.name!==matched.name||!isDeepStrictEqual(known.args,args))throw Error('Copilot ACP 工具提案參數不一致');
     continue;
    }
    const previous=[...declared].find(([,item])=>item.name===matched.name&&isDeepStrictEqual(item.args,args));
    const id=explicitId??previous?.[0]??'call_'+randomUUID();
    declared.set(id,{name:matched.name,args:structuredClone(args)});
    if(!calls.some(call=>call.toolCallId===id))calls.push({toolCallId:id,mcpServerName:'codex_handoff',mcpToolName:matched.name,arguments:structuredClone(args)});
    if(calls.length>32)throw Error('Copilot 工具提案超過數量限制');
   }
   return {text:'',calls};
  }
  if(parsed.type==='message'){
   if(Object.keys(parsed).some(k=>k!=='type'&&k!=='text')||typeof parsed.text!=='string')throw Error('Copilot 要求未授權或無效的工具提案');
   if(!parsed.text.trim())throw Error('Copilot 未完成回覆');
   return {text:parsed.text,calls:[]};
  }
  if(looksLikeEnvelope)throw Error('Copilot 要求未授權或無效的工具提案');
 }
 return {text:rawText,calls:[]};
}
