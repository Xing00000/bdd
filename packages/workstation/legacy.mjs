import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { readFile, realpath, lstat } from 'node:fs/promises';
import { invariant, digest, identity, id, safePath, exists, readJson, writeJson } from '../contracts/index.mjs';
import { configuration } from '../spec-toolkit/index.mjs';
import { planFiles } from './transactions.mjs';

const json = value => JSON.stringify(value, null, 2) + '\n';
const stableId = (value, prefix, salt) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value ?? '') ? value : `${prefix}-${identity(salt).slice(0, 16)}`;
function limited(rows, label) { invariant(rows.length <= 10000, 'LEGACY_SIZE_LIMIT', `More than 10000 ${label}; narrow the selection`); return rows; }
export function readLegacy(file, requirementIds) {
  invariant(typeof file === 'string' && file, 'LEGACY_NOT_CONFIGURED', 'Configure WB_LEGACY_DB on the server; API callers cannot select arbitrary files', 403);
  if (requirementIds !== undefined) invariant(Array.isArray(requirementIds) && requirementIds.length > 0 && requirementIds.length <= 500 && requirementIds.every(x => typeof x === 'string' && x.length <= 200), 'INVALID_LEGACY_SELECTION', 'Select 1–500 legacy requirement IDs');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; BEGIN;');
    const tables = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(x => x.name));
    invariant(['requirements', 'documents', 'document_heads', 'document_versions'].every(x => tables.has(x)), 'LEGACY_SCHEMA_UNSUPPORTED', 'This is not a supported legacy workbench database');
    const rows = (name, where = '', args = []) => limited(db.prepare(`SELECT * FROM ${name} ${where} LIMIT 10001`).all(...args), name);
    let requirements = rows('requirements');
    const deleted = requirements.filter(x => x.deleted_at).map(x => x.id);
    requirements = requirements.filter(x => !x.deleted_at && (!requirementIds || requirementIds.includes(x.id)));
    if (requirementIds) invariant(requirementIds.every(value => requirements.some(x => x.id === value)), 'LEGACY_SELECTION_NOT_FOUND', 'Some selected requirements are missing or deleted');
    invariant(requirements.length > 0, 'LEGACY_EMPTY_SELECTION', 'No active requirements selected');
    const selected = new Set(requirements.map(x => x.id));
    const features = tables.has('features') ? rows('features').filter(x => selected.has(x.requirement_id))
      : requirements.map(x => ({ id: x.id, requirement_id: x.id, feature_key: x.requirement_key, stage: x.stage }));
    const documents = rows('documents').filter(x => selected.has(x.requirement_id) && !x.deleted_at && ['requirement', 'target_ci'].includes(x.purpose));
    const documentIds = documents.map(x => x.id);
    const versions = documentIds.length ? limited(db.prepare(`SELECT id,document_id,version_no,raw_text,raw_sha256,created_at FROM document_versions WHERE document_id IN (${documentIds.map(() => '?').join(',')}) ORDER BY document_id,version_no LIMIT 10001`).all(...documentIds), 'versions') : [];
    const heads = rows('document_heads').filter(x => documentIds.includes(x.document_id));
    const confirmations = tables.has('confirmations') ? rows('confirmations').filter(x => selected.has(x.requirement_id)) : [];
    // Deliberately exclude execution_config, environment snapshots, settings and credentials.
    const runColumns = tables.has('runs') ? new Set(db.prepare('PRAGMA table_info(runs)').all().map(x => x.name)) : new Set();
    const fields = ['id', 'requirement_id', 'feature_id', 'status', 'execution_scope', 'candidate_commit', 'tested_commit'].map(name => runColumns.has(name) ? name : `NULL AS ${name}`).join(',');
    const runs = tables.has('runs') ? limited(db.prepare(`SELECT ${fields} FROM runs LIMIT 10001`).all(), 'runs').filter(x => selected.has(x.requirement_id)) : [];
    const screenshots = tables.has('screenshots') && tables.has('step_results') && tables.has('case_results')
      ? limited(db.prepare('SELECT s.id,s.artifact_ref,s.sha256,c.run_id FROM screenshots s JOIN step_results st ON st.id=s.step_result_id JOIN case_results c ON c.id=st.case_result_id LIMIT 10001').all(), 'screenshots').filter(x => runs.some(r => r.id === x.run_id)) : [];
    for (const v of versions) invariant(typeof v.raw_text === 'string' && digest(v.raw_text) === v.raw_sha256, 'LEGACY_DOCUMENT_HASH_MISMATCH', `Legacy document version failed hash validation: ${v.id}`);
    const snapshot = { schemaVersion: 1, requirements, features, documents, versions, heads, confirmations, runs, screenshots, excludedDeletedIds: deleted };
    invariant(Buffer.byteLength(json(snapshot)) <= 48 * 1024 * 1024, 'LEGACY_SIZE_LIMIT', 'Selected document history exceeds 48 MiB');
    db.exec('COMMIT'); return { ...snapshot, digest: identity(snapshot) };
  } finally { db.close(); }
}
export async function planLegacyImport(root, options, requirementIds) {
  await configuration(root);
  const snapshot = readLegacy(options.legacyFile, requirementIds), files = [], mapping = [], warnings = [];
  const usedRequirements = new Set();
  for (const requirement of snapshot.requirements) {
    let requirementId = stableId(requirement.requirement_key, 'REQ-LEGACY', requirement.id);
    if (usedRequirements.has(requirementId)) requirementId = `REQ-LEGACY-${identity(requirement.id).slice(0, 16)}`;
    usedRequirements.add(requirementId); id(requirementId);
    invariant(!await exists(await safePath(root, `spec/${requirementId}`)), 'LEGACY_DESTINATION_EXISTS', `Will not merge into existing ${requirementId}`, 409);
    const features = snapshot.features.filter(x => x.requirement_id === requirement.id), featureIds = new Set();
    invariant(features.length > 0, 'LEGACY_FEATURE_MISSING', `No feature for ${requirement.id}`);
    for (const feature of features) {
      let featureId = stableId(feature.feature_key, 'legacy', feature.id);
      if (featureIds.has(featureId)) featureId = `legacy-${identity(feature.id).slice(0, 16)}`;
      featureIds.add(featureId);
      const key = `${requirementId}/${featureId}`;
      const docs = snapshot.documents.filter(x => (x.feature_id ?? x.requirement_id) === feature.id);
      const versions = snapshot.versions.filter(x => docs.some(d => d.id === x.document_id));
      const head = kind => {
        const doc = docs.find(x => x.kind === kind), pointer = snapshot.heads.find(x => x.document_id === doc?.id);
        return versions.find(x => x.id === pointer?.version_id);
      };
      const gherkin = head('gherkin'), design = head('sd');
      invariant(gherkin, 'LEGACY_GHERKIN_MISSING', `Cannot invent a missing Gherkin head for ${feature.id}`);
      const add = (relative, content) => files.push({ path: relative, content });
      add(`spec/${key}/feature.yaml`, json({ schemaVersion: 1, id: featureId, requirementId, title: feature.feature_key, projectIds: [], caseIds: ['MIGRATION-REVIEW-REQUIRED'], profiles: ['chromium'] }));
      add(`spec/${key}/${featureId}.feature`, gherkin.raw_text);
      add(`spec/${key}/${featureId}.sd.md`, design?.raw_text ?? '# Imported requirement\n\nDesign is missing. Human review required.\n');
      add(`spec/${key}/_legacy/documents.json`, json({ schemaVersion: 1, sourceDigest: snapshot.digest, documents: docs.map(({ execution_config_json, ...d }) => d), versions, heads: snapshot.heads.filter(x => docs.some(d => d.id === x.document_id)), priorConfirmations: snapshot.confirmations.filter(x => (x.feature_id ?? x.requirement_id) === feature.id) }));
      add(`tests/${key}/${featureId}.steps.ts`, "// Imported source is archived as text, not automatically executed.\nthrow new Error('MIGRATION_REQUIRES_REVIEW: implement mapped BDD steps and case IDs before confirming tests');\n");
      add(`tests/${key}/${featureId}.hooks.ts`, '// Restore reviewed fixtures and lifecycle hooks here.\n');
      const testDocIds = docs.filter(x => x.kind === 'spec').map(x => x.id);
      for (const v of versions.filter(x => testDocIds.includes(x.document_id))) add(`tests/${key}/legacy/${identity(v.id).slice(0, 20)}.ts.txt`, v.raw_text);
      const legacyRuns = snapshot.runs.filter(x => (x.feature_id ?? x.requirement_id) === feature.id);
      for (const run of legacyRuns) {
        const runId = `LEGACY-${identity(run.id).slice(0, 20)}`, prefix = `reports/${key}/${runId}`, attachments = [];
        for (const image of snapshot.screenshots.filter(x => x.run_id === run.id)) {
          if (!options.legacyArtifactsRoot) { warnings.push(`Screenshot ${image.id}: source artifact root not configured`); continue; }
          try {
            const artifactRoot = await realpath(options.legacyArtifactsRoot);
            const relative = path.isAbsolute(image.artifact_ref) ? path.relative(artifactRoot, image.artifact_ref) : image.artifact_ref;
            const source = await safePath(artifactRoot, relative, { missing: false });
            invariant((await lstat(source)).size <= 32 * 1024 * 1024, 'LEGACY_ARTIFACT_TOO_LARGE', image.id);
            const bytes = await readFile(source); invariant(digest(bytes) === image.sha256, 'LEGACY_ARTIFACT_HASH_MISMATCH', image.id);
            const extension = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'png' : bytes[0] === 255 && bytes[1] === 216 ? 'jpg' : 'bin';
            const destination = `screenshots/${identity(image.id).slice(0, 20)}.${extension}`;
            add(`${prefix}/${destination}`, bytes); attachments.push({ path: destination, sha256: image.sha256, sourceId: image.id });
          } catch (error) { warnings.push(`Screenshot ${image.id}: ${error.code ?? 'UNREADABLE'}; original reference preserved`); }
        }
        add(`${prefix}/legacy.json`, json({ schemaVersion: 1, provenance: 'LEGACY_IMPORT', verification: 'UNKNOWN', sourceDigest: snapshot.digest, source: run, attachments,
          missingReferences: snapshot.screenshots.filter(x => x.run_id === run.id && !attachments.some(a => a.sourceId === x.id)).map(x => ({ id: x.id, sha256: x.sha256 })) }));
      }
      if (!legacyRuns.length) add(`reports/${key}/.gitkeep`, '');
      mapping.push({ sourceRequirementId: requirement.id, sourceFeatureId: feature.id, requirementId, featureId, versions: versions.length, runs: legacyRuns.length });
    }
    files.push({ path: `spec/${requirementId}/requirement.yaml`, content: json({ schemaVersion: 1, id: requirementId, title: requirement.requirement_key, features: [...featureIds].sort() }) });
    files.push({ path: `spec/${requirementId}/review.json`, content: json({ schemaVersion: 1, features: {} }) });
  }
  warnings.unshift('Imported tests remain blocked. Map case IDs, project bindings and hooks explicitly; old confirmations and PASSED states do not count as current verification.');
  const plan = await planFiles(root, files, { kind: 'legacy-import', sourceDigest: snapshot.digest, mapping, warnings });
  return { plan, snapshot };
}
export async function backupLegacySelection(home, snapshot) {
  const file = await safePath(home, `legacy-backups/${snapshot.digest}.json`);
  if (await exists(file)) invariant((await readJson(file, { maxBytes: 64 * 1024 * 1024 })).digest === snapshot.digest, 'LEGACY_BACKUP_CONFLICT', 'Existing backup differs');
  else await writeJson(file, snapshot);
  return { digest: snapshot.digest, selectionBackup: true, sourceDatabaseChanged: false };
}
