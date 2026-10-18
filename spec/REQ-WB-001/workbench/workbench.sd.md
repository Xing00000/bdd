# SD：BDD 軟體開發工作台

版本：0.16；日期：2026-10-18；需求：REQ-WB-001；Gherkin：`workbench.feature`；狀態：**同步既有資料庫的一次性 Agent seed 升級；本版待使用者確認**。

本文件採用 `src/domain/sd-format.ts` 的統一章節，包含本 Gherkin 的架構、開發檔案、流程、DDL／DML、migration、部署產物與驗收契約。設計與實際執行結果分開；執行結果以 `test-results/` 的當次產物為準。

## 1. 核准基準與文件歸屬

唯一需求來源為[同目錄 workbench.feature](workbench.feature)，共 **35 個 Scenario ID、55 個展開案例**，AC-WB-001～035。本次固定原文 SHA-256：

~~~text
eff0925d0a3fa0b916adaa6f659405cf973eb8a0b99fce5abc7151e4dd20c39c
~~~

本功能的文件確認狀態由需求層的 [review.json](../review.json) 管理。SD 修改後必須重新確認其 hash；先前的確認不自動套用到本版。

本 bdd 專案以 Git 自舉。官方 Playwright-BDD skill 固定保存於 `skills/playwright-bdd/SKILL.md`，CLI 使用前驗證固定 SHA-256。每項需求使用 `spec/<requirementId>/`，其下每份 Gherkin 有自己的功能目錄。本功能以 `workbench.feature`、`workbench.sd.md`、`workbench.steps.ts`、`workbench.feature.spec.ts` 為核心四檔；專用測試配套位於 `testing/`。測試介面契約集中於本文件 §14，生成 manifest 與中間檔位於 `test-results/bdd/`。

一項需求包含多份 Gherkin；每份各有專屬 SD、codegen spec、補齊 BDD、確認狀態、階段、測試基線與執行結果。需求父層不持有流程階段。切換 Gherkin 不得帶入其他 Gherkin 的確認或執行狀態。

產品建成後，使用者專案的 Gherkin、SD、spec.ts 可以完整保存在工作台 SQLite；這項產品能力不把尚未完成的 bdd 自舉文件搬進產品 DB。需求 ID 與 release ID 分開，語意為多對多；本次不新增 release 管理功能。

## 2. 核心範圍與技術選擇

採單一組織、多人共用工作台、TypeScript、Node.js、Vue、SQLite。範圍包括需求／多工作區關聯、每份 Gherkin 獨立流程、資料庫持久化的 CLI／Skill／Agent 設定、階段 Agent 指派、互動 PTY、網頁 DB、Playwright 同會話觀看、全域瀏覽器錄製、測試生成與補齊、開發、驗證報告及已完成階段重啟。不補回角色／ACL、audit、評論／協作衝突、忙碌處理、控制權交接、額外核准關卡、預設唯讀 DB、查詢限制或配額管理。

| 選擇 | 理由與能力邊界 |
|---|---|
| Vue 3 Composition API、SFC、TypeScript、Vite | 遵照使用者選型；共用專案、文件編輯、DB 表格、瀏覽器 canvas、xterm 與報告拆為 UI 元件及 composables；不新增框架專用驗收情境。[Vue 官方指南](https://vuejs.org/guide/introduction.html)、[Vite](https://vite.dev/guide/) |
| Node.js 24 LTS、Fastify、WebSocket | 模組化單體承載 use case；HTTP 處理文件／流程／查詢，WS 傳 terminal I/O 與瀏覽器畫格；不先拆微服務。[Node 版本](https://nodejs.org/en/about/previous-releases)、[Fastify](https://fastify.dev/docs/latest/Reference/Server/) |
| SQLite、node:sqlite adapter | metadata.db 與被測專案 DB 分開。DatabaseSync 同步呼叫放 worker／程序，避免阻塞 API。v24.19.0 官方文件標示 release candidate；相容性須在 SD 核准後鎖版驗證，不宣稱已驗證。[官方 API](https://github.com/nodejs/node/blob/v24.19.0/doc/api/sqlite.md) |
| @cucumber/gherkin 與 TypeScript Compiler API | 前者取得 AST／Pickles／語法位置；後者取得 TS AST 與 syntactic diagnostics。皆只解析，不執行提交的程式；原文與正規化投影分開。[Gherkin](https://github.com/cucumber/gherkin)、[Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API) |
| Playwright Test、可替換的 TestGeneratorPort | 依使用者指定採 Gherkin → playwright-bdd → 確定性 TS adapter。確認 SD 後自動產生唯讀、收合的 spec.ts 骨架；之後由流程設定選出的互動 CLI Agent 另存補齊快照。bddgen 9.2.1 原生輸出 .spec.js，adapter 的 TS 型別／識別 metadata 轉換須驗證沒有改變骨架行為；不能聲稱原生產 TS 或已完成驗收。[官方來源](https://github.com/vitalets/playwright-bdd/blob/v9.2.1/src/generate/paths.ts) |
| Playwright Screencast、Vue canvas | 沿用非 noVNC 方案；公開 page.screencast.start({ onFrame }) 提供 JPEG 畫格，服務自行整合 WS、輸入、語意錄製。API 自 v1.59 提供，後續鎖定相容修補版；沒有 FPS／延遲實測承諾。[官方 Screencast](https://playwright.dev/docs/api/class-screencast#screencast-start) |
| xterm.js、node-pty | 前者呈現 terminal，後者管理實際 PTY；工作目錄指向所選本機工作區或隔離的 proposal 目錄。node-pty 不是檔案系統沙箱，不能宣稱程序權限限制在 cwd 內。[xterm](https://xtermjs.org/docs/)、[node-pty](https://github.com/microsoft/node-pty) |
| 互動 CLI Agent | 不呼叫 HTTP LLM provider 或模型 API。CLI、Skill、Agent Prompt 存於 SQLite；需求確認、系統設計、測試情境及程式開發由流程設定多選指派 Agent。需求確認／程式開發在所選本機工作區開互動 PTY；SD／測試情境以設定的 executable 與 argv 啟動 CLI，將 Prompt、Skill、文件與 context 提供給 proposal 工作流程，通過既有格式、來源與執行檢查後才保存提案。驗證報告唯讀，不指派 Agent。 |
| DbGate | 使用官方 DbGate web 操作專案測試 SQLite，Playwright 從真實結果表格讀值、斷言及截圖。服務 URL、連線顯示名稱與憑證由設定提供；憑證不送入 UI 或報告。[官方設定](https://docs.dbgate.io/dbgate/customization/env-variables/index.html) |

生成器重用官方 Gherkin parser／Pickles 與公開 Playwright Test API。step registry 在 codegen 只宣告確切 pattern、參數與 slot ID；未註冊或歧義會阻擋生成，已註冊但尚未補齊則可生成骨架。此類 stub 若被執行須拋明確 UnimplementedStepError，不得空函式、skip 或假斷言。codegen 的型別／discovery 成功不等於補齊完成或 E2E 通過。

## 3. 架構、開發目錄與流程設計

~~~mermaid
flowchart LR
  Vue[Vue UI／HTTP／WS adapters] --> App[Application use cases]
  App --> Domain[Domain：需求、文件版本、階段、測試映射、結果]
  App --> Ports[Outbound ports]
  Adapters[SQLite／Git／Parser／Playwright／PTY／CLI proposal／Artifacts] -.實作.-> Ports
  Ports --> Runtime[本機工作區／target repo與CI／目標DB／CLI]
~~~

程式依賴由外向內：domain 不 import Vue、Fastify、SQLite、Playwright 或模型 SDK；application 只依賴 domain 與 ports；composition root 組裝 adapters。圖中的外部呼叫方向是執行時資料流，不讓外部 SDK 型別滲入 domain。

| 模組／邊界 | 責任 |
|---|---|
| Domain | Requirement、DocumentVersion、Confirmation、Scenario、SourceCase、TestDefinition、Mapping、Baseline、Run；判定階段可寫產物、明確映射、版本綁定、下游失效與結果完整性 |
| Application inbound ports | SaveDocument、ConfirmGherkin、ConfirmSD、ReturnToStage、RestartWorkflowStage、GenerateTests、CompleteTests、ListScenarioTests、StartDevelopment、VerifySelectedCases、Verify、SaveRecording、ReplayScript、BrowseDb、ExecuteSql、OpenTerminal |
| DocumentStore／WorkflowStore | 一次交易保存原文、投影與 head；確認綁定版本／hash，查詢需求與文件 |
| GherkinParser／TypeScriptParser／MappingValidator | 語法、來源位置、結構化投影與明確 ID 檢核；不執行輸入、不推導任意 TS 業務語意 |
| GitRepository／CiRunner | 讀取 target Git 的指定 commit 原文，保存副本及真實 CI 結果；一般 DB 保存不寫入 target Git |
| BrowserSession／Recorder／TestRunner | 瀏覽器錄製可全域建立、保存與在 managed page 重播，不依賴專案；既有專案整合測試仍使用 runner 與執行報告 |
| DbConnection／Terminal／Workspace | 真實 schema／SQL、PTY 程序與使用者指定的本機工作區目錄；與 metadata store 分開 |
| CLI proposal adapter／ArtifactStore | 以設定的互動 CLI 提交 SD／測試補齊提案；圖片及報告檔案、hash 與附件索引 |
| LlmSettingsStore／Agent PTY | SQLite 保存 CLI、Skill、Agent 關聯；需求確認頁依所選 Agent 組合 Prompt、Skill 與已保存 Gherkin，直接啟動對應互動 CLI |

核心流程：

1. 保存 Gherkin → 語法／結構檢核 → 同交易寫原文及投影 → 人類確認該版本／hash。
2. 產生／編輯 SD（含架構與 DDL／DML）→ SQLite 保存完整版本 → 人類確認該版本及所依賴 Gherkin。
3. TESTS：確認 SD 後自動由已確認 Gherkin 產生不可變 codegen 骨架與逐字步驟 slots；spec.ts 在 UI 預設收合且唯讀。使用者點「產生測試步驟」時，工作台讀取專案 `skills/playwright-bdd/SKILL.md`、驗證固定 SHA-256，再複製至本次互動 CLI 暫存工作目錄，由 CLI agent 依確認文件補齊草稿／完成快照。完整檢核通過後，使用者點「確認測試步驟」才固定基線並進入 IMPLEMENTATION，不覆寫骨架快照。
4. IMPLEMENTATION：人類／agent 使用固定需求與測試開發程式 → 固定程式 commit／snapshot。
5. VERIFICATION：使用者由 Gherkin／Examples 清單選案例，依固定完成基線解析全部對應 tests；runner 只執行該集合。右側觀看同一 run 當前 test/session/page 的真實操作，每步斷言、截圖及報告用同一識別鏈回傳。全案執行與選取執行的結果分開判定。
6. 自錄腳本是平行的獨立產品資源：人類操作 viewer → 開始／停止 → 原文／動作另存 SQLite → 取指定版本實際重播；不自動成為標準 CI。

### 3.1 預計開發的檔案目錄與責任

路徑以 repository 根目錄為準；「既有」是目前原始碼可確認的模組，「預計」是尚待開發的產物生成能力。

~~~text
skills/
  playwright-bdd/SKILL.md    官方 skill；CLI 使用前核對 SHA-256
spec/REQ-WB-001/
  review.json
  workbench/
    workbench.feature
    workbench.sd.md
    workbench.steps.ts
    workbench.feature.spec.ts
    testing/{fixtures,support}/
src/
  domain/                    領域規則、parser 與統一 SD 章節
    workflow-agent-stages.ts  可指派流程階段及標籤的唯一定義
  application/               文件、階段、設定、測試與 run use cases
    llm-settings.ts           CLI／Skill／Agent SQLite 設定服務
    workflow-settings.ts      流程階段 Agent 指派與驗證
  ports/                     store、runtime、runner 介面
  adapters/
    sqlite/{schema,features,migrations,llm-settings,workflow-settings,seed,worker,store}.ts
    sqlite/seed.sql           首次啟動 seed 與既有資料庫的一次性 Agent 升級資料
    generation/              Gherkin codegen 與 Agent CLI 提案
    runtime/                 browser、DB、PTY、recording
    runner/                  discovery、執行與證據
    git/                     指定 commit 與 CI 接線
  http/                      API、WebSocket 與報告
  fixtures/                  專用驗收環境
  main.ts                    composition root
ui/src/                      Vue UI、LlmSettingsPage.vue、WorkflowSettingsPage.vue 與輸入傳輸
tests/{unit,integration}/    程式及互動 CLI 測試
tools/                       建置、啟動驗收環境與程式檢查
  bdd/                       BDD 生成、映射與執行入口
package.json                 全專案依賴、build／start／test 入口
tsconfig.build.json          後端與測試編譯設定
dist/                        後端與測試；前端位於 dist/public/
deploy/                      npm run deploy 生成的部署 SQL bundle
test-results/bdd/            最新 manifest、中間檔與執行結果
~~~

| 檔案／目錄 | 狀態與開發責任 |
|---|---|
| `src/domain/sd-format.ts` | 統一 SD 章節與生成要求的 owner；LLM adapter 引用同一定義。 |
| `src/adapters/generation/llm.ts` | 依固定格式提出專屬 SD，缺資訊回問題，不能將提案視為確認。 |
| `src/adapters/sqlite/schema.ts` | 既有 metadata DDL 的可執行來源；設計欄位與約束見 §7.1～7.2。 |
| `src/adapters/sqlite/worker.ts` | 既有 schema 版本檢查、transaction、migration 與 SQL 執行。 |
| `src/adapters/sqlite/llm-settings.ts`、`seed.sql` | schema v10 DDL、首次啟動的 CLI／Agent 資料及一次性既有資料庫 Agent 升級資料。 |
| `src/adapters/sqlite/seed.ts`、`skills/playwright-bdd/SKILL.md` | 以唯一受版本控制的官方 Skill 內容解析 seed marker；首次 seed、既有資料庫升級及 deploy seed 共用 renderer。 |
| `src/adapters/sqlite/workflow-settings.ts` | schema v11 DDL／既有 Gherkin Agent backfill DML；migration registry 的 schema owner。 |
| `src/domain/workflow-agent-stages.ts` | 可指派階段、階段標籤及互動 PTY 階段的唯一程式定義；API、migration 與 UI 讀取同一清單。 |
| `src/application/llm-settings.ts`、`workflow-settings.ts` | Agent/CLI/Skill CRUD 與具交易、輸入驗證的多對多階段指派；API 啟動前再次檢查指派關係。 |
| `ui/src/LlmSettingsPage.vue`、`WorkflowSettingsPage.vue` | 分別維護 CLI/Skill/Agent 與每階段多選 Agent。需求頁只顯示目前可編輯階段已指派的操作按鈕。 |
| `tools/` | build／start 配套；`deploy.mjs` 產生部署 bundle，`migrate.mjs` 為 bundle 執行器來源，細節見 §7.5。 |
| `workbench.steps.ts`、`testing/` | 功能的驗收操作、斷言及專用工具；生成 spec 透過 BDD 註冊呼叫。 |
| `deploy/` | 生成產物，不人工編輯、不存密碼、不混入測試 fixture。 |

### 3.2 需求工作台、固定側欄與本機專案

需求是主要工作單位，專案是綁定本機既有程式碼目錄的資源。`requirements` 不再持有 `project_id`；`requirement_projects` 是多對多關聯的唯一 owner。一份需求保有一組 Gherkin 功能，各功能各有專屬 SD、BDD、確認、階段、基線及結果。關聯兩個專案不複製需求或其文件。

- 首頁 `/requirements` 顯示所有需求；新增需求表單必須同時選一個以上工作區，API 也拒絕空的 `projectIds`。需求名稱可在需求清單原列直接編輯，編輯列同時提供工作區多選下拉選單；儲存時一併更新需求名稱及工作區關聯。
- 需求清單與工作區管理位於同一首頁，工作區管理列在需求清單下方；不另設工作區管理側欄項目或獨立管理頁。工作區名稱及本機程式碼目錄可在該區編輯。
- 左側固定 sidebar 是主要導覽。需求節點預設展開，列出每份 Gherkin 及五個流程階段；已完成階段顯示綠色勾號。需求清單中的需求列以樹狀方式展開 Gherkin，不因展開而導航。右側捲動不移走側欄；窄螢幕以固定按鈕開啟同一個側欄。
- 點選 Gherkin 進入 `/requirements/:id?featureId=:featureId`；重新載入仍使用該需求與 Gherkin。右側以頁籤保留多個開啟畫面，需求確認、系統設計及測試情境內容滿版呈現；流程畫面不另加頁面 header 或專案終端機區塊。
- 工作區管理位於需求首頁下方。工作區必須綁定使用者明確提供的既有絕對目錄，以 realpath 正規化；不另外建立程式碼副本或空的 source 專案。相同 canonical 目錄不可重複註冊。
- 需求中的目前操作專案只能選關聯專案。terminal 的 cwd 是該專案實際目錄；檔案編輯使用專案內相對路徑並拒絕 traversal、.git 及 symlink 越界。
- 來源基線一次固定所有關聯專案的 project ID、目錄、真實 Git commit 與 tree。不同 revision 文字解析為相同 commit 不使結果失效；任何涉及專案的 commit 改變都使既有結果失效。未提交或不在指定 commit 內的程式碼不可冒充固定版本。
- 跨專案驗證在同一需求／Gherkin 下執行；明確選擇主要網站的操作專案，保留所有關聯專案的版本向量。只固定一個專案不能代表整個跨專案需求的來源已固定。
- 修改關聯專案會影響 SD 的開發目錄／資料庫／部署範圍，因此保留 Gherkin 確認，回到 SD（原 GHERKIN 階段維持），使 SD 確認及下游基線／結果失效。原文件與執行證據保留原識別。
- 需求文件及其廣播以 requirement ID／feature ID 歸屬，不以目前選到哪個專案決定 owner。一般瀏覽器錄製是全域工具，不要求工作區；獨立整合測試仍歸自己的實際程式碼專案。
- 左側「瀏覽器錄製」直接開啟全域錄製頁，已保存名稱列在其下。錄製頁只顯示網址列、前往、錄製、重播、保存及真實網頁畫格；前往時才建立 managed browser session。保存需命名，重播使用目前 managed session 執行保存或目前草稿中的結構化 actions。
- 左側「LLM 設定」開啟 `/llm-settings`，管理 CLI 執行檔與 argv、Skill 指示及 Agent Prompt；首次啟動從 `src/adapters/sqlite/seed.sql` 寫入預設資料。已套用舊版 seed 的資料庫再執行一次具獨立 key 的相容升級，補入 Playwright BDD Skill、缺少的流程 Agent 與階段指派；只把仍等於舊 seed 預設值的 Codex argv 更新為目前預設，既有自訂值不覆蓋。每個 seed key 僅套用一次，之後使用者編輯或刪除的值不會在一般重啟時重建。「流程設定」開啟 `/workflow-settings`，為需求確認、系統設計、測試情境及程式開發各自多選 Agent。保存後，需求頁只在該 feature 的目前階段可編輯時顯示已指派的 Agent 操作按鈕；驗證報告維持唯讀。需求確認及程式開發將目前文件、Prompt、Skill 帶入所選工作區的互動 CLI Terminal。
- 已通過的流程階段在右下角顯示「重啟階段」。重啟將 feature.stage 設為所選階段，使該階段重新可編輯、後續階段退回未開始；按鈕只接受目前階段之前的已完成階段。重啟 Gherkin 清除 Gherkin／SD 確認；重啟 SD 只清除 SD 確認；重啟測試情境使測試與 source 基線失效；重啟程式開發使 source 基線失效；重啟驗證只使執行結果失效並保留測試與 source 基線。所有受影響的 runs 標記 INVALID，不刪除文件版本、基線或報告歷程。

本次開發檔案：`src/adapters/sqlite/requirements.ts`（migration 0004／0005／0007）、`migrations.ts`、`src/application/core.ts`（需求／錄製文件）、`extensions.ts`、`src/ports/runtime.ts`、`src/adapters/runtime/browser.ts`、`src/http/server.ts`（全域錄製 API）、`ui/src/BrowserViewer.vue`、`ui/src/RequirementSidebar.vue`、`App.vue`、`style.css` 及本功能的 Playwright 驗收。

## 4. 階段、確認與失效

~~~mermaid
stateDiagram-v2
  [*] --> GHERKIN
  GHERKIN --> SD: 人類確認Gherkin版本/hash
  SD --> TESTS: 人類確認SD；自動產生骨架
  TESTS --> IMPLEMENTATION: CLI補齊檢核通過；人類確認測試步驟並固定基線
  IMPLEMENTATION --> VERIFICATION: 固定程式版本後提交驗證
  VERIFICATION --> VERIFIED: 全案必要測試與證據完整且通過
  VERIFICATION --> VERIFICATION: 失敗或未完整
  SD --> GHERKIN: 退回修改Gherkin
  TESTS --> SD: 退回修改SD
  IMPLEMENTATION --> TESTS: 退回修改測試
  VERIFICATION --> IMPLEMENTATION: 退回修改程式
~~~

所有後續階段均可透過 ReturnToStage 退回指定上游階段；圖僅列常見路徑。VERIFIED 只是 verification/report 的結果，不增加人工關卡。已完成階段可由右下角「重啟階段」從該階段重新開始：只允許目標階段早於目前階段，重啟與該階段及其後的狀態；歷史版本與報告保留，依賴基線及 run 依上方規則失效。未完成／目前階段與尚未開始階段不提供重啟按鈕，API 也拒絕此類請求。

| 階段 | 可修改／執行 | 鎖定 |
|---|---|---|
| GHERKIN | Gherkin | SD、steps／spec、產品程式不開放產生或修改 |
| SD | 當次 SD | 已確認 Gherkin、測試、產品程式 |
| TESTS | SD 確認後自動 codegen 骨架；使用官方 Playwright-BDD skill 的互動 CLI 補齊 steps／fixtures／斷言；使用者確認完成步驟後固定基線 | 已確認 Gherkin、SD；spec.ts 唯讀且預設收合；已保存的骨架版本不覆寫 |
| IMPLEMENTATION | 產品程式 | Gherkin、SD、測試基線 |
| VERIFICATION／VERIFIED | 執行既定測試、保存實際結果／截圖／報告 | Gherkin、SD、測試與產品程式基線 |

TESTS 內的先後子步驟為自動 CODEGEN → CLI COMPLETION → 使用者確認 READY，requirements.stage 在確認前仍用 TESTS：

| 子步驟／快照 | 可產生內容 | 清單顯示與前進條件 |
|---|---|---|
| CODEGEN／SKELETON | spec.ts 殼、step slots、test ID／case 映射與來源 hash；不含實際 UI/API/DB 操作、斷言或截圖實作 | PENDING_COMPLETION（待補齊）、execution=NOT_RUN；不能標 PASSED 或作為標準驗收 run 的可執行基線 |
| COMPLETION／COMPLETION_DRAFT | 流程設定指派的 CLI Agent 另存操作、locator、斷言、fixtures、DB UI 驗證與證據實作，引用原骨架版本/hash；測試情境補齊先核對並提供官方 Playwright-BDD Skill | 有待補 slot／questions 就維持待補齊，不進入產品開發 |
| READY／COMPLETED | 已補齊的 spec 與相依檔案經語法、明確映射、型別、discovery 與必要 slot 檢查後，等待使用者確認 | 按「確認測試步驟」呼叫 start-development，建立測試基線並進入 implementation；實際執行結果仍為 NOT_RUN |

VERIFICATION 的單次選取 run 可以 PASSED，但只有 ALL_REQUIRED 範圍完整通過才能使需求進入 VERIFIED；局部通過維持 verification/report，不替未選案例製造結果。上游變更仍適用下列回退／失效規則。

API、CLI proposal patch、Git 匯出與 workspace／PTY 的檔案寫入都經相同產物寫入規則。鎖定基線是不可寫快照；可修改工作目錄只包含該階段產物，不以 UI disabled 當作保障。違反時回 409 ARTIFACT_LOCKED_IN_STAGE 並保持原內容。既定測試透過 DB UI 執行 fixture DML 是驗證副作用，沒有修改固定測試定義。

確認指向 documentVersionId 與 rawSha256；SD 同時固定來源 Gherkin version/hash。寫入新上游版本不繼承舊確認：
- Gherkin 改動：退回 GHERKIN，SD 確認、測試基線及後續結果失效。
- SD 改動：退回 SD，測試與後續結果失效。
- 測試改動：退回 TESTS，先前程式驗證與結果失效。
- 程式改動：退回 IMPLEMENTATION，執行結果失效。

歷史原文／投影／結果保留，標記為 invalid，不再當作目前基線。Gherkin／SD 修改後重新確認；不在同一階段同時修 feature 與 spec 來換取通過。

自錄清單及獨立整合測試的保存不改寫需求的鎖定測試基線、不推進需求階段；若修改的是需求基線內的測試，仍必須處於 TESTS。無需求關聯錄製不被要求建立虛構 workflow。

## 5. 文件與測試的權威來源

| 類型 | 權威來源／工作台保存行為 |
|---|---|
| 產品內 Gherkin／SD | 工作台 SQLite 保存完整原文及版本；Gherkin另有結構投影，SD固定來源 Gherkin；多人從相同 project/requirement 讀取同一有效版本 |
| 標準專案 CI spec.ts | target Git 為權威。工作台保存指定 repo／branch／commit／path 的逐字副本及結構映射；不由保存 API 自動改 Git 檔案或 CI 清單 |
| 使用者整合測試 | SQLite 保存 spec.ts、執行設定與所需 fixture 版本；執行匯出指定版本 bundle，結果仍連回 DB 定義；不自動寫 target Git |
| 使用者錄製腳本 | SQLite `documents` purpose=recording，project_id 可為 NULL；名稱存在 file_name，網址在 executionConfig.targetUrl，完整原文及 actions 存在版本與 recording_actions；全域錄製在目前 managed session 重播，不建立 workflow run；專案綁定錄製仍可由 runner 建立獨立 run |
| bdd 自身 bootstrap | 全部文件／確認紀錄／測試留在 bdd Git；產品 DB 尚未存在不妨礙自身開發 |

target Git 副本若在 TESTS 中修改，成為待發佈候選版本；只有之後明確的 Git 寫入操作才能成為 target CI 的版本，本 SD 不增加自動同步或 promotion 功能。讀取 branch 後固定 commit；不得將同名 branch 的新內容當成舊 commit 副本。CI 分開記錄候選 commit 與實際 tested commit，因 PR CI 可能跑 merge commit。[GitHub Actions 官方變數](https://docs.github.com/en/actions/reference/workflows-and-actions/variables)

## 6. 入庫檢核、正規化與穩定識別

### 6.1 保存契約

SaveDocument 先判斷文件種類與用途，取得 UTF-8 原文，在記憶體內解析；不先覆寫目前版本、不執行 import／測試或任意程式。原文不做 formatter、換行或 Unicode 正規化；hash 對提交的同一 UTF-8 位元組計算。正規化指建立關聯式資料投影，不是改寫原文。重新讀取返回原文，結構化查詢使用其對應版本，不能偷偷取最新文件投影。

- Gherkin：官方 parser 的 AST／Pickles 及 parseError；記檔名、1-based 行列與原因。需求 ID 來自所選需求／檔案 metadata，不聲稱 Gherkin 原生有需求欄位。Scenario ID 來自明確 tag；保留 keyword、文字、順序、位置、Background、DocString／DataTable 與 Examples。Pickle 的 parser-generated AST id 只在本次解析內使用，不能當穩定業務 ID。[官方架構](https://github.com/cucumber/gherkin/blob/main/README.md)、[generateMessages](https://github.com/cucumber/gherkin/blob/main/javascript/src/generateMessages.ts)
- spec.ts：TypeScript Compiler API 建立 SourceFile／AST；使用隔離的記憶體 CompilerHost 與 Program.getSyntacticDiagnostics，不 emit、不執行輸入。diagnostic.start 用 getLineAndCharacterOfPosition 加 1，message 用 flattenDiagnosticMessageText；只接受語法診斷無錯誤的版本。語法有效不等於型別檢查、import 可解析、Playwright discovery 或執行成功。[官方 Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)、[公開 Program 型別](https://github.com/microsoft/TypeScript/blob/v5.9.3/src/compiler/types.ts)
- SD：保存完整文字與來源 Gherkin version/hash。LLM 生成的 SD 在保存前經 `validateSdFormat` 檢查統一章節、順序、內容、開發目錄及 SQL／明確不適用原因；不合格式回 422 `SD_FORMAT_INVALID` 與行號，不保存成有效版本。此為結構檢查，不執行文件中的 SQL，也不宣稱能自動判定設計語意正確。
- 標準 spec 的骨架與補齊版本都做明確 ID 映射檢核；保存為語法有效版本不表示補齊完成。骨架、補齊草稿、完成快照分別記 stage 與 manifest hash，完成版引用來源骨架。integration／recording 不強迫補入需求關聯或先經 LLM 補齊；其 TS 原文仍做語法解析。

成功時用單一 SQLite transaction 寫 document_versions、相應結構資料、來源映射，再更新 document_heads。投影、FK、映射或最後階段檢查任一失敗均 ROLLBACK；舊有效原文、投影及來源保持不變。拒絕的草稿留在編輯器回應，不寫成新有效版本；初次保存失敗也不建立空 head。

回應 422 SYNTAX_INVALID 或 MAPPING_INVALID：
~~~json
{
  "file": "checkout.spec.ts",
  "diagnostics": [
    { "line": 12, "column": 8, "code": "SYNTAX_INVALID", "reason": "解析器的實際錯誤訊息" }
  ]
}
~~~
映射錯誤另含 testKey／sourceCaseKey 及可得的宣告或 manifest 位置；不是語法錯誤時不偽造 parser 訊息。API 回應的 savedVersionId 只有整個交易成功才存在。

### 6.2 ID 與映射範圍

| ID | 範圍與規則 |
|---|---|
| requirement_key | 同 project 唯一，例如 REQ-WB-001；不是 release ID |
| scenario_key | 同 requirement 唯一且跨版本穩定，例如 AC-WB-025；修改文字不改 ID，不沿用 ID 代表不相關新行為 |
| Scenario version | (gherkinVersionId, scenarioId)；歷史版本不覆寫 |
| case_key | 同來源 Scenario 版本唯一；Outline 取明確 Examples case_id，跨多個 Examples 表也不重複；普通 Scenario 有唯一 default 列，避免 NULL 唯一性陷阱 |
| test_key | 同 spec 文件版本內唯一的明確測試 ID；跨檔識別用 documentId/testKey，版本識別再加 specVersionId。不是 Playwright 隨設定計算的 runtime test id |
| mapping | testDefinitionId → sourceCaseId；sourceCaseId 已固定 Gherkin 版本、Scenario 與 Examples 列。多個不同 test ID 可指同一來源案例 |

標準生成 manifest 由確定性 generator 在展開案例時直接寫出來源與 testKey；同一 ID 也置於受支援測試宣告的明確 annotation。[Playwright 公開 test annotation](https://playwright.dev/docs/api/class-test#test-call) 可供 reporter 讀取；使用自有 type=workbenchTestId 與 description=testKey，這是本案契約，不聲稱 Playwright 自帶需求映射。AST adapter 只檢查固定生成語法中的宣告、ID 與來源位置是否和 manifest 一致，不從任意 TS callback 推導 Gherkin 意義。動態計算的標準測試宣告、不可辨識的包裝或無明確 ID 時回報待補，不執行程式來猜測。一般自錄原文可通過語法保存，不能僅因無法辨識完整 TS 語意就替它虛構來源。

標準測試有效保存前檢查：每個測試有明確對應、全部應生成來源案例至少有一個測試、同版本 test_key 唯一、完全相同 (testDefinitionId, sourceCaseId) 不重複、引用 Scenario／Examples／版本存在且同專案／需求；manifest 的 spec hash 必須等於此次提交原文。**沒有 UNIQUE(sourceCaseId)**；test-a 與 test-a-extra 可同時對應案例 a。多對一不減少驗證義務：基線內每個必要 test 都要實際執行，不能只挑同案例其中一個成功結果。

## 7. 資料庫 DDL／DML 與 migration

metadata.db 保存產品資料；target_connections 指向另一份被測專案 SQLite。DDL dialect 為 SQLite；產品使用 Node.js 24 的 node:sqlite，worker 回傳實際 sqliteVersion，不將未鎖定的 SQLite patch 版本寫成已驗證版本。可執行 schema owner 為 `src/adapters/sqlite/schema.ts`；migration registry 依序將既有 schema 0～9 升到 10；未知版本拒絕啟動。§7.1～7.2 為不可變的初始 migration SQL，現行完整模型須套用 §7.6～7.9 及 DbGate migration，不可只執行初始 DDL。每個 connection 在 transaction 外啟用 foreign_keys；TEXT 主鍵明訂 NOT NULL，複合 FK 指向明確 PRIMARY KEY／UNIQUE。[SQLite FK](https://sqlite.org/foreignkeys.html)、[NULL 與唯一性](https://sqlite.org/lang_createtable.html)

### 7.1 原文、需求及 Gherkin 正規化

~~~sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  workspace_ref TEXT NOT NULL
);
CREATE TABLE requirements (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  requirement_key TEXT NOT NULL,
  stage TEXT NOT NULL CHECK(stage IN
    ('GHERKIN','SD','TESTS','IMPLEMENTATION','VERIFICATION','VERIFIED')),
  UNIQUE(project_id, requirement_key),
  UNIQUE(id, project_id)
);
CREATE TABLE documents (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  requirement_id TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('gherkin','sd','spec')),
  purpose TEXT NOT NULL CHECK(purpose IN
    ('requirement','target_ci','integration','recording')),
  file_name TEXT NOT NULL,
  FOREIGN KEY(requirement_id, project_id) REFERENCES requirements(id, project_id),
  CHECK(
    (purpose='requirement' AND kind IN ('gherkin','sd') AND requirement_id IS NOT NULL)
    OR (purpose='target_ci' AND kind='spec' AND requirement_id IS NOT NULL)
    OR (purpose IN ('integration','recording') AND kind='spec')
  )
);
CREATE UNIQUE INDEX one_requirement_document
  ON documents(requirement_id, kind) WHERE purpose='requirement';
CREATE TABLE document_versions (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id),
  version_no INTEGER NOT NULL CHECK(version_no > 0),
  raw_text TEXT NOT NULL,
  raw_sha256 TEXT NOT NULL CHECK(length(raw_sha256)=64),
  parser_name TEXT,
  parser_version TEXT,
  projection_schema_version INTEGER NOT NULL CHECK(projection_schema_version > 0),
  source_gherkin_version_id TEXT REFERENCES document_versions(id),
  test_stage TEXT CHECK(test_stage IN ('SKELETON','COMPLETION_DRAFT','COMPLETED')),
  source_skeleton_version_id TEXT REFERENCES document_versions(id),
  test_manifest_json TEXT,
  test_manifest_sha256 TEXT CHECK(test_manifest_sha256 IS NULL OR length(test_manifest_sha256)=64),
  execution_config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(document_id, version_no),
  UNIQUE(id, document_id),
  UNIQUE(id, raw_sha256),
  CHECK((test_manifest_json IS NULL AND test_manifest_sha256 IS NULL)
    OR (test_manifest_json IS NOT NULL AND test_manifest_sha256 IS NOT NULL)),
  CHECK(
    (test_stage IS NULL AND source_skeleton_version_id IS NULL)
    OR (test_stage IS NOT NULL AND test_stage='SKELETON'
        AND source_skeleton_version_id IS NULL AND test_manifest_json IS NOT NULL)
    OR (test_stage IS NOT NULL AND test_stage IN ('COMPLETION_DRAFT','COMPLETED')
        AND source_skeleton_version_id IS NOT NULL AND test_manifest_json IS NOT NULL)
  )
);
CREATE TABLE document_heads (
  document_id TEXT PRIMARY KEY NOT NULL REFERENCES documents(id),
  version_id TEXT NOT NULL,
  FOREIGN KEY(version_id, document_id) REFERENCES document_versions(id, document_id)
);
CREATE TABLE confirmations (
  requirement_id TEXT NOT NULL REFERENCES requirements(id),
  kind TEXT NOT NULL CHECK(kind IN ('gherkin','sd')),
  version_id TEXT NOT NULL,
  raw_sha256 TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  PRIMARY KEY(requirement_id, kind),
  FOREIGN KEY(version_id, raw_sha256) REFERENCES document_versions(id, raw_sha256)
);
CREATE TABLE scenarios (
  id TEXT PRIMARY KEY NOT NULL,
  requirement_id TEXT NOT NULL REFERENCES requirements(id),
  scenario_key TEXT NOT NULL,
  UNIQUE(requirement_id, scenario_key)
);
CREATE TABLE scenario_versions (
  gherkin_version_id TEXT NOT NULL REFERENCES document_versions(id),
  scenario_id TEXT NOT NULL REFERENCES scenarios(id),
  ordinal INTEGER NOT NULL CHECK(ordinal > 0),
  scenario_kind TEXT NOT NULL CHECK(scenario_kind IN ('scenario','outline')),
  title TEXT NOT NULL,
  source_line INTEGER NOT NULL CHECK(source_line > 0),
  source_column INTEGER NOT NULL CHECK(source_column > 0),
  PRIMARY KEY(gherkin_version_id, scenario_id),
  UNIQUE(gherkin_version_id, ordinal)
);
CREATE TABLE step_groups (
  id TEXT PRIMARY KEY NOT NULL,
  gherkin_version_id TEXT NOT NULL REFERENCES document_versions(id),
  scenario_id TEXT,
  scope TEXT NOT NULL CHECK(scope IN
    ('feature_background','rule_background','scenario')),
  owner_key TEXT NOT NULL,
  FOREIGN KEY(gherkin_version_id, scenario_id)
    REFERENCES scenario_versions(gherkin_version_id, scenario_id),
  UNIQUE(gherkin_version_id, owner_key),
  CHECK((scope='scenario' AND scenario_id IS NOT NULL)
    OR (scope IN ('feature_background','rule_background') AND scenario_id IS NULL))
);
CREATE TABLE steps (
  id TEXT PRIMARY KEY NOT NULL,
  group_id TEXT NOT NULL REFERENCES step_groups(id),
  ordinal INTEGER NOT NULL CHECK(ordinal > 0),
  keyword TEXT NOT NULL,
  text TEXT NOT NULL,
  argument_json TEXT,
  source_line INTEGER NOT NULL CHECK(source_line > 0),
  source_column INTEGER NOT NULL CHECK(source_column > 0),
  UNIQUE(group_id, ordinal)
);
CREATE UNIQUE INDEX one_scenario_step_group
  ON step_groups(gherkin_version_id, scenario_id) WHERE scope='scenario';
CREATE TABLE example_tables (
  id TEXT PRIMARY KEY NOT NULL,
  gherkin_version_id TEXT NOT NULL,
  scenario_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal > 0),
  title TEXT NOT NULL,
  FOREIGN KEY(gherkin_version_id, scenario_id)
    REFERENCES scenario_versions(gherkin_version_id, scenario_id),
  UNIQUE(gherkin_version_id, scenario_id, ordinal),
  UNIQUE(id, gherkin_version_id, scenario_id)
);
CREATE TABLE example_columns (
  table_id TEXT NOT NULL REFERENCES example_tables(id),
  ordinal INTEGER NOT NULL CHECK(ordinal > 0),
  name TEXT NOT NULL,
  PRIMARY KEY(table_id, ordinal),
  UNIQUE(table_id, name)
);
CREATE TABLE source_cases (
  id TEXT PRIMARY KEY NOT NULL,
  gherkin_version_id TEXT NOT NULL,
  scenario_id TEXT NOT NULL,
  example_table_id TEXT,
  row_ordinal INTEGER NOT NULL,
  case_key TEXT NOT NULL,
  FOREIGN KEY(gherkin_version_id, scenario_id)
    REFERENCES scenario_versions(gherkin_version_id, scenario_id),
  FOREIGN KEY(example_table_id, gherkin_version_id, scenario_id)
    REFERENCES example_tables(id, gherkin_version_id, scenario_id),
  UNIQUE(gherkin_version_id, scenario_id, case_key),
  UNIQUE(example_table_id, row_ordinal),
  UNIQUE(id, example_table_id),
  CHECK(
    (example_table_id IS NULL AND row_ordinal=0 AND case_key='default')
    OR (example_table_id IS NOT NULL AND row_ordinal>0 AND length(case_key)>0)
  )
);
CREATE TABLE example_cells (
  source_case_id TEXT NOT NULL,
  example_table_id TEXT NOT NULL,
  column_ordinal INTEGER NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY(source_case_id, column_ordinal),
  FOREIGN KEY(source_case_id, example_table_id)
    REFERENCES source_cases(id, example_table_id),
  FOREIGN KEY(example_table_id, column_ordinal)
    REFERENCES example_columns(table_id, ordinal)
);
~~~

step_groups 保留 Feature／Rule Background 與 Scenario steps 的歸屬；owner_key 是本來源版本內的 AST 路徑，不是跨版本穩定 Scenario ID。argument_json 只保存 DocString／DataTable 這類葉節點資料；需求、情境、steps、Examples 欄／列／值與測試映射不是整包 JSON。

普通 Scenario 的 default case 仍有實體 source_cases 列；Outline 每列 case_id 都非空。沒有用 nullable example_case_id 做唯一鍵；example_table_id 的 NULL 僅表示普通 Scenario，不會讓同 Scenario 的 default 重複。example_cells 的 table_id 非 NULL，故普通 Scenario 不會出現虛構 Examples cell。

### 7.2 測試、錄製、基線及結果

~~~sql
CREATE TABLE test_definitions (
  id TEXT PRIMARY KEY NOT NULL,
  spec_version_id TEXT NOT NULL REFERENCES document_versions(id),
  test_key TEXT NOT NULL CHECK(length(test_key)>0),
  title TEXT NOT NULL,
  source_line INTEGER NOT NULL CHECK(source_line > 0),
  source_column INTEGER NOT NULL CHECK(source_column > 0),
  UNIQUE(spec_version_id, test_key)
);
CREATE TABLE test_case_mappings (
  test_definition_id TEXT NOT NULL REFERENCES test_definitions(id),
  source_case_id TEXT NOT NULL REFERENCES source_cases(id),
  PRIMARY KEY(test_definition_id, source_case_id)
);
CREATE TABLE recording_actions (
  spec_version_id TEXT NOT NULL REFERENCES document_versions(id),
  ordinal INTEGER NOT NULL CHECK(ordinal > 0),
  page_key TEXT NOT NULL,
  action_kind TEXT NOT NULL,
  locator_json TEXT,
  payload_json TEXT NOT NULL,
  PRIMARY KEY(spec_version_id, ordinal)
);
CREATE TABLE git_snapshots (
  spec_version_id TEXT PRIMARY KEY NOT NULL REFERENCES document_versions(id),
  repository_url TEXT NOT NULL,
  branch_ref TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  file_path TEXT NOT NULL
);
CREATE TABLE target_connections (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  sqlite_file_ref TEXT NOT NULL,
  environment_label TEXT NOT NULL,
  app_base_url TEXT
);
CREATE TABLE baselines (
  id TEXT PRIMARY KEY NOT NULL,
  requirement_id TEXT NOT NULL REFERENCES requirements(id),
  kind TEXT NOT NULL CHECK(kind IN ('tests','source')),
  manifest_json TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  valid INTEGER NOT NULL CHECK(valid IN (0,1))
);
CREATE TABLE baseline_documents (
  baseline_id TEXT NOT NULL REFERENCES baselines(id),
  document_version_id TEXT NOT NULL REFERENCES document_versions(id),
  PRIMARY KEY(baseline_id, document_version_id)
);
CREATE TABLE runs (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  requirement_id TEXT,
  origin TEXT NOT NULL CHECK(origin IN ('target_ci','integration','recording')),
  execution_scope TEXT NOT NULL CHECK(execution_scope IN ('SELECTED_CASES','ALL_REQUIRED','INDEPENDENT')),
  baseline_id TEXT REFERENCES baselines(id),
  script_version_id TEXT REFERENCES document_versions(id),
  connection_id TEXT REFERENCES target_connections(id),
  candidate_commit TEXT,
  tested_commit TEXT,
  source_ref TEXT,
  definition_snapshot_json TEXT NOT NULL,
  environment_snapshot_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN
    ('NOT_RUN','RUNNING','PASSED','FAILED','INCOMPLETE','INVALID')),
  FOREIGN KEY(requirement_id, project_id) REFERENCES requirements(id, project_id),
  CHECK(
    (origin='target_ci' AND requirement_id IS NOT NULL AND baseline_id IS NOT NULL
      AND execution_scope IN ('SELECTED_CASES','ALL_REQUIRED'))
    OR (origin IN ('integration','recording') AND script_version_id IS NOT NULL
      AND execution_scope='INDEPENDENT')
  )
);
CREATE TABLE run_source_cases (
  run_id TEXT NOT NULL REFERENCES runs(id),
  source_case_id TEXT NOT NULL REFERENCES source_cases(id),
  PRIMARY KEY(run_id, source_case_id)
);
CREATE TABLE run_test_selection (
  run_id TEXT NOT NULL REFERENCES runs(id),
  test_definition_id TEXT NOT NULL REFERENCES test_definitions(id),
  PRIMARY KEY(run_id, test_definition_id)
);
CREATE TABLE case_results (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id),
  test_definition_id TEXT REFERENCES test_definitions(id),
  runtime_test_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN
    ('NOT_RUN','RUNNING','PASSED','FAILED','INCOMPLETE','INVALID')),
  UNIQUE(run_id, runtime_test_key),
  UNIQUE(run_id, test_definition_id),
  UNIQUE(id, run_id),
  FOREIGN KEY(run_id, test_definition_id)
    REFERENCES run_test_selection(run_id, test_definition_id)
);
CREATE TABLE run_browser_bindings (
  run_id TEXT PRIMARY KEY NOT NULL REFERENCES runs(id),
  case_result_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  context_ref TEXT NOT NULL,
  page_id TEXT NOT NULL,
  binding_seq INTEGER NOT NULL CHECK(binding_seq > 0),
  FOREIGN KEY(case_result_id, run_id) REFERENCES case_results(id, run_id)
);
CREATE TABLE step_results (
  id TEXT PRIMARY KEY NOT NULL,
  case_result_id TEXT NOT NULL REFERENCES case_results(id),
  source_step_id TEXT REFERENCES steps(id),
  browser_session_id TEXT,
  browser_context_ref TEXT,
  browser_page_id TEXT,
  binding_seq INTEGER,
  action_index INTEGER NOT NULL CHECK(action_index > 0),
  expected_json TEXT,
  actual_json TEXT,
  status TEXT NOT NULL CHECK(status IN
    ('NOT_RUN','RUNNING','PASSED','FAILED','INCOMPLETE','INVALID')),
  error_text TEXT,
  UNIQUE(case_result_id, action_index),
  CHECK(
    (browser_session_id IS NULL AND browser_context_ref IS NULL
      AND browser_page_id IS NULL AND binding_seq IS NULL)
    OR (browser_session_id IS NOT NULL AND browser_context_ref IS NOT NULL
      AND browser_page_id IS NOT NULL AND binding_seq IS NOT NULL AND binding_seq > 0)
  )
);
CREATE TABLE screenshots (
  id TEXT PRIMARY KEY NOT NULL,
  step_result_id TEXT NOT NULL REFERENCES step_results(id),
  moment TEXT NOT NULL CHECK(moment IN
    ('precondition','after_action','after_assertion','failure')),
  artifact_ref TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK(length(sha256)=64)
);
~~~

test_case_mappings 的複合主鍵只阻止完全相同 pair 重複；source_case_id 沒有單欄唯一限制。無關聯錄製的 documents.requirement_id、document_versions.source_gherkin_version_id 可為 NULL，且 mapping 為零列；不是用空字串、default 假情境或虛構需求填滿。若使用者提供關聯，則指向真實來源版本及 source case。

case_results 以 test 為一列，不能用 UNIQUE(run, scenario, case) 把多對一測試擠成一個結果；情境報告透過映射聚合每個必要 test。獨立錄製無 Gherkin 映射時保留 runtime_test_key，source_step_id 可 NULL，以動作序號追蹤。圖片 bytes 在 artifact 目錄，SQLite 保存引用／hash，不覆蓋其他 run 的圖片。

經工作台 codegen 的標準 spec，其 test_stage 必填；Gherkin／SD 及獨立 integration／recording 的此欄為 NULL。既有 target Git 匯入副本若沒有骨架來源，也保留 NULL 與真實 Git 引用，不補造 codegen 歷史；AC028 的可選取執行使用已完成的 BDD 基線，既有 CI 引用／結果保存能力維持。補齊草稿／完成版的 source_skeleton_version_id 必須指同一 logical document、同一來源 Gherkin 的 SKELETON；source hash 同時記於 test_manifest_json。一般 FK 只保證版本存在，stage、kind、需求及 root 關係由 application 驗證。JSON manifest 保存骨架／補齊來源、slot／test IDs 與相依檔 hash，原本關聯式情境／steps／Examples／mapping 繼續保存，不改成只存整包 JSON。

run_source_cases 固定使用者選取的來源案例集合；run_test_selection 固定這次應執行的完整 test 集合；case_results 只能引用該 run 已選 test。其 nullable test_definition_id 僅保留獨立腳本未知標準 ID 的既有能力；從 Gherkin 清單啟動的標準 run 結果必須非 NULL；外部 CI 匯入的未知映射結果保留 runtime ID，但不能據此宣稱 AC028 或全案驗收通過。UNIQUE(run_id,test_definition_id) 保證每個固定 test 只有一個聚合結果，NULL 時仍靠 runtime_test_key 唯一。run_browser_bindings 只保存當前畫面綁定，切換時遞增 binding_seq；不是控制權租約或 audit 歷史。瀏覽器步驟的 session/context/page/seq 全部填入，非瀏覽器步驟全部 NULL，截圖透過 step_results 追到同 run/test/case。

下列跨表語意由 application 在同一交易前／內檢查，不能宣稱普通 FK 已涵蓋：
- Gherkin／SD／spec 的 kind、purpose、所屬 project／requirement、source_gherkin_version_id 類型及來源版本一致。
- Gherkin／spec 的 parser_name、parser_version 必須有值；SD 可不指定語法解析器。
- 確認的 version 必須是相同需求、相同 kind 的目前 head；SD 來源必須為目前已確認 Gherkin。
- 每個 Gherkin 場景／step group／Examples 對應本版本同需求，普通／Outline 的 case 形狀正確；每個 Examples row 的所有欄值齊全，case_id cell 等於 case_key。
- 標準測試的 manifest 覆蓋完整、test ID 與 AST 明確宣告相符、每筆 mapping 屬指定來源版本；重複原始映射在 INSERT 前報錯，不以 INSERT OR IGNORE 默默吞掉。
- run 的 baseline、script／connection 及結果屬相同 project／來源；target_ci 的 git_snapshots 內容真實匹配 commit/path。選取的 source cases 及 tests 必須屬固定基線；標準 run 只接受 COMPLETED 快照，結果集合不得擴大到未選案例。
- document_versions、scenario_versions 及其子投影一經成功保存即視為不可變；後續修改新增版本，head／當前確認／有效狀態是可更新的流程資料。

### 7.3 交易 DML、遷移及資料風險

示意保存流程（解析與映射檢查已完成；下列子投影 INSERT 由相應 adapter 提供，不是可直接繞過 domain 的 SQL API）：

~~~sql
BEGIN;
INSERT INTO document_versions
  (id, document_id, version_no, raw_text, raw_sha256,
   parser_name, parser_version, projection_schema_version,
   source_gherkin_version_id, test_stage, source_skeleton_version_id,
   test_manifest_json, test_manifest_sha256, created_at)
VALUES
  (:version_id, :document_id, :version_no, :raw_text, :raw_sha256,
   :parser_name, :parser_version, 1, :source_gherkin_version_id,
   :test_stage, :source_skeleton_version_id, :test_manifest_json, :test_manifest_sha256, :utc_now);
-- 同一交易 INSERT scenario_versions／steps／Examples 或 test_definitions／mappings。
-- 若任何解析投影／映射／FK／階段檢查失敗：ROLLBACK，不更新 head。
INSERT INTO document_heads(document_id, version_id)
VALUES (:document_id, :version_id)
ON CONFLICT(document_id) DO UPDATE SET version_id=excluded.version_id;
COMMIT;
~~~

確認 use case 先驗 stage／head／hash、SD 來源，再於同交易寫 confirmations 並更新 requirements.stage。UPDATE 的受影響列數必須符合預期，否則 ROLLBACK。退回改動同交易更新 stage、清除受影響當前 confirmations、將 baselines.valid 設 0 及下游 runs.status 設 INVALID；歷史 version 與其 raw 不刪除。新版本即使文字相同仍有自己的 version_no；hash 本身不是跨版本唯一鍵。

全新 metadata.db 使用此初始 schema，由 worker 以 BEGIN IMMEDIATE 包住 DDL 與 user_version=1；失敗 ROLLBACK。已有資料的後續升級採「備份 → 新表／新投影 → 逐版本重解析與 hash／關聯比對 → 同交易切換 head」；無法重建來源的資料列標示待補，不捏造 mapping。回復使用 migration 前備份或切回舊表／head；不可用 DROP COLUMN 假裝能還原已丟失的原文。

原文、穩定 ID、Example 列、Git commit 副本是主要資料風險；誤格式化／覆寫／錯配會破壞證據鏈。存 raw 與投影的原子交易、不可變版本及 FK／唯一鍵解決一致性問題，不等於權限或 audit 子系統。大圖放 artifacts 避免膨脹 DB；不新增查詢／人數配額功能。

target DB 的當次 DDL／DML 必須在其 SD 列出真實 schema、影響欄位與資料、回復 SQL／備份前提。SQLite 一般交易失敗可 ROLLBACK，但 VACUUM 等命令不能一概放入交易；不可假設已提交的破壞性 DDL 或外部副作用能靠同一 ROLLBACK 還原。[SQLite transaction](https://sqlite.org/lang_transaction.html)、[VACUUM](https://sqlite.org/lang_vacuum.html)

### 7.4 選取案例的固定執行集合

令 S(r) 為本次所選 source_cases；E(r) 為固定完成基線內、明確映射到 S(r) 的所有不同 test_definition_id。選案例 a 時須包含 test-a 與 test-a-extra，不能只取第一筆 mapping。run 在完成版本、來源 hash、scope 與 discovery 集合檢核後才建立；run 與兩組選取資料同交易保存。

~~~sql
-- 本次 run/source_ref/baseline 及 run_source_cases 已以綁定參數寫入同一交易。
INSERT INTO run_test_selection(run_id, test_definition_id)
SELECT DISTINCT :run_id, t.id
FROM baseline_documents bd
JOIN baselines b ON b.id=bd.baseline_id
JOIN document_versions v ON v.id=bd.document_version_id
JOIN test_definitions t ON t.spec_version_id=v.id
JOIN test_case_mappings m ON m.test_definition_id=t.id
JOIN run_source_cases selected
  ON selected.source_case_id=m.source_case_id AND selected.run_id=:run_id
WHERE b.id=:baseline_id AND b.valid=1 AND v.test_stage='COMPLETED';
~~~

E(r) 為空、映射缺漏／歧義或選取案例不屬該基線即拒絕，不建立可被當成成功的空 run。多 test 對一 case 維持允許；若同一 test 同時代表選取與未選案例，選取執行回報 MAPPING_AMBIGUOUS，先於 TESTS 拆成可獨立選取的 tests，不偷偷擴大範圍。ALL_REQUIRED 使用基線的全部必要案例；INDEPENDENT 沿用獨立腳本執行，不強加 Gherkin 關聯。

### 7.5 deploy 產物、DDL／DML 與 migration 流程

**FACT**：初始 `schema.ts` 不包含使用者資料；migration 0010 建立 CLI、Skill、Agent 與 seed 執行記錄表。預設設定由唯一來源 `src/adapters/sqlite/seed.sql` 提供，不存帳號密碼或使用者秘密。§7.3 是參數化業務交易範例，§12.1 是專用被測 DB 的 fixture，不屬於產品預設設定。

**DECISION**：部署產物由程式依 schema／migration owner 生成，不能從任意 Markdown SQL block 自動抽取並執行。統一區分 DDL、migration backfill DML、一次性 app seed、業務 DML 與測試 fixture。worker 在 migration 完成後，以交易執行 seed.sql 並記錄 seed key；後續啟動不重建使用者已刪除的預設值。

以 `npm run deploy` 先建置再產生下列 bundle；只有 migration 確實含 seed／backfill DML 時才產生 `dml/<migration-id>.sql`：

~~~text
deploy/
  manifest.json                 順序、DB dialect、來源與產物 hash
  README.md                     前提、執行、備份與回復方式
  migrate.mjs                   只使用 Node.js 內建模組的執行器
  seed.sql                      首次 app 啟動設定資料
  ddl/<migration-id>.sql         完整結構變更
  migrations/<migration-id>.sql  依順序執行的完整交易與版本更新
~~~

| 欄位／產物 | 必要規格 |
|---|---|
| manifest | 固定 sourceRef（提供時）、來源檔案 SHA-256、SQLite dialect、migration ID、fromVersion／toVersion、執行順序、各 SQL 檔 hash 與 seed.sql hash。 |
| DDL | 從 canonical schema／migration 生成；表、欄位、FK、UNIQUE、CHECK、index 與本章設計一致。 |
| 部署 DML | 明列實際 seed／backfill 的來源、影響列與重跑策略；沒有時 `dml: []` 並附原因，不放使用者帳號、密碼或測試資料。 |
| 業務 DML | 留在 application 的參數化 use cases；§7.3 僅描述參數／transaction，不納入部署執行清單。 |
| migration | 檢查目標目前版本、依 manifest 順序執行，成功後才更新版本；遇未知版本或 hash 不符立即拒絕。已套用版本不重跑 DML。 |
| 回復 | migration 前建立可恢復的 DB 備份；交易內失敗 ROLLBACK，已提交且不可逆的資料改動只能依明訂回復 SQL 或備份處理。 |

流程：讀取 `src/adapters/sqlite/migrations.ts` 的 canonical migration → 驗證順序與 from/to version → 產生 DDL／必要 DML／完整 migration → 計算來源與產物 hash → 寫入 deploy manifest → 人類依 README 指定目標及備份 → 執行器驗證版本與 hash → 交易執行 → 更新 schema version → 輸出實際結果。worker 與 deploy 共用 migration registry；`schema.ts` 保存初始 DDL，deploy 另輸出 canonical seed.sql。生成器不自動連接或修改產品 DB；生成成功、migration 成功與產品驗收成功分別記錄。

`node deploy/migrate.mjs <database-file>` 可初始化全新 DB；已有 DB 且有待執行 migration 時必須提供 `--backup <new-backup-file>`。執行器使用 node:sqlite 的 backup API 建立備份，拒絕覆蓋既有備份檔；新 DB 與備份以 0600 建立。SQL hash 或版本序列不符時停止，已套用的 migration 不重跑。測試只對專用暫存 DB 驗證，不將生成 bundle 當成正式環境已部署的證據。

### 7.6 每份 Gherkin 的獨立流程 migration（schema version 2）

Canonical owner 為 `src/adapters/sqlite/features.ts`，由 `migrations.ts` 註冊 `0002_feature_workflows`。依序執行以下 DDL、backfill DML、結構切換，全部在同一交易；不得將 grouped DDL／DML 檔各自執行而破壞順序。初始 §7.1–7.2 保留為 version 1 的不可變定義。

~~~sql
CREATE TABLE features (
 id TEXT PRIMARY KEY NOT NULL,
 requirement_id TEXT NOT NULL REFERENCES requirements(id),
 feature_key TEXT NOT NULL CHECK(length(feature_key)>0),
 stage TEXT NOT NULL CHECK(stage IN ('GHERKIN','SD','TESTS','IMPLEMENTATION','VERIFICATION','VERIFIED')),
 UNIQUE(requirement_id,feature_key), UNIQUE(id,requirement_id)
);
ALTER TABLE documents ADD COLUMN feature_id TEXT REFERENCES features(id);
ALTER TABLE baselines ADD COLUMN feature_id TEXT REFERENCES features(id);
ALTER TABLE runs ADD COLUMN feature_id TEXT REFERENCES features(id);
CREATE TABLE feature_confirmations (
 feature_id TEXT NOT NULL,
 requirement_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('gherkin','sd')),
 version_id TEXT NOT NULL,
 raw_sha256 TEXT NOT NULL,
 confirmed_at TEXT NOT NULL,
 PRIMARY KEY(feature_id,kind),
 FOREIGN KEY(feature_id,requirement_id) REFERENCES features(id,requirement_id),
 FOREIGN KEY(version_id,raw_sha256) REFERENCES document_versions(id,raw_sha256)
);
~~~

~~~sql
INSERT INTO features(id,requirement_id,feature_key,stage)
 SELECT id,id,requirement_key,stage FROM requirements;
UPDATE documents SET feature_id=requirement_id WHERE purpose IN ('requirement','target_ci');
UPDATE baselines SET feature_id=requirement_id;
UPDATE runs SET feature_id=requirement_id WHERE origin='target_ci';
INSERT INTO feature_confirmations SELECT requirement_id,requirement_id,kind,version_id,raw_sha256,confirmed_at FROM confirmations;
~~~

~~~sql
DROP TABLE confirmations;
ALTER TABLE feature_confirmations RENAME TO confirmations;
DROP INDEX one_requirement_document;
CREATE UNIQUE INDEX one_feature_document ON documents(feature_id,kind) WHERE purpose IN ('requirement','target_ci');
ALTER TABLE requirements DROP COLUMN stage;
~~~

接著對 `documents`、`baselines`、`runs` 各建立 BEFORE INSERT／UPDATE trigger；requirement／target_ci 文件、所有 baseline、target_ci run 必須有非空 `feature_id`，且其 feature 的 `requirement_id` 必須等於該列需求。整合與錄製腳本不強迫綁定 feature。trigger SQL 由上述 owner 產生，deploy 完整 migration 含全部六個 trigger。

Legacy 每項需求原本僅有一組文件與階段，遷移時保留原需求 ID 作為第一份 feature ID，名稱使用原 requirement_key；新 feature 使用獨立 UUID。所有舊確認的 version/hash、文件 head、baseline、run 保持原值，只補上歸屬。`requirements.stage` 在 backfill 後移除，`features.stage` 是唯一 owner。既有資料若不符合新 UNIQUE／FK，交易失敗並回復，不丟棄資料。

### 7.7 獨立需求與跨專案 migration（schema version 4／5）

可執行 DDL／DML owner 是 `src/adapters/sqlite/requirements.ts` 的 `0004_requirement_projects`。新需求不需要先有專案；既有需求 ID、文件版本、確認與所有執行證據保留。原單一專案關係轉入 `requirement_projects`，不同舊需求即使編號相同也不自行合併或改號；新建需求檢查編號重複。

核心 DDL 與資料移轉契約：

~~~sql
CREATE TABLE requirement_projects (
 requirement_id TEXT NOT NULL REFERENCES requirements(id),
 project_id TEXT NOT NULL REFERENCES projects(id),
 PRIMARY KEY(requirement_id,project_id)
);
CREATE TABLE requirements_new (
 id TEXT PRIMARY KEY NOT NULL,
 requirement_key TEXT NOT NULL CHECK(length(trim(requirement_key))>0)
);
INSERT INTO requirement_projects SELECT id,project_id FROM requirements;
INSERT INTO requirements_new SELECT id,requirement_key FROM requirements;
~~~

同一 migration 重建 documents 與 runs：需求的 gherkin／sd／target_ci 文件由 requirement／feature 擁有，project_id 為 NULL；整合測試仍須有 project_id。既有專案錄製可以保留 project_id；全域錄製由 migration 0007 允許 project_id 為 NULL。run 的 project_id 表示當次明確選定的網站操作專案，所有涉及專案版本在不可變 environment snapshot 的 projects 陣列，不把該欄再當需求 owner。原先 `(requirement_id, project_id)` 的單一專案 FK 移除，以直接 requirement FK、feature 歸屬 trigger 與 use case 的關聯檢核取代。

依 [SQLite 官方表格重建程序](https://www.sqlite.org/lang_altertable.html)，先在 transaction 外暫停 FK enforcement，再於單一 transaction 建新表、完整複製、交換表格並重建索引／trigger。提交前執行 foreign_key_check，任何非零違例透過 CHECK 使 migration 失敗並 rollback；finally 恢復 FK enforcement。這是 SQLite 重建表格所需程序，不能省略最後約束檢核。部署 bundle 產生同一組 migration DDL／DML 與可執行 SQL，既有 DB 升級仍須指定新的備份路徑。

`0005_project_git_snapshots` 將 Git 收據的主鍵改為 `(spec_version_id, project_id)`，同一 BDD 版本可分別保存到不同關聯專案。既有收據依獨立文件專案或 repository_url 與已註冊 workspace_ref 的唯一精確對應回填，不依目前需求關聯推測歷史歸屬；無法唯一確認則拒絕升級。CI 必須指定執行專案並使用該專案收據，完整專案版本向量隨執行環境與 execution-context 保存。`src/domain/project-sources.ts` 是來源基線格式的唯一讀取與驗證 owner；舊版單專案基線只在仍有唯一關聯時解析，不改寫原始 JSON／hash。

### 7.8 全域瀏覽器錄製 migration（schema version 7）

Canonical migration owner 為 `src/adapters/sqlite/requirements.ts` 的 `0007_global_browser_recordings`，由 `migrations.ts` 註冊，fromVersion 6、toVersion 7。沿用既有 `documents`、`document_versions`、`document_heads` 與 `recording_actions`；不新增平行錄製表。migration 只重建 `documents` 的 purpose／project 關係 CHECK，保留所有既有文件、版本、動作、索引及 feature triggers；不更新舊列、不補造專案或名稱。

新 CHECK 規則：requirement 與 target_ci 文件的 project_id 必須為 NULL；integration 文件必須有 project_id；recording 文件可有或沒有 project_id。全域錄製以 `project_id IS NULL` 查詢，名稱保存於 `file_name`，原始網址保存於該版本的 `execution_config_json.targetUrl`，錄製動作繼續使用既有 `recording_actions`。重建沿用 §7.7 的 transaction、foreign_key_check 與 FK enforcement 恢復程序。Deploy bundle 由 migration registry 同步輸出 version 7 DDL／DML／完整 SQL；既有資料庫升級前依 §7.5 指定新備份路徑。

全域錄製 replay 直接在目前 BrowserSession 中依保存的 actions 操作 Playwright page；不插入 `runs`，不產生測試通過或執行報告。既有帶 project_id 的錄製腳本仍可經 `/scripts/{id}/versions/{v}/replay` 執行成獨立 run。敏感欄位只保存秘密別名；缺少可解析的秘密參照時拒絕 replay，不以空值或成功狀態替代。

### 7.9 LLM CLI／Skill／Agent 設定 migration（schema version 10）

Canonical migration `0010_llm_agent_settings` 從 schema version 9 升至 10，新增 `application_seed_history`、`llm_cli_commands`、`llm_skills` 與 `llm_agents`。CLI 指令保存顯示名稱、執行檔及 JSON argv；Skill 保存名稱與指示文字；Agent 以外鍵選一個 CLI、一個可選 Skill，並保存預設 Prompt。仍被 Agent 使用的 CLI／Skill 不可刪除。這些設定不包含 API key 或其他秘密。

`src/adapters/sqlite/seed.sql` 是 CLI、Agent Prompt、Skill marker 及四階段指派的唯一資料模板。`renderApplicationSeedSql` 從應用程式 root 讀取 `skills/playwright-bdd/SKILL.md` 完整 UTF-8 內容並 SQL-escape；Codex argv 由 `seed.ts` 的單一預設值渲染。首次啟動加入 Codex (`codex --sandbox workspace-write --ask-for-approval on-request --no-alt-screen --no-daemon`)、Kiro (`kiro-cli chat`)、Playwright BDD Skill，以及四個 Codex Agent；每個 Agent 使用該 Skill，並指派到對應可編輯階段。

worker 先依 `llm-agent-settings-v1` 套用完整 seed，再依 `llm-workflow-agent-defaults-v2` 套用一次性相容升級。v2 只補入缺少的 Skill／Agent／指派；若既有階段已有使用者指派，預設 Agent 加在後面而不取代。只在 Codex argv 仍等於舊版 seed 預設 `["--sandbox","read-only"]` 時才更新到目前預設；只在舊需求確認 Agent 的 Prompt 與 Skill 內容仍等於已知舊 seed 值時才換用官方 Skill。其他使用者自訂值保留。每個 key 都在獨立 transaction 內執行並記錄；失敗會 rollback 並阻止資料庫啟動。升級成功後的一般重啟不會重播，因此使用者刪除的預設資料不會重建。`npm run build` 將 SQL template 複製至 dist worker 目錄；`npm run deploy` 以相同 renderer 輸出 deploy/seed.sql 與 deploy/seed-upgrade.sql，並在 manifest 綁定 renderer、SQL template 與 SKILL.md 的 hash。

### 7.10 流程 Agent 指派 migration（schema version 11）

Canonical migration `0011_workflow_agent_assignments` 從 version 10 升至 11。唯一階段清單由 `src/domain/workflow-agent-stages.ts` 定義，僅包含可編輯的 `GHERKIN`、`SD`、`TESTS`、`IMPLEMENTATION`；migration 從該清單產生資料庫 CHECK 值，API 回傳相同階段標籤，UI 不再維護第二份可指派階段清單。`VERIFICATION` 與 `VERIFIED` 不可指派 Agent。已升到 schema version 11 但只套用舊預設的資料庫，透過 §7.9 的 v2 application seed 升級補齊階段指派；不新增或改寫 schema migration。

```sql
CREATE TABLE workflow_agent_assignments (
 stage TEXT NOT NULL CHECK(stage IN ('GHERKIN','SD','TESTS','IMPLEMENTATION')),
 agent_id TEXT NOT NULL REFERENCES llm_agents(id) ON DELETE CASCADE,
 position INTEGER NOT NULL CHECK(position>=0),
 PRIMARY KEY(stage,agent_id),
 UNIQUE(stage,position)
);
CREATE INDEX workflow_agent_assignments_by_agent ON workflow_agent_assignments(agent_id,stage);
INSERT INTO workflow_agent_assignments(stage,agent_id,position)
SELECT 'GHERKIN',id,0 FROM llm_agents WHERE name='需求確認 Agent';
```

同一 Agent 可指派多階段，同一階段可多選 Agent；`position` 保存按鈕順序。遷移時若已存在首輪預設「需求確認 Agent」，只回填 GHERKIN，保留既有資料庫的遷移行為。全新 DB 的首次 app seed 在建立預設 Agent 後，分別指派需求確認 Agent→GHERKIN、系統設計 Agent→SD、測試情境 Agent→TESTS、程式開發 Agent→IMPLEMENTATION。刪除 Agent 由外鍵 cascade 清除關聯；CLI／Skill 仍受被 Agent 參照時拒絕刪除。流程設定 PUT 驗證四個階段都明確提供、ID 無重複且 Agent 存在，整份指派在單一 SQLite transaction 中取代。Deploy 依 migration registry 輸出 0011 DDL、DML 與完整 migration SQL；不得手動維護第二份部署 schema。



## 8. 核心 API、事件與可觀察結果

`GET /requirements` 列出全域需求及關聯工作區／各 Gherkin 階段；首頁 `POST /requirements` 必須提供非空 `projectIds`，建立需求時即關聯一個以上工作區；`PUT /requirements/{id}` 一併更新需求名稱及工作區關聯。`PUT /requirements/{id}/projects` 原子保存關聯及下游失效。`GET /requirements/{id}` 讀取所選 Gherkin 文件與全部相關工作區。舊 project-scoped listing 僅按關聯過濾，同一需求不建立多份。UI 的 HTML navigation 與 JSON API 透過 Accept 與 Vary: Accept 區分，重新載入需求路徑不回傳 JSON 畫面。需求事件訂閱 `/events?requirementId=…`，不可因目前選擇其他工作區而遺漏同一需求的 CLI／run 事件。

source read/write、terminal 與 Git 匯出均明確指定關聯 projectId；pin-source 的 projects 必須完整且每個 projectId 只出現一次。verify 固定相同完整向量並明確指定網站操作 projectId，報告保留全部來源版本。

以下為設計契約，不是已運作的 endpoints：

| API／通道 | 輸入 → 結果 |
|---|---|
| GET／POST /projects | 共用專案清單／建立專案；不是權限矩陣 |
| GET／POST /projects/{p}/requirements | requirementKey、features 清單與各自 stage；同專案需求關聯 |
| POST /requirements/{r}/features | featureKey → 新 Gherkin 及專屬 `.sd.md`、`.feature.spec.ts`，起始 GHERKIN |
| GET /requirements/{r}?featureId={f} | 父需求、features 與選取 feature 的文件／確認／stage／baseline |
| POST /documents/{id}/versions | rawText、purpose、sourceVersion、明確 manifest → version/hash，或 422 定位錯誤 |
| GET /documents/{id}/versions/{v} | 完整 raw、hash、來源版本及用途 |
| GET /documents/{id}/versions/{v}/structure | 需求／Scenario／steps／Examples 或 tests／mappings；版本固定 |
| POST /requirements/{r}/confirm-gherkin | versionId/hash → 確認並進入 SD |
| POST /requirements/{r}/confirm-sd | versionId/hash → 確認 SD、進入 TESTS 並自動保存 SKELETON；UI 開啟測試情境頁 |
| POST /requirements/{r}/return | artifact kind → 所屬階段與下游失效 |
| POST /requirements/{r}/restart-stage | featureId、已完成 workflow stage → 回到該階段；該階段與下游狀態未確認，依依賴標記基線／run 失效但保留歷程 |
| POST /requirements/{r}/generate-tests | 自動 codegen 失敗時可重試；由已確認 Gherkin 衍生精確 pending slots，保存 SKELETON version/hash 與 manifest；不載入補齊實作 |
| POST /requirements/{r}/complete-tests | 讀取專案 `skills/playwright-bdd/SKILL.md`、驗證固定 SHA-256 並複製至本次 CLI 暫存工作目錄；CLI 讀取 skeletonVersionId/hash、確認文件與 context，另存 COMPLETION_DRAFT／COMPLETED version/hash、sourceSkeleton 與 questions |
| GET /requirements/{r}/scenario-tests | 固定 gherkinVersionId 與 skeleton snapshot 或 testBaselineId → Scenario／Examples、全部 test IDs、readiness；可附指定 run 結果 |
| POST /requirements/{r}/start-development | 使用者點「確認測試步驟」後驗證完成版本並固定測試基線 → IMPLEMENTATION；骨架／待補稿不可前進 |
| GET /llm-settings | CLI、Skill 與 Agent 設定清單；Agent 包含關聯設定 |
| POST／PUT／DELETE /llm-settings/cli-commands[/{id}] | 執行檔與 argv 字串陣列的建立、更新、刪除；被 Agent 使用時拒絕刪除 |
| POST／PUT／DELETE /llm-settings/skills[/{id}] | Skill 指示文字的建立、更新、刪除；被 Agent 使用時拒絕刪除 |
| POST／PUT／DELETE /llm-settings/agents[/{id}] | Agent 名稱、CLI、可選 Skill 與預設 Prompt 的建立、更新、刪除 |
| GET /workflow-settings | 可指派階段清單、Agent 設定及每階段 Agent ID 順序 |
| PUT /workflow-settings | 完整階段至 Agent ID 陣列；驗證所有階段、重複 ID、Agent 存在性並交易式保存；不允許 VERIFICATION 指派 |
| POST /requirements/{r}/agent-sessions | stage、featureId、關聯 projectId、已指派 agentId → 依 Prompt／Skill／目前 Gherkin 啟動真實 PTY；僅允許 GHERKIN、IMPLEMENTATION，並檢查 Gherkin hash 或開發所需的確認版本 |
| POST /requirements/{r}/generate-sd | 已指派 SD agentId、目前 Gherkin hash/context → 將設定的 CLI／Prompt／Skill 開在 web terminal；只經 SD 格式及來源檢查後保存 |
| POST /requirements/{r}/complete-tests | 已指派 TESTS agentId、骨架版本/hash/context → 將設定的 CLI／Prompt／Skill 開在 web terminal；保留來源映射、BDD、typecheck/discovery 驗證 |
| POST /requirements/{r}/verify | testBaselineId/hash、sourceRef、selection.mode 與 sourceCaseIds → runId、scope、完整 expectedTestDefinitionIds；只接受可驗證固定版本 |
| GET /runs/{id}/viewer-binding | runId → 當前 testDefinitionId／caseResultId、sessionId、contextRef、pageId、bindingSeq；尚無頁面則明確未綁定 |
| POST /repository-snapshots | repo／branch／commit／path → target spec 逐字副本；不寫 Git |
| GET／POST /db-connections/{id}/schema、query | 真實 schema／SQL 與參數 → 真實資料／錯誤 |
| POST /terminals、WS /terminals/{id} | workspace、input／resize／close ↔ 實際 output／exit |
| POST /browser-sessions、WS /browser-sessions/{id} | 全域或專案 context／page、畫格、pointer／keyboard／navigation／語意操作；全域錄製不傳 projectId |
| POST /browser-sessions/{id}/recordings/start、stop | recordingId／開始邊界 → 停止邊界與可檢查 TS 草稿 |
| POST /browser-sessions/{id}/recordings/replay | sessionId、結構化 actions → 在目前 managed page 實際重播；錯誤回傳失敗，不建 run |
| POST /recordings、GET /browser-recordings、GET /recordings/{id}/versions/{v} | name、原文／動作／網址 → SQLite 文件版本保存、全域列表與讀回；全域建立不帶 projectId |
| POST /scripts/{id}/versions/{v}/replay | 固定 DB 腳本版本／目標 → 實際 run；保存成功不是通過 |
| GET /runs/{id}/report、/screenshots/{id} | 真實測試、來源映射、逐步結果、圖片及錯誤 |

流程操作（確認、退回、生成、補齊、開始開發、pin、驗證、Git／CI）body 帶 `featureId`；scenario-tests、source、export 查詢帶相同 query。只有一份 Gherkin 時可省略，多份未選取回 `FEATURE_REQUIRED`，其他需求的 feature 回 404。document ID 本身決定歸屬；來源 Gherkin／spec／baseline／run 跨 feature 引用拒絕。下游失效僅影響該 feature。需求頁以 selector 顯示每份名稱與階段。

LLM 設定頁透過 `/llm-settings` 與 CRUD API 管理 CLI、Skill、Agent；流程設定頁透過 `/workflow-settings` 將 Agent 多選指派到四個可編輯階段。server 端每次啟動或提案都核對目前階段與指派關係，需求確認另核對已保存 Gherkin version/hash；程式開發另核對 Gherkin/SD 確認與 COMPLETED spec。PTY 直接以 Agent 設定的 executable 與 argv 啟動，不經 shell。SD 與測試補齊在獨立 proposal 工作目錄提供目前文件與 prompt，CLI 寫出 proposal.json 和 proposal.ready 後仍需既有完整驗證才保存。CLI 錯誤、退出或提案不完整時回報失敗；設定、提案保存或測試補齊本身都不等於需求確認或產品驗收通過。

事件封套為 { eventId, projectId, requirementId?, featureId?, documentVersionId?, runId?, testDefinitionId?, sourceCaseId?, sessionId?, contextRef?, pageId?, bindingSeq?, testKey?, scenarioId?, stepId?, actionIndex?, type, payload }。事件僅供 UI 與程序交換狀態，不做 audit 功能：
document.saved／rejected、workflow.stageChanged、artifact.invalidated、test.skeletonGenerated／completionSaved／needsInput、run.testStarted／browserBound、browser.frame／pageChanged、recording.started／stopped／saved、terminal.output／exited、db.executed、run.stepFinished／completed。

進度回應及報告區別 parser、mapping、typecheck、discovery、execution 各自的狀態；沒有執行的檢查顯示 NOT_RUN，不以共用「成功」圖示混為同一結果。

### 8.1 從清單點選到執行與結果

1. 清單由所選 Gherkin 版本的 scenarios／source_cases 與指定快照的 mapping 生成，列出 Scenario ID、case_id、全部 test IDs。只有骨架或補齊草稿時顯示「待補齊」，execution=NOT_RUN；不沿用舊版成功色。要求正式執行時回 TESTS_PENDING_COMPLETION，不啟動驗收 run。
2. 完成 CLI Agent 補齊、固定測試基線及程式版本後，使用者點案例 a。請求明訂 selection.mode=SELECTED_CASES 及非空 sourceCaseIds；ALL_REQUIRED 另用明確 mode，不以空選取暗示執行全案。application 依 §7.4 解析 E(r)，保存來源版本／hash、scope、選取 cases／tests 與 runner 設定快照。
3. TestRunner adapter 在固定檔案與設定下 discovery，將每個穩定 testKey annotation 解析為唯一的 runner project／spec path／完整 title。以 Playwright 公開 --test-list 的完整條目與指定 project 執行；line/column 在此選項被忽略，不能拿它們當精確 test ID。準備 filter 後再 list 核對選取 ID 集合必須等於 E(r)，零個、多個歧義、缺少或多出 ID 均拒絕。不使用模糊 title grep、skip 或 --pass-with-no-tests 代替精確選取。[官方 CLI／Test list](https://playwright.dev/docs/test-cli#test-list)
4. runner 固定所選 project，不透過 project dependencies 順便執行未選案例；必要 fixtures/hooks 屬所選 tests 的前置。每個實際 testStarted 再比對 E(r)，並由 managed fixture 發布該 run/test 的 browser 綁定；不得執行 test-b 來完成選取 a 的請求。這是測試集合控制，不新增使用者權限／忙碌處理。
5. 右側訂閱當前綁定的實際畫格；case_result／step_result／screenshots 與事件皆附同 run、test、case、step、session/context/page 識別。每步 actual/expected 與結果回到清單及報告。未選 b 在本 run 顯示 selected=false、NOT_RUN，不建立 PASSED 結果。
6. 報告以 E(r) 計算本次 run 成敗，另列全案必要集合與未執行數。origin=target_ci 表示測試定義以 target Git 為權威；實際執行器記於 run 快照，工作台的局部執行不冒充 target CI 全套成功。只有 ALL_REQUIRED 且全部必要結果完整通過可使需求 VERIFIED。

## 9. 同會話瀏覽器、親自錄製與重播

### 9.1 即時觀看及使用者輸入

BrowserSession adapter 在工作台服務內建立 managed browser/context；全域錄製不需 projectId 或 workspaceRef，專案測試可沿用專案綁定的 session。agent、程式及測試 runner 的 fixture 依 sessionId/contextRef/pageId 取得同一個被操作會話。browser 可有多個 context，不要求 contexts().length=1。任意外部程式自行 launch 的 browser 不會自動接入；managed fixture／內部 resolver 負責接線，UI 不取得未保護的公開 debug endpoint。

page.screencast.start({ onFrame }) → WS binary JPEG ＋ timestamp／viewportWidth／viewportHeight／pageId → Vue canvas。只保留最新待呈現畫格，避免畫面過時；畫格尺寸可能受既有 trace／video 設定影響。fps 選項只控制 path 影片輸出，不能拿它承諾 onFrame 即時速率。BrowserContext 是會話狀態容器，並非可嵌入畫面；本案不以 iframe 載入任意目標網站、不使用 noVNC。[官方 Screencast](https://playwright.dev/docs/api/class-screencast#screencast-start)

AC-WB-028 的右側 viewer 綁定 activeRunId／currentTestDefinitionId／caseResultId／sessionId／contextRef／pageId／bindingSeq。runner 開始下一 test 或切換 appPage／dbPage 時更新綁定並遞增 seq；只接受與當前完整 tuple 相符的 frame。延遲到達的舊 run/test/page 畫格不覆蓋目前畫面；等待頁面、結束或中斷時顯示真實狀態，不把最後一張靜態圖繼續標成 live。多個所選 tests 可各自建立 context，viewer 追蹤目前實際 test 的 page；不另開相同 URL 模擬測試過程。此綁定資料只支援正確畫面關聯，不新增控制權交接或 audit。

使用者在 viewer 親自點擊、鍵入、捲動及導覽：canvas 事件攜帶 pageId 與實際 viewport 座標，後端呼叫 page.mouse／keyboard／goto；不能把 letterbox 或 CSS 縮放後座標直接當目標座標。分頁／popup 有自己的 pageId，頁面切換後更新串流。全域錄製頁只有網址、前往、錄製／停止錄製、重播、保存控制及實際網頁；不顯示專案選擇、狀態列、分頁列、locator／assertion 編輯器或腳本編輯器。工作台 DB 頁不遞迴嵌入自己的 viewer。

### 9.2 開始／停止及可檢查草稿

1. 左側「瀏覽器錄製」開啟全域頁面；人類輸入網址並按「前往」時建立 managed browser session。人類按「錄製」取得 recordingId；設定動作序列起點及目前 URL／page。開始前動作不回填。
2. viewer 真實輸入由 BrowserSession 執行；錄製器以已送出的動作序號、完成結果及 DOM 事件資訊建立 action 草稿。透過 context.addInitScript 與 exposeBinding 在新頁／新 frame 觀察 click／input／change 的目標、值及所在 frame，既有頁另安裝一次；此橋接只傳錄製動作資料，不是任意 shell／Node RPC。[addInitScript](https://playwright.dev/docs/api/class-browsercontext#browser-context-add-init-script)、[exposeBinding](https://playwright.dev/docs/api/class-browsercontext#browser-context-expose-binding)
3. DOM recorder 依 data-testid、label 或可重現 CSS 產 locator recipe 並收錄 click／fill／selectOption／press；UI 不提供手動 locator 或 assertion 編輯器。敏感欄位只保存秘密別名，不保存輸入的秘密值。
4. 再按「錄製」由服務固定最後接受的動作序號，收完該序號之前的事件後回覆 stopped；停止後新操作不加入此次草稿。停止語意錄製不等於停止 viewer 的畫面串流。中斷時不建立可冒充完整的保存內容。
5. 以 navigate／click／fill／selectOption／明確 assertion 等自有 action model 產生可檢查 Playwright TS；導航、定位器與斷言保留頁面／frame 歸屬。只觀察到事件不能自動得知使用者想驗證什麼，斷言須明確指定。

這是網頁內自建錄製器。官方 playwright codegen 會開啟 browser 及 Inspector，屬桌面開發流程；它不是此 Vue 網頁可直接嵌入的 recorder SDK。Screencast 只提供畫格；Trace Viewer 是事後證據瀏覽，兩者均不取代語意錄製。[官方 codegen](https://playwright.dev/docs/codegen)、[Trace Viewer](https://playwright.dev/docs/trace-viewer)

基本導航、點擊、輸入、選擇與斷言是初版核心。瀏覽器 chrome、OS 檔案／權限對話框、canvas 內部語意、封閉 shadow DOM、拖放、下載／上傳及複雜跨 frame 操作不保證自動取得穩定 locator；保留明確待補項與原動作，不發明定位器或空斷言。跨站 frame 以 Playwright frame locator 及 frame 歸屬處理，不能用頂層頁面 DOM 假裝已讀取全部 frame。這些是錄製可靠性的界線，不是額外批准或停用產品功能。

### 9.3 獨立另存與實際重播

停止後按「保存」，輸入名稱並存入 SQLite `documents` purpose=recording；全域錄製的 `project_id` 為 NULL。完整 TS 原文、版本/hash、action 序列及目標網址存在既有文件版本；保存名稱列在左側「瀏覽器錄製」下。保存不碰 target Git／CI 清單，也不改 feature。

重播前由人類按「前往」建立／導覽目前 managed session，再按「重播」。服務依保存的 actions 在該 session 的 page／frame 真正執行導航、locator 操作與明確斷言；遇到不支援動作、未提供秘密參照或 assertion 失敗時回報錯誤並停止，不冒充成功。此全域重播不建立 run、測試報告或 workflow 結果；專案整合測試及既有專案腳本仍走各自 runner。保存本身不代表重播通過。

## 10. Workspace、PTY 與執行生命週期

Workspace adapter 綁定使用者選取的本機程式碼目錄；專案 terminal 的 cwd 等於該目錄，proposal CLI 的 cwd 則是該次隔離 proposal 目錄。由左側選取工作區時直接開啟右側 terminal 頁籤，terminal 畫面只呈現 xterm；關閉該頁籤即呼叫 DELETE `/terminals/{id}` 並終止 PTY。xterm.js ↔ WS ↔ node-pty 傳送真實輸入／resize／output／exit，不用靜態文字模擬。PTY 程序繼承服務帳號權限；node-pty 與 cwd 均不構成作業系統沙箱。[node-pty 官方說明](https://github.com/microsoft/node-pty)

BrowserSession 與 PTY 分別有 created／running／closed 或 exited 狀態。關閉全域瀏覽器頁籤時 DELETE 該頁所持有的 browser session，停止 screencast 並關閉 context／pages；未保存的動作不轉成成功結果。PTY 頁籤則終止其程序。正在執行的 run 保留中斷／INCOMPLETE，不能變成成功。[BrowserContext.close](https://playwright.dev/docs/api/class-browsercontext#browser-context-close)

全域重播使用人類目前已前往的 managed browser session；保存內容的第一個 navigate action 決定重播起始頁，不能假設新 session 帶有其他 session 的 cookie 或臨時頁面。人類錄製與 agent／程式觀看各自明確指定使用的 session；本次不新增控制權租約、忙碌排隊 UI、交接或閒置配額。環境不支援所需能力時回報真實不可用，不修改瀏覽器 sandbox 設定。

### 10.1 網頁 terminal 控制 LLM CLI

GenerateSD／CompleteTests 先由目前 feature 與 stage 取得資料庫中已指派的 Agent，固定該 feature 的來源版本、hash、head 與 context，再將 `task.md`、`request.json` 寫入獨立工作目錄。`PtyTerminalAdapter.create(command)` 使用設定的 executable、argv 及最後一個 prompt 引數，在 proposal 工作目錄啟動 CLI；不經 shell，也不假設 Codex 專屬旗標。`llm.terminalOpened` 含 projectId／requirementId／featureId／terminalId 與工作目錄，需求頁自動把同一 PTY 接到 xterm，輸入、resize、中止均走既有 WebSocket。

CLI 讀取任務並寫 `proposal.json`；工作台只接受該次目錄內非 symlink 的普通 JSON 檔（2 MiB 上限），再套用共同提案、SD 格式、來源 ID／hash、保留斷言與完成檢查。第一份提案成為不可變版本；CLI 保持可操作，後續手動修改不自動改寫已保存版本。JSON 錯誤、CLI 結束／取消、過時來源或檢查失敗均不得保存為完成。沒有固定背景逾時強制終止使用者的互動會話；使用者可由 terminal 關閉結束等待。原本 HTTP provider、API key／endpoint 設定與靜默 fallback 全部移除。

需求確認與程式開發的 Agent CLI 是直接 PTY 流程，不透過 proposal 或背景 LLM API。使用者在 SQLite 管理 CLI executable／argv、Skill 指示、Agent 的 CLI／Skill 關聯及 Prompt，另在流程設定為可編輯階段多選 Agent。啟動時將 Agent Prompt、Skill 與該階段必要文件組成最後一個 CLI prompt；需求確認核對已保存 Gherkin version/hash，程式開發核對 Gherkin／SD 確認、完成測試步驟及關聯工作區。server 端拒絕未指派 Agent、非目前可編輯階段及不完整文件。CLI argv 不經 shell 展開。

## 11. codegen 與 BDD 補齊設計

### 11.1 先保存 codegen 骨架

輸入為確認的 Gherkin／SD version/hash、generator／adapter 版本及 Gherkin parser 展開的實際步驟文字。若未提供已註冊 step pattern，codegen 以每個實際步驟文字建立 anchor-escaped exact-match pattern 與 pending slot，不推導操作、斷言或業務值。輸出為 SKELETON spec.ts、穩定 test IDs、來源 manifest 及待補狀態。本版來源 Gherkin 有 35 個 Scenario ID／55 個展開案例；實際生成數與 mapping 必須在目前 Gherkin／SD 確認後重新生成並核對，不以舊快照數量代替。

骨架只含測試結構、Given/When/Then 分派或明確 completion slots、來源案例／step 對應；不含實際 locator、操作、業務斷言、DB fixture、重登入或截圖實作。為讓 bddgen 註冊 pattern 而存在的 stub 一旦執行必須拋 UnimplementedStepError；生成／list／型別檢查可成功，completionStatus 仍 PENDING，不能標成完整可執行驗收測試或 PASSED。

skeleton manifest 綁定 skeletonVersionId／raw hash、Gherkin／SD version/hash、generator 版本、testKey／sourceCase／step／slot IDs 及 manifest hash；codegen 的輸入 hash 不混入後階段的 world／操作／DB／截圖實作。保存後版本不可變，重新 codegen 建立另一快照，不直接覆寫既有殼或已補齊版本。顯式提供的 pattern 若未註冊或歧義即阻擋生成；Gherkin 衍生 exact-match pending slots 不含執行實作。spec.ts 只在收合的唯讀區塊顯示。[bddgen 缺 step 選項](https://github.com/vitalets/playwright-bdd/blob/v9.2.1/docs/configuration/options.md)

### 11.2 再由互動 CLI Agent 另存補齊版本

CompleteTests 明確指定 sourceSkeletonVersionId/hash 及其確認文件。專案版本控制 `skills/playwright-bdd/SKILL.md` 作為官方 `vitalets/playwright-bdd` 指引；每次執行前驗證固定 SHA-256，並以唯讀指引複製至獨立 CLI 暫存目錄；不安裝、不執行 skill 內容。互動 CLI 產出另一份 COMPLETION_DRAFT／COMPLETED spec 快照或其 implementation modules，包含真正操作／locator／斷言／fixtures／DB UI 驗證／逐步截圖與報告接線；不得改寫骨架快照、批准文件、原 testKey／來源案例，或以刪測試補齊。可新增唯一 testKey 補同一來源 case，維持多對一及完整映射。

補齊 manifest 保留來源 skeleton version/raw hash/manifest hash、確認文件版本、完整 test／step 映射及實作檔 hash。語法及明確映射有效的待補稿可保存為 COMPLETION_DRAFT；未解決 slot 或 questions 仍顯示待補齊。型別、discovery、所有必要操作與真實斷言及證據實作檢查完成後標 COMPLETED；UI 顯示「確認測試步驟」，使用者點選後呼叫 start-development，固定 baseline 並自動開啟程式開發頁。沒有產品時不要求先得到 E2E 綠燈；runtime 結果仍 NOT_RUN。

AC005 的完整與缺預期資訊分支使用獨立輸入：缺資訊分支必須在 Gherkin／SD／context 全部找不到所需預期值，互動 CLI proposal adapter 回傳 questions／needs_input 並保留待補狀態。不得一面提供可用的 expected 值，一面無條件要求 needs_input。這是補齊階段的測試資料問題，不阻擋 codegen。SD／測試補齊只接受互動 CLI 寫出的 proposal，通過來源、格式與完整性檢查後另存版本；沒有 HTTP LLM provider、API key／endpoint 或靜默 fallback。模型文字不作執行或成功證據。

### 11.3 本專案的檔案與產物

Git 保存版本歷程；目前功能目錄只保留同名 Gherkin、SD、steps、生成 spec 及 testing/。不另建 skeleton／generated 歷程目錄。原生生成的 JavaScript 中間檔與案例 manifest 寫入 test-results/bdd/；生成 spec 可重新產生，操作與斷言由 steps 及其相依模組維護。產品內的不可變文件快照仍由 SQLite 的版本模型管理。

證據鏈為：需求／Scenario ID → 確認 Gherkin/SD version/hash → codegen skeleton version/hash/slots → completion version/hash／明確映射 → 固定完成 baseline＋程式版本 → run scope／所選 cases／完整 E(r) → 實際 test → session/context/page／source step/action → actual/expected／截圖／結果。LLM 提案與生成殼都不能取代執行證據。

## 12. DB UI、人類流程測試及報告

### 12.0 DbGate 連線與部署

Metadata migration `0003_dbgate_connection` 在同一交易增加 `target_connections.dbgate_url` 與 `dbgate_connection_name`；不建立 seed DML，原連線資料保留。SQL 為：

~~~sql
ALTER TABLE target_connections ADD COLUMN dbgate_url TEXT;
ALTER TABLE target_connections ADD COLUMN dbgate_connection_name TEXT;
~~~

每個連線記錄實際 DbGate URL 與顯示名稱。`POST /db-connections/{id}/browser` 開啟該入口的 managed browser；需求頁／資料庫頁可觀看及操作。run 的 DB page 使用所綁連線的 DbGate；失敗不得轉用其他頁冒充成功。Basic Auth 從受信任 server 設定注入 browser context，限制到所設定 origin，API 及報告只提供非秘密 URL／名稱／頁面識別。

專用 fixture 由 `tools/dbgate.mjs` 啟動 Docker，隨機 loopback port、隨機帳密、固定 SQLite 連線及測試 DB mount。`tools/dbgate.Dockerfile` 固定上游 7.3.2 manifest digest，重新編譯其 better-sqlite3 native module 並以真實 `:memory:` SQL probe 確認後產出 image；因實際 ARM image 內含 x86-64 addon，不能把該載入錯誤忽略。應用不使用自創資料表畫面取代 DbGate 驗收。Docker 服務生命週期由 fixture server 擁有，結束時停止 container；正式環境可指定既有 DbGate。

AC-WB-029：指定 SQL 與預期欄位值 → 在 DbGate 編輯器執行 → 從結果表格讀取實際值並斷言 → 保存查詢及結果畫面 → 報告連結同 run／Scenario／case／step／commit 的 SQL、expected、actual、截圖與錯誤。查詢失敗、連線失敗、資料不符及截圖遺失都不能當作通過。

### 12.1 被測 DB 操作與 fixture

Web DB adapter 查實際 sqlite_schema／欄位與資料，prepare/bind 值；識別字從實際 schema 取得並正確 quote。SQL 編輯器執行本次 SD 的 DDL／DML，操作完再 query／刷新實際結果，不把 toast 當資料斷言。metadata 與被測 DB 分開，AC-WB-017～020 的角色 A/B 屬被測網站，不是工作台角色管理。

以下僅為該驗收情境的示例 fixture，實作測試時對應真實 target schema；本次未執行：

~~~sql
CREATE TABLE test_accounts (
  username TEXT PRIMARY KEY NOT NULL,
  role_code TEXT NOT NULL,
  state TEXT NOT NULL
);
CREATE TABLE test_documents (
  document_key TEXT PRIMARY KEY NOT NULL,
  content TEXT NOT NULL
);
INSERT INTO test_accounts(username, role_code, state)
VALUES ('scenario_user','A','active')
ON CONFLICT(username) DO UPDATE SET role_code='A', state='active';
INSERT INTO test_documents(document_key, content)
VALUES ('scenario_document','initial')
ON CONFLICT(document_key) DO UPDATE SET content='initial';
UPDATE test_accounts SET role_code=:role_b WHERE username=:username;
SELECT role_code, state FROM test_accounts WHERE username=:username;
SELECT content FROM test_documents WHERE document_key=:document_key;
~~~

role A 只能讀文件，B 能改文件但不能管理帳號。這兩條真實 app 規則在固定 fixture／step 中明訂，不能只改 DB role 就宣稱登入權限有效。

### 12.2 每步實際操作與截圖

| AC／時點 | Playwright 操作與斷言 |
|---|---|
| 017 | dbPage 開 DbGate，查 scenario_user，斷言 role=A/state=active；每個操作及斷言保存圖 |
| 018 DB 變更 | 從 DbGate 改 A→B、保存、重新查回並斷言 B；保存後與重查後留圖 |
| 018 登入 | appPage 登出舊登入，再以同帳號登入；斷言 B 編輯入口，留登出／登入／登入後圖 |
| 018 允許／拒絕 | 改文件 edited 並斷言成功，再從 DbGate 查回 edited；開管理帳號頁斷言拒絕且帳號資料未改 |
| 019 | 網頁或 DB assertion 不符時先保存失敗當下頁面與 expected／actual／source step，再保留原錯誤 |
| 020 | 每次重跑先從 DbGate 還原帳號 A／active、文件 initial，結束舊登入，查回初始狀態並截圖才重跑 |

拒絕管理帳號操作的資料比較基準是「已改 B、拒絕操作之前」，不誤拿原先 A 值當未變更基準。fixture 初始化計畫與測試 baseline 綁定；驗證只執行該計畫。不能用 Node 直接 SQL 取代 feature 要求的 DB UI 流程。

driver 對每個操作／assertion 記 runId、testDefinitionId、sourceCaseId、actionIndex、sourceStepId、sessionId/contextRef/pageId/bindingSeq，於步驟完成後 page.screenshot()，以 testInfo.attach 附加並存 artifact/hash；前置圖標 precondition，失敗圖標 failure。截圖失敗不吞掉 assertion 錯誤，圖片成功也不使測試成功。[Screenshot API](https://playwright.dev/docs/api/class-page#page-screenshot)、[testInfo.attach](https://playwright.dev/docs/api/class-testinfo#test-info-attach)

### 12.3 報告及不可假綠燈

報告列 runId、execution_scope、所選 source cases、E(r)、實際執行 tests、全案必要數及未選未執行數；並列來源種類、需求／Scenario／Examples、各 test ID、骨架／完成版本與基線/hash、target commit／實際 tested commit 或 DB scriptVersion、環境與初始計畫、每步 expected/actual、session/context/page、截圖與錯誤。同一案例的全部映射 tests 都列出。未選 b 不產成功結果，不挪用其他 run 的成功。錄製／整合重播與標準 Git 測試分開列示。

單次 run 的 PASSED 需要 E(r) 中全部必要 tests 實際執行、斷言通過、必要逐步／失敗證據完整；某選取 case 的全部映射 tests 都通過才標該 case 通過。SELECTED_CASES 即使 PASSED，coverageComplete 仍為 false，需求不變成 VERIFIED；只有 ALL_REQUIRED 完整通過才能代表全案通過。E(r) 為零、E(r) 內遺漏 test／steps、未實作、無斷言、僅保存文件／截圖、未執行、缺證據、中斷或不同 commit 的舊結果都不能填通過。未選案例不是局部 run 的遺漏，但必須保留全案未完整狀態。失敗為 FAILED，執行或證據不完整為 INCOMPLETE，上游改動後為 INVALID，尚未執行為 NOT_RUN。先保存真實結果再輸出 HTML／JSON，不讓 LLM 的成功文字決定結果。

## 13. 實作順序、驗收覆蓋與待確認事項

順序為確認 Gherkin → 確認此 Gherkin 的 SD → codegen spec 與實作 BDD steps → 固定測試基線 → 產品開發 → 測試 → code review。驗收固定程式版本，檢查 AC028 的清單→選取→runner→右側畫面→同 run 結果鏈。部署生成與 migration 遵守 §7.5；沒有目標環境實際執行證據時不得標為已部署。

| AC | 本 SD 對應 |
|---|---|
| AC-WB-001 | §1 Git 自舉及本次核准基準；§4 階段 |
| AC-WB-002 | §3 共用 Project／Store；§5 文件；§8 API |
| AC-WB-003 | §4 確認 Gherkin→SD；§6 版本/hash；§7 DDL/DML；§10.1 指派 Agent 的 CLI proposal |
| AC-WB-004 | §2、§4、§11.1 確認 SD 後自動產生唯讀收合骨架／pending slots／來源 manifest |
| AC-WB-005 | §4、§11.2 指派測試 Agent、核對官方 Skill、獨立補齊快照及 needs_input |
| AC-WB-006 | §4、§11 完成檢核後確認測試步驟、固定基線並進入程式開發 |
| AC-WB-007 | §7、§12 真實 SQLite schema／SQL／重新讀取 |
| AC-WB-008 | §10 本機工作區 cwd、純 terminal 頁籤及關閉中止 PTY |
| AC-WB-009 | §9.1 managed 同會話及即時畫格 |
| AC-WB-010 | §3.2、§9 全域瀏覽器錄製、保存清單、Playwright 腳本及實際重播 |
| AC-WB-011 | §5 target Git 權威與 commit 原文副本；§7 git_snapshots |
| AC-WB-012 | §5、§7、§8 SQLite 整合測試與 run |
| AC-WB-013 | §11 證據鏈；§12 截圖／真實報告 |
| AC-WB-014 | §11 缺 steps／實作不得通過 |
| AC-WB-015 | §4 各階段產物鎖定與保存拒絕 |
| AC-WB-016 | §4、§7.3 回退／確認失效／下游失效 |
| AC-WB-017 | §12.1～12.2 DB UI 查詢／資料斷言／逐步圖 |
| AC-WB-018 | §12.2 A→B、重新登入、允許／拒絕、資料比對 |
| AC-WB-019 | §12.2～12.3 失敗當下圖及錯誤不改 PASS |
| AC-WB-020 | §12.1～12.2 重跑重建初始資料／登入 |
| AC-WB-021 | §5～§8 Gherkin／spec／SD 原文保存／讀回及需求對應 |
| AC-WB-022 | §9.3 錄製另存／實際重播、與 CI 分開 |
| AC-WB-023 | §6.1、§7.3 parser／行列原因／保留有效版本 |
| AC-WB-024 | §6.2、§7.1 Gherkin 原文／正規化／版本hash |
| AC-WB-025 | §6.2、§7.2 明確 tests／來源映射及多對一 |
| AC-WB-026 | §6.2、§7.2 缺失／重複／不存在引用的拒絕 |
| AC-WB-027 | §5、§7.2、§9.3 無關聯自錄仍可保存與重播 |
| AC-WB-029 | §12.0 真實 DbGate；§12.3 SQL／資料斷言／失敗證據與報告鏈 |
| AC-WB-030 | §3.2 建立需求時選工作區、樹狀清單、原列編輯名稱及工作區多選、滿版多頁籤流程 |
| AC-WB-031 | §3.2、§7.7 同一需求多工作區、本機目錄及首頁工作區管理 |
| AC-WB-032 | §3.2、§7.9 SQLite CLI／Skill／Agent 首次 seed、持久化及不重建已刪資料 |
| AC-WB-033 | §3.2、§7.10 流程多選 Agent、階段入口與未指派拒絕 |
| AC-WB-034 | §3.2、§4、§8 重啟階段矩陣、下游失效及保留歷史 |
| AC-WB-035 | §3.2、§7.9 舊版資料庫一次性補齊四階段 Agent、條件式舊預設更新與自訂值保留 |
| AC-WB-028 | §4 待補／完成分界；§7.4 完整選取集合；§8.1 清單到執行；§9.1 同 run/test/session/page；§12.3 局部與全案結果 |

Gherkin 的 35 個 Scenario ID／55 個展開案例已由使用者核准並記入 `../review.json`。本版 SD hash 已變更，仍待使用者確認；確認前 BDD source gate 會阻止重生 spec。§3.1 開發檔案責任、§7.5 deploy 生成規格、案例與完整 test 集合的選取，以及 §14 測試介面契約均須依本版核對。未確認 SD 不可作為已確認測試基線。產品 E2E 的結果僅由實際執行證據判定。

## 14. 驗收測試契約

### 來源與執行

- `workbench.feature` 是驗收來源，`workbench.sd.md` 是專屬設計來源；確認 hash 存在需求層的 `../review.json`。
- 核准的 `workbench.feature` 展開為 55 個案例。現有 `workbench.feature.spec.ts` 與 `workbench.steps.ts` 仍是前一份已確認來源的產物；目前 SD 確認後才能依新來源更新 step bindings、重生 spec 並核對案例映射。
- `test-results/bdd/manifest.json` 記錄目前來源、生成 spec、實作檔案的 hash 與案例映射；重新生成後，須重新完成工具檢查才能執行 E2E。
- `playwright.config.ts` 載入 `bdd.config.ts`。`npm run test:checks` 檢查測試接線，`npm test` 執行產品驗收；缺必要環境時回傳 exit 2 / NOT_RUN。
- `sut.step()` 綁定來源步驟與執行證據，callback 直接包含操作與斷言。fixture 中的 SKELETON 輸入用於驗證產品的測試生成及未補齊拒絕行為。

### 專用環境與 fixture

必須提供 WB_BASE_URL、WB_TARGET_BASE_URL、WB_METADATA_DB、WB_TARGET_DB、WB_TARGET_PASSWORD、WB_SOURCE_REF、WB_TARGET_REPO、WB_DBGATE_URL。前兩個是真實工作台／被測網站；metadata DB 必須由產品 migration 初始化成 §7 的 schema。DB／target Git 都只能指向 repo 下 .test-fixtures/ 的專用資料，metadata 檔名必須 .e2e.sqlite。target repo 是可丟棄、含可執行 CI 的專用 repo；測試不 push。target DB／網站要先具備 SD §12 test_accounts、test_documents 與 scenario_user 密碼，可用產品的 `init-fixtures` 與 `serve-fixtures` 建立專用環境，見 根目錄 `README.md`。

FixtureDatabase 僅安排隔離的 Given 前置資料。當受測保存／確認／補齊／流程／SQL 操作開始後，使用真實 UI/API；不能直接改 SQLite 假裝產品完成操作。角色 A/B 的變更、重查、重登入、文件保存與拒絕管理頁驗證均由 DB UI／被測網站進行。歷史 FAILED run 只是 AC016 的失效前置資料，不當成本輪執行證據。工具 unit test 在專用暫存 DB 執行 SD DDL，以核對 fixture 的欄位與 FK；它不是產品 migration 或產品 E2E。

每個 scenario 配置獨立 project/requirement ID；驗收案例使用一個 worker，避免共用 scenario_user 的角色與登入互相干擾。多使用者讀取用另一 BrowserContext。測試初始 fixtures 會占用專用 DB，重跑可使用全新 DB fixture；不清除使用者的資料。

DbGate 以固定 digest 的官方 image 為基礎，tools/dbgate.Dockerfile 重新編譯 SQLite native driver 並執行 SELECT 1。deploy 生成同份 Dockerfile，metadata migration 0003 保存專案的入口及 connection name；登入資訊僅存在服務環境，僅傳入相同 origin 的 Playwright context。SQL 查詢、錯誤及資料不符均保存真實 DbGate 畫面，不能以截圖成功判為資料通過。

生成 SD／補齊測試會開啟流程設定選出的 Agent 互動 PTY，透過 llm.terminalOpened 接上頁面 TerminalPane；輸入、resize、中止由同一 terminal session 控制。提案由隔離工作目錄 proposal.json 載入後執行既有來源／格式／映射檢查；CLI 結束而無提案則回報錯誤。互動 CLI 命令及 argv 格式依設定使用的 CLI；本流程不使用 HTTP LLM provider 或 API key。

### HTTP DTO

沿用 SD 路徑。JSON 欄位統一 camelCase，DB 欄位維持 snake_case。

| 呼叫 | 測試綁定 |
|---|---|
| POST documents/{id}/versions | rawText、sourceGherkinVersionId；標準測試加 testStage=COMPLETED、sourceSkeletonVersionId、manifest（specSha256、sourceSkeletonSha256、mappings[]）。成功 versionId；錯誤依 SD 422 diagnostics 或 409 ARTIFACT_LOCKED_IN_STAGE，不能有有效新 head。 |
| POST requirements/{r}/complete-tests | UI 送當前 skeletonVersionId/hash、已確認文件與本專案 context。回傳 status、versionId、questions；完整輸入 status=completed、testStage=COMPLETED；缺資訊 status=needs_input 且 questions 非空。UI 讀取保存後版本的 readiness，不以 HTTP ok 當完成。AC005 缺資訊 project 的 Gherkin、SD、骨架均沒有 expected/denied/saved，也不混入完整 project 的 context。 |
| POST requirements/{r}/verify | testBaselineId/hash、sourceRef、selection:{mode,sourceCaseIds}；回傳 runId、scope、expectedTestKeys[]／expectedTestDefinitionIds。骨架拒絕 409 TESTS_PENDING_COMPLETION，沒有建立 run。ALL_REQUIRED 明確 mode；SELECTED_CASES 非空。 |
| POST db-connections/{id}/query | SQL／params；成功 {columns,rows:[object],...}，UI 同步顯示實際 rows 與 completed。每次按 SQL run 都等待該次 HTTP response，不能沿用前次 completed。 |
| POST browser-sessions | 內部測試呼叫可回 id、sessionId、contextRef、pageId、playwrightEndpoint；endpoint 只在內部授權程序使用，不顯示於 UI。 |
| GET runs/{id}/viewer-binding | {runId,testKey,testDefinitionId,caseResultId,sessionId,contextRef,pageId,bindingSeq}，未綁定時明確表示。 |
| GET runs/{id}/report | {runId,status,scope,sourceRef,gherkinVersionId,testBaselineId,coverageComplete,requiredTestCount,executedTestKeys,unexecutedTestKeys,sourceCases,cases}。sourceCases 含 caseId/selected/status；cases 每個實際 test 一筆，含 runId/testKey/testDefinitionId/scenarioId/caseId/executed/status/steps。 |
| report steps | {runId,testDefinitionId,sourceCaseId,sourceStepId,actionIndex,status,assertion,assertionPassed,expected,actual,sessionId,contextRef,pageId,bindingSeq,screenshots:[{id,sha256,moment}]}。failure 要有 mismatch 與 failure 圖；不能以圖片有保存把 FAILED 改成 PASSED。 |

GET /requirements/{r}/generated-tests/export?versionId=... 以唯讀方式匯出 {specPath,files:[{path,rawText}]}。AC004 將真正的輸出 bundle 寫入專用 fixture 目錄並執行 Playwright --list，不能只看檔名或 TypeScript 語法就宣稱 discovery 成功。

全域錄製 POST /recordings 成功回 id/versionId，GET /browser-recordings 僅列出 project_id 為 NULL 的錄製；start／stop 回 actions。全域 replay 在目前 BrowserSession 操作實際頁面，不回 runId；既有專案綁定腳本由 `/scripts/{id}/versions/{v}/replay` 回 runId 與 scope=INDEPENDENT。Git CI 同時保留 candidate_commit 與 tested_commit；tested commit 可以是實際 merge commit，不能直接要求它等於候選 commit。

### Managed runner 內部接線

這是 SD 的 BrowserSession／TestRunner adapter 接線，沒有新增產品人工關卡。fixture 模組 managed-runner.ts 由 nested spec 的絕對路徑 import；產品匯出 bundle 時保留／提供這個版本及 hash。runner 的 request baseURL 為 WB_BASE_URL，傳入真實 WB_RUN_ID 與目標環境變數。BrowserSession 以官方 Chromium `launch({chromiumSandbox:true})` 建立 browser，再以 [`browser.bind`](https://playwright.dev/docs/next/api/class-browser#browser-bind) 綁定 127.0.0.1 及由 OS 分配的 port；同版本 client 使用 `chromium.connect(endpoint)` 取得既有 context/page。client 斷線後，會話生命週期仍由工作台 owner 管理。

1. GET /internal/runs/{runId}/tests/{testKey}/execution-context 回 runId、testDefinitionId、sourceCaseId、testKey、sourceSteps（來源行號→真實 step ID）、app／db attachment、dbUiUrl。app/db 各含 sessionId/contextRef/pageId/playwrightEndpoint。
2. application-managed context 以 init script 在每頁安裝 `globalThis.__workbenchManaged={sessionId,contextRef,pageId}`，新導覽保持該 page 的識別。這是自有 fixture resolver marker，不是 Playwright 公開 object ID。resolver 遍歷 contexts/pages，必須恰有一個完整 tuple 匹配；不假設第一個或只有一個 context。
3. POST /internal/runs/{runId}/events 接收 SD 的 event envelope。runner capture 先發 run.browserBound，回實際單調遞增 bindingSeq；每次 action/assertion 發 run.stepFinished，附 expected/actual/status 與真實 PNG bytes/base64/hash/moment。接收端依固定 run/test/case/step 及 selection 驗證、存 artifacts；圖片成功不推翻原 assertion 錯誤。run.testStarted／completed 由產品 TestRunner 發送並保存。
4. GET /internal/browser-sessions/{sessionId}/attachment 只供內部驗證程序回 Playwright endpoint；UI 只有 session tuple 與畫格。遠端 browser.close() 解除 client 接線；session/context/page 的銷毀仍由產品生命週期管理。

WS 的 run.testStarted 事件帶 runId/testKey。browser.frame 先送 JSON envelope（完整 binding tuple 及 payload.sha256/viewportWidth/viewportHeight），下一個 binary frame 為真實 JPEG。右側 canvas 的 data-* 保存目前**已呈現**畫格 tuple 與 frameSha256。測試同時驗證 JPEG hash、canvas 解碼像素、current viewer-binding、managed page 及 DB case_result；晚到舊 tuple 不算本次 live 證據。此處是即時串流，沒有用 iframe、Trace Viewer 或另開 URL 冒充。

### UI locator 綁定

固定 data-testid 供測試定位；可調整實際排版，不改 feature 含義。

| 區域 | 主要 test IDs／行為 |
|---|---|
| 固定導覽與頁籤 | requirement-sidebar、sidebar-requirement-{id}、feature-select、sidebar-browser、sidebar-terminal、sidebar-llm-settings、sidebar-workflow-settings、workspace-tabs；sidebar-stage 的 stage-status-icon 顯示完成、目前、未開始狀態。右側開多頁籤後可切換及關閉。 |
| 需求與工作區首頁 | `.requirement-list-entry`、需求列的「展開需求／重新命名」按鈕、`需求名稱 {requirementKey}` input、`選擇需求工作區 {requirementKey}` 多選下拉；工作區列表的 `編輯 {workspaceName}` 編輯名稱與本機目錄。新增需求時選至少一個工作區。 |
| 文件／流程 | workflow-stage-content、gherkin-editor、sd-editor、spec-editor（唯讀骨架摘要且預設收合）、confirm-gherkin、confirm-sd、generate-tests（確定性骨架重試）、confirm-test-steps、restart-workflow-stage、source-editor、run-verification、confirmed-gherkin、confirmed-sd、test-baseline、generated-spec-source/path、generated-manifest、llm-needs-input。流程設定頁以 sidebar-workflow-settings、save-workflow-settings 與階段名稱＋Agent名稱 checkbox 保存多選；各可編輯階段以 start-agent-GHERKIN-{agentId}、generate-sd-{agentId}、complete-tests-{agentId}、start-agent-IMPLEMENTATION-{agentId} 顯示已指派操作，驗證報告沒有 Agent 按鈕。 |
| LLM／流程設定 | LLM 設定頁以 CLI、Skill、Agent 名稱及 Prompt 欄位建立／修改設定；流程設定 checkbox 多選後按 save-workflow-settings 保存。Agent 的操作入口只在對應目前可編輯階段顯示。 |
| 鎖定保存嘗試 | open-artifact-save 開啟保存候選對話；artifact-save-kind 選文件；artifact-save-candidate 收候選原文；artifact-save-attempt 實際送保存；artifact-save-error 顯示「此階段不可修改該產物」。候選不是有效文件編輯，locked editor 保持鎖定。AC015 檢查 UI 提示及原 DB/投影/來源不變，也檢查真實 409。 |
| 回退 | return-artifact 選 artifact 中文 label，return-stage 送回退；之後 UI 與資料庫 stage 一致，重新確認前不能前進。 |
| DbGate | 工作台 open-dbgate 開啟同一 managed browser；DbGate 7.3.2 的 ConnectionList_container、TabsPanel_buttonNewObject、NewObjectModal_query、QueryTab_executeButton、MessageView_tableWrap、SqlObjectList_container／refreshButton。Ace 編輯器輸入 SQL，Finished 與本次訊息及實際結果表格共同判定完成；錯誤列不視為通過。 |
| PTY | sidebar-terminal → 工作區選項 → workspace-tabs → xterm-host；關閉頁籤呼叫 DELETE `/terminals/{id}`。PTY 的實際輸入與輸出透過 terminal WebSocket 驗證。 |
| 全域瀏覽器錄製 | global-browser-toolbar、global-browser-url、sidebar-browser、play-saved-browser-recording、delete-saved-browser-recording、saved-browser-recording-script；前往建立 session，保存後列於側欄，播放在目前 managed page 實際重播。 |
| 情境執行 | scenario-tests；scenario-case-a/b 各含 case-test-ids、case-readiness、case-execution-status、case-select、case-run；run-selected-cases、source-ref、pin-source、pinned-source-ref、run-browser-canvas。後者 data-run-id/test-definition-id/case-result-id/session-id/context-ref/page-id/binding-seq/frame-sha256 必須對應已呈現 frame。 |
| 被測網站 | login-username/password/submit、logout、account-role、document-content/save/saved、manage-accounts-link、access-denied。A 唯讀，B 可編輯但管理頁拒絕；拒絕前後帳號資料以改 B 後為比較基準。 |
| Git／獨立腳本 | save-to-target-git、run-target-ci、ci-state、ci-run-id、script-purpose；recordings 路由重新打開固定保存版本。 |

### 證據與限制

StepEvidence 包裝公開 Playwright page／locator／input 與 expect，逐操作／斷言截圖，保留預期／實際值、source line、test/case、session/context/page。同步斷言與失敗也加入附件；失敗截圖出錯不吞原 assertion。Playwright HTML／JSON 與 evidence-chain.json 由真實執行生成。Reporter 對空集合、少測試、重複 ID、skip、缺 assertion／steps／截圖或失敗拒絕全綠，即使 Playwright 最終 status 看似 passed 也回 failed。

AC028 檢查 selected a 的兩個 tests 全執行與回傳，b 沒有本 run case_result、清單 NOT_RUN；兩個所選 tests 都須有可驗證的 live 畫格與同 run 步驟／圖片。SELECTED_CASES passed 仍 coverageComplete=false，需求維持 VERIFICATION。

工具測試使用 dependency doubles 檢查 resolver／reporter 的拒絕規則，與產品 E2E 分開；未執行產品就沒有產品通過證據。Chromium 使用與 Playwright 相容的版本；launchOptions 明確設定 chromiumSandbox=true。實際執行狀態以本次產生的報告為準。

官方 API：
[BrowserType.connect](https://playwright.dev/docs/api/class-browsertype#browser-type-connect)、[Browser.contexts](https://playwright.dev/docs/api/class-browser#browser-contexts)、[Test list](https://playwright.dev/docs/test-cli#test-list)、[TestInfo.attach](https://playwright.dev/docs/api/class-testinfo#test-info-attach)、[Reporter.onEnd](https://playwright.dev/docs/api/class-reporter#reporter-on-end)、[Playwright fixtures](https://playwright.dev/docs/test-fixtures)。此版未使用私有 Playwright context/page IDs。

## 官方依據索引（2026-10-17 查核）

- [Vue Introduction／Composition API](https://vuejs.org/guide/introduction.html)、[Vite](https://vite.dev/guide/)、[Fastify](https://fastify.dev/docs/latest/Reference/Server/)。
- [Node.js 24.19.0 SQLite](https://github.com/nodejs/node/blob/v24.19.0/doc/api/sqlite.md)、[Node releases](https://nodejs.org/en/about/previous-releases)。
- [Gherkin AST／Pickles](https://github.com/cucumber/gherkin/blob/main/README.md)、[JS generateMessages](https://github.com/cucumber/gherkin/blob/main/javascript/src/generateMessages.ts)。
- [TypeScript Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)、[Program 公開型別](https://github.com/microsoft/TypeScript/blob/v5.9.3/src/compiler/types.ts)。
- [SQLite CREATE TABLE／NULL](https://sqlite.org/lang_createtable.html)、[Foreign keys](https://sqlite.org/foreignkeys.html)、[Transaction](https://sqlite.org/lang_transaction.html)、[VACUUM](https://sqlite.org/lang_vacuum.html)。
- [Playwright Screencast](https://playwright.dev/docs/api/class-screencast#screencast-start)、[pickLocator](https://playwright.dev/docs/api/class-page#page-pick-locator)、[BrowserContext](https://playwright.dev/docs/api/class-browsercontext)。
- [Playwright codegen](https://playwright.dev/docs/codegen)、[Trace Viewer](https://playwright.dev/docs/trace-viewer)、[Screenshots](https://playwright.dev/docs/api/class-page#page-screenshot)、[Attachments](https://playwright.dev/docs/api/class-testinfo#test-info-attach)。
- [Playwright CLI／Test list](https://playwright.dev/docs/test-cli#test-list)：--list、--test-list、--project、--no-deps 與定位語意。
- [playwright-bdd 9.2.1 generation paths](https://github.com/vitalets/playwright-bdd/blob/v9.2.1/src/generate/paths.ts)、[缺步驟設定](https://github.com/vitalets/playwright-bdd/blob/v9.2.1/docs/configuration/options.md)。
- [node-pty](https://github.com/microsoft/node-pty)、[xterm.js](https://xtermjs.org/docs/)、[GitHub CI variables](https://docs.github.com/en/actions/reference/workflows-and-actions/variables)。
