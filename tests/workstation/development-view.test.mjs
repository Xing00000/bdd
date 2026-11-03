import test from 'node:test';
import assert from 'node:assert/strict';
import { developmentView } from '../../packages/workstation/public/development.js';

function harness(status, api, canRecover=()=>true, previewAgent=async()=>null) {
  const elements = new Map(['#notice','#development-terminal','#development-status','#develop','#stop-development'].map(id => [id, { dataset:{}, textContent:'', hidden:false, disabled:false, replaceChildren(){} }]));
  globalThis.document={querySelector:id=>elements.get(id)};
  globalThis.window={addEventListener(){}};
  let version=0; const messages=[],shown=[]; let refreshes=0;
  let feature={key:'REQ-1/feature',requirementId:'REQ-1',id:'feature'};
  const state={repositoryId:'repo',detail:{operations:[{id:'old',status,request:{operation:'workflow.develop',input:{requirementId:'REQ-1',featureId:'feature'}}}]}};
  const view=developmentView({api,view:()=>state,feature:()=>feature,refresh:async()=>{refreshes++;},navigate:async()=>{},ask:async()=>{throw new Error('unexpected prompt');},previewAgent,note:(...args)=>messages.push(args),showOperation:operation=>shown.push(operation),beginAction:()=>++version,actionVersion:()=>version,canRecover});
  return {view,elements,messages,shown,beginAction:()=>++version,refreshes:()=>refreshes,select(repositoryId,key){state.repositoryId=repositoryId;state.detail.operations=[];feature={key,requirementId:key.split('/')[0],id:key.split('/')[1]};}};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('a delayed launch remains owned by its original repository and cannot attach to a new selection',async()=>{
 let resolveLaunch;const calls=[];
 const h=harness('FAILED',async(route,method,body)=>{calls.push({route,body});return new Promise(resolve=>{resolveLaunch=resolve;});});
 const pending=h.view.start({acceptanceFeedback:{message:'original opinion'}},{prompt:'original opinion',promptDigest:'original digest'});await flush();
 h.select('other-repository','REQ-other/feature');resolveLaunch({id:'original-operation',status:'RUNNING'});const accepted=await pending;await flush();
 assert.equal(accepted.id,'original-operation');assert.equal(calls[0].body.repositoryId,'repo');assert.equal(calls[0].body.input.requirementId,'REQ-1');assert.deepEqual(h.shown,[]);assert.equal(calls.length,1);h.view.leave();
});

test('development waits for an edited preview, cancel never dispatches, and submit sends exact text',async()=>{
  let resolvePreview;const calls=[];
  const h=harness('FAILED',async(route,method,body)=>{
    calls.push({route,method,body});
    return route==='/operations'?{id:'new',status:'RUNNING'}:{status:'SUCCEEDED',phase:'COMPLETED',output:'',hasMore:false,result:{testOutcome:'FAILED'}};
  },()=>true,()=>new Promise(resolve=>{resolvePreview=resolve;}));
  const cancelled=h.view.start();await flush();assert.equal(calls.length,0);resolvePreview(null);await cancelled;assert.equal(calls.length,0);
  const submitted=h.view.start();await flush();assert.equal(calls.length,0);
  const approved={prompt:'Exact user text\nNo hidden appendix.',promptDigest:'current'};resolvePreview(approved);await submitted;await flush();
  assert.equal(calls.filter(call=>call.route==='/operations').length,1);
  assert.deepEqual(calls[0].body.input,{requirementId:'REQ-1',featureId:'feature',...approved});h.view.leave();
});

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
