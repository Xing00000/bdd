/** Portable progress is a versioned projection of source reviews and sealed evidence.
 * The stage string is never an authority by itself; recompute from matching inputs.
 */
import { readFeedback } from './feedback.mjs';
import {readAcceptance} from './acceptance.mjs';
import { readFile } from 'node:fs/promises';
import { id, identity, digest, exists, safePath, writeJson } from '../contracts/index.mjs';
import { canonicalLocation } from './locations.mjs';
import { workspaceModules, workspaceEntries, workspaceSpecSourceDigest, specSourcePath, specSourceDigest as sourceDigest } from '../spec-toolkit/workspace.mjs';
import { scan, reviewState, reviewStage, reviewKinds } from '../spec-toolkit/index.mjs';

export const workflowPath = (requirementId, featureId) => `spec/${id(requirementId)}/${id(featureId)}/workflow.json`;
const time = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
const sameProjects = (projects, modules) => Array.isArray(projects) && projects.length === modules.length
  && modules.every(p => !p.pendingDraft && p.initialized !== false && projects.some(x => x.id === p.id && (x.contentDigest
    ? x.contentDigest === p.contentDigest
    : p.actual && !p.dirty && p.actual === p.commit && x.commit === p.actual)));

/** One identity is repo + requirement + feature + run, not run ID alone. */
export function featureReports(feature, modules = [], runs = [], reports = [], specRepositoryId, specSourceDigest) {
  const match = m => m?.requirementId === feature.requirementId && m.featureId === feature.id
    && (!m.specRepositoryId || !specRepositoryId || m.specRepositoryId === specRepositoryId);
  const entries = new Map();
  for (const run of runs.filter(r => match(r.result))) {
    const m = run.result, key = `${feature.key ?? `${feature.requirementId}/${feature.id}`}/${m.runId ?? run.id}`;
    entries.set(key, { key, runId: m.runId ?? run.id, manifest: m, state: run.state, origin: 'LOCAL',
      publication: run.publication ?? null, reportKey: null, invalidReason: null,
      finishedAt: m.finishedAt ?? run.updatedAt ?? m.createdAt ?? null });
  }
  for (const report of reports.filter(r => match(r.manifest))) {
    const local = entries.get(report.key), m = report.manifest;
    // A collision remains blocked even when the local execution directory exists.
    const conflict = local?.state === 'SEALED' && identity(local.manifest) !== identity(m);
    entries.set(report.key, { key: report.key, runId: report.runId, manifest: m, state: 'SEALED', origin: 'SPEC_REPO',
      reportKey: report.key, ref: report.ref, reportCommit: report.reportCommit,
      invalidReason: report.invalidReason ?? (conflict ? 'REPORT_ID_CONFLICT' : null),
      finishedAt: m.finishedAt ?? local?.finishedAt ?? null });
  }
  return [...entries.values()].map(entry => {
    const m = entry.manifest;
    const current = !entry.invalidReason && entry.state === 'SEALED' && m.baseline === feature.review.hashes.tests
      && (m.sourceKind !== 'WORKSPACE' || typeof specSourceDigest === 'string' && m.specSourceDigest === specSourceDigest)
      && sameProjects(m.projects, modules);
    const qualified = current && m.testOutcome === 'PASSED' && m.verification === 'VERIFIED'
      && m.scope === 'ALL_CASES' && m.coverageComplete === true && m.evidenceComplete === true
      && m.inputsUnchanged !== false && !m.failure && !m.cleanupFailure;
    return { ...entry, path: `reports/${entry.key}/manifest.json`, current, qualified,
      applicability: entry.invalidReason ? 'CONFLICT' : current ? 'CURRENT' : 'HISTORICAL' };
  }).sort((a, b) => time(b.finishedAt) - time(a.finishedAt) || b.runId.localeCompare(a.runId));
}

export function workflowState(feature, modules = [], runs = [], reports = [], specRepositoryId, checkpoint, specSourceDigest) {
  const history = featureReports(feature, modules, runs, reports, specRepositoryId, specSourceDigest);
  const pending = reviewKinds.find(stage => !feature.review.confirmed[stage]);
  const latest = history.find(r => r.current && r.manifest.scope === 'ALL_CASES');
  const feedback=(feature.feedback?.items??[]).filter(item=>!latest?.qualified || !latest.manifest.startedAt || time(latest.manifest.startedAt)<=time(item.createdAt));
  const verified = !pending && !feedback.length && Boolean(latest?.qualified);
  const sourceDigests={gherkin:feature.review.hashes.gherkin,sd:feature.review.hashes.sd,tests:feature.review.hashes.tests};
  const acceptance=verified?(feature.acceptance?.items??[]).findLast(a=>a.runId===latest.runId&&a.manifestDigest===identity(latest.manifest)&&identity(a.sourceDigests)===identity(sourceDigests)):null;
  const acceptancePending = Boolean(acceptance?.requiresCheckpoint && !checkpoint?.completedAcceptances?.includes(acceptance.id));
  const stage = pending ? reviewStage(feature.review.confirmed)
    : acceptance && !acceptancePending ? 'VERIFIED' : verified ? 'VERIFICATION' : 'IMPLEMENTATION';
  return {
    schemaVersion: 1, specRepositoryId, requirementId: feature.requirementId, featureId: feature.id,
    key: feature.key ?? `${feature.requirementId}/${feature.id}`, stage,
    status: pending ? 'AWAITING_REVIEW' : acceptancePending ? 'ACCEPTANCE_PENDING' : acceptance ? 'COMPLETE' : verified ? 'AWAITING_ACCEPTANCE' : 'READY_TO_RUN',
    requiredReview: pending ?? null, feedback,
    needsChanges: feedback.length>0,
    nextAction: pending ? 'HUMAN_REVIEW' : acceptancePending ? 'RETRY_ACCEPTANCE' : acceptance ? 'NONE' : verified ? 'HUMAN_ACCEPTANCE' : 'RUN_VERIFICATION',
    sourceDigests, acceptance:acceptance??null,
    reviewPath: `spec/${feature.requirementId}/review.json`, confirmed: feature.review.confirmed,
    verification: verified ? 'VERIFIED' : history.some(r => r.manifest.verification === 'VERIFIED' && !r.current) ? 'STALE'
      : history.length ? 'NOT_VERIFIED' : 'NOT_RUN',
    latestReport: latest ? reportReference(latest) : null,
    latestHistoricalReport: !latest && history.length ? reportReference(history[0]) : null,
    reports: history.map(reportSummary)
  };
}
function reportReference(entry) {
  const m = entry.manifest;
  return { runId: entry.runId, path: entry.path, testedSpecCommit: m.testedSpecCommit ?? null,
    sourceKind: m.sourceKind ?? 'COMMIT', specDigest: m.specDigest ?? null, specSourceDigest: m.specSourceDigest ?? null, inputDigest: m.inputDigest ?? null,
    baseline: m.baseline ?? null, projects: m.projects ?? [], testOutcome: m.testOutcome ?? 'NOT_RUN',
    verification: m.verification ?? 'NOT_VERIFIED', scope: m.scope ?? null, finishedAt: entry.finishedAt,
    manifestDigest: identity(m), reportRef: entry.reportCommit ?? entry.ref?.replace('refs/remotes/origin/','refs/heads/') ?? `refs/heads/evidence/${m.batchId ?? entry.runId}` };
}
function reportSummary(entry) {
  return { ...reportReference(entry), key: entry.key, reportKey: entry.reportKey, origin: entry.origin,
    ref: entry.ref ?? null, reportCommit: entry.reportCommit ?? null, publication: entry.publication ?? null,
    state: entry.state, applicability: entry.applicability, invalidReason: entry.invalidReason,
    caseCount: entry.manifest.cases?.length ?? 0,
    artifacts: (entry.manifest.artifacts ?? []).map(a => ({ path: a.path, size: a.size })) };
}
export function draftModules(snapshot, projection) {
  return (snapshot.settings.projects ?? []).map(p => {
    const previous = projection?.modules?.find(x => x.id === p.id);
    const pendingDraft = snapshot.files.some(f => f.target === `project:${p.id}`
      && !projection?.files?.some(m => m.target === f.target && m.path === f.path && m.sha256 === (f.sha256 ?? digest(f.content))));
    return { id: p.id, path: `projects/${p.id}`, url: p.url, ...previous, pendingDraft,
      dirty: Boolean(previous?.dirty) || pendingDraft };
  });
}
export async function recordedWorkflow(root, feature, derived) {
  const relative = workflowPath(feature.requirementId, feature.id), file = await safePath(root, relative);
  if (!await exists(file)) return { path: relative, state: 'NOT_EXPORTED' };
  try {
    const record = JSON.parse(await readFile(file, 'utf8'));
    if (record.schemaVersion !== 1 || record.requirementId !== feature.requirementId || record.featureId !== feature.id
      || record.specRepositoryId !== derived.specRepositoryId) return { path: relative, state: 'INVALID' };
    const sourceMatches = identity(record.sourceDigests) === identity(derived.sourceDigests);
    return { path: relative, state: sourceMatches && record.stage === derived.stage ? 'CURRENT' : 'STALE',
      recordedStage: record.stage, updatedAt: record.updatedAt ?? null };
  } catch { return { path: relative, state: 'INVALID' }; }
}
/** Do not let malformed in-progress metadata make ordinary source saves fail. */
export async function refreshWorkflowFiles(root, { modules = [], runs = [], reports = [], checkpoint, specSourceDigest } = {}) {
  let data;
  try { data = await scan(root); } catch { return []; }
  const changed = [];
  if (specSourceDigest === undefined) specSourceDigest = await workspaceSpecSourceDigest(root);
  for (const feature of data.features) {
    feature.review = await reviewState(root, feature.requirementId, feature.id);
    feature.feedback = await readFeedback(root,feature.key);
    feature.acceptance=await readAcceptance(root,feature.requirementId,feature.id);
    const workflow = workflowState(feature, modules, runs, reports, data.config.specRepositoryId, checkpoint, specSourceDigest);
    const { reports: ignored, latestHistoricalReport, ...portable } = workflow;
    // Persist a portable evidence reference, not machine-local IDs, paths or jobs.
    portable.latestHistoricalReport = latestHistoricalReport;
    const relative = workflowPath(feature.requirementId, feature.id), file = await safePath(root, relative);
    let previous;
    try { previous = JSON.parse(await readFile(file, 'utf8')); } catch { /* New file or invalid old projection. */ }
    const { updatedAt: oldTime, ...before } = previous ?? {};
    if (identity(before) === identity(portable)) continue;
    await writeJson(file, { ...portable, updatedAt: new Date().toISOString() }); changed.push(relative);
  }
  return changed;
}

/** Match the full live source selection, including helpers outside the SQL editor.
 * Pending SQL edits or external conflicts cannot certify the on-disk snapshot.
 * A draft view may contain edits not yet saved to SQL; compare those as well.
 */
export async function liveWorkflowSpecSourceDigest(context, snapshot, draftRoot) {
  try {
    if (canonicalLocation(context.root) !== context.root || !await exists(context.root)) return null;
    const entries = await workspaceEntries(context.root, { spec: true }), current = new Map(entries.map(file => [file.path, file.sha256]));
    const saved = snapshot.files.filter(file => file.target === 'spec' && specSourcePath(file.path));
    const desired = draftRoot ? (await workspaceEntries(draftRoot, { spec: true })).filter(file => specSourcePath(file.path))
      : saved.map(file => ({ path: file.path, sha256: file.sha256 ?? digest(file.content) }));
    const desiredPaths = new Set(desired.map(file => file.path));
    if (saved.some(file => !desiredPaths.has(file.path)) || desired.some(file => current.get(file.path) !== file.sha256)) return null;
    return sourceDigest(entries);
  } catch {
    // Unavailable or unsafe source files make old evidence historical, not current.
    return null;
  }
}

/** Read-only: a stale projection cache cannot certify externally edited products. */
export async function liveWorkflowModules(context, snapshot) {
  const repositoryId=context.repositoryId??context.request?.repositoryId??context.repository?.id;
  const projection=context.store.projection(repositoryId);
  if(!(snapshot.settings.projects??[]).length)return [];
  try {
    if (canonicalLocation(context.root) !== context.root) throw Error('Workspace location changed');
    const modules = await workspaceModules(context.root, snapshot.settings.projects);
    return draftModules(snapshot, { ...projection, modules: modules.map(module => {
      const previous = projection?.modules?.find(item => item.id === module.id);
      return { ...previous, ...module, dirty: !module.initialized || !previous?.checkpointDigest
        || previous.checkpointDigest !== module.contentDigest };
    }) });
  } catch {
    return draftModules(snapshot,{...projection,modules:(snapshot.settings.projects??[]).map(p=>({...p,actual:null,commit:null,contentDigest:null,initialized:false,dirty:true}))});
  }
}
