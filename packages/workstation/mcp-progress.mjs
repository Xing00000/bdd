import { id, invariant } from '../contracts/index.mjs';
import {readProgress} from '../git-core/progress-store.mjs';
import {supportedProtocolVersions,negotiateProtocolVersion} from './mcp-protocol.mjs';

export const progressTools = [
  ['workbench_list_repositories', {}, []],
  ['workbench_list_jobs', { repositoryId: {type:'string'}, limit:{type:'integer',minimum:1,maximum:50} }, ['repositoryId']],
  ['workbench_get_job_progress', { repositoryId:{type:'string'}, jobId:{type:'string'}, recentBytes:{type:'integer',minimum:1,maximum:16384}, staleAfterMs:{type:'integer',minimum:1000,maximum:86400000} }, ['repositoryId','jobId']]
].map(([name,properties,required])=>({name,description:'Read workbench progress',inputSchema:{type:'object',properties,required,additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true}}));
const redact = s => String(s).replace(/\x1b\][^\x07]*(?:\x07|\x1b\\|$)/g,'[OSC removed]').replace(/\x1b[P^_][\s\S]*?(?:\x1b\\|$)/g,'[sequence removed]').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/\x1b./g,'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'').replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi,'$1[redacted]@').replace(/\b(token|password|passwd|secret|authorization|api[_-]?key)\s*[:=]\s*([^\s]+)/gi,'$1=[redacted]').replace(/\bBearer\s+[^\s]+/gi,'Bearer [redacted]');
const processFields = ['commandId','command','role','pid','state','startedAt','finishedAt','exitCode','signal','timedOut','reason'];
const safeProcess = p => Object.fromEntries(processFields.filter(k => Object.hasOwn(p,k) && (typeof p[k] === 'string' || typeof p[k] === 'number' || typeof p[k] === 'boolean' || p[k] === null)).map(k => [k, typeof p[k] === 'string' ? (k === 'command' && !/^[A-Za-z0-9._-]{1,128}$/.test(p[k]) ? '[redacted]' : redact(p[k].slice(0,1024))) : p[k]]));
const bounded = (value, fallback, min, max) => { if(value===undefined)return fallback; invariant(Number.isInteger(value)&&value>=min&&value<=max,'INVALID_ARGUMENT','Invalid argument'); return value; };
async function progress(store, home, args) {
  const repositoryId=id(args.repositoryId), jobId=id(args.jobId), recentBytes=bounded(args.recentBytes,4096,1,16384), staleAfterMs=bounded(args.staleAfterMs,300000,1000,86400000);
  store.repository(repositoryId); const op=store.get(jobId); invariant(op && op.repository_id===repositoryId,'JOB_NOT_FOUND','Job not found',404);
  const persisted=readProgress(home,jobId);
  let totalBytes=0, text='', logTime=null;
  if(persisted){const b=persisted.output;totalBytes=b.length;logTime=persisted.updatedAt;let start=Math.max(0,b.length-recentBytes);while(start<b.length&&(b[start]&0xc0)===0x80)start++;text=redact(b.subarray(start).toString('utf8'));while(Buffer.byteLength(text)>recentBytes)text=Array.from(text).slice(1).join('');}
  const state=persisted?.state, metadataValue=persisted?.processes ?? [];
  invariant(Array.isArray(metadataValue) && metadataValue.length <= 4096 && metadataValue.every(p => p && typeof p === 'object' && !Array.isArray(p)), 'INVALID_METADATA', 'Invalid process metadata');
  const raw=metadataValue.map(safeProcess);
  const interrupted=!['RUNNING','CANCELLING'].includes(op.status);
  const processes=raw.map(p=>p.state==='RUNNING'&&interrupted?{...p,state:'UNKNOWN',reason:'NO_EXIT_RECEIPT'}:p);
  const agent=[...processes].reverse().find(p=>p.role==='agent') ?? {state:'UNKNOWN'};
  const active=processes.some(p=>p.state==='RUNNING'); const cli={state:active?'RUNNING':processes.length?(processes.some(p=>p.state==='UNKNOWN')?'UNKNOWN':'EXITED'):'UNKNOWN',processes};
  const times=[op.created_at,op.started_at,op.finished_at,logTime,...raw.flatMap(p=>[p.startedAt,p.finishedAt])];
  const lastActivityAt=times.filter(Boolean).sort().at(-1)??null, observedAt=new Date().toISOString();
  const result=op.result ?? (state?.runId ? store.runs(repositoryId).find(r=>r.id===state.runId)?.result : null), acceptance=result?.runId?Object.fromEntries(['runId','testOutcome','verification','coverageComplete','evidenceComplete','reasons'].map(k=>[k,result[k]??null])):null;
  if(acceptance?.reasons)acceptance.reasons=acceptance.reasons.map(x=>redact(typeof x==='string'?x:JSON.stringify(x)));
  const blockers=[]; if(op.error)blockers.push({code:op.error.code??'ERROR',message:redact(op.error.message??'Error')});
  if(acceptance && acceptance.verification!=='VERIFIED')blockers.push({code:'ACCEPTANCE_NOT_VERIFIED',message:'Acceptance is not verified'});
  const batch=op.request.operation==='regression.start'?store.regressions(repositoryId).find(x=>x.operationId===jobId):null;
  const regression=batch?{batchId:batch.batchId,status:batch.status,outcome:batch.outcome,counts:batch.counts,expectedCases:batch.results.reduce((n,x)=>n+x.expectedCases,0),actualCases:batch.results.every(x=>Number.isInteger(x.actualCases))?batch.results.reduce((n,x)=>n+x.actualCases,0):null}:null;
  return {schemaVersion:1,jobId,repositoryId,operation:op.request.operation,status:op.status,phase:typeof state?.phase === 'string' && /^[A-Z_]{1,40}$/.test(state.phase) ? state.phase : op.status,cli,agent,activity:{lastActivityAt,stale:lastActivityAt!==null&&Date.parse(observedAt)-Date.parse(lastActivityAt)>staleAfterMs,staleAfterMs},output:{text,returnedBytes:Buffer.byteLength(text),totalBytes,truncated:totalBytes>recentBytes},acceptance,regression,blockers,observedAt};
}
export async function handleProgress(store, home, request) {
  const host=request.headers.host; let hostUrl; try {hostUrl=new URL(`http://${host}`);} catch {hostUrl=null;}
  invariant(hostUrl && ['localhost','127.0.0.1','[::1]'].includes(hostUrl.hostname) && hostUrl.host===host,'HOST_DENIED','Loopback host required',403);
  if(request.headers.origin) {let origin;try{origin=new URL(request.headers.origin);}catch{} invariant(origin && request.headers.origin===origin.origin && origin.origin===`http://${host}`,'ORIGIN_DENIED','Origin denied',403);}
  if(request.method!=='POST')return {status:405,headers:{allow:'POST'},body:''};
  const version=request.headers['mcp-protocol-version'] ?? '2025-03-26';
  if(!supportedProtocolVersions.includes(version))return {status:400,body:{error:'Unsupported MCP protocol version'}};
  const q=request.body, response=(result,error)=>({jsonrpc:'2.0',id:q?.id??null,...(error?{error}:{result})});
  if(!q || typeof q!=='object'||Array.isArray(q)||q.jsonrpc!=='2.0'||typeof q.method!=='string'||(q.id!==undefined && typeof q.id!=='string' && typeof q.id!=='number')|| (q.params!==undefined && (!q.params||typeof q.params!=='object'||Array.isArray(q.params))))return {status:200,body:response(null,{code:-32600,message:'Invalid Request'})};
  if(q.id===undefined)return {status:202,body:''};
  try {
    let result;
    if(q.method==='initialize') {result={protocolVersion:negotiateProtocolVersion(q.params?.protocolVersion),capabilities:{tools:{}},serverInfo:{name:'workbench-progress',version:'1.0.0'}};}
    else if(q.method==='ping')result={};
    else if(q.method==='tools/list')result={tools:progressTools};
    else if(q.method==='tools/call') {
      const def=progressTools.find(x=>x.name===q.params?.name); invariant(def,'UNKNOWN_TOOL','Unknown tool'); const args=q.params.arguments??{};
      invariant(args && typeof args==='object'&&!Array.isArray(args)&&Object.keys(args).every(k=>Object.hasOwn(def.inputSchema.properties,k))&&def.inputSchema.required.every(k=>Object.hasOwn(args,k)),'INVALID_ARGUMENT','Invalid arguments');
      let value;
      if(def.name==='workbench_list_repositories')value={repositories:store.repositories().map(({id,title})=>({id,title}))};
      else if(def.name==='workbench_list_jobs'){const rid=id(args.repositoryId);store.repository(rid);const limit=bounded(args.limit,10,1,50);value={jobs:store.operations(rid).slice(0,limit).map(o=>({jobId:o.id,repositoryId:rid,operation:o.request.operation,status:o.status,createdAt:o.created_at,startedAt:o.started_at,finishedAt:o.finished_at}))};}
      else value=await progress(store,home,args);
      result={structuredContent:value,content:[{type:'text',text:JSON.stringify(value)}]};
    } else return {status:200,body:response(null,{code:-32601,message:'Method not found'})};
    return {status:200,body:response(result)};
  } catch(e) {const messages={JOB_NOT_FOUND:'Job not found in repository',REPOSITORY_NOT_FOUND:'Repository not found',UNKNOWN_TOOL:'Unknown tool',INVALID_VERSION:'Unsupported protocol version'};return {status:200,body:response(null,{code:-32602,message:messages[e.code]??'Invalid request'})};}
}
