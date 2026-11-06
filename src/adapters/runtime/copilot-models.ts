import type {ChatModel,ChatSettings} from '../../ports/chat.ts';

export function parseCopilotModels(result:any):ChatModel[]{
 const option=modelConfigOption(result);
 if(!option&&result?.models!==undefined&&!Array.isArray(result.models?.availableModels))throw Error('Copilot ACP 回傳的模型清單格式無效');
 const models=option?flattenOptions(option.options).map((model:any)=>({id:model?.value,name:model?.name})):
  result?.models?.availableModels?.map((model:any)=>({id:model?.modelId,name:model?.name}));
 // ACP providers such as a locally configured BYOK server may expose no
 // model selector. Keep their default; do not invent a model catalog.
 if(models===undefined)return [];
 if(!Array.isArray(models)||!models.every((model:any)=>typeof model?.id==='string'&&model.id.trim()&&model.id.length<=160&&typeof model.name==='string'&&model.name.trim()))throw Error('Copilot ACP 回傳的模型清單格式無效');
 if(new Set(models.map((model:any)=>model.id)).size!==models.length)throw Error('Copilot ACP 模型識別重複');
 return models.map((model:any)=>({id:model.id,name:model.name,selectable:true}));
}

export function modelConfigOption(result:any):any|undefined{
 if(result?.configOptions===undefined)return undefined;
 if(!Array.isArray(result.configOptions))throw Error('Copilot ACP 模型清單格式無效');
 const models=result.configOptions.filter((option:any)=>option?.category==='model');
 if(models.length>1)throw Error('Copilot ACP 模型設定重複');
 const option=models[0];
 if(option&&(option.type!=='select'||typeof option.id!=='string'||!option.id||!Array.isArray(option.options)))throw Error('Copilot ACP 模型清單格式無效');
 return option;
}
function flattenOptions(options:any[]):any[]{
 return options.flatMap(option=>Array.isArray(option?.options)?option.options:[option]);
}

// Compatibility entry point for standalone callers. The chat provider owns a
// long-lived runtime and queries models on its existing inference connection.
export async function listCopilotModels(settings:ChatSettings,cwd:string,signal:AbortSignal):Promise<ChatModel[]>{
 const {createCopilotRuntime}=await import('./copilot-chat.ts'),runtime=createCopilotRuntime(cwd);
 try{return await runtime.models(settings,signal);}finally{await runtime.close();}
}
