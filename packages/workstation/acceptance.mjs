import {readFile} from 'node:fs/promises';
import {id,invariant,safePath,exists,writeJson,identity} from '../contracts/index.mjs';
import {scan,reviewState} from '../spec-toolkit/index.mjs';
import {verifyBundle} from '../spec-toolkit/engine.mjs';
import {artifactDirectory} from './reports.mjs';
import {readFeedback,feedbackLimits} from './feedback.mjs';
import {workflowState,liveWorkflowModules,liveWorkflowSpecSourceDigest} from './workflow-state.mjs';

export const acceptancePath=(requirementId,featureId)=>`spec/${id(requirementId)}/${id(featureId)}/acceptance.json`;
export async function readAcceptance(root,requirementId,featureId){
 const file=await safePath(root,acceptancePath(requirementId,featureId));
 if(!await exists(file))return {schemaVersion:1,items:[]};
 const value=JSON.parse(await readFile(file,'utf8'));
 invariant(value.schemaVersion===1&&Array.isArray(value.items)&&value.items.length<=feedbackLimits.entries&&value.items.every(x=>
  typeof x.id==='string'&&typeof x.runId==='string'&&typeof x.manifestDigest==='string'&&/^[a-f0-9]{64}$/.test(x.manifestDigest)&&x.sourceDigests&&['gherkin','sd','tests'].every(k=>typeof x.sourceDigests[k]==='string'&&/^[a-f0-9]{64}$/.test(x.sourceDigests[k]))&&
  typeof x.reviewer==='string'&&x.reviewer.trim()&&typeof x.message==='string'&&x.message.length<=feedbackLimits.message&&Number.isFinite(Date.parse(x.createdAt))),
  'INVALID_ACCEPTANCE','人工驗收紀錄格式無效。');
 return value;
}
export async function saveAcceptance(root,input,context,snapshot){
 const {store,request,options}=context,key=`${id(input.requirementId)}/${id(input.featureId)}`;
 const data=await scan(root),feature=data.features.find(f=>f.key===key);invariant(feature,'FEATURE_NOT_FOUND','找不到需求。',404);
 const message=input.message===undefined?'':input.message;
 invariant(typeof message==='string'&&message.length<=feedbackLimits.message,'INVALID_FEEDBACK','驗收意見必須是長度限制內的文字。');
 invariant(typeof snapshot.settings.reviewer==='string'&&snapshot.settings.reviewer.trim(),'REVIEWER_REQUIRED','請先在設定填寫確認者。');
 feature.review=await reviewState(root,feature.requirementId,feature.id);feature.feedback=await readFeedback(root,key);feature.acceptance=await readAcceptance(root,feature.requirementId,feature.id);
 const modules=await liveWorkflowModules(context,snapshot),specSourceDigest=await liveWorkflowSpecSourceDigest(context,snapshot,root),workflow=workflowState(feature,modules,store.runs(request.repositoryId),store.reports(request.repositoryId),data.config.specRepositoryId,store.projection(request.repositoryId),specSourceDigest);
 invariant(['AWAITING_ACCEPTANCE','ACCEPTANCE_PENDING'].includes(workflow.status),'ACCEPTANCE_NOT_READY','需要目前版本的完整通過報告，且尚未完成人工驗收。',409);
 invariant(workflow.latestReport.runId===input.runId&&workflow.latestReport.manifestDigest===input.expectedManifestDigest,'REPORT_CHANGED','報告已變更，請重新檢視後再驗收。',409);
 const directory=await artifactDirectory({home:options.home,store,repositoryId:request.repositoryId,runId:input.runId,reportKey:input.reportKey});
 invariant(identity(await verifyBundle(directory))===input.expectedManifestDigest,'REPORT_CHANGED','報告內容已變更。',409);
 if (workflow.status === 'ACCEPTANCE_PENDING') return { key, acceptance: workflow.acceptance, nextStage: 'VERIFICATION', status: 'ACCEPTANCE_PENDING' };
 const value=feature.acceptance;invariant(value.items.length<feedbackLimits.entries,'ACCEPTANCE_LIMIT','人工驗收紀錄已達上限。');
 const entry={id:request.operationId,runId:input.runId,manifestDigest:input.expectedManifestDigest,sourceDigests:workflow.sourceDigests,reviewer:snapshot.settings.reviewer,message,createdAt:new Date().toISOString(),requiresCheckpoint:true};
 value.items.push(entry);await writeJson(await safePath(root,acceptancePath(feature.requirementId,feature.id)),value);
 return {key,acceptance:entry,nextStage:'VERIFICATION',status:'ACCEPTANCE_PENDING'};
}
