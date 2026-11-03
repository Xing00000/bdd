import { readFile } from 'node:fs/promises';
import { id, invariant, safePath, exists, writeJson, identity } from '../contracts/index.mjs';
import { scan } from '../spec-toolkit/index.mjs';
export const feedbackLimits=Object.freeze({message:8000,entries:500});

export const feedbackPath = key => {
  const [requirementId,featureId,...rest]=key.split('/');
  invariant(!rest.length,'INVALID_FEATURE','需求識別無效。');
  return `spec/${id(requirementId)}/${id(featureId)}/feedback.json`;
};
export async function readFeedback(root,key) {
  const file=await safePath(root,feedbackPath(key));
  if(!await exists(file))return {schemaVersion:1,items:[]};
  const value=JSON.parse(await readFile(file,'utf8'));
  invariant(value.schemaVersion===1&&Array.isArray(value.items)&&value.items.length<=feedbackLimits.entries&&value.items.every(x=>typeof x.message==='string'&&x.message.length<=feedbackLimits.message&&Number.isFinite(Date.parse(x.createdAt))),'INVALID_FEEDBACK','驗收問題紀錄格式無效。');
  return value;
}
export async function saveFeedback(root,input,{store,request}) {
  const key=`${id(input.requirementId)}/${id(input.featureId)}`;
  invariant((await scan(root)).features.some(f=>f.key===key),'FEATURE_NOT_FOUND','找不到需求。',404);
  invariant(typeof input.message==='string'&&input.message.trim()&&input.message.length<=feedbackLimits.message,'FEEDBACK_REQUIRED','請填寫驗收意見。');
  const reports=[...store.runs(request.repositoryId).map(r=>r.result),...store.reports(request.repositoryId).map(r=>r.manifest)];
  const report=reports.find(m=>m.runId===input.runId&&m.requirementId===input.requirementId&&m.featureId===input.featureId);
  invariant(report,'REPORT_NOT_FOUND','報告不屬於這個需求。',404);
  if(input.expectedManifestDigest!==undefined)invariant(identity(report)===input.expectedManifestDigest,'REPORT_CHANGED','報告已變更，請重新讀取後再提交意見。',409);
  const value=await readFeedback(root,key);
  const entry={id:request.operationId,runId:report.runId,testedSpecCommit:report.testedSpecCommit,message:input.message.trim(),createdAt:new Date().toISOString()};
  invariant(value.items.length<feedbackLimits.entries,'FEEDBACK_LIMIT','問題紀錄已達上限。');
  value.items.push(entry);await writeJson(await safePath(root,feedbackPath(key)),value);
  return {key,feedback:entry,nextStage:'IMPLEMENTATION'};
}
