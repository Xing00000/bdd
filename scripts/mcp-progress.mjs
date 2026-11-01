#!/usr/bin/env node
import readline from 'node:readline';
const endpoint=process.argv[2];
let url;
try { url=new URL(endpoint); if(url.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.pathname!=='/repository-api/v1/mcp/progress'||url.search||url.hash||url.username||url.password)throw Error(); }
catch { process.stderr.write('Provide the local MCP progress URL as the sole argument.\n'); process.exit(1); }
let version='2025-03-26';
const lines=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
for await (const line of lines) {
  let request;
  try {
    request=JSON.parse(line);
    const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json','accept':'application/json, text/event-stream','mcp-protocol-version':version},body:JSON.stringify(request),redirect:'error',signal:AbortSignal.timeout(30000)});
    if(response.status===202) { if(request && Object.hasOwn(request,'id'))throw Error(); continue; }
    if(!response.ok)throw Error(`HTTP ${response.status}`);
    const result=await response.json();
    if(request?.method==='initialize' && ['2025-03-26','2025-11-25'].includes(result?.result?.protocolVersion))version=result.result.protocolVersion;
    if(request && Object.hasOwn(request,'id'))process.stdout.write(JSON.stringify(result)+'\n');
  } catch {
    if(request && Object.hasOwn(request,'id') && (typeof request.id==='string' || typeof request.id==='number' || request.id===null))process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32603,message:'MCP progress bridge request failed'}})+'\n');
    else if(!request)process.stderr.write('MCP progress bridge request failed.\n');
  }
}
