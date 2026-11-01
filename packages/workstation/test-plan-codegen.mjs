/** Produce an explicitly unfinished skeleton without invoking an Agent or installer. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { id, invariant, safePath, atomicWrite, identity, digest } from '../contracts/index.mjs';
import { execute, processEnvironment } from '../git-core/index.mjs';
import { scan, reviewState } from '../spec-toolkit/index.mjs';
import { runBddCommand } from '../spec-toolkit/engine.mjs';
import { ensureDraft, inDraftView, sourceFiles } from './authoring.mjs';
import { useRepositoryTools } from './repository-tools.mjs';
import { refreshWorkflowFiles, draftModules } from './workflow-state.mjs';

export async function generateTestSkeleton(context) {
  const {store,request,options}=context,repositoryId=request.repositoryId,input=request.input;
  const receiptId=`skeleton-${identity(request).slice(0,40)}`;
  const prior=store.draftReceipt(repositoryId,receiptId,request);if(prior)return prior;
  const snapshot=await ensureDraft({...context,repositoryId});
  return inDraftView(snapshot,async root=>{
    const key=`${id(input.requirementId)}/${id(input.featureId)}`;
    const feature=(await scan(root)).features.find(feature=>feature.key===key);
    invariant(feature&&!feature.authoringOnly,'TEST_RUNNER_NOT_CONFIGURED','此規格尚未接線測試執行器。',409);
    const review=await reviewState(root,input.requirementId,input.featureId);
    invariant(review.confirmed.gherkin&&review.confirmed.sd,'UPSTREAM_NOT_CONFIRMED','請先確認需求與系統設計。',409);
    invariant(!review.records.tests,'STAGE_READ_ONLY','測試計劃已確認，請先退回測試計劃。',409);
    const paths=feature.testPlan.paths;
    invariant(!(await Promise.all(paths.map(async file=>(await readFile(await safePath(root,file),'utf8')).trim()))).some(Boolean),'TEST_PLAN_EXISTS','已有測試內容，不會以骨架覆蓋。',409);
    await useRepositoryTools(root,options,request);
    const steps=paths.find(file=>file.endsWith('.steps.ts')),hooks=paths.find(file=>file.endsWith('.hooks.ts'));
    invariant(steps&&hooks,'TEST_PATHS_REQUIRED','缺少 steps 或 hooks 路徑。');
    const result=await execute(process.execPath,[fileURLToPath(new URL('./bdd-snippets.mjs',import.meta.url)),steps],{
      cwd:root,env:processEnvironment({WB_REQUIREMENT_ID:input.requirementId,WB_FEATURE_ID:input.featureId}),timeoutMs:60000});
    invariant(result.exitCode===0&&!result.timedOut&&!result.overflow,'TEST_CODEGEN_FAILED',result.stderr||result.stdout);
    const shared=path.posix.relative(path.posix.dirname(hooks),'tests/_shared/bdd');
    await atomicWrite(await safePath(root,hooks),`import { AfterStep } from '${shared.startsWith('.')?shared:'./'+shared}';\n\nAfterStep(async ({ page, $testInfo, $step }) => {\n  await $testInfo.attach('step-' + $step.title, {\n    contentType: 'image/png',\n    body: await page.screenshot(),\n  });\n});\n`);
    const generated=await runBddCommand(root,'generate',input.requirementId,input.featureId);
    invariant(generated.exitCode===0&&!generated.timedOut&&!generated.overflow,'TEST_CODEGEN_FAILED',generated.stderr||generated.stdout);
    await refreshWorkflowFiles(root,{modules:draftModules(snapshot,store.projection(repositoryId)),runs:store.runs(repositoryId),reports:store.reports(repositoryId)});
    const files=(await sourceFiles(root)).filter(file=>!snapshot.files.some(old=>old.target===file.target&&old.path===file.path&&old.sha256===digest(file.content)))
      .map(file=>({...file,baseHash:snapshot.files.find(old=>old.target===file.target&&old.path===file.path)?.baseHash??null}));
    return store.saveDraft(repositoryId,{expectedRevision:snapshot.revision,operationId:receiptId,request,files,result:{nextStage:'TESTS',testPlan:{paths,skeleton:true},testOutcome:'NOT_RUN'}});
  });
}
