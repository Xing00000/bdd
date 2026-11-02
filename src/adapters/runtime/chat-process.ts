import {spawn} from 'node:child_process';
import {chatLimits} from '../../domain/chat.ts';

// Copilot's npm loader starts a native child synchronously. Terminating only
// the loader leaves inference running; own the whole process group on Unix.
export function spawnChatProcess(executable:string,args:string[],options:{cwd:string;signal:AbortSignal;env?:NodeJS.ProcessEnv}){
 const child=spawn(executable,args,{...options,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});
 let escalation:ReturnType<typeof setTimeout>|undefined,poll:ReturnType<typeof setTimeout>|undefined,terminating=false,closed=false,escalated=false;
 let resolveFinished:()=>void,rejectFinished:(error:Error)=>void,signalError:Error|undefined;
 const finished=new Promise<void>((resolve,reject)=>{resolveFinished=resolve;rejectFinished=reject;});
 const finish=()=>{clearTimeout(escalation);resolveFinished();};
 // XNU killpg1 excludes SZOMB and returns EPERM when the group still exists
 // but has no signalable member. EPERM is inconclusive, never evidence of exit.
 // https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_sig.c
 const groupExists=()=>{if(!child.pid)return false;try{process.kill(process.platform==='win32'?child.pid:-child.pid,0);return true;}catch(error){const code=(error as NodeJS.ErrnoException).code;if(code==='ESRCH')return false;if(code==='EPERM')return true;throw error;}};
 const kill=(signal:NodeJS.Signals)=>{
  if(!child.pid)return;
  try{if(process.platform==='win32')child.kill(signal);else process.kill(-child.pid,signal);}
  catch(error){const code=(error as NodeJS.ErrnoException).code;if(code==='EPERM'){signalError=error as Error;return;}if(code!=='ESRCH')child.emit('error',error);}
 };
 const waitForGroup=(deadline:number)=>{
  if(!groupExists()){if(closed)finish();return;}
  if(Date.now()>=deadline){rejectFinished(Error('聊天程序群組在 SIGKILL 後仍未結束',{cause:signalError}));return;}
  poll=setTimeout(()=>waitForGroup(deadline),chatLimits.shutdownPollMs);
 };
 const abort=()=>{if(terminating)return;terminating=true;kill('SIGTERM');escalation=setTimeout(()=>{escalated=true;kill('SIGKILL');waitForGroup(Date.now()+chatLimits.shutdownGraceMs);},chatLimits.shutdownGraceMs);};
 options.signal.addEventListener('abort',abort,{once:true});
 child.once('close',()=>{closed=true;options.signal.removeEventListener('abort',abort);if(!groupExists()){clearTimeout(poll);finish();}else if(!escalated)abort();});
 if(options.signal.aborted)abort();
 return Object.assign(child,{terminate:abort,finished});
}
