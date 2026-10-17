import {mkdtemp,mkdir,writeFile,readFile,watch,lstat} from 'node:fs/promises';
import type {GenerationOptions,LlmInput} from './types.ts';
import {join} from 'node:path';
import {GenerationError} from './errors.ts';

const proposalSchema={type:'object',properties:{
  status:{type:'string',enum:['completed','needs_input']},rawText:{type:'string'},questions:{type:'array',items:{type:'string'}},
  files:{type:'array',items:{type:'object',properties:{path:{type:'string'},rawText:{type:'string'}},required:['path','rawText'],additionalProperties:false}},
  mappings:{type:'array',items:{type:'object',properties:{testKey:{type:'string'},scenarioId:{type:'string'},caseId:{type:'string'}},required:['testKey','scenarioId','caseId'],additionalProperties:false}},
},required:['status','questions'],additionalProperties:false,allOf:[{
 if:{properties:{status:{const:'completed'}}},
 then:{required:['rawText'],properties:{rawText:{minLength:1},questions:{maxItems:0}}},
 else:{properties:{questions:{minItems:1}}},
}]};

export async function cliProposal(options:GenerationOptions,instructions:string,data:unknown):Promise<{proposal:any}>{
  const terminal=options.terminal,config=options.llm;
  if(!terminal||!config)throw new GenerationError(503,'LLM_UNCONFIGURED','網頁 terminal CLI 未設定');
  await mkdir(options.artifactRoot,{recursive:true,mode:0o700});
  const directory=await mkdtemp(join(options.artifactRoot,'terminal-'));
  const proposalFile=join(directory,'proposal.json');
  const readyFile=join(directory,'proposal.ready');
  await writeFile(join(directory,'request.json'),JSON.stringify(data,null,2),{mode:0o600});
  const publication='Write the entire proposal.json and close it first. Only after all proposal bytes have been saved, create the empty file proposal.ready to publish it. The server ignores incomplete proposal.json until proposal.ready exists. Never create proposal.ready before saving the complete JSON.';
  await writeFile(join(directory,'task.md'),instructions+'\nProposal schema: '+JSON.stringify(proposalSchema)+'\n'+publication+'\n',{mode:0o600});
  const controller=new AbortController();
  const changes=watch(directory,{signal:controller.signal});
  const nextChange=()=>changes.next().then(event=>({event}),error=>({error}));
  // Start the lazy watcher before launching a producer which may publish fast.
  let pendingChange=nextChange();
  let sessionId:string|undefined,unsubscribe:(()=>void)|undefined;
  try{
    const args=['--sandbox','workspace-write','--ask-for-approval','on-request','--no-alt-screen','--no-daemon','--cd',directory];
    if(config.model)args.push('--model',config.model);
    args.push('--','Read task.md and request.json in this working directory. Carry out the task using those files as the supplied data. '+publication+' If information is insufficient, write status needs_input with explicit questions. Do not change task.md or request.json. Do not run tests or claim approval.');
    const session=await terminal.create({workspaceRef:directory,command:{file:config.executable,args}});sessionId=session.id;
    const result=new Promise<any>((resolve,reject)=>{
      unsubscribe=terminal.subscribe(session.id,event=>{if(event.type==='terminal.exited'){controller.abort();reject(new GenerationError(502,'LLM_CLI_EXITED',`CLI 已結束（exit ${event.exitCode}），未提交可驗證提案`));}});
      void(async()=>{
        for(;;){
          const change=await pendingChange;
          if('error' in change)throw change.error;
          if(change.event.done)throw new GenerationError(409,'LLM_CLI_CANCELLED','CLI 提案等待已取消');
          pendingChange=nextChange();
          if(change.event.value.filename!=='proposal.ready')continue;
          const ready=await lstat(readyFile);
          if(!ready.isFile()||ready.isSymbolicLink())throw new GenerationError(422,'LLM_RESPONSE_INVALID','CLI 提交標記必須為普通檔案');
          const stat=await lstat(proposalFile);
          if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2*1024*1024)throw new GenerationError(422,'LLM_RESPONSE_INVALID','CLI 提案必須為工作目錄中的普通 JSON 檔且不超過 2 MiB');
          let proposal:unknown;
          try{proposal=JSON.parse(await readFile(proposalFile,'utf8'));}catch{throw new GenerationError(422,'LLM_RESPONSE_INVALID','CLI proposal.json 不是有效 JSON，原文件未變更');}
          resolve(proposal);break;
        }
      })().catch(reject);
    });
    const context=(data as LlmInput)?.terminalContext;
    if(context)options.onTerminal?.({...context,terminalId:session.id,workspaceRef:directory});
    return {proposal:await result};
  }catch(error){if(sessionId)terminal.closeTerminal(sessionId);throw error;}
  finally{unsubscribe?.();controller.abort();}
}
