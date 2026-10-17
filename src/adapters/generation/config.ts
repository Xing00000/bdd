import type {LlmOptions} from './types.ts';

export function llmFromEnvironment(env: NodeJS.ProcessEnv): LlmOptions {
  const mode=env.WB_LLM_MODE??'cli';
  if(mode==='cli')return {kind:'cli',executable:env.WB_LLM_CLI_PATH??'claude',...(env.WB_LLM_MODEL?{model:env.WB_LLM_MODEL}:{})};
  if(mode!=='http')throw new Error('WB_LLM_MODE must be cli or http');
  const apiKey=env.WB_LLM_API_KEY??env.OPENAI_API_KEY;
  if(!apiKey||!env.WB_LLM_MODEL)throw new Error('HTTP LLM mode requires an API key and WB_LLM_MODEL');
  return {apiKey,model:env.WB_LLM_MODEL,baseUrl:env.WB_LLM_BASE_URL??'https://api.openai.com/v1'};
}
