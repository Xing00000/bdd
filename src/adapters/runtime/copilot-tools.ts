import {randomUUID} from 'node:crypto';
import http from 'node:http';
import type {ServerResponse} from 'node:http';
import type {CopilotTool} from './chat-tool-protocol.ts';
import {chatLimits} from '../../domain/chat.ts';

/** An MCP catalog and proposal inbox. It contains no implementation of a workbench action. */
export async function createCopilotToolBridge(name:string){
 type Registration={tools:CopilotTool[];propose:(name:string,args:Record<string,unknown>)=>void;fail:(error:Error)=>void;waiting:Set<ServerResponse>;active:boolean};
 const registrations=new Map<string,Registration>();let closing=false;
 const server=http.createServer(async(req,res)=>{
  const token=String(req.headers.authorization).replace(/^Bearer /,''),registration=registrations.get(token);
  if(!registration||closing){res.writeHead(401);res.end();return;}
  if(req.url!=='/mcp'){res.writeHead(404);res.end();return;}
  if(req.method!=='POST'){res.writeHead(405,{allow:'POST'});res.end();return;}
  registration.waiting.add(res);res.once('close',()=>registration.waiting.delete(res));
  let id:any=null;
  const send=(value:object)=>{if(res.destroyed||res.writableEnded)return;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id,...value}));};
  try{
   req.setEncoding('utf8');
   let raw='';for await(const chunk of req){if(!registration.active||closing)return;raw+=String(chunk);if(Buffer.byteLength(raw)>chatLimits.providerRequest)throw Error('Copilot MCP 請求超過大小限制');}
   if(!registration.active||closing||registrations.get(token)!==registration)return;
   const request=JSON.parse(raw);id=request.id;
   if(request.jsonrpc!=='2.0'||typeof request.method!=='string')throw Error('Copilot MCP 請求格式錯誤');
   if(id===undefined){res.writeHead(202);res.end();return;}
   if(request.method==='initialize'){
    const supported=['2025-06-18','2025-03-26','2024-11-05'];
    const protocolVersion=supported.includes(request.params?.protocolVersion)?request.params.protocolVersion:supported[0];
    send({result:{protocolVersion,serverInfo:{name:'bdd-codex-proposals',version:'1.0.0'},capabilities:{tools:{}}}});return;
   }
   if(request.method==='ping'){send({result:{}});return;}
   if(request.method==='tools/list'){
    send({result:{tools:registration.tools.map(tool=>({name:tool.name,description:tool.description,inputSchema:tool.parameters,annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}}))}});return;
   }
   if(request.method==='tools/call'){
    const params=request.params;
    if(typeof params?.name!=='string'||!registration.tools.some(tool=>tool.name===params.name)||!params.arguments||typeof params.arguments!=='object'||Array.isArray(params.arguments))throw Error('Copilot 要求未授權或無效的工具提案');
    // Some ACP servers skip permission for read-only MCPs. This fallback only
    // records the same proposal and cancels inference; it never supplies a
    // successful tool result or executes the requested operation.
    registration.propose(params.name,params.arguments);
    return;
   }
   send({error:{code:-32601,message:'Method not found'}});
  }catch(error){
   const failure=error instanceof Error?error:Error(String(error));
   send({error:{code:-32602,message:failure.message}});if(registration.active&&!closing)registration.fail(failure);
  }
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const address=server.address();if(!address||typeof address==='string')throw Error('Copilot MCP 提案服務無法啟動');
 return {
  register(tools:CopilotTool[],propose:Registration['propose'],fail:Registration['fail']){
   if(closing)throw Error('Copilot MCP 提案服務已關閉');
   const token=randomUUID(),registration={tools,propose,fail,waiting:new Set<ServerResponse>(),active:true};registrations.set(token,registration);
   return {
    server:{type:'http',name,url:`http://127.0.0.1:${address.port}/mcp`,headers:[{name:'Authorization',value:'Bearer '+token}]},
    close(){registration.active=false;registrations.delete(token);for(const response of registration.waiting)response.destroy();registration.waiting.clear();},
   };
  },
  async close(){
   if(closing)return;closing=true;
   for(const registration of registrations.values()){registration.active=false;for(const response of registration.waiting)response.destroy();}registrations.clear();
   const stopped=new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));server.closeAllConnections();await stopped;
  },
 };
}
