import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDesignDecisions,writeDesignDecisions,mergeGeneratedDecisions,assertDesignDecisionsResolved,decisionAnswer} from '../../packages/spec-toolkit/design-decisions.mjs';
import {defaultPromptSeeds,seedAgentSettings,agentPromptFields} from '../../packages/workstation/agent-settings.mjs';
import {readFile} from 'node:fs/promises';
const data={schemaVersion:1,items:[{id:'transport',question:'主機連線方式？',options:[{id:'ws',label:'WebSocket'}],answer:null}]};
test('decision answers validate real options and custom input, remain in the canonical document and gate SD approval',()=>{
 const source=writeDesignDecisions('# Design\nExisting architecture.',data);assert.deepEqual(parseDesignDecisions(source),data);assert.throws(()=>assertDesignDecisionsResolved(source),{code:'DESIGN_DECISIONS_REQUIRED'});
 const custom=structuredClone(data);custom.items[0].answer={optionId:'other',customText:'Use a separately authenticated relay'};const saved=writeDesignDecisions(source,custom);assert.equal(decisionAnswer(parseDesignDecisions(saved).items[0]),custom.items[0].answer.customText);assertDesignDecisionsResolved(saved);assert.match(saved,/Existing architecture/);
 custom.items[0].answer.customText=' ';assert.throws(()=>writeDesignDecisions(source,custom),{code:'INVALID_DESIGN_DECISIONS'});
 for(const answer of [{optionId:'missing'},{optionId:'ws',customText:'hidden override'}]){const invalid=structuredClone(data);invalid.items[0].answer=answer;assert.throws(()=>writeDesignDecisions(source,invalid));}
 assert.throws(()=>parseDesignDecisions('# Missing',{required:true}));assert.throws(()=>parseDesignDecisions(source+'\n'+source));
});
test('generation cannot answer on behalf of a user or remove prior decisions',()=>{
 const source=writeDesignDecisions('# Design',data),answered=structuredClone(data);answered.items[0].answer={optionId:'ws'};const human=writeDesignDecisions(source,answered);
 assert.throws(()=>mergeGeneratedDecisions(source,human),{code:'INVALID_DESIGN_DECISIONS'});
 assert.equal(parseDesignDecisions(mergeGeneratedDecisions(human,source)).items[0].answer.optionId,'ws');
 const empty=writeDesignDecisions('# New design',{schemaVersion:1,items:[]});assert.equal(parseDesignDecisions(mergeGeneratedDecisions(human,empty)).items[0].answer.optionId,'ws');
 const changed=structuredClone(data);changed.items[0].question='Unrelated question';assert.throws(()=>mergeGeneratedDecisions(human,writeDesignDecisions('# New',changed)),{code:'DESIGN_DECISION_CHANGED'});
});
test('every functional default Prompt comes from the Git seed, and custom text is retained',async()=>{
 const seed=JSON.parse(await readFile(new URL('../../packages/workstation/seeds/prompts.json',import.meta.url),'utf8'));assert.deepEqual(seed.prompts,defaultPromptSeeds);
 for(const entry of seed.prompts){assert.equal(seedAgentSettings()[agentPromptFields[entry.purpose]],entry.content);assert.equal(seedAgentSettings({[agentPromptFields[entry.purpose]]:'Custom text'})[agentPromptFields[entry.purpose]],'Custom text');}
});
