import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GenerationError} from './errors.ts';

const proposalSchema={type:'object',properties:{
  status:{type:'string',enum:['completed','needs_input']},rawText:{type:'string'},questions:{type:'array',items:{type:'string'}},
  files:{type:'array',items:{type:'object',properties:{path:{type:'string'},rawText:{type:'string'}},required:['path','rawText'],additionalProperties:false}},
  mappings:{type:'array',items:{type:'object',properties:{testKey:{type:'string'},scenarioId:{type:'string'},caseId:{type:'string'}},required:['testKey','scenarioId','caseId'],additionalProperties:false}},
},required:['status','questions'],additionalProperties:false};

export async function cliProposal(config:{executable:string;model?:string},instructions:string,data:unknown):Promise<{proposal:unknown;usage:Record<string,unknown>|undefined}>{
  const directory=await mkdtemp(join(tmpdir(),'workbench-llm-'));
  try{
    const args=['--print','--output-format','json','--no-session-persistence','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--json-schema',JSON.stringify(proposalSchema),'--system-prompt',instructions];
    if(config.model)args.push('--model',config.model);
    const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>key!=='WB_TARGET_PASSWORD'&&!key.startsWith('WB_SECRET_')));
    const output=await new Promise<string>((resolve,reject)=>{
      const child=spawn(config.executable,args,{cwd:directory,env,stdio:['pipe','pipe','pipe'],shell:false});
      const chunks:Buffer[]=[];let bytes=0,stderrBytes=0,failure:Error|undefined;
      let killTimeout:ReturnType<typeof setTimeout>|undefined;
      const fail=(error:Error)=>{if(failure)return;failure=error;child.kill('SIGTERM');killTimeout=setTimeout(()=>child.kill('SIGKILL'),3000);};
      const timeout=setTimeout(()=>fail(new GenerationError(504,'LLM_CLI_TIMEOUT','LLM CLI 執行逾時，未保存成功內容')),120_000);
      child.on('error',()=>{failure??=new GenerationError(503,'LLM_CLI_UNAVAILABLE','無法啟動設定的 LLM CLI；請在 terminal 確認 CLI 已安裝及登入');});
      child.stdout.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>2*1024*1024)fail(new GenerationError(502,'LLM_RESPONSE_INVALID','LLM CLI 輸出超過 2 MiB'));else chunks.push(chunk);});
      child.stderr.on('data',(chunk:Buffer)=>{stderrBytes+=chunk.length;if(stderrBytes>2*1024*1024)fail(new GenerationError(502,'LLM_RESPONSE_INVALID','LLM CLI 診斷超過 2 MiB'));});
      child.on('close',code=>{clearTimeout(timeout);clearTimeout(killTimeout);if(failure){reject(failure);return;}if(code!==0){reject(new GenerationError(502,'LLM_CLI_FAILED',`LLM CLI exit ${code}；未接受或保存提案`));return;}resolve(Buffer.concat(chunks).toString('utf8'));});
      child.stdin.on('error',()=>fail(new GenerationError(502,'LLM_CLI_INPUT_FAILED','無法將需求傳入 LLM CLI')));
      child.stdin.end(JSON.stringify(data));
    });
    let envelope:any;
    try{envelope=JSON.parse(output);}catch{throw new GenerationError(502,'LLM_RESPONSE_INVALID','LLM CLI 未回傳 JSON envelope');}
    if(envelope.type!=='result'||envelope.is_error||envelope.subtype!=='success'||!envelope.structured_output)
      throw new GenerationError(502,'LLM_RESPONSE_INVALID','LLM CLI 未完成結構化提案');
    return {proposal:envelope.structured_output,usage:envelope.usage};
  }finally{await rm(directory,{recursive:true,force:true});}
}
