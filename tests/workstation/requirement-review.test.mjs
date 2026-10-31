import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { exists } from '../../packages/contracts/index.mjs';
import { generateRequirement, requirementDiagnostics, requirementSuggestions } from '../../packages/workstation/requirements.mjs';
import { createWorkstation } from '../../packages/workstation/service.mjs';
import { fixture, toolkitRoot } from './helpers.mjs';

async function authoring(t) {
  const f = await fixture(t);
  const service = await createWorkstation({autoAcquire:false, home: f.home, toolkitRoot, allowLocal: true });
  t.after(() => service.close());
  const repositoryId = 'SPEC-review';
  service.register({ id: repositoryId, title: 'Human review', remoteUrl: path.join(f.base, 'offline.git') });
  let sequence = 0;
  const job = async (operation, input) => {
    const request = { schemaVersion: 1, operationId: `REVIEW-${++sequence}`, repositoryId, operation, input };
    service.enqueue(request);
    return service.wait(request.operationId);
  };
  assert.equal((await job('repository.setup', { reviewer: 'Xing', projects: [] })).status, 'SUCCEEDED');
  const save = async gherkin => {
    const saved = await job('workflow.requirement.save', {
      description: '需求由使用者確認；儲存不依賴 Git。', gherkin,
      expectedToken: null, editorKey: `new-${sequence}`,
    });
    assert.equal(saved.status, 'SUCCEEDED', JSON.stringify(saved.error));
    return saved.result;
  };
  const approve = async saved => {
    const feature = (await service.detail(repositoryId)).spec.features.find(x => x.key === saved.key);
    return job('workflow.review', {
      requirementId: saved.requirementId, featureId: saved.featureId,
      stage: 'gherkin', expectedDigest: feature.review.hashes.gherkin,
    });
  };
  return { ...f, service, repositoryId, save, approve };
}

const specification = (step = 'Then 已顯示結果', extra = '') =>
  `Feature: 人工審閱\n${extra}\n  @case:CASE-001\n  Scenario: 內容由人決定\n    Given 已開啟產品\n    When 使用者操作\n    ${step}\n`;

test('legacy generated outcome text does not veto an explicit human approval', async t => {
  const f = await authoring(t), source = specification('Then 請補充可驗收的結果');
  const saved = await f.save(source), result = await f.approve(saved);
  assert.equal(result.status, 'SUCCEEDED', JSON.stringify(result.error));
  const feature = (await f.service.detail(f.repositoryId)).spec.features[0];
  assert.equal(feature.review.confirmed.gherkin, true);
  assert.equal(feature.review.stage, 'SD');
  assert.equal(feature.verification.status, 'NOT_RUN', 'Human approval is not an execution or a pass');
  assert.equal((await f.service.requirement(f.repositoryId, saved.requirementId, saved.featureId)).gherkin, source);
  assert.equal(await exists(path.join(f.home, 'repositories', f.repositoryId, 'repo')), false);
});

test('quoted guard text in comments, doc strings and expected UI text never blocks confirmation', async t => {
  const f = await authoring(t);
  for (const source of [
    specification('Then 已顯示結果', '  # Then 請補充可驗收的結果 是舊版錯誤文案'),
    specification('Then 顯示說明\n      """\n      Then 請補充可驗收的結果\n      """'),
    specification('Then 請補充可驗收的結果這段提示已從介面移除'),
  ]) {
    const saved = await f.save(source), result = await f.approve(saved);
    assert.equal(result.status, 'SUCCEEDED', JSON.stringify(result.error));
  }
});

test('valid Gherkin styles need not repeat When and Then in every scenario', async t => {
  const f = await authoring(t);
  for (const source of [
    'Feature: 靜態資料\n  Scenario: 查核版本\n    Given 有版本資訊\n    Then 版本正確\n',
    'Feature: 清單\n  Scenario: 資料存在\n    * 一筆資料存在\n    * 另一筆資料存在\n',
    'Feature: 共用操作\n  Background:\n    When 開啟頁面\n  Scenario: 顯示結果\n    Then 顯示首頁\n',
  ]) {
    assert.deepEqual(requirementDiagnostics(source), []);
    const saved = await f.save(source), result = await f.approve(saved);
    assert.equal(result.status, 'SUCCEEDED', JSON.stringify(result.error));
  }
});

test('incomplete uploaded Gherkin can generate an editable draft instead of losing source', () => {
  const source = 'Feature: 還在寫的需求\n';
  const result = generateRequirement(source);
  assert.equal(result.gherkin, source);
  assert.equal(result.draft, true);
  assert.ok(result.diagnostics.some(x => x.message.includes('Scenario')));
});

test('syntax failures preserve saved SQLite content and identify a line rather than judging business meaning', async t => {
  const f = await authoring(t);
  const source = 'Feature: 未完成\n  Scenario: 尚未寫步驟\n';
  const saved = await f.save(source), result = await f.approve(saved);
  assert.equal(result.status, 'FAILED');
  assert.equal(result.error.code, 'GHERKIN_INVALID');
  assert.match(result.error.message, /第 2 行/);
  assert.equal((await f.service.requirement(f.repositoryId, saved.requirementId, saved.featureId)).gherkin, source);
  assert.equal((await f.service.detail(f.repositoryId)).spec.features[0].review.confirmed.gherkin, false);
});


test('suggestions are line-specific and ignore quoted content outside an exact old scaffold step', () => {
  const source = specification('Then 請補充可驗收的結果');
  assert.deepEqual(requirementDiagnostics(source), []);
  const suggestions = requirementSuggestions(source);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].line, 7);
  assert.equal(suggestions[0].code, 'LEGACY_PLACEHOLDER');
  assert.match(suggestions[0].message, /不會阻擋/);
  for (const text of [
    specification('Then 已顯示結果', '  # Then 請補充可驗收的結果'),
    specification('Then 顯示說明\n      """\n      Then 請補充可驗收的結果\n      """'),
    specification('Then 顯示說明\n      ```\n      Then 請補充可驗收的結果\n      ```'),
    specification('Then 請補充可驗收的結果這段提示已從介面移除'),
  ]) assert.deepEqual(requirementSuggestions(text), []);
});
