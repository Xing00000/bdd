import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {SessionManager} from './core.mjs';
import {provisionTaskWorktree} from './worktree.mjs';
import {requireThat as ok,fields,identifier} from './contracts.mjs';

export const sessionManagementPages=['/repositories/session-management','/repositories/session-management.js'];
const prefix='/repository-api/v1/session-management';
const headers={
  'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer',
  'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};
const humanCommands=new Set(['project.create','repository.register','repository.link','catalog.save','task.create','task.cancel','room.message','memory.summarize','node.approve']);
/** Used by both standalone and Fastify workstation servers. Does not start another server. */
export async function dispatchSessionManagement(service,request) {
  const url=new URL(request.url,'http://workstation.invalid'),route=url.pathname.replace(/\/$/,'');
  if(sessionManagementPages.includes(route)&&request.method==='GET') {
    const script=route.endsWith('.js');return {status:200,headers:{...headers,'content-type':script?'text/javascript; charset=utf-8':'text/html; charset=utf-8'},body:await readFile(new URL(script?'./public/session-management.js':'./public/index.html',import.meta.url))};
  }
  if(route!==prefix&&!route.startsWith(prefix+'/'))return undefined;
  const response=(status,body)=>({status,headers:{...headers,'content-type':'application/json; charset=utf-8'},body});
  let manager;
  try {
    if(request.headers?.origin) {
      const origin=new URL(request.headers.origin);
      ok(['http:','https:'].includes(origin.protocol)&&origin.host===request.headers.host,'CROSS_ORIGIN_DENIED','Cross-origin session requests are forbidden',403);
    }
    if(request.method!=='GET')ok(request.headers?.['x-workbench-request']==='1','REQUEST_HEADER_REQUIRED','Workbench request header is required',403);
    ok(['GET','POST'].includes(request.method),'METHOD_NOT_ALLOWED','Only GET/POST are supported',405);
    manager=new SessionManager(path.join(service.options.home,'metadata.sqlite'),{worktreeRoot:path.join(service.options.home,'task-worktrees')});
    const parts=route.slice(prefix.length).split('/').filter(Boolean).map(decodeURIComponent);
    if(request.method==='GET') {
      if(parts.length===0)return response(200,manager.snapshot());
      if(parts.join('/')==='capabilities')return response(200,{schemaVersion:1,scope:'private-loopback-workstation',sessionCatalog:true,taskWorktreeProvisioning:true,summaryMemory:true,typedNodeResults:true,nativeRuntimeDispatch:false,workerDispatch:false,acceptanceCheckpoint:false,notes:['Logical session management is available. Native Bot/Worker controller integration is not enabled by this change.','Queued task messages are not claimed delivered to a model.','Existing legacy execution routes remain separate and unchanged.']});
      if(parts.join('/')==='portfolio')return response(200,manager.portfolio());
      if(parts[0]==='tasks'&&parts.length===2)return response(200,manager.detail(parts[1]));
      if(parts[0]==='tasks'&&parts[2]==='events'&&parts.length===3)return response(200,manager.events(parts[1],{afterSeq:Number(url.searchParams.get('afterSeq')??0),limit:Number(url.searchParams.get('limit')??200)}));
      if(parts[0]==='nodes'&&parts.length===2)return response(200,manager.context(parts[1]));
      if(parts[0]==='memory'&&parts.length===2)return response(200,manager.memory(parts[1],url.searchParams.get('projectId')));
    }
    if(request.method==='POST'&&parts.join('/')==='commands') {
      const body=request.body;fields(body,['command','input','requestId'],['command','input','requestId']);identifier(body.requestId);
      ok(humanCommands.has(body.command),'COMMAND_FORBIDDEN','This command requires an authenticated internal controller',403);
      // The local HTTP boundary is human-only. Actor claims in the payload are never accepted.
      const result=manager.command(body.command,body.input,{actor:{kind:'human',id:'local'},requestId:body.requestId});
      if(body.command==='task.create')return response(201,await provisionTaskWorktree(manager,result.task.id));
      return response(200,result);
    }
    if(request.method==='POST'&&parts[0]==='tasks'&&parts[2]==='provision'&&parts.length===3) {
      fields(request.body??{},[]);return response(200,await provisionTaskWorktree(manager,parts[1]));
    }
    return response(404,{code:'NOT_FOUND',message:'Unknown session-management route'});
  }catch(error){
    const constraint=String(error.code??'').startsWith('ERR_SQLITE')||/constraint failed|UNIQUE constraint/i.test(error.message??'');
    return response(error.statusCode??(constraint?409:500),{code:constraint?'DATA_CONFLICT':error.code??'SESSION_ERROR',message:error.message});
  }finally{manager?.close();}
}
