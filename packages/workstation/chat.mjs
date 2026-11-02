import path from 'node:path';
import {access} from 'node:fs/promises';
import {invariant} from '../contracts/index.mjs';

// The standalone UI and the Vue adapter consume the same chat application and
// schema. The standalone database remains WB_HOME/metadata.sqlite.
export async function openChat(store,home){
 try{await access(new URL('../../dist/src/application/chat.js',import.meta.url));}
 catch(error){if(error.code!=='ENOENT')throw error;invariant(false,'CHAT_BUILD_REQUIRED','聊天功能需要先執行 npm install 與 npm run build。',503);}
 const [{createChatService},{createCodexChatRuntime},{chatMigration},{defaultChatSettings}]=await Promise.all([
  import('../../dist/src/application/chat.js'),import('../../dist/src/adapters/runtime/codex-chat.js'),
  import('../../dist/src/adapters/sqlite/chat.js'),import('../../dist/src/adapters/runtime/chat-settings.js'),
 ]);
 const storage=store.chatStorage(chatMigration.steps.map(step=>step.sql).join('\n'));
 const runtime=await createCodexChatRuntime(path.join(home,'chat'));
 return createChatService(storage,runtime,defaultChatSettings());
}
