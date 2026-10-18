import { test, createBdd } from 'playwright-bdd';
import { expect, type Page } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const { Given, When, Then } = createBdd(test);

type ScenarioState = {
  baseUrl: string;
  mcpUrl: string;
  tempRoot: string;
  workspaceDir: string;
  targetDbFile: string;
  projectId: string;
  connectionId: string;
  requirementId: string;
  requirementKey: string;
  featureId: string;
  featureKey: string;
  gherkinDocId: string;
  gherkinVersionId: string;
  gherkinSha256: string;
  sdDocId: string;
  mcpSessionId: string;
  initResult?: any;
  toolsListResult?: any;
  lastToolResult?: any;
  lastProposalResponse?: any;
  skeletonVersionId?: string;
  skeletonSha256?: string;
  skeletonRawText?: string;
  bundleDirectory?: string;
};

const states = new WeakMap<Page, ScenarioState>();

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

const sampleGherkin = `# language: en
Feature: 訂單狀態查詢
  系統支援依訂單狀態查詢並回傳對應筆數。

  Rule: 可依狀態篩選訂單

    @AC-ORD-001
    Scenario Outline: 依狀態查詢訂單清單
      Given 系統已有測試訂單資料
      When 使用者查詢狀態為 "<status>" 的訂單
      Then 系統回傳 "<expected_count>" 筆訂單紀錄

      Examples:
        | case_id | status  | expected_count |
        | paid    | PAID    | 2              |
        | pending | PENDING | 1              |
`;

const validSampleSd = `# 訂單狀態查詢 系統設計文件（SD）

## 1. 核准基準與文件歸屬

- **需求編號**：\`REQ-MCP\`
- **驗收條件對應**：\`@AC-ORD-001\`（案例 \`paid\`、\`pending\`）

## 2. 核心範圍與技術選擇

- TypeScript (ESM) 與 SQLite 訂單查詢服務。

## 3. 架構、開發目錄與流程設計

\`\`\`text
workspace/
└── src/
    └── order-service.ts
\`\`\`

## 4. 階段、確認與失效

- Gherkin 確認後進入 SD 階段，SD 確認後產生測試骨架。

## 5. 文件與測試的權威來源

- 單一權威來源為已確認之 Gherkin 與 SD 版本。

## 6. 入庫檢核、正規化與穩定識別

- 依 \`@AC-ORD-001\` 與 \`case_id\` (\`paid\`、\`pending\`) 建立穩定映射。

## 7. 資料庫 DDL／DML 與 migration

\`\`\`sql
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  total_cents INTEGER NOT NULL
);
SELECT COUNT(*) AS count FROM orders WHERE status = ?;
\`\`\`

## 8. 核心 API、事件與可觀察結果

- \`countOrdersByStatus(status)\` 回傳符合狀態的訂單筆數。

## 9. 同會話瀏覽器、親自錄製與重播

- 本需求不適用同會話瀏覽器錄製：僅涉及訂單狀態查詢。

## 10. Workspace、PTY 與執行生命週期

- CLI Agent 透過工作台內建 MCP 工具讀取工作區與提交 SD 提案。

## 11. codegen 與 BDD 補齊設計

- 由 \`playwright-bdd\` 產生測試骨架並透過 MCP 補齊步驟。

## 12. DB UI、人類流程測試及報告

- 透過 SQLite Target DB Schema 工具檢視 \`orders\` 資料表結構。

## 13. 實作順序、驗收覆蓋與待確認事項

- 覆蓋 \`@AC-ORD-001\` 之 \`paid\` 與 \`pending\` 案例，無待確認事項。

## 14. 驗收測試契約

- 驗證查詢 \`PAID\` 回傳 2 筆、\`PENDING\` 回傳 1 筆。
`;

async function callJsonRpc(mcpUrl: string, method: string, params: Record<string, unknown>, sessionId?: string) {
  const response = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(sessionId ? { 'x-workbench-mcp-session': sessionId } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: randomUUID(),
      method,
      params,
    }),
  });
  expect(response.status).toBe(200);
  return response.json();
}

async function callMcpTool(state: ScenarioState, name: string, args: Record<string, unknown>) {
  const rpcResponse = await callJsonRpc(
    state.mcpUrl,
    'tools/call',
    { name, arguments: args },
    state.mcpSessionId,
  );
  const result = rpcResponse.result;
  const payload = JSON.parse(String(result?.content?.[0]?.text ?? '{}'));
  return { rpcResponse, result, payload };
}

Given(new RegExp('^需求已關聯綁定本機目錄與SQLite測試資料庫的工作區且已完成Gherkin確認$'), async ({ page }) => {
  const baseUrl = (process.env.WB_BASE_URL ?? 'http://127.0.0.1:4173').replace(/\/+$/, '');
  const mcpUrl = `${baseUrl}/mcp`;
  const suffix = randomUUID().slice(0, 8);
  const tempRoot = await mkdtemp(join(tmpdir(), `wb-mcp-bdd-${suffix}-`));
  const workspaceDir = join(tempRoot, 'workspace');
  await mkdir(join(workspaceDir, 'src'), { recursive: true });
  await writeFile(
    join(workspaceDir, 'src', 'order-service.ts'),
    'export function countOrdersByStatus(status: string): number {\n  return status === "PAID" ? 2 : 1;\n}\n',
    'utf8',
  );
  await writeFile(join(tempRoot, 'outside-secret.txt'), 'TOP_SECRET_OUTSIDE_WORKSPACE\n', 'utf8');

  const targetDbFile = join(workspaceDir, 'target-orders.sqlite');
  const db = new DatabaseSync(targetDbFile);
  db.exec(`
    CREATE TABLE orders (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      total_cents INTEGER NOT NULL
    );
    CREATE INDEX idx_orders_status ON orders(status);
    INSERT INTO orders (id, status, total_cents) VALUES ('ord-1', 'PAID', 1200), ('ord-2', 'PAID', 2400), ('ord-3', 'PENDING', 800);
  `);
  db.close();

  const projectRes = await page.request.post(`${baseUrl}/projects`, {
    data: { name: `MCP Workspace ${suffix}`, workspaceRef: workspaceDir },
  });
  expect(projectRes.status()).toBe(201);
  const project = await projectRes.json();

  const connRes = await page.request.post(`${baseUrl}/projects/${project.id}/db-connections`, {
    data: { sqliteFileRef: targetDbFile, environmentLabel: 'mcp-test', appBaseUrl: baseUrl },
  });
  expect(connRes.status()).toBe(201);
  const connection = await connRes.json();

  const requirementKey = `REQ-MCP-${suffix.toUpperCase()}`;
  const reqRes = await page.request.post(`${baseUrl}/requirements`, {
    data: { requirementKey, title: `MCP BDD Requirement ${suffix}`, projectIds: [project.id] },
  });
  expect(reqRes.status()).toBe(201);
  const createdReq = await reqRes.json();

  const gherkinDocId = String(createdReq.documents.gherkin.id);
  const sdDocId = String(createdReq.documents.sd.id);
  const saveGherkinRes = await page.request.post(`${baseUrl}/documents/${gherkinDocId}/versions`, {
    data: { rawText: sampleGherkin },
  });
  expect(saveGherkinRes.status()).toBe(201);
  const savedGherkin = await saveGherkinRes.json();

  const confirmGherkinRes = await page.request.post(`${baseUrl}/requirements/${createdReq.id}/confirm-gherkin`, {
    data: {
      featureId: createdReq.featureId,
      versionId: savedGherkin.versionId,
      rawSha256: savedGherkin.rawSha256,
    },
  });
  expect(confirmGherkinRes.status()).toBe(200);

  states.set(page, {
    baseUrl,
    mcpUrl,
    tempRoot,
    workspaceDir,
    targetDbFile,
    projectId: String(project.id),
    connectionId: String(connection.id),
    requirementId: String(createdReq.id),
    requirementKey,
    featureId: String(createdReq.featureId),
    featureKey: String(createdReq.featureKey),
    gherkinDocId,
    gherkinVersionId: String(savedGherkin.versionId),
    gherkinSha256: String(savedGherkin.rawSha256),
    sdDocId,
    mcpSessionId: `mcp-session-${suffix}`,
  });

  await page.goto(`${baseUrl}/requirements/${createdReq.id}`);
  await expect(page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage', 'SD');
});

When(new RegExp('^使用者啟動已指派的階段Agent並連線工作台內建MCP服務$'), async ({ page }) => {
  const state = states.get(page)!;
  state.initResult = await callJsonRpc(state.mcpUrl, 'initialize', { protocolVersion: '2024-11-05' }, state.mcpSessionId);
  expect(Boolean(state.initResult?.result?.capabilities?.prompts)).toBe(true);
  state.toolsListResult = await callJsonRpc(state.mcpUrl, 'tools/list', {}, state.mcpSessionId);
  const toolNames = (state.toolsListResult?.result?.tools ?? []).map((t: any) => String(t.name));
  expect(toolNames).toContain('workbench_get_agent_prompt');
  expect(toolNames).toContain('workbench_get_context');
  expect(toolNames).toContain('workbench_get_gherkin_structure');
  expect(toolNames).toContain('workbench_list_project_files');
  expect(toolNames).toContain('workbench_read_project_file');
  expect(toolNames).toContain('workbench_get_db_schema');
  expect(toolNames).toContain('workbench_submit_sd');
  expect(toolNames).toContain('workbench_submit_test_completion');
  await page.goto(`${state.baseUrl}/requirements/${state.requirementId}`);
  await expect(page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage', 'SD');
});

Then(new RegExp('^CLI Agent可透過MCP取得目前階段指派Agent對應的資料庫Prompt與Skill指引$'), async ({ page }) => {
  const state = states.get(page)!;
  const promptsList = await callJsonRpc(state.mcpUrl, 'prompts/list', {}, state.mcpSessionId);
  const promptNames = (promptsList?.result?.prompts ?? []).map((p: any) => String(p.name));
  expect(promptNames).toContain('workbench_stage_prompt');

  const wfGet = await page.request.get(`${state.baseUrl}/workflow-settings`);
  expect(wfGet.status()).toBe(200);
  const wfData = await wfGet.json();
  const sdStage = (wfData.stages ?? []).find((s: any) => s.key === 'SD');
  const expectedAgentId = sdStage?.agentIds?.[0];
  const expectedAgent = (wfData.agents ?? []).find((a: any) => a.id === expectedAgentId);
  expect(Boolean(expectedAgent)).toBe(true);

  const { result, payload } = await callMcpTool(state, 'workbench_get_agent_prompt', {
    requirementId: state.requirementId,
    featureId: state.featureId,
    stage: 'SD',
  });
  expect(result.isError).toBe(false);
  expect(payload.stage).toBe('SD');
  expect(payload.agentId).toBe(expectedAgent.id);
  expect(payload.agentName).toBe(expectedAgent.name);
  expect(payload.prompt).toBe(expectedAgent.prompt);
  expect(String(payload.composedPrompt)).toContain(expectedAgent.prompt);

  const promptGet = await callJsonRpc(
    state.mcpUrl,
    'prompts/get',
    {
      name: 'workbench_stage_prompt',
      arguments: { requirementId: state.requirementId, featureId: state.featureId, stage: 'SD' },
    },
    state.mcpSessionId,
  );
  expect(String(promptGet?.result?.messages?.[0]?.content?.text ?? '')).toContain(expectedAgent.prompt);
  expect(promptGet?.result?.agent?.prompt).toBe(expectedAgent.prompt);
  await expect(page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage', 'SD');
});

Then(new RegExp('^CLI Agent可透過MCP工具讀取目前需求階段狀態與已確認Gherkin及現有SD文件$'), async ({ page }) => {
  const state = states.get(page)!;
  const { result, payload } = await callMcpTool(state, 'workbench_get_context', {
    requirementId: state.requirementId,
    featureId: state.featureId,
  });
  expect(result.isError).toBe(false);
  expect(payload.requirementId).toBe(state.requirementId);
  expect(payload.requirementKey).toBe(state.requirementKey);
  expect(payload.featureId).toBe(state.featureId);
  expect(payload.stage).toBe('SD');
  expect(payload.confirmations.gherkin.versionId).toBe(state.gherkinVersionId);
  expect(payload.confirmations.gherkin.rawSha256).toBe(state.gherkinSha256);
  expect(String(payload.documents.gherkin.rawText)).toContain('@AC-ORD-001');
  expect(payload.documents.sd.id).toBe(state.sdDocId);
  await expect(page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage', 'SD');
});

Then(new RegExp('^CLI Agent可透過MCP工具查詢結構化Gherkin情境、步驟與Examples案例對應$'), async ({ page }) => {
  const state = states.get(page)!;
  const { result, payload } = await callMcpTool(state, 'workbench_get_gherkin_structure', {
    requirementId: state.requirementId,
    featureId: state.featureId,
  });
  expect(result.isError).toBe(false);
  expect(payload.versionId).toBe(state.gherkinVersionId);
  const scenarios = payload.structure?.scenarios ?? [];
  expect(scenarios.length).toBe(1);
  expect(scenarios[0].scenarioKey).toBe('AC-ORD-001');
  const caseKeys = (payload.structure?.sourceCases ?? []).map((c: any) => String(c.caseKey));
  expect(caseKeys).toEqual(['paid', 'pending']);
  const stepTexts = (payload.structure?.steps ?? []).map((s: any) => String(s.text));
  expect(stepTexts).toContain('系統已有測試訂單資料');
  expect(Array.isArray(payload.scenarioTests?.cases)).toBe(true);
  await expect(page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage', 'SD');
});

Then(new RegExp('^CLI Agent可透過MCP工具列出並讀取關聯工作區內的專案檔案且拒絕越界路徑$'), async ({ page }) => {
  const state = states.get(page)!;
  const listCall = await callMcpTool(state, 'workbench_list_project_files', {
    requirementId: state.requirementId,
    featureId: state.featureId,
    projectId: state.projectId,
  });
  expect(listCall.result.isError).toBe(false);
  expect(listCall.payload.files).toContain('src/order-service.ts');

  const readCall = await callMcpTool(state, 'workbench_read_project_file', {
    requirementId: state.requirementId,
    featureId: state.featureId,
    projectId: state.projectId,
    path: 'src/order-service.ts',
  });
  expect(readCall.result.isError).toBe(false);
  expect(String(readCall.payload.rawText)).toContain('countOrdersByStatus');
  expect(readCall.payload.sha256).toBe(sha256(String(readCall.payload.rawText)));

  const escapeCall = await callMcpTool(state, 'workbench_read_project_file', {
    requirementId: state.requirementId,
    featureId: state.featureId,
    projectId: state.projectId,
    path: '../outside-secret.txt',
  });
  expect(escapeCall.result.isError).toBe(true);
  expect(escapeCall.payload.error.code).toBe('WORKSPACE_PATH_INVALID');
  await expect(page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage', 'SD');
});

Then(new RegExp('^CLI Agent可透過MCP工具查詢關聯專案SQLite測試資料庫的實際Schema$'), async ({ page }) => {
  const state = states.get(page)!;
  const schemaCall = await callMcpTool(state, 'workbench_get_db_schema', {
    requirementId: state.requirementId,
    featureId: state.featureId,
    projectId: state.projectId,
    connectionId: state.connectionId,
  });
  expect(schemaCall.result.isError).toBe(false);
  const connections = schemaCall.payload.connections ?? [];
  expect(connections.length).toBe(1);
  const ordersTable = (connections[0].schema?.tables ?? connections[0].tables ?? []).find((t: any) => t.name === 'orders');
  expect(Boolean(ordersTable)).toBe(true);
  const columnNames = (ordersTable?.columns ?? []).map((c: any) => String(c.name));
  expect(columnNames).toEqual(['id', 'status', 'total_cents']);
  expect(String(ordersTable?.sql ?? '')).toContain('CREATE TABLE orders');
  await expect(page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage', 'SD');
});

Given(new RegExp('^需求目前處於系統設計階段且已啟動系統設計Agent的MCP會話$'), async ({ page }) => {
  const state = states.get(page)!;
  await page.goto(`${state.baseUrl}/requirements/${state.requirementId}?featureId=${state.featureId}&workflowStage=SD`);
  await expect(page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage', 'SD');
});

When(new RegExp('^CLI Agent透過MCP工具提交缺少必要章節的無效SD提案$'), async ({ page }) => {
  const state = states.get(page)!;
  state.lastToolResult = await callMcpTool(state, 'workbench_submit_sd', {
    requirementId: state.requirementId,
    featureId: state.featureId,
    status: 'completed',
    rawText: '# 只有標題但缺少必要章節的無效SD\n',
  });
  await expect(page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage', 'SD');
});

Then(new RegExp('^MCP工具即時回傳SD格式檢核錯誤供同一CLI會話修正且不保存無效版本$'), async ({ page }) => {
  const state = states.get(page)!;
  expect(state.lastToolResult.result.isError).toBe(true);
  expect(state.lastToolResult.payload.error.code).toBe('SD_FORMAT_INVALID');
  expect((state.lastToolResult.payload.error.diagnostics ?? []).length).toBeGreaterThan(0);

  const reqRes = await page.request.get(`${state.baseUrl}/requirements/${state.requirementId}?featureId=${state.featureId}`);
  expect(reqRes.status()).toBe(200);
  const currentReq = await reqRes.json();
  expect(currentReq.documents.sd.versionId).toBeNull();
  await expect(page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage', 'SD');
});

When(new RegExp('^CLI Agent透過MCP工具提交資訊不足的待補問題清單$'), async ({ page }) => {
  const state = states.get(page)!;
  state.lastToolResult = await callMcpTool(state, 'workbench_submit_sd', {
    requirementId: state.requirementId,
    featureId: state.featureId,
    status: 'needs_input',
    questions: ['請確認訂單狀態查詢是否需要支援分頁參數？'],
  });
  await expect(page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage', 'SD');
});

Then(new RegExp('^工作台記錄待補問題供人類檢視且維持系統設計階段未確認$'), async ({ page }) => {
  const state = states.get(page)!;
  expect(state.lastToolResult.result.isError).toBe(false);
  expect(state.lastToolResult.payload.status).toBe('needs_input');
  expect(state.lastToolResult.payload.questions).toEqual(['請確認訂單狀態查詢是否需要支援分頁參數？']);

  const reqRes = await page.request.get(`${state.baseUrl}/requirements/${state.requirementId}?featureId=${state.featureId}`);
  expect(reqRes.status()).toBe(200);
  const currentReq = await reqRes.json();
  expect(currentReq.stage).toBe('SD');
  expect(currentReq.confirmations.sd ?? null).toBeNull();
  expect(currentReq.questions).toEqual(['請確認訂單狀態查詢是否需要支援分頁參數？']);
  await expect(page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage', 'SD');
});

When(new RegExp('^CLI Agent透過MCP工具提交符合統一格式的完整SD提案$'), async ({ page }) => {
  const state = states.get(page)!;
  const agentScript = join(state.tempRoot, 'mcp-sd-agent.mjs');
  const sdPayloadFile = join(state.tempRoot, 'valid-sd.md');
  await writeFile(sdPayloadFile, validSampleSd, 'utf8');
  await writeFile(
    agentScript,
    `import { readFileSync } from 'node:fs';
console.log('MCP SD Agent ready');
await new Promise(resolve => setTimeout(resolve, 120));
const mcpConfig = JSON.parse(readFileSync('.mcp.json', 'utf8'));
const serverEntry = mcpConfig.mcpServers['bdd-workbench'];
const mcpUrl = serverEntry.env.WB_MCP_URL;
const sessionId = serverEntry.env.WB_MCP_SESSION;
const promptRes = await fetch(mcpUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-workbench-mcp-session': sessionId },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 'sd-prompt-1',
    method: 'tools/call',
    params: { name: 'workbench_get_agent_prompt', arguments: {} }
  })
});
const promptBody = await promptRes.json();
const promptPayload = JSON.parse(promptBody.result?.content?.[0]?.text ?? '{}');
if (promptBody.result?.isError || !String(promptPayload.prompt ?? '').includes('workbench_submit_sd')) {
  console.error('Failed to retrieve agent prompt via MCP:', promptBody);
  process.exit(1);
}
const sdText = readFileSync(${JSON.stringify(sdPayloadFile)}, 'utf8');
const res = await fetch(mcpUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-workbench-mcp-session': sessionId },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 'sd-submit-1',
    method: 'tools/call',
    params: { name: 'workbench_submit_sd', arguments: { status: 'completed', rawText: sdText } }
  })
});
const body = await res.json();
if (body.result?.isError) {
  console.error(body.result.content?.[0]?.text);
  process.exit(1);
}
setTimeout(() => process.exit(0), 500);
`,
    'utf8',
  );

  const cmdRes = await page.request.post(`${state.baseUrl}/llm-settings/cli-commands`, {
    data: { name: `MCP SD CLI ${state.requirementKey}`, executable: process.execPath, args: [agentScript] },
  });
  expect(cmdRes.status()).toBe(201);
  const cmd = await cmdRes.json();

  const agentRes = await page.request.post(`${state.baseUrl}/llm-settings/agents`, {
    data: {
      name: `MCP SD Agent ${state.requirementKey}`,
      cliCommandId: cmd.id,
      skillId: null,
      prompt: 'Use workbench_submit_sd MCP tool to submit the SD document.',
    },
  });
  expect(agentRes.status()).toBe(201);
  const agent = await agentRes.json();

  const wfGet = await page.request.get(`${state.baseUrl}/workflow-settings`);
  const wfCurrent = await wfGet.json();
  const originalAssignments = Object.fromEntries((wfCurrent.stages ?? []).map((s: any) => [s.key, s.agentIds]));
  const assignments = { ...originalAssignments, SD: [agent.id] };
  const wfSave = await page.request.put(`${state.baseUrl}/workflow-settings`, { data: { assignments } });
  expect(wfSave.status()).toBe(200);

  try {
    const generateRes = await page.request.post(`${state.baseUrl}/requirements/${state.requirementId}/generate-sd`, {
      data: { featureId: state.featureId, agentId: agent.id },
    });
    expect(generateRes.status()).toBe(200);
    state.lastProposalResponse = await generateRes.json();
    if (state.lastProposalResponse?.terminal?.terminalId) {
      await page.request.delete(`${state.baseUrl}/terminals/${state.lastProposalResponse.terminal.terminalId}`);
    }
  } finally {
    await page.request.put(`${state.baseUrl}/workflow-settings`, { data: { assignments: originalAssignments } });
    await page.request.delete(`${state.baseUrl}/llm-settings/agents/${agent.id}`);
    await page.request.delete(`${state.baseUrl}/llm-settings/cli-commands/${cmd.id}`);
  }
  await page.goto(`${state.baseUrl}/requirements/${state.requirementId}?featureId=${state.featureId}&workflowStage=SD`);
  await expect(page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage', 'SD');
});

Then(new RegExp('^工作台保存新的SD版本並完成本次系統設計CLI提案流程$'), async ({ page }) => {
  const state = states.get(page)!;
  expect(state.lastProposalResponse?.status).toBe('completed');
  expect(Boolean(state.lastProposalResponse?.versionId)).toBe(true);

  const reqRes = await page.request.get(`${state.baseUrl}/requirements/${state.requirementId}?featureId=${state.featureId}`);
  expect(reqRes.status()).toBe(200);
  const currentReq = await reqRes.json();
  expect(currentReq.documents.sd.versionId).toBe(state.lastProposalResponse.versionId);
  expect(String(currentReq.documents.sd.rawText)).toContain('## 1. 核准基準與文件歸屬');
  expect(String(currentReq.documents.sd.rawText)).toContain('## 7. 資料庫 DDL／DML 與 migration');
  expect(currentReq.questions).toEqual([]);
  await page.goto(`${state.baseUrl}/requirements/${state.requirementId}?featureId=${state.featureId}&workflowStage=SD`);
  await expect(page.getByTestId('sd-editor')).toHaveValue(/1\. 核准基準與文件歸屬/);
});

Given(new RegExp('^需求已確認SD並產生測試骨架且已啟動測試情境Agent的MCP會話$'), async ({ page }) => {
  const state = states.get(page)!;
  const saveSdRes = await page.request.post(`${state.baseUrl}/documents/${state.sdDocId}/versions`, {
    data: { rawText: validSampleSd, sourceGherkinVersionId: state.gherkinVersionId },
  });
  expect(saveSdRes.status()).toBe(201);
  const savedSd = await saveSdRes.json();

  const confirmSdRes = await page.request.post(`${state.baseUrl}/requirements/${state.requirementId}/confirm-sd`, {
    data: {
      featureId: state.featureId,
      versionId: savedSd.versionId,
      rawSha256: savedSd.rawSha256,
    },
  });
  expect(confirmSdRes.status()).toBe(200);
  const afterConfirm = await confirmSdRes.json();
  expect(afterConfirm.stage).toBe('TESTS');
  expect(afterConfirm.documents.spec.testStage).toBe('SKELETON');

  state.skeletonVersionId = String(afterConfirm.documents.spec.versionId);
  state.skeletonSha256 = String(afterConfirm.documents.spec.rawSha256);
  state.skeletonRawText = String(afterConfirm.documents.spec.rawText);
  state.bundleDirectory = String(afterConfirm.documents.spec.manifest.bundleDirectory);

  await page.goto(`${state.baseUrl}/requirements/${state.requirementId}?featureId=${state.featureId}&workflowStage=TESTS`);
  await expect(page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage', 'TESTS');
});

When(new RegExp('^CLI Agent透過MCP工具提交刪除既有workbenchTestId或型別錯誤的測試補齊提案$'), async ({ page }) => {
  const state = states.get(page)!;
  const mutatedSpec = String(state.skeletonRawText).replace(/workbenchTestId/g, 'removedTestId');
  state.lastToolResult = await callMcpTool(state, 'workbench_submit_test_completion', {
    requirementId: state.requirementId,
    featureId: state.featureId,
    status: 'completed',
    rawText: mutatedSpec,
  });
  await expect(page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage', 'TESTS');
});

Then(new RegExp('^MCP工具即時回傳映射或編譯檢核診斷供同一CLI會話修正且不覆蓋有效測試版本$'), async ({ page }) => {
  const state = states.get(page)!;
  expect(state.lastToolResult.result.isError).toBe(true);
  expect(state.lastToolResult.payload.error.code).toBe('LLM_ACCEPTANCE_CHANGED');
  expect((state.lastToolResult.payload.error.diagnostics ?? []).length).toBeGreaterThan(0);

  const reqRes = await page.request.get(`${state.baseUrl}/requirements/${state.requirementId}?featureId=${state.featureId}`);
  expect(reqRes.status()).toBe(200);
  const currentReq = await reqRes.json();
  expect(currentReq.documents.spec.versionId).toBe(state.skeletonVersionId);
  expect(currentReq.documents.spec.rawSha256).toBe(state.skeletonSha256);
  expect(currentReq.documents.spec.testStage).toBe('SKELETON');
  await expect(page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage', 'TESTS');
});

When(new RegExp('^CLI Agent透過MCP工具提交保留完整測試ID映射且通過檢核的測試補齊提案$'), async ({ page }) => {
  const state = states.get(page)!;
  const completedStepsText = `import { test, createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

const { Given, When, Then } = createBdd(test);

Given(new RegExp("^系統已有測試訂單資料$"), async ({ page }) => {
  await page.goto(${JSON.stringify(state.baseUrl)});
});

When(new RegExp('^使用者查詢狀態為 "(.+?)" 的訂單$'), async ({ page }, status: string) => {
  await page.goto(${JSON.stringify(state.baseUrl)} + '/?status=' + encodeURIComponent(status));
});

Then(new RegExp('^系統回傳 "(.+?)" 筆訂單紀錄$'), async ({ page }, expectedCount: string) => {
  await expect(page.locator('body')).toContainText(expectedCount);
});
`;
  const stepsFilePath = `${state.bundleDirectory}/${state.featureKey}.steps.ts`;
  const specPayloadFile = join(state.tempRoot, 'completed-spec.ts');
  const stepsPayloadFile = join(state.tempRoot, 'completed-steps.ts');
  await writeFile(specPayloadFile, String(state.skeletonRawText), 'utf8');
  await writeFile(stepsPayloadFile, completedStepsText, 'utf8');

  const agentScript = join(state.tempRoot, 'mcp-tests-agent.mjs');
  await writeFile(
    agentScript,
    `import { readFileSync } from 'node:fs';
console.log('MCP Tests Agent ready');
await new Promise(resolve => setTimeout(resolve, 120));
const mcpConfig = JSON.parse(readFileSync('.mcp.json', 'utf8'));
const serverEntry = mcpConfig.mcpServers['bdd-workbench'];
const mcpUrl = serverEntry.env.WB_MCP_URL;
const sessionId = serverEntry.env.WB_MCP_SESSION;
const promptRes = await fetch(mcpUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-workbench-mcp-session': sessionId },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 'tests-prompt-1',
    method: 'tools/call',
    params: { name: 'workbench_get_agent_prompt', arguments: {} }
  })
});
const promptBody = await promptRes.json();
const promptPayload = JSON.parse(promptBody.result?.content?.[0]?.text ?? '{}');
if (promptBody.result?.isError || !String(promptPayload.prompt ?? '').includes('workbench_submit_test_completion')) {
  console.error('Failed to retrieve agent prompt via MCP:', promptBody);
  process.exit(1);
}
const rawText = readFileSync(${JSON.stringify(specPayloadFile)}, 'utf8');
const stepsText = readFileSync(${JSON.stringify(stepsPayloadFile)}, 'utf8');
const res = await fetch(mcpUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-workbench-mcp-session': sessionId },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 'tests-submit-1',
    method: 'tools/call',
    params: {
      name: 'workbench_submit_test_completion',
      arguments: {
        status: 'completed',
        rawText,
        files: [{ path: ${JSON.stringify(stepsFilePath)}, rawText: stepsText }]
      }
    }
  })
});
const body = await res.json();
if (body.result?.isError) {
  console.error(body.result.content?.[0]?.text);
  process.exit(1);
}
setTimeout(() => process.exit(0), 500);
`,
    'utf8',
  );

  const cmdRes = await page.request.post(`${state.baseUrl}/llm-settings/cli-commands`, {
    data: { name: `MCP Tests CLI ${state.requirementKey}`, executable: process.execPath, args: [agentScript] },
  });
  expect(cmdRes.status()).toBe(201);
  const cmd = await cmdRes.json();

  const agentRes = await page.request.post(`${state.baseUrl}/llm-settings/agents`, {
    data: {
      name: `MCP Tests Agent ${state.requirementKey}`,
      cliCommandId: cmd.id,
      skillId: null,
      prompt: 'Use workbench_submit_test_completion MCP tool to submit completed Playwright-BDD tests.',
    },
  });
  expect(agentRes.status()).toBe(201);
  const agent = await agentRes.json();

  const wfGet = await page.request.get(`${state.baseUrl}/workflow-settings`);
  const wfCurrent = await wfGet.json();
  const originalAssignments = Object.fromEntries((wfCurrent.stages ?? []).map((s: any) => [s.key, s.agentIds]));
  const assignments = { ...originalAssignments, TESTS: [agent.id] };
  const wfSave = await page.request.put(`${state.baseUrl}/workflow-settings`, { data: { assignments } });
  expect(wfSave.status()).toBe(200);

  try {
    const completeRes = await page.request.post(`${state.baseUrl}/requirements/${state.requirementId}/complete-tests`, {
      data: { featureId: state.featureId, agentId: agent.id },
    });
    expect(completeRes.status()).toBe(200);
    state.lastProposalResponse = await completeRes.json();
    if (state.lastProposalResponse?.terminal?.terminalId) {
      await page.request.delete(`${state.baseUrl}/terminals/${state.lastProposalResponse.terminal.terminalId}`);
    }
  } finally {
    await page.request.put(`${state.baseUrl}/workflow-settings`, { data: { assignments: originalAssignments } });
    await page.request.delete(`${state.baseUrl}/llm-settings/agents/${agent.id}`);
    await page.request.delete(`${state.baseUrl}/llm-settings/cli-commands/${cmd.id}`);
  }
  await page.goto(`${state.baseUrl}/requirements/${state.requirementId}?featureId=${state.featureId}&workflowStage=TESTS`);
  await expect(page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage', 'TESTS');
});

Then(new RegExp('^工作台保存COMPLETED測試版本並完成本次測試補齊CLI提案流程$'), async ({ page }) => {
  const state = states.get(page)!;
  expect(state.lastProposalResponse?.status).toBe('completed');
  expect(state.lastProposalResponse?.testStage).toBe('COMPLETED');
  expect(state.lastProposalResponse?.checks?.passed).toBe(true);

  const reqRes = await page.request.get(`${state.baseUrl}/requirements/${state.requirementId}?featureId=${state.featureId}`);
  expect(reqRes.status()).toBe(200);
  const currentReq = await reqRes.json();
  expect(currentReq.documents.spec.testStage).toBe('COMPLETED');
  expect(currentReq.documents.spec.versionId).not.toBe(state.skeletonVersionId);
  await page.goto(`${state.baseUrl}/requirements/${state.requirementId}?featureId=${state.featureId}&workflowStage=TESTS`);
  await expect(page.getByTestId('confirm-test-steps')).toBeEnabled();
});

