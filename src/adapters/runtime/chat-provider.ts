import http from 'node:http';
import {randomUUID} from 'node:crypto';
import type {ChatSettings} from '../../ports/chat.ts';
import {copilotText} from './copilot-chat.ts';

export async function createChatProvider(cwd:string){
 const sessions=new Map<string,{settings:ChatSettings;signal:AbortSignal}>(),jobs=new Set<Promise<string>>();
 const server=http.createServer(async(req,res)=>{
  const session=sessions.get(String(req.headers.authorization).replace(/^Bearer /,''));
  if(!session){res.writeHead(401);res.end();return;}
  try{
   if(req.method!=='POST'||req.url!=='/responses'){res.writeHead(404);res.end();return;}
   let raw='';for await(const chunk of req)raw+=chunk;
   const body=JSON.parse(raw);
   if(!Array.isArray(body.input))throw Error('Codex 必須傳送完整訊息歷史');
   const messages=body.input.map((message:any)=>{
    if(message.type!=='message'||!['user','assistant','developer','system'].includes(message.role)||!Array.isArray(message.content))throw Error('文字聊天不支援工具或非文字項目');
    return {role:message.role,content:message.content.map((part:any)=>{
     if(!['input_text','output_text'].includes(part.type)||typeof part.text!=='string')throw Error('文字聊天只接受文字內容');return part.text;
    }).join('\n')};
   });
   // CLI accepts prompts rather than native Responses role/tool objects. Preserve
   // role labels explicitly; never claim native role or tool-protocol equivalence.
   const prompt='Continue this text conversation. The JSON preserves its instructions and role-labelled messages. Return only the next assistant response. Do not use tools.\n'+JSON.stringify({instructions:body.instructions,messages});
   const job=copilotText(session.settings,prompt,cwd,session.signal);jobs.add(job);void job.then(()=>jobs.delete(job),()=>jobs.delete(job));
   const answer=await job;
   const id='resp_'+randomUUID(),item={id:'msg_'+randomUUID(),type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:answer,annotations:[]}]};
   res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store'});
   let sequence=0;const send=(type:string,data:object)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,sequence_number:sequence++,...data})}\n\n`);
   send('response.created',{response:{id,status:'in_progress',output:[]}});
   send('response.output_item.added',{output_index:0,item:{...item,status:'in_progress',content:[]}});
   send('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:answer});
   send('response.output_item.done',{output_index:0,item});
   send('response.completed',{response:{id,status:'completed',output:[item]}});res.end();
  }catch(error){res.writeHead(502,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:error instanceof Error?error.message:String(error)}}));}
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const address=server.address();if(!address||typeof address==='string')throw Error('Chat provider did not bind a TCP port');
 return {
  url:`http://127.0.0.1:${address.port}`,
  register(settings:ChatSettings,signal:AbortSignal){const token=randomUUID();sessions.set(token,{settings,signal});return {token,close:()=>sessions.delete(token)};},
  async close(){server.closeAllConnections();await Promise.allSettled(jobs);await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));},
 };
}
