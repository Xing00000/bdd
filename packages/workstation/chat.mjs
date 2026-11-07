import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {access} from 'node:fs/promises';
import {invariant} from '../contracts/index.mjs';
import {openChatTools} from './chat-tools.mjs';

const supervisorScript=fileURLToPath(new URL('../../scripts/mcp-agent-supervisor.mjs',import.meta.url));

// Chat and workstation operations share the existing WB_HOME/metadata.sqlite.
export async function openChat(store,home,workstation){
 try{await access(new URL('../../dist/src/application/chat.js',import.meta.url));}
 catch(error){if(error.code!=='ENOENT')throw error;invariant(false,'CHAT_BUILD_REQUIRED','聊天功能需要先執行 npm install 與 npm run build。',503);}
 const [{createChatService},{createCodexChatRuntime},{chatMigration},{defaultChatSettings}]=await Promise.all([
  import('../../dist/src/application/chat.js'),import('../../dist/src/adapters/runtime/codex-chat.js'),
  import('../../dist/src/adapters/sqlite/chat.js'),import('../../dist/src/adapters/runtime/chat-settings.js'),
 ]);
 const storage=store.chatStorage(chatMigration.steps.map(step=>step.sql).join('\n'));
 await workstation.supervisor?.();
 const tools=await openChatTools(workstation);
 let chat;
 try{
  const runtime=await createCodexChatRuntime(path.join(home,'chat'),{...tools,home,supervisorScript},{prewarm:true});
  try{
   chat=await createChatService(storage,runtime,defaultChatSettings());
   void chat.settings().then(config=>runtime.warmup?.(config)).catch(()=>{});
  }catch(error){await runtime.close();throw error;}
 }catch(error){await tools.close();throw error;}
 return {...chat,async close(){try{await chat.close();}finally{await tools.close();}}};
}
