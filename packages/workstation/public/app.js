const $ = selector => document.querySelector(selector);
const apiRoot = '/repository-api/v1';
let workspaceId, detail, editorFile, gitState, selectedFeature, capabilities, upgradePlan, legacyPlan;
function notify(message, error = false) { $('#notice').textContent = message; $('#notice').classList.toggle('error', error); }
function el(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
function button(label, action) { const node = el('button', label); node.type = 'button'; node.addEventListener('click', () => safely(action)); return node; }
async function safely(action) { try { await action(); } catch (error) { notify(error.message, true); } }
async function api(route, method = 'GET', body) {
  const response = await fetch(apiRoot + route, { method, headers: { 'content-type': 'application/json', 'x-workbench-request': '1' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json(); if (!response.ok) throw new Error(`${value.code}: ${value.message}`); return value;
}
function currentFeature() { return detail?.spec?.features.find(x => x.key === selectedFeature); }
async function loadList() {
  const list = await api('/workspaces'); $('#workspaces').replaceChildren();
  for (const item of list) $('#workspaces').append(button(item.title, () => selectWorkspace(item.id)));
}
async function selectWorkspace(value) { workspaceId = value; selectedFeature = undefined; editorFile = null; $('#editor').value = ''; await refresh(); }
async function refresh() {
  if (!workspaceId) return;
  detail = await api(`/workspaces/${workspaceId}`);
  $('#workspace').hidden = false; $('#empty').hidden = true;
  $('#workspace-title').textContent = detail.title;
  $('#head').textContent = `${typeof detail.state === 'object' ? detail.state.branch ?? 'DETACHED' : detail.state} · ${detail.state?.head ?? '尚無 Commit'} · ${detail.remoteUrl}`;
  $('#structure-error').textContent = [detail.specError, detail.moduleError].filter(Boolean).map(x => `${x.code}: ${x.message}`).join('\n');
  for (const node of document.querySelectorAll('[data-op]')) {
    const operation = node.dataset.op;
    node.disabled = operation === 'workspace.clone' ? detail.state !== 'NOT_CLONED' : operation === 'workspace.initialize' ? detail.initialized || detail.state === 'NOT_CLONED' : !detail.initialized;
  }
  const features = detail.spec?.features ?? [];
  if (!features.some(f => f.key === selectedFeature)) selectedFeature = features[0]?.key;
  $('#feature-select').replaceChildren(...features.map(f => new Option(`${f.requirementId} / ${f.id} — ${f.title}`, f.key)));
  if (selectedFeature) $('#feature-select').value = selectedFeature;
  updateFeature(); renderProjects(); renderRuns(); renderOperations(); renderTransactions();
}
function updateFeature() {
  const f = currentFeature();
  $('#feature-stage').textContent = f ? `階段：${f.review.stage} · 驗收：${f.verification?.status ?? 'NOT_RUN'} · 案例：${f.caseIds.join(', ')} · 瀏覽器：${f.profiles.join(', ')}` : '尚無 Feature';
  const options = f ? [`spec/${f.key}/${f.id}.feature`, `spec/${f.key}/${f.id}.sd.md`, `tests/${f.key}/${f.id}.steps.ts`, `tests/${f.key}/${f.id}.hooks.ts`, `spec/${f.key}/feature.yaml`] : [];
  $('#file-select').replaceChildren(...options.map(name => new Option(name, name)));
}
async function operation(name, input = {}, { target, expected } = {}) {
  if (!workspaceId) throw new Error('請先選擇工作區');
  const request = { schemaVersion: 1, operationId: `OP-${crypto.randomUUID()}`, workspaceId, operation: name, input,
    expected: expected ?? (typeof detail.state === 'object' ? { head: detail.state.head, branch: detail.state.branch, fingerprint: detail.state.fingerprint } : { head: null }), ...(target ? { target } : {}) };
  const accepted = await api('/operations', 'POST', request); notify(`已建立 ${accepted.id}：${name}`);
  let result = accepted;
  while (['QUEUED', 'RUNNING', 'CANCELLING'].includes(result.status)) { await new Promise(resolve => setTimeout(resolve, 800)); result = await api(`/operations/${accepted.id}`); }
  await refresh();
  if (result.status !== 'SUCCEEDED') throw new Error(`${result.status} / ${result.error?.code}: ${result.error?.message}`);
  notify(`${name} 完成；未明確選擇 Push 的操作不會上傳遠端。`); return result.result;
}
function targetOptions() { const projectId = $('#git-target').value; return projectId ? { kind: 'project', projectId } : { kind: 'spec' }; }
async function inspectGit() {
  const projectId = $('#git-target').value;
  const value = await api(`/workspaces/${workspaceId}/git${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`); gitState = value.state;
  $('#changed-files').replaceChildren();
  for (const change of gitState.changes) {
    const label = el('label', undefined, 'file-row'), input = document.createElement('input'); input.type = 'checkbox'; input.value = change.path;
    label.append(input, el('code', `${change.code} ${change.path}`)); $('#changed-files').append(label);
  }
  $('#diff').textContent = `Branch: ${gitState.branch}\nHEAD: ${gitState.head}\n\nSTAGED\n${value.staged}\nUNSTAGED\n${value.unstaged}`;
}
function renderProjects() {
  $('#modules').replaceChildren();
  for (const m of detail.modules ?? []) {
    const card = el('div', undefined, 'card'); card.append(el('h4', m.path), el('code', `固定 ${m.commit} / 目前 ${m.actual ?? '尚未初始化'}`));
    card.append(button('固定另一個 Commit', async () => {
      const commit = prompt('輸入完整 commit SHA（先 Fetch / Push 產品版本）'); if (!commit) return;
      await operation('submodule.pin', { projectId: m.id, commit });
    }));
    card.append(button('移除引用', async () => {
      if (confirm(`只移除 ${m.path} 的 Spec Repo 引用；不刪除遠端 Repo。繼續？`)) await operation('submodule.remove', { projectId: m.id });
    })); $('#modules').append(card);
  }
  const previous = $('#git-target').value;
  $('#git-target').replaceChildren(new Option('Spec Repo', ''), ...(detail.modules ?? []).map(m => new Option(m.path, m.id)));
  if ([...$('#git-target').options].some(x => x.value === previous)) $('#git-target').value = previous;
  gitState = null;
}
function artifactUrl(runId, file, reportKey) { return `${apiRoot}/workspaces/${workspaceId}/runs/${runId}/artifact?path=${encodeURIComponent(file)}${reportKey ? '&reportKey=' + encodeURIComponent(reportKey) : ''}`; }
async function showReport(runId, reportKey) {
  const response = await fetch(artifactUrl(runId, 'manifest.json', reportKey)), manifest = await response.json();
  if (!response.ok) throw new Error(manifest.message);
  const view = $('#report-view'); view.replaceChildren(el('h3', `報告 ${runId}`), el('pre', JSON.stringify(manifest, null, 2)));
  const gallery = el('div', undefined, 'gallery');
  for (const file of manifest.artifacts.filter(a => a.path.startsWith('screenshots/'))) {
    const link = el('a'); link.href = artifactUrl(runId, file.path, reportKey); link.target = '_blank'; link.rel = 'noopener';
    const image = document.createElement('img'); image.src = link.href; image.alt = file.path; image.loading = 'lazy'; link.append(image); gallery.append(link);
  }
  view.append(gallery);
  const download = el('a', '取得 HTML 報告'); download.href = artifactUrl(runId, 'report.html', reportKey); download.download = 'report.html'; view.append(download);
}
function renderRuns() {
  $('#run-list').replaceChildren();
  for (const entry of detail.reports ?? []) {
    const card = el('div', undefined, 'card');
    card.append(el('h4', entry.key), el('span', entry.invalidReason ?? 'GIT_INDEXED', 'badge'), el('p', `來源：${entry.ref} · 報告版本 ${entry.reportCommit}`));
    if (!entry.invalidReason) card.append(button('檢視 Git 報告與截圖', () => showReport(entry.runId, entry.key)));
    $('#run-list').append(card);
  }
  for (const run of detail.runs ?? []) {
    const card = el('div', undefined, 'card'), result = run.result;
    card.append(el('h4', run.id), el('span', run.state, 'badge'), el('span', result.testOutcome ?? '尚未執行', 'badge'), el('span', result.verification ?? 'NOT_VERIFIED', 'badge'), el('p', `受測版本：${result.testedSpecCommit}`));
    if (run.state === 'PREPARED') card.append(button('執行驗收', () => operation('run.execute', { runId: run.id })));
    if (run.state === 'SEALED') {
      card.append(button('檢視報告與截圖', () => showReport(run.id)), button('建立獨立報告 Commit', () => operation('run.publish', { runId: run.id, push: false })), button('Push 報告分支', async () => {
        if (confirm('確認報告、截圖與 logs 未包含機密；將 Push 到 evidence 分支，不修改 main。繼續？')) await operation('run.publish', { runId: run.id, push: true });
      }));
    }
    $('#run-list').append(card);
  }
}
function renderOperations() {
  $('#operation-list').replaceChildren();
  for (const operation of detail.operations ?? []) {
    const item = el('details'), summary = el('summary', `${operation.status} · ${operation.request.operation} · ${operation.created_at}`);
    item.append(summary, el('pre', JSON.stringify({ id: operation.id, result: operation.result, error: operation.error }, null, 2)));
    if (['QUEUED', 'RUNNING'].includes(operation.status)) item.append(button('取消', async () => { await api(`/operations/${operation.id}/cancel`, 'POST', {}); await refresh(); }));
    $('#operation-list').append(item);
  }
}
async function openFile(relative) { editorFile = await api(`/workspaces/${workspaceId}/file?path=${encodeURIComponent(relative)}`); $('#file-path').textContent = editorFile.path; $('#editor').value = editorFile.content; }
$('#register').addEventListener('submit', event => { event.preventDefault(); safely(async () => {
  const data = Object.fromEntries(new FormData(event.target)); if (!data.branch) delete data.branch;
  const item = await api('/workspaces', 'POST', data); await loadList(); await selectWorkspace(item.id);
}); });
$('#refresh').addEventListener('click', () => safely(refresh));
for (const node of document.querySelectorAll('[data-op]')) node.addEventListener('click', () => safely(() => operation(node.dataset.op)));
for (const node of document.querySelectorAll('[data-tab]')) node.addEventListener('click', () => { for (const tab of document.querySelectorAll('.tab')) tab.hidden = tab.id !== node.dataset.tab; for (const button of document.querySelectorAll('[data-tab]')) button.classList.toggle('active', button === node); });
$('#feature-select').addEventListener('change', event => { selectedFeature = event.target.value; updateFeature(); });
$('#create-feature').addEventListener('submit', event => { event.preventDefault(); safely(async () => { const data = Object.fromEntries(new FormData(event.target)); data.projectIds = data.projects.split(',').map(x => x.trim()).filter(Boolean); delete data.projects; await operation('spec.feature.create', data); }); });
$('#add-project').addEventListener('submit', event => { event.preventDefault(); safely(() => operation('submodule.add', Object.fromEntries(new FormData(event.target)))); });
$('#open-file').addEventListener('click', () => safely(() => openFile($('#file-select').value)));
$('#open-config').addEventListener('click', () => safely(() => openFile('workbench.yaml')));
$('#save-file').addEventListener('click', () => safely(async () => { if (!editorFile) throw new Error('請先開啟檔案'); const file = editorFile.path; await operation('spec.file.save', { path: file, content: $('#editor').value, expectedHash: editorFile.sha256 }); await openFile(file); }));
for (const node of document.querySelectorAll('[data-review]')) node.addEventListener('click', () => safely(async () => {
  const feature = currentFeature(); if (!feature) throw new Error('請選擇 Feature');
  if (!confirm(`確認已審閱 ${feature.key} 的 ${node.dataset.review} 與相關來源？`)) return;
  await operation('spec.review.confirm', { requirementId: feature.requirementId, featureId: feature.id, stage: node.dataset.review, expectedDigest: feature.review.hashes[node.dataset.review], confirmedBy: $('#reviewer').value });
}));
$('#inspect-git').addEventListener('click', () => safely(inspectGit));
$('#git-target').addEventListener('change', () => { gitState = null; });
$('#create-branch').addEventListener('click', () => safely(async () => { if (!gitState) await inspectGit(); await operation('git.branch', { name: $('#branch-name').value, create: true }, { target: targetOptions(), expected: gitState }); await inspectGit(); }));
$('#commit-selected').addEventListener('click', () => safely(async () => {
  if (!gitState) throw new Error('請先讀取變更'); const paths = [...document.querySelectorAll('#changed-files input:checked')].map(x => x.value);
  await operation('git.commit', { paths, message: $('#commit-message').value }, { target: targetOptions(), expected: gitState }); await inspectGit();
}));
$('#push').addEventListener('click', () => safely(async () => { if (!gitState) await inspectGit(); if (confirm(`Push ${gitState.branch} 的 ${gitState.head}？`)) await operation('git.push', { branch: gitState.branch }, { target: targetOptions(), expected: gitState }); }));
$('#prepare-run').addEventListener('click', () => safely(async () => {
  const feature = currentFeature(); if (!feature) throw new Error('請先選擇 Feature');
  const cases = $('#selected-cases').value.trim(); await operation('run.prepare', { requirementId: feature.requirementId, featureId: feature.id, ...(cases ? { caseIds: cases.split(',').map(x => x.trim()) } : {}) });
}));
await safely(async () => {
  capabilities = await api('/capabilities'); $('#execution-policy').textContent = capabilities.executionEnabled ? '受信任 Worker 執行已啟用；此程序不是 OS sandbox。' : '程式執行預設關閉。請在隔離環境設定 WB_ENABLE_TRUSTED_EXECUTION=1。';
  await loadList(); notify('已連線。Git Push、人工確認與測試執行都是獨立操作。');
});

function renderTransactions() {
  $('#transactions').replaceChildren();
  for (const transaction of detail.transactions ?? []) {
    const card = el('div', undefined, 'card');
    card.append(el('h4', transaction.transactionId), el('span', transaction.status, 'badge'), el('p', transaction.metadata.kind));
    if (transaction.status !== 'APPLIED') card.append(button('檢查並續做', () => operation('workspace.transaction.resume', { transactionId: transaction.transactionId })));
    $('#transactions').append(card);
  }
}
function legacySelection() { const value = $('#legacy-selection').value.trim(); return value ? { requirementIds: value.split(',').map(x => x.trim()).filter(Boolean) } : {}; }
$('#reindex-reports').addEventListener('click', () => safely(async () => {
  const result = await operation('reports.reindex');
  notify(`已索引 ${result.indexed.length} 份報告；${result.errors.length} 項錯誤。此操作不切換分支或修改工作區。`, result.errors.length > 0);
}));
$('#preview-upgrade').addEventListener('click', () => safely(async () => {
  upgradePlan = await operation('workspace.upgrade.preview'); $('#maintenance-plan').textContent = JSON.stringify(upgradePlan, null, 2); $('#apply-upgrade').disabled = upgradePlan.changed === 0;
}));
$('#apply-upgrade').addEventListener('click', () => safely(async () => {
  if (upgradePlan && confirm('套用預覽的工具升級？既有規格／測試與鎖定依賴不會被覆寫；測試確認需要重檢。')) {
    await operation('workspace.upgrade.apply', { planDigest: upgradePlan.digest }); upgradePlan = null; $('#apply-upgrade').disabled = true;
  }
}));
$('#preview-legacy').addEventListener('click', () => safely(async () => {
  legacyPlan = { selection: legacySelection(), preview: await operation('legacy.preview', legacySelection()) };
  $('#maintenance-plan').textContent = JSON.stringify(legacyPlan.preview, null, 2); $('#apply-legacy').disabled = false;
}));
$('#apply-legacy').addEventListener('click', () => safely(async () => {
  if (legacyPlan && confirm('匯入所選原始文件與歷史封存？舊 DB 保持不變，舊確認與通過狀態不視為新驗收，所有測試需人工重新接線。匯入內容請審查機密後再提交。')) {
    await operation('legacy.import', { ...legacyPlan.selection, planDigest: legacyPlan.preview.digest, acknowledgeUnverified: true }); legacyPlan = null; $('#apply-legacy').disabled = true;
  }
}));
$('#legacy-policy').textContent = capabilities?.legacyImport ? '已設定唯讀舊 DB 來源；只匯入所選需求，不搬移帳密與站台設定。' : '伺服器尚未設定 WB_LEGACY_DB。不能從瀏覽器傳入任意檔案路徑。';
$('#preview-legacy').disabled = !capabilities?.legacyImport;
