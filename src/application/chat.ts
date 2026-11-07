import {randomUUID} from 'node:crypto';
import type {Store} from '../ports/store.ts';
import type {ChatRuntime,ChatSettings} from '../ports/chat.ts';
import {fail} from '../domain/errors.ts';
import {chatLimits,newChatTitle,automaticChatModel} from '../domain/chat.ts';

export function chatText(value:unknown,name:string,max:number):string{
 if(typeof value!=='string'||!value.trim()||value.length>max||value.includes('\0'))return fail(400,'INVALID_CHAT_INPUT',`${name} 必須為非空文字，最多 ${max} 字元`);
 return value.trim();
}
export function validateChatSettings(value:any):ChatSettings{
 if(!value||!Array.isArray(value.copilotArgs)||value.copilotArgs.some((x:unknown)=>typeof x!=='string'||x.includes('\0')))return fail(400,'INVALID_CHAT_SETTINGS','Copilot 參數必須為字串陣列');
 if(value.acpProvider!==undefined&&value.acpProvider!=='copilot'&&value.acpProvider!=='kiro')return fail(400,'INVALID_CHAT_SETTINGS','ACP 推論來源僅支援 copilot 或 kiro');
 if(value.kiroArgs!==undefined&&(!Array.isArray(value.kiroArgs)||value.kiroArgs.some((x:unknown)=>typeof x!=='string'||x.includes('\0'))))return fail(400,'INVALID_CHAT_SETTINGS','Kiro 參數必須為字串陣列');
 if(!Number.isInteger(value.timeoutMs)||value.timeoutMs<chatLimits.timeoutMin||value.timeoutMs>chatLimits.timeoutMax)return fail(400,'INVALID_CHAT_SETTINGS',`逾時須介於 ${chatLimits.timeoutMin} 與 ${chatLimits.timeoutMax} 毫秒`);
 return {
  codexExecutable:chatText(value.codexExecutable,'Codex 執行檔',4096),
  ...(value.acpProvider!==undefined?{acpProvider:value.acpProvider}:{}),
  copilotExecutable:chatText(value.copilotExecutable,'Copilot 執行檔',4096),
  copilotArgs:value.copilotArgs,
  ...(value.kiroExecutable!==undefined?{kiroExecutable:chatText(value.kiroExecutable,'Kiro 執行檔',4096)}:{}),
  ...(value.kiroArgs!==undefined?{kiroArgs:value.kiroArgs}:{}),
  model:chatText(value.model,'模型',160),
  timeoutMs:value.timeoutMs,
 };
}
export async function createChatService(store:Pick<Store,'all'|'run'|'batch'>,runtime:ChatRuntime,defaults:ChatSettings){
 await store.run('INSERT OR IGNORE INTO chat_settings(id,value_json) VALUES(1,?)',[JSON.stringify(defaults)]);
 await store.run("UPDATE chat_messages SET status='interrupted',error='工作台已重新啟動；上次回覆未完成' WHERE status='pending'");
 let revision=0,stateRevision=0;
 type Event={type:'changed'|'delta'|'closed';revision:number;roomId?:string;messageId?:string;delta?:string;offset?:number};
 const listeners=new Set<(event:Event)=>void>(),streams=new Map<string,{messageId:string;text:string}>();
 function publish(type:Event['type'],roomId?:string,delta?:string,offset?:number){if(type==='changed')stateRevision++;const event:Event={type,revision:++revision,roomId,...(type==='delta'?{messageId:streams.get(roomId!)!.messageId,delta,offset}:{})};for(const listener of listeners){try{listener(event);}catch(error){listeners.delete(listener);console.error('Chat subscriber failed',error);}}}
 const jobs=new Set<Promise<void>>(),admissions=new Set<Promise<unknown>>(),busyRooms=new Set<string>(),persistenceErrors:unknown[]=[];let closing=false,closePromise:Promise<void>|undefined;
 const requireOpen=()=>{if(closing)fail(503,'CHAT_CLOSED','聊天服務正在關閉');};
 function admit<T>(action:()=>Promise<T>){const job=action();admissions.add(job);void job.then(()=>admissions.delete(job),()=>admissions.delete(job));return job;}
 const room=async(id:string)=>{const row=(await store.all('SELECT * FROM chat_rooms WHERE id=?',[id]))[0];if(!row)fail(404,'CHAT_NOT_FOUND','找不到聊天室');return row;};
 const settings=async():Promise<ChatSettings>=>({...defaults,...JSON.parse((await store.all('SELECT value_json FROM chat_settings WHERE id=1'))[0].value_json)});
 const pending=async(id:string)=>(await store.all("SELECT id FROM chat_messages WHERE room_id=? AND status='pending'",[id])).length>0;
 const list=()=>store.all(`SELECT r.*,EXISTS(SELECT 1 FROM chat_messages m WHERE m.room_id=r.id AND m.status='pending') AS pending FROM chat_rooms r ORDER BY r.updated_at DESC,r.id`);
 const detail=async(id:string)=>({...await room(id),messages:await store.all('SELECT * FROM chat_messages WHERE room_id=? ORDER BY sequence',[id]),streaming:streams.has(id)?{...streams.get(id)!}:null});
 return {
  subscribe(listener:(event:Event)=>void){if(closing)fail(503,'CHAT_CLOSED','聊天服務正在關閉');listeners.add(listener);return ()=>{listeners.delete(listener);};},
  async snapshot(id?:string){while(true){const before=stateRevision,rooms=await list(),value=id?await detail(id):null;if(before!==stateRevision)continue;if(value&&id)value.streaming=streams.has(id)?{...streams.get(id)!}:null;return {type:'snapshot' as const,revision,rooms,room:value};}},
  settings,
  async models(){if(closing)fail(503,'CHAT_CLOSED','聊天服務正在關閉');const config=await settings();if(closing)fail(503,'CHAT_CLOSED','聊天服務正在關閉');return {models:await runtime.models(config),automaticModel:automaticChatModel};},
  async patchSettings(input:any){
   if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!Object.hasOwn(defaults,key)))fail(400,'INVALID_CHAT_SETTINGS','未知的對話設定欄位');
   const value=validateChatSettings({...await settings(),...input});
   if(closing)fail(503,'CHAT_CLOSED','聊天服務正在關閉');if(busyRooms.size)fail(409,'CHAT_BUSY','回覆進行中，請稍後再更新設定');
   const patch=Object.fromEntries(Object.keys(input).map(key=>[key,value[key as keyof ChatSettings]]));
   await store.run('UPDATE chat_settings SET value_json=json_patch(value_json,?) WHERE id=1',[JSON.stringify(patch)]);
   const next=await settings();void runtime.warmup?.(next);return next;
  },
  async saveSettings(input:unknown){const value=validateChatSettings(input);if(busyRooms.size)fail(409,'CHAT_BUSY','回覆進行中，請稍後再更新設定');await store.run('UPDATE chat_settings SET value_json=? WHERE id=1',[JSON.stringify(value)]);void runtime.warmup?.(value);return value;},
  list,
  async create(input:any){const title=input?.title===undefined?newChatTitle:chatText(input.title,'聊天室名稱',chatLimits.title),id=randomUUID(),now=new Date().toISOString();await store.run('INSERT INTO chat_rooms(id,title,created_at,updated_at) VALUES(?,?,?,?)',[id,title,now,now]);publish('changed',id);return room(id);},
  detail,
  async send(id:string,input:any){
   requireOpen();
   return admit(async()=>{
   if(busyRooms.has(id))fail(409,'CHAT_BUSY','此聊天室正在回覆，請等待完成');
   busyRooms.add(id);
   try{
   chatText(input?.content,'訊息',chatLimits.message);
   const text=input.content as string,current=await room(id),config=await settings();
   if(await pending(id))fail(409,'CHAT_BUSY','此聊天室正在回覆，請等待完成');
   const messageId=randomUUID(),now=new Date().toISOString();
   const firstMessage=!(await store.all('SELECT id FROM chat_messages WHERE room_id=? LIMIT 1',[id])).length;
   const title=firstMessage&&current.title===newChatTitle?Array.from(text.trim().replace(/\s+/g,' ')).slice(0,chatLimits.title).join(''):current.title;
   requireOpen();
   try{await store.batch([{sql:"INSERT INTO chat_messages(id,room_id,role,content,status,created_at) VALUES(?,?,'user',?,'pending',?)",params:[messageId,id,text,now]},{sql:'UPDATE chat_rooms SET updated_at=?,title=? WHERE id=?',params:[now,title,id]}]);}
   catch(error){if(await pending(id))fail(409,'CHAT_BUSY','此聊天室正在回覆，請等待完成');throw error;}
   streams.set(id,{messageId,text:''});publish('changed',id);
   const job=(async()=>{
    try{
     // The pending INSERT may have committed while shutdown started. Preserve
     // that user message as interrupted without starting work on a closed CLI.
     requireOpen();
     const answer=await runtime.reply({roomId:id,threadId:current.thread_id,text,settings:config,onDelta:delta=>{const stream=streams.get(id)!;const offset=stream.text.length;stream.text+=delta;publish('delta',id,delta,offset);},onThread:async threadId=>{await store.run('UPDATE chat_rooms SET thread_id=? WHERE id=?',[threadId,id]);}});
     if(!answer.trim())throw Error('CLI 未提供助手回覆');
     await store.batch([{sql:"UPDATE chat_messages SET status='completed' WHERE id=? AND status='pending'",params:[messageId],expectChanges:1},{sql:"INSERT INTO chat_messages(id,room_id,role,content,status,created_at) VALUES(?,?,'assistant',?,'completed',?)",params:[randomUUID(),id,answer,new Date().toISOString()]},{sql:'UPDATE chat_rooms SET updated_at=? WHERE id=?',params:[new Date().toISOString(),id]}]);
    }catch(error){await store.run("UPDATE chat_messages SET status=?,error=? WHERE id=? AND status='pending'",[closing?'interrupted':'failed',error instanceof Error?error.message:String(error),messageId]);}
    finally{streams.delete(id);busyRooms.delete(id);publish('changed',id);}
   })();jobs.add(job);void job.then(()=>jobs.delete(job),error=>{jobs.delete(job);persistenceErrors.push(error);console.error('Chat message persistence failed; the incomplete message remains pending until recovery.');});
   return {messageId};
   }catch(error){busyRooms.delete(id);throw error;}
   });
  },
  async compact(id:string){
   requireOpen();
   return admit(async()=>{
   if(busyRooms.has(id))fail(409,'CHAT_BUSY','此聊天室正在回覆');busyRooms.add(id);
   try{const current=await room(id);if(!current.thread_id)fail(409,'CHAT_NO_THREAD','此聊天室還沒有 Codex 對話');if(await pending(id))fail(409,'CHAT_BUSY','此聊天室正在回覆');const config=await settings();requireOpen();await runtime.compact({roomId:id,threadId:current.thread_id,settings:config});return {status:'completed'};}
   finally{busyRooms.delete(id);}
   });
  },
  close(){return closePromise??=(async()=>{
   closing=true;publish('closed');listeners.clear();
   // Cancel active inference first. Admissions can still be awaiting SQLite;
   // wait for them before collecting final persistence jobs or closing storage.
   const stopped=(async()=>{await runtime.close();})();
   const [shutdown]=await Promise.allSettled([stopped,...admissions]);
   await Promise.allSettled(jobs);
   if(shutdown.status==='rejected'){
    if(persistenceErrors.length)throw new AggregateError([shutdown.reason,...persistenceErrors],'Chat shutdown and message persistence failed');
    throw shutdown.reason;
   }
   if(persistenceErrors.length)throw new AggregateError(persistenceErrors,'Chat message persistence failed');
  })();},
 };
}
