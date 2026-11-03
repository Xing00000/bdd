import type {ServerResponse} from 'node:http';
import type {createChatService} from '../application/chat.ts';

// Both HTTP hosts use the same stream ordering and connection lifecycle.
export async function openChatStream(chat:Awaited<ReturnType<typeof createChatService>>,response:ServerResponse,roomId?:string){
 let ready=false,closed=false,refreshing=false,dirty=false;
 const write=(event:object)=>{
  if(closed)return;
  if(!response.write(`data: ${JSON.stringify(event)}\n\n`))response.destroy(Error('Chat stream consumer is too slow'));
 };
 const refresh=async()=>{
  dirty=true;if(refreshing)return;refreshing=true;
  try{while(dirty&&!closed){dirty=false;write(await chat.snapshot(roomId));}}
  catch(error){response.destroy(error instanceof Error?error:Error(String(error)));}
  finally{refreshing=false;}
 };
 const unsubscribe=chat.subscribe(event=>{
  if(event.type==='closed'){response.end();return;}
  if(!ready||closed)return;
  if(event.type==='changed')void refresh();
  else if(event.roomId===roomId)write(event);
 });
 const cleanup=()=>{closed=true;unsubscribe();};
 response.once('close',cleanup);
 try{
  const initial=await chat.snapshot(roomId);
  if(closed)return;
  response.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','x-accel-buffering':'no'});
  response.flushHeaders();write(initial);ready=true;
 }catch(error){cleanup();throw error;}
}
