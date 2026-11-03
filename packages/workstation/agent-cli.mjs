/** All dispatched authoring agents share the same PTY, input receipts and SQL log. */
import {terminalRuntime,runPty} from './development.mjs';
import {currentProgress} from '../git-core/progress.mjs';
import {readProgress,saveProgressPhase} from '../git-core/progress-store.mjs';
import {invariant} from '../contracts/index.mjs';

export async function runInteractiveAgent(context,command,args,cwd,timeoutMs){
  const {options,store,request}=context,progress=currentProgress();
  invariant(progress,'PROGRESS_REQUIRED','CLI execution requires a durable progress session');
  const pty=await terminalRuntime(context);
  saveProgressPhase(options.home,request.operationId,{phase:'RUNNING'});
  const outcome=await runPty(pty,command,args,cwd,{timeoutMs,log:data=>progress.output(data),onInputDelivered:(id,previous)=>store.acknowledgeInput(request.operationId,id,previous)});
  saveProgressPhase(options.home,request.operationId,{phase:'CHECKING'});
  return {...outcome,output:readProgress(options.home,request.operationId).output.toString()};
}
