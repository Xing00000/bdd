import test from 'node:test';
import assert from 'node:assert/strict';
import {operationTerminal} from '../../packages/workstation/public/operation-terminal.js';

function surface(){
  const elements=new Map(),terminals=[];
  const element=selector=>{
    if(!elements.has(selector))elements.set(selector,{hidden:true,value:'',textContent:'',disabled:false,clientWidth:800,events:{},
      addEventListener(name,handler){this.events[name]=handler;},replaceChildren(){}});
    return elements.get(selector);
  };
  const originals={document:globalThis.document,window:globalThis.window,ResizeObserver:globalThis.ResizeObserver};
  globalThis.document={querySelector:element};
  globalThis.window={Terminal:class{
    constructor(options){this.options=options;terminals.push(this);}open(){}write(){}resize(){}dispose(){this.disposed=true;}
    onData(handler){this.input=handler;return {dispose(){}};}
  }};
  globalThis.ResizeObserver=class{observe(){}disconnect(){}};
  const restore=()=>{for(const [key,value] of Object.entries(originals))if(value===undefined)delete globalThis[key];else globalThis[key]=value;};
  return {element,terminals,restore};
}
const operation=(id,runtime)=>({id,status:'RUNNING',request:{input:{agentSnapshot:{settings:{runtime}}}}});
const state=runtime=>({status:'RUNNING',phase:'RUNNING',runtime,output:'',nextOffset:0});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('SDK input waits for readiness and sends one exact multiline message without forwarding terminal keystrokes',async t=>{
  const {element,terminals,restore}=surface(),posts=[],received=[];let ready;
  const view=operationTerminal({api:async(path,method,input)=>{
    if(method==='POST'){posts.push({path,input});return {interactions:[{id:'input-one'}]};}
    return new Promise(resolve=>{ready=resolve;});
  },note:message=>assert.fail(message),onInteractions:items=>received.push(...items)});
  t.after(()=>{view.leave();restore();});
  await view.open(operation('job-sdk','codex-sdk'));
  const message='第一行\r\n第二行 {"literal":true}\n末行',field=element('#operation-sdk-message'),form=element('#operation-sdk-input');
  field.value=message;field.events.input();
  assert.equal(element('#operation-sdk-send').disabled,true);
  await form.events.submit({preventDefault(){}});assert.deepEqual(posts,[]);
  ready(state('codex-sdk'));await tick();
  assert.equal(element('#operation-sdk-send').disabled,false);
  assert.equal(terminals[0].options.disableStdin,true);assert.equal(terminals[0].input,undefined);assert.deepEqual(posts,[]);
  await form.events.submit({preventDefault(){}});
  assert.deepEqual(posts,[{path:'/operations/job-sdk/input',input:{message}}]);
  assert.deepEqual(received,[{id:'input-one'}]);assert.equal(field.value,'');
  assert.equal(element('#operation-sdk-send').disabled,true);
  assert.match(element('#operation-sdk-input-status').textContent,/已排入佇列/);
  assert.doesNotMatch(element('#operation-sdk-input-status').textContent,/已處理/);
});

test('historical CLI execution remains read-only and cannot dispatch terminal input',async t=>{
  const {element,terminals,restore}=surface(),posts=[];
  const view=operationTerminal({api:async(path,method,input)=>{
    if(method==='POST'){posts.push({path,input});return {interactions:[]};}
    return state('custom-cli');
  },note:message=>assert.fail(message)});
  t.after(()=>{view.leave();restore();});
  await view.open(operation('job-cli','custom-cli'));await tick();
  assert.equal(element('#operation-sdk-input').hidden,true);
  assert.equal(terminals[0].options.disableStdin,true);assert.equal(terminals[0].input,undefined);
  assert.deepEqual(posts,[]);assert.match(element('#operation-input-help').textContent,/僅供檢視/);
});

test('interactive CLI Agent session attached to an operation routes human intervention directly to the shared sessionId',async t=>{
  const {element,restore}=surface(),posts=[];
  const view=operationTerminal({api:async(path,method,input)=>{
    if(method==='POST'){posts.push({path,input});return {sessionId:'AS-shared-1',seq:3};}
    return {...state('codex-sdk'),agentSessions:[{sessionId:'AS-shared-1',status:'BUSY'}]};
  },note:message=>assert.fail(message)});
  t.after(()=>{view.leave();restore();});
  await view.open(operation('job-sdk-supervisor','codex-sdk'));await tick();
  assert.match(element('#operation-input-help').textContent,/AS-shared-1/);
  const field=element('#operation-sdk-message'),form=element('#operation-sdk-input');
  field.value='請補上空密碼錯誤處理';field.events.input();
  assert.equal(element('#operation-sdk-send').disabled,false);
  await form.events.submit({preventDefault(){}});
  assert.deepEqual(posts,[{path:'/agent-sessions/AS-shared-1/messages',input:{message:'請補上空密碼錯誤處理'}}]);
  assert.match(element('#operation-sdk-input-status').textContent,/互動式 CLI Agent Session/);
});

test('a finished terminal notifies completion, disposes its view, and opens a new active operation',async t=>{
  const {element,terminals,restore}=surface(),requests=[],completed=[];let finish;
  const view=operationTerminal({api:async path=>{requests.push(path);return new Promise(resolve=>{finish=resolve;});},note:message=>assert.fail(message),onComplete:()=>{completed.push(true);view.leave();}});
  t.after(()=>{view.leave();restore();});
  await view.open(operation('finished','codex-sdk'));
  finish({...state('codex-sdk'),status:'SUCCEEDED',hasMore:false,output:'done'});await tick();
  assert.equal(completed.length,1);assert.equal(element('#development-terminal').hidden,true);assert.equal(element('#operation-sdk-input').hidden,true);
  await view.open(operation('next','codex-sdk'));finish(state('codex-sdk'));await tick();
  assert.equal(terminals.length,2);assert.equal(terminals[0].disposed,true);assert.notEqual(terminals[1].disposed,true);assert.equal(element('#development-terminal').hidden,false);assert.equal(completed.length,1);
  assert.deepEqual(requests,['/operations/finished/terminal?offset=0','/operations/next/terminal?offset=0']);
});
