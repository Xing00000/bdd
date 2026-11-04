import type {ChatModel,ChatSettings} from '../../ports/chat.ts';

export function parseCopilotModels(result:any):ChatModel[]{
 if(!Array.isArray(result?.models)||!result.models.every((model:any)=>typeof model?.id==='string'&&model.id.trim()&&model.id.length<=160&&typeof model.name==='string'&&model.name.trim()))throw Error('Copilot 回傳的模型清單格式無效');
 if(new Set(result.models.map((model:any)=>model.id)).size!==result.models.length)throw Error('Copilot 模型識別重複');
 return result.models.map((model:any)=>({id:model.id,name:model.name,selectable:model.policy?.state!=='disabled'}));
}

// Compatibility entry point for standalone callers. The chat provider owns a
// long-lived runtime and queries models on its existing inference connection.
export async function listCopilotModels(settings:ChatSettings,cwd:string,signal:AbortSignal):Promise<ChatModel[]>{
 const {createCopilotRuntime}=await import('./copilot-chat.ts'),runtime=createCopilotRuntime(cwd);
 try{return await runtime.models(settings,signal);}finally{await runtime.close();}
}
