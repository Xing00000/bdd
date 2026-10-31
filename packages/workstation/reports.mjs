import path from 'node:path';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { id, invariant, identity, digest, safePath, exists, atomicWrite, errorResult } from '../contracts/index.mjs';
import { configuration } from '../spec-toolkit/index.mjs';
import { verifyBundle } from '../spec-toolkit/engine.mjs';

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
          invariant((await git.command(root, ['merge-base', '--is-ancestor', manifest.testedSpecCommit, commit], { allowFailure: true })).exitCode === 0,
            'REPORT_SOURCE_UNREACHABLE', 'Tested commit is not an ancestor of the report commit');
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
  }
  return { indexed, errors, fetched: false, workingTreeChanged: false };
}
export function currentVerification(feature, modules, reports) {
  const matching = reports.filter(x => x.manifest.requirementId === feature.requirementId && x.manifest.featureId === feature.id);
  const candidates = matching.filter(x => !x.invalidReason && x.manifest.verification === 'VERIFIED'
    && x.manifest.scope === 'ALL_CASES' && x.manifest.coverageComplete === true && x.manifest.evidenceComplete === true);
  const applicable = candidates.find(x => {
    const m = x.manifest;
    return Object.values(feature.review.confirmed).every(Boolean) && feature.review.hashes.tests === m.baseline
      && Array.isArray(m.projects) && m.projects.length === modules.length
      && modules.every(p => !p.dirty && p.actual === p.commit && m.projects.some(r => r.id === p.id && r.commit === p.actual));
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
