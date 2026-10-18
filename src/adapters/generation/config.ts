import type {LlmOptions} from './types.ts';

export function llmFromEnvironment(env: NodeJS.ProcessEnv): LlmOptions {
  if(env.WB_LLM_MODE&&env.WB_LLM_MODE!=='terminal')throw new Error('LLM uses web terminal CLI only; HTTP and background providers are not supported');
  return {executable:env.WB_LLM_CLI_PATH??'codex',...(env.WB_LLM_MODEL?{model:env.WB_LLM_MODEL}:{})};
}
