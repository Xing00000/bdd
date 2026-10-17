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
type Op = { op: string; [key:string]: unknown };
type Definition = { text: string; line: number; keyword: string; plan: Op[] };
const phases:Record<string,string>={'Gherkin確認':'GHERKIN','SD確認':'SD','test generation/completion':'TESTS',implementation:'IMPLEMENTATION','verification/report':'VERIFICATION'};
export class WorkbenchWorld {
  private db:FixtureDatabase;
  private tracker:StepEvidence;
  private check:typeof rawExpect;
  private vars:Record<string,unknown>;
  private records:object[]=[];
  private last:unknown;
  private before='';
  private sourcesBefore='';
  private repoBefore='';
  private remote?:Browser;
  private target?:Page;
  private other?:BrowserContext;
  private targetUrl:string;
  private frameBefore='';
  private draft='';
  private actionIndex=0;
  private secondary:FixtureDatabase[]=[];
  private selection?:SelectionProbe;
  private llmFull?:{db:FixtureDatabase;source:string;version:string};
  private llmMissing?:{db:FixtureDatabase;source:string;result:Record<string,unknown>};
  private currentSourceLine=0;
  private constructor(readonly page:Page,readonly context:BrowserContext,readonly info:TestInfo,db:FixtureDatabase,targetUrl:string){
    this.db=db; this.targetUrl=targetUrl;this.tracker=new StepEvidence(page,info);this.page=this.tracker.wrapPage(page);this.check=this.tracker.wrapExpect(rawExpect);this.vars={...db.vars,targetUrl,feature:sourceFeature,sd:sourceSd,spec:specText(targetUrl),recording:specText(targetUrl),targetDb:process.env.WB_TARGET_DB,sourceRef:process.env.WB_SOURCE_REF};
  }
  static async open(page:Page,context:BrowserContext,info:TestInfo){
    for(const key of ['WB_BASE_URL','WB_TARGET_BASE_URL','WB_METADATA_DB','WB_TARGET_DB'])if(!process.env[key])throw new Error(`E2E prerequisite missing: ${key}; no product result is simulated.`);
    const expected={'spec/REQ-WB-001/workbench.feature':'88a51d341375ca58750df37cae184a81662469d9047354fd23b75a3006bbad66','spec/REQ-WB-001/SD.md':'a0bd73923884da67c0c71be2aaf945319fcb1a5bb380b7c704460989d3b565b4'};
    for(const [file,hash] of Object.entries(expected))rawExpect(sha(readFileSync(file)),`approved ${file}`).toBe(hash);
    const db=new FixtureDatabase(process.env.WB_METADATA_DB!,process.env.WB_TARGET_BASE_URL!,process.env.WB_TARGET_DB!);
    return new WorkbenchWorld(page,context,info,db,process.env.WB_TARGET_BASE_URL!);
  }
  private value(v:unknown,args:string[]):unknown {
    if(typeof v==='string'){
      if(/^\$\d+$/.test(v))return args[Number(v.slice(1))];
      if(v.startsWith('$'))return this.vars[v.slice(1)];
      return v.replace(/\{(\w+)\}/g,(_,key)=>String(this.vars[key]??`MISSING:${key}`));
    }
    if(Array.isArray(v))return v.map(x=>this.value(x,args));
    if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,this.value(x,args)]));
    return v;
  }
  async perform(def:Definition,args:string[]){
    this.currentSourceLine=def.line;this.tracker.setStep(def.line,def.keyword);
    if(!def.plan.length)throw new Error(`Empty step plan at ${def.line}`);
    for(const raw of def.plan){
      const op=this.value(raw,args) as Op;
      const index=++this.actionIndex;
      let error:unknown;
      try{await this.execute(op);await this.tracker.flush();}
      catch(e){error=e;throw e;}
      finally{
        const row=await this.tracker.operation(op.op,error,op.rows??op.value??op.status,this.last,def.keyword==='Then');
        this.records.push({...row,operation:op.op,step:def.text});
      }
    }
  }
  private async request(path:string,body:unknown,status:number|number[]=200){
    const r=await this.page.request.post(path,{data:body});
    const text=await r.text();
    this.check(Array.isArray(status)?status:[status],`${path}: ${text}`).toContain(r.status());
    this.last=JSON.parse(text); this.vars.response=this.last;
    const result=this.last as Record<string,unknown>;
    if(result.runId)this.vars.run=result.runId;else if(/\/(verify|replay)$/.test(path)&&result.id)this.vars.run=result.id;
    return result;
  }
  private async execute(p:Op){
    const id=String(p.id??'');const value=String(p.value??'');
    switch(p.op){
      case 'open': await this.page.goto(`/projects/${this.vars.project}/requirements/${this.vars.requirement}`);return;
      case 'stage': this.db.stage(({Gherkin:'GHERKIN','spec.ts':'TESTS',SD:'SD'} as Record<string,string>)[value]??phases[value]??value);await this.page.reload();return;
      case 'baseline': this.db.baseline(Boolean(p.historical));return;
      case 'click': await this.page.getByTestId(id).click();return;
      case 'fill': await this.page.getByTestId(id).fill(value);return;
      case 'text': this.last=await this.page.getByTestId(id).textContent();await this.check(this.page.getByTestId(id)).toContainText(value);return;
      case 'visible': await this.check(this.page.getByTestId(id)).toBeVisible();return;
      case 'disabled': await this.check(this.page.getByTestId(id)).toBeDisabled();return;
      case 'hidden': await this.check(this.page.getByTestId(id)).toBeHidden();return;
      case 'phase': {
        const stage=phases[value]??value;
        await this.check.poll(()=>this.db.all('SELECT stage FROM requirements WHERE id=?',[String(this.vars.requirement)])[0]?.stage).toBe(stage);
        await this.check(this.page.getByTestId('workflow-stage')).toContainText(value);return;
      }
      case 'sql': {
        const params=(p.params??[]) as SQLInputValue[];
        await this.check.poll(()=>this.db.all(String(p.sql),params)).toMatchObject(p.rows as object[]);
        this.last=this.db.all(String(p.sql),params);return;
      }
      case 'snapshot': this.before=this.db.snapshot();return;
      case 'unchanged': this.check(this.db.snapshot(),'effective original text and projections').toBe(this.before);return;
      case 'request': if(p.body&&typeof p.body==='object'&&'artifactKind' in p.body)this.vars.returnArtifact=(p.body as Record<string,unknown>).artifactKind;await this.request(String(p.path),p.body,(p.status??200) as number|number[]);return;
      case 'responseError': this.check(JSON.stringify(this.last)).toContain(String(p.value));this.check(JSON.stringify(this.last)).toContain(String(p.message));return;
      case 'response': {
        let actual=this.last;for(const key of String(p.path??'').split('.').filter(Boolean))actual=(actual as Record<string,unknown>)?.[key];
        if(p.contains!==undefined)this.check(actual).toEqual(rawExpect.arrayContaining(p.contains as unknown[]));
        else this.check(actual).toEqual(p.value);return;
      }
      case 'save': await this.save(p);return;
      case 'raw': {
        const kind=({Gherkin:'gherkin','spec.ts':'spec',SD:'sd'} as Record<string,string>)[String(p.kind)]??String(p.kind??'gherkin');const doc=this.vars[kind+'Doc'];
        this.last=this.db.all('SELECT v.raw_text,v.raw_sha256,v.id FROM document_heads h JOIN document_versions v ON v.id=h.version_id WHERE h.document_id=?',[String(doc)])[0];
        this.check((this.last as Record<string,unknown>)?.raw_text).toBe(p.value??this.vars[kind==='spec'?'savedSpec':kind]);
        this.check((this.last as Record<string,unknown>)?.raw_sha256).toBe(sha(String((this.last as Record<string,unknown>).raw_text)));return;
      }
      case 'repoSnapshot': this.repoBefore=this.repoState();return;
      case 'repoUnchanged': this.check(this.repoState(),'target Git and CI list unchanged').toBe(this.repoBefore);return;
      case 'secondReader': {
        this.other=await this.context.browser()!.newContext({baseURL:process.env.WB_BASE_URL});
        const other=this.tracker.wrapPage(await this.other.newPage());await other.goto(`/projects/${this.vars.project}/requirements/${this.vars.requirement}`);
        await this.check(other.getByTestId('gherkin-editor')).toHaveValue(String(this.vars.feature));return;
      }
      case 'dbUi': await this.queryUi(String(p.sql));return;
      case 'dbText': await this.check(this.page.getByTestId('db-results')).toContainText(value);this.check((this.vars.dbRows as Record<string,unknown>[]).some(row=>Object.values(row).includes(value))).toBe(true);this.last=await this.page.getByTestId('db-results').innerText();return;
      case 'fixtureSql': await this.queryUi(fixtureSql);return;
      case 'targetLogin': await this.targetLogin();return;
      case 'targetRole': this.check(this.vars.loggedInRole).toBe(value);return;
      case 'targetEdit': await this.target!.getByTestId('document-content').fill('edited');await this.target!.getByTestId('document-save').click();await this.check(this.target!.getByTestId('document-saved')).toBeVisible();this.vars.documentSaved=await this.target!.getByTestId('document-content').inputValue();return;
      case 'targetDenied': await this.queryUi('SELECT username,role_code,state FROM test_accounts ORDER BY username;');this.vars.accountsBefore=await this.page.getByTestId('db-results').innerText();await this.target!.getByTestId('manage-accounts-link').click();await this.check(this.target!.getByTestId('access-denied')).toBeVisible();return;
      case 'targetLogout': if(!this.target)this.target=this.tracker.wrapPage(await this.context.newPage());await this.target.goto(this.targetUrl);await this.target.getByTestId('logout').click();await this.check(this.target.getByTestId('login-submit')).toBeVisible();return;
      case 'browser': await this.browser();return;
      case 'automate': {
        if(!this.target)await this.browser();
        this.frameBefore=sha(await this.page.getByTestId('browser-canvas').screenshot());
        const marker=`${value}-${this.vars.project}`;this.vars.marker=marker;
        await this.target!.getByTestId('document-content').fill(marker);
        await this.check(this.target!.getByTestId('document-content')).toHaveValue(marker);return;
      }
      case 'live': await this.check.poll(async()=>sha(await this.page.getByTestId('browser-canvas').screenshot())).not.toBe(this.frameBefore);await this.check(this.page.getByTestId('browser-session-id')).toHaveText(String(this.vars.session));await this.check(this.page.getByTestId('browser-stream-state')).toHaveText('live');return;
      case 'recordStart': await this.page.getByTestId('record-start').click();await this.check(this.page.getByTestId('recording-state')).toHaveText('recording');return;
      case 'humanActions': await this.humanActions();return;
      case 'recordStop': {const responsePromise=this.page.waitForResponse(r=>r.request().method()==='POST'&&/\/recordings\/stop$/.test(new URL(r.url()).pathname));await this.page.getByTestId('record-stop').click();const response=await responsePromise;this.check(response.ok()).toBe(true);const stopped=await response.json() as {actions:unknown[]};this.check(stopped.actions.length).toBeGreaterThan(0);this.vars.recordingActions=stopped.actions;await this.check(this.page.getByTestId('recording-state')).toHaveText('stopped');this.draft=await this.page.getByTestId('recording-script').inputValue();this.vars.recording=this.draft;return;}
      case 'draft': this.check(this.draft).toContain('recorded-');this.check(this.draft).toMatch(/expect\s*\(/);this.check(this.draft).toMatch(/fill\s*\(/);return;
      case 'afterStop': await this.humanInput('after-stop');this.check(await this.page.getByTestId('recording-script').inputValue()).toBe(this.draft);return;
      case 'recordSave': await this.saveRecording(Boolean(p.unassociated));return;
      case 'replay': {
        const document=this.db.all('SELECT purpose FROM documents WHERE id=?',[String(this.vars.recordingDoc)])[0];if(document.purpose==='recording'){await this.page.goto(`/projects/${this.vars.project}/recordings/${this.vars.recordingDoc}`);await this.check(this.page.getByTestId('recording-script')).toHaveValue(String(this.vars.recording));}
        const rows=this.db.all('SELECT h.version_id FROM document_heads h WHERE h.document_id=?',[String(this.vars.recordingDoc)]);this.check(rows).toHaveLength(1);
        await this.request(`/scripts/${this.vars.recordingDoc}/versions/${rows[0].version_id}/replay`,{projectId:this.vars.project,targetUrl:this.targetUrl},[200,201,202]);return;
      }
      case 'evidence': await this.evidence();return;
      case 'report': {
        await this.check.poll(async()=>{const response=await this.page.request.get(`/runs/${this.vars.run}/report`);if(!response.ok())throw Error('Report endpoint returned '+response.status());this.last=await response.json();this.vars.report=this.last;return (this.last as Record<string,unknown>).status;},{timeout:60_000}).toMatch(/^(PASSED|FAILED|INCOMPLETE|INVALID)$/);return;
      }
      case 'reportStatus': this.check((this.vars.report as Record<string,unknown>)?.status).toBe(p.value);return;
      case 'reportNoFalsePass': {
        const report=this.vars.report as {cases:{status:string;executed:boolean;steps:{status:string;assertion:boolean;expected:unknown;actual:unknown;screenshots:unknown[]}[]}[]};this.check(report.cases.length).toBeGreaterThan(0);
        for(const c of report.cases)if(c.status==='PASSED'){this.check(c.executed).toBe(true);this.check(c.steps.length).toBeGreaterThan(0);const assertions=c.steps.filter(s=>s.assertion);this.check(assertions.length).toBeGreaterThan(0);for(const step of c.steps){this.check(step.status).toBe('PASSED');this.check(step.screenshots.length).toBeGreaterThan(0);}for(const step of assertions){this.check(step).toHaveProperty('expected');this.check(step).toHaveProperty('actual');this.check((step as unknown as {assertionPassed:boolean}).assertionPassed).toBe(true);}}return;
      }
      case 'binding': {
        const manifest=JSON.parse(readFileSync('spec/REQ-WB-001/evidence/completion/generation-manifest.json','utf8'));
        this.check(manifest.cases).toHaveLength(44);this.check(new Set(manifest.cases.map((c:{testKey:string})=>c.testKey)).size).toBe(44);return;
      }
      case 'remember': this.vars[String(p.key)]=p.value;if(p.key==='integration')this.db.db.prepare("UPDATE documents SET purpose='integration' WHERE id=?").run(String(this.vars.recordingDoc));return;
      case 'gitBootstrap': {
        const paths=execFileSync('git',['ls-tree','-r','--name-only','HEAD'],{encoding:'utf8'}).split('\n');
        const required=['spec/REQ-WB-001/workbench.feature','spec/REQ-WB-001/SD.md','spec/REQ-WB-001/review.json'];if(p.includeTests)required.push('generated/completed/REQ-WB-001/workbench.feature.spec.ts','tests/completion/steps/definitions.json','tests/completion/steps/workbench.steps.ts','tests/completion/support/fixtures.ts','playwright.config.ts','package-lock.json');
        for(const file of required)this.check(paths).toContain(file);
        this.check(readFileSync('spec/REQ-WB-001/review.json','utf8')).toContain('REQ-WB-001');return;
      }
      case 'sourceSnapshot': this.sourcesBefore=this.sourceSnapshot();return;
      case 'sourceUnchanged': this.check(this.sourceSnapshot()).toBe(this.sourcesBefore);return;
      case 'confirmBoth': await this.page.getByTestId('confirm-gherkin').click();await this.check(this.page.getByTestId('confirm-sd')).toBeEnabled();await this.page.getByTestId('confirm-sd').click();return;
      case 'headChanged': {const v=this.head(value||String(p.kind));this.check(v.id).not.toBe(this.vars[String(p.kind)+'Version']);return;}
      case 'sdSections': {const raw=String(this.head('sd').raw_text);this.check(raw).toMatch(/架構|Architecture/i);this.check(raw).toMatch(/DDL|CREATE/i);this.check(raw).toMatch(/DML|INSERT|UPDATE|SELECT/i);return;}
      case 'prepareSteps': this.check(readFileSync('tests/completion/fixtures/target.steps.ts','utf8')).toContain('createBdd(test)');return;
      case 'uploadSteps': await this.page.getByTestId('step-definitions-upload').setInputFiles('tests/completion/fixtures/target.steps.ts');return;
      case 'generatedProductSpec': {
        const raw=await this.page.getByTestId('generated-spec-source').inputValue();this.check(raw).toMatch(/test\s*\(/);this.checkSyntax(raw);await this.check(this.page.getByTestId('generated-spec-path')).toContainText('.spec.ts');await this.discoverProductBundle(raw);return;
      }
      case 'generatedProductMapping': {
        const raw=await this.page.getByTestId('generated-manifest').inputValue();const manifest=JSON.parse(raw) as {cases:{scenarioId:string;caseId:string;testKey:string}[]};
        this.check(manifest.cases.map(c=>[c.scenarioId,c.caseId])).toEqual(rawExpect.arrayContaining([['AC-DEMO-001','a'],['AC-DEMO-001','b']]));
        this.check(manifest.cases.length).toBeGreaterThanOrEqual(2);this.check(new Set(manifest.cases.map(c=>c.testKey)).size).toBe(manifest.cases.length);return;
      }
      case 'terminalSend': {const terminal=await this.page.getByTestId('terminal-session-id').innerText();if(this.vars.terminal)this.check(terminal).toBe(this.vars.terminal);else this.vars.terminal=terminal;await this.page.getByTestId('terminal-input').fill(value.trimEnd());await this.page.getByTestId('terminal-input').press('Enter');return;}
      case 'blockedSave': {
        const artifact=value.includes('Gherkin')?'gherkin':'spec';
        await this.page.getByTestId('open-artifact-save').click();
        await this.page.getByTestId('artifact-save-kind').selectOption(artifact);
        await this.page.getByTestId('artifact-save-candidate').fill(artifact==='gherkin'?sourceFeature+'\n':specText(this.targetUrl));
        const waiting=this.page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===`/documents/${this.vars[artifact+'Doc']}/versions`);
        await this.page.getByTestId('artifact-save-attempt').click();const response=await waiting;
        this.check(response.status()).toBe(409);this.last=await response.json();
        await this.check(this.page.getByTestId('artifact-save-error')).toContainText('此階段不可修改該產物');return;
      }
      case 'useSkeleton': this.db.useSkeleton();return;
      case 'llmPrepare': this.db.useSkeleton();this.db.stage('TESTS');await this.page.reload();this.llmFull={db:this.db,source:this.sourceSnapshot(),version:String(this.head('spec').id)};return;
      case 'llmCompleteBoth': await this.completeBothBranches();return;
      case 'llmFullCheck': {
        const full=this.llmFull!;this.check(this.sourceSnapshot()).toBe(full.source);
        const row=this.head('spec');this.check(row.id).not.toBe(full.version);this.check(row.test_stage).toBe('COMPLETED');this.check(row.source_skeleton_version_id).toBe(full.version);
        this.checkSyntax(String(row.raw_text));this.check(this.db.all('SELECT test_key FROM test_definitions WHERE spec_version_id=? ORDER BY test_key',[String(row.id)])).toEqual([{test_key:'test-a'},{test_key:'test-a-extra'},{test_key:'test-b'}]);await this.execute({op:'generatedProductMapping'});return;
      }
      case 'llmMissingCheck': {
        const missing=this.llmMissing!;this.check(missing.result.status).toBe('needs_input');
        this.check((missing.result.questions as unknown[]).length).toBeGreaterThan(0);
        const versions=missing.db.all('SELECT v.* FROM document_heads h JOIN document_versions v ON v.id=h.version_id WHERE h.document_id=?',[missing.db.vars.specDoc]);
        this.check(['SKELETON','COMPLETION_DRAFT']).toContain(versions[0].test_stage);
        this.check(missing.db.all("SELECT id FROM baselines WHERE requirement_id=? AND kind='tests' AND valid=1",[missing.db.vars.requirement])).toHaveLength(0);
        this.check(this.documentSource(missing.db)).toBe(missing.source);return;
      }
      case 'returnUi': {this.vars.returnArtifact=value;await this.page.getByTestId('return-artifact').selectOption({label:value});const waiting=this.page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===`/requirements/${this.vars.requirement}/return`);await this.page.getByTestId('return-stage').click();const response=await waiting;this.check(response.ok()).toBe(true);return;}
      case 'schemaUi': await this.page.getByTestId('db-schema-refresh').click();await this.check(this.page.getByTestId('db-schema')).toContainText('test_accounts');await this.check(this.page.getByTestId('db-schema')).toContainText('role_code');return;
      case 'waitComplete': await this.check(this.page.getByTestId('test-readiness')).toHaveText('COMPLETED',{timeout:60_000});return;
      case 'reopenRequirement': await this.page.goto('/projects');await this.page.goto(`/projects/${this.vars.project}/requirements/${this.vars.requirement}`);return;
      case 'selectedPrepare': this.db.useSkeleton();this.db.stage('TESTS');this.selection=new SelectionProbe(this.page,this.db,this.vars,this.info,this.check);await this.page.reload();return;
      case 'selectedMapping': {
        const rows=this.db.all('SELECT t.test_key,c.case_key FROM test_definitions t JOIN test_case_mappings m ON m.test_definition_id=t.id JOIN source_cases c ON c.id=m.source_case_id WHERE t.spec_version_id=? ORDER BY t.test_key',[String(this.vars.specSkeletonVersion)]);
        this.check(rows).toEqual([{test_key:'test-a',case_key:'a'},{test_key:'test-a-extra',case_key:'a'},{test_key:'test-b',case_key:'b'}]);return;
      }
      case 'selectedSkeleton': this.check(this.head('spec').test_stage).toBe('SKELETON');return;
      case 'selectedOpen': await this.selection!.open();return;
      case 'selectedList': await this.selection!.list();return;
      case 'selectedPending': await this.selection!.pending();return;
      case 'selectedStart': await this.selection!.start();return;
      case 'selectedExact': await this.selection!.exactSet();return;
      case 'selectedUnselected': await this.selection!.unselected();return;
      case 'selectedLive': await this.selection!.live();return;
      case 'selectedEvidence': await this.selection!.evidence();return;
      case 'selectedPassed': await this.selection!.passed();return;
      case 'selectedPartial': await this.selection!.partial();return;
      case 'missingStepFixture': {
        const raw=sourceFeature.replace('the account edits the document','deliberately_missing_step');
        this.db.db.prepare("DELETE FROM confirmations WHERE requirement_id=? AND kind='gherkin'").run(String(this.vars.requirement));
        this.db.db.prepare('UPDATE document_versions SET raw_text=?,raw_sha256=? WHERE id=?').run(raw,sha(raw),String(this.vars.gherkinVersion));
        this.db.insert('confirmations',{requirement_id:String(this.vars.requirement),kind:'gherkin',version_id:String(this.vars.gherkinVersion),raw_sha256:sha(raw),confirmed_at:new Date().toISOString()});
        this.db.db.prepare("UPDATE steps SET text='deliberately_missing_step' WHERE group_id IN (SELECT id FROM step_groups WHERE gherkin_version_id=?) AND ordinal=2").run(String(this.vars.gherkinVersion));return;
      }
      case 'missingStepError': {this.check(JSON.stringify(this.last)).toContain('deliberately_missing_step');this.check(JSON.stringify(this.last)).toMatch(/UNDEFINED|MISSING|未定義|未實作/i);return;}
      case 'syntaxError': {this.assertDiagnostics('SYNTAX_INVALID');return;}
      case 'mappingError': {this.assertDiagnostics('MAPPING_INVALID');this.check(JSON.stringify(this.last)).toContain(String(this.vars.problem));const body=JSON.stringify(this.last);this.check(body).toMatch(/test-a|test-b|AC-DEMO-001|AC-MISSING-999|missing/);return;}
      case 'ownEvidence': {
        this.check(this.records.length).toBeGreaterThan(0);for(const row of this.records as {sourceStepLine:number;screenshotSha256:string}[]){this.check(row.sourceStepLine).toBeGreaterThan(0);this.check(row.screenshotSha256).toMatch(/^[a-f0-9]{64}$/);}return;
      }
      case 'targetReadOnly': await this.check(this.target!.getByTestId('document-content')).not.toBeEditable();return;
      case 'targetSaved': this.check(this.vars.documentSaved).toBe('edited');return;
      case 'targetAccessDenied': await this.check(this.target!.getByTestId('access-denied')).toBeVisible();return;
      case 'assertAccountUnchanged': this.check(await this.page.getByTestId('db-results').innerText()).toBe(this.vars.accountsBefore);return;
      case 'requestVerification': {
        const sourceRef=this.vars.sourceRef;if(!sourceRef)throw Error('WB_SOURCE_REF required; no fictitious source revision');
        const baselines=this.db.all("SELECT id FROM baselines WHERE requirement_id=? AND kind='tests' AND valid=1",[String(this.vars.requirement)]);this.check(baselines).toHaveLength(1);this.vars.baseline=baselines[0].id;
        await this.request(`/requirements/${this.vars.requirement}/verify`,{testBaselineId:this.vars.baseline,sourceRef,selection:{mode:'ALL_REQUIRED',sourceCaseIds:[]}},[200,201,202]);return;
      }
      case 'saveIntegration': await this.save({op:'save',kind:'recording',unassociated:true});return;
      case 'replayIntegration': await this.execute({op:'replay'});return;
      case 'assertIntegration': {
        const rows=this.db.all('SELECT d.purpose,r.script_version_id FROM runs r JOIN document_versions v ON v.id=r.script_version_id JOIN documents d ON d.id=v.document_id WHERE r.id=?',[String(this.vars.run)]);this.check(rows).toHaveLength(1);this.check(rows[0].purpose).toBe('integration');return;
      }
      case 'waitCi': await this.check(this.page.getByTestId('ci-state')).toHaveText('completed',{timeout:60_000});this.vars.run=await this.page.getByTestId('ci-run-id').innerText();this.repoBefore=this.repoState();return;
      case 'assertGitSnapshot': {
        const repo=process.env.WB_TARGET_REPO;if(!repo)throw Error('WB_TARGET_REPO required');
        const rows=this.db.all('SELECT g.* FROM git_snapshots g JOIN document_heads h ON h.version_id=g.spec_version_id WHERE h.document_id=?',[String(this.vars.specDoc)]);this.check(rows).toHaveLength(1);
        const row=rows[0];const raw=execFileSync('git',['-C',repo,'show',`${row.commit_sha}:${row.file_path}`],{encoding:'utf8'});this.check(this.head('spec').raw_text).toBe(raw);this.vars.savedSpec=raw;this.vars.targetCommit=row.commit_sha;return;
      }
      case 'assertCiCommit': {const run=this.db.all('SELECT candidate_commit,tested_commit FROM runs WHERE id=?',[String(this.vars.run)])[0];this.check(run?.candidate_commit).toBe(this.vars.targetCommit);this.check(typeof run.tested_commit).toBe('string');const commit=execFileSync('git',['-C',process.env.WB_TARGET_REPO!,'rev-parse',String(run.tested_commit)+'^{commit}'],{encoding:'utf8'}).trim();this.check(commit).toBe(run.tested_commit);return;}
      case 'assertCiList': this.check(this.repoState()).toBe(this.repoBefore);return;
      case 'assertReportCases': {
        const report=this.vars.report as {cases:{testKey:string;status:string;executed:boolean;steps:unknown[]}[]};this.check(report.cases.length).toBeGreaterThan(0);
        for(const c of report.cases){this.check(c.testKey.length).toBeGreaterThan(0);this.check(['PASSED','FAILED','NOT_RUN','INCOMPLETE','INVALID']).toContain(c.status);this.check(typeof c.executed).toBe('boolean');if(c.executed)this.check(c.steps.length).toBeGreaterThan(0);}return;
      }
      case 'assertReportBinding': {
        const report=this.vars.report as Record<string,unknown>;this.check(report.sourceRef).toBe(this.vars.sourceRef);this.check(report.gherkinVersionId).toBe(this.vars.gherkinVersion);this.check(report.testBaselineId).toBe(this.vars.baseline);return;
      }
      case 'assertReplayExecuted': {const report=this.vars.report as {scriptVersionId:string;status:string;cases:{executed:boolean}[]};this.check(report.scriptVersionId).toBe(this.vars.recordingSavedVersion);this.check(report.cases.length).toBeGreaterThan(0);this.check(report.cases.every(c=>c.executed)).toBe(true);this.check(['PASSED','FAILED']).toContain(report.status);return;}
      case 'assertRecordingLinked': {
        const d=this.db.all('SELECT purpose,requirement_id FROM documents WHERE id=?',[String(this.vars.recordingDoc)])[0];this.check(d?.purpose).toBe('recording');this.check(d.requirement_id).toBe(this.vars.requirement);
        const mappings=this.db.all('SELECT c.scenario_id,c.gherkin_version_id,c.case_key FROM test_case_mappings m JOIN source_cases c ON c.id=m.source_case_id JOIN test_definitions t ON t.id=m.test_definition_id WHERE t.spec_version_id=?',[String(this.vars.recordingSavedVersion)]);
        this.check(mappings.length).toBeGreaterThan(0);for(const m of mappings)this.check(m).toEqual({scenario_id:this.vars.scenario,gherkin_version_id:this.vars.gherkinVersion,case_key:'a'});
        const actions=this.db.all('SELECT count(*) AS n FROM recording_actions WHERE spec_version_id=?',[String(this.vars.recordingSavedVersion)]);this.check(actions[0].n).toBe((this.vars.recordingActions as unknown[]).length);return;
      }
      case 'assertDownstreamInvalidated': {
        const baseline=this.db.all('SELECT valid FROM baselines WHERE id=?',[String(this.vars.baseline)])[0];this.check(baseline.valid).toBe(this.vars.returnArtifact==='產品程式'?1:0);
        this.check(this.db.all('SELECT status FROM runs WHERE id=?',[String(this.vars.historicalRun)])[0].status).toBe('INVALID');return;
      }
      case 'assertConfirmationGate': {
        const stage=this.db.all('SELECT stage FROM requirements WHERE id=?',[String(this.vars.requirement)])[0]?.stage;
        if(stage==='GHERKIN'||stage==='SD'){await this.check(this.page.getByTestId('start-development')).toBeDisabled();await this.request(`/requirements/${this.vars.requirement}/start-development`,{},409);}
        else this.check(['TESTS','IMPLEMENTATION']).toContain(stage);return;
      }
      case 'assertExclusiveEditors': {const a=await this.page.getByTestId('gherkin-editor').isEditable(),b=await this.page.getByTestId('spec-editor').isEditable();this.check(a&&b).toBe(false);return;}
      case 'advanceWorkflow': await this.advance();return;
      case 'assertGherkinStructure': {
        const version=String(this.head('gherkin').id);
        const scenario=this.db.all('SELECT s.scenario_key,sv.title FROM scenario_versions sv JOIN scenarios s ON s.id=sv.scenario_id WHERE sv.gherkin_version_id=?',[version]);this.check(scenario).toEqual([{scenario_key:'AC-DEMO-001',title:'Edit document'}]);
        const steps=this.db.all('SELECT st.ordinal,st.keyword,st.text FROM steps st JOIN step_groups g ON g.id=st.group_id WHERE g.gherkin_version_id=? ORDER BY st.ordinal',[version]);
        this.check(steps).toEqual([{ordinal:1,keyword:'Given',text:'the account has role "<role>"'},{ordinal:2,keyword:'When',text:'the account edits the document'},{ordinal:3,keyword:'Then',text:'the result is "<expected>"'}]);return;
      }
      case 'assertExamples': {
        const version=String(this.head('gherkin').id);
        const rows=this.db.all('SELECT c.case_key,c.row_ordinal,col.name,e.value FROM source_cases c JOIN example_cells e ON e.source_case_id=c.id JOIN example_columns col ON col.table_id=e.example_table_id AND col.ordinal=e.column_ordinal WHERE c.gherkin_version_id=? ORDER BY c.row_ordinal,col.ordinal',[version]);
        this.check(rows).toEqual([['a',1,'case_id','a'],['a',1,'role','A'],['a',1,'expected','denied'],['b',2,'case_id','b'],['b',2,'role','B'],['b',2,'expected','saved']].map(([case_key,row_ordinal,name,value])=>({case_key,row_ordinal,name,value})));return;
      }
      case 'assertSourceHash': {
        const row=this.head(String(p.kind??'gherkin'));this.check(row.raw_sha256).toBe(sha(String(row.raw_text)));
        if(p.kind==='spec'){this.check(row.source_gherkin_version_id).toBe(this.vars.gherkinVersion);const source=this.db.all('SELECT raw_sha256 FROM document_versions WHERE id=?',[String(row.source_gherkin_version_id)])[0];this.check(source?.raw_sha256).toBe(sha(sourceFeature));}
        return;
      }
      case 'assertPinnedSource': {
        const old=String(this.head('spec').source_gherkin_version_id);
        await this.request(`/requirements/${this.vars.requirement}/return`,{artifactKind:'Gherkin'},[200,201]);
        await this.request(`/documents/${this.vars.gherkinDoc}/versions`,{rawText:sourceFeature.replace('Edit document','Edit document revised')},[200,201]);
        this.check(this.head('gherkin').id).not.toBe(old);this.check(this.head('spec').source_gherkin_version_id).toBe(old);return;
      }
      case 'failureBaseline': await this.failureBaseline();return;
      case 'assertFailureReport': {
        const report=this.vars.report as {status:string;cases:{scenarioId:string;status:string;steps:{status:string;assertion:boolean;assertionPassed:boolean;sourceStepId:string;expected:unknown;actual:unknown;screenshots:{moment:string}[]}[]}[]};this.check(report.status).toBe('FAILED');
        const failures=report.cases.filter(c=>c.scenarioId==='AC-DEMO-001'&&c.status==='FAILED').flatMap(c=>c.steps.filter(s=>s.status==='FAILED'&&s.assertion&&s.assertionPassed===false&&s.expected==='A'&&s.actual==='B'));
        this.check(failures.length).toBeGreaterThan(0);for(const step of failures){this.check(step.sourceStepId).toBeTruthy();this.check(step.screenshots.some(s=>s.moment==='failure')).toBe(true);}return;
      }
      default: throw new Error(`Unsupported non-empty test operation: ${p.op} at Gherkin line ${this.currentSourceLine}`);
    }
  }
  private head(kind:string){
    const row=this.db.all('SELECT v.* FROM document_heads h JOIN document_versions v ON v.id=h.version_id WHERE h.document_id=?',[String(this.vars[kind+'Doc'])])[0];this.check(row,`head ${kind}`).toBeDefined();return row;
  }
  private sourceSnapshot(){return JSON.stringify(['gherkin','sd'].map(k=>this.head(k)));}
  private checkSyntax(raw:string){
    const name='candidate.spec.ts';const file=ts.createSourceFile(name,raw,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
    const host=ts.createCompilerHost({noEmit:true,noResolve:true});host.getSourceFile=(n)=>n===name?file:undefined;host.fileExists=n=>n===name;host.readFile=n=>n===name?raw:undefined;host.writeFile=()=>{throw Error('No emit permitted');};
    const program=ts.createProgram([name],{noEmit:true,noResolve:true},host);this.check(program.getSyntacticDiagnostics(file)).toHaveLength(0);
  }
  private assertDiagnostics(code:string){
    const body=this.last as {code?:string;diagnostics:{code?:string;file?:string;line:number;column:number;reason:string}[];file?:string};
    this.check(body.diagnostics.length).toBeGreaterThan(0);this.check(body.code??body.diagnostics[0].code).toBe(code);
    for(const d of body.diagnostics){if(code==='SYNTAX_INVALID'){this.check(typeof(d.file??body.file)).toBe('string');this.check(d.line).toBeGreaterThan(0);this.check(d.column).toBeGreaterThan(0);}this.check(d.reason.length).toBeGreaterThan(0);}
  }
  private async advance(){
    const order=['GHERKIN','SD','TESTS','IMPLEMENTATION','VERIFICATION'];
    for(let i=0;i<4;i++){
      const stage=String(this.db.all('SELECT stage FROM requirements WHERE id=?',[String(this.vars.requirement)])[0].stage);
      if(stage==='VERIFICATION'||stage==='VERIFIED')return;
      if(stage==='GHERKIN')await this.page.getByTestId('confirm-gherkin').click();
      else if(stage==='SD')await this.page.getByTestId('confirm-sd').click();
      else if(stage==='TESTS'){await this.execute({op:'uploadSteps'});await this.page.getByTestId('generate-tests').click();await this.page.getByTestId('complete-tests').click();await this.execute({op:'waitComplete'});await this.page.getByTestId('start-development').click();}
      else if(stage==='IMPLEMENTATION')await this.execute({op:'requestVerification'});
      else throw Error('Unknown workflow stage '+stage);
      await this.check.poll(()=>this.db.all('SELECT stage FROM requirements WHERE id=?',[String(this.vars.requirement)])[0].stage).toBe(order[order.indexOf(stage)+1]);
    }
    this.check(this.db.all('SELECT stage FROM requirements WHERE id=?',[String(this.vars.requirement)])[0].stage).toBe('VERIFICATION');
  }
  private async failureBaseline(){
    // This target fixture intentionally asserts A while the real account is B; the outer scenario verifies its failed report.
    const raw=failingSpecText(this.targetUrl);this.checkSyntax(raw);
    this.db.replaceFixtureSpec(raw);this.vars={...this.vars,...this.db.vars};this.db.baseline();
  }
  private documentSource(db:FixtureDatabase){return JSON.stringify(['gherkin','sd'].map(k=>db.all('SELECT v.* FROM document_heads h JOIN document_versions v ON v.id=h.version_id WHERE h.document_id=?',[db.vars[k+'Doc']])[0]));}
  private async completeBothBranches(){
    const runCompletion=async(db:FixtureDatabase)=>{
      await this.page.goto(`/projects/${db.vars.project}/requirements/${db.vars.requirement}`);
      const waiting=this.page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===`/requirements/${db.vars.requirement}/complete-tests`);
      await this.page.getByTestId('complete-tests').click();const response=await waiting;this.check(response.ok()).toBe(true);return response.json() as Promise<Record<string,unknown>>;
    };
    await runCompletion(this.db);await this.check(this.page.getByTestId('test-readiness')).toHaveText('COMPLETED',{timeout:60_000});
    const missing=new FixtureDatabase(process.env.WB_METADATA_DB!,this.targetUrl,process.env.WB_TARGET_DB!,true);this.secondary.push(missing);missing.stage('TESTS');
    const source=this.documentSource(missing),result=await runCompletion(missing);
    await this.check(this.page.getByTestId('llm-needs-input')).toContainText('預期');
    this.llmMissing={db:missing,source,result};await this.page.goto(`/projects/${this.vars.project}/requirements/${this.vars.requirement}`);
  }
  private async saveRecording(unassociated:boolean){
    const raw=String(this.vars.recording);this.checkSyntax(raw);
    const result=await this.request('/recordings',{projectId:this.vars.project,requirementId:unassociated?null:this.vars.requirement,rawText:raw,actions:this.vars.recordingActions??[],sourceCases:unassociated?[]:[{gherkinVersionId:this.vars.gherkinVersion,scenarioId:'AC-DEMO-001',caseId:'a'}]},[200,201]);
    this.check(typeof result.id).toBe('string');this.check(typeof result.versionId).toBe('string');this.vars.recordingDoc=result.id;this.vars.recordingSavedVersion=result.versionId;
    await this.page.goto(`/projects/${this.vars.project}/recordings/${result.id}`);
  }
  private async save(p:Op){
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
      if(kind==='gherkin')this.vars.feature=raw;
    }
  }
  private async discoverProductBundle(raw:string){
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
  private async queryUi(sql:string){
    await this.page.goto(`/projects/${this.vars.project}/db/${this.vars.connection}`);
    for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean)){
      await this.page.getByTestId('sql-editor').fill(statement+';');
      const waiting=this.page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===`/db-connections/${this.vars.connection}/query`);
      await this.page.getByTestId('sql-run').click();const response=await waiting;this.check(response.ok()).toBe(true);const result=await response.json();this.vars.dbRows=result.rows??[];this.check(Array.isArray(this.vars.dbRows)).toBe(true);
      await this.check(this.page.getByTestId('sql-execution-state')).toHaveText('completed');
    }
  }
  private async targetLogin(){
    if(!this.target)this.target=this.tracker.wrapPage(await this.context.newPage());
    await this.target.goto(this.targetUrl);
    if(await this.target.getByTestId('logout').isVisible())await this.target.getByTestId('logout').click();
    await this.target.getByTestId('login-username').fill('scenario_user');
    const password=process.env.WB_TARGET_PASSWORD;if(!password)throw new Error('WB_TARGET_PASSWORD required for real fixture application login');
    await this.target.getByTestId('login-password').fill(password);await this.target.getByTestId('login-submit').click();
    await this.check(this.target.getByTestId('account-role')).toBeVisible();this.vars.loggedInRole=await this.target.getByTestId('account-role').innerText();
  }
  private async browser(){
    const session=await this.request('/browser-sessions',{projectId:this.vars.project,workspaceRef:process.env.WB_WORKSPACE_REF,targetUrl:this.targetUrl},[200,201]);
    this.check(typeof session.id).toBe('string');this.check(typeof session.playwrightEndpoint).toBe('string');
    this.vars.session=session.id;
    session.sessionId=session.id;
    this.remote=await chromium.connect(String(session.playwrightEndpoint));
    const attachment=session as Attachment;this.check(typeof attachment.contextRef).toBe('string');this.check(typeof attachment.pageId).toBe('string');
    this.target=this.tracker.wrapPage(await resolveManagedPage(this.remote,attachment),attachment);await this.queryUi(fixtureSql+" UPDATE test_accounts SET role_code='B' WHERE username='scenario_user';");await this.targetLogin();
    await this.page.goto(`/projects/${this.vars.project}/browser/${session.id}`);
    await this.check(this.page.getByTestId('browser-canvas')).toBeVisible();
  }
  private async humanInput(text:string){
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
  private async humanActions(){
    await this.page.getByTestId('browser-url').fill(this.targetUrl);await this.page.getByTestId('browser-url').press('Enter');
    const input='recorded-'+this.vars.project;await this.humanInput(input);
    await this.page.getByTestId('record-locator').fill('testId=document-content');
    await this.page.getByTestId('record-assertion-type').selectOption('value');
    await this.page.getByTestId('record-expected').fill(input);await this.page.getByTestId('record-add-assertion').click();
  }
  private repoState(){
    const repo=process.env.WB_TARGET_REPO;if(!repo)throw new Error('WB_TARGET_REPO dedicated fixture repo required; tests never push');
    const files=execFileSync('git',['-C',repo,'ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean).sort();
    const head=execFileSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
    this.vars.targetCommit=head;
    return JSON.stringify({head,files:files.map(f=>[f,sha(readFileSync(resolve(repo,f)))])});
  }
  private async evidence(){
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
