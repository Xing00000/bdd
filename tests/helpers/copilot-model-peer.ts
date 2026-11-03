import {writeFile} from 'node:fs/promises';
import path from 'node:path';

// A controlled SDK protocol peer. This is catalog/transport evidence, not model inference.
export async function copilotModelPeer(directory:string,models:unknown,{authenticated=true,hang=false}={}){
 const file=path.join(directory,'copilot-model-peer.mjs');
 await writeFile(file,`let buffer=Buffer.alloc(0);process.stdin.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);while(true){const at=buffer.indexOf('\\r\\n\\r\\n');if(at<0)return;const n=Number(/Content-Length: (\\d+)/i.exec(buffer.subarray(0,at).toString())[1]);if(buffer.length<at+4+n)return;const q=JSON.parse(buffer.subarray(at+4,at+4+n));buffer=buffer.subarray(at+4+n);if(q.method==='models.list'&&${JSON.stringify(hang)})continue;const result=q.method==='connect'?{ok:true,protocolVersion:3}:q.method==='auth.getStatus'?{isAuthenticated:${JSON.stringify(authenticated)}}:q.method==='models.list'?{models:${JSON.stringify(models)}}:null;const body=JSON.stringify({jsonrpc:'2.0',id:q.id,result});process.stdout.write('Content-Length: '+Buffer.byteLength(body)+'\\r\\n\\r\\n');process.stdout.write(body);}});`);
 return {copilotExecutable:process.execPath,copilotArgs:[file]};
}
