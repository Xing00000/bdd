import {createInterface} from 'node:readline';
import type {ChatSettings} from '../../ports/chat.ts';
import {spawnChatProcess} from './chat-process.ts';
import {createCopilotCatalog} from './copilot-catalog.ts';
import type {CopilotTool,CopilotCall,CopilotCompletion} from './chat-tool-protocol.ts';

export async function copilotCompletion(settings:ChatSettings,prompt:string,cwd:string,signal:AbortSignal,tools:CopilotTool[],onDelta?:(delta:string)=>void):Promise<CopilotCompletion>{
 // Always override this name, including text-only/compaction calls, so a user
 // MCP configuration with the same name can never become the executor.
 const catalog=await createCopilotCatalog(tools);
 const args=[...settings.copilotArgs,'--model',settings.model,'--disable-builtin-mcps','--no-custom-instructions','--no-ask-user','--no-auto-update','--stream','on','--output-format','json','--available-tools=codex_handoff','--deny-tool=read','--deny-tool=write','--deny-tool=shell','--deny-tool=url','--deny-tool=memory','--additional-mcp-config',JSON.stringify(catalog.config),'--allow-tool=codex_handoff'];
 try{return await new Promise((resolve,reject)=>{
  const child=spawnChatProcess(settings.copilotExecutable,args,{cwd,signal});
  let answer='',failure:Error|undefined,finished=false,calls:CopilotCall[]=[];
  const stop=(error:Error)=>{failure=error;child.terminate();};
  child.stdin.on('error',error=>stop(error));child.stderr.resume();
  const deltas=new Map<string,string>();
  const lines=createInterface({input:child.stdout});
  lines.on('line',line=>{
   try{
    const event=JSON.parse(line);
    if(event.type==='tool.execution_start'||event.type==='tool.execution_complete'){
     const call=calls.find(c=>c.toolCallId===event.data?.toolCallId);
     if(!call||(event.type==='tool.execution_start'&&(event.data?.mcpServerName!=='codex_handoff'||event.data?.mcpToolName!==call.mcpToolName)))return stop(Error('Copilot 不得執行工作站工具'));
    }
    if(event.type==='session.error')return stop(Error(event.data?.message??'Copilot 工作階段失敗'));
    if(event.type==='assistant.message_delta'){
     if(typeof event.data?.messageId!=='string'||typeof event.data?.deltaContent!=='string')return stop(Error('Copilot 增量格式錯誤'));
     deltas.set(event.data.messageId,(deltas.get(event.data.messageId)??'')+event.data.deltaContent);onDelta?.(event.data.deltaContent);
    }
    if(event.type==='assistant.message'){
     if(typeof event.data?.content!=='string')return stop(Error('Copilot 回覆格式錯誤'));
     const streamed=deltas.get(event.data.messageId);
     if(streamed!==undefined&&streamed!==event.data.content)return stop(Error('Copilot 增量與完成訊息不一致'));
     if(streamed===undefined&&event.data.content)onDelta?.(event.data.content);
     answer+=event.data.content;
     if(event.data.toolRequests?.length){
      const requested=event.data.toolRequests as CopilotCall[],ids=new Set<string>();
      for(const call of requested){
       if(call.mcpServerName!=='codex_handoff'||!tools.some(t=>t.name===call.mcpToolName)||typeof call.toolCallId!=='string'||!call.toolCallId||ids.has(call.toolCallId)||!call.arguments||typeof call.arguments!=='object'||Array.isArray(call.arguments))return stop(Error('Copilot 要求未授權或無效的工具呼叫'));
       ids.add(call.toolCallId);
      }
      calls=requested;child.terminate();
     }
    }
    if(event.type==='result'){finished=event.exitCode===0;if(!finished&&!calls.length)stop(Error('Copilot 回覆未完成'));}
   }catch(error){stop(error instanceof Error?error:Error(String(error)));}
  });
  child.on('error',error=>stop(Error(`無法執行 Copilot：${error.message}`)));
  child.on('close',async code=>{lines.close();try{await child.finished;}catch(error){reject(error);return;}if(failure)return reject(failure);if(signal.aborted)return reject(Error('Copilot 推論已取消'));if(!calls.length&&(code!==0||!finished||!answer.trim()))return reject(Error(`Copilot 未完成回覆（exit ${code}）；請確認 CLI 登入、模型權限與設定`));resolve({text:answer,calls});});
  // Piped prompts avoid command-line length limits for long Codex histories.
  child.stdin.end(prompt);
 });}finally{await catalog.close();}
}
