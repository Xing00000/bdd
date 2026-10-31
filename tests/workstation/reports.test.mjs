import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fixture, git, specRepository, approve, sealedBundle } from './helpers.mjs';
import { writeJson } from '../../packages/contracts/index.mjs';
import { prepareRun, assessEvidence, executeRun, verifyBundle, publishRun } from '../../packages/spec-toolkit/engine.mjs';

const plan = { schemaVersion: 1, runId: 'RUN-fixture', repositoryId: 'WS-fixture', requirementId: 'REQ-001', featureId: 'login', allCaseIds: ['CASE-001'], caseIds: ['CASE-001'], profiles: ['chromium'], testedSpecCommit: 'a'.repeat(40), scope: 'ALL_CASES' };
function receipt() {
  return { schemaVersion: 1, requirementId: 'REQ-001', featureId: 'login', definitions: [{ caseId: 'CASE-001', profile: 'chromium' }], errors: [], status: 'passed',
    cases: [{ caseId: 'CASE-001', profile: 'chromium', retry: 0, status: 'passed', expectedStatus: 'passed', assertions: 1, steps: [{ title: 'Then expected result', category: 'test.step' }], attachments: [{ path: 'screenshots/case/image.png', name: 'step-Then expected result' }] }] };
}
const passed = { exitCode: 0, timedOut: false, overflow: false };

test('candidate preparation requires a clean, committed, confirmed baseline', async t => {
  const f = await fixture(t); await mkdir(f.home); await specRepository(f.repo);
  await assert.rejects(prepareRun({ root: f.repo, home: f.home, repositoryId: 'WS-one', input: { requirementId: 'REQ-001', featureId: 'login', expected: await git.inspect(f.repo) }, git }), { code: 'REVIEWS_REQUIRED' });
  await approve(f.repo);
  const state = await git.inspect(f.repo);
  const result = await prepareRun({ root: f.repo, home: f.home, repositoryId: 'WS-one', input: { requirementId: 'REQ-001', featureId: 'login', expected: state }, git });
  assert.equal(result.testedSpecCommit, state.head); assert.equal(result.state, 'PREPARED');
  assert.equal(await git.resolve(path.join(f.home, 'executions', result.runId, 'repo')), state.head);
});
test('test success alone cannot prove deployment identity', () => {
  const result = assessEvidence(plan, receipt(), receipt(), passed, true, { verified: false });
  assert.equal(result.testOutcome, 'PASSED'); assert.equal(result.verification, 'NOT_VERIFIED'); assert.ok(result.reasons.includes('DEPLOYMENT_UNPROVEN'));
});
test('selected cases never qualify as complete requirement verification', () => {
  const result = assessEvidence({ ...plan, scope: 'SELECTED_CASES' }, receipt(), receipt(), passed, true, { verified: true });
  assert.equal(result.verification, 'NOT_VERIFIED'); assert.equal(result.coverageComplete, false);
});
test('zero, duplicate and skipped tests cannot be verified', () => {
  for (const mutate of [r => { r.cases = []; }, r => r.cases.push(r.cases[0]), r => { r.cases[0].status = 'skipped'; }]) {
    const execution = receipt(); mutate(execution);
    const result = assessEvidence(plan, receipt(), execution, passed, true, { verified: true }); assert.equal(result.verification, 'NOT_VERIFIED');
  }
});
test('missing assertions, screenshots, changed inputs and retry receipts cannot be verified', () => {
  for (const mutate of [r => { r.cases[0].assertions = 0; }, r => { r.cases[0].attachments = []; }, r => { r.cases[0].retry = 1; }]) {
    const execution = receipt(); mutate(execution);
    assert.equal(assessEvidence(plan, receipt(), execution, passed, true, { verified: true }).verification, 'NOT_VERIFIED');
  }
  assert.equal(assessEvidence(plan, receipt(), receipt(), passed, false, { verified: true }).verification, 'NOT_VERIFIED');
});
test('protocol-level complete receipts satisfy the policy (not a product E2E claim)', () => {
  assert.equal(assessEvidence(plan, receipt(), receipt(), passed, true, { verified: true }).verification, 'VERIFIED');
});
test('execution is opt-in and a mismatched workspace cannot access a run', async t => {
  const f = await fixture(t); await mkdir(f.home); await specRepository(f.repo); await approve(f.repo);
  const candidate = await prepareRun({ root: f.repo, home: f.home, repositoryId: 'WS-one', input: { requirementId: 'REQ-001', featureId: 'login', expected: await git.inspect(f.repo) }, git });
  await assert.rejects(executeRun({ home: f.home, repositoryId: 'WS-one', runId: candidate.runId, git }), { code: 'EXECUTION_DISABLED' });
  await assert.rejects(executeRun({ home: f.home, repositoryId: 'WS-other', runId: candidate.runId, git, enabled: true }), { code: 'RUN_REPOSITORY_MISMATCH' });
});
test('sealed bundles reject changed bytes and unexpected extra files', async t => {
  const f = await fixture(t), directory = path.join(f.base, 'bundle'); await sealedBundle(directory, plan);
  await verifyBundle(directory); await writeFile(path.join(directory, 'extra.txt'), 'unexpected');
  await assert.rejects(verifyBundle(directory), { code: 'EVIDENCE_FILE_SET_MISMATCH' });
  const second = path.join(f.base, 'second'); await sealedBundle(second, plan); await writeFile(path.join(second, 'report.json'), 'modified');
  await assert.rejects(verifyBundle(second), { code: 'EVIDENCE_HASH_MISMATCH' });
});
test('report commit R records tested S and does not disturb the developer workspace', async t => {
  const f = await fixture(t); await mkdir(f.home); await specRepository(f.repo); const testedSpecCommit = await git.resolve(f.repo);
  const directory = path.join(f.home, 'executions', plan.runId); await mkdir(directory, { recursive: true });
  const runPlan = { ...plan, testedSpecCommit, state: 'SEALED' }; await writeJson(path.join(directory, 'plan.json'), runPlan);
  await sealedBundle(path.join(directory, 'evidence'), runPlan);
  const file = path.join(f.repo, 'spec/REQ-001/login/login.sd.md'); await writeFile(file, 'uncommitted development draft');
  const before = await git.inspect(f.repo);
  const publication = await publishRun({ root: f.repo, home: f.home, repositoryId: plan.repositoryId, runId: plan.runId, git });
  assert.notEqual(publication.reportCommit, testedSpecCommit); assert.equal(publication.testedSpecCommit, testedSpecCommit);
  assert.deepEqual(await git.inspect(f.repo), before); assert.equal(await readFile(file, 'utf8'), 'uncommitted development draft');
  const publisher = path.join(f.home, 'publishers', plan.runId, 'repo');
  assert.equal((await git.command(publisher, ['rev-parse', 'HEAD^'])).stdout.trim(), testedSpecCommit);
  const paths = (await git.command(publisher, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'])).stdout.trim().split('\n');
  assert.ok(paths.every(p => p.startsWith('reports/')));
  const again = await publishRun({ root: f.repo, home: f.home, repositoryId: plan.repositoryId, runId: plan.runId, git });
  assert.equal(again.reportCommit, publication.reportCommit);
});
test('report push is explicit, uses an evidence branch and is independently retryable', async t => {
  const f = await fixture(t); await mkdir(f.home); await specRepository(f.repo);
  await git.command(undefined, ['init', '--bare', '--initial-branch', 'main', f.remote]); await git.command(f.repo, ['remote', 'add', 'origin', f.remote]);
  await git.push(f.repo, { branch: 'main' }, await git.inspect(f.repo)); const testedSpecCommit = await git.resolve(f.repo);
  const directory = path.join(f.home, 'executions', plan.runId); await mkdir(directory, { recursive: true });
  const runPlan = { ...plan, testedSpecCommit, state: 'SEALED' }; await writeJson(path.join(directory, 'plan.json'), runPlan); await sealedBundle(path.join(directory, 'evidence'), runPlan);
  const local = await publishRun({ root: f.repo, home: f.home, repositoryId: plan.repositoryId, runId: plan.runId, git }); assert.equal(local.status, 'LOCAL_COMMIT');
  const pushed = await publishRun({ root: f.repo, home: f.home, repositoryId: plan.repositoryId, runId: plan.runId, git, push: true }); assert.equal(pushed.status, 'PUBLISHED'); assert.equal(pushed.reportCommit, local.reportCommit);
  assert.equal((await git.command(undefined, ['--git-dir', f.remote, 'rev-parse', 'refs/heads/main'])).stdout.trim(), testedSpecCommit);
});

test('real playwright-bdd hook titles omit keywords while reporter steps include them', () => {
  const execution = receipt();
  execution.cases[0].steps = [
    { title: 'Given the website is open', category: 'test.step' },
    { title: 'When I sign in', category: 'test.step' },
    { title: 'Then I am signed in', category: 'test.step' }
  ];
  execution.cases[0].attachments = ['the website is open', 'I sign in', 'I am signed in'].map((title, i) => ({ path: `screenshots/case/${i}.png`, name: `step-${title}` }));
  assert.equal(assessEvidence(plan, receipt(), execution, passed, true, { verified: true }).verification, 'VERIFIED');
  execution.cases[0].attachments.pop();
  assert.equal(assessEvidence(plan, receipt(), execution, passed, true, { verified: true }).verification, 'NOT_VERIFIED');
});
test('repeated step titles cannot reuse the same screenshot as multiple pieces of evidence', () => {
  const execution = receipt();
  execution.cases[0].steps = [
    { title: 'Given a repeated action', category: 'test.step' },
    { title: 'Then a repeated action', category: 'test.step' }
  ];
  execution.cases[0].attachments = [{ path: 'screenshots/one.png', name: 'step-a repeated action' }];
  assert.equal(assessEvidence(plan, receipt(), execution, passed, true, { verified: true }).evidenceComplete, false);
  execution.cases[0].attachments.push({ path: 'screenshots/two.png', name: 'step-a repeated action' });
  assert.equal(assessEvidence(plan, receipt(), execution, passed, true, { verified: true }).evidenceComplete, true);
});
