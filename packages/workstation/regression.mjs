import { publishRegression } from './regression-evidence.mjs';
/** Whole-repository regression uses immutable version selections, never editable SQL drafts. */
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { mkdir, cp, rmdir, readFile } from 'node:fs/promises';
import { id, invariant, identity, exists, safePath, readJson, writeJson, errorResult } from '../contracts/index.mjs';
import { scan, reviewState } from '../spec-toolkit/index.mjs';
import { executeRun, inputSnapshot } from '../spec-toolkit/engine.mjs';
import { snapshotRepository, productCache, selectedCommit } from './catalog.mjs';
import { ensureInstallation, installationPlan } from './flows.mjs';
import { commitId, remoteUrl } from '../git-core/index.mjs';

async function cloneProduct(git, source, destination, commit, url) {
  if (await exists(destination)) await rmdir(destination); // Git creates empty gitlink directories
  await git.cloneCandidate(source, destination, commit);
  await git.command(destination, ['remote', 'set-url', 'origin', url]);
}
export function summarizeRegression(results) {
  const counts = { total: results.length, passed: 0, failed: 0, errors: 0, pending: 0 };
  for (const item of results) {
    if (item.outcome === 'PASSED') counts.passed++;
    else if (item.outcome === 'FAILED') counts.failed++;
    else if (item.outcome === 'ERROR') counts.errors++;
    else counts.pending++;
  }
  return { counts, outcome: counts.total > 0 && counts.passed === counts.total ? 'PASSED' : counts.pending ? 'INCOMPLETE' : counts.errors ? 'ERROR' : counts.failed ? 'FAILED' : 'NOT_RUN' };
}
export function compareRegressions(current, previous) {
  if (!previous) return [];
  return current.results.map(item => ({ key: item.key, before: previous.results.find(x => x.key === item.key)?.outcome ?? 'NOT_RUN', after: item.outcome }))
    .filter(x => x.before !== x.after);
}
export async function prepareRegression(context) {
  const { root, options, store, request, git } = context, repositoryId = request.repositoryId;
  const input = request.input;
  if (input.batchId) {
    const known = store.regression(repositoryId, id(input.batchId));
    invariant(known && ['PREPARED', 'AWAITING_INSTALL'].includes(known.status), 'REGRESSION_NOT_RESUMABLE', '此回歸已開始或已結束；請建立新的回歸。', 409);
    invariant(identity(known.selection) === identity({ specRef: input.specRef, projects: input.projects ?? {} }), 'REGRESSION_SELECTION_CHANGED', '版本選擇已改變，請開始新的回歸。', 409);
    return known;
  }
  invariant(typeof input.specRef === 'string' && input.projects !== null && (input.projects === undefined || typeof input.projects === 'object' && !Array.isArray(input.projects)), 'INVALID_REGRESSION_SELECTION', '請選擇規格版本及產品版本。');
  if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(input.specRef))await git.fetch(root);
  const snapshot = await snapshotRepository({ ...context, repositoryId }, input.specRef);
  const data = await scan(snapshot.root), modules = await git.modules(snapshot.root);
  invariant(data.features.length > 0, 'NO_TESTS', '這個規格版本沒有可執行功能，不能回報全部通過。');
  invariant(!data.features.some(f => f.authoringOnly), 'TEST_RUNNER_NOT_CONFIGURED', '所選版本包含尚未接線工作台執行器的規格，不能執行整庫回歸。', 409);
  invariant(data.features.length <= 1000, 'REGRESSION_LIMIT', '單批最多 1000 個功能。');
  invariant(Object.keys(input.projects ?? {}).every(key => modules.some(m => m.id === key)), 'UNKNOWN_PROJECT', '產品必須屬於所選的規格版本。');
  invariant(await exists(path.join(snapshot.root, 'package-lock.json')), 'LOCKFILE_REQUIRED', '此歷史版本沒有依賴鎖；請選擇可重現的規格版本，不會偷偷使用最新依賴。');
  const batchId = `BATCH-${randomUUID()}`, directory = await safePath(options.home, `regressions/${batchId}`);
  await mkdir(directory, { recursive: true });
  const candidate = path.join(directory, 'repo');
  await git.cloneCandidate(snapshot.root, candidate, snapshot.commit);
  const projects = [];
  for (const p of modules) {
    const requested = input.projects?.[p.id] || null;
    const cache = await productCache({ ...context, repositoryId }, p, Boolean(requested&&!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(requested)));
    const ref = requested ?? p.commit;
    if (/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(ref)) {
      const sha = commitId(ref);
      const object = (await git.command(cache, ['cat-file', '--batch-check'], { input: `${sha}\n` })).stdout.trim();
      if (object === `${sha} missing`) {
        await git.command(cache, ['fetch', '--no-tags', '--no-recurse-submodules', '--', remoteUrl(p.url, git.policy), sha]);
      }
    }
    const commit = await selectedCommit(cache, ref, git);
    await cloneProduct(git, cache, path.join(candidate, p.path), commit, p.url);
    projects.push({ id: p.id, path: p.path, url: p.url, commit, recordedCommit: p.commit, requestedRef: requested ?? 'SPEC_PIN' });
  }
  const batch = { schemaVersion: 1, batchId, repositoryId, specRepositoryId: data.config.specRepositoryId,
    selection: { specRef: input.specRef, projects: input.projects ?? {} }, testedSpecCommit: snapshot.commit,
    projects, status: 'PREPARED', operationId: request.operationId, createdAt: new Date().toISOString(),
    environment: { node: process.version, platform: process.platform, architecture: process.arch, osRelease: os.release(), lockfileHash: identity(await readFile(path.join(candidate, 'package-lock.json'), 'utf8')) },
    profiles: [...new Set(data.features.flatMap(f => f.profiles))],
    features: data.features.map(f => ({ requirementId: f.requirementId, id: f.id, key: f.key, title: f.title, caseIds: f.caseIds, profiles: f.profiles, projectIds: f.projectIds })),
    results: data.features.map(f => ({ key: f.key, title: f.title, outcome: 'PENDING', expectedCases: f.caseIds.length * f.profiles.length })) };
  Object.assign(batch, summarizeRegression(batch.results));
  await writeJson(path.join(directory, 'baseline.json'), batch);
  store.recordRegression(repositoryId, batch);
  return batch;
}
export async function runRegression(context) {
  const { options, store, request, git } = context, repositoryId = request.repositoryId;
  invariant(options.enableExecution, 'EXECUTION_DISABLED', '主機尚未啟用受信任測試執行。儲存內容不受影響。', 403);
  const batch = await prepareRegression(context);
  const directory = await safePath(options.home, `regressions/${batch.batchId}`), root = path.join(directory, 'repo');
  batch.operationId = request.operationId;
  const persist = async () => {
    Object.assign(batch, summarizeRegression(batch.results));
    await writeJson(path.join(directory, 'summary.json'), batch);
    store.recordRegression(repositoryId, batch);
  };
  try {
    const browserRoot=options.browserRoot??process.env.PLAYWRIGHT_BROWSERS_PATH??path.join(options.home,'browsers');
    const dependencies=await installationPlan(root,batch.profiles,browserRoot);
    const consentFile=await safePath(options.home,`installation-consents/${dependencies.digest}.json`);
    const remembered=await exists(consentFile)&&(await readJson(consentFile)).digest===dependencies.digest;
    await ensureInstallation({ ...context, root, profiles: batch.profiles, request:{...request,input:{...request.input,...(remembered?{installConsent:dependencies.digest}:{})}} });
    await writeJson(consentFile,{digest:dependencies.digest,grantedAt:new Date().toISOString(),packageDefinition:dependencies.definition});
    invariant(await git.resolve(root) === batch.testedSpecCommit, 'REGRESSION_SOURCE_CHANGED', '依賴準備改變了固定規格，未執行回歸。');
  } catch (error) {
    batch.status = error.code === 'INSTALL_REQUIRED' ? 'AWAITING_INSTALL' : 'FAILED';
    batch.error = errorResult(error); await persist();
    if (error.code === 'INSTALL_REQUIRED') error.details.install.batchId = batch.batchId;
    throw error;
  }
  batch.status = 'RUNNING'; batch.startedAt = new Date().toISOString(); delete batch.error; await persist();
  for (let index = 0; index < batch.features.length; index++) {
    const feature = batch.features[index], item = batch.results[index];
    item.outcome = 'RUNNING'; await persist();
    const runId = `RUN-${batch.batchId.slice(6)}-${index + 1}`;
    item.runId = runId;
    try {
      const runDirectory = await safePath(options.home, `executions/${runId}`);
      invariant(!await exists(runDirectory), 'RUN_EXISTS', '執行目錄已存在，不會覆寫歷史。', 409);
      await mkdir(runDirectory, { recursive: true });
      const repo = path.join(runDirectory, 'repo');
      await git.cloneCandidate(root, repo, batch.testedSpecCommit);
      for (const p of batch.projects) await cloneProduct(git, path.join(root, p.path), path.join(repo, p.path), p.commit, p.url);
      // Each feature gets independent writable dependencies and outputs.
      await cp(path.join(root, 'node_modules'), path.join(repo, 'node_modules'), { recursive: true, verbatimSymlinks: true });
      const review = await reviewState(repo, feature.requirementId, feature.id);
      const plan = { schemaVersion: 1, mode: 'REGRESSION', batchId: batch.batchId, repositoryId, specRepositoryId: batch.specRepositoryId,
        runId, requirementId: feature.requirementId, featureId: feature.id, testedSpecCommit: batch.testedSpecCommit,
        projects: batch.projects, selectedRefs: batch.selection, approvalConfirmed: Object.values(review.confirmed).every(Boolean),
        caseIds: feature.caseIds, allCaseIds: feature.caseIds, profiles: feature.profiles, requiredProjectIds: feature.projectIds,
        scope: 'ALL_CASES', baseline: review.hashes.tests, inputDigest: await inputSnapshot(repo, git), createdAt: new Date().toISOString(), state: 'PREPARED' };
      await writeJson(path.join(runDirectory, 'plan.json'), plan);
      store.recordRun(repositoryId, plan, 'PREPARED');
      const result = await executeRun({ home: options.home, repositoryId, runId, git, enabled: true });
      store.recordRun(repositoryId, result, 'SEALED');
      // Passing some tests is not enough: discovery and execution must cover every planned case.
      item.outcome = result.testOutcome === 'PASSED' && result.coverageComplete ? 'PASSED' : result.testOutcome === 'FAILED' ? 'FAILED' : 'ERROR';
      Object.assign(item, { testOutcome: result.testOutcome, coverageComplete: result.coverageComplete, actualCases: result.cases.length,
        verification: result.verification, error: result.failure, reasons: result.reasons });

    } catch (error) { item.outcome = 'ERROR'; item.error = errorResult(error); }
    await persist(); // A failed feature does not silently skip the remaining suite.
  }
  batch.status = 'COMPLETED'; batch.finishedAt = new Date().toISOString();
  const previous = store.regressions(repositoryId).find(x => x.batchId !== batch.batchId && x.status === 'COMPLETED');
  batch.comparedWith = previous?.batchId ?? null; batch.differences = compareRegressions(batch, previous);
  await persist();
  try {batch.publication=await publishRegression({root,home:options.home,repositoryId,batch,git});}catch(error){batch.publicationError=errorResult(error);}
  await persist(); return batch;
}
