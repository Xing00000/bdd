import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp,rm,mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname,join,parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from '../src/http/server.js';

function repositoryRoot(){let candidate=dirname(fileURLToPath(import.meta.url));while(candidate!==parse(candidate).root){if(existsSync(join(candidate,'spec/REQ-WB-001/SD.md'))&&existsSync(join(candidate,'product/package.json')))return candidate;candidate=dirname(candidate);}throw Error('Cannot locate the dedicated workbench repository');}
const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
const feature='Feature: HTTP integration persistence\n  @AC-HTTP-001\n  Scenario: Save approved source\n    Given a source document\n    When the document is stored\n    Then its exact bytes are preserved\n';

test('real HTTP adapters persist documents, enforce version-bound workflow, execute SQLite and preserve independent scripts',async()=>{
  const root=repositoryRoot();await mkdir(join(root,'.test-fixtures'),{recursive:true});
  const temporary=await mkdtemp(join(root,'.test-fixtures/http-integration-'));
  const metadataFile=join(temporary,'metadata.e2e.sqlite'),targetFile=join(temporary,'target.e2e.sqlite');
  const db=new DatabaseSync(targetFile);db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, content TEXT NOT NULL)');db.close();
  let server:Awaited<ReturnType<typeof createServer>>|undefined;
  const start=()=>createServer({root,metadataFile,dataRoot:join(temporary,'data'),baseUrl:'http://127.0.0.1:1',logger:false});
  try{
    server=await start();
    const request=async(method:'GET'|'POST',url:string,payload?:unknown,status=200)=>{const response=await server!.app.inject({method,url,payload:payload as any});assert.equal(response.statusCode,status,`${method} ${url}: ${response.body}`);return response.json();};
    const project=await request('POST','/projects',{name:'HTTP persistence test',workspaceRef:temporary},201);
    let current=await request('POST',`/projects/${project.id}/requirements`,{requirementKey:'REQ-HTTP-001'},201);
    const requirementId=current.id,gherkinId=current.documents.gherkin.id,sdId=current.documents.sd.id,specId=current.documents.spec.id;
    const rejected=await request('POST',`/documents/${gherkinId}/versions`,{rawText:'This is not a Feature'},422);
    assert.equal(rejected.code,'SYNTAX_INVALID');assert.ok(rejected.diagnostics.length>0);
    assert.equal((await request('GET',`/requirements/${requirementId}`)).documents.gherkin.versionId,null);
    const saved=await request('POST',`/documents/${gherkinId}/versions`,{rawText:feature},201);
    assert.equal(saved.rawSha256,sha(feature));
    const exact=await request('GET',`/documents/${gherkinId}/versions/${saved.versionId}`);assert.equal(exact.rawText,feature);
    const mismatch=await request('POST',`/requirements/${requirementId}/confirm-gherkin`,{versionId:saved.versionId,rawSha256:'0'.repeat(64)},409);
    assert.equal(mismatch.code,'CONFIRMATION_VERSION_MISMATCH');
    current=await request('POST',`/requirements/${requirementId}/confirm-gherkin`,{versionId:saved.versionId,rawSha256:saved.rawSha256});assert.equal(current.stage,'SD');
    const locked=await request('POST',`/documents/${gherkinId}/versions`,{rawText:feature+'\n'},409);assert.equal(locked.code,'ARTIFACT_LOCKED_IN_STAGE');
    assert.equal((await request('GET',`/requirements/${requirementId}`)).documents.gherkin.versionId,saved.versionId);
    const llm=await request('POST',`/requirements/${requirementId}/generate-sd`,{},503);assert.equal(llm.code,'LLM_UNCONFIGURED');
    assert.equal((await request('GET',`/requirements/${requirementId}`)).documents.sd.versionId,null);
    const sdText='# SD\n架構：HTTP / application / SQLite worker。\nDDL: CREATE TABLE notes。\nDML: INSERT / SELECT。\n';
    const sd=await request('POST',`/documents/${sdId}/versions`,{rawText:sdText,sourceGherkinVersionId:saved.versionId},201);
    current=await request('POST',`/requirements/${requirementId}/confirm-sd`,{versionId:sd.versionId,rawSha256:sd.rawSha256});assert.equal(current.stage,'TESTS');
    const invalidSpec=await request('POST',`/documents/${specId}/versions`,{rawText:'test(',sourceGherkinVersionId:saved.versionId,testStage:'SKELETON',manifest:{specSha256:sha('test('),mappings:[]}},422);
    assert.equal(invalidSpec.code,'SYNTAX_INVALID');assert.ok(invalidSpec.diagnostics.every((d:any)=>d.line>0&&d.column>0));
    const connection=await request('POST',`/projects/${project.id}/db-connections`,{sqliteFileRef:targetFile,environmentLabel:'isolated-test'},201);
    const schema=await request('GET',`/db-connections/${connection.id}/schema`);assert.match(JSON.stringify(schema),/notes/);
    await request('POST',`/db-connections/${connection.id}/query`,{sql:'INSERT INTO notes(content) VALUES (?)',params:['persisted by HTTP']});
    const queried=await request('POST',`/db-connections/${connection.id}/query`,{sql:'SELECT content FROM notes WHERE id = ?',params:[1]});
    assert.deepEqual(queried.columns,['content']);assert.deepEqual(queried.rows,[{content:'persisted by HTTP'}]);
    const inspect=new DatabaseSync(targetFile,{readOnly:true});assert.equal((inspect.prepare('SELECT content FROM notes').get() as any).content,'persisted by HTTP');inspect.close();
    const rawText="import { test, expect } from '@playwright/test';\ntest('saved independent script', async ({ page }) => { await page.goto('https://example.invalid'); await expect(page).toHaveTitle('Expected title'); });\n";
    const script=await request('POST','/recordings',{projectId:project.id,requirementId:null,rawText,actions:[],sourceCases:[]},201);
    const scriptHead=await request('GET',`/recordings/${script.id}`);assert.equal(scriptHead.rawText,rawText);assert.equal(scriptHead.rawSha256,sha(rawText));assert.equal(scriptHead.purpose,'recording');assert.equal(scriptHead.requirementId,null);
    assert.deepEqual(await server.core.store.all('SELECT id FROM runs'),[],'Saving a script must not create a passing run');
    assert.deepEqual(await server.core.store.all('SELECT * FROM git_snapshots'),[],'DB script save must not silently publish to target Git');
    await server.app.close();server=await start();
    const restored=await request('GET',`/requirements/${requirementId}`);assert.equal(restored.stage,'TESTS');assert.equal(restored.documents.gherkin.rawText,feature);assert.equal(restored.documents.sd.rawText,sdText);
    assert.equal((await request('GET',`/recordings/${script.id}`)).versionId,script.versionId);
  }finally{await server?.app.close();await rm(temporary,{recursive:true,force:true});}
});
