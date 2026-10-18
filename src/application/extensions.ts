import { randomUUID,createHash } from 'node:crypto';
import type { Core } from './core.ts';
import { parseTypeScript } from '../domain/parsers.ts';
import {projectSources} from '../domain/project-sources.ts';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
function error(statusCode:number,code:string,message:string):never {throw Object.assign(new Error(message),{statusCode,code});}
export function createExtensions(input:{core:Core;generation:any;git:any;workspace:any;emit:(event:any)=>void;executeTargetCi?:(requirementId:string,body:any)=>Promise<any>}) {
  const {core,generation,git,workspace,emit}=input,store=core.store;
  const one=async(sql:string,params:any[])=>{const row=(await store.all(sql,params))[0];if(!row)error(404,'NOT_FOUND','Resource does not exist');return row;};
  const phase=(r:any,stage:string)=>{if(r.stage!==stage)error(409,'ARTIFACT_LOCKED_IN_STAGE','此階段不可修改該產物');};
  const project=(id:string)=>one('SELECT * FROM projects WHERE id=?',[id]);
  function selectedProject(r:any,id?:string){const selected=r.projects.find((p:any)=>p.id===(id??r.projectId));if(!selected)error(400,'PROJECT_REQUIRED','Select a project linked to this requirement');return selected;}
  async function current(id:string,featureId?:string){const r=await core.getRequirement(id,featureId);const s=(await store.all("SELECT * FROM baselines WHERE feature_id=? AND kind='source' AND valid=1 ORDER BY rowid DESC LIMIT 1",[r.featureId]))[0];if(s&&hash(s.manifest_json)!==s.sha256)error(409,'SOURCE_BASELINE_INVALID','Source baseline hash differs');const value=s?JSON.parse(s.manifest_json):null;return {...r,sourceBaseline:value?{...value,projects:projectSources(value,r.projects.map(p=>p.id))}:null};}
  const sources=async(r:any)=>store.all('SELECT c.id sourceCaseId,c.case_key caseId,c.scenario_id scenarioEntityId,s.scenario_key scenarioId,sv.source_line scenarioLine FROM source_cases c JOIN scenarios s ON s.id=c.scenario_id JOIN scenario_versions sv ON sv.gherkin_version_id=c.gherkin_version_id AND sv.scenario_id=c.scenario_id WHERE c.gherkin_version_id=? AND s.requirement_id=? ORDER BY sv.ordinal,c.row_ordinal',[r.confirmations.gherkin?.versionId,r.id]);
  function suppliedSources(r:any,body:any) {
    for(const kind of ['gherkin','sd'])for(const [suffix,field] of [['VersionId','versionId'],['Sha256','rawSha256'],['Hash','rawSha256']]) {
      const key=kind+suffix;
      if(body[key]!==undefined&&body[key]!==r.documents[kind]?.[field])error(409,'VERSION_HASH_MISMATCH',`${key} does not match the current document version/hash`);
    }
    if(body.sourceGherkinVersionId!==undefined&&body.sourceGherkinVersionId!==r.documents.gherkin?.versionId)
      error(409,'VERSION_HASH_MISMATCH','Source Gherkin version does not match the current document');
  }
  function confirmed(r:any,kind:'gherkin'|'sd') {
    const c=r.confirmations[kind],d=r.documents[kind];
    if(!c||c.versionId!==d?.versionId||c.rawSha256!==d?.rawSha256)error(409,'WORKFLOW_GATE_NOT_MET',`Confirm the current ${kind} version/hash first`);
    return c;
  }
  function jobAssertions(r:any,artifact:'sd'|'spec',body:any,needsSd:boolean) {
    suppliedSources(r,body);const g=confirmed(r,'gherkin'),s=needsSd?confirmed(r,'sd'):undefined;
    const versionId=r.documents[artifact]?.versionId??null;
    for(const key of ['expectedCurrentVersionId','baseVersionId'])if(body[key]!==undefined&&body[key]!==versionId)
      error(409,'VERSION_CONFLICT','The requested document head has changed');
    return {expectedCurrentVersionId:versionId,expectedConfirmedGherkinVersionId:g.versionId,...(s?{expectedConfirmedSdVersionId:s.versionId}:{})};
  }
  function sourceFields(r:any) {
    return {schemaVersion:2,sourceGherkinVersionId:r.confirmations.gherkin.versionId,gherkinSha256:r.confirmations.gherkin.rawSha256,sdVersionId:r.confirmations.sd.versionId,sdSha256:r.confirmations.sd.rawSha256};
  }
  function sourceMapping(mapping:any,available:any[]) {
    const row=available.find(c=>mapping.sourceCaseId?mapping.sourceCaseId===c.sourceCaseId:(mapping.scenarioId===c.scenarioId||mapping.scenarioId===c.scenarioEntityId)&&mapping.caseId===c.caseId);
    if(!row||mapping.scenarioId!==undefined&&![row.scenarioId,row.scenarioEntityId].includes(mapping.scenarioId)||mapping.caseId!==undefined&&mapping.caseId!==row.caseId)
      error(422,'MAPPING_INVALID',`Mapping ${mapping.testKey??''} references a nonexistent or inconsistent source case`);
    return row;
  }
  function casesFromMappings(mappings:any[],available:any[],rawText:string,original:any[]=[]) {
    const declarations=parseTypeScript(rawText,'generated.spec.ts',true).tests;
    return mappings.map(mapping=>{
      const row=sourceMapping(mapping,available),prior=original.find(c=>c.testKey===mapping.testKey&&(c.sourceCaseId===row.sourceCaseId||c.scenarioId===row.scenarioId&&c.caseId===row.caseId));
      const sourceSteps=prior?.steps?.map((step:any)=>{const {generatedLine,...rest}=step;return {...rest,...(generatedLine?{sourceSkeletonGeneratedLine:generatedLine}:{})};});
      return {...prior,...row,testKey:mapping.testKey,generatedLine:declarations.find(t=>t.testKey===mapping.testKey)?.line,...(sourceSteps?{steps:sourceSteps}:{})};
    });
  }
  function sealManifest(base:any,stage:'SKELETON'|'COMPLETION_DRAFT'|'COMPLETED',rawText:string,files:{path:string;rawText:string}[],extra:any={}) {
    const manifest:any={...base,...extra,stage,artifactStage:stage,completionStatus:stage==='COMPLETED'?'COMPLETED':'PENDING',productE2E:'NOT_RUN',specSha256:hash(rawText),bundleFiles:files,
      fileHashes:Object.fromEntries(files.map(f=>[f.path,hash(f.rawText)])),pendingSlots:stage==='COMPLETED'?[]:stage==='SKELETON'?(base.pendingSlots??[]):(extra.checks?.diagnostics??[]).filter((d:any)=>/Unresolved|Unimplemented|completion slot|Empty test or step/i.test(d.reason))};
    delete manifest.manifestSha256;
    manifest.manifestSha256=hash(JSON.stringify(manifest));return manifest;
  }
  function skeletonSources(r:any,skeleton:any) {
    const m=skeleton.manifest??{},g=r.confirmations.gherkin,s=r.confirmations.sd;
    if(skeleton.sourceGherkinVersionId!==g.versionId||m.sourceGherkinVersionId!==undefined&&m.sourceGherkinVersionId!==g.versionId||m.gherkinSha256!==undefined&&m.gherkinSha256!==g.rawSha256)
      error(409,'SOURCE_VERSION_MISMATCH','Skeleton does not reference the currently confirmed Gherkin version/hash');
    if(m.sdSha256!==s.rawSha256||(m.sdVersionId?m.sdVersionId!==s.versionId:Number(r.documents.sd.versionNo)>1))
      error(409,'REGENERATE_SKELETON_REQUIRED','Regenerate the skeleton for the currently confirmed SD version/hash');
    if(Number(m.schemaVersion??0)>=2&&(m.sourceGherkinVersionId!==g.versionId||m.gherkinSha256!==g.rawSha256||m.sdVersionId!==s.versionId))
      error(409,'SOURCE_VERSION_MISMATCH','Skeleton provenance does not match the confirmed document versions/hashes');
  }
  async function generated(id:string,body:any={}) {
    const r=await current(id,body.featureId);phase(r,'TESTS');
    const assertions=jobAssertions(r,'spec',body,true),available=await sources(r);
    const bundle=await generation.generator.generate({requirementKey:r.requirementKey,featureKey:r.featureKey,sd:r.documents.sd.rawText,feature:r.documents.gherkin.rawText,stepDefinitions:body.stepDefinitions??[],sourceCases:available});
    const manifest=sealManifest({...bundle.manifest,...sourceFields(r)},'SKELETON',bundle.rawText,bundle.files,{specPath:bundle.specPath,cases:casesFromMappings(bundle.manifest.mappings,available,bundle.rawText,bundle.manifest.cases)});
    const version=await core.saveVersion(r.documents.spec.id,{...assertions,rawText:bundle.rawText,sourceGherkinVersionId:r.confirmations.gherkin.versionId,testStage:'SKELETON',manifest,executionConfig:{completionContext:{stepDefinitions:body.stepDefinitions??[],context:body.context??{}}}});
    emit({type:'test.skeletonGenerated',projectId:r.projectId,requirementId:id,featureId:r.featureId,documentVersionId:version.versionId,payload:{testStage:'SKELETON'}});return {...version,...bundle,manifest,testStage:'SKELETON'};
  }
  return {
    current,project,selectedProject,generated,
    async beginDevelopment(id:string,featureId?:string){
      const r=await current(id,featureId),v=r.documents.spec;if(v?.testStage!=='COMPLETED')error(409,'TESTS_PENDING_COMPLETION','Tests are pending completion');
      const g=confirmed(r,'gherkin'),s=confirmed(r,'sd'),expectations={featureId:r.featureId,expectedSpecVersionId:v.versionId!,expectedSpecSha256:v.rawSha256!,expectedConfirmedGherkinVersionId:g.versionId,expectedConfirmedGherkinSha256:g.rawSha256,expectedConfirmedSdVersionId:s.versionId,expectedConfirmedSdSha256:s.rawSha256};
      const manifest={...v.manifest,specPath:v.manifest?.specPath??v.fileName};
      const receipt=await generation.generator.validateCompletion({rawText:v.rawText,files:v.manifest?.bundleFiles,manifest});if(!receipt.passed)throw Object.assign(new Error('Completed test bundle did not pass typecheck/discovery'),{statusCode:422,code:'COMPLETION_CHECKS_FAILED',diagnostics:receipt.diagnostics});
      return core.startDevelopment(id,expectations);
    },
    async generateSd(id:string,body:any={}){const r=await current(id,body.featureId);phase(r,'SD');const assertions=jobAssertions(r,'sd',body,false),gherkin=r.confirmations.gherkin,sd=r.documents.sd;const result=await generation.llm.generateSd({terminalContext:{projectId:r.projectId,requirementId:id,featureId:r.featureId},gherkin:r.documents.gherkin.rawText,context:{sourceGherkin:{versionId:gherkin.versionId,sha256:gherkin.rawSha256},currentSd:sd.rawText,currentSdMetadata:sd.versionId?{versionId:sd.versionId,sha256:sd.rawSha256}:null,providedContext:body.context},agent:body.agent});if(result.status==='needs_input')return result;const v=await core.saveVersion(sd.id,{...assertions,rawText:result.rawText,sourceGherkinVersionId:gherkin.versionId});return {...result,...v};},
    async complete(id:string,body:any={}){
      const r=await current(id,body.featureId);phase(r,'TESTS');const spec=r.documents.spec;
      const assertions=jobAssertions(r,'spec',body,true);
      if(body.skeletonVersionId!==undefined&&body.sourceSkeletonVersionId!==undefined&&body.skeletonVersionId!==body.sourceSkeletonVersionId)error(409,'VERSION_HASH_MISMATCH','Conflicting skeleton version IDs');
      const versionId=body.skeletonVersionId??body.sourceSkeletonVersionId??(spec.testStage==='SKELETON'?spec.versionId:spec.sourceSkeletonVersionId);
      if(!versionId)error(409,'SKELETON_REQUIRED','Generate a skeleton before completion');
      const skeleton=await core.getVersion(spec.id,versionId);
      if(skeleton.testStage!=='SKELETON')error(409,'SKELETON_REQUIRED','Source must be an immutable skeleton');
      for(const key of ['skeletonSha256','skeletonHash','sourceSkeletonSha256'])if(body[key]!==undefined&&body[key]!==skeleton.rawSha256)error(409,'VERSION_HASH_MISMATCH','Skeleton hash does not match');
      skeletonSources(r,skeleton);const available=await sources(r);
      const targetConnections=(await store.all('SELECT c.id,c.project_id,c.environment_label,c.app_base_url FROM target_connections c JOIN requirement_projects rp ON rp.project_id=c.project_id WHERE rp.requirement_id=?',[id])).map(c=>({id:c.id,projectId:c.project_id,environmentLabel:c.environment_label,appBaseUrl:c.app_base_url}));
      const result=await generation.llm.complete({terminalContext:{projectId:r.projectId,requirementId:id,featureId:r.featureId},gherkin:r.documents.gherkin.rawText,sd:r.documents.sd.rawText,skeleton:skeleton.rawText,skeletonManifest:skeleton.manifest,context:{...skeleton.executionConfig?.completionContext,...body.context,targetConnections,manifest:skeleton.manifest,gherkinVersionId:r.confirmations.gherkin?.versionId},agent:body.agent});
      if(result.status==='needs_input'){emit({type:'test.needsInput',projectId:r.projectId,requirementId:id,featureId:r.featureId,payload:{questions:result.questions}});return result;}
      const rawText=String(result.rawText??''),members=new Map<string,string>((skeleton.manifest?.bundleFiles??[]).map((f:any)=>[f.path,f.rawText]));
      const bundleDirectory=skeleton.manifest?.bundleDirectory;
      for(const file of body.context?.files??[]){
        if(!file||typeof file.path!=='string'||typeof file.rawText!=='string'||!bundleDirectory||file.path.startsWith('/')||file.path.includes('\\')||file.path.split('/').some((part:string)=>!part||part==='.'||part==='..'||part==='.git'||part==='node_modules')||!(/\.(?:[cm]?[jt]s)$/.test(file.path))||Buffer.byteLength(file.rawText)>2*1024*1024)error(422,'BUNDLE_INVALID','Context helper files require safe relative TypeScript or JavaScript paths inside the feature bundle');
        const path=`${bundleDirectory}/${file.path}`;
        if(!path.startsWith(bundleDirectory+'/'))error(422,'BUNDLE_SCOPE_INVALID','Context helper files must remain inside the selected feature directory');
        if(members.has(path)&&members.get(path)!==file.rawText)error(422,'BUNDLE_INVALID','A context helper cannot replace an existing skeleton bundle file');
        members.set(path,file.rawText);
      }
      for(const file of result.files??[]){if(typeof file.path!=='string'||typeof file.rawText!=='string')error(422,'BUNDLE_INVALID','Completion files require path and rawText');if(skeleton.manifest?.bundleDirectory&&!file.path.startsWith(skeleton.manifest.bundleDirectory+'/'))error(422,'BUNDLE_SCOPE_INVALID','Completion files must remain in the selected feature directory');if((file.path.endsWith('.feature')||file.path.endsWith('.sd.md'))&&members.has(file.path)&&members.get(file.path)!==file.rawText)error(422,file.path.endsWith('.feature')?'APPROVED_GHERKIN_CHANGED':'APPROVED_SD_CHANGED','LLM completion cannot modify approved source documents');members.set(file.path,file.rawText);}
      members.set(skeleton.manifest?.specPath??'generated.spec.ts',rawText);const files=[...members].map(([path,rawText])=>({path,rawText}));
      const mappings=(skeleton.manifest?.mappings??[]).map((m:any)=>({...m}));
      if(!mappings.length)error(422,'MAPPING_INVALID','Skeleton requires immutable source mappings');
      for(const proposed of result.mappings??[]){
        const source=sourceMapping(proposed,available),original=mappings.filter((m:any)=>m.testKey===proposed.testKey);
        if(original.length){if(!original.some((m:any)=>sourceMapping(m,available).sourceCaseId===source.sourceCaseId))error(422,'LLM_ACCEPTANCE_CHANGED','LLM completion cannot change an existing test/source mapping');}
        else mappings.push({...proposed});
      }
      const base={...skeleton.manifest,...sourceFields(r),sourceSkeletonVersionId:skeleton.versionId,sourceSkeletonSha256:skeleton.rawSha256,sourceSkeletonManifestSha256:skeleton.manifestSha256,
        mappings,cases:casesFromMappings(mappings,available,rawText,skeleton.manifest?.cases),specPath:skeleton.manifest?.specPath??'generated.spec.ts'};
      let manifest=sealManifest(base,'COMPLETION_DRAFT',rawText,files);
      let checks:any;
      try{checks=await generation.generator.validateCompletion({rawText,files,manifest});if(!checks.passed)throw new Error('Completion checks did not pass');}catch(e){
        checks??={passed:false,diagnostics:(e as any).diagnostics??[{file:base.specPath,line:1,column:1,reason:String((e as Error).message)}]};
        manifest=sealManifest(base,'COMPLETION_DRAFT',rawText,files,{checks});
        const draft=await core.saveVersion(spec.id,{...assertions,rawText,sourceGherkinVersionId:r.confirmations.gherkin.versionId,testStage:'COMPLETION_DRAFT',sourceSkeletonVersionId:skeleton.versionId,manifest});
        return {...draft,status:'needs_input',testStage:'COMPLETION_DRAFT',questions:checks.diagnostics?.length?checks.diagnostics.map((d:any)=>d.reason):[String((e as Error).message)]};
      }
      manifest=sealManifest(base,'COMPLETED',rawText,files,{checks});const v=await core.saveVersion(spec.id,{...assertions,rawText,sourceGherkinVersionId:r.confirmations.gherkin.versionId,testStage:'COMPLETED',sourceSkeletonVersionId:skeleton.versionId,manifest});
      emit({type:'test.completionSaved',projectId:r.projectId,requirementId:id,featureId:r.featureId,documentVersionId:v.versionId,payload:{testStage:'COMPLETED'}});return {...v,status:'completed',testStage:'COMPLETED',questions:[],checks};
    },
    async exportBundle(id:string,versionId:string,featureId?:string){const r=await current(id,featureId),v=await core.getVersion(r.documents.spec.id,versionId??r.documents.spec.versionId!);return {specPath:v.manifest?.specPath??r.documents.spec.fileName,files:v.manifest?.bundleFiles??[{path:r.documents.spec.fileName,rawText:v.rawText}]};},
    async source(id:string,body?:any,featureId?:string,projectId?:string,filePath?:string){const r=await current(id,body?.featureId??featureId),p=selectedProject(r,body?.projectId??projectId);if(body){phase(r,'IMPLEMENTATION');await store.batch([{sql:"UPDATE baselines SET valid=0 WHERE feature_id=? AND kind='source'",params:[r.featureId]},{sql:"UPDATE runs SET status='INVALID' WHERE feature_id=?",params:[r.featureId]}]);return workspace.saveSource(p.workspaceRef,String(body.rawText??''),body.path);}return workspace.readSource(p.workspaceRef,filePath);},
    async pinSource(id:string,body:any){
      const r=await current(id,body.featureId);if(!['IMPLEMENTATION','VERIFICATION','VERIFIED'].includes(r.stage))error(409,'WORKFLOW_GATE_NOT_MET','Source can be fixed after tests are complete');
      const previous=(await store.all("SELECT * FROM baselines WHERE feature_id=? AND kind='source' AND valid=1 ORDER BY rowid DESC LIMIT 1",[r.featureId]))[0];
      const requested=body.projects??(r.projects.length===1?[{projectId:r.projects[0].id,sourceRef:body.sourceRef}]:null);
      if(!Array.isArray(requested)||requested.length!==r.projects.length||!requested.length||new Set(requested.map((p:any)=>p.projectId)).size!==requested.length)error(422,'PROJECT_SOURCES_REQUIRED','Pin a source revision for every linked project');
      const projects=await Promise.all(requested.map(async(item:any)=>{const p=selectedProject(r,item.projectId);return {projectId:p.id,workspaceRef:p.workspaceRef,...await workspace.resolveSource(String(item.sourceRef??''),p.workspaceRef,p.id)};}));projects.sort((a,b)=>a.projectId.localeCompare(b.projectId));
      const resolved={projects,...(projects.length===1?projects[0]:{})},manifest=JSON.stringify(resolved),baselineId=randomUUID();
      const previousValue=previous?JSON.parse(previous.manifest_json):null,previousProjects=previousValue?projectSources(previousValue,r.projects.map(p=>p.id)):[];
      const changed=projects.length!==previousProjects.length||projects.some(p=>!previousProjects.some((old:any)=>old.projectId===p.projectId&&old.resolvedCommit===p.resolvedCommit));
      const commands:any[]=[{sql:'SELECT id FROM features WHERE id=? AND stage=?',params:[r.featureId,r.stage],mode:'all',expectRows:1},
        {sql:"SELECT id FROM baselines WHERE feature_id=? AND kind='source' AND valid=1"+(previous?' AND id=?':''),params:previous?[r.featureId,previous.id]:[r.featureId],mode:'all',expectRows:previous?1:0},
        {sql:"UPDATE baselines SET valid=0 WHERE feature_id=? AND kind='source'",params:[r.featureId]},
        {sql:'INSERT INTO baselines(id,requirement_id,feature_id,kind,manifest_json,sha256,valid) VALUES (?,?,?,?,?,?,1)',params:[baselineId,id,r.featureId,'source',manifest,hash(manifest)]}];
      if(changed){commands.push({sql:"UPDATE runs SET status='INVALID' WHERE feature_id=?",params:[r.featureId]});
        if(['VERIFICATION','VERIFIED'].includes(r.stage))commands.push({sql:"UPDATE features SET stage='IMPLEMENTATION' WHERE id=? AND stage=?",params:[r.featureId,r.stage],expectChanges:1});}
      await store.batch(commands);return {...resolved,id:baselineId};
    },
    async script(body:any,purpose:'recording'|'integration'){
      let sourceGherkinVersionId=body.sourceGherkinVersionId;
      const mappings:any[]=[];
      if(body.requirementId&&body.sourceCases?.length){sourceGherkinVersionId=body.sourceCases[0].gherkinVersionId;const tests=parseTypeScript(body.rawText,'recording.spec.ts',false).tests;for(const s of body.sourceCases)for(const test of tests.filter(t=>!s.testKey||s.testKey===t.testKey))mappings.push({...s,testKey:test.testKey});}
      const result=await core.createScript({projectId:body.projectId,requirementId:body.requirementId??null,purpose,rawText:body.rawText,actions:body.actions??[],executionConfig:body.executionConfig??{},sourceGherkinVersionId,mappings:mappings.filter(m=>m.testKey),fileName:body.fileName});
      emit({type:'recording.saved',...(body.projectId?{projectId:body.projectId}:{}),documentVersionId:result.versionId,payload:{id:result.id}});return result;
    },
    async scriptHead(id:string){const d=await one('SELECT d.*,h.version_id FROM documents d JOIN document_heads h ON h.document_id=d.id WHERE d.id=? AND d.deleted_at IS NULL',[id]);return core.getVersion(id,d.version_id);},
    async snapshot(body:any){const r=await current(body.requirementId,body.featureId),selected=selectedProject(r,body.projectId);phase(r,'TESTS');const assertions=jobAssertions(r,'spec',body,true);const snap=await git.readSnapshot({repo:body.repo??body.repositoryUrl,branch:body.branch??body.branchRef,commit:body.commit??body.commitSha,path:body.path??body.filePath});const v=await core.saveVersion(r.documents.spec.id,{...assertions,rawText:snap.rawText,sourceGherkinVersionId:r.confirmations.gherkin.versionId,manifest:body.manifest});await store.run('INSERT INTO git_snapshots(spec_version_id,project_id,repository_url,branch_ref,commit_sha,file_path) VALUES (?,?,?,?,?,?)',[v.versionId,selected.id,snap.repo??body.repo??body.repositoryUrl,snap.branch??body.branch??body.branchRef,snap.commit??snap.commitSha,snap.path??snap.filePath??body.path??body.filePath]);return {...v,...snap};},
    async saveGit(id:string,featureId?:string,projectId?:string){const r=await current(id,featureId),selected=selectedProject(r,projectId),p=await project(selected.id);if(!r.documents.spec.versionId)error(409,'NO_TEST_VERSION','No spec version to save');const bundle=await this.exportBundle(id,r.documents.spec.versionId,r.featureId);const receipt=await git.save({repo:p.workspace_ref,files:bundle.files,message:`Save ${r.requirementKey} test version ${r.documents.spec.versionId}`});const v=r.documents.spec;await store.run('INSERT INTO git_snapshots(spec_version_id,project_id,repository_url,branch_ref,commit_sha,file_path) VALUES (?,?,?,?,?,?) ON CONFLICT(spec_version_id,project_id) DO UPDATE SET repository_url=excluded.repository_url,branch_ref=excluded.branch_ref,commit_sha=excluded.commit_sha,file_path=excluded.file_path',[v.versionId,p.id,p.workspace_ref,receipt.branch??'HEAD',receipt.commit??receipt.commitSha,bundle.specPath]);return receipt;},
    async runCi(id:string,featureId?:string,projectId?:string){
      let r=await current(id,featureId);const selected=selectedProject(r,projectId);
      const snapshot=await one('SELECT * FROM git_snapshots WHERE spec_version_id=? AND project_id=?',[r.documents.spec.versionId,selected.id]);
      if(!r.baseline&&r.stage==='TESTS'){await this.beginDevelopment(id,r.featureId);r=await current(id,r.featureId);}
      if(!r.baseline)error(409,'BASELINE_REQUIRED','Tests baseline is required');
      if(!input.executeTargetCi)error(503,'CI_UNAVAILABLE','CI executor is not configured');
      const projects=r.sourceBaseline?.projects?.map((p:any)=>({projectId:p.projectId,sourceRef:p.projectId===selected.id?snapshot.commit_sha:p.sourceRef}));
      return input.executeTargetCi(id,{featureId:r.featureId,projectId:selected.id,projects,testBaselineId:r.baseline.id,testBaselineHash:r.baseline.sha256,sourceRef:snapshot.commit_sha,selection:{mode:'ALL_REQUIRED',sourceCaseIds:[]},executor:'target_ci'});
    }

  };
}
