import path from 'node:path';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { id, invariant, identity, digest, safePath, exists, atomicWrite, errorResult } from '../contracts/index.mjs';
import { configuration } from '../spec-toolkit/index.mjs';
import { verifyBundle } from '../spec-toolkit/engine.mjs';
import { specCheckpointDigest } from '../spec-toolkit/source-checkpoint.mjs';

function reportIdentity(manifest, requirementId, featureId, runId) {
  invariant(manifest.requirementId === requirementId && manifest.featureId === featureId && manifest.runId === runId,
    'REPORT_ID_MISMATCH', 'Manifest identity differs from its directory');
}
export async function reindexReports({ root, home, repositoryId, git, store, refs }) {
  const config = await configuration(root);
  if (refs === undefined) {
    const branches = (await git.command(root, ['for-each-ref', '--format=%(refname)', 'refs/remotes/origin/evidence/', 'refs/heads/evidence/'])).stdout.trim().split('\n').filter(Boolean);
    refs = ['HEAD', ...branches];
  }
  invariant(Array.isArray(refs) && refs.length > 0 && refs.length <= 200 && refs.every(x => typeof x === 'string'), 'INVALID_REPORT_REFS', 'Select 1–200 already-fetched refs');
  const seenManifests = new Set();
  const commits = new Set(), indexed = [], errors = [];
  for (const ref of refs) {
    let commit;
    try { commit = await git.resolve(root, ref); }
    catch (error) { errors.push({ ref, ...errorResult(error) }); continue; }
    if (commits.has(commit)) continue; commits.add(commit);
    // Read Git blobs, not a checkout: report imports cannot execute repository hooks/configuration.
    const raw = (await git.command(root, ['ls-tree', '-r', '-z', '-l', '--full-tree', commit, '--', 'reports/'])).stdout;
    const entries = raw.split('\0').filter(Boolean).map(line => {
      const split = line.indexOf('\t'), [mode, type, sha, size] = line.slice(0, split).trim().split(/\s+/);
      return { path: line.slice(split + 1), mode, type, sha, size: Number(size) };
    });
    for (const candidate of entries.filter(x => /^reports\/[^/]+\/[^/]+\/[^/]+\/manifest\.json$/.test(x.path))) {
      const identityKey=candidate.path+'@'+candidate.sha;
      if(seenManifests.has(identityKey))continue;seenManifests.add(identityKey);
      let staging;
      try {
        const [, requirementId, featureId, runId] = candidate.path.split('/');
        [requirementId, featureId, runId].forEach(value => id(value));
        const prefix = `reports/${requirementId}/${featureId}/${runId}/`, files = entries.filter(x => x.path.startsWith(prefix));
        invariant(files.length <= 10000 && files.every(x => x.type === 'blob' && x.mode === '100644' && x.size <= 32 * 1024 * 1024)
          && files.reduce((sum, x) => sum + x.size, 0) <= 256 * 1024 * 1024, 'REPORT_IMPORT_LIMIT', 'Invalid, executable, symlink or oversized report entry');
        const cacheKey = identity({ repositoryId, commit, prefix }), cache = await safePath(home, `report-cache/${cacheKey}`);
        if (!await exists(cache)) {
          staging = await safePath(home, `report-cache/pending-${randomUUID()}`); await mkdir(staging, { recursive: true, mode: 0o700 });
          for (const file of files) await atomicWrite(await safePath(staging, file.path.slice(prefix.length)), await git.blob(root, file.sha));
          const manifest = await verifyBundle(staging);
          reportIdentity(manifest, requirementId, featureId, runId);
          invariant(!manifest.specRepositoryId || manifest.specRepositoryId === config.specRepositoryId, 'REPORT_REPOSITORY_MISMATCH', 'Report belongs to a different Spec repository');
          await verifyReportSource(manifest, entries, root, git, commit);
          await rename(staging, cache); staging = null;
        }
        const manifest = await verifyBundle(cache);
        reportIdentity(manifest, requirementId, featureId, runId);
        invariant(!manifest.specRepositoryId || manifest.specRepositoryId === config.specRepositoryId, 'REPORT_REPOSITORY_MISMATCH', 'Report belongs to a different Spec repository');
        const key = `${requirementId}/${featureId}/${runId}`;
        const entry = { key, runId, requirementId, featureId, cacheKey, ref, reportCommit: commit, manifestHash: digest(await readFile(path.join(cache, 'manifest.json'))), manifest };
        store.indexReport(repositoryId, entry); indexed.push({ key, ref, reportCommit: commit });
      } catch (error) { errors.push({ ref, path: candidate.path, ...errorResult(error) }); }
      finally { if (staging) await rm(staging, { recursive: true, force: true }); }
    }
    for(const file of entries.filter(e=>/^reports\/_runs\/BATCH-[A-Za-z0-9_-]+\/summary\.json$/.test(e.path))) {
      try {
        invariant(file.type==='blob'&&file.mode==='100644'&&file.size<=4*1024*1024,'INVALID_BATCH_SUMMARY','回歸摘要格式無效。');
        const summary=JSON.parse((await git.blob(root,file.sha)).toString('utf8'));
        invariant(summary.mode==='REGRESSION'&&summary.schemaVersion===1&&summary.status==='COMPLETED'&&file.path===`reports/_runs/${id(summary.batchId)}/summary.json`,'INVALID_BATCH_SUMMARY','回歸摘要識別不符。');
        invariant(Array.isArray(summary.features)&&Array.isArray(summary.results)&&Array.isArray(summary.children)&&summary.features.length===summary.results.length&&summary.features.length>0,'INVALID_BATCH_SUMMARY','回歸清單不完整。');
        invariant(new Set(summary.results.map(r=>r.key)).size===summary.results.length&&summary.features.every(f=>summary.results.some(r=>r.key===f.key)),'INVALID_BATCH_SUMMARY','回歸案例清單重複或不符。');
        invariant((await git.command(root,['merge-base','--is-ancestor',summary.testedSpecCommit,commit],{allowFailure:true})).exitCode===0,'REPORT_SOURCE_UNREACHABLE','回歸來源版本不在報告歷史內。');
        const recorded=store.reports(repositoryId);
        for(const result of summary.results.filter(r=>['PASSED','FAILED'].includes(r.outcome))) {
          const child=summary.children.find(x=>x.key===result.key&&x.runId===result.runId),report=recorded.find(x=>x.key===`${result.key}/${result.runId}`);
          invariant(child&&report&&!report.invalidReason&&child.manifestHash===report.manifestHash&&report.manifest.testedSpecCommit===summary.testedSpecCommit,'BATCH_EVIDENCE_MISMATCH','部分回歸證據缺少或不符。');
          if(result.outcome==='PASSED')invariant(report.manifest.testOutcome==='PASSED'&&report.manifest.coverageComplete===true,'BATCH_EVIDENCE_MISMATCH','不能把部分案例當成整個功能通過。');
        }
        const passed=summary.results.filter(r=>r.outcome==='PASSED').length;
        invariant(summary.outcome!=='PASSED'||passed===summary.features.length,'INVALID_BATCH_SUMMARY','回歸總結與逐項結果不同。');
        const local=store.regression(repositoryId,summary.batchId);
        if(!local||local.imported)store.recordRegression(repositoryId,{...summary,repositoryId,operationId:`import-${summary.batchId}`,imported:true,publication:{status:'PUBLISHED',reportCommit:commit,branch:ref}});
      }catch(error){errors.push({ref,path:file.path,...errorResult(error)});}
    }
  }
  return { indexed, errors, fetched: false, workingTreeChanged: false };
}
async function verifyReportSource(manifest, entries, root, git, reportCommit) {
  let sourceCommit = manifest.testedSpecCommit;
  if (manifest.sourceKind === 'WORKSPACE') {
    const file = entries.find(entry => entry.path === `reports/_runs/${id(manifest.runId)}/summary.json`);
    invariant(file?.type === 'blob' && file.mode === '100644' && file.size <= 1024 * 1024, 'REPORT_CHECKPOINT_MISSING', '工作樹報告缺少人工驗收版本參照。');
    const summary = JSON.parse((await git.blob(root, file.sha)).toString('utf8'));
    invariant(summary.sourceKind === 'WORKSPACE' && summary.runId === manifest.runId && summary.manifestDigest === identity(manifest)
      && summary.inputDigest === manifest.inputDigest && summary.specDigest === manifest.specDigest && summary.specSourceDigest === manifest.specSourceDigest
      && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(summary.acceptedSpecCommit ?? ''), 'REPORT_CHECKPOINT_MISMATCH', '驗收版本與封存報告不符。');
    sourceCommit = summary.acceptedSpecCommit;
    invariant(await specCheckpointDigest(root, git, sourceCommit) === manifest.specSourceDigest,
      'REPORT_CHECKPOINT_MISMATCH', '驗收版本中的規格來源與封存報告不同。');
  }
  invariant((await git.command(root, ['merge-base', '--is-ancestor', sourceCommit, reportCommit], { allowFailure: true })).exitCode === 0,
    'REPORT_SOURCE_UNREACHABLE', 'Source checkpoint is not an ancestor of the report commit');
}
export function currentVerification(feature, modules, reports, specSourceDigest) {
  const matching = reports.filter(x => x.manifest.requirementId === feature.requirementId && x.manifest.featureId === feature.id);
  const candidates = matching.filter(x => !x.invalidReason && x.manifest.verification === 'VERIFIED'
    && x.manifest.scope === 'ALL_CASES' && x.manifest.coverageComplete === true && x.manifest.evidenceComplete === true);
  const applicable = candidates.find(x => {
    const m = x.manifest;
    return Object.values(feature.review.confirmed).every(Boolean) && feature.review.hashes.tests === m.baseline
      && (m.sourceKind !== 'WORKSPACE' || typeof specSourceDigest === 'string' && m.specSourceDigest === specSourceDigest)
      && Array.isArray(m.projects) && m.projects.length === modules.length
      && modules.every(p => !p.pendingDraft && p.initialized !== false && m.projects.some(r => r.id === p.id && (r.contentDigest
        ? r.contentDigest === p.contentDigest : !p.dirty && p.actual === p.commit && r.commit === p.actual)));
  });
  if (applicable) return { status: 'VERIFIED', runId: applicable.manifest.runId, testedSpecCommit: applicable.manifest.testedSpecCommit };
  return { status: candidates.length ? 'STALE' : matching.length ? 'NOT_VERIFIED' : 'NOT_RUN' };
}
export async function artifactDirectory({ home, store, repositoryId, runId, reportKey }) {
  id(repositoryId); id(runId);
  if (reportKey) {
    const entry = store.reports(repositoryId).find(x => x.key === reportKey && x.runId === runId);
    invariant(entry && !entry.invalidReason, 'REPORT_NOT_FOUND', 'Report not indexed or conflicting', 404);
    return safePath(home, `report-cache/${entry.cacheKey}`, { missing: false });
  }
  const directory = await safePath(home, `executions/${runId}`);
  if (await exists(path.join(directory, 'plan.json'))) {
    const plan = JSON.parse(await readFile(path.join(directory, 'plan.json'), 'utf8'));
    invariant((plan.repositoryId ?? plan.workspaceId) === repositoryId, 'RUN_REPOSITORY_MISMATCH', 'Run belongs to another workspace', 403);
    return safePath(directory, 'evidence', { missing: false });
  }
  const matches = store.reports(repositoryId).filter(x => x.runId === runId && !x.invalidReason);
  invariant(matches.length === 1, 'REPORT_NOT_FOUND', 'Supply reportKey for a missing or ambiguous run', 404);
  return safePath(home, `report-cache/${matches[0].cacheKey}`, { missing: false });
}
