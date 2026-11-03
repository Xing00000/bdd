import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('the actual requirement change handler restores its selection when navigation is cancelled',async()=>{
  const source=await readFile(new URL('../../packages/workstation/public/app.js',import.meta.url),'utf8');
  const navigate=source.slice(source.indexOf('async function navigate('),source.indexOf('\nasync function route('));
  const handler=source.slice(source.indexOf("on('#feature-select','change'"),source.indexOf("on('#save-source','click'"));
  const select={value:'REQ-002/second'},state={view:'features',featureKey:'REQ-001/first',composer:{description:'Original unsaved draft'}};
  const handlers=new Map(),sandbox={state,chat:{leave(){}},guard:async()=>false,$:()=>select,on:(selector,event,callback)=>handlers.set(selector+':'+event,callback)};
  vm.runInNewContext(navigate+'\n'+handler,sandbox);
  await handlers.get('#feature-select:change')();
  assert.equal(select.value,'REQ-001/first');assert.equal(state.featureKey,'REQ-001/first');assert.equal(state.composer.description,'Original unsaved draft');
});
