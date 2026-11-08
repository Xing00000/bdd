# 工作台架構與儲存界線

[README](../../README.md) · [操作](../operations.md) · [相容](../compatibility.md)

## 責任模型

工作台管理多個 Spec Repo 綁定；Project 以 `repositoryId + projectId` 定位。沒有全域產品工作區，也不要求使用者管理 Git 分支或提交。

```text
使用者編輯／儲存
  → SQLite 交易（設定、原文、修訂、確認、收據）
  → 已儲存；不提交或修改 checkout、不需要遠端連線

建立功能
  → 初始化 Spec／產品來源並建立 Git 起點
中間編輯／確認／開發／測試
  → SQLite 修訂與工作目錄 → 內容摘要及獨立檔案快照
人工驗收通過
  → 驗證當前內容與報告 → 固定產品／Spec／證據 Git 版本
明確遠端同步
  → 只分享已固定版本；未固定草稿不得隱含提交
```

## 主要模組

| 模組 | 責任 |
|---|---|
| `packages/workstation/draft-store.mjs` | SQLite 內容、歷史、設定及收據的原子交易、樂觀並行控制 |
| `packages/workstation/authoring.mjs` | 設定、來源編輯、白話需求、需求／設計確認；不修改 checkout 或執行 Repo 程式 |
| `packages/workstation/projection.mjs` | 已儲存修訂的 Repo 輸出、既有規格匯入、衝突檢查、執行產物回收 |
| `packages/workstation/flows.mjs` | 安裝授權、測試確認、隔離驗收及產品／Spec／報告同步順序 |
| `packages/workstation/store.mjs` | Registry、作業、檢查紀錄、驗收 metadata、schema migration |
| `packages/workstation/service.mjs` | 服務介面、讀取 SQLite、Worker 調度及目前驗收狀態 |
| `packages/git-core/` | Git 邊界的輸出及同步工具；`source-files.mjs` 以純檔案讀取處理來源選擇，不啟動 Git |
| `packages/spec-toolkit/workspace.mjs` | 工作樹內容摘要與獨立檔案快照；一般功能測試不需要 Git 候選 |
| `packages/spec-toolkit/` | 規格契約、內容摘要、可攜工具、驗收候選與證據 |
| `packages/workstation/public/` | 唯一工作台入口、儲存／同步狀態、設定與階段流程 |
| `src/http/server.ts` | 共用後端的相容性 API／runtime 測試 host，只回傳 API 與正式產物，不供應網站／SPA；`ui/` 已移除。 |
| `packages/workstation/chat.mjs`、`public/chat.js` | 正式入口的聊天室接線；重用 `src/application/chat.ts` 與 `src/adapters/sqlite/chat.ts`，聊天資料存同一個 `WB_HOME/metadata.sqlite`。Codex 擁有模型上下文，SQLite 擁有原始訊息。 |
| `packages/workstation/chat-tools.mjs` | 聊天專用的私有 loopback MCP；重用既有 service 的專案／進度讀取、需求提案產生／讀回，以及 `workbench_save_feature` 將既有提案建立為新的功能草稿。儲存重用 `workflow.requirement.save` 的驗證、SQLite authoring 與首次 Git checkpoint，不更新既有功能、不確認任何階段。不暴露 `agent-supervisor` 或任意 shell／階段確認，避免繞過 Codex SDK 另起派工通道。 |
| `packages/workstation/agent-supervisor.mjs`、`scripts/mcp-agent-supervisor.mjs` | 單一共用的長駐互動式 CLI Agent Supervisor（支援 ACP 與 PTY 互動模式）；提供 Codex SDK 原生 MCP 工具 `agent_start`、`agent_send`、`agent_events`、`agent_list`、`agent_cancel`、`agent_stop` 與工作站 `/repository-api/v1/agent-sessions` 人類雙向介入入口（明確支援 `mode: 'queue' | 'interrupt'` 策略與 `QUEUED`/`DELIVERED`/`PROCESSED` 持久化狀態）。 |

## SQLite schema 10

`spec_repositories` 保存綁定網址，不因連線失敗取消登錄。以下是需要備份的正式資料，不是可丟棄快取：

- `authoring_state`：每個綁定的目前修訂與設定。
- `authoring_files`：規格、SD、測試與產品文字編輯。`spec` 與 `project:<id>` 是不同命名空間，即使產品代號叫 spec 也不混淆。
- `requirement_proposals`：原始描述、生成前 Gherkin 及生成結果，按 repository 與需求編輯識別隔離；不授予確認。
- `authoring_history`：修訂原文、設定與儲存收據；每個操作 ID 只能代表同一份請求。
- `repository_preferences`、`operations`、`tooling_checks`、`runs`：站台偏好、持久操作、真實檢查與驗收紀錄。

`repository_projection` 記錄已輸出修訂、檔案摘要、Git 版本及同步位置，不取代 SQLite 原文。`report_index` 為可由 Git 重建的衍生索引。報告、截圖與 traces 保留在執行證據檔案中，SQLite 保存其執行及索引 metadata，不把大量二進位報告放進文字表。

### 互動留言與執行歷程

作業以 `operations` 保存原始請求、時間、狀態、結果與錯誤，供執行與診斷使用。使用者可見的互動留言只包含 LLM 派工（Gherkin、系統設計、補完測試計劃、實作）及該任務的 SDK 補充訊息；普通儲存、本機 Gherkin 生成、文件匯入、測試執行與停止操作不顯示為留言。LLM 派工即使在前置檢查失敗仍保留失敗紀錄。唯讀輪詢、Prompt 預覽／取消及單純切頁不建立留言。畫面在主要內容下方以最新送出在上的順序呈現留言及其可收合執行 log，載入更早紀錄時加在下方；歷史 API 以 SQL row cursor 分頁，展開舊紀錄不會替換新的紀錄或正在使用的 PTY。

`interaction-types.mjs` 是歷程分類 owner，依操作、審閱階段及來源檔案判定 `GHERKIN`／`SD`／`TESTS`／`IMPLEMENTATION`／`VERIFICATION` 等類型；通用操作可帶入目前頁面的合法類型，已知業務操作不受錯誤的前端類型覆寫。類型保存於 `operations.interaction_type`，補充訊息及停止紀錄繼承 parent 類型。schema10 依原始請求回填既有紀錄，無法判定的舊操作保留為 `SYSTEM`，不冒稱所屬業務階段。歷史 API 在 SQL 分頁之前依類型過濾；切換階段會清除前階段的畫面與輪詢，只在目前階段下方顯示相符的互動。未帶類型的 API 查詢仍只回傳 LLM 互動。`interaction-types.mjs` 的 LLM predicate 統一決定 SQL 分頁資格與作業回傳的 `isLlmInteraction`；前端依該欄位決定是否即時建立或附加互動卡片。

`git-core/progress-store.mjs` 是 `execution_logs`／`execution_log_chunks` 的唯一 schema 與輸出 owner。metadata 保存階段、程序與退出碼，輸出以 byte offset 分塊追加到 `metadata.sqlite`。作業 claim／finish、對應 log 與子互動完成使用同一交易；寫入失敗不會留下已完成狀態。每份 transcript 沿用既有 4 MiB 上限及截斷標示，ANSI／憑證處理與 UTF-8 分頁契約保留。新紀錄不依賴 `terminal.log`、`processes.json` 或 `state.json`；舊檔僅在 SQL 尚無紀錄時一次性讀入，拒絕 symlink，匯入後 SQLite 為唯一來源，不再從修改後的舊檔覆寫。

每次提交完整多行訊息建立 `interaction.cli.input` 子留言；這個歷史操作名稱保留，但 API 只接受結構化 `message`，不再接受逐字終端輸入或 resize。訊息以 ID 與內容摘要排入後續 SDK thread 回合，worker 保存收件及實際回合結果；輸出同時寫入子留言與原作業 transcript。未取得處理結果的輸入不得隨 parent 成功而變成成功。人工停止保留作業診斷紀錄，但不另顯示互動留言；服務關閉等系統清理不偽造成使用者送出。

來源匯入、審閱摘要與測試型別檢查仍共用 `gitSourceFiles`／`gitSourcePaths`，但實作是 `git-core/source-files.mjs` 的純檔案讀取，沒有 `ls-files`、`check-ignore` 或暫存 `git init/add`。忽略規則使用隨 toolkit 提供的 MIT `node-ignore` 7.0.14，保留巢狀規則、`!` 例外、global excludes 與 `.git/info/exclude`；只讀解析既有 index v2/v3/v4（含 split index）以保留 tracked-but-ignored 檔案。忽略目錄不被遍歷，接受來源仍拒絕 symlink 與特殊檔案。

SQLite view 與執行快照以 `.runtime/source-view.json` 記錄已接受檔案清單，讓獨立 runner 保留相同來源選擇，不建立 Git metadata。此標記只控制內容選擇，不授予工具或執行權限。一般狀態以產品 `contentDigest` 與已固定的 `checkpointDigest` 比較，不透過 `git status`／`git modules` 輪詢。

只有建立功能與人工驗收固定版本時，提交流程才使用 Git 的來源檢查與 index 更新。選取檔案提交後，使用 `update-index --index-info` 更新選取路徑，包括新增與刪除；未選取路徑的 staging 與工作目錄內容保留，不執行 `git reset`。

## 儲存交易

一次儲存先檢查內容 hash，再在 SQLite `BEGIN IMMEDIATE` 交易中寫入內容、設定、遞增修訂、歷史及結果收據。任何寫入失敗整筆回滾。不同檔案的並行儲存可在修訂變動時重新讀取重試；同檔案 expectedHash 不符則拒絕覆蓋。

不呼叫 `git status`、`commit`、`fetch` 或 `push`。背景同步／驗收不佔用儲存鎖；它使用固定修訂，新編輯留在 SQLite 等下一次輸出。Worker 若在 SQLite 成功後、作業完成欄位更新前中斷，可從儲存收據恢復成功狀態，不把已保存的資料誤報為遺失。

既有檔案式 helper 在一次性暫存 view 中處理資料；view 從 SQLite 建立，異動最後才以單筆 SQL 交易提交。view 不是主要儲存位置，也不是產品 checkout。

## Repo 輸出與同步

CLI 終端採事件推送：PTY／ACP 輸出先取得持久化事件序號，再由程序內 session stream 發送給 WebSocket；不同 MCP owner 程序透過既有 token 控制通道的 GET `/events?sessionId&afterSeq` 傳送 NDJSON。SQLite 只在訂閱／重連時補播，活躍連線不再每 350ms 查詢資料庫。先訂閱後補播，以 seq 去重，終態送 closed；慢消費者維持原 1 MiB 緩衝預算並中斷連線，由游標重連。瀏覽器斷線也取消尚在建立中的 owner 串流，避免留下讀取工作。

2026-11-08 在實際 `http://127.0.0.1:4173/`，用可見 Playwright 瀏覽器對真實 Kiro PTY 以每鍵 90ms 輸入 15 個字元。輸出事件 createdAt 到瀏覽器 WebSocket 到達：改前中位數 171ms／最大 313ms，改後跨程序中位數 3ms／最大 11ms。這是同機、少量樣本的終端傳輸量測，不包含模型推論或完整畫面繪製時間。重連後輸入回顯只出現一次，停止後收到 closed/STOPPED。原始數據保存在本次 test-results/terminal-performance-* 的 before.json、after.json 與 HTML 報告；不作為 golden 或宣稱全負載 SLA。

一般 CLI 派工從 registry 的規格庫位置及 `workbench.yaml.projects` 推導正式產品工作目錄；匯入後以目前 SQLite authoring 修訂為設定 owner，匯入前才讀 checkout。`agent-workspaces.mjs` 重用 configuration validator 和 safePath，不另存白名單。MCP `agent_workspaces` 與 GET `/repository-api/v1/agent-sessions/workspaces` 提供相同目錄資料；`agent_start` 接受 repositoryId/projectId 或 cwd，單一候選可自動選取，多個候選必須明確選擇。聊天室啟動表單提供產品工作目錄選單。明確任務 allowedRoots／管理者環境設定保留原限制；沒有已登錄產品的通用 Supervisor 沿用既有行為。已驗證的任務代理可透過帶 token 的控制通道轉送其 worktree，不能把聊天 scratch 目錄誤當成產品的唯一允許範圍。

Spec Repo 仍有 `spec/<REQ>/<feature>`、`tests/<REQ>/<feature>`、`reports/<REQ>/<feature>/<run>`，產品仍是 `projects/<id>` submodule。一般 `prepareProjection` 只將固定 SQLite snapshot 輸出為工作檔案，保留衝突檢查。Git checkpoint 只在建立功能與人工驗收完成時產生。`repository_projection.revision` 記錄檔案輸出修訂，`checkpointRevision` 記錄已固定的 Git 修訂，兩者不可混用。只有 `checkpointKind: ACCEPTED` 且沒有較新草稿才可同步，不隱含提交。

已存在的檔案必須符合上次輸出／匯入摘要或本次預期內容。外部修改不同則暫停，回報「SQLite 已儲存、Repo 尚未更新」。原稿、資料庫內容與同步歷史都保留，不執行 reset、clean 或 Force Push。跨 Repo 不是單一交易，部分同步以回執分辨。

成功接受 checkout 匯入時，`projection.mjs` 明確要求 `draft-store.saveDraft` 以本次已驗證的 incoming base 更新基準，並同步更新既有 projection checkpoint；一般作者儲存仍保留原基準。舊版以 COALESCE 留下 bootstrap 摘要的資料，輸出前由 `repairImportBaselines` 僅依成功匯入歷史中 `origin: checkout` 的 `baseHash` 修復基準與對應匯入 checkpoint。此修復不改原文、內容摘要或作者修訂，亦不以目前磁碟內容作為可接受的依據；修復後仍須逐檔通過既有輸出衝突檢查。

首次取得既有規格庫時讀入其內容；同名但不同的本機作者草稿不被遠端覆蓋。快轉取得的新資料會更新 SQLite；若同期已有新儲存，則保留本機新版本，不誤稱最新修訂已同步。

## Toolkit 與案例識別相容性

`packages/spec-toolkit/tags.mjs` 是 reporter、案例篩選及 legacy 共用測試的識別規則 owner。正式作者格式維持 `@case:<id>`；舊 `@case=<id>`、`[case=<id>]` 在讀取邊界正規化，不改寫已確認 Gherkin。普通 Scenario 的重複案例標記、多個 Examples row ID、與所選執行不符的 req／feature 都拒絕。Outline 依現行 canonical reporter 規則以生成的 Examples row ID 為具體案例，優先於繼承的 Scenario case tag。缺少 req／feature 標記時，識別只能來自同一執行的 `WB_REQUIREMENT_ID`／`WB_FEATURE_ID`，不推測業務 ID，也不補造缺少的案例 ID。

Toolkit 1.4.0 將此模組納入正式 manifest。升級既有 req-tags 工具庫時仍驗證完整 manifest 與目前內容摘要，並拒絕未知或未登錄工具檔；不是忽略客製檔案的通用覆寫。`repository.upgrade.preview/apply` 透過固定 SQLite 作者修訂與計畫 digest 檢查，將所有升級檔及 manifest 以原子交易保存；來源規格、共用 fixtures 與已確認需求／設計保持原文，測試確認仍依新工具摘要重新檢查。

## Spec Repo 測試工具依賴

測試工具以 Spec Repo 為安裝單位，持久目錄是 `<WB_HOME>/repositories/<repositoryId>/test-tools/node_modules/`。這是該 Spec Repo 的衍生工具環境，不是全工作台共用的一套套件，也不是產品 Project 的依賴。原文 owner 仍是 SQLite 保存的 Spec Repo `package.json` 與 lockfile；目錄內的 manifest、安裝收據與 npm 快取都是衍生資料。

`spec-toolkit/dependencies.mjs` 統一計算 package／lockfile、本機依賴來源、完整 Node 版本、ABI、平台與架構的身分。`ensureInstallation` 先核對這個身分及必要工具，再決定是否安裝；同一套依賴的不同需求、重試及程序重啟均可重用。套件或執行環境改變時，須依新計畫授權安裝；新安裝成功前保留舊環境，未經授權不替換。首次沒有 lockfile 時，解析結果沿用既有作者儲存流程保存。

生成與驗收候選使用獨立的 node_modules 副本，可用檔案系統 copy-on-write 建立，絕不以可寫連結共用套件內容；依賴連結也不可逃出隔離環境。刪除需求的暫存產物不會刪除 Spec Repo 的持久安裝。驗收候選若與已安裝身分及預設 npm 安裝命令相符，便複用安裝結果；自訂安裝命令仍照原契約執行，不會被快取靜默跳過。Project 的單元測試依賴與命令不由此工具環境取代。

## 審核與驗收

需求、系統設計、測試計劃、開發實作、驗收使用同一套流程。`spec-toolkit.reviewState` 依 SQLite 所存確認紀錄與來源摘要推導階段及可編輯性；UI、API、生成器不得另存一份階段或自行解除確認。通過階段的原文、來源描述與測試模組唯讀，後端來源儲存也檢查同一 owner，不能只靠前端鎖定。

`agent-settings.mjs` 的實作與測試計劃預設 Prompt 僅包含任務識別、動作及 MCP 工具入口，不展開規格、SD、產品路徑、回報、失敗紀錄或通用流程。Skills 預設留空；只精確遷移已知舊 factory Prompt／參數／完整 BDD skill，自訂值保留。所有任務使用獨立 Codex SDK 設定，不執行舊版 command／args。

`agent-task.mjs` 是預覽、派工及任務資料 owner。預覽 API 不建立作業或啟動 Agent；畫面可編輯完整 Prompt，取消不派工，送出後原樣傳入 SDK，不再附加任務內容。後端要求非空 Prompt 及涵蓋 repository、作者修訂、設定、所選功能、階段與本地位置的預覽摘要；過期則拒絕。內部重試沿用同一已送出 Prompt，新的失敗資料只更新該次 attempt 的任務 MCP。已啟動的工作不因設定更新而重啟。

驗收頁以上方 Playwright HTML 報告、下方驗收意見與「LLM 修改實作／驗收通過」組成。意見輸入本身就是使用者審閱的派工文字，點選修改後原樣傳入 `workflow.develop`，不再開另一個 Prompt 表單；派工摘要仍由 `agent-task.mjs` 驗證。工作站在同一開發作業中先以 SQLite revision CAS 保存該報告的 feedback，再派出 Agent；意見與真實執行結果由同一實作互動保存。修改後的測試結果保留為新報告，歷史互動與報告不刪除。

完整自動驗證通過只會進入 `AWAITING_ACCEPTANCE`／`VERIFICATION`，不操作 Git。人工驗收唯一 owner 是 `acceptance.mjs`，`workflow.accept` 核對當前完整報告的 run ID、manifest digest、規格／產品內容摘要及確認者，將 `acceptance.json` 保存於 SQLite 後才固定 Git checkpoint 與證據；不改寫封存測試結果。只有仍匹配且沒有待修意見的人工確認才導出 `COMPLETE`／`VERIFIED`；新報告、規格／產品變動或新的驗收意見使舊確認失去目前適用性，歷史紀錄仍保留。來源編輯 API 禁止偽造 acceptance 檔案。

Git checkpoint 或本機 evidence publication 失敗時，保留同一筆人工確認並顯示 `ACCEPTANCE_PENDING`，不能顯示完成或同步該版本。重試會核對同一報告與目前內容，不新增重複確認。所有必要步驟成功後，才以 SQLite revision CAS 原子記錄 `completedAcceptances` 及 `checkpointKind: ACCEPTED`；驗收期間的新草稿不能被順帶認證。

每次派工保存固定 SQL 修訂的任務資料，`scripts/mcp-agent-task.mjs` 以 stdio 提供 `workbench_get_task` 與 `workbench_read_artifact`。前者提供工作目錄、允許寫入範圍、驗證入口、回報與失敗資料及 artifact 名稱；後者只能讀取該任務映射的所選功能和必要共用測試原文，不接受任意檔案路徑，不提供寫入工具。實作及測試計劃原有後端審閱、範圍、型別及獨立驗證 gate 保留。

SDK 直接以結構化設定接入本次 `workbench_task` MCP，要求伺服器初始化成功，不修改使用者全域設定。四類派工都經相同 SDK 邊界，沒有 CLI argv 展開或外部 CLI dispatch。舊版 command／args 只保留在原始歷史；新預覽解析為 SDK 設定，凍結的舊 CLI 派工必須重新預覽，不能在送出後靜默更換執行契約。

任務與進度 MCP 共用 `mcp-protocol.mjs` 的版本協商，包含本機 Codex 0.166.0 實際提出的 `2025-06-18`。對未支援的版本提案依 [MCP lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle) 回覆伺服器支援的版本，不把可協商的客戶端版本直接當成致命錯誤。驗證包含實機 Codex app-server 的 ephemeral thread 初始化，不送出模型 turn 或執行產品修改。

設定儲存與工具準備分為兩個獨立操作：`repository.setup` 先保存 SQLite 設定，設定畫面接著呼叫 `repository.tools.prepare`，依既有安裝授權準備該 Spec Repo 的持久套件與可執行功能要求的瀏覽器；尚無功能時沿用 `defaultProfiles`。解析出的 lockfile 以修訂 compare-and-swap 保存。設定保存成功不代表工具已準備成功；準備失敗可從設定頁重試。瀏覽器完整性使用已安裝 Playwright registry 的正式安裝目標，包含 headless shell 與 ffmpeg 等相依執行檔，舊收據不取代檔案檢查。骨架生成與 LLM 補齊只讀取匹配的已安裝工具副本，不會執行 npm；套件缺失或身分改變時明確要求返回設定頁。

需求確認直接保存 SQLite。系統設計確認先保存 SQLite，再進入測試計劃頁執行 `workflow.tests.generate`：`test-plan-codegen.mjs` 在固定修訂的隔離副本中透過已安裝 Playwright-BDD 的原生 Gherkin／step matching 與 Snippet 生成器建立完整 step 骨架，包含超過 CLI 顯示上限十筆的步驟，再執行真正的 bddgen。Playwright-BDD 沒有產生 hooks 的命令；工作台加入既有 AfterStep 截圖契約的可執行 hook。骨架未完成的 step 明確拋錯，不代表實作完成或測試通過。新需求兩份測試文件為空白；已有內容則禁止以骨架覆寫。原生 Snippet 介接集中在 `bdd-snippets.mjs`，不從 CLI 的截斷文字反解析程式。

測試計劃頁另提供「LLM 生成測試計劃」，呼叫 `workflow.tests.complete`，才由 `test-plan.mjs` 使用 Agent 的 `testPlanPrompt`、SDK 與 Skills 補齊既有骨架。操作帶入目前測試摘要，拒絕補齊過期畫面或已確認的測試。Agent 隔離副本只載入目前功能的規格、必要需求 metadata、共用 fixtures、工具與設定，以及關聯產品 context；不載入其他 Spec Repo 功能的 Gherkin 或測試。產品二進位檔案保留原始 bytes，使用獨立檔案快照供 Agent 使用；不在暫存副本初始化 Git，也不修改 checkout。Codex 的執行參數明確略過 Git Repo 檢查，原有 sandbox 仍然生效。Agent 只能修改該功能測試檔案及 helpers，不得修改已確認文件、設定、產品或其他來源。Agent 結束並通過範圍檢查後，工作台在另一個完整且固定的 SQL 修訂副本套用提案、執行驗證及推導進度，其他功能原文不會因 Agent 工作目錄的裁切而被刪除。

LLM 結束後獨立檢查禁止空白／僅拋錯 handler 與 skip／focus、TypeScript 型別檢核、真正的 bddgen 與完整案例／瀏覽器 discovery。檢核成功僅代表 `CHECKED / NOT_RUN`；人類確認測試計劃後才進入開發。測試是在產品開發前撰寫，允許產品尚未實作而使驗收失敗；已確認設計允許的狀態模擬與事件注入可作為受控輸入，仍禁止虛構 API、替代產品與假斷言。補齊失敗保留原骨架或原稿及隔離提案；完成後移除隔離 node_modules、.generated 與套件快取。所有生成結果均以原 SQLite 修訂 compare-and-swap 保存，同期退回或修改會阻擋回寫。

`workflow.restart` 是唯一撤銷確認的作者操作，與來源清空在同筆 SQLite 交易完成。退回指定階段會撤銷該階段及下游確認；退回系統設計或需求時，清空該功能 `tests/<REQ>/<feature>/` 的目前文字內容，既有作者修訂歷史與驗收報告保留。其他功能、共用 helpers 與產品不變；相同上游原文再次確認不能復活被撤銷的測試確認。退回測試計劃本身則保留內容供修改。Repo 是後續輸出，不可從舊 checkout 回填已清空的 SQL 文字。

測試確認要通過實作檢查、真實生成及 discovery，必要依賴只有一次安裝授權。安裝新增的 lockfile 與測試確認只能回寫原先受審閱的修訂，不能覆蓋同期新草稿。

一般功能測試將固定 SQL 修訂與產品工作檔案複製成獨立候選，不呼叫 Git、不建立 source/evidence commit。manifest 使用 `sourceKind: WORKSPACE`、`specDigest`、`inputDigest` 及各產品 `contentDigest`，`testedSpecCommit` 為 `null`；測試前後重新驗證內容，外部修改不能沿用舊通過結果。只有人工驗收完成才建立 Git 版本與報告發布來源，受測的內容摘要保持不變。歷史版本回歸沿用既有 Git SHA 路徑，不能將其與工作樹摘要混為一談。

`specSourceDigest` 對完整 Spec source 使用固定 UTF-8 路徑排序，排除精確路徑上的工作台 review／acceptance／feedback／workflow 紀錄；根目錄與其他目錄的 helper、設定及工具仍納入。判定報告是否適用時，同時核對磁碟來源與未輸出的 SQL 草稿。驗收 checkpoint 納入已核對來源及其刪除，再由 `source-checkpoint.mjs` 批次讀取 Git objects，比對真正提交的位元組；發布與匯入證據也驗證相同來源摘要。原始 `specDigest`／`inputDigest` 不因新增人工確認而重算或改寫。

報告發布使用獨立 publisher。若預設 `publishers/<run>/repo` 已存在但 publication receipt 尚未寫入，原目錄及其所有內容保持原路徑不變；系統從已驗證的 sealed evidence 和固定的 S 在 `publishers/<run>/attempt-<uuid>/repo` 建立新 publisher，不複製原目錄的工作檔。receipt 記錄相對 home 的 `publisherPath` 和保留原目錄時的 `preservedPublisherPath`；後續發布使用該路徑，舊 receipt 缺少路徑時使用預設位置。路徑必須屬於同一 run，且不可經由 symlink；既有 HEAD 與遠端推送檢查仍適用。只有明確同步才推送，不重新執行測試或變更驗證結果。

## 安全與範圍

儲存與讀取不執行 Repo 設定程式。路徑、文字大小、symlink、私密檔案及跨規格庫存取有檢查。SQLite 與歷史可能包含敏感原文，備份必須保密。主機為 loopback 信任模型，沒有公開多租戶 ACL 或 OS sandbox；Agent、MCP、Terminal、錄製的新 UI 完整接線仍未全部提供。

## 兩區編輯資料契約

`requirements.mjs` 提供來源、格式草稿、結構診斷與成對儲存。`requirement-documents.mjs` 只做受限文字提取，不執行文件中的任何程式。既有檔案首次開啟不改寫；若沒有來源描述，僅上方留空。

正式 Gherkin 保存為 `spec/<REQ>/<feature>/<feature>.feature`；原始描述保存為同層 `requirement-source.json`，兩者在 `authoring_files` 與 `authoring_history` 的同一 SQL 交易更新。第一次保存新功能時建立 Git 檢查點；後續保存只更新 SQLite，需要執行時才把草稿投影至工作目錄，完成人工驗收時再建立下一個 Git 檢查點。後續確認的摘要綁定下方 `.feature` 而不是可隨時補充的來源素材。

生成採用明確標示的本機格式整理，不冒充語意推理。輸出使用 Feature／Scenario／Given／When／Then 及穩定案例標記；瀏覽器回歸另用固定版本的官方 Cucumber parser 驗證輸出。人工編輯的儲存路徑保留原始 bytes，不會因診斷失敗拒絕草稿保存。執行前的完整 BDD discovery 是另一個關卡。


## 綁定與歷史版本目錄

register 只保存綁定與 `DEFERRED` 連線狀態，不排入 Git 作業。建立功能時才初始化來源；`catalog.mjs` 的 QUEUED → LOADING → READY／READY_WITH_WARNINGS／FAILED 流程保留給明確的版本維護。既有遠端內容安全匯入作者模型；已有草稿衝突時保留兩份，歷史版本仍可唯讀查看。取得已宣告的 submodule 不切換已初始化產品的分支或捨棄工作區內容。

不可變 Spec 快照位於 `catalogs/<binding>/<SHA>/repo`；產品版本查詢使用 `version-products/<binding>/<remote-hash>/repo`，不借用編輯中的產品目錄。Git clone 後明確取得所選 SHA，以支援只存在於 remote-tracking refs 的版本。

`regression.mjs` 固定完整版本組合及預期功能／案例矩陣，使用原生 Runner 逐功能執行，不以 UI 模擬 PASS。`regression-evidence.mjs` 在獨立 publisher 將摘要和子證據寫成一筆報告 commit R；所有報告記錄受測 S。回歸不呼叫 SQL 作者編輯或確認函式。人工確認和測試 outcome 是兩個不同維度，任何未審核內容都不會因回歸 PASSED 自動批准。

schema 7 的 `repository_connections` 保存載入進度／目錄索引／錯誤；`regressions` 按 binding + batchId 隔離批次狀態。工作程序中斷會保留逐項結果並把整批標成 INCOMPLETE。遠端批次摘要必須能對應子 manifest，不能單靠一行 PASSED 復原為可信歷史。

## 本地目錄綁定（Schema 8）

`spec_repositories.local_path` 保存由使用者選定、正規化的 host-side checkout 位置；null 表示沿用原受管理路徑。`locations.mjs` 統一解析位置並驗證目錄、來源、路徑重疊及採用條件。所有 Worker、版本查詢、產品讀寫及輸出都從 registry 解出位置，不由 API 操作傳入任意 cwd。

位置切換是獨立的 `repository.location` 作業，使用原位置的樂觀並行檢查與既有 Repo 作業鎖。紀錄新位置及歷史後標記 `DEFERRED`，不自動取得內容、不移除舊 checkout 或 SQL 作者修訂。作者儲存不需要驗證實體磁碟可用，唯有讀取未匯入檔案、Git 邊界或執行才檢查實際位置。來源初始化採用 existing clone 時仍保留 dirty 文件與原始 base hash，避免把外部草稿誤認成可覆蓋的初始範本。

## Portable workflow state and a shared automation policy

`packages/workstation/workflow-state.mjs` derives a feature's stage from source digests, versioned human review records and matching sealed evidence. Both the detail API/requirement acceptance page and `bdd workflow status/next/run/regress` use that policy. A command cannot turn missing review into approval. Completed jobs and passing product acceptance remain separate outcomes with different CLI exits.

`spec/<REQ>/<feature>/workflow.json` is the portable, versioned progress projection. SQLite stores the durable in-progress revision and history. Feature creation and completed human acceptance create Git checkpoints; explicit synchronization only publishes an already accepted checkpoint. The state references an immutable workspace input digest (or the original tested commit for historical runs) and canonical report path/ref, never a machine's absolute path. Another binding can reconstruct approvals and progress from Spec content and fetched evidence without copying the first machine's database. Stale/missing evidence is reported rather than trusting the recorded stage string. Local running jobs, cancellations, worker ownership and installation authorization remain operational metadata.

A report is identified by binding + requirement + feature + run. Local and Git-indexed copies are de-duplicated; conflicting immutable identities cannot be used. The requirement acceptance view is scoped by that identity, clears stale evidence on navigation, and rechecks artifact hashes before serving bytes. Report-only or progress-only commits do not invalidate source approvals; content/product changes do. Historical reports for removed features remain available in the repository-wide history.


## Codex SDK execution and acceptance feedback

`workflow.develop` is a durable, repository-locked worker operation. The same `runAgentTask` dispatch boundary serves development, Gherkin, system design and test-plan completion. The official Codex SDK is its only execution runtime. Legacy CLI settings are normalized for new previews; old frozen CLI snapshots require a fresh preview, and new CLI-only writes are rejected. A supervised Node host invokes `startThread` and `runStreamed`, records real SDK events and thread IDs, and uses a task-scoped MCP connection. PTY supervision provides the existing process-group cleanup and durable transcript; it does not parse or drive the Codex terminal UI. Additional input is queued for a later SDK turn. Structured message input uses IPC only to the owning live worker, and the browser reconnects without launching duplicates.

The SDK uses a local Responses provider backed by Copilot ACP in pure model-inference mode (`mcpServers: []`, `--disable-builtin-mcps`, `--available-tools=__bdd_no_tools__`). Coding tool policy accepts supported function/custom definitions actually advertised by Codex, embeds them as a pure text/JSON inference contract, and reconstructs the original namespace/name/type and raw custom input into OpenAI Responses `function_call`/`custom_tool_call` SSE events. Copilot only performs model inference and never connects to or executes any MCP server; any tool execution or permission request from Copilot ACP is immediately cancelled and rejected, while Codex executes the resulting calls via its own native MCP connections (`workbench_task`, `workbench`, `agent_supervisor`). The chat provider retains its workbench and `agent-supervisor` tool policy. Chat remains on app-server for streaming, compaction and persistent-process interaction.

`packages/workstation/agent-settings.mjs` owns the dispatch seed, field limits, validation and template expansion. `agent-catalog.mjs` owns the reusable Agent/Skill catalog in `WB_HOME/metadata.sqlite` (schema 12): profiles, immutable revisions, resource text, ordered bindings and per-repository task defaults. `prompt-catalog.mjs` owns independent Prompt metadata/revisions, validation and the migration from combined Agent settings. Current Agent rows contain only runtime settings; selected Prompt and Skills are composed at preview time. Existing customized settings and literal Skills are imported once; the prior embedded `settings.agent` remains historical migration input, not another editable UI. Once a repository has catalog defaults, new LLM submissions must carry a catalog selection and repository setup cannot update its old embedded Agent.

The management page is global and independently edits Agents, Prompts and Skills. Gherkin, design, test-plan and development use one selection/preview component with independent Agent/Prompt/Skills controls. Changing Agent does not replace the other choices. `agentPreview` resolves the chosen current Agent, Prompt and Skill revisions and binds their digest to the source revision, task and rendered Prompt. HTTP preparation validates the preview and enqueue freezes `agentSnapshot` into the existing operation request. Workers use this snapshot, so later edits/archive cannot change an accepted job. Direct synchronous execution resolves selected immutable versions at its command boundary using the same catalog owner. Old persisted operations retain their original embedded-setting contract. Client-supplied execution snapshots are rejected.

Skill bodies and UTF-8 resources are immutable SQLite data; resource paths must be relative, without traversal, duplicate paths or `SKILL.md` shadowing. Each task MCP exposes the selected skills at `skills/<skillId>/SKILL.md` and their resources only. Resources do not execute automatically or grant new tool/write rights. Combined rendered prompts retain the existing 64 KiB limit, and skill/resource bundles share the existing 256 KiB skill limit; an oversized selection fails explicitly. Skills can be ordered in the UI. Updating an item creates a revision; stale defaults or previews require explicit reselection. All writes use optimistic revision checks. No registry settings are stored in browser localStorage or a parallel configuration file. Prompt edits do not create Agent revisions.

Catalog routes are `GET /repository-api/v1/agent-catalog`, `POST .../agent-catalog/agents`, `POST .../agent-catalog/skills`, `POST .../agent-catalog/prompts`, and `GET/PUT .../spec-repositories/:id/agent-defaults`. They use the same protected write header and same-origin checks as other workstation settings. The schema migration creates `before-agent-catalog-v11.sqlite` for an existing older database before migration. Verification is mapped by AC-WB-043 to the shared browser scenario driver and catalog contract tests.

Product changes are imported with SQLite revision compare-and-swap, including explicit text deletions. Development and retries preserve working files without committing or updating gitlinks. Independently sealed BDD evidence controls readiness for human acceptance; only that acceptance fixes the product and specification Git checkpoint. A source review change, concurrent authoring change or unsupported product file retains on-disk work and stops automatic promotion.

Once that shared workflow policy reports COMPLETE, both the development action and its backend dispatch are read-only. Acceptance feedback reopens development through the existing workflow owner; starting another Agent cannot itself reopen a completed stage.

`workflow.feedback` is a SQLite authoring transaction. It validates report identity against the selected binding/requirement/feature, appends a protected `feedback.json`, and derives portable progress in the same transaction. Prior evidence is immutable. Unresolved feedback overrides an old PASS and returns the feature to IMPLEMENTATION; only a newer qualified run can advance it. The original issue remains in history and is passed to subsequent development as task data.

The acceptance view renders original reporter scenario/step data and attachment hashes. Native Playwright HTML uses an artifact-scoped URL and sandbox without same-origin privileges. It cannot serve arbitrary repository files. Installation, runtime cache, process IDs and transcripts remain local; no credentials are written to portable requirement state.


聊天室串流由 `src/application/chat.ts` 擁有：Copilot ACP 的 `session/update` 文字增量經 Responses SSE 與 Codex app-server 通知傳入，`src/http/chat-stream.ts` 統一輸出瀏覽器 SSE。正式入口為 `/repository-api/v1/chat-events`，相容 API 為 `/chat-events`；POST 送出與 SQLite 最終保存維持既有契約。revision 快照負責重連恢復，生成中的累積文字僅存記憶體，服務重啟以 interrupted 結束未完成訊息。規格與證據對應見 AC-WB-040；前端不再以 timer 輪詢聊天室。

聊天程序的生命週期與單次回合分開。`codex-chat.ts` 按聊天室保存 Codex worker；正常 reply／compact 完成後保留連線、初始化狀態與 thread，事件依 thread／turn 識別分流。provider credential 屬於 worker，每輪只啟用該輪的取消訊號；空閒 credential 不接受模型請求，停用或 HTTP 中斷會取消該請求。逾時先中斷當輪，只有確認 terminal event 才重用；協定失敗、無法確認已中斷、設定變更、空閒回收或服務關閉時才回收程序。空閒 worker 有時間與數量限制，回收不刪除已保存的對話。

`copilot-rpc.ts` 依 `ChatSettings.acpProvider`（`'copilot' | 'kiro'`，AC-WB-050）啟動對應的 ACP 推論來源：`copilot --acp --stdio` 或 `kiro-cli acp --agent bdd_inference --trust-tools=`（於隔離推論目錄自動寫入零工具／零 MCP 的 `.kiro/agents/bdd_inference.json` 與 `.kiro/settings/mcp.json`），皆使用 NDJSON JSON-RPC 並透過 `initialize` 協商能力；`copilot-chat.ts` 以 `session/new`、`session/prompt`、`session/update`、`session/cancel` 管理模型請求，並於 Kiro `session/new` 驗證 `modes.currentModeId === 'bdd_inference'`。移除私有 headless v3 的 `connect`／`session.create`／`session.send`／`models.list` 與 Content-Length framing，協定失敗不 fallback。

模型清單與推理重用背景 ACP server；每個 provider request 建立獨立 session（`mcpServers: []`），僅輸入 Codex 當次提供的上下文與純文字／JSON 工具宣告契約。模型選項讀取 ACP session 的 config options 或 `models.availableModels`。Copilot ACP 與 Kiro CLI ACP 皆不註冊、不連接、不呼叫任何 MCP Server；所有 MCP 工具（包含 `workbench_task`、`workbench` 與 `agent_supervisor`）皆由 Codex 原生 MCP 連接並執行，內建工具、shell、檔案寫入與額外權限在 ACP 推論層一律禁用並拒絕。取消使用 ACP notification 並等待 prompt 結束；遲到事件不得送入其他請求，不確定是否清理成功的連線須失效重建。傳輸、模型及權限設定以 [GitHub ACP 文件](https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server) 為準。

`packages/workstation/agent-supervisor.mjs` 與 `scripts/mcp-agent-supervisor.mjs` 管理長駐互動式 CLI Agent 工作階段（`agent_supervisor_host`、`agent_sessions`、`agent_session_messages` 與 `agent_session_events` 持久化於 `WB_HOME/metadata.sqlite`），並透過受控白名單 `AGENT_PROFILES`（`'copilot'`、`'kiro'`、`'codex'`、`'claude'`，AC-WB-051）解析允許啟動的 CLI Agent 與 `acp`／`pty` 協定，禁止傳入任意 `command`／`args`／`env`。工作台派工（`codex-sdk-agent.mjs`）與聊天室（`chat.mjs` → `codex-chat.ts`）皆掛載原生 MCP 工具 `agent_start`、`agent_send`、`agent_events`、`agent_list`、`agent_cancel`、`agent_stop`，與外部 CLI Agent 保持多輪對話；人類亦可透過 `/repository-api/v1/agent-sessions`、右側可縮合助手抽屜（`#assistant-drawer` 內的直式整合清單 `#assistant-rooms-panel` 與 `agentSupervisorPanel`）或開發終端輸入框直接啟動與介入同一個 `sessionId`。人類介入訊息預設以 `mode: 'queue'` 優先排入待執行佇列最前端而不強制中斷目前回合，僅在明確指定 `mode: 'interrupt'` 時才對 `BUSY` 回合發出 `session/cancel`／`\x03` 中斷；所有雙向訊息（含 `QUEUED`、`DELIVERED`、`PROCESSED`、`CANCELLED`、`FAILED` 狀態與 `messageId` 冪等性）及輸出按序號 `seq` 記錄供人類、聊天室與派工 Codex 同步讀取。

CLI Agent 選單使用 `GET /repository-api/v1/agent-sessions?activeOnly=true`，在 SQL 分頁前排除已結束的工作階段；終止狀態由 `agent-session-stream.mjs` 的 `endedAgentSessionStatuses` 統一定義。未帶此參數的查詢仍可讀取 SQLite 歷史。收到選中終端的 `closed` 事件後自動重新取得清單，移除已結束項目並釋放舊終端的 WebSocket、ResizeObserver 及計時器；重新開啟選單也重新查詢。停止成功的前提仍是既有 driver 完成程序群組與對應 tmux session 清理，不刪除歷史訊息與事件。`tests/chat-ui/chat.spec.mjs` 使用實際 PTY／tmux 驗證停止後的程序、選單及終端清理。

程序重用測試以受控子程序協定 peer 檢查實際 spawn 次數、串流、並行聊天室、逾時、遲到事件、設定更新、故障恢復與關閉。真實 CLI 的無推理 smoke 驗證固定版本的初始化與 session 協定；這些證據不代表已量測外部模型的首字時間或吞吐量。真實聊天速度須在具有 Copilot 登入與模型權限的環境另行量測。


Schema 12 adds `prompts`, `prompt_revisions` and migration provenance; `agent_task_defaults.prompt_revision_id` binds each task's independent template. Before upgrade, `before-prompt-catalog-v12.sqlite` is created. Historical Agent revisions and operation JSON remain byte-for-byte unchanged. Each legacy combined Agent head receives a new runtime-only revision; old template versions are imported as independent Prompt revisions and current defaults are rebound transactionally. Legacy frozen jobs retain their old execution contract. New submissions must select an explicit Prompt revision suitable for the task; updated/archived revisions are rejected before dispatch. The operation snapshot keeps runtime settings, Prompt content/version, Skills and the final edited text. AC-WB-044 and `prompt-catalog.test.mjs` verify this contract.

## 需求刪除生命週期

邏輯刪除的 canonical owner 是 `spec/{requirementId}/{featureId}/feature.yaml` 的可選 `deletedAt` 時戳，先透過 SQLite authoring transaction 儲存。原文件、測試、審閱紀錄與報告保留；`scan()` 預設排除已刪除功能，`includeDeleted` 僅供識別碼保留、完整性檢查與歷史用途。`assertFeatureActive()` 阻擋已刪除功能的編輯、退回與確認，runner 亦拒絕執行。

`workflow.delete` 要求人類確認的功能 key 與目前 authoring revision，並取得和開發、驗收相同的 repository writer lock；普通儲存仍可進行，revision CAS 防止誤刪新內容。刪除不移除原始檔案，也不提供自動還原。刪除交易透過現有 hash-verified toolkit upgrade 一併更新規格庫工具至 1.8.0，確保輸出後的 CLI 同樣理解刪除狀態；客製或被修改的工具必須先人工處理，不能靜默覆寫。

## 互動歷程的需求歸屬

`operations.interaction_key` 是互動歸屬的持久化 owner：已儲存需求使用 `{requirementId}/{featureId}`，未儲存需求使用其獨立的 `new-*` editor key。補充訊息只繼承同規格庫原作業的歸屬。首次儲存需求時，既有草稿互動與回覆在同一 authoring transaction 轉綁正式需求，不改寫不可變 request 或其 hash。

開啟資料庫時，舊紀錄只按明確需求識別、原作業與保存收據／提案關聯補齊。無法證明歸屬的舊紀錄不會被指派給目前需求。歷程 API 在 SQL 依規格庫、需求 key、階段與 cursor 篩選；前端切換需求會清除舊卡片與終端，拒絕不同選取或較早查詢的回應。

## 系統決策與文件預覽

`spec-toolkit/design-decisions.mjs` 是決策格式、讀寫、未決判定與確認門檻的唯一 owner，亦以唯讀 JavaScript 資產供瀏覽器載入。canonical 資料存於同一份 `.sd.md` 的單一 fenced `workbench-decisions` JSON 區塊，經既有 authoring 交易進入 SQLite；不另建會與文件分歧的問答表或 browser storage。格式為 schemaVersion 1、items 陣列，每題含穩定 id、question、options（id、label、選填 description）、answer（null 或 optionId；選其他時另含非空 customText）。`other` 為程式保留項，由 UI 永遠提供，不由 LLM 產生。生成不能預選答案；重生成必須保留既有題目與人類答案，改寫已回答問題語意或選項會明確拒絕。

`design-generation.mjs` 要求新產出包含決策區塊，即使 items 為空。`writeAgentTask` 的 design decisionContract 告知模型將未決契約轉為有說明的選擇題，選項是提案而非聲稱已實作。`saveFile` 驗證區塊格式；`confirm(sd)` 在有未回答項目時拒絕，不簽署 review。舊無結構化區塊的手寫文件保留相容性；需要問答時重新生成，不能從任意 prose 猜測決策。

前端 `design-view.js` 預設預覽，只有明確按編輯才顯示 Markdown 原文。生成、儲存、重載與跨階段切換都回到預覽；切到預覽不會自動儲存。預覽使用鎖定版本的 markdown-it，停用 raw HTML，並在無腳本權限 iframe 呈現。問答以 DOM text nodes 與原生 radio/input 建立，答案寫回同一文件，由既有儲存按鈕或「儲存系統決策」提交；確認仍是獨立的人類動作。

四種可編輯預設功能 Prompt 的文字唯一來源為 `packages/workstation/seeds/prompts.json`。啟動時驗證 seed schema、purpose 唯一性與模板變數，seedAgentSettings 與新 registry 初始化都從此派生。自訂 Prompt 與既有 revision 不因 Git seed 更新被覆寫；工作台自身的權限、產出格式與階段不變量仍由程式 owner 控制。
