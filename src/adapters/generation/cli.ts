import {mkdtemp,mkdir,writeFile,readFile,watch,lstat} from 'node:fs/promises';
import type {GenerationOptions,LlmInput,TerminalSessionInfo,WorkflowAgentProfile} from './types.ts';
import {basename,dirname,join} from 'node:path';
import {GenerationError} from './errors.ts';

export type CliSkill = {path:string;rawText:string};

const proposalSchema={type:'object',properties:{
  status:{type:'string',enum:['completed','needs_input']},rawText:{type:'string'},questions:{type:'array',items:{type:'string'}},
  files:{type:'array',items:{type:'object',properties:{path:{type:'string'},rawText:{type:'string'}},required:['path','rawText'],additionalProperties:false}},
  mappings:{type:'array',items:{type:'object',properties:{testKey:{type:'string'},scenarioId:{type:'string'},caseId:{type:'string'}},required:['testKey','scenarioId','caseId'],additionalProperties:false}},
},required:['status','questions'],additionalProperties:false,allOf:[{
 if:{properties:{status:{const:'completed'}}},
 then:{required:['rawText'],properties:{rawText:{minLength:1},questions:{maxItems:0}}},
 else:{properties:{questions:{minItems:1}}},
}]};

export async function cliProposal(options:GenerationOptions,instructions:string,data:unknown,skill?:CliSkill,agent?:WorkflowAgentProfile):Promise<{proposal:any;terminal?:TerminalSessionInfo}>{
  const terminal=options.terminal,config=agent?.cliCommand??options.llm;
  if(!terminal||!config)throw new GenerationError(503,'LLM_UNCONFIGURED','網頁 terminal CLI 未設定');
  await mkdir(options.artifactRoot,{recursive:true,mode:0o700});
  const directory=await mkdtemp(join(options.artifactRoot,'terminal-'));
  const proposalFile=join(directory,'proposal.json');
  const readyFile=join(directory,'proposal.ready');
  const agentSkill:CliSkill|undefined=agent?.skill?{path:'.agents/skills/configured-agent/SKILL.md',rawText:`---\nname: configured-agent\ndescription: Configured workflow instructions.\n---\n\n# ${agent.skill.name}\n\n${agent.skill.instructions}\n`}:undefined;
  for(const item of [agentSkill,skill].filter((item):item is CliSkill=>Boolean(item))){
    const parts=item.path.split('/');
    if(item.path.startsWith('/')||parts.some(part=>!part||part==='.'||part==='..')||parts.at(-1)!=='SKILL.md')throw new GenerationError(500,'BDD_SKILL_PATH_INVALID','提供的 Skill 路徑無效');
    const skillFile=join(directory,...parts);
    await mkdir(dirname(skillFile),{recursive:true,mode:0o700});
    await writeFile(skillFile,item.rawText,{mode:0o600,flag:'wx'});
  }
  await writeFile(join(directory,'request.json'),JSON.stringify(data,null,2),{mode:0o600});
  const stage=skill?'TESTS':'SD';
  const mcpSession=options.onMcpSession?.({directory,terminalContext:(data as LlmInput)?.terminalContext,stage,agent});
  if(options.mcpUrl||mcpSession){
    const stdioScript=join(options.root,'dist/src/adapters/mcp/stdio.js');
    await writeFile(join(directory,'.mcp.json'),JSON.stringify({mcpServers:{'bdd-workbench':{command:process.execPath,args:[stdioScript],env:{...(options.mcpUrl?{WB_MCP_URL:options.mcpUrl}:{}),...(mcpSession?{WB_MCP_SESSION:mcpSession.sessionId}:{})},url:options.mcpUrl??null,sessionId:mcpSession?.sessionId??null}}},null,2),{mode:0o600});
  }
  const publication='Write proposal.json as valid UTF-8 JSON and close it before publishing. The proposal may contain Traditional Chinese; use a UTF-8-safe file operation. If writing it with Python source from a shell heredoc, declare UTF-8 on the first source line; never embed raw non-ASCII text in an undeclared Python script. Verify the saved file parses as JSON. If writing the proposal or validating its JSON fails, stop without creating proposal.ready. Do not add speculative checks or unstated layout constraints to supplied source files; if an optional inspection command conflicts with the actual source, inspect the source and correct the check. Only after all proposal bytes are saved and verified, create the empty file proposal.ready. This is the required final operation: do not end the CLI turn until proposal.ready exists beside proposal.json, then verify both files exist and proposal.json still parses. The server ignores incomplete proposal.json until proposal.ready exists. Never create proposal.ready after a failed write or before saving the complete JSON.';
  const skillPaths=[
    ...(agentSkill?[`Read ${agentSkill.path} as configured Skill guidance.`]:[]),
    ...(skill?[`Official BDD skill: ${skill.path}. Read it as guidance for Playwright-BDD conventions.`]:[]),
  ].join(' ');
  const launchPrompt=[
    agent?`# Database-configured Agent Prompt\n${agent.prompt}`:'',
    'Read task.md and request.json in this working directory before acting. Follow the database-configured Agent Prompt above. The request.json contains the complete stage-specific inputs selected by the workbench, including confirmed Gherkin, SD, the test skeleton, and caller-provided context where applicable. Use those exact inputs; do not infer missing facts.',
    skillPaths,
    publication,
    'If information is insufficient, write status needs_input with explicit questions. Do not change task.md or request.json. Do not run tests or claim approval.',
  ].filter(Boolean).join('\n\n');
  // Codex documents an optional positional prompt for starting an interactive
  // session. Deliver it at process startup so it is submitted only after the
  // TUI initializes; typing it while the TUI is still loading leaves it in the
  // composer without starting the requested task.
  const codexInitialPrompt=Boolean(agent)&&basename(config.executable).replace(/\.(?:exe|cmd|bat)$/i,'').toLowerCase()==='codex';
  const agentInstructions=agent?`\nConfigured Agent: ${agent.name}\nConfigured Prompt:\n${agent.prompt}\n` : '';
  await writeFile(join(directory,'task.md'),agentInstructions+instructions+'\nProposal schema: '+JSON.stringify(proposalSchema)+'\n'+publication+'\n'+skillPaths+'\n',{mode:0o600});
  const controller=new AbortController();
  const changes=watch(directory,{signal:controller.signal});
  const nextChange=()=>changes.next().then(event=>({event}),error=>({error}));
  // Start the lazy watcher before launching a producer which may publish fast.
  let pendingChange=nextChange();
  let sessionId:string|undefined,unsubscribe:(()=>void)|undefined,readyResolve:(()=>void)|undefined,readyReject:((error:unknown)=>void)|undefined;
  const ready=agent?new Promise<void>((resolve,reject)=>{readyResolve=resolve;readyReject=reject;}):undefined;
  try{
    const args=agent?[...agent.cliCommand.args,...(codexInitialPrompt?[launchPrompt]:[])]:['--sandbox','workspace-write','--ask-for-approval','on-request','--no-alt-screen','--no-daemon','--cd',directory];
    if(!agent){if(options.llm?.model)args.push('--model',options.llm.model);args.push('--',launchPrompt);}
    const session=await terminal.create({workspaceRef:directory,command:{file:config.executable,args}});sessionId=session.id;
    const result=new Promise<any>((resolve,reject)=>{
      unsubscribe=terminal.subscribe(session.id,event=>{
        if(event.type==='terminal.output'&&event.data)readyResolve?.();
        if(event.type==='terminal.exited'){const error=new GenerationError(502,'LLM_CLI_EXITED',`CLI 已結束（exit ${event.exitCode}），未提交可驗證提案`);readyReject?.(error);controller.abort();reject(error);}
      });
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
    if(agent&&ready&&!codexInitialPrompt){void result.catch(()=>{});await ready;terminal.input(session.id,launchPrompt);await new Promise<void>(resolve=>setImmediate(resolve));terminal.input(session.id,'\r');}
    return {proposal:await result,...(context?{terminal:{...context,terminalId:session.id}}:{})};
  }catch(error){if(sessionId)terminal.closeTerminal(sessionId);throw error;}
  finally{unsubscribe?.();controller.abort();mcpSession?.close();}
}
