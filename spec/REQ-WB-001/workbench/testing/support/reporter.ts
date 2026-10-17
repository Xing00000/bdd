import fs from 'node:fs';
import {createHash} from 'node:crypto';
import type { Reporter, TestCase, TestResult, FullResult } from '@playwright/test/reporter';
type Action={status:string;screenshotSha256:string|null;sourceStepLine:number;assertion:boolean;runId:string;testDefinitionId:string;sourceCaseId:string;sourceStepId:string;sessionId:string;contextRef:string;pageId:string;actionIndex:number;expected:unknown;actual:unknown};
type Evidence={records:Action[];actions:Action[]};
export type Recorded={testKey?:string;status:string;evidenceComplete:boolean;[key:string]:unknown};
export function canReportPass(status:string,expectedKeys:string[],results:Recorded[]){
 const expected=new Set(expectedKeys),actual=new Set(results.map(r=>r.testKey));
 return status==='passed'&&expected.size>0&&actual.size===expected.size&&results.length===expected.size&&[...expected].every(k=>actual.has(k))&&results.every(r=>r.status==='passed'&&r.evidenceComplete);
}
export function hasCompleteEvidence(e:Evidence|undefined,lines:number[],testKey:string){
 const valid=(a:Action)=>a.status==='COMPLETED'&&a.testDefinitionId===testKey&&a.sourceCaseId===testKey&&a.sourceStepLine>0&&a.runId&&a.sourceStepId&&a.sessionId&&a.contextRef&&a.pageId&&a.actionIndex>0&&a.screenshotSha256&&/^[a-f0-9]{64}$/.test(a.screenshotSha256);
 return Boolean(e?.records.length&&e.actions.length&&e.records.every(valid)&&e.actions.every(valid)&&e.actions.some(a=>a.assertion&&a.expected!==undefined&&a.actual!==undefined)&&lines.every(line=>e.records.some(r=>r.sourceStepLine===line)));
}
export default class EvidenceReporter implements Reporter {
 private results:Recorded[]=[];
 onBegin(){const manifest=JSON.parse(fs.readFileSync('test-results/bdd/manifest.json','utf8'));for(const [file,sha] of Object.entries(manifest.implementationHashes)){const actual=createHash('sha256').update(fs.readFileSync(file)).digest('hex');if(actual!==sha)throw Error('StaleTestImplementation: '+file);}}
 onTestEnd(test:TestCase,result:TestResult){
  const attachment=result.attachments.find(a=>a.name==='step-evidence');let evidence:Evidence|undefined;
  try{const text=attachment?.body?.toString('utf8')??(attachment?.path?fs.readFileSync(attachment.path,'utf8'):undefined);if(text)evidence=JSON.parse(text);}catch{evidence=undefined;}
  const testKey=test.annotations.find(a=>a.type==='workbenchTestId')?.description;
  const manifest=JSON.parse(fs.readFileSync('test-results/bdd/manifest.json','utf8'));
  const source=manifest.cases.find((c:{testKey:string})=>c.testKey===testKey);
  this.results.push({testKey,testId:test.id,title:test.titlePath(),status:result.status,evidenceComplete:hasCompleteEvidence(evidence,source?.steps.map((s:{sourceLine:number})=>s.sourceLine)??[],testKey??''),evidence,errors:result.errors.map(e=>e.message),attachments:result.attachments.map(a=>({name:a.name,contentType:a.contentType,path:a.path})),steps:result.steps.map(s=>this.step(s))});
 }
 private step(s:TestResult['steps'][number]):object{return {title:s.title,category:s.category,error:s.error?.message,steps:s.steps.map(x=>this.step(x))};}
 async onEnd(result:FullResult){
  if(!this.results.length)return;
  const manifest=JSON.parse(fs.readFileSync('test-results/bdd/manifest.json','utf8'));
  const expected=manifest.cases.map((c:{testKey:string})=>c.testKey);
  const passed=canReportPass(result.status,expected,this.results);
  fs.mkdirSync('test-results/bdd',{recursive:true});
  fs.writeFileSync('test-results/bdd/evidence-chain.json',JSON.stringify({runId:process.env.WB_HARNESS_RUN_ID,scope:'ALL_REQUIRED',productE2E:passed?'PASSED':result.status==='failed'?'FAILED':'INCOMPLETE',coverageComplete:passed,expectedTestKeys:expected,executedTestKeys:this.results.map(r=>r.testKey),unexecutedTestKeys:expected.filter((key:string)=>!this.results.some(r=>r.testKey===key)),sourceManifest:manifest,results:this.results},null,2));
  if(result.status==='passed'&&!passed)return {status:'failed' as const};
 }
}
