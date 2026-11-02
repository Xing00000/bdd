# 工作台架構與儲存界線

[README](../../README.md) · [操作](../operations.md) · [相容](../compatibility.md)

## 責任模型

工作台管理多個 Spec Repo 綁定；Project 以 `repositoryId + projectId` 定位。沒有全域產品工作區，也不要求使用者管理 Git 分支或提交。

```text
使用者編輯／儲存
  → SQLite 交易（設定、原文、修訂、確認、收據）
  → 已儲存；不提交或修改 checkout、不需要遠端連線

綁定取得既有內容／明確同步／測試／取得產品
  → 固定 SQLite 修訂
  → 受管理 Repo 輸出（衝突檢查）
  → 固定產品版本／隔離驗收／遠端同步
  → 獨立操作結果，不回滾已儲存資料
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
| `packages/git-core/` | Git 原生來源分類、輸出及同步工具，不是儲存引擎 |
| `packages/spec-toolkit/` | 規格契約、內容摘要、可攜工具、驗收候選與證據 |
| `packages/workstation/public/` | 唯一工作台入口、儲存／同步狀態、設定與階段流程 |

## SQLite schema 9

`spec_repositories` 保存綁定網址，不因連線失敗取消登錄。以下是需要備份的正式資料，不是可丟棄快取：

- `authoring_state`：每個綁定的目前修訂與設定。
- `authoring_files`：規格、SD、測試與產品文字編輯。`spec` 與 `project:<id>` 是不同命名空間，即使產品代號叫 spec 也不混淆。
- `requirement_proposals`：原始描述、生成前 Gherkin 及生成結果，按 repository 與需求編輯識別隔離；不授予確認。
- `authoring_history`：修訂原文、設定與儲存收據；每個操作 ID 只能代表同一份請求。
- `repository_preferences`、`operations`、`tooling_checks`、`runs`：站台偏好、持久操作、真實檢查與驗收紀錄。

`repository_projection` 記錄已輸出修訂、檔案摘要、Git 版本及同步位置，不取代 SQLite 原文。`report_index` 為可由 Git 重建的衍生索引。報告、截圖與 traces 保留在執行證據檔案中，SQLite 保存其執行及索引 metadata，不把大量二進位報告放進文字表。

### 互動留言與執行歷程

每次明確送出的操作以 `operations` 保存原始請求、時間、狀態、結果與錯誤，作為一筆互動留言；普通儲存、CLI 派工、Gherkin 生成、文件匯入與停止操作均保留歷程。唯讀輪詢、Prompt 預覽／取消及單純切頁不建立留言。畫面在主要內容下方以最新送出在上的順序呈現留言及其可收合執行 log，載入更早紀錄時加在下方；歷史 API 以 SQL row cursor 分頁，展開舊紀錄不會替換新的紀錄或正在使用的 PTY。

`git-core/progress-store.mjs` 是 `execution_logs`／`execution_log_chunks` 的唯一 schema 與輸出 owner。metadata 保存階段、程序與退出碼，輸出以 byte offset 分塊追加到 `metadata.sqlite`。作業 claim／finish、對應 log 與子互動完成使用同一交易；寫入失敗不會留下已完成狀態。每份 transcript 沿用既有 4 MiB 上限及截斷標示，ANSI／憑證處理與 UTF-8 分頁契約保留。新紀錄不依賴 `terminal.log`、`processes.json` 或 `state.json`；舊檔僅在 SQL 尚無紀錄時一次性讀入，拒絕 symlink，匯入後 SQLite 為唯一來源，不再從修改後的舊檔覆寫。

CLI 終端每次 Enter 建立 `interaction.cli.input` 子留言，保存文字及 parent operation ID；逐字輸入與 resize 不另建留言。worker 在真正寫入 PTY 後保存 delivery ack，再結束前一筆互動；之後輸出同時寫入該筆獨立 log 與原作業完整 transcript。下一次 Enter 或原作業結束會封存前一筆，未取得送達確認的輸入不得隨 parent 成功而變成成功。人工停止另記一筆留言；服務關閉等系統清理不偽造成使用者送出。

來源匯入、審閱摘要與測試型別檢查統一由 `git-core.gitSourceFiles` 使用 Git 原生 `ls-files --cached --others --exclude-standard` 列出來源，再存取檔案，避免遍歷被忽略的快取與連結。固定路徑則由 `gitSourcePaths` 使用 `check-ignore --stdin -z` 判定；不另寫檔名排除或 gitignore parser。這保留巢狀規則、`!` 例外、使用者 global excludes、`.git/info/exclude` 及已追蹤檔案的 Git 語意。SQLite 隔離副本將已接受的來源放入暫存 Git index，保留「已追蹤但命中 ignore pattern 仍是來源」的行為；無 checkout 的來源以暫存 Git metadata 判定。這些本機操作不提交、不連線、不修改原 checkout，建立 index 時停用外部 Git 設定與 hooks，不執行來源指定的 filters。

產品 dirty 判定也保留 Git 的原生 global excludes：先由 Git 讀取有效的 `core.excludesFile`，再將該設定帶入受保護的 status 命令；不為了取得 ignore 規則而重新啟用其他全域設定。選取檔案提交後，使用 `update-index --index-info` 更新選取路徑的 index entries，包括新增與刪除；未選取路徑的 staging 與工作目錄內容保留，不執行 `git reset`。

## 儲存交易

一次儲存先檢查內容 hash，再在 SQLite `BEGIN IMMEDIATE` 交易中寫入內容、設定、遞增修訂、歷史及結果收據。任何寫入失敗整筆回滾。不同檔案的並行儲存可在修訂變動時重新讀取重試；同檔案 expectedHash 不符則拒絕覆蓋。

不呼叫 `git status`、`commit`、`fetch` 或 `push`。背景同步／驗收不佔用儲存鎖；它使用固定修訂，新編輯留在 SQLite 等下一次輸出。Worker 若在 SQLite 成功後、作業完成欄位更新前中斷，可從儲存收據恢復成功狀態，不把已保存的資料誤報為遺失。

既有檔案式 helper 在一次性暫存 view 中處理資料；view 從 SQLite 建立，異動最後才以單筆 SQL 交易提交。view 不是主要儲存位置，也不是產品 checkout。

## Repo 輸出與同步

Spec Repo 仍有 `spec/<REQ>/<feature>`、`tests/<REQ>/<feature>`、`reports/<REQ>/<feature>/<run>`，產品仍是 `projects/<id>` submodule。輸出時使用固定 SQLite snapshot，僅處理該 snapshot 的檔案，不夾帶其他 staged／unstaged 草稿。

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

`agent-settings.mjs` 的實作與測試計劃預設 Prompt 僅包含任務識別、動作及 MCP 工具入口，不展開規格、SD、產品路徑、回報、失敗紀錄或通用流程。Skills 預設留空；只精確遷移已知舊 factory Prompt／參數／完整 BDD skill，自訂值保留。CLI 自身的全域指引仍由該 CLI 管理。

`agent-task.mjs` 是預覽、派工及任務資料 owner。預覽 API 不建立作業或啟動 CLI；畫面可編輯完整 Prompt，取消不派工，送出後原樣傳入 CLI，不再附加隱藏內容。後端要求非空 Prompt 及涵蓋 repository、作者修訂、設定、所選功能、階段與本地位置的預覽摘要；過期則拒絕。內部重試沿用同一已送出 Prompt，新的失敗資料只更新該次 attempt 的任務 MCP。已啟動的工作不因設定更新而重啟。

每次派工保存固定 SQL 修訂的任務資料，`scripts/mcp-agent-task.mjs` 以 stdio 提供 `workbench_get_task` 與 `workbench_read_artifact`。前者提供工作目錄、允許寫入範圍、驗證入口、回報與失敗資料及 artifact 名稱；後者只能讀取該任務映射的所選功能和必要共用測試原文，不接受任意檔案路徑，不提供寫入工具。實作及測試計劃原有後端審閱、範圍、型別及獨立驗證 gate 保留。

預設 CLI 參數中的 `{mcp}` 依 [Codex MCP 設定契約](https://developers.openai.com/codex/mcp) 展開為本次 `workbench_task` 的 command／args 設定，要求伺服器初始化成功，不修改使用者全域設定。自訂 CLI adapter 可透過 `{task}` 接收相同任務檔案並接入 MCP；兩種參數都缺少時拒絕派工，避免極簡 Prompt 在沒有資料通道時啟動。`{prompt}` 是使用者最後送出的文字，`{spec}`／`{project}` 仍可用於自訂 CLI 的工作目錄參數。

設定儲存與工具準備分為兩個獨立操作：`repository.setup` 先保存 SQLite 設定，設定畫面接著呼叫 `repository.tools.prepare`，依既有安裝授權準備該 Spec Repo 的持久套件與可執行功能要求的瀏覽器；尚無功能時沿用 `defaultProfiles`。解析出的 lockfile 以修訂 compare-and-swap 保存。設定保存成功不代表工具已準備成功；準備失敗可從設定頁重試。瀏覽器完整性使用已安裝 Playwright registry 的正式安裝目標，包含 headless shell 與 ffmpeg 等相依執行檔，舊收據不取代檔案檢查。骨架生成與 LLM 補齊只讀取匹配的已安裝工具副本，不會執行 npm；套件缺失或身分改變時明確要求返回設定頁。

需求確認直接保存 SQLite。系統設計確認先保存 SQLite，再進入測試計劃頁執行 `workflow.tests.generate`：`test-plan-codegen.mjs` 在固定修訂的隔離副本中透過已安裝 Playwright-BDD 的原生 Gherkin／step matching 與 Snippet 生成器建立完整 step 骨架，包含超過 CLI 顯示上限十筆的步驟，再執行真正的 bddgen。Playwright-BDD 沒有產生 hooks 的命令；工作台加入既有 AfterStep 截圖契約的可執行 hook。骨架未完成的 step 明確拋錯，不代表實作完成或測試通過。新需求兩份測試文件為空白；已有內容則禁止以骨架覆寫。原生 Snippet 介接集中在 `bdd-snippets.mjs`，不從 CLI 的截斷文字反解析程式。

測試計劃頁另提供「LLM 生成測試計劃」，呼叫 `workflow.tests.complete`，才由 `test-plan.mjs` 使用 Agent 的 `testPlanPrompt`、CLI 與選填自訂 Skills 補齊既有骨架。操作帶入目前測試摘要，拒絕補齊過期畫面或已確認的測試。Agent 隔離副本只載入目前功能的規格、必要需求 metadata、共用 fixtures、工具與設定，以及關聯產品 context；不載入其他 Spec Repo 功能的 Gherkin 或測試。產品二進位檔案保留原始 bytes，初始化獨立 Git 工作目錄供 CLI 使用；不修改 checkout。Agent 只能修改該功能測試檔案及 helpers，不得修改已確認文件、設定、產品或其他來源。CLI 結束並通過範圍檢查後，工作台在另一個完整且固定的 SQL 修訂副本套用提案、執行驗證及推導進度，其他功能原文不會因 Agent 工作目錄的裁切而被刪除。

LLM 結束後獨立檢查禁止空白／僅拋錯 handler 與 skip／focus、TypeScript 型別檢核、真正的 bddgen 與完整案例／瀏覽器 discovery。檢核成功僅代表 `CHECKED / NOT_RUN`；人類確認測試計劃後才進入開發。測試是在產品開發前撰寫，允許產品尚未實作而使驗收失敗；已確認設計允許的狀態模擬與事件注入可作為受控輸入，仍禁止虛構 API、替代產品與假斷言。補齊失敗保留原骨架或原稿及隔離提案；完成後移除隔離 node_modules、.generated 與套件快取。所有生成結果均以原 SQLite 修訂 compare-and-swap 保存，同期退回或修改會阻擋回寫。

`workflow.restart` 是唯一撤銷確認的作者操作，與來源清空在同筆 SQLite 交易完成。退回指定階段會撤銷該階段及下游確認；退回系統設計或需求時，清空該功能 `tests/<REQ>/<feature>/` 的目前文字內容，既有作者修訂歷史與驗收報告保留。其他功能、共用 helpers 與產品不變；相同上游原文再次確認不能復活被撤銷的測試確認。退回測試計劃本身則保留內容供修改。Repo 是後續輸出，不可從舊 checkout 回填已清空的 SQL 文字。

測試確認要通過實作檢查、真實生成及 discovery，必要依賴只有一次安裝授權。安裝新增的 lockfile 與測試確認只能回寫原先受審閱的修訂，不能覆蓋同期新草稿。

驗收把固定 SQLite 內容輸出成 source commit S，再從本機產品版本建立隔離候選，不要求先同步。報告 commit R 記錄受測 S，而不是聲稱 R 已被測試。歷史通過要與目前 SQL 的內容摘要、產品編輯及已輸出版本相符，否則過期。

報告發布使用獨立 publisher。若預設 `publishers/<run>/repo` 已存在但 publication receipt 尚未寫入，原目錄及其所有內容保持原路徑不變；系統從已驗證的 sealed evidence 和固定的 S 在 `publishers/<run>/attempt-<uuid>/repo` 建立新 publisher，不複製原目錄的工作檔。receipt 記錄相對 home 的 `publisherPath` 和保留原目錄時的 `preservedPublisherPath`；後續發布使用該路徑，舊 receipt 缺少路徑時使用預設位置。路徑必須屬於同一 run，且不可經由 symlink；既有 HEAD 與遠端推送檢查仍適用。只有明確同步才推送，不重新執行測試或變更驗證結果。

## 安全與範圍

儲存與讀取不執行 Repo 設定程式。路徑、文字大小、symlink、私密檔案及跨規格庫存取有檢查。SQLite 與歷史可能包含敏感原文，備份必須保密。主機為 loopback 信任模型，沒有公開多租戶 ACL 或 OS sandbox；Agent、MCP、Terminal、錄製的新 UI 完整接線仍未全部提供。

## 兩區編輯資料契約

`requirements.mjs` 提供來源、格式草稿、結構診斷與成對儲存。`requirement-documents.mjs` 只做受限文字提取，不執行文件中的任何程式。既有檔案首次開啟不改寫；若沒有來源描述，僅上方留空。

正式 Gherkin 保存為 `spec/<REQ>/<feature>/<feature>.feature`；原始描述保存為同層 `requirement-source.json`，兩者在 `authoring_files` 與 `authoring_history` 的同一 SQL 交易更新，只有同步／驗收時才輸出到 Repo。後續確認的摘要綁定下方 `.feature` 而不是可隨時補充的來源素材。

生成採用明確標示的本機格式整理，不冒充語意推理。輸出使用 Feature／Scenario／Given／When／Then 及穩定案例標記；瀏覽器回歸另用固定版本的官方 Cucumber parser 驗證輸出。人工編輯的儲存路徑保留原始 bytes，不會因診斷失敗拒絕草稿保存。執行前的完整 BDD discovery 是另一個關卡。


## 綁定與歷史版本目錄

`catalog.mjs` 負責耐久化的 QUEUED → LOADING → READY／READY_WITH_WARNINGS／FAILED 狀態。register 建立本地父目錄並排入取得作業，不將遠端錯誤誤報為登錄失敗。既有遠端內容安全匯入作者模型；已有草稿衝突時保留兩份，歷史版本仍可唯讀查看。取得已宣告的 submodule 不切換已初始化產品的分支或捨棄工作區內容。

不可變 Spec 快照位於 `catalogs/<binding>/<SHA>/repo`；產品版本查詢使用 `version-products/<binding>/<remote-hash>/repo`，不借用編輯中的產品目錄。Git clone 後明確取得所選 SHA，以支援只存在於 remote-tracking refs 的版本。

`regression.mjs` 固定完整版本組合及預期功能／案例矩陣，使用原生 Runner 逐功能執行，不以 UI 模擬 PASS。`regression-evidence.mjs` 在獨立 publisher 將摘要和子證據寫成一筆報告 commit R；所有報告記錄受測 S。回歸不呼叫 SQL 作者編輯或確認函式。人工確認和測試 outcome 是兩個不同維度，任何未審核內容都不會因回歸 PASSED 自動批准。

schema 7 的 `repository_connections` 保存載入進度／目錄索引／錯誤；`regressions` 按 binding + batchId 隔離批次狀態。工作程序中斷會保留逐項結果並把整批標成 INCOMPLETE。遠端批次摘要必須能對應子 manifest，不能單靠一行 PASSED 復原為可信歷史。

## 本地目錄綁定（Schema 8）

`spec_repositories.local_path` 保存由使用者選定、正規化的 host-side checkout 位置；null 表示沿用原受管理路徑。`locations.mjs` 統一解析位置並驗證目錄、來源、路徑重疊及採用條件。所有 Worker、版本查詢、產品讀寫及輸出都從 registry 解出位置，不由 API 操作傳入任意 cwd。

位置切換是獨立的 `repository.location` 作業，使用原位置的樂觀並行檢查與既有 Repo 作業鎖。紀錄新位置及歷史後再取得內容；不移除舊 checkout 或 SQL 作者修訂。作者儲存不需要驗證實體磁碟可用，唯有讀取未匯入檔案、Git 輸出或執行才檢查實際位置。採用 existing clone 時以 HEAD 的原始內容作為 dirty 文件的 base hash，避免把外部草稿誤認成可覆蓋的初始範本。

## Portable workflow state and a shared automation policy

`packages/workstation/workflow-state.mjs` derives a feature's stage from source digests, versioned human review records and matching sealed evidence. Both the detail API/requirement acceptance page and `bdd workflow status/next/run/regress` use that policy. A command cannot turn missing review into approval. Completed jobs and passing product acceptance remain separate outcomes with different CLI exits.

`spec/<REQ>/<feature>/workflow.json` is the portable, versioned progress projection. SQLite stores the durable in-progress revision and history; explicit synchronization projects source plus state together. The state references the original tested commit and canonical report path/ref, never a machine's absolute path. Another binding can reconstruct approvals and progress from Spec content and fetched evidence without copying the first machine's database. Stale/missing evidence is reported rather than trusting the recorded stage string. Local running jobs, cancellations, worker ownership and installation authorization remain operational metadata.

A report is identified by binding + requirement + feature + run. Local and Git-indexed copies are de-duplicated; conflicting immutable identities cannot be used. The requirement acceptance view is scoped by that identity, clears stale evidence on navigation, and rechecks artifact hashes before serving bytes. Report-only or progress-only commits do not invalidate source approvals; content/product changes do. Historical reports for removed features remain available in the repository-wide history.


## Development PTY and acceptance feedback

`workflow.develop` is a durable, repository-locked worker operation. `development.mjs` resolves the host-local Agent command, starts node-pty with explicit argv/cwd and a reduced environment, and streams a bounded transcript through a scoped polling API. Input/resize uses IPC only to the owning live worker. Cancellation participates in the existing process-group termination and repository-lock lifecycle. The browser reconnects to an existing operation rather than launching duplicates.

`packages/workstation/agent-settings.mjs` owns the editable dispatch seed, validation and template expansion. The skill seed reads the bundled `skills/playwright-bdd/SKILL.md`; it does not read host credentials or arbitrary user files. Authoring fills only undefined settings fields into SQLite, both at bootstrap and when opening legacy drafts. Existing argv, custom text and explicitly empty skills survive. Partial Agent updates merge saved settings before validation. The settings UI renders those saved values rather than maintaining a second seed. Development expands the saved template once, appends skills literally, and records the effective text in the existing local `prompt.txt` before sending it through argv to the PTY. Repository or feature navigation clears the old visible notice after the unsaved-draft guard accepts navigation; operation receipts remain available for diagnosis.

Product changes are imported with SQLite revision compare-and-swap, including explicit text deletions. Local commits contain those exact product changes and updated gitlinks; no push occurs. Independently sealed BDD evidence, not CLI exit status, controls acceptance. A source review change, concurrent authoring change or unsupported product file retains on-disk work and stops automatic promotion.

Once that shared workflow policy reports COMPLETE, both the development action and its backend dispatch are read-only. Acceptance feedback reopens development through the existing workflow owner; starting another Agent cannot itself reopen a completed stage.

`workflow.feedback` is a SQLite authoring transaction. It validates report identity against the selected binding/requirement/feature, appends a protected `feedback.json`, and derives portable progress in the same transaction. Prior evidence is immutable. Unresolved feedback overrides an old PASS and returns the feature to IMPLEMENTATION; only a newer qualified run can advance it. The original issue remains in history and is passed to subsequent development as task data.

The acceptance view renders original reporter scenario/step data and attachment hashes. Native Playwright HTML uses an artifact-scoped URL and sandbox without same-origin privileges. It cannot serve arbitrary repository files. Installation, runtime cache, process IDs and transcripts remain local; no credentials are written to portable requirement state.
