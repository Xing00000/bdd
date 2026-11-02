import {createInterface} from 'node:readline';
import type {ChatSettings} from '../../ports/chat.ts';
import {spawnChatProcess} from './chat-process.ts';

// Tool names from Copilot CLI 1.0.105 and the official CLI command reference.
const excludedTools=['bash','powershell','list_bash','list_powershell','read_bash','read_powershell','stop_bash','stop_powershell','write_bash','write_powershell','apply_patch','create','edit','view','list_agents','read_agent','task','write_agent','ask_user','glob','grep','rg','skill','web_fetch','fetch_copilot_cli_documentation','search_code_subagent','semantic_code_search','run_dynamic_workflow','dynamic_workflows_manage','sql','session_store_sql'];

export async function copilotText(settings:ChatSettings,prompt:string,cwd:string,signal:AbortSignal):Promise<string>{
 const args=[...settings.copilotArgs,'--model',settings.model,'--disable-builtin-mcps','--no-custom-instructions','--no-ask-user','--no-auto-update','--output-format','json','--excluded-tools='+excludedTools.join(','),'--deny-tool=read','--deny-tool=write','--deny-tool=shell','--deny-tool=url','--deny-tool=memory'];
 return new Promise((resolve,reject)=>{
  const child=spawnChatProcess(settings.copilotExecutable,args,{cwd,signal});
  let answer='',failure:Error|undefined,finished=false;
  const stop=(error:Error)=>{failure=error;child.terminate();};
  child.stdin.on('error',error=>stop(error));child.stderr.resume();
  const lines=createInterface({input:child.stdout});
  lines.on('line',line=>{
   try{
    const event=JSON.parse(line);
    if(event.type==='tool.execution_start'||event.type==='tool.execution_complete')return stop(Error('文字聊天不支援工具呼叫'));
    if(event.type==='session.error')return stop(Error(event.data?.message??'Copilot 工作階段失敗'));
    if(event.type==='assistant.message'){
     if(event.data?.toolRequests?.length)return stop(Error('Copilot 要求不支援的工具呼叫'));
     if(typeof event.data?.content!=='string')return stop(Error('Copilot 回覆格式錯誤'));
     answer+=event.data.content;
    }
    if(event.type==='result'){finished=event.exitCode===0;if(!finished)stop(Error('Copilot 回覆未完成'));}
   }catch(error){stop(error instanceof Error?error:Error(String(error)));}
  });
  child.on('error',error=>stop(Error(`無法執行 Copilot：${error.message}`)));
  child.on('close',async code=>{lines.close();try{await child.finished;}catch(error){reject(error);return;}if(failure)return reject(failure);if(code!==0||!finished||!answer.trim())return reject(Error(`Copilot 未完成回覆（exit ${code}）；請確認 CLI 登入、模型權限與設定`));resolve(answer);});
  // Piped prompts avoid command-line length limits for long Codex histories.
  child.stdin.end(prompt);
 });
}
