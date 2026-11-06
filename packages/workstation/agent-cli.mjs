/** One dispatch boundary: Codex SDK by default; only explicit custom CLIs use argv. */
import {terminalRuntime,runPty,agentExecutable} from './development.mjs';
import {currentProgress} from '../git-core/progress.mjs';
import {readProgress,saveProgressPhase} from '../git-core/progress-store.mjs';
import {invariant} from '../contracts/index.mjs';
import {validateAgentRuntimeSettings} from './agent-settings.mjs';
import {agentArguments} from './agent-task.mjs';

export async function runAgentTask(context,{agent,prompt,cwd,task,spec=context.root,timeoutMs=agent.timeoutMs,log}){
  const settings=validateAgentRuntimeSettings(agent);
  timeoutMs??=settings.timeoutMs;
  if(settings.runtime==='codex-sdk'){
    saveProgressPhase(context.options.home,context.request.operationId,{phase:'STARTING',runtime:'codex-sdk',inputDelivery:'next-turn'});
    const {runCodexSdkAgent}=await import('./codex-sdk-agent.mjs');
    // SDK failures remain failures. A fallback CLI would change the approved execution contract.
    const result=await runCodexSdkAgent(context,{agent:settings,prompt,cwd,task,timeoutMs,log});
    return {...result,output:result.output??readProgress(context.options.home,context.request.operationId)?.output.toString()??''};
  }
  const command=await agentExecutable(settings.command),args=agentArguments(settings,{prompt,spec,project:cwd,task});
  return runInteractiveAgent(context,command,args,cwd,timeoutMs,{log});
}

export async function runInteractiveAgent(context,command,args,cwd,timeoutMs,{log}={}){
  const {options,store,request}=context,progress=currentProgress();
  invariant(progress,'PROGRESS_REQUIRED','CLI execution requires a durable progress session');
  const pty=await terminalRuntime(context);
  saveProgressPhase(options.home,request.operationId,{phase:'RUNNING',runtime:'custom-cli'});
  const outcome=await runPty(pty,command,args,cwd,{timeoutMs,log:log??(data=>progress.output(data)),onInputDelivered:(id,previous)=>store.acknowledgeInput(request.operationId,id,previous)});
  saveProgressPhase(options.home,request.operationId,{phase:'CHECKING',runtime:'custom-cli'});
  return {...outcome,output:readProgress(options.home,request.operationId).output.toString()};
}
