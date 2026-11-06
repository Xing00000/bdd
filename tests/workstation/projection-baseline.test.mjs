import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fixture, git, toolkitRoot, repository } from './helpers.mjs';
import { openStore } from '../../packages/workstation/store.mjs';
import { editDraft } from '../../packages/workstation/authoring.mjs';
import { acquireRepository } from '../../packages/workstation/catalog.mjs';
import { checkpointProjection } from '../../packages/workstation/projection.mjs';
import { digest } from '../../packages/contracts/index.mjs';

async function prepared(t) {
  const f=await fixture(t);await mkdir(f.home);
  await git.command(undefined,['init','--bare','--initial-branch','main',f.remote]);
  const product=path.join(f.base,'product');await repository(product,{'README.md':'A product\n'});
  const store=openStore(f.home);t.after(()=>store.close());
  const repositoryId='SPEC-race';store.register({id:repositoryId,title:'New binding',remoteUrl:f.remote});
  const root=path.join(f.home,'repositories',repositoryId,'repo');
  const context={root,store,git,options:{home:f.home,toolkitRoot,allowLocal:true},request:{schemaVersion:1,operationId:'OP-settings',repositoryId,operation:'repository.setup',input:{reviewer:'Human',projects:[{id:'product',url:product}]}}};
  // Deterministic ordering of the UI race: SQL settings are saved before the
  // asynchronous clone imports its unconfigured template. No network or timing mocks.
  await editDraft(context);
  const saved=store.draft(repositoryId).files.find(x=>x.path==='workbench.yaml').content;
  await acquireRepository({...context,request:{...context.request,operationId:'OP-acquire',operation:'repository.acquire',input:{}}});
  return {...context,saved,repositoryId};
}

test('new binding retains saved SQL settings and records the checkout base before a creation checkpoint',async t=>{
  const c=await prepared(t),disk=await readFile(path.join(c.root,'workbench.yaml'),'utf8');
  const current=c.store.draft(c.repositoryId).files.find(x=>x.path==='workbench.yaml');
  assert.equal(current.content,c.saved,'Import must not discard already saved product settings');
  assert.equal(current.baseHash,digest(disk),'The unconfigured checkout is the export baseline, not an external conflict');
  const before=await git.inspect(c.root);
  await checkpointProjection({...c,request:{...c.request,operationId:'OP-create',operation:'workflow.create',input:{}}});
  assert.equal(await readFile(path.join(c.root,'workbench.yaml'),'utf8'),c.saved);
  assert.equal((await git.modules(c.root))[0].id,'product');
  assert.notEqual((await git.inspect(c.root)).head,before.head);
  assert.equal((await git.command(undefined,['--git-dir',c.store.repository(c.repositoryId).remoteUrl,'show-ref'],{allowFailure:true})).exitCode,1,'Creation checkpoints locally without uploading');
});

test('recording the initial export base still rejects a later external configuration edit',async t=>{
  const c=await prepared(t),file=path.join(c.root,'workbench.yaml');
  const external=JSON.parse(await readFile(file,'utf8'));external.execution.timeoutMs=220000;
  const externalText=JSON.stringify(external,null,2)+'\n';await writeFile(file,externalText);
  await assert.rejects(checkpointProjection({...c,request:{...c.request,operationId:'OP-create',operation:'workflow.create',input:{}}}),{code:'EXPORT_CONFLICT'});
  assert.equal(await readFile(file,'utf8'),externalText);
  assert.equal(c.store.draft(c.repositoryId).files.find(x=>x.path==='workbench.yaml').content,c.saved);
});
