/** The sole implementation dispatch boundary: the official Codex SDK. */
import {readProgress,saveProgressPhase} from '../git-core/progress-store.mjs';
import {validateAgentRuntimeSettings} from './agent-settings.mjs';

export async function runAgentTask(context,{agent,prompt,cwd,task,timeoutMs=agent.timeoutMs,log}){
  const settings=validateAgentRuntimeSettings(agent);
  timeoutMs??=settings.timeoutMs;
  saveProgressPhase(context.options.home,context.request.operationId,{phase:'STARTING',runtime:'codex-sdk',inputDelivery:'next-turn'});
  const {runCodexSdkAgent}=await import('./codex-sdk-agent.mjs');
  const result=await runCodexSdkAgent(context,{agent:settings,prompt,cwd,task,timeoutMs,log});
  return {...result,output:result.output??readProgress(context.options.home,context.request.operationId)?.output.toString()??''};
}
