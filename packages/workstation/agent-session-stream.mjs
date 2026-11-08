import {realpathSync} from 'node:fs';
import {invariant} from '../contracts/index.mjs';

// Retain the existing terminal slow-consumer budget for both transports.
export const agentStreamBufferBytes=1024*1024;
export const endedAgentSessionStatuses=Object.freeze(['STOPPED','FAILED']);
export const agentSessionEnded=status=>endedAgentSessionStatuses.includes(status);
const listeners=new Map();
const key=(home,sessionId)=>`${realpathSync(home)}\0${sessionId}`;

export function publishAgentSession(home,sessionId,message){
  for(const receive of [...(listeners.get(key(home,sessionId))??[])])receive(message);
}

/** Subscribe before replay. Live events emitted during a replay callback are
 * held until history is delivered, then deduplicated by the durable sequence. */
export function subscribeLocalAgentSession(home,sessionId,afterSeq,readPage,onMessage,onError){
  const streamKey=key(home,sessionId),receivers=listeners.get(streamKey)??new Set();
  listeners.set(streamKey,receivers);
  let cursor=afterSeq,closed=false,replaying=true;
  const pending=[];
  const dispose=()=>{if(closed)return;closed=true;receivers.delete(receive);if(!receivers.size)listeners.delete(streamKey);};
  const deliver=message=>{
    if(closed)return;
    try{
      if(message.type==='event'){
        if(message.event.seq<=cursor)return;
        cursor=message.event.seq;
      }
      onMessage(message);
      if(message.type==='closed')dispose();
    }catch(error){dispose();onError(error);}
  };
  const receive=message=>{if(replaying)pending.push(message);else deliver(message);};
  receivers.add(receive);
  try{
    let snapshot;
    do{
      snapshot=readPage(cursor);
      for(const event of snapshot.events)deliver({type:'event',event});
    }while(!closed&&snapshot.events.length===200);
    replaying=false;
    for(const message of pending)deliver(message);
    if(agentSessionEnded(snapshot.status))deliver({type:'closed',status:snapshot.status});
    return dispose;
  }catch(error){dispose();throw error;}
}

/** A session can be owned by another MCP process. Reuse its authenticated
 * control channel for a live NDJSON stream, never a periodic database read. */
export async function subscribeRemoteAgentSession(row,sessionId,afterSeq,onMessage,onError,parentSignal){
  const controller=new AbortController();
  const signal=parentSignal?AbortSignal.any([controller.signal,parentSignal]):controller.signal;
  const url=new URL('/events',row.control_url);
  url.searchParams.set('sessionId',sessionId);url.searchParams.set('afterSeq',String(afterSeq));
  const response=await fetch(url,{headers:{authorization:`Bearer ${row.control_token}`},signal});
  if(!response.ok||!response.body){await response.body?.cancel();invariant(false,'AGENT_STREAM_UNAVAILABLE','CLI Agent live stream is unavailable',502);}
  const reader=response.body.getReader(),decoder=new TextDecoder();
  void (async()=>{
    let buffer='',ended=false;
    try{
      while(!signal.aborted){
        const chunk=await reader.read();
        if(chunk.done)break;
        buffer+=decoder.decode(chunk.value,{stream:true});
        let boundary;
        while((boundary=buffer.indexOf('\n'))>=0){
          const message=JSON.parse(buffer.slice(0,boundary));buffer=buffer.slice(boundary+1);
          invariant(message.type==='event'||message.type==='closed','INVALID_AGENT_STREAM','Invalid CLI Agent event');
          onMessage(message);
          if(message.type==='closed'){ended=true;await reader.cancel();return;}
        }
        invariant(Buffer.byteLength(buffer)<=agentStreamBufferBytes,'AGENT_STREAM_OVERFLOW','CLI Agent stream frame is too large');
      }
      if(!signal.aborted&&!ended)throw new Error('CLI Agent live stream disconnected');
    }catch(error){if(!signal.aborted)onError(error);}
    finally{reader.releaseLock();}
  })();
  return ()=>controller.abort();
}
