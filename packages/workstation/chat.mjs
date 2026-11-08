import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openChatTools} from './chat-tools.mjs';

const supervisorScript=fileURLToPath(new URL('../../scripts/mcp-agent-supervisor.mjs',import.meta.url));

// Chat and workstation operations share the existing WB_HOME/metadata.sqlite.
export async function openChat(store,home,workstation){
 // Node 24 loads the canonical TypeScript sources directly; chat startup must
 // not depend on compiler outputs owned by the separate application build.
 const [{createChatService},{createCodexChatRuntime},{chatMigration},{defaultChatSettings}]=await Promise.all([
  import('../../src/application/chat.ts'),import('../../src/adapters/runtime/codex-chat.ts'),
  import('../../src/adapters/sqlite/chat.ts'),import('../../src/adapters/runtime/chat-settings.ts'),
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
