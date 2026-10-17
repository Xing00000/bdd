import test from 'node:test';
import assert from 'node:assert/strict';
import {llmFromEnvironment} from '../../src/adapters/generation/config.ts';
import {cliProposal} from '../../src/adapters/generation/cli.ts';

test('terminal CLI is the explicit default and HTTP requires complete explicit configuration',()=>{
 assert.deepEqual(llmFromEnvironment({}),{kind:'cli',executable:'claude'});
 assert.deepEqual(llmFromEnvironment({WB_LLM_CLI_PATH:'/custom/claude',WB_LLM_MODEL:'selected-model'}),{kind:'cli',executable:'/custom/claude',model:'selected-model'});
 assert.throws(()=>llmFromEnvironment({WB_LLM_MODE:'unknown'}));
 assert.throws(()=>llmFromEnvironment({WB_LLM_MODE:'http'}));
 assert.deepEqual(llmFromEnvironment({WB_LLM_MODE:'http',WB_LLM_API_KEY:'test-only',WB_LLM_MODEL:'selected-model',WB_LLM_BASE_URL:'http://localhost:9999'}),{apiKey:'test-only',model:'selected-model',baseUrl:'http://localhost:9999'});
});

test('unavailable terminal CLI fails explicitly without a provider fallback',async()=>{
 await assert.rejects(cliProposal({executable:'/nonexistent/workbench-cli'},'No task',{}),(e:any)=>e.code==='LLM_CLI_UNAVAILABLE');
});
