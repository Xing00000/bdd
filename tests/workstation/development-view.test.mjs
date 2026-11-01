import test from 'node:test';
import assert from 'node:assert/strict';
import { developmentView } from '../../packages/workstation/public/development.js';

function harness(status, api, canRecover=()=>true) {
  const elements = new Map(['#notice','#development-terminal','#development-status','#develop','#stop-development'].map(id => [id, { dataset:{}, textContent:'', hidden:false, disabled:false, replaceChildren(){} }]));
  globalThis.document={querySelector:id=>elements.get(id)};
  globalThis.window={addEventListener(){}};
  let version=0; const messages=[]; let refreshes=0;
  const feature={key:'REQ-1/feature',requirementId:'REQ-1',id:'feature'};
  const view=developmentView({api,view:()=>({repositoryId:'repo',detail:{operations:[{id:'old',status,request:{operation:'workflow.develop',input:{requirementId:'REQ-1',featureId:'feature'}}}]}}),feature:()=>feature,refresh:async()=>{refreshes++;},navigate:async()=>{},ask:async()=>{throw new Error('unexpected prompt');},note:(...args)=>messages.push(args),showOperation(){},beginAction:()=>++version,actionVersion:()=>version,canRecover});
  return {view,elements,messages,beginAction:()=>++version,refreshes:()=>refreshes};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('finished history drains without replacing a newer review receipt or showing its old error',async()=>{
  let resolveSecond; let calls=0;
  const h=harness('FAILED',async()=>++calls===1?{status:'FAILED',phase:'FAILED',output:'',hasMore:true,nextOffset:1,error:{message:'old error'}}:await new Promise(resolve=>{resolveSecond=resolve;}));
  await h.view.open(); await new Promise(resolve=>setTimeout(resolve,400));
  const notice=h.elements.get('#notice'); Object.assign(notice.dataset,{operation:'workflow.review',outcome:'SUCCEEDED',jobId:'review'});notice.textContent='new receipt';
  resolveSecond({status:'FAILED',phase:'FAILED',output:'',hasMore:false,nextOffset:2,error:{message:'old error'}});await flush();
  assert.equal(calls,2);assert.deepEqual(notice.dataset,{operation:'workflow.review',outcome:'SUCCEEDED',jobId:'review'});assert.equal(notice.textContent,'new receipt');assert.deepEqual(h.messages,[]);assert.equal(h.refreshes(),0);h.view.leave();
});

test('a recovered active session cannot announce after a newer action starts',async()=>{
  let resolvePoll;const h=harness('RUNNING',()=>new Promise(resolve=>{resolvePoll=resolve;}));
  await h.view.open();h.beginAction();const notice=h.elements.get('#notice');Object.assign(notice.dataset,{operation:'workflow.review',outcome:'SUCCEEDED',jobId:'review'});
  resolvePoll({status:'FAILED',phase:'FAILED',output:'',hasMore:false,error:{message:'old error'}});await flush();
  assert.deepEqual(notice.dataset,{operation:'workflow.review',outcome:'SUCCEEDED',jobId:'review'});assert.deepEqual(h.messages,[]);assert.equal(h.refreshes(),0);h.view.leave();
});

test('a recovered active session still announces its own completion',async()=>{
  const h=harness('RUNNING',async()=>({status:'SUCCEEDED',phase:'COMPLETED',output:'',hasMore:false,result:{testOutcome:'FAILED'}}));
  await h.view.open();await flush();assert.deepEqual(h.elements.get('#notice').dataset,{operation:'workflow.develop',outcome:'SUCCEEDED',jobId:'old'});assert.equal(h.refreshes(),1);h.view.leave();
});

test('an active session attached during a newer operation remains read-only',async()=>{
  const h=harness('RUNNING',async()=>({status:'FAILED',phase:'FAILED',output:'',hasMore:false,error:{message:'old error'}}),()=>false);
  const notice=h.elements.get('#notice');Object.assign(notice.dataset,{operation:'workflow.review',outcome:'SUCCEEDED',jobId:'review'});
  await h.view.open();await flush();assert.equal(notice.dataset.operation,'workflow.review');assert.deepEqual(h.messages,[]);assert.equal(h.refreshes(),0);h.view.leave();
});
