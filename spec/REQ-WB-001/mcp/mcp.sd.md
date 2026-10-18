# REQ-WB-001 / mcp 系統設計文件（System Design）

- **需求編號**：`REQ-WB-001`
- **功能識別（Feature Key）**：`mcp`
- **Gherkin 路徑**：`spec/REQ-WB-001/mcp/mcp.feature`
- **來源 Gherkin SHA-256**：`e42ef2b8c8c769f8ccdd13517b8fefa9adac4392c8f32705172e669e89d480f9`
- **SD 版本**：`0.2`
- **審核狀態**：已由人類批准（Approved）

## 1. 核准基準與文件歸屬

本系統設計文件（`spec/REQ-WB-001/mcp/mcp.sd.md`）專屬對應已確認的 `spec/REQ-WB-001/mcp/mcp.feature`（SHA-256：`e42ef2b8c8c769f8ccdd13517b8fefa9adac4392c8f32705172e669e89d480f9`），涵蓋驗收情境 `@AC-WB-MCP-001`、`@AC-WB-MCP-002` 與 `@AC-WB-MCP-003`。本文件與 `spec/REQ-WB-001/workbench/workbench.sd.md` 共同隸屬 `REQ-WB-001`，各自管理獨立的 `.feature`、`.sd.md`、`.steps.ts` 與 `.feature.spec.ts`。

## 2. 核心範圍與技術選擇

1. **核心範圍**：
   - 為互動式 CLI Agent（Codex CLI、Kiro CLI 等）提供工作台內建 Model Context Protocol（MCP，JSON-RPC 2.0）服務、Prompt 介面與工具集。
   - 支援 CLI Agent 透過 MCP 工具（`workbench_get_agent_prompt`、`workbench_get_context`）與 MCP 原生 Prompts 協議（`prompts/list`、`prompts/get`）取得目前階段指派 Agent 在資料庫中設定的專屬 Prompt、綁定 Skill 指引與階段任務指示。
   - 支援查詢需求階段狀態、已確認 Gherkin、現有 SD、結構化 Gherkin 情境／步驟／Examples、關聯工作區安全檔案清單與檔案內容，以及關聯專案 SQLite 測試資料庫的實際 Schema。
   - 支援透過 MCP 工具即時檢核並提交系統設計（SD）提案、待補問題（`needs_input`）與測試步驟補齊（`TESTS`）提案；檢核失敗時即時回傳結構化診斷供同一 CLI 會話修正，不覆蓋既有有效版本。
2. **技術選擇**：
   - 執行環境：Node.js 24（ESM）+ TypeScript 5.9。
   - 傳輸介面：提供標準 JSON-RPC 2.0 MCP Server（支援 in-process Session 呼叫、Fastify HTTP `POST /mcp` 端點，以及供 CLI 子程序掛載的 stdio MCP 入口 `src/adapters/mcp/stdio.ts`）。
   - 檢核器與設定重用：直接重用 canonical owner（`llmSettings`、`workflowSettings`、`validateSdFormat`、`declaredIds`、`syntax`、`generation.generator.validateCompletion`、`workspace.readSource` 與 `runtime.targetDb.schema`），不建立平行規則。

## 3. 架構、開發目錄與流程設計

```text
spec/REQ-WB-001/mcp/
├── mcp.feature                  # [新增] 已核准的 MCP 驗收規格（3 個 Scenario）
├── mcp.sd.md                    # [新增] 本系統設計文件
├── mcp.steps.ts                 # [新增] MCP 驗收步驟定義
├── mcp.feature.spec.ts          # [新增] 由 playwright-bdd 生成並轉換之唯讀測試規格
└── bdd.config.ts                # [新增] 專屬 playwright-bdd 生成與執行設定
src/
├── adapters/
│   ├── mcp/
│   │   ├── server.ts            # [新增] 工作台內建 MCP 工具與 Prompt 註冊、JSON-RPC 2.0 處理與即時檢核邏輯
│   │   └── stdio.ts             # [新增] CLI Agent 標準輸入輸出（stdio）MCP 轉接入口
│   └── generation/
│       ├── cli.ts               # [修改] 啟動 CLI 時注入 MCP 設定與說明，支援透過 MCP 取得 Prompt 與提交提案
│       └── types.ts             # [修改] 擴充 CLI 提案會話與 MCP 上下文型別
├── application/
│   └── extensions.ts            # [修改] 串接 MCP 會話上下文與待補問題／版本保存流程
└── http/
    └── server.ts                # [修改] 掛載 POST /mcp JSON-RPC 2.0 端點並共享工作台服務
```

- **控制與資料流**：
  1. 使用者啟動階段 Agent 時，工作台建立綁定 `(requirementId, featureId, projectId, stage, agentId)` 的 MCP 會話上下文，並在 CLI 工作目錄寫入 `.mcp.json` 與環境變數（`WB_MCP_URL`、`WB_MCP_SESSION`）。
  2. CLI Agent 透過 MCP `prompts/list`、`prompts/get` 或 `tools/call`（`workbench_get_agent_prompt`）讀取目前流程階段指派 Agent 在 SQLite `llm_agents` 與 `llm_skills` 設定的資料庫 Prompt 及 Skill 指引，並可呼叫查詢工具（`workbench_get_context`、`workbench_get_gherkin_structure`、`workbench_list_project_files`、`workbench_read_project_file`、`workbench_get_db_schema`）。
  3. CLI Agent 呼叫 `workbench_submit_sd` 或 `workbench_submit_test_completion` 時，MCP 服務先執行語法、章節格式或測試 ID 映射與編譯檢核：
     - 檢核失敗：回傳 `isError: true` 與結構化 `diagnostics`，不寫入 `proposal.ready`、不變更 SQLite 既有版本，CLI 會話保持開啟供 Agent 立即修正。
     - 檢核通過：將提案寫入 SQLite 新版本（或記錄 `needs_input` 待補問題）並同步完成 `proposal.json` + `proposal.ready` 發佈。

## 4. 階段、確認與失效

- `workbench_get_agent_prompt` 與 `prompts/get` 依據目前會話或參數指定的流程階段（`GHERKIN`、`SD`、`TESTS`、`IMPLEMENTATION`）與 `agentId`，由 `workflow_agent_assignments` 與 `llm_agents` 讀取對應的 Agent Prompt 與 Skill 指引。
- `workbench_submit_sd` 僅允許在需求 Feature 處於 `SD` 階段且 Gherkin 已確認時提交；提交 `status="needs_input"` 時僅記錄待補問題，階段維持 `SD` 未確認；提交 `status="completed"` 且通過 `validateSdFormat` 時保存新 SD 版本，仍需人類按下確認才進入 `TESTS`。
- `workbench_submit_test_completion` 僅允許在需求 Feature 處於 `TESTS` 階段、Gherkin 與 SD 已確認且已有 `SKELETON` 時提交；檢核失敗時不覆蓋既有有效版本，通過時保存為 `COMPLETED` 版本。

## 5. 文件與測試的權威來源

- 階段指派 Agent 設定、Prompt 與 Skill 以工作台 SQLite（`llm_agents`、`llm_skills`、`llm_cli_commands`、`workflow_agent_assignments`）為權威來源。
- Gherkin、SD 與生成測試版本以工作台 SQLite（`documents`、`document_versions`、`document_heads`）及本專案 Git `spec/REQ-WB-001/mcp/` 為權威來源。
- MCP 查詢工具與 Prompt 介面直接讀取上述 canonical store 與綁定工作區檔案系統，不快取過期副本。

## 6. 入庫檢核、正規化與穩定識別

- **SD 格式檢核**：呼叫 `validateSdFormat(rawText, 'proposal.sd.md')` 驗證 14 個固定章節標題、順序、第 3 節目錄結構區塊與第 7 節 SQL 區塊。
- **測試補齊檢核**：呼叫 `syntax()`、`declaredIds()` 與 `generation.generator.validateCompletion()` 驗證所有既有 `workbenchTestId` 未被刪除或重複、來源映射完整，且通過 TypeScript typecheck 與 Playwright 探索。
- **工作區路徑檢核**：呼叫 `realpath` 與相對路徑邊界檢查，拒絕 `..`、絕對路徑或指向工作區外的符號連結（回傳 `WORKSPACE_PATH_INVALID`）。

## 7. 資料庫 DDL／DML 與 migration

本功能重用既有工作台 SQLite schema（SQLite 3，WAL 模式）的 `llm_agents`、`llm_skills`、`llm_cli_commands`、`workflow_agent_assignments`、`requirements`、`features`、`documents`、`document_versions`、`document_heads`、`scenarios`、`steps`、`source_cases`、`test_case_mappings` 與 `target_connections` 資料表，無需新增資料表結構，亦不需要新增部署 seed/backfill DML。相關查詢與版本寫入之參數化 DML 如下：

```sql
-- 讀取流程階段指派之 Agent 與其資料庫 Prompt / Skill（供 workbench_get_agent_prompt 與 prompts/get 使用）
SELECT a.id, a.name, a.cli_command_id AS cliCommandId, a.skill_id AS skillId, a.prompt,
       c.name AS cliName, c.executable, c.args_json AS argsJson,
       s.name AS skillName, s.instructions AS skillInstructions
FROM workflow_agent_assignments w
JOIN llm_agents a ON a.id = w.agent_id
JOIN llm_cli_commands c ON c.id = a.cli_command_id
LEFT JOIN llm_skills s ON s.id = a.skill_id
WHERE w.stage = ?
ORDER BY w.position;

-- 讀取關聯專案測試資料庫連線（供 workbench_get_db_schema 使用）
SELECT c.id, c.project_id AS projectId, c.sqlite_file_ref AS sqliteFileRef,
       c.environment_label AS environmentLabel, c.app_base_url AS appBaseUrl
FROM target_connections c
JOIN requirement_projects rp ON rp.project_id = c.project_id
WHERE rp.requirement_id = ?;

-- 保存通過檢核之 SD 或 COMPLETED spec 新版本（於單一交易內寫入並更新 head）
INSERT INTO document_versions(
  id, document_id, version_no, raw_text, raw_sha256,
  source_gherkin_version_id, source_skeleton_version_id, test_stage, test_manifest_json, test_manifest_sha256
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);

INSERT INTO document_heads(document_id, version_id)
VALUES (?, ?)
ON CONFLICT(document_id) DO UPDATE SET version_id = excluded.version_id;
```

- **部署與迴退（Rollback）**：不涉及新增 schema migration 版本，無額外資料遷移風險；`deploy/` 產物維持由 canonical schema 產生。

## 8. 核心 API、事件與可觀察結果

1. **MCP JSON-RPC 2.0 端點（`POST /mcp`）與 stdio 介面**：
   - `initialize`：回傳 `protocolVersion`、`capabilities: { tools: {}, prompts: {} }` 與 `serverInfo: { name: 'bdd-workbench-mcp', version: '0.1.0' }`。
   - `prompts/list`：列出 `workbench_stage_prompt`。
   - `prompts/get`：依會話或參數解析目前階段指派 Agent，回傳包含資料庫設定 `prompt`、綁定 `skill` 與階段任務說明之 MCP Prompt 訊息。
   - `tools/list`：列出 8 個工具：
     - `workbench_get_agent_prompt`
     - `workbench_get_context`
     - `workbench_get_gherkin_structure`
     - `workbench_list_project_files`
     - `workbench_read_project_file`
     - `workbench_get_db_schema`
     - `workbench_submit_sd`
     - `workbench_submit_test_completion`
   - `tools/call`：執行指定工具並回傳 `{ content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError?: boolean }`。
2. **可觀察事件**：
   - 當 `workbench_submit_sd` 或 `workbench_submit_test_completion` 提交 `needs_input` 時，保存待補問題並發出 `test.needsInput`（測試階段）或回傳 `questions` 清單。
   - 當提交 `completed` 且通過檢核時，保存新文件版本並發出 `document.saved` / `test.completionSaved`。

## 9. 同會話瀏覽器、親自錄製與重播

本功能模組不直接操作內嵌瀏覽器畫面或語意錄製器（不適用原因：本模組負責 CLI Agent 與工作台資料／Prompt／提案檢核的 MCP 協議介面，瀏覽器會話與錄製由 `workbench` 模組負責）。

## 10. Workspace、PTY 與執行生命週期

- CLI Agent 於 PTY 會話啟動時，`cliProposal` 與 `/requirements/:r/agent-sessions` 均注入 MCP 連線資訊（`WB_MCP_URL`、`WB_MCP_SESSION`、`.mcp.json` 與會話預設 `requirementId` / `featureId` / `projectId` / `stage` / `agentId`）。
- 在同一個 CLI 會話期間，若 MCP 提交工具回傳檢核錯誤（`isError: true`），PTY 會話與 `proposal.ready` 監聽維持開啟，直到 Agent 提交合規提案或會話結束。

## 11. codegen 與 BDD 補齊設計

- `spec/REQ-WB-001/mcp/mcp.feature` 透過 `playwright-bdd`（`bddgen`）生成並掛載唯一 `workbenchTestId`（`AC-WB-MCP-001/default`、`AC-WB-MCP-002/default`、`AC-WB-MCP-003/default`）於 `mcp.feature.spec.ts`。
- 同時在產品功能中，`workbench_submit_test_completion` 工具會在收到提案時直接驗證 `workbenchTestId` 保留性、映射完整性與 TypeScript / Playwright 可執行性。

## 12. DB UI、人類流程測試及報告

- `workbench_get_db_schema` 使用與 DB UI 相同的 `runtime.targetDb.schema` 讀取目標 SQLite 測試資料庫的實際資料表與欄位定義，確保系統設計與測試補齊階段引用的資料庫結構與實際測試資料庫完全一致。

## 13. 實作順序、驗收覆蓋與待確認事項

1. **實作順序**：
   - 於 `src/adapters/mcp/server.ts` 與 `src/adapters/mcp/stdio.ts` 實作 `workbench_get_agent_prompt`、`prompts/list`、`prompts/get` 與其餘 7 個 MCP 工具及 JSON-RPC 2.0 協議處理。
   - 於 `src/http/server.ts` 掛載 `POST /mcp` 並於 `src/adapters/generation/cli.ts` 整合 MCP 會話（含 `stage` 與 `agentId`）及提案提交橋接。
   - 更新 `spec/REQ-WB-001/mcp/mcp.steps.ts` 並重新產生 `mcp.feature.spec.ts`，執行完整驗收測試並同步註冊至工作台 `REQ-WB-001`。
2. **驗收覆蓋對應**：
   - `@AC-WB-MCP-001`：驗證 MCP 連線與取得階段指派 Agent 對應的資料庫 Prompt 與 Skill 指引、查詢需求階段文件、結構化 Gherkin、工作區檔案清單／讀取（含越界路徑拒絕）及 SQLite 測試資料庫 Schema。
   - `@AC-WB-MCP-002`：驗證 SD 階段透過 MCP 提交缺章節提案時即時回傳錯誤且不覆蓋原版、提交待補問題時記錄問題且維持未確認、提交合規 SD 時保存新版本並完成流程。
   - `@AC-WB-MCP-003`：驗證 TESTS 階段透過 MCP 提交遺失 `workbenchTestId` 或型別錯誤提案時即時回傳診斷且不覆蓋有效版本、提交合規補齊提案時保存 `COMPLETED` 版本並完成流程。
3. **待確認事項**：無阻擋性問題。

## 14. 驗收測試契約

- **測試介面與端點**：
  - HTTP JSON-RPC 2.0：`POST /mcp`（支援 `initialize`、`prompts/list`、`prompts/get`、`tools/list`、`tools/call`）
  - CLI 提案橋接與 stdio：`src/adapters/mcp/stdio.ts` 及 `cliProposal` 會話目錄中的 `.mcp.json`
- **測試 Fixtures 與環境需求**：
  - 獨立測試需求與工作區目錄（含測試專案檔案與工作區外檔案以驗證越界阻擋）、已設定之階段 Agent Prompt 與 Skill、已綁定之目標 SQLite 測試資料庫（含測試資料表與欄位）。
- **關鍵斷言目標**：
  - `workbench_get_agent_prompt` 與 `prompts/get` 回傳之 `prompt` 與 `skill` 與資料庫設定完全一致。
  - `workbench_get_context`、`workbench_get_gherkin_structure`、`workbench_list_project_files`、`workbench_read_project_file`、`workbench_get_db_schema` 回傳之結構化內容與真實資料庫／檔案系統一致。
  - 越界路徑讀取回傳 `isError: true` 與 `WORKSPACE_PATH_INVALID`。
  - 無效 SD 或無效測試補齊回傳 `isError: true` 與明確 `diagnostics`，且原文件版本 ID 與 SHA-256 保持不變；有效提案成功更新版本並完成 CLI 提案流程。

