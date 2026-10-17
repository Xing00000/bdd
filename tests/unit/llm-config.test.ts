import test from 'node:test';
import assert from 'node:assert/strict';
import {llmFromEnvironment} from '../../src/adapters/generation/config.ts';
import {createLlmProvider} from '../../src/adapters/generation/llm.ts';

test('web terminal CLI is the only provider and API modes are rejected',()=>{
 assert.deepEqual(llmFromEnvironment({}),{executable:'codex'});
 assert.deepEqual(llmFromEnvironment({WB_LLM_CLI_PATH:'/custom/codex',WB_LLM_MODEL:'selected-model'}),{executable:'/custom/codex',model:'selected-model'});
 assert.throws(()=>llmFromEnvironment({WB_LLM_MODE:'unknown'}));
 assert.throws(()=>llmFromEnvironment({WB_LLM_MODE:'http'}));
 assert.throws(()=>llmFromEnvironment({WB_LLM_MODE:'http',WB_LLM_API_KEY:'test-only',WB_LLM_MODEL:'selected-model',WB_LLM_BASE_URL:'http://localhost:9999'}));
});

test('a configured executable cannot run without the web terminal runtime',async()=>{
 const llm=createLlmProvider({root:process.cwd(),artifactRoot:process.cwd(),llm:{executable:'codex'}});
 await assert.rejects(llm.generateSd({gherkin:'Feature: context'}),(e:any)=>e.code==='LLM_UNCONFIGURED');
});
