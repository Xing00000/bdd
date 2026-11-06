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
    constructor(){terminals.push(this);}open(){}write(){}resize(){}dispose(){}
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
  terminals[0].input('unwanted terminal input\r');assert.deepEqual(posts,[]);
  await form.events.submit({preventDefault(){}});
  assert.deepEqual(posts,[{path:'/operations/job-sdk/input',input:{message}}]);
  assert.deepEqual(received,[{id:'input-one'}]);assert.equal(field.value,'');
  assert.equal(element('#operation-sdk-send').disabled,true);
  assert.match(element('#operation-sdk-input-status').textContent,/已排入佇列/);
  assert.doesNotMatch(element('#operation-sdk-input-status').textContent,/已處理/);
});

test('an explicit custom CLI keeps terminal input and hides the SDK composer',async t=>{
  const {element,terminals,restore}=surface(),posts=[];
  const view=operationTerminal({api:async(path,method,input)=>{
    if(method==='POST'){posts.push({path,input});return {interactions:[]};}
    return state('custom-cli');
  },note:message=>assert.fail(message)});
  t.after(()=>{view.leave();restore();});
  await view.open(operation('job-cli','custom-cli'));await tick();
  assert.equal(element('#operation-sdk-input').hidden,true);
  terminals[0].input('terminal edit\r');await tick();
  assert.deepEqual(posts,[{path:'/operations/job-cli/input',input:{data:'terminal edit\r'}}]);
});
