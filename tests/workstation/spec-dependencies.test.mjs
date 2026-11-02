import {readProgress} from '../../packages/git-core/progress-store.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { readFile, writeFile, mkdir, cp, mkdtemp, symlink, rm } from 'node:fs/promises';
import { fixture,toolkitRoot,git,specRepository,approve } from './helpers.mjs';
import { initialize,createFeature } from '../../packages/spec-toolkit/index.mjs';
import { dependencyDefinition,installedDependencies,materializeDependencies,recordDependencies,reuseForExecution,npmInstallCommand } from '../../packages/spec-toolkit/dependencies.mjs';
import { ensureInstallation } from '../../packages/workstation/flows.mjs';
import { withProgress } from '../../packages/git-core/progress.mjs';
import { identity,writeJson,readJson,exists } from '../../packages/contracts/index.mjs';
import { prepareRun } from '../../packages/spec-toolkit/engine.mjs';

async function npmStarts(home,id) {
  return (readProgress(home,id)?.processes??[]).filter(p=>p.command==='npm').length;
}

test('one Spec Repo installs once across requirements/retries, while consumers and other repos remain isolated',async t=>{
  const f=await fixture(t);await mkdir(f.home,{recursive:true});
  const source=path.join(f.base,'requirement-one'),second=path.join(f.base,'requirement-two');
  await mkdir(source);await initialize(source,{specRepositoryId:'SPEC-tools',toolkitRoot:path.join(toolkitRoot,'packages')});
  await createFeature(source,{requirementId:'REQ-one',featureId:'one',title:'One'});
  const options={home:f.home,enableExecution:true},request={repositoryId:'SPEC-tools',input:{}};
  let consent;
  await assert.rejects(ensureInstallation({root:source,options,request,profiles:[]}),error=>{assert.equal(error.code,'INSTALL_REQUIRED');consent=error.details.install.digest;return true;});
  await withProgress(f.home,'OP-install',()=>ensureInstallation({root:source,options,request:{...request,input:{installConsent:consent}},profiles:[]}));
  assert.equal(await npmStarts(f.home,'OP-install'),1);
  const tools=path.join(f.home,'repositories/SPEC-tools/test-tools'),receipt=await readFile(path.join(tools,'.runtime/dependencies/receipt.json'),'utf8');
  assert.ok(await installedDependencies(tools));
  await cp(source,second,{recursive:true,filter:file=>!['node_modules','.runtime','.generated'].includes(path.basename(file))});
  await createFeature(second,{requirementId:'REQ-two',featureId:'two',title:'Two'});
  const reused=await withProgress(f.home,'OP-reuse',()=>ensureInstallation({root:second,options,request,profiles:[]}));
  assert.deepEqual(reused,{installed:false});assert.equal(await npmStarts(f.home,'OP-reuse'),0);
  assert.equal(await readFile(path.join(tools,'.runtime/dependencies/receipt.json'),'utf8'),receipt);
  const packageFile='node_modules/typescript/package.json',original=await readFile(path.join(tools,packageFile),'utf8');
  await writeFile(path.join(second,packageFile),'consumer modification');
  assert.equal(await readFile(path.join(tools,packageFile),'utf8'),original,'A requirement cannot mutate shared installed packages');
  await assert.rejects(ensureInstallation({root:source,options,request:{repositoryId:'SPEC-other',input:{}},profiles:[]}),{code:'INSTALL_REQUIRED'});
  const pkg=await readJson(path.join(second,'package.json')),lock=await readJson(path.join(second,'package-lock.json'));
  pkg.version='2.0.0';lock.version=pkg.version;lock.packages[''].version=pkg.version;
  await writeJson(path.join(second,'package.json'),pkg);await writeJson(path.join(second,'package-lock.json'),lock);
  let changedConsent;
  await assert.rejects(ensureInstallation({root:second,options,request,profiles:[]}),error=>{assert.equal(error.code,'INSTALL_REQUIRED');changedConsent=error.details.install.digest;return true;});
  assert.equal(await readFile(path.join(tools,'.runtime/dependencies/receipt.json'),'utf8'),receipt,'A changed manifest must not replace the installation before approval');
  await withProgress(f.home,'OP-update',()=>ensureInstallation({root:second,options,request:{...request,input:{installConsent:changedConsent}},profiles:[]}));
  assert.equal(await npmStarts(f.home,'OP-update'),1);
  assert.notEqual((await installedDependencies(tools)).key,JSON.parse(await readFile(path.join(source,'.runtime/node-dependencies.json'),'utf8')).key);
});

test('local package source is part of dependency identity; unrelated requirement text is not',async t=>{
  const f=await fixture(t);await mkdir(f.repo);await writeJson(path.join(f.repo,'package.json'),{dependencies:{local:'file:packages/local'}});
  await writeJson(path.join(f.repo,'packages/local/package.json'),{name:'local',version:'1.0.0'});
  await writeFile(path.join(f.repo,'packages/local/index.js'),'export const value=1;');
  const original=identity(await dependencyDefinition(f.repo));
  await mkdir(path.join(f.repo,'spec'));await writeFile(path.join(f.repo,'spec/requirement.feature'),'Feature: Changed requirement');
  assert.equal(identity(await dependencyDefinition(f.repo)),original);
  await writeFile(path.join(f.repo,'packages/local/index.js'),'export const value=2;');assert.notEqual(identity(await dependencyDefinition(f.repo)),original);
});

test('dependency links stay inside canonical consumer paths and cannot point back to shared or external files',async t=>{
  const f=await fixture(t),destination=await mkdtemp(path.join(os.tmpdir(),'bdd-dependency-copy-'));t.after(()=>rm(destination,{recursive:true,force:true}));
  await mkdir(f.repo);const pkg={name:'link-fixture',private:true};await writeJson(path.join(f.repo,'package.json'),pkg);await writeJson(path.join(destination,'package.json'),pkg);
  await mkdir(path.join(f.repo,'node_modules/.bin'),{recursive:true});await writeFile(path.join(f.repo,'node_modules/cli.js'),'fixture bytes');
  for(const name of ['bddgen','playwright','tsc'])await symlink('../cli.js',path.join(f.repo,'node_modules/.bin',name));
  await recordDependencies(f.repo,npmInstallCommand(false));await materializeDependencies(f.repo,destination);
  assert.equal(await readFile(path.join(destination,'node_modules/.bin/tsc'),'utf8'),'fixture bytes');
  await writeFile(path.join(destination,'node_modules/cli.js'),'consumer bytes');assert.equal(await readFile(path.join(f.repo,'node_modules/cli.js'),'utf8'),'fixture bytes');
  await writeFile(path.join(f.base,'outside.txt'),'external bytes');await symlink(path.join(f.base,'outside.txt'),path.join(f.repo,'node_modules/outside'));
  await rm(path.join(destination,'node_modules'),{recursive:true,force:true});
  await assert.rejects(materializeDependencies(f.repo,destination),{code:'DEPENDENCY_LINK_OUTSIDE_ENVIRONMENT'});
  assert.equal(await installedDependencies(destination),null);
});

test('prepared execution candidate reuses Spec Repo tools but custom install commands still execute normally',async t=>{
  const f=await fixture(t);await mkdir(f.home,{recursive:true});await specRepository(f.repo);await approve(f.repo);
  // Build-artifact fixture: this test verifies isolation and dispatch, not package installation.
  await mkdir(path.join(f.repo,'node_modules/.bin'),{recursive:true});
  for(const name of ['bddgen','playwright','tsc'])await writeFile(path.join(f.repo,'node_modules/.bin',name),`fixture ${name}`);
  const command=npmInstallCommand(true);await recordDependencies(f.repo,command);
  const plan=await prepareRun({root:f.repo,home:f.home,repositoryId:'SPEC-runtime',git,input:{requirementId:'REQ-001',featureId:'login',expected:await git.inspect(f.repo)}});
  const candidate=path.join(f.home,'executions',plan.runId,'repo');
  assert.ok(await reuseForExecution(candidate,command));
  assert.equal(await reuseForExecution(candidate,['node','custom-install.mjs']),null,'Custom preparation is not silently skipped');
  await writeFile(path.join(candidate,'node_modules/.bin/bddgen'),'changed');
  assert.equal(await readFile(path.join(f.repo,'node_modules/.bin/bddgen'),'utf8'),'fixture bddgen');
});
