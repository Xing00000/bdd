import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {chatLimits} from '../../domain/chat.ts';
import {negotiateProtocolVersion} from '../../../packages/workstation/mcp-protocol.mjs';
import type {CopilotTool} from './chat-tool-protocol.ts';

// Discovery only. Actual tool execution belongs to Codex's MCP client.
export async function createCopilotCatalog(tools:CopilotTool[]){
 const token=randomUUID();
 const server=http.createServer(async(req,res)=>{
  const send=(status:number,body?:object)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(body===undefined?'':JSON.stringify(body));};
  if(req.headers.authorization!==`Bearer ${token}`||req.headers.origin)return send(403,{error:'Forbidden'});
  if(req.method!=='POST'||req.url!=='/mcp')return send(404,{error:'Not found'});
  let q:any;
  try{
   req.setEncoding('utf8');let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>chatLimits.providerRequest)throw Error('Request too large');}q=JSON.parse(raw);
   if(q?.jsonrpc!=='2.0'||typeof q.method!=='string')throw Error('Invalid request');
   if(q.id===undefined)return send(202);
   const reply=(result:object)=>send(200,{jsonrpc:'2.0',id:q.id,result});
   if(q.method==='initialize')return reply({protocolVersion:negotiateProtocolVersion(q.params?.protocolVersion),capabilities:{tools:{}},serverInfo:{name:'codex-handoff',version:'1.0.0'}});
   if(q.method==='ping')return reply({});
   if(q.method==='tools/list')return reply({tools:tools.map(t=>({name:t.name,description:t.description,inputSchema:t.parameters}))});
   send(200,{jsonrpc:'2.0',id:q.id,error:{code:-32601,message:'This server only advertises tools. Execution belongs to Codex.'}});
  }catch{send(200,{jsonrpc:'2.0',id:q?.id??null,error:{code:-32602,message:'Invalid catalog request'}});}
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const address=server.address();if(!address||typeof address==='string')throw Error('Tool catalog did not bind a TCP port');
 return {config:{mcpServers:{codex_handoff:{type:'http',url:`http://127.0.0.1:${address.port}/mcp`,headers:{Authorization:`Bearer ${token}`},tools:['*']}}},async close(){server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}};
}
