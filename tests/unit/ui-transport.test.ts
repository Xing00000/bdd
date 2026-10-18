import test from 'node:test';
import assert from 'node:assert/strict';
import { sameRunBinding,viewportPoint } from '../../ui/src/transport.ts';
test('viewer rejects frames from another run, test, result, session, context, page or binding generation',()=>{
  const current={runId:'run-2',testDefinitionId:'test-2',caseResultId:'result-2',sessionId:'session-2',contextRef:'context-2',pageId:'page-2',bindingSeq:4};
  assert.equal(sameRunBinding({...current},current),true);
  for(const key of Object.keys(current)){assert.equal(sameRunBinding({...current,[key]:'stale'},current),false,key);const missing:any={...current};delete missing[key];assert.equal(sameRunBinding(missing,current),false,`missing ${key}`);}
});
test('pointer coordinates remove CSS scale and letterboxing, and reject clicks outside the viewport',()=>{
  const bounds={left:10,top:20,width:600,height:400},viewport={width:1200,height:600};
  assert.deepEqual(viewportPoint(bounds,viewport,{x:310,y:220}),{x:600,y:300});
  assert.deepEqual(viewportPoint(bounds,viewport,{x:10,y:70}),{x:0,y:0});
  assert.equal(viewportPoint(bounds,viewport,{x:310,y:40}),null);
  assert.equal(viewportPoint(bounds,viewport,{x:610,y:220}),null);
  assert.equal(viewportPoint(bounds,{width:0,height:600},{x:310,y:220}),null);
});
