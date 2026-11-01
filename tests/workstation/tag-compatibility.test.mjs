import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTags, testIdentity, caseSelection } from '../../packages/spec-toolkit/tags.mjs';

const context = {req:'REQ-001',feature:'login'};
test('current and legacy tags normalize to the same execution identity',()=>{
  const current=testIdentity({title:'login',tags:['@case:CASE-001','@smoke']},context.req,context.feature);
  const legacy=testIdentity({title:'login',tags:['@req=REQ-001','@feature=login','@case=CASE-001']},context.req,context.feature);
  assert.deepEqual(current,legacy);
  assert.deepEqual(current,{requirementId:context.req,featureId:context.feature,caseId:'CASE-001'});
  assert.equal(parseTags(['@case:CASE-001'],['req','feature','case'],context).req,context.req);
});
test('context does not conceal missing case IDs or conflicting declarations',()=>{
  assert.throws(()=>testIdentity({title:'login',tags:[]},context.req,context.feature),{code:'MISSING_TAG_KEY'});
  assert.throws(()=>testIdentity({title:'login',tags:['@case:CASE-001','@req=REQ-002']},context.req,context.feature),{code:'TAG_IDENTITY_MISMATCH'});
  assert.throws(()=>testIdentity({title:'login',tags:['@case:CASE-001','@case=CASE-001']},context.req,context.feature),{code:'DUPLICATE_TAG_KEY'});
  assert.throws(()=>testIdentity({title:'login [case:CASE-002] [case:CASE-003]',tags:[]},context.req,context.feature),{code:'CASE_ID_CONFLICT'});
  assert.throws(()=>parseTags(['@case:'],[],context),{code:'INVALID_TAG'});
  assert.throws(()=>testIdentity({title:'login',tags:['@case:CASE-001']},undefined,context.feature),{code:'INVALID_ID'});
});
test('examples and selection support both persisted spellings without partial-ID matches',()=>{
  for(const separator of [':','=']) {
    assert.equal(testIdentity({title:`login [case${separator}CASE-002]`,tags:[]},context.req,context.feature).caseId,'CASE-002');
    assert.equal(testIdentity({title:`login [case${separator}CASE-002]`,tags:['@case:OUTLINE']},context.req,context.feature).caseId,'CASE-002');
    const selection=new RegExp(caseSelection(['CASE-002']));
    assert.ok(selection.test(`@case${separator}CASE-002`));assert.ok(selection.test(`[case${separator}CASE-002]`));
    assert.ok(!selection.test(`@case${separator}CASE-002-extra`));
  }
});
test('legacy shared helpers resolve identity only from the selected execution context',()=>{
  const previous={req:process.env.WB_REQUIREMENT_ID,feature:process.env.WB_FEATURE_ID};
  try {
    process.env.WB_REQUIREMENT_ID=context.req;process.env.WB_FEATURE_ID=context.feature;
    const tags=parseTags(['@case:CASE-001'],['req','feature','case']);
    assert.equal(tags.req,context.req);assert.equal(tags.feature,context.feature);
    assert.throws(()=>parseTags(['@req=REQ-other','@case:CASE-001'],['req','feature','case']),{code:'TAG_IDENTITY_MISMATCH'});
    delete process.env.WB_REQUIREMENT_ID;
    assert.throws(()=>parseTags(['@case:CASE-001'],['req','feature','case']),{code:'INVALID_ID'});
  } finally {
    for(const [key,value] of [['WB_REQUIREMENT_ID',previous.req],['WB_FEATURE_ID',previous.feature]]) {
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
});
