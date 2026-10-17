import { expect as rawExpect, chromium, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve, dirname, relative } from 'node:path';
import ts from 'typescript';
import { StepEvidence } from './evidence.ts';
import { SelectionProbe } from './selection.ts';
import { resolveManagedPage, type Attachment } from './managed.ts';
import type { SQLInputValue } from 'node:sqlite';
import { FixtureDatabase, sha } from './database.ts';
import { sourceFeature, sourceSd, specText, malformedFeature, malformedSpec, fixtureSql, failingSpecText } from '../fixtures/content.ts';
const phases:Record<string,string>={'Gherkin確認':'GHERKIN','SD確認':'SD','test generation/completion':'TESTS',implementation:'IMPLEMENTATION','verification/report':'VERIFICATION'};
export class Workbench {
  db:FixtureDatabase;
  tracker:StepEvidence;
  check:typeof rawExpect;
  vars:Record<string,unknown>;
  records:object[]=[];
  last:unknown;
  before='';
  sourcesBefore='';
  repoBefore='';
  remote?:Browser;
  target?:Page;
  other?:BrowserContext;
  targetUrl:string;
  frameBefore='';
  draft='';
  actionIndex=0;
  secondary:FixtureDatabase[]=[];
  selection?:SelectionProbe;
  llmFull?:{db:FixtureDatabase;source:string;version:string};
  llmMissing?:{db:FixtureDatabase;source:string;result:Record<string,unknown>};
  currentSourceLine=0;
  private constructor(readonly page:Page,readonly context:BrowserContext,readonly info:TestInfo,db:FixtureDatabase,targetUrl:string){
    this.db=db; this.targetUrl=targetUrl;this.tracker=new StepEvidence(page,info);this.page=this.tracker.wrapPage(page);this.check=this.tracker.wrapExpect(rawExpect);this.vars={...db.vars,targetUrl,feature:sourceFeature,gherkin:sourceFeature,sd:sourceSd,spec:specText(targetUrl),recording:specText(targetUrl),targetDb:process.env.WB_TARGET_DB,sourceRef:process.env.WB_SOURCE_REF};
  }
  static async open(page:Page,context:BrowserContext,info:TestInfo){
    for(const key of ['WB_BASE_URL','WB_TARGET_BASE_URL','WB_METADATA_DB','WB_TARGET_DB'])if(!process.env[key])throw new Error(`E2E prerequisite missing: ${key}; no product result is simulated.`);
    const expected={'spec/REQ-WB-001/workbench.feature':'88a51d341375ca58750df37cae184a81662469d9047354fd23b75a3006bbad66','spec/REQ-WB-001/SD.md':'a0bd73923884da67c0c71be2aaf945319fcb1a5bb380b7c704460989d3b565b4'};
    for(const [file,hash] of Object.entries(expected))rawExpect(sha(readFileSync(file)),`approved ${file}`).toBe(hash);
    const db=new FixtureDatabase(process.env.WB_METADATA_DB!,process.env.WB_TARGET_BASE_URL!,process.env.WB_TARGET_DB!);
    return new Workbench(page,context,info,db,process.env.WB_TARGET_BASE_URL!);
  }
  // Evidence wrapper only: callback contains the actual TypeScript step implementation.
  async step(line:number,keyword:string,body:()=>Promise<void>){
    this.tracker.setStep(line,keyword);let error:unknown;
    try{await body();await this.tracker.flush();}catch(e){error=e;throw e;}finally{
      const row=await this.tracker.operation('gherkin-step',error,undefined,this.last,keyword==='Then');this.records.push(row);
    }
  }
  async requestVerification(){
{
        const sourceRef=this.vars.sourceRef;if(!sourceRef)throw Error('WB_SOURCE_REF required; no fictitious source revision');
        const baselines=this.db.all("SELECT id FROM baselines WHERE requirement_id=? AND kind='tests' AND valid=1",[String(this.vars.requirement)]);this.check(baselines).toHaveLength(1);this.vars.baseline=baselines[0].id;
        await this.request(`/requirements/${this.vars.requirement}/verify`,{testBaselineId:this.vars.baseline,sourceRef,selection:{mode:'ALL_REQUIRED',sourceCaseIds:[]}},[200,201,202]);
      }
  }
  async request(path:string,body:unknown,status:number|number[]=200){
    const r=await this.page.request.post(path,{data:body});
    const text=await r.text();
    this.check(Array.isArray(status)?status:[status],`${path}: ${text}`).toContain(r.status());
    this.last=JSON.parse(text); this.vars.response=this.last;
    const result=this.last as Record<string,unknown>;
    if(result.runId)this.vars.run=result.runId;else if(/\/(verify|replay)$/.test(path)&&result.id)this.vars.run=result.id;
    return result;
  }
  head(kind:string){
    const row=this.db.all('SELECT v.* FROM document_heads h JOIN document_versions v ON v.id=h.version_id WHERE h.document_id=?',[String(this.vars[kind+'Doc'])])[0];this.check(row,`head ${kind}`).toBeDefined();return row;
  }
  sourceSnapshot(){return JSON.stringify(['gherkin','sd'].map(k=>this.head(k)));}
  checkSyntax(raw:string){
    const name='candidate.spec.ts';const file=ts.createSourceFile(name,raw,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
    const host=ts.createCompilerHost({noEmit:true,noResolve:true});host.getSourceFile=(n)=>n===name?file:undefined;host.fileExists=n=>n===name;host.readFile=n=>n===name?raw:undefined;host.writeFile=()=>{throw Error('No emit permitted');};
    const program=ts.createProgram([name],{noEmit:true,noResolve:true},host);this.check(program.getSyntacticDiagnostics(file)).toHaveLength(0);
  }
  assertDiagnostics(code:string){
    const body=this.last as {code?:string;diagnostics:{code?:string;file?:string;line:number;column:number;reason:string}[];file?:string};
    this.check(body.diagnostics.length).toBeGreaterThan(0);this.check(body.code??body.diagnostics[0].code).toBe(code);
    for(const d of body.diagnostics){if(code==='SYNTAX_INVALID'){this.check(typeof(d.file??body.file)).toBe('string');this.check(d.line).toBeGreaterThan(0);this.check(d.column).toBeGreaterThan(0);}this.check(d.reason.length).toBeGreaterThan(0);}
  }
  async advance(){
    const order=['GHERKIN','SD','TESTS','IMPLEMENTATION','VERIFICATION'];
    for(let i=0;i<4;i++){
      const stage=String(this.db.all('SELECT stage FROM requirements WHERE id=?',[String(this.vars.requirement)])[0].stage);
      if(stage==='VERIFICATION'||stage==='VERIFIED')return;
      if(stage==='GHERKIN')await this.page.getByTestId('confirm-gherkin').click();
      else if(stage==='SD')await this.page.getByTestId('confirm-sd').click();
      else if(stage==='TESTS'){await this.page.getByTestId('step-definitions-upload').setInputFiles('tests/completion/fixtures/target.steps.ts');await this.page.getByTestId('generate-tests').click();await this.page.getByTestId('complete-tests').click();await this.check(this.page.getByTestId('test-readiness')).toHaveText('COMPLETED',{timeout:60_000});await this.page.getByTestId('start-development').click();}
      else if(stage==='IMPLEMENTATION')await this.requestVerification();
      else throw Error('Unknown workflow stage '+stage);
      await this.check.poll(()=>this.db.all('SELECT stage FROM requirements WHERE id=?',[String(this.vars.requirement)])[0].stage).toBe(order[order.indexOf(stage)+1]);
    }
    this.check(this.db.all('SELECT stage FROM requirements WHERE id=?',[String(this.vars.requirement)])[0].stage).toBe('VERIFICATION');
  }
  async failureBaseline(){
    // This target fixture intentionally asserts A while the real account is B; the outer scenario verifies its failed report.
    const raw=failingSpecText(this.targetUrl);this.checkSyntax(raw);
    this.db.replaceFixtureSpec(raw);this.vars={...this.vars,...this.db.vars};this.db.baseline();
  }
  documentSource(db:FixtureDatabase){return JSON.stringify(['gherkin','sd'].map(k=>db.all('SELECT v.* FROM document_heads h JOIN document_versions v ON v.id=h.version_id WHERE h.document_id=?',[db.vars[k+'Doc']])[0]));}
  async saveRecording(unassociated:boolean){
    const raw=String(this.vars.recording);this.checkSyntax(raw);
    const result=await this.request('/recordings',{projectId:this.vars.project,requirementId:unassociated?null:this.vars.requirement,rawText:raw,actions:this.vars.recordingActions??[],sourceCases:unassociated?[]:[{gherkinVersionId:this.vars.gherkinVersion,scenarioId:'AC-DEMO-001',caseId:'a'}]},[200,201]);
    this.check(typeof result.id).toBe('string');this.check(typeof result.versionId).toBe('string');this.vars.recordingDoc=result.id;this.vars.recordingSavedVersion=result.versionId;
    await this.page.goto(`/projects/${this.vars.project}/recordings/${result.id}`);
  }
  async save(p:{kind?:unknown;extra?:unknown;invalid?:unknown;problem?:unknown;unassociated?:unknown}){
    let kind=String(p.kind??'gherkin'); if(kind==='Gherkin')kind='gherkin';if(kind==='SD')kind='sd';if(kind==='spec.ts')kind='spec';
    const isRecording=kind==='recording';
    let raw=kind==='gherkin'?sourceFeature:kind==='sd'?sourceSd:isRecording?String(this.vars.recording):specText(this.targetUrl,Boolean(p.extra));
    if(p.invalid)raw=kind==='gherkin'?malformedFeature:malformedSpec;
    const mappings=[{testKey:'test-a',scenarioId:'AC-DEMO-001',caseId:'a'},{testKey:'test-b',scenarioId:'AC-DEMO-001',caseId:'b'},...(p.extra?[{testKey:'test-a-extra',scenarioId:'AC-DEMO-001',caseId:'a'}]:[])];
    const problem=String(p.problem??'');
    if(problem.includes('有測試未提供'))mappings.splice(0,1);
    if(problem.includes('未對應任何測試')){raw=specText(this.targetUrl).split("test('test-b'")[0];mappings.splice(1,1);}
    if(problem.includes('不同測試定義'))raw=raw.replaceAll('test-b','test-a');
    if(problem.includes('映射資料重複'))mappings.push({...mappings[0]});
    if(problem.includes('不存在的Scenario'))mappings[0].scenarioId='AC-MISSING-999';
    if(problem.includes('不存在的Examples'))mappings[0].caseId='missing';
    this.vars.savedSpec=raw;
    const doc=this.vars[isRecording?'recordingDoc':kind+'Doc'];
    const result=await this.request(`/documents/${doc}/versions`,{
      rawText:raw,sourceGherkinVersionId:kind==='gherkin'||p.unassociated?null:this.vars.gherkinVersion,
      testStage:kind==='spec'?'COMPLETED':undefined,sourceSkeletonVersionId:kind==='spec'?this.vars.specSkeletonVersion:undefined,
      manifest:kind==='spec'||(isRecording&&!p.unassociated)?{sourceGherkinVersionId:this.vars.gherkinVersion,sourceSkeletonVersionId:kind==='spec'?this.vars.specSkeletonVersion:undefined,sourceSkeletonSha256:kind==='spec'?this.db.all('SELECT raw_sha256 FROM document_versions WHERE id=?',[String(this.vars.specSkeletonVersion)])[0].raw_sha256:undefined,specSha256:sha(raw),mappings}:undefined,
    },p.invalid||p.problem?422:[200,201]);
    if(!(p.invalid||p.problem)){
      this.check(typeof result.versionId).toBe('string');this.vars[kind+'SavedVersion']=result.versionId;
      if(kind==='gherkin'){this.vars.feature=raw;this.vars.gherkin=raw;}
    }
  }
  async discoverProductBundle(raw:string){
    const version=String(this.head('spec').id),response=await this.page.request.get(`/requirements/${this.vars.requirement}/generated-tests/export?versionId=${encodeURIComponent(version)}`);this.check(response.ok()).toBe(true);
    const bundle=await response.json() as {specPath:string;files:{path:string;rawText:string}[]};this.check(bundle.files.length).toBeGreaterThan(0);
    const root=resolve('.test-fixtures','export-'+String(this.vars.project));mkdirSync(root,{recursive:true});
    for(const file of bundle.files){const destination=resolve(root,file.path),rel=relative(root,destination);if(rel.startsWith('..')||!rel)throw Error('Export fixture path escapes its directory');mkdirSync(dirname(destination),{recursive:true});writeFileSync(destination,file.rawText);}
    this.check(readFileSync(resolve(root,bundle.specPath),'utf8')).toBe(raw);
    const config=resolve(root,'fixture.config.ts');writeFileSync(config,"export default {testDir:'.',testMatch:'**/*.spec.ts',reporter:'json',forbidOnly:true};\n");
    const r=spawnSync(process.execPath,['node_modules/@playwright/test/cli.js','test','--config',config,'--list','--reporter=json'],{encoding:'utf8'});
    await this.info.attach('product-codegen-discovery',{body:r.stdout+r.stderr,contentType:'text/plain'});this.check(r.status).toBe(0);
    const report=JSON.parse(r.stdout),tests:unknown[]=[];const visit=(suite:any)=>{for(const spec of suite.specs??[])tests.push(...spec.tests);for(const child of suite.suites??[])visit(child);};for(const suite of report.suites??[])visit(suite);
    this.check(tests.length).toBeGreaterThanOrEqual(2);this.vars.productDiscoveredTests=tests.length;
  }
  async queryUi(sql:string){
    await this.page.goto(`/projects/${this.vars.project}/db/${this.vars.connection}`);
    for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean)){
      await this.page.getByTestId('sql-editor').fill(statement+';');
      const waiting=this.page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===`/db-connections/${this.vars.connection}/query`);
      await this.page.getByTestId('sql-run').click();const response=await waiting;this.check(response.ok()).toBe(true);const result=await response.json();this.vars.dbRows=result.rows??[];this.check(Array.isArray(this.vars.dbRows)).toBe(true);
      await this.check(this.page.getByTestId('sql-execution-state')).toHaveText('completed');
    }
  }
  async targetLogin(){
    if(!this.target)this.target=this.tracker.wrapPage(await this.context.newPage());
    await this.target.goto(this.targetUrl);
    if(await this.target.getByTestId('logout').isVisible())await this.target.getByTestId('logout').click();
    await this.target.getByTestId('login-username').fill('scenario_user');
    const password=process.env.WB_TARGET_PASSWORD;if(!password)throw new Error('WB_TARGET_PASSWORD required for real fixture application login');
    await this.target.getByTestId('login-password').fill(password);await this.target.getByTestId('login-submit').click();
    await this.check(this.target.getByTestId('account-role')).toBeVisible();this.vars.loggedInRole=await this.target.getByTestId('account-role').innerText();
  }
  async browser(){
    const session=await this.request('/browser-sessions',{projectId:this.vars.project,workspaceRef:process.env.WB_WORKSPACE_REF,targetUrl:this.targetUrl},[200,201]);
    this.check(typeof session.id).toBe('string');this.check(typeof session.playwrightEndpoint).toBe('string');
    this.vars.session=session.id;
    session.sessionId=session.id;this.vars.managedBinding=session;
    this.remote=await chromium.connect(String(session.playwrightEndpoint));
    const attachment=session as Attachment;this.check(typeof attachment.contextRef).toBe('string');this.check(typeof attachment.pageId).toBe('string');
    this.target=this.tracker.wrapPage(await resolveManagedPage(this.remote,attachment),attachment);await this.queryUi(fixtureSql+" UPDATE test_accounts SET role_code='B' WHERE username='scenario_user';");await this.targetLogin();
    await this.page.goto(`/projects/${this.vars.project}/browser/${session.id}`);
    await this.check(this.page.getByTestId('browser-canvas')).toBeVisible();
  }
  async humanInput(text:string){
    if(!this.target)throw new Error('Managed browser required');
    const targetBox=await this.target.getByTestId('document-content').boundingBox();
    const box=await this.page.getByTestId('browser-canvas').boundingBox();const viewport=this.target.viewportSize();
    this.check(targetBox).not.toBeNull();this.check(box).not.toBeNull();this.check(viewport).not.toBeNull();
    const scale=Math.min(box!.width/viewport!.width,box!.height/viewport!.height);
    const offsetX=(box!.width-viewport!.width*scale)/2,offsetY=(box!.height-viewport!.height*scale)/2;
    await this.page.mouse.click(box!.x+offsetX+(targetBox!.x+targetBox!.width/2)*scale,box!.y+offsetY+(targetBox!.y+targetBox!.height/2)*scale);
    await this.page.keyboard.press('ControlOrMeta+A');await this.page.keyboard.type(text);
    await this.check(this.target.getByTestId('document-content')).toHaveValue(text);
  }
  async humanActions(){
    await this.page.getByTestId('browser-url').fill(this.targetUrl);await this.page.getByTestId('browser-url').press('Enter');
    const input='recorded-'+this.vars.project;await this.humanInput(input);
    await this.page.getByTestId('record-locator').fill('testId=document-content');
    await this.page.getByTestId('record-assertion-type').selectOption('value');
    await this.page.getByTestId('record-expected').fill(input);await this.page.getByTestId('record-add-assertion').click();
  }
  repoState(){
    const repo=process.env.WB_TARGET_REPO;if(!repo)throw new Error('WB_TARGET_REPO dedicated fixture repo required; tests never push');
    const files=execFileSync('git',['-C',repo,'ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean).sort();
    const head=execFileSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
    this.vars.targetCommit=head;
    return JSON.stringify({head,files:files.map(f=>[f,sha(readFileSync(resolve(repo,f)))])});
  }
  async evidence(){
    const rows=this.db.all('SELECT s.id,s.artifact_ref,s.sha256,st.source_step_id,st.status FROM screenshots s JOIN step_results st ON st.id=s.step_result_id JOIN case_results c ON c.id=st.case_result_id WHERE c.run_id=?',[String(this.vars.run)]);
    this.check(rows.length).toBeGreaterThan(0);
    for(const row of rows){this.check(row.source_step_id).not.toBeNull();const response=await this.page.request.get(`/screenshots/${row.id}`);this.check(response.ok()).toBe(true);this.check(response.headers()['content-type']).toMatch(/^image\/(png|jpeg)/);this.check(sha(await response.body())).toBe(row.sha256);}
    this.last=rows;
  }
  async close(){
    await this.selection?.close();
    try{await this.tracker.flush();}catch(error){if(this.info.status==='passed')throw error;}
    await this.info.attach('step-evidence',{body:JSON.stringify({testId:this.info.testId,annotations:this.info.annotations,records:this.records,actions:this.tracker.actions},null,2),contentType:'application/json'});
    await this.other?.close();await this.remote?.close();for(const db of this.secondary)db.close();this.db.close();
  }
}
