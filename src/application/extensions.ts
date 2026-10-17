import { randomUUID,createHash } from 'node:crypto';
import type { Core } from './core.js';
import { parseTypeScript } from '../domain/parsers.js';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
function error(statusCode:number,code:string,message:string):never {throw Object.assign(new Error(message),{statusCode,code});}
export function createExtensions(input:{core:Core;generation:any;git:any;workspace:any;emit:(event:any)=>void;executeTargetCi?:(requirementId:string,body:any)=>Promise<any>}) {
  const {core,generation,git,workspace,emit}=input,store=core.store;
  const one=async(sql:string,params:any[])=>{const row=(await store.all(sql,params))[0];if(!row)error(404,'NOT_FOUND','Resource does not exist');return row;};
  const phase=(r:any,stage:string)=>{if(r.stage!==stage)error(409,'ARTIFACT_LOCKED_IN_STAGE','此階段不可修改該產物');};
  const project=(id:string)=>one('SELECT * FROM projects WHERE id=?',[id]);
  async function current(id:string){const r=await core.getRequirement(id);const s=(await store.all("SELECT * FROM baselines WHERE requirement_id=? AND kind='source' AND valid=1 ORDER BY rowid DESC LIMIT 1",[id]))[0];return {...r,sourceBaseline:s?JSON.parse(s.manifest_json):null};}
  const sources=async(r:any)=>store.all('SELECT c.id sourceCaseId,c.case_key caseId,s.scenario_key scenarioId,c.*,s.* FROM source_cases c JOIN scenarios s ON s.id=c.scenario_id WHERE c.gherkin_version_id=? ORDER BY s.scenario_key,c.case_key',[r.confirmations.gherkin?.versionId]);
  async function generated(id:string,body:any) {
    const r=await current(id);phase(r,'TESTS');
    if(!r.confirmations.gherkin||!r.confirmations.sd)error(409,'WORKFLOW_GATE_NOT_MET','Confirm Gherkin and SD first');
    const bundle=await generation.generator.generate({feature:r.documents.gherkin.rawText,stepDefinitions:body.stepDefinitions??[],sourceCases:await sources(r)});
    const manifest={...bundle.manifest,stage:'SKELETON',sourceGherkinVersionId:r.confirmations.gherkin.versionId,gherkinSha256:r.confirmations.gherkin.rawSha256,sdSha256:r.confirmations.sd.rawSha256,specSha256:hash(bundle.rawText),bundleFiles:bundle.files,specPath:bundle.specPath};
    const version=await core.saveVersion(r.documents.spec.id,{rawText:bundle.rawText,sourceGherkinVersionId:r.confirmations.gherkin.versionId,testStage:'SKELETON',manifest,executionConfig:{completionContext:{stepDefinitions:body.stepDefinitions??[],context:body.context??{}}}});
    emit({type:'test.skeletonGenerated',projectId:r.projectId,requirementId:id,documentVersionId:version.versionId,payload:{testStage:'SKELETON'}});return {...version,...bundle,manifest,testStage:'SKELETON'};
  }
  return {
    current,project,generated,
    async beginDevelopment(id:string){const r=await current(id);const v=r.documents.spec;if(v?.testStage!=='COMPLETED')error(409,'TESTS_PENDING_COMPLETION','Tests are pending completion');const manifest={...v.manifest,specPath:v.manifest?.specPath??v.fileName};const receipt=await generation.generator.validateCompletion({rawText:v.rawText,files:v.manifest?.bundleFiles,manifest});if(!receipt.passed)throw Object.assign(new Error('Completed test bundle did not pass typecheck/discovery'),{statusCode:422,code:'COMPLETION_CHECKS_FAILED',diagnostics:receipt.diagnostics});return core.startDevelopment(id);},
    async generateSd(id:string,body:any){const r=await current(id);phase(r,'SD');if(!r.confirmations.gherkin)error(409,'WORKFLOW_GATE_NOT_MET','Confirm Gherkin first');const result=await generation.llm.generateSd({gherkin:r.documents.gherkin.rawText,context:body.context});if(result.status==='needs_input')return result;const v=await core.saveVersion(r.documents.sd.id,{rawText:result.rawText,sourceGherkinVersionId:r.confirmations.gherkin.versionId});return {...result,...v};},
    async complete(id:string,body:any){
      const r=await current(id);phase(r,'TESTS');const spec=r.documents.spec;
      const versionId=body.skeletonVersionId??(spec.testStage==='SKELETON'?spec.versionId:spec.sourceSkeletonVersionId);
      if(!versionId)error(409,'SKELETON_REQUIRED','Generate a skeleton before completion');
      const skeleton=await core.getVersion(spec.id,versionId);
      if(skeleton.testStage!=='SKELETON')error(409,'SKELETON_REQUIRED','Source must be an immutable skeleton');
      if(body.skeletonSha256&&body.skeletonSha256!==skeleton.rawSha256||body.skeletonHash&&body.skeletonHash!==skeleton.rawSha256)error(409,'VERSION_HASH_MISMATCH','Skeleton hash does not match');
      const targetConnections=(await store.all('SELECT id,environment_label,app_base_url FROM target_connections WHERE project_id=?',[r.projectId])).map(c=>({id:c.id,environmentLabel:c.environment_label,appBaseUrl:c.app_base_url}));
      const result=await generation.llm.complete({gherkin:r.documents.gherkin.rawText,sd:r.documents.sd.rawText,skeleton:skeleton.rawText,skeletonManifest:skeleton.manifest,context:{...skeleton.executionConfig?.completionContext,...body.context,targetConnections,manifest:skeleton.manifest,gherkinVersionId:r.confirmations.gherkin?.versionId}});
      if(result.status==='needs_input'){emit({type:'test.needsInput',projectId:r.projectId,requirementId:id,payload:{questions:result.questions}});return result;}
      const rawText=String(result.rawText??''),members=new Map<string,string>((skeleton.manifest?.bundleFiles??[]).map((f:any)=>[f.path,f.rawText]));
      for(const file of result.files??[]){if(typeof file.path!=='string'||typeof file.rawText!=='string')error(422,'BUNDLE_INVALID','Completion files require path and rawText');if(file.path.endsWith('.feature')&&members.has(file.path)&&members.get(file.path)!==file.rawText)error(422,'APPROVED_GHERKIN_CHANGED','LLM completion cannot modify the approved feature copy');members.set(file.path,file.rawText);}
      members.set(skeleton.manifest?.specPath??'generated.spec.ts',rawText);const files=[...members].map(([path,rawText])=>({path,rawText}));
      const manifest={...skeleton.manifest,stage:'COMPLETION_DRAFT',specSha256:hash(rawText),sourceSkeletonVersionId:skeleton.versionId,sourceSkeletonSha256:skeleton.rawSha256,sourceSkeletonManifestSha256:skeleton.manifestSha256,bundleFiles:files};
      let checks:any;
      try{checks=await generation.generator.validateCompletion({rawText,files,manifest});if(!checks.passed)throw new Error('Completion checks did not pass');}catch(e){const draft=await core.saveVersion(spec.id,{rawText,sourceGherkinVersionId:r.confirmations.gherkin?.versionId,testStage:'COMPLETION_DRAFT',sourceSkeletonVersionId:skeleton.versionId,manifest});return {...draft,status:'needs_input',testStage:'COMPLETION_DRAFT',questions:[String((e as Error).message)]};}
      manifest.stage='COMPLETED';const v=await core.saveVersion(spec.id,{rawText,sourceGherkinVersionId:r.confirmations.gherkin?.versionId,testStage:'COMPLETED',sourceSkeletonVersionId:skeleton.versionId,manifest:{...manifest,checks}});
      emit({type:'test.completionSaved',projectId:r.projectId,requirementId:id,documentVersionId:v.versionId,payload:{testStage:'COMPLETED'}});return {...v,status:'completed',testStage:'COMPLETED',questions:[],checks};
    },
    async exportBundle(id:string,versionId:string){const r=await current(id),v=await core.getVersion(r.documents.spec.id,versionId??r.documents.spec.versionId!);return {specPath:v.manifest?.specPath??r.documents.spec.fileName,files:v.manifest?.bundleFiles??[{path:r.documents.spec.fileName,rawText:v.rawText}]};},
    async source(id:string,body?:any){const r=await current(id);if(body){phase(r,'IMPLEMENTATION');await store.batch([{sql:"UPDATE baselines SET valid=0 WHERE requirement_id=? AND kind='source'",params:[id]},{sql:"UPDATE runs SET status='INVALID' WHERE requirement_id=?",params:[id]}]);return workspace.saveSource(r.projectId,String(body.rawText??''));}return workspace.readSource(r.projectId);},
    async pinSource(id:string,body:any){const r=await current(id);if(!['IMPLEMENTATION','VERIFICATION'].includes(r.stage))error(409,'WORKFLOW_GATE_NOT_MET','Source can be fixed after tests are complete');const p=await project(r.projectId),resolved=await workspace.resolveSource(String(body.sourceRef??''),p.workspace_ref),manifest=JSON.stringify(resolved),baselineId=randomUUID();await store.batch([{sql:"UPDATE baselines SET valid=0 WHERE requirement_id=? AND kind='source'",params:[id]},{sql:'INSERT INTO baselines(id,requirement_id,kind,manifest_json,sha256,valid) VALUES (?,?,?,?,?,1)',params:[baselineId,id,'source',manifest,hash(manifest)]}]);return {...resolved,id:baselineId};},
    async script(body:any,purpose:'recording'|'integration'){
      let sourceGherkinVersionId=body.sourceGherkinVersionId;
      const mappings:any[]=[];
      if(body.requirementId&&body.sourceCases?.length){sourceGherkinVersionId=body.sourceCases[0].gherkinVersionId;const tests=parseTypeScript(body.rawText,'recording.spec.ts',false).tests;for(const s of body.sourceCases)for(const test of tests.filter(t=>!s.testKey||s.testKey===t.testKey))mappings.push({...s,testKey:test.testKey});}
      const result=await core.createScript({projectId:body.projectId,requirementId:body.requirementId??null,purpose,rawText:body.rawText,actions:body.actions??[],executionConfig:body.executionConfig??{},sourceGherkinVersionId,mappings:mappings.filter(m=>m.testKey)});
      emit({type:'recording.saved',projectId:body.projectId,documentVersionId:result.versionId,payload:{id:result.id}});return result;
    },
    async scriptHead(id:string){const d=await one('SELECT d.*,h.version_id FROM documents d JOIN document_heads h ON h.document_id=d.id WHERE d.id=?',[id]);return core.getVersion(id,d.version_id);},
    async snapshot(body:any){const r=await current(body.requirementId);phase(r,'TESTS');const snap=await git.readSnapshot({repo:body.repo??body.repositoryUrl,branch:body.branch??body.branchRef,commit:body.commit??body.commitSha,path:body.path??body.filePath});const v=await core.saveVersion(r.documents.spec.id,{rawText:snap.rawText,sourceGherkinVersionId:r.confirmations.gherkin?.versionId,manifest:body.manifest});await store.run('INSERT INTO git_snapshots(spec_version_id,repository_url,branch_ref,commit_sha,file_path) VALUES (?,?,?,?,?)',[v.versionId,snap.repo??body.repo,snap.branch??body.branch,snap.commit??snap.commitSha,body.path]);return {...v,...snap};},
    async saveGit(id:string){const r=await current(id),p=await project(r.projectId);if(!r.documents.spec.versionId)error(409,'NO_TEST_VERSION','No spec version to save');const bundle=await this.exportBundle(id,r.documents.spec.versionId);const receipt=await git.save({repo:p.workspace_ref,files:bundle.files,message:`Save ${r.requirementKey} test version ${r.documents.spec.versionId}`});const v=r.documents.spec;await store.run('INSERT INTO git_snapshots(spec_version_id,repository_url,branch_ref,commit_sha,file_path) VALUES (?,?,?,?,?) ON CONFLICT(spec_version_id) DO UPDATE SET repository_url=excluded.repository_url,branch_ref=excluded.branch_ref,commit_sha=excluded.commit_sha,file_path=excluded.file_path',[v.versionId,p.workspace_ref,receipt.branch??'HEAD',receipt.commit??receipt.commitSha,bundle.specPath]);return receipt;},
    async runCi(id:string){let r=await current(id);const snapshot=await one('SELECT * FROM git_snapshots WHERE spec_version_id=?',[r.documents.spec.versionId]);if(!r.baseline&&r.stage==='TESTS'){await this.beginDevelopment(id);r=await current(id);}if(!r.baseline)error(409,'BASELINE_REQUIRED','Tests baseline is required');if(!input.executeTargetCi)error(503,'CI_UNAVAILABLE','CI executor is not configured');return input.executeTargetCi(id,{testBaselineId:r.baseline.id,testBaselineHash:r.baseline.sha256,sourceRef:snapshot.commit_sha,selection:{mode:'ALL_REQUIRED',sourceCaseIds:[]},executor:'target_ci'});}
  };
}
