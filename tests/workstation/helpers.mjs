import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createGit } from '../../packages/git-core/index.mjs';
import { initialize, createFeature, reviewState, confirm } from '../../packages/spec-toolkit/index.mjs';
import { writeJson, digest } from '../../packages/contracts/index.mjs';
export const toolkitRoot = fileURLToPath(new URL('../..', import.meta.url));
export const git = createGit({ allowLocal: true });
export async function fixture(t) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'bdd-workstation-test-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  return { base, repo: path.join(base, 'repo'), home: path.join(base, 'home'), remote: path.join(base, 'remote.git') };
}
export async function repository(directory, files = { 'readme.txt': 'initial\n' }) {
  await git.init(directory);
  for (const [relative, text] of Object.entries(files)) { const file = path.join(directory, relative); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, text); }
  await git.commitSelected(directory, { paths: Object.keys(files), message: 'Initial fixture' }, { head: null, branch: 'main' });
  return git.resolve(directory);
}
export async function commitAll(directory, message = 'Fixture change') {
  const state = await git.inspect(directory);
  const paths = [...new Set(state.changes.flatMap(x => [x.path, ...(x.originalPath ? [x.originalPath] : [])]))];
  return git.commitSelected(directory, { paths, message }, { head: state.head, branch: state.branch });
}
export async function specRepository(directory) {
  await git.init(directory);
  await initialize(directory, { specRepositoryId: 'fixture-spec', toolkitRoot: path.join(toolkitRoot, 'packages'), templateRoot: path.join(toolkitRoot, 'templates/spec-repo/v1') });
  await createFeature(directory, { requirementId: 'REQ-001', featureId: 'login', title: 'Fixture login' });
  // This lockfile is a protocol-test fixture, not an installed product dependency lock.
  await writeJson(path.join(directory, 'package-lock.json'), { name: 'fixture', lockfileVersion: 3, packages: {} });
  await commitAll(directory, 'Initial spec fixture');
}
export async function approve(directory) {
  for (const stage of ['gherkin', 'sd', 'tests']) {
    const state = await reviewState(directory, 'REQ-001', 'login');
    await confirm(directory, { requirementId: 'REQ-001', featureId: 'login', stage, expectedDigest: state.hashes[stage], confirmedBy: 'Protocol test reviewer' });
  }
  await commitAll(directory, 'Confirm fixture input');
}
export async function sealedBundle(directory, plan, extra = {}) {
  await mkdir(directory, { recursive: true });
  const text = JSON.stringify({ testOutcome: 'FAILED', verification: 'NOT_VERIFIED', label: 'Tooling fixture only' });
  await writeFile(path.join(directory, 'report.json'), text);
  const manifest = { schemaVersion: 1, ...plan, ...extra, artifacts: [{ path: 'report.json', size: Buffer.byteLength(text), sha256: digest(text) }] };
  await writeJson(path.join(directory, 'manifest.json'), manifest);
  await writeJson(path.join(directory, 'seal.json'), { schemaVersion: 1, manifestSha256: digest(await readFile(path.join(directory, 'manifest.json'))) });
  return manifest;
}
