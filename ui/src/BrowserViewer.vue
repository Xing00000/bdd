<script setup lang="ts">
import { ref,watch,onBeforeUnmount } from 'vue';
import { api,errorText,socketUrl } from './api';
import { bindingKeys,sameRunBinding,viewportPoint,newerFrame } from './transport';
const props=withDefaults(defineProps<{sessionId?:string;runId?:string;projectId?:string;interactive?:boolean;minimal?:boolean}>(),{interactive:false,minimal:false});
const emit=defineEmits<{error:[message:string];event:[event:any];connected:[sessionId:string]}>();
const canvas=ref<HTMLCanvasElement>();const streamState=ref('waiting');const lastFrame=ref<any>();const pages=ref<{id:string;url:string}[]>([]);
const imeInput=ref<HTMLTextAreaElement>();
type PointerMessage={type:'pointer';action:'move';x:number;y:number;button:string;pageId:string;contextRef:string};
const inputState={composing:false,suppressedKeyUps:new Set<string>(),pressedKeys:new Set<string>(),pointerId:undefined as number|undefined,pointerButton:'left',pointerBinding:undefined as {pageId:string;contextRef:string}|undefined,pointerPoint:undefined as {x:number;y:number}|undefined,pendingMove:undefined as PointerMessage|undefined,moveRequest:undefined as number|undefined};
let ws:WebSocket|undefined,header:any,waiting:{header:any;bytes:ArrayBuffer}|undefined,processing=false,disposed=false,generation=0,lastAt=0,currentBinding:any;
function clear(){releaseRemoteInput();if(ws){ws.close();ws=undefined;}header=undefined;waiting=undefined;generation++;streamState.value='waiting';lastFrame.value=undefined;pages.value=[];if(canvas.value){canvas.value.getContext('2d')?.clearRect(0,0,canvas.value.width,canvas.value.height);for(const k of [...bindingKeys,'frameSha256'])delete (canvas.value.dataset as any)[k];}}
function pageEvent(event:any){if(event.type==='browser.pageClosed')pages.value=pages.value.filter(p=>p.id!==event.pageId);else if(event.pageId){const known=pages.value.find(p=>p.id===event.pageId);if(known&&event.payload?.url)known.url=event.payload.url;else if(!known)pages.value.push({id:event.pageId,url:event.payload?.url??''});}emit('event',event);}
watch(()=>props.sessionId,id=>{clear();if(!id)return;ws=new WebSocket(socketUrl(`/browser-sessions/${encodeURIComponent(id)}`));ws.binaryType='arraybuffer';ws.onopen=()=>{streamState.value='connected';emit('connected',id);};ws.onmessage=event=>{if(typeof event.data==='string'){let message:any;try{message=JSON.parse(event.data);}catch{return;}if(message.type==='browser.frame')header=message;else if(message.type==='error'||message.type==='browser.error'){streamState.value='error';emit('error',message.message??message.payload?.message??'瀏覽器執行失敗');}else pageEvent(message);}else if(header){const h=header;header=undefined;present(h,event.data);}};ws.onerror=()=>{streamState.value='error';emit('error','瀏覽器串流連線失敗');};ws.onclose=()=>{streamState.value='closed';};},{immediate:true});
watch(()=>props.runId,()=>{if(props.sessionId)return;generation++;waiting=undefined;streamState.value=props.runId?'waiting':'not_bound';});
async function present(h:any,bytes:ArrayBuffer){if(disposed)return;if(props.runId&&h.runId!==props.runId)return;if(props.sessionId&&h.sessionId!==props.sessionId)return;if(!newerFrame(h,waiting?.header??lastFrame.value))return;waiting={header:h,bytes};if(processing)return;processing=true;try{while(waiting&&!disposed){const current=waiting;waiting=undefined;const frameGeneration=generation;const frame=current.header;const expected=frame.payload?.sha256??frame.payload?.frameSha256;
  if(!expected){emit('error','畫格缺少 SHA-256，已拒絕呈現');continue;}
  const digest=await crypto.subtle.digest('SHA-256',current.bytes);const actual=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');if(actual!==expected){emit('error','畫格 SHA-256 不一致，已拒絕呈現');continue;}
  if(props.runId){if(currentBinding&&!sameRunBinding(frame,currentBinding))continue;const binding=await api(`/runs/${encodeURIComponent(props.runId)}/viewer-binding`);if(!sameRunBinding(frame,binding))continue;}
  const image=await createImageBitmap(new Blob([current.bytes],{type:'image/jpeg'}));if(frameGeneration!==generation||disposed||(props.runId&&frame.runId!==props.runId)||(props.runId&&currentBinding&&!sameRunBinding(frame,currentBinding))||!newerFrame(frame,lastFrame.value)){image.close();continue;}
  const el=canvas.value;if(!el){image.close();continue;}el.width=image.width;el.height=image.height;const context=el.getContext('2d');if(!context){image.close();throw Error('此瀏覽器無法建立 canvas 2D 畫布，未呈現畫格');}context.drawImage(image,0,0);image.close();
  for(const key of bindingKeys){if(frame[key]!==undefined)(el.dataset as any)[key]=String(frame[key]);else delete (el.dataset as any)[key];}el.dataset.frameSha256=actual;if(props.interactive&&!pages.value.some(p=>p.id===frame.pageId))pages.value.push({id:frame.pageId,url:''});lastFrame.value=frame;lastAt=Number.isFinite(frame.payload?.timestamp)?frame.payload.timestamp:Date.now();streamState.value=Date.now()-lastAt<=8000?'live':'waiting';
 }}catch(error){streamState.value='error';emit('error',errorText(error));}finally{processing=false;}}
function send(message:any){if(!props.interactive)return;if(!ws||ws.readyState!==WebSocket.OPEN){emit('error','瀏覽器尚未連線，輸入未送出');return;}ws.send(JSON.stringify({pageId:lastFrame.value?.pageId,contextRef:lastFrame.value?.contextRef,...message}));}
function flushPointerMove(){if(inputState.moveRequest!==undefined)cancelAnimationFrame(inputState.moveRequest);inputState.moveRequest=undefined;const move=inputState.pendingMove;inputState.pendingMove=undefined;if(move)send(move);}
function releasePointerCapture(){const id=inputState.pointerId;inputState.pointerId=undefined;inputState.pointerBinding=undefined;inputState.pointerPoint=undefined;if(id!==undefined&&canvas.value?.hasPointerCapture(id))canvas.value.releasePointerCapture(id);}
function cancelPointer(){flushPointerMove();if(inputState.pointerId!==undefined&&inputState.pointerPoint&&inputState.pointerBinding)send({type:'pointer',action:'up',...inputState.pointerPoint,button:inputState.pointerButton,...inputState.pointerBinding});releasePointerCapture();}
function releaseRemoteInput(){cancelPointer();for(const key of inputState.pressedKeys)send({type:'key',action:'up',key});inputState.pressedKeys.clear();inputState.suppressedKeyUps.clear();inputState.composing=false;if(imeInput.value)imeInput.value.value='';}
function pointer(event:PointerEvent,action:string){
  if(!props.interactive||!canvas.value||!lastFrame.value)return;
  if(inputState.pointerId!==undefined&&inputState.pointerId!==event.pointerId)return;
  const bounds=canvas.value.getBoundingClientRect(),payload=lastFrame.value.payload;
  let point=viewportPoint(bounds,{width:payload.viewportWidth??canvas.value.width,height:payload.viewportHeight??canvas.value.height},{x:event.clientX,y:event.clientY});
  // Capture guarantees the release arrives even outside the canvas. Release at
  // the last valid viewport point rather than submitting invalid coordinates.
  if(!point&&action==='up'&&inputState.pointerId===event.pointerId)point=inputState.pointerPoint??null;
  if(!point)return;
  const binding=inputState.pointerBinding??{pageId:lastFrame.value.pageId,contextRef:lastFrame.value.contextRef};
  const button=action==='move'&&inputState.pointerId!==undefined?inputState.pointerButton:['left','middle','right'][event.button]??'left';
  if(action==='move'){
    if(inputState.pointerId!==undefined)inputState.pointerPoint=point;
    inputState.pendingMove={type:'pointer',action:'move',...point,button,...binding};
    if(inputState.moveRequest===undefined)inputState.moveRequest=requestAnimationFrame(flushPointerMove);
    return;
  }
  flushPointerMove();
  if(action==='down'){
    // A focusable canvas alone does not reliably activate an OS input method.
    if(imeInput.value)imeInput.value.focus({preventScroll:true});else canvas.value.focus({preventScroll:true});
    inputState.pointerId=event.pointerId;inputState.pointerButton=button;inputState.pointerBinding=binding;inputState.pointerPoint=point;
    canvas.value.setPointerCapture(event.pointerId);
  }
  send({type:'pointer',action,...point,button,...binding});
  if(action==='up')releasePointerCapture();
}
function keyboard(event:KeyboardEvent,action:string){
  if(!props.interactive)return;
  const identity=event.code||event.key;
  if(action==='up'&&inputState.suppressedKeyUps.delete(identity))return;
  if(inputState.composing||event.isComposing||event.keyCode===229||['Process','Dead'].includes(event.key)){
    if(action==='down')inputState.suppressedKeyUps.add(identity);
    return; // Native composition must proceed in the local input sink.
  }
  event.preventDefault();
  if(action==='up'&&inputState.pressedKeys.delete(event.key)){send({type:'key',action:'up',key:event.key,code:event.code});return;}
  if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){if(action==='down')send({type:'text',text:event.key});return;}
  if(action==='down')inputState.pressedKeys.add(event.key);
  send({type:'key',action,key:event.key,code:event.code,modifiers:[event.ctrlKey?'Control':null,event.metaKey?'Meta':null,event.shiftKey?'Shift':null,event.altKey?'Alt':null].filter(Boolean)});
}
function compositionStart(){if(!props.interactive)return;inputState.composing=true;if(imeInput.value)imeInput.value.value='';}
function compositionEnd(event:CompositionEvent){if(!props.interactive||!inputState.composing)return;inputState.composing=false;if(event.data)send({type:'text',text:event.data});if(imeInput.value)imeInput.value.value='';}
function clearInput(){if(!inputState.composing&&imeInput.value)imeInput.value.value='';}
function wheel(event:WheelEvent){if(!props.interactive)return;event.preventDefault();send({type:'wheel',deltaX:event.deltaX,deltaY:event.deltaY});}
function selectPage(pageId:string){releaseRemoteInput();send({type:'activatePage',pageId});generation++;waiting=undefined;lastFrame.value=undefined;streamState.value='waiting';}
function navigate(url:string){send({type:'navigate',url});}
function ended(){generation++;waiting=undefined;streamState.value='ended';}
function bind(binding:any){if(binding.runId!==props.runId)return;if(currentBinding&&sameRunBinding(binding,currentBinding))return;currentBinding=binding;generation++;waiting=undefined;lastFrame.value=undefined;streamState.value='waiting';if(canvas.value)delete canvas.value.dataset.frameSha256;}
function started(){currentBinding=undefined;generation++;waiting=undefined;lastFrame.value=undefined;streamState.value='waiting';if(canvas.value)delete canvas.value.dataset.frameSha256;}
const timer=window.setInterval(()=>{if(streamState.value==='live'&&Date.now()-lastAt>8000)streamState.value='waiting';},1000);
onBeforeUnmount(()=>{disposed=true;clear();clearInterval(timer);});
defineExpose({present,navigate,ended,bind,started});
</script>
<template><div class="browser-view" :class="{'minimal-browser-view':minimal}"><div v-if="interactive&&pages.length&&!minimal" class="browser-tabs"><button v-for="p in pages" :key="p.id" class="browser-tab" :class="{active:lastFrame?.pageId===p.id}" :title="p.url||p.id" @click="selectPage(p.id)">{{p.url||'分頁 · '+p.id.slice(0,6)}}</button></div><div v-if="!minimal" class="stream-bar"><span class="status-dot" :class="{live:streamState==='live'}"></span><span :data-testid="interactive?'browser-stream-state':'run-stream-state'">{{streamState}}</span><span class="stream-kind">{{interactive?'同會話 · 可操作':'目前測試 · 即時畫面'}}</span></div><div class="canvas-stage"><canvas ref="canvas" :data-testid="interactive?'browser-canvas':'run-browser-canvas'" tabindex="0" aria-label="遠端瀏覽器即時畫面" @pointerdown.prevent="pointer($event,'down')" @pointerup.prevent="pointer($event,'up')" @pointermove="pointer($event,'move')" @pointercancel="cancelPointer" @lostpointercapture="cancelPointer" @keydown="keyboard($event,'down')" @keyup="keyboard($event,'up')" @compositionstart="compositionStart" @compositionend="compositionEnd" @blur="releaseRemoteInput" @wheel="wheel" @contextmenu.prevent></canvas><textarea v-if="interactive" ref="imeInput" data-testid="browser-input-sink" aria-label="遠端瀏覽器文字輸入" tabindex="-1" autocomplete="off" autocapitalize="off" :spellcheck="false" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;padding:0;border:0;resize:none" @keydown="keyboard($event,'down')" @keyup="keyboard($event,'up')" @compositionstart="compositionStart" @compositionend="compositionEnd" @input="clearInput" @blur="releaseRemoteInput"></textarea><div v-if="!lastFrame&&!minimal" class="canvas-placeholder"><span class="placeholder-icon">▣</span><strong>{{runId?'等待目前測試綁定頁面':'尚未收到瀏覽器畫格'}}</strong><p>只呈現真實會話的 JPEG 串流</p></div></div><div v-if="!minimal" class="binding-meta"><span :data-testid="interactive?'browser-session-id':'run-session-id'">{{sessionId||lastFrame?.sessionId||'未綁定'}}</span><span v-if="lastFrame?.testKey">{{lastFrame.testKey}}</span><span v-if="lastFrame?.bindingSeq">seq {{lastFrame.bindingSeq}}</span></div></div></template>
