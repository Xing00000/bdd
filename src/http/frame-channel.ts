type FrameEvent = {image?:Buffer;sessionId?:string;contextRef?:string;pageId?:string;runId?:string;bindingSeq?:number;payload?:{frameSequence?:number};[key:string]:unknown};
type Socket = {readyState:number;bufferedAmount:number;send:(data:string|Buffer,options?:{binary:boolean})=>unknown};
/** Latest-frame transport policy only; this does not manufacture browser pixels. */
export function createFrameChannel(threshold=1024*1024) {
  const pending=new Map<Socket,FrameEvent>();
  const seen=new Map<Socket,Map<string,number>>();
  function forget(socket:Socket){pending.delete(socket);seen.delete(socket);}
  function write(socket:Socket,event:FrameEvent){const {image,...header}=event;socket.send(JSON.stringify(header));if(image)socket.send(image,{binary:true});}
  function send(socket:Socket,event:FrameEvent){
    if(socket.readyState!==1){forget(socket);return;}
    if(event.image){
      const sequence=event.payload?.frameSequence,key=[event.sessionId,event.contextRef,event.pageId,event.runId??'',event.bindingSeq??''].join('|');
      if(Number.isFinite(sequence)){const states=seen.get(socket)??new Map<string,number>();if(Number(sequence)<=(states.get(key)??-1))return;states.set(key,Number(sequence));seen.set(socket,states);}
      if(socket.bufferedAmount>threshold){pending.set(socket,event);return;}
      pending.delete(socket); // A newer immediate frame supersedes a previously queued one.
    }
    write(socket,event);
  }
  function flush(){for(const [socket,event]of pending){if(socket.readyState!==1)forget(socket);else if(socket.bufferedAmount<=threshold){pending.delete(socket);write(socket,event);}}}
  return {send,flush,forget,clear(){pending.clear();seen.clear();},pendingCount:()=>pending.size};
}
