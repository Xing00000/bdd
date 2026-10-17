import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createWorkspaceAdapter } from '../../src/adapters/workspace.js';
const git=(repo:string,...args:string[])=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
function init(repo:string){git(repo,'init','-b','main');git(repo,'config','user.name','Fixture');git(repo,'config','user.email','fixture@localhost');}

test('source pin resolves the project Git root and requires edited source bytes in that commit',async t=>{
  const root=await mkdtemp(join(tmpdir(),'wb-source-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const repo=join(root,'target');await mkdir(repo);init(repo);await writeFile(join(repo,'app.ts'),'export const app=1;\n');git(repo,'add','.');git(repo,'commit','-m','target');const commit=git(repo,'rev-parse','HEAD');
  const adapter=createWorkspaceAdapter(root,join(root,'data'));
  assert.equal((await adapter.resolveSource(commit,repo,'project-1')).resolvedCommit,commit);
  await assert.rejects(adapter.resolveSource('missing-ref',repo,'project-1'),{code:'INVALID_SOURCE_REF'});
  await adapter.saveSource('project-1','export const edited=1;\n');
  await assert.rejects(adapter.resolveSource(commit,repo,'project-1'),{code:'INVALID_SOURCE_REF'},'an unrelated parent/project commit cannot pin edited stage source');
  const stage=await adapter.stageDirectory('project-1','IMPLEMENTATION');init(stage);git(stage,'add','.');git(stage,'commit','-m','edited source');const editedCommit=git(stage,'rev-parse','HEAD');
  const pinned=await adapter.resolveSource(editedCommit,repo,'project-1');assert.equal(pinned.repositoryRef,stage);assert.match(pinned.sourceSha256!,/^[a-f0-9]{64}$/);
  await adapter.saveSource('project-1','export const edited=2;\n');
  await assert.rejects(adapter.resolveSource(editedCommit,repo,'project-1'),{code:'SOURCE_NOT_IN_COMMIT'});
});
