import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {expect} from '@playwright/test';
import {createServer} from '../src/http/server.ts';
import {Workbench} from '../tests/completion/support/workbench.ts';
import {FixtureDatabase,sha} from '../tests/completion/support/database.ts';
import {sourceFeature,specText} from '../tests/completion/fixtures/content.ts';

const root=resolve(process.cwd()),targetUrl='http://fixture.invalid';
type Fixture=Awaited<ReturnType<typeof fixture>>;

async function fixture(t:{after:(body:()=>Promise<void>)=>void}){
  await mkdir(join(root,'.test-fixtures'),{recursive:true});
  const directory=await mkdtemp(join(root,'.test-fixtures/approved-fixture-fix-'));
  const server=await createServer({root,metadataFile:join(directory,'metadata.e2e.sqlite'),dataRoot:join(directory,'artifacts'),baseUrl:'http://127.0.0.1:1'});
  const db=new FixtureDatabase(join(directory,'metadata.e2e.sqlite'),targetUrl,join(directory,'target.sqlite'));
  const responses:{status:number;body:any}[]=[];
  // Explicit page/step transport doubles avoid a browser dependency. The actual
  // Workbench helper submits to the real Fastify routes and SQLite adapter.
  const context={},page={context:()=>context,reload:async()=>{},request:{post:async(url:string,options:{data:unknown})=>{
    const result=await server.app.inject({method:'POST',url,payload:options.data as any});responses.push({status:result.statusCode,body:result.json()});
    return {status:()=>result.statusCode,text:async()=>result.body};
  }}};
  const sut=Reflect.construct(Workbench,[page,context,{annotations:[],attach:async()=>{}},db,targetUrl]) as Workbench;
  Object.defineProperty(sut,'page',{value:page});
  sut.check=expect;
  sut.step=async(_line:number,_keyword:string,body:()=>Promise<void>)=>body();
  t.after(async()=>{db.close();await server.app.close();await rm(directory,{recursive:true,force:true});});
  return {sut,db,server,responses};
}

async function approvedSaveStep(){
  const path='tests/completion/steps/workbench.steps.ts',text=await readFile(join(root,path),'utf8'),ast=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true);
  const declaration=ast.statements.find(statement=>{
    if(!ts.isExpressionStatement(statement)||!ts.isCallExpression(statement.expression))return false;
    const callback=statement.expression.arguments[1];if(!callback||!ts.isArrowFunction(callback))return false;
    let found=false;const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.expression.getText(ast)==='sut'&&node.expression.name.text==='step'&&node.arguments[0]?.getText(ast)==='203')found=true;ts.forEachChild(node,visit);};visit(callback);return found;
  });
  assert.ok(declaration&&ts.isExpressionStatement(declaration)&&ts.isCallExpression(declaration.expression));
  const callback=declaration.expression.arguments[1];assert.ok(ts.isArrowFunction(callback));
  // Execute the exact approved AC021 callback, rather than duplicate its save
  // options in this regression. No step registration or generated E2E executes.
  const script=ts.transpileModule('export default '+callback.getText(ast),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2023}}).outputText;
  const sandbox={exports:{} as {default?:(args:{sut:Workbench},phase:string)=>Promise<void>},phases:{}};runInNewContext(script,sandbox);
  assert.equal(typeof sandbox.exports.default,'function');return sandbox.exports.default!;
}

const specHead=(f:Fixture)=>f.db.all('SELECT version_id FROM document_heads WHERE document_id=?',[f.db.vars.specDoc])[0].version_id;

test('approved AC021 save callback preserves the immutable skeleton three-test set and mappings through real HTTP/SQLite',async t=>{
  const f=await fixture(t),step=await approvedSaveStep();f.sut.vars.artifact='spec.ts';
  const skeleton=f.db.all('SELECT raw_text,raw_sha256 FROM document_versions WHERE id=?',[f.db.vars.specSkeletonVersion])[0];
  const oldHead=specHead(f);await step({sut:f.sut},'spec.ts');
  const version=String(specHead(f));assert.notEqual(version,oldHead);assert.equal(f.responses.at(-1)!.status,201);
  const saved=f.db.all('SELECT * FROM document_versions WHERE id=?',[version])[0];assert.equal(saved.raw_text,specText(targetUrl,true));assert.equal(saved.raw_sha256,sha(String(saved.raw_text)));assert.equal(saved.source_skeleton_version_id,f.db.vars.specSkeletonVersion);
  const mappings=f.db.all('SELECT t.test_key,c.case_key,s.scenario_key FROM test_definitions t JOIN test_case_mappings m ON m.test_definition_id=t.id JOIN source_cases c ON c.id=m.source_case_id JOIN scenarios s ON s.id=c.scenario_id WHERE t.spec_version_id=? ORDER BY t.test_key',[version]).map(row=>({...row}));
  assert.deepEqual(mappings,[{test_key:'test-a',case_key:'a',scenario_key:'AC-DEMO-001'},{test_key:'test-a-extra',case_key:'a',scenario_key:'AC-DEMO-001'},{test_key:'test-b',case_key:'b',scenario_key:'AC-DEMO-001'}]);
  assert.deepEqual(f.db.all('SELECT raw_text,raw_sha256 FROM document_versions WHERE id=?',[f.db.vars.specSkeletonVersion])[0],skeleton);
});

test('fixture correction retains rejection of deleted tests, all six invalid mappings and malformed spec without advancing the valid head',async t=>{
  const f=await fixture(t);f.db.stage('TESTS');await f.sut.save({kind:'spec.ts',extra:true});const head=specHead(f),snapshot=f.db.snapshot();
  await assert.rejects(f.sut.save({kind:'spec.ts'}),/MAPPING_INVALID/);assert.equal(f.responses.at(-1)!.status,422);assert.equal(specHead(f),head);
  for(const problem of ['有測試未提供明確的情境與案例對應','來源Gherkin有應生成的案例未對應任何測試','不同測試定義使用相同test ID','完全相同test ID與來源案例的映射資料重複','引用指定來源版本中不存在的Scenario ID','引用指定來源情境中不存在的Examples case_id']){
    await f.sut.save({kind:'spec.ts',extra:true,problem});assert.equal(f.responses.at(-1)!.status,422,problem);assert.equal(f.responses.at(-1)!.body.code,'MAPPING_INVALID',problem);assert.equal(f.db.snapshot(),snapshot,problem);
  }
  await f.sut.save({kind:'spec.ts',extra:true,invalid:true});assert.equal(f.responses.at(-1)!.status,422);assert.equal(f.responses.at(-1)!.body.code,'SYNTAX_INVALID');assert.equal(f.db.snapshot(),snapshot);
});

test('AC021/AC024 Gherkin alias is initialized and resynchronized after successful save while invalid input preserves the valid state',async t=>{
  const f=await fixture(t),step=await approvedSaveStep();assert.equal(f.sut.vars.gherkin,sourceFeature);assert.equal(f.sut.vars.feature,sourceFeature);
  // A stale alias makes the save assignment observable even when fixture raw
  // source bytes are unchanged. It is never written to the product database.
  f.sut.vars.gherkin='stale alias';f.sut.vars.feature='stale feature';f.sut.vars.artifact='Gherkin';await step({sut:f.sut},'Gherkin');
  assert.equal(f.sut.vars.gherkin,sourceFeature);assert.equal(f.sut.vars.feature,sourceFeature);
  const row=f.db.all('SELECT v.raw_text,v.raw_sha256,v.id FROM document_heads h JOIN document_versions v ON v.id=h.version_id WHERE h.document_id=?',[f.db.vars.gherkinDoc])[0];assert.equal(row.raw_text,f.sut.vars.gherkin);assert.equal(row.raw_sha256,sha(sourceFeature));
  const snapshot=f.db.snapshot();await f.sut.save({kind:'Gherkin',invalid:true});assert.equal(f.responses.at(-1)!.status,422);assert.equal(f.responses.at(-1)!.body.code,'SYNTAX_INVALID');assert.equal(f.db.snapshot(),snapshot);assert.equal(f.sut.vars.gherkin,sourceFeature);assert.equal(f.sut.vars.feature,sourceFeature);
});
