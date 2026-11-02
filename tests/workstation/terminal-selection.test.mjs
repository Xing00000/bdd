import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('same terminal is unhidden and SQLite-only review preserves the real CLI', async () => {
  const source=await readFile(new URL('../../packages/workstation/public/app.js',import.meta.url),'utf8');
  const fragment=source.slice(source.indexOf('const activeOperation ='),source.indexOf('\nasync function executeJob'));
  const nodes=new Map();
  const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:true,dataset:{},textContent:'',append(){}});return nodes.get(id);};
  const state={repositoryId:'repo',view:'versions',stage:'GHERKIN',epoch:1};
  const sandbox={interactionLog:{attach(){return true;}},state,feature:()=>null,$:node,document:{createTextNode:x=>x},clearTimeout,setTimeout,api:async url=>({hasProgress:url.includes('OP-cli'),output:'',nextOffset:0,status:'SUCCEEDED'})};
  vm.runInNewContext(fragment+'\nglobalThis.showOperation=showOperation;globalThis.selectOperation=selectOperation;',sandbox);
  const cli={id:'OP-cli',status:'SUCCEEDED',interactionType:'VERSIONS',request:{repositoryId:'repo',operation:'repository.acquire'}};
  sandbox.showOperation(cli);
  node('#operation-terminal-details').hidden=true;
  sandbox.showOperation(cli);
  assert.equal(node('#operation-terminal-details').hidden,false);
  assert.equal(node('#operation-terminal-details').dataset.operationId,'OP-cli');
  await sandbox.selectOperation({operations:[{id:'OP-sql',status:'SUCCEEDED',request:{repositoryId:'repo',operation:'workflow.review'}},cli]},1);
  assert.equal(node('#operation-terminal-details').dataset.operationId,'OP-cli');
  assert.equal(node('#operation-terminal-details').hidden,false);
});
