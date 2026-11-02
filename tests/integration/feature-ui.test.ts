import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {sha256} from '../../src/application/core.ts';
import {createServer} from '../../src/http/server.ts';

test('compatibility API keeps dedicated Gherkin documents and phases independent and adds a sibling',async t=>{
 const root=resolve(process.cwd());await mkdir(join(root,'.test-fixtures'),{recursive:true});
 const directory=await mkdtemp(join(root,'.test-fixtures/feature-ui-'));
 const server=await createServer({root,metadataFile:join(directory,'metadata.sqlite'),dataRoot:join(directory,'data'),baseUrl:'http://127.0.0.1:1'});
 t.after(async()=>{await server.app.close();await rm(directory,{recursive:true,force:true});});
 const address=await server.app.listen({host:'127.0.0.1',port:0});
 const project=await server.core.createProject({name:'Multiple Gherkin UI',workspaceRef:directory});
 const first=await server.core.createRequirement(project.id,{requirementKey:'REQ-UI'});
 const second=await server.core.createFeature(first.id,{featureKey:'checkout'});
 const g=await server.core.saveVersion(first.documents.gherkin.id,{rawText:'Feature: First\n @AC-UI-001\n Scenario: display\n  Given first source\n  Then first result\n'});
 await server.core.confirm(first.id,'gherkin',{featureId:first.featureId,versionId:g.versionId!,rawSha256:g.rawSha256!});
 const selected=await server.app.inject({method:'GET',url:`/requirements/${first.id}?featureId=${first.featureId}`});assert.equal(selected.statusCode,200);assert.equal(selected.json().stage,'SD');assert.equal(selected.json().documents.gherkin.rawText,g.rawText);
 const sibling=await server.app.inject({method:'GET',url:`/requirements/${first.id}?featureId=${second.featureId}`});assert.equal(sibling.statusCode,200);assert.equal(sibling.json().stage,'GHERKIN');assert.equal(sibling.json().documents.gherkin.versionId,null);
 const created=await server.app.inject({method:'POST',url:`/requirements/${first.id}/features`,payload:{featureKey:'refund'}});assert.equal(created.statusCode,201);
 const current=await server.core.getRequirement(first.id,created.json().featureId);assert.equal(current.features.length,3);assert.equal(current.featureKey,'refund');
 const ambiguous=await server.app.inject({method:'GET',url:`/requirements/${first.id}`});assert.equal(ambiguous.statusCode,400);assert.equal(ambiguous.json().code,'FEATURE_REQUIRED');
});

test('compatibility API confirms SD, generates a skeleton, completes a baseline and invalidates downstream state on restart',async t=>{
 const root=resolve(process.cwd()),directory=await mkdtemp(join(root,'.test-fixtures/test-step-flow-'));
 const server=await createServer({root,metadataFile:join(directory,'metadata.sqlite'),dataRoot:join(directory,'data'),baseUrl:'http://127.0.0.1:1'});
 t.after(async()=>{await server.app.close();await rm(directory,{recursive:true,force:true});});
 const address=await server.app.listen({host:'127.0.0.1',port:0}),project=await server.core.createProject({name:'Test step flow',workspaceRef:directory}),requirement=await server.core.createRequirement(project.id,{requirementKey:'REQ-UI-FLOW'});
 const feature='Feature: Save a value\n  @AC-UI-FLOW-001\n  Scenario: Save successfully\n    Given a save page is open\n    When the user saves\n    Then the saved confirmation is shown\n';
 const g=await server.core.saveVersion(requirement.documents.gherkin.id,{rawText:feature});await server.core.confirm(requirement.id,'gherkin',{featureId:requirement.featureId,versionId:g.versionId!,rawSha256:g.rawSha256!});
 const sd=await server.core.saveVersion(requirement.documents.sd.id,{rawText:'# SD\nArchitecture, DDL and DML for the save flow.\n',sourceGherkinVersionId:g.versionId});
 const confirmation=await server.app.inject({method:'POST',url:`/requirements/${requirement.id}/confirm-sd`,payload:{featureId:requirement.featureId,versionId:sd.versionId,rawSha256:sd.rawSha256}});assert.equal(confirmation.statusCode,200);assert.equal(confirmation.json().stage,'TESTS');assert.equal(confirmation.json().documents.spec.testStage,'SKELETON');assert.match(confirmation.json().documents.spec.rawText,/workbenchTestId/);
 const current=await server.core.getRequirement(requirement.id,requirement.featureId),skeleton=current.documents.spec,mapping=skeleton.manifest.mappings[0];
 const completedRaw=`import { test, expect } from '@playwright/test';\ntest('Save successfully', { annotation: [{ type: 'workbenchTestId', description: ${JSON.stringify(mapping.testKey)} }] }, async ({ page }) => {\n  await page.setContent(\`<button data-testid="save" onclick="document.querySelector('#result').textContent='Saved'">Save</button><p id="result">Pending</p>\`);\n  await page.getByTestId('save').click();\n  await expect(page.getByText('Saved')).toBeVisible();\n});\n`;
 const manifest={...skeleton.manifest,artifactStage:'COMPLETED',stage:'COMPLETED',completionStatus:'COMPLETED',productE2E:'NOT_RUN',specSha256:sha256(completedRaw),sourceGherkinVersionId:g.versionId,gherkinSha256:g.rawSha256,sdVersionId:sd.versionId,sdSha256:sd.rawSha256,sourceSkeletonVersionId:skeleton.versionId,sourceSkeletonSha256:skeleton.rawSha256,sourceSkeletonManifestSha256:skeleton.manifestSha256,mappings:[mapping],pendingSlots:[],bundleFiles:[],fileHashes:{}};
 await server.core.saveVersion(skeleton.id,{rawText:completedRaw,baseVersionId:skeleton.versionId,sourceGherkinVersionId:g.versionId,sourceSkeletonVersionId:skeleton.versionId,testStage:'COMPLETED',manifest});
 const development=await server.app.inject({method:'POST',url:`/requirements/${requirement.id}/start-development`,payload:{featureId:requirement.featureId}});assert.equal(development.statusCode,200);
 const developed=await server.core.getRequirement(requirement.id,requirement.featureId);assert.equal(developed.stage,'IMPLEMENTATION');assert.ok(developed.baseline?.id);
 const restart=await server.app.inject({method:'POST',url:`/requirements/${requirement.id}/restart-stage`,payload:{featureId:requirement.featureId,stage:'SD'}});assert.equal(restart.statusCode,200);
 const restarted=await server.app.inject({method:'GET',url:`/requirements/${requirement.id}?featureId=${requirement.featureId}`}),restartedData=restarted.json();
 assert.equal(restarted.statusCode,200);assert.equal(restartedData.stage,'SD');assert.ok(restartedData.confirmations.gherkin);assert.equal(restartedData.confirmations.sd,undefined);assert.equal(restartedData.baseline,null);
 assert.equal(restartedData.documents.sd.versionId,developed.documents.sd.versionId);
 assert.deepEqual((await server.core.store.all('SELECT valid FROM baselines WHERE feature_id=?',[requirement.featureId])).map(row=>row.valid),[0]);

});
