import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {previewAgentPrompt,approvedAgentPrompt,writeAgentTask,agentArguments,taskRpc} from '../../packages/workstation/agent-task.mjs';
import {validateAgentSettings} from '../../packages/workstation/agent-settings.mjs';

const selection={requirementId:'REQ-one',featureId:'login',purpose:'development'};
const snapshot={revision:1,settings:{agent:validateAgentSettings()},files:[
  {target:'spec',path:'spec/REQ-one/login/login.feature',content:'Feature: Approved login'},
  {target:'spec',path:'spec/REQ-other/other/other.feature',content:'unrelated private content'}
]};
test('design MCP only exposes products linked to the selected feature and the current unsaved design',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'design-task-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const files=[...snapshot.files,{target:'spec',path:'tests/_shared/bdd.ts',content:'unrelated test infrastructure'},{target:'project:reader',path:'src/main.ts',content:'selected product'},{target:'project:other',path:'src/main.ts',content:'unrelated product'}];
  const file=await writeAgentTask(directory,{...snapshot,files},{...selection,purpose:'design',workspace:directory,projectIds:['reader'],source:{previousDesign:'# Unsaved design'}});
  const bundle=JSON.parse(await readFile(file,'utf8'));
  assert.equal(bundle.artifacts['projects/reader/src/main.ts'],'selected product');assert.equal(bundle.artifacts['projects/other/src/main.ts'],undefined);
  assert.equal(bundle.artifacts['spec/REQ-one/login/login.sd.md'],'# Unsaved design');assert.equal(bundle.artifacts['spec/REQ-other/other/other.feature'],undefined);
  assert.equal(bundle.artifacts['tests/_shared/bdd.ts'],undefined);
});
test('task MCP negotiates the installed Codex protocol and returns a supported version for another proposal',()=>{
  const initialize=protocolVersion=>taskRpc({task:{},artifacts:{}},{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion}});
  assert.equal(initialize('2025-06-18').result.protocolVersion,'2025-06-18');
  assert.equal(initialize('2099-01-01').result.protocolVersion,'2025-11-25');
  assert.equal(initialize(undefined).error.code,-32602);
});
test('edited prompt dispatches verbatim, while missing approval and stale previews are rejected',()=>{
  const preview=previewAgentPrompt(snapshot,'SPEC-one','/repo',selection);
  assert.ok(preview.prompt.length<250);assert.match(preview.prompt,/workbench_get_task/);
  const context={root:'/repo',request:{repositoryId:'SPEC-one',input:{...selection,...preview,prompt:'My exact edited prompt\nDo this carefully.'}}};
  assert.equal(approvedAgentPrompt(snapshot,context,'development'),context.request.input.prompt);
  assert.throws(()=>approvedAgentPrompt({...snapshot,revision:2},context,'development'),{code:'PROMPT_CHANGED'});
  assert.throws(()=>approvedAgentPrompt(snapshot,{...context,root:'/moved'},'development'),{code:'PROMPT_CHANGED'});
  assert.throws(()=>approvedAgentPrompt(snapshot,{...context,request:{...context.request,input:{...selection}}},'development'),{code:'PROMPT_REQUIRED'});
  assert.throws(()=>approvedAgentPrompt(snapshot,{...context,request:{...context.request,input:{...context.request.input,prompt:' '}}},'development'),{code:'PROMPT_REQUIRED'});
  assert.throws(()=>agentArguments({args:['exec','{prompt}']},{prompt:'do this'}),{code:'AGENT_MCP_REQUIRED'});
  assert.throws(()=>agentArguments(validateAgentSettings(),{prompt:'do this'}),{code:'AGENT_RUNTIME_MISMATCH'});
});

test('new requirements can preview a minimal Gherkin prompt bound to unsaved composer input',()=>{
  const input={purpose:'gherkin',editorKey:'new-composer',description:'描述需求',previousGherkin:''};
  const preview=previewAgentPrompt(snapshot,'SPEC-one','/repo',input);assert.ok(preview.prompt.length<250);
  const context={root:'/repo',request:{repositoryId:'SPEC-one',input:{...input,...preview}}};assert.equal(approvedAgentPrompt(snapshot,context,'gherkin'),preview.prompt);
  context.request.input.previousGherkin='Changed';assert.throws(()=>approvedAgentPrompt(snapshot,context,'gherkin'),{code:'PROMPT_CHANGED'});
});
test('a real stdio task MCP exposes only frozen selected artifacts and no write operations',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'agent-task-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const file=await writeAgentTask(directory,snapshot,{...selection,workspace:'/isolated',products:['/isolated/product'],feedback:[{message:'fix layout'}],previousFailure:'last failure'});
  const bundle=JSON.parse(await readFile(file,'utf8'));
  const args=agentArguments(validateAgentSettings({runtime:'custom-cli'}),{prompt:'exact prompt',spec:'/isolated',project:'/isolated/product',task:file});
  assert.equal(args.at(-1),'exact prompt');assert.ok(args.some(a=>a.startsWith('mcp_servers.workbench_task=')));
  const queries=[
    {method:'initialize',params:{protocolVersion:'2025-11-25'}},
    {method:'tools/list'},
    {method:'tools/call',params:{name:'workbench_get_task',arguments:{}}},
    {method:'tools/call',params:{name:'workbench_read_artifact',arguments:{path:snapshot.files[0].path}}},
    {method:'tools/call',params:{name:'workbench_read_artifact',arguments:{path:snapshot.files[1].path}}},
    {method:'tools/call',params:{name:'write_file',arguments:{path:'/etc/passwd'}}}
  ].map((query,index)=>({jsonrpc:'2.0',id:index,...query}));
  const result=spawnSync(process.execPath,['scripts/mcp-agent-task.mjs',file],{input:queries.map(q=>JSON.stringify(q)).join('\n')+'\n',encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const responses=result.stdout.trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(responses[0].result.protocolVersion,'2025-11-25');
  assert.ok(responses[1].result.tools.every(tool=>tool.annotations.readOnlyHint));
  assert.equal(responses[2].result.structuredContent.previousFailure,'last failure');
  assert.deepEqual(responses[2].result.structuredContent.artifacts,[snapshot.files[0].path]);
  assert.equal(responses[3].result.structuredContent.content,'Feature: Approved login');
  assert.equal(responses[4].error.code,-32602);assert.equal(responses[5].error.code,-32602);
  assert.equal(taskRpc(bundle,{jsonrpc:'2.0',method:'notifications/initialized'}),null);
});

test('every dispatched purpose reserves all Git commands for workstation lifecycle boundaries',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'agent-git-boundaries-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  for(const purpose of ['gherkin','design','testPlan','development']){
    const source=purpose==='gherkin'?{editorKey:'new-fixture',description:'Requirement',previousGherkin:''}:purpose==='design'?{previousDesign:'# Design'}:undefined;
    const file=await writeAgentTask(path.join(directory,purpose),snapshot,{...selection,purpose,workspace:directory,products:[path.join(directory,'product')],feedback:[],source});
    const {task}=JSON.parse(await readFile(file,'utf8'));assert.match(task.rules,/Do not run any Git commands, including read-only inspection/);assert.match(task.rules,/feature creation and completed human acceptance/);
  }
});
