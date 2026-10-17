# SD：BDD 軟體開發工作台

版本：0.4；日期：2026-10-17；需求：REQ-WB-001；狀態：**pending approval，待使用者確認**。

本輪只修訂這一份 SD；其中 DDL／DML 僅為設計，未執行。未生成或修改測試、安裝依賴、實作產品、build、執行 E2E、commit 或 push。原雲端的骨架與完整測試草稿及備份均保留；既有 27／43 工具證據屬舊需求基準，不能作為本次 28／44 的驗證結果。

## 1. 核准基準與文件歸屬

唯一需求來源為[同目錄 workbench.feature](workbench.feature)，共 **28 個 Scenario ID、44 個展開案例**，AC-WB-001～027 保留並新增 AC-WB-028。本次固定原文 SHA-256：

~~~text
88a51d341375ca58750df37cae184a81662469d9047354fd23b75a3006bbad66
~~~

使用者先以「補進」授權 AC-WB-028，接著對「接著可以對齊 SD 嗎？」回覆「可以」，授權進入本次 SD 修訂。來源為本次委派附帶原對話（thread 01a0fc94-e0dc-7217-9b9a-a555b7aae032），未提供的時間不補造。先前 SD 0.3 的確認只適用舊基準；本 SD 0.4 仍待確認。本輪只改 SD，不同步 [review.json](review.json)、README 或測試；它們目前記錄舊基準，不能當作本版核准。兩個測試 commit 等本版 SD 確認後才恢復，本輪不 commit／push。

本 bdd 專案先以 Git 自舉：Gherkin、這一份當次 SD、確認 metadata、後續測試與產品程式全存 Xing00000/bdd。每次需求使用 `spec/<requirementId>/`；本次只保留 spec/REQ-WB-001/SD.md。doc/ 只供 ADR，目前不新增 ADR、requirements.md、另一份 SD 或需求索引。

產品建成後，使用者專案的 Gherkin、SD、spec.ts 可以完整保存在工作台 SQLite；這項產品能力不把尚未完成的 bdd 自舉文件搬進產品 DB。需求 ID 與 release ID 分開，語意為多對多；本次不新增 release 管理功能。

## 2. 核心範圍與技術選擇

採單一組織、多人共用專案、TypeScript、Node.js、Vue、SQLite。只保留 feature 所列文件／流程、網頁 DB、PTY、Playwright 同會話觀看、使用者網頁錄製、測試生成／LLM 補齊、開發與報告。不補回角色／ACL、audit、評論／協作衝突、忙碌處理、控制權交接、額外核准關卡、預設唯讀 DB、查詢限制或配額管理。

| 選擇 | 理由與能力邊界 |
|---|---|
| Vue 3 Composition API、SFC、TypeScript、Vite | 遵照使用者選型；共用專案、文件編輯、DB 表格、瀏覽器 canvas、xterm 與報告拆為 UI 元件及 composables；不新增框架專用驗收情境。[Vue 官方指南](https://vuejs.org/guide/introduction.html)、[Vite](https://vite.dev/guide/) |
| Node.js 24 LTS、Fastify、WebSocket | 模組化單體承載 use case；HTTP 處理文件／流程／查詢，WS 傳 terminal I/O 與瀏覽器畫格；不先拆微服務。[Node 版本](https://nodejs.org/en/about/previous-releases)、[Fastify](https://fastify.dev/docs/latest/Reference/Server/) |
| SQLite、node:sqlite adapter | metadata.db 與被測專案 DB 分開。DatabaseSync 同步呼叫放 worker／程序，避免阻塞 API。v24.19.0 官方文件標示 release candidate；相容性須在 SD 核准後鎖版驗證，不宣稱已驗證。[官方 API](https://github.com/nodejs/node/blob/v24.19.0/doc/api/sqlite.md) |
| @cucumber/gherkin 與 TypeScript Compiler API | 前者取得 AST／Pickles／語法位置；後者取得 TS AST 與 syntactic diagnostics。皆只解析，不執行提交的程式；原文與正規化投影分開。[Gherkin](https://github.com/cucumber/gherkin)、[Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API) |
| Playwright Test、可替換的 TestGeneratorPort | 依使用者後續指定採 Gherkin → playwright-bdd → 確定性 TS adapter。codegen 只產骨架、明確 pending slots 與來源 manifest；之後 LLM 才產補齊快照。bddgen 9.2.1 原生輸出 .spec.js，adapter 的 TS 型別／識別 metadata 轉換須驗證沒有改變骨架行為；不能聲稱原生產 TS 或已完成驗收。[官方來源](https://github.com/vitalets/playwright-bdd/blob/v9.2.1/src/generate/paths.ts) |
| Playwright Screencast、Vue canvas | 沿用非 noVNC 方案；公開 page.screencast.start({ onFrame }) 提供 JPEG 畫格，服務自行整合 WS、輸入、語意錄製。API 自 v1.59 提供，後續鎖定相容修補版；沒有 FPS／延遲實測承諾。[官方 Screencast](https://playwright.dev/docs/api/class-screencast#screencast-start) |
| xterm.js、node-pty | 前者呈現 terminal，後者管理實際 PTY；node-pty 不是沙箱，使用既有雲端工作區的隔離及執行能力。[xterm](https://xtermjs.org/docs/)、[node-pty](https://github.com/microsoft/node-pty) |
| DB／LLM ports | 首版 SQLite；未來不同 DB 的 schema／query adapter 及不同 LLM provider 可替換，不先建通用 provider 管理或其他 DB 實作。 |

生成器重用官方 Gherkin parser／Pickles 與公開 Playwright Test API。step registry 在 codegen 只宣告確切 pattern、參數與 slot ID；未註冊或歧義會阻擋生成，已註冊但尚未補齊則可生成骨架。此類 stub 若被執行須拋明確 UnimplementedStepError，不得空函式、skip 或假斷言。codegen 的型別／discovery 成功不等於補齊完成或 E2E 通過。

## 3. 六邊形架構與資料流

~~~mermaid
flowchart LR
  Vue[Vue UI／HTTP／WS adapters] --> App[Application use cases]
  App --> Domain[Domain：需求、文件版本、階段、測試映射、結果]
  App --> Ports[Outbound ports]
  Adapters[SQLite／Git／Parser／Playwright／PTY／LLM／Artifacts] -.實作.-> Ports
  Ports --> Runtime[現有雲端工作區／target repo與CI／目標DB／模型]
~~~

程式依賴由外向內：domain 不 import Vue、Fastify、SQLite、Playwright 或模型 SDK；application 只依賴 domain 與 ports；composition root 組裝 adapters。圖中的外部呼叫方向是執行時資料流，不讓外部 SDK 型別滲入 domain。

| 模組／邊界 | 責任 |
|---|---|
| Domain | Requirement、DocumentVersion、Confirmation、Scenario、SourceCase、TestDefinition、Mapping、Baseline、Run；判定階段可寫產物、明確映射、版本綁定、下游失效與結果完整性 |
| Application inbound ports | SaveDocument、ConfirmGherkin、ConfirmSD、ReturnToStage、GenerateTests、CompleteTests、ListScenarioTests、StartDevelopment、VerifySelectedCases、Verify、SaveRecording、ReplayScript、BrowseDb、ExecuteSql、OpenTerminal |
| DocumentStore／WorkflowStore | 一次交易保存原文、投影與 head；確認綁定版本／hash，查詢需求與文件 |
| GherkinParser／TypeScriptParser／MappingValidator | 語法、來源位置、結構化投影與明確 ID 檢核；不執行輸入、不推導任意 TS 業務語意 |
| GitRepository／CiRunner | 讀取 target Git 的指定 commit 原文，保存副本及真實 CI 結果；一般 DB 保存不寫入 target Git |
| BrowserSession／Recorder／TestRunner | 同一 context/page 的觀看與操作，開始／停止錄製、語意草稿、保存版本重播、實際測試結果 |
| DbConnection／Terminal／Workspace | 真實 schema／SQL、PTY 程序與現有雲端工作目錄；與 metadata store 分開 |
| LlmProvider／ArtifactStore | 分階段提出 SD／測試／程式變更；圖片及報告檔案、hash 與附件索引 |

核心流程：

1. 保存 Gherkin → 語法／結構檢核 → 同交易寫原文及投影 → 人類確認該版本／hash。
2. 產生／編輯 SD（含架構與 DDL／DML）→ SQLite 保存完整版本 → 人類確認該版本及所依賴 Gherkin。
3. TESTS：先展開 Gherkin、宣告 step slots、產生不可變 codegen 骨架快照與 manifest；之後 LLM 以該快照為來源另存補齊草稿／完成快照。完整檢核通過才固定完成測試基線，不覆寫骨架快照。
4. IMPLEMENTATION：人類／agent 使用固定需求與測試開發程式 → 固定程式 commit／snapshot。
5. VERIFICATION：使用者由 Gherkin／Examples 清單選案例，依固定完成基線解析全部對應 tests；runner 只執行該集合。右側觀看同一 run 當前 test/session/page 的真實操作，每步斷言、截圖及報告用同一識別鏈回傳。全案執行與選取執行的結果分開判定。
6. 自錄腳本是平行的獨立產品資源：人類操作 viewer → 開始／停止 → 原文／動作另存 SQLite → 取指定版本實際重播；不自動成為標準 CI。

## 4. 階段、確認與失效

~~~mermaid
stateDiagram-v2
  [*] --> GHERKIN
  GHERKIN --> SD: 人類確認Gherkin版本/hash
  SD --> TESTS: 人類確認SD版本/hash
  TESTS --> IMPLEMENTATION: 生成與補齊完成、固定測試基線
  IMPLEMENTATION --> VERIFICATION: 固定程式版本後提交驗證
  VERIFICATION --> VERIFIED: 全案必要測試與證據完整且通過
  VERIFICATION --> VERIFICATION: 失敗或未完整
  SD --> GHERKIN: 退回修改Gherkin
  TESTS --> SD: 退回修改SD
  IMPLEMENTATION --> TESTS: 退回修改測試
  VERIFICATION --> IMPLEMENTATION: 退回修改程式
~~~

所有後續階段均可透過 ReturnToStage 退回指定上游階段；圖僅列常見路徑。VERIFIED 只是 verification/report 的結果，不增加人工關卡。

| 階段 | 可修改／執行 | 鎖定 |
|---|---|---|
| GHERKIN | Gherkin | SD、steps／spec、產品程式不開放產生或修改 |
| SD | 當次 SD | 已確認 Gherkin、測試、產品程式 |
| TESTS | 先 codegen 骨架快照；再獨立補齊快照、steps／fixtures／斷言；完成後固定基線 | 已確認 Gherkin、SD；已保存的骨架版本不覆寫 |
| IMPLEMENTATION | 產品程式 | Gherkin、SD、測試基線 |
| VERIFICATION／VERIFIED | 執行既定測試、保存實際結果／截圖／報告 | Gherkin、SD、測試與產品程式基線 |

TESTS 內的先後子步驟為 CODEGEN → COMPLETION → READY，requirements.stage 仍用 TESTS，不增加產品人工核准關卡：

| 子步驟／快照 | 可產生內容 | 清單顯示與前進條件 |
|---|---|---|
| CODEGEN／SKELETON | spec.ts 殼、step slots、test ID／case 映射與來源 hash；不含實際 UI/API/DB 操作、斷言或截圖實作 | PENDING_COMPLETION（待補齊）、execution=NOT_RUN；不能標 PASSED 或作為標準驗收 run 的可執行基線 |
| COMPLETION／COMPLETION_DRAFT | LLM 另存操作、locator、斷言、fixtures、DB UI 驗證與證據實作，引用原骨架版本/hash | 有待補 slot／questions 就維持待補齊，不進入產品開發 |
| READY／COMPLETED | 已補齊的 spec 與相依檔案經語法、明確映射、型別、discovery 與必要 slot 檢查後固定 | 可開始 implementation；實際執行結果仍為 NOT_RUN，完成測試撰寫不要求尚未開發的產品先綠燈 |

VERIFICATION 的單次選取 run 可以 PASSED，但只有 ALL_REQUIRED 範圍完整通過才能使需求進入 VERIFIED；局部通過維持 verification/report，不替未選案例製造結果。上游變更仍適用下列回退／失效規則。

API、LLM patch、Git 匯出與 workspace／PTY 的檔案寫入都經相同產物寫入規則。鎖定基線是不可寫快照；可修改工作目錄只包含該階段產物，不以 UI disabled 當作保障。違反時回 409 ARTIFACT_LOCKED_IN_STAGE 並保持原內容。既定測試透過 DB UI 執行 fixture DML 是驗證副作用，沒有修改固定測試定義。

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
| 使用者錄製腳本 | SQLite 另列 purpose=recording；完整原文、動作及實際重播紀錄；需求／情境可無關聯；不套標準 CI 完整覆蓋門檻 |
| bdd 自身 bootstrap | 全部文件／確認紀錄／測試留在 bdd Git；產品 DB 尚未存在不妨礙自身開發 |

target Git 副本若在 TESTS 中修改，成為待發佈候選版本；只有之後明確的 Git 寫入操作才能成為 target CI 的版本，本 SD 不增加自動同步或 promotion 功能。讀取 branch 後固定 commit；不得將同名 branch 的新內容當成舊 commit 副本。CI 分開記錄候選 commit 與實際 tested commit，因 PR CI 可能跑 merge commit。[GitHub Actions 官方變數](https://docs.github.com/en/actions/reference/workflows-and-actions/variables)

## 6. 入庫檢核、正規化與穩定識別

### 6.1 保存契約

SaveDocument 先判斷文件種類與用途，取得 UTF-8 原文，在記憶體內解析；不先覆寫目前版本、不執行 import／測試或任意程式。原文不做 formatter、換行或 Unicode 正規化；hash 對提交的同一 UTF-8 位元組計算。正規化指建立關聯式資料投影，不是改寫原文。重新讀取返回原文，結構化查詢使用其對應版本，不能偷偷取最新文件投影。

- Gherkin：官方 parser 的 AST／Pickles 及 parseError；記檔名、1-based 行列與原因。需求 ID 來自所選需求／檔案 metadata，不聲稱 Gherkin 原生有需求欄位。Scenario ID 來自明確 tag；保留 keyword、文字、順序、位置、Background、DocString／DataTable 與 Examples。Pickle 的 parser-generated AST id 只在本次解析內使用，不能當穩定業務 ID。[官方架構](https://github.com/cucumber/gherkin/blob/main/README.md)、[generateMessages](https://github.com/cucumber/gherkin/blob/main/javascript/src/generateMessages.ts)
- spec.ts：TypeScript Compiler API 建立 SourceFile／AST；使用隔離的記憶體 CompilerHost 與 Program.getSyntacticDiagnostics，不 emit、不執行輸入。diagnostic.start 用 getLineAndCharacterOfPosition 加 1，message 用 flattenDiagnosticMessageText；只接受語法診斷無錯誤的版本。語法有效不等於型別檢查、import 可解析、Playwright discovery 或執行成功。[官方 Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)、[公開 Program 型別](https://github.com/microsoft/TypeScript/blob/v5.9.3/src/compiler/types.ts)
- SD：保存完整文字與來源 Gherkin version/hash；本輪未新增 SD 語意或 SQL 執行檢核需求。
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

## 7. SQLite DDL／DML 設計（僅文件，未執行）

metadata.db 保存產品資料；target_connections 指向另一份被測專案 SQLite。下面是初版核心 schema，不是已建立 migration。每個 connection 在 transaction 外啟用 foreign_keys；TEXT 主鍵明訂 NOT NULL，複合 FK 指向明確 PRIMARY KEY／UNIQUE。[SQLite FK](https://sqlite.org/foreignkeys.html)、[NULL 與唯一性](https://sqlite.org/lang_createtable.html)

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

全新 metadata.db 使用此初始 schema，沒有任何既有產品資料需要原地升級；舊 SD 的假設表尚未建成，不將它虛構成已部署 schema。後續實作才建立有編號的 migration。已有資料時採「備份 → 新表／新投影 → 逐版本重解析與 hash／關聯比對 → 同交易切換 head」；無法重建來源的資料列標示待補，不捏造 mapping。回復使用 migration 前備份或切回舊表／head；不可用 DROP COLUMN 假裝能還原已丟失的原文。

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

## 8. 核心 API、事件與可觀察結果

以下為設計契約，不是已運作的 endpoints：

| API／通道 | 輸入 → 結果 |
|---|---|
| GET／POST /projects | 共用專案清單／建立專案；不是權限矩陣 |
| GET／POST /projects/{p}/requirements | requirementKey／stage；同專案需求關聯 |
| POST /documents/{id}/versions | rawText、purpose、sourceVersion、明確 manifest → version/hash，或 422 定位錯誤 |
| GET /documents/{id}/versions/{v} | 完整 raw、hash、來源版本及用途 |
| GET /documents/{id}/versions/{v}/structure | 需求／Scenario／steps／Examples 或 tests／mappings；版本固定 |
| POST /requirements/{r}/confirm-gherkin、confirm-sd | versionId/hash → 確認並移至下一階段 |
| POST /requirements/{r}/return | artifact kind → 所屬階段與下游失效 |
| POST /requirements/{r}/generate-tests | 確認文件版本/hash、pattern／slot 宣告 → SKELETON version/hash 與 manifest；不載入補齊實作 |
| POST /requirements/{r}/complete-tests | skeletonVersionId/hash、確認文件與補齊 context → 另存 COMPLETION_DRAFT／COMPLETED version/hash、sourceSkeleton 與 questions |
| GET /requirements/{r}/scenario-tests | 固定 gherkinVersionId 與 skeleton snapshot 或 testBaselineId → Scenario／Examples、全部 test IDs、readiness；可附指定 run 結果 |
| POST /requirements/{r}/start-development | 固定完成測試基線 → IMPLEMENTATION；骨架／待補稿不可前進 |
| POST /requirements/{r}/verify | testBaselineId/hash、sourceRef、selection.mode 與 sourceCaseIds → runId、scope、完整 expectedTestDefinitionIds；只接受可驗證固定版本 |
| GET /runs/{id}/viewer-binding | runId → 當前 testDefinitionId／caseResultId、sessionId、contextRef、pageId、bindingSeq；尚無頁面則明確未綁定 |
| POST /repository-snapshots | repo／branch／commit／path → target spec 逐字副本；不寫 Git |
| GET／POST /db-connections/{id}/schema、query | 真實 schema／SQL 與參數 → 真實資料／錯誤 |
| POST /terminals、WS /terminals/{id} | workspace、input／resize／close ↔ 實際 output／exit |
| POST /browser-sessions、WS /browser-sessions/{id} | context／page、畫格、pointer／keyboard／navigation／語意操作 |
| POST /browser-sessions/{id}/recordings/start、stop | recordingId／開始邊界 → 停止邊界與可檢查 TS 草稿 |
| POST /recordings、GET /recordings/{id}/versions/{v} | 原文／動作／可選來源關聯 → 獨立 SQLite 保存與讀回 |
| POST /scripts/{id}/versions/{v}/replay | 固定 DB 腳本版本／目標 → 實際 run；保存成功不是通過 |
| GET /runs/{id}/report、/screenshots/{id} | 真實測試、來源映射、逐步結果、圖片及錯誤 |

事件封套為 { eventId, projectId, requirementId?, documentVersionId?, runId?, testDefinitionId?, sourceCaseId?, sessionId?, contextRef?, pageId?, bindingSeq?, testKey?, scenarioId?, stepId?, actionIndex?, type, payload }。事件僅供 UI 與程序交換狀態，不做 audit 功能：
document.saved／rejected、workflow.stageChanged、artifact.invalidated、test.skeletonGenerated／completionSaved／needsInput、run.testStarted／browserBound、browser.frame／pageChanged、recording.started／stopped／saved、terminal.output／exited、db.executed、run.stepFinished／completed。

進度回應及報告區別 parser、mapping、typecheck、discovery、execution 各自的狀態；沒有執行的檢查顯示 NOT_RUN，不以共用「成功」圖示混為同一結果。

### 8.1 從清單點選到執行與結果

1. 清單由所選 Gherkin 版本的 scenarios／source_cases 與指定快照的 mapping 生成，列出 Scenario ID、case_id、全部 test IDs。只有骨架或補齊草稿時顯示「待補齊」，execution=NOT_RUN；不沿用舊版成功色。要求正式執行時回 TESTS_PENDING_COMPLETION，不啟動驗收 run。
2. 完成 LLM 補齊、固定測試基線及程式版本後，使用者點案例 a。請求明訂 selection.mode=SELECTED_CASES 及非空 sourceCaseIds；ALL_REQUIRED 另用明確 mode，不以空選取暗示執行全案。application 依 §7.4 解析 E(r)，保存來源版本／hash、scope、選取 cases／tests 與 runner 設定快照。
3. TestRunner adapter 在固定檔案與設定下 discovery，將每個穩定 testKey annotation 解析為唯一的 runner project／spec path／完整 title。以 Playwright 公開 --test-list 的完整條目與指定 project 執行；line/column 在此選項被忽略，不能拿它們當精確 test ID。準備 filter 後再 list 核對選取 ID 集合必須等於 E(r)，零個、多個歧義、缺少或多出 ID 均拒絕。不使用模糊 title grep、skip 或 --pass-with-no-tests 代替精確選取。[官方 CLI／Test list](https://playwright.dev/docs/test-cli#test-list)
4. runner 固定所選 project，不透過 project dependencies 順便執行未選案例；必要 fixtures/hooks 屬所選 tests 的前置。每個實際 testStarted 再比對 E(r)，並由 managed fixture 發布該 run/test 的 browser 綁定；不得執行 test-b 來完成選取 a 的請求。這是測試集合控制，不新增使用者權限／忙碌處理。
5. 右側訂閱當前綁定的實際畫格；case_result／step_result／screenshots 與事件皆附同 run、test、case、step、session/context/page 識別。每步 actual/expected 與結果回到清單及報告。未選 b 在本 run 顯示 selected=false、NOT_RUN，不建立 PASSED 結果。
6. 報告以 E(r) 計算本次 run 成敗，另列全案必要集合與未執行數。origin=target_ci 表示測試定義以 target Git 為權威；實際執行器記於 run 快照，工作台的局部執行不冒充 target CI 全套成功。只有 ALL_REQUIRED 且全部必要結果完整通過可使需求 VERIFIED。

## 9. 同會話瀏覽器、親自錄製與重播

### 9.1 即時觀看及使用者輸入

BrowserSession adapter 在既有雲端 workspace 內建立 managed browser/context；agent、程式及測試 runner 的 fixture 依 sessionId/contextRef/pageId 取得同一個被操作會話。browser 可有多個 context，不要求 contexts().length=1。任意外部程式自行 launch 的 browser 不會自動接入；managed fixture／內部 resolver 負責接線，UI 不取得未保護的公開 debug endpoint。

page.screencast.start({ onFrame }) → WS binary JPEG ＋ timestamp／viewportWidth／viewportHeight／pageId → Vue canvas。只保留最新待呈現畫格，避免畫面過時；畫格尺寸可能受既有 trace／video 設定影響。fps 選項只控制 path 影片輸出，不能拿它承諾 onFrame 即時速率。BrowserContext 是會話狀態容器，並非可嵌入畫面；本案不以 iframe 載入任意目標網站、不使用 noVNC。[官方 Screencast](https://playwright.dev/docs/api/class-screencast#screencast-start)

AC-WB-028 的右側 viewer 綁定 activeRunId／currentTestDefinitionId／caseResultId／sessionId／contextRef／pageId／bindingSeq。runner 開始下一 test 或切換 appPage／dbPage 時更新綁定並遞增 seq；只接受與當前完整 tuple 相符的 frame。延遲到達的舊 run/test/page 畫格不覆蓋目前畫面；等待頁面、結束或中斷時顯示真實狀態，不把最後一張靜態圖繼續標成 live。多個所選 tests 可各自建立 context，viewer 追蹤目前實際 test 的 page；不另開相同 URL 模擬測試過程。此綁定資料只支援正確畫面關聯，不新增控制權交接或 audit。

使用者在 viewer 親自點擊、鍵入、捲動及導覽：canvas 事件攜帶 pageId 與實際 viewport 座標，後端呼叫 page.mouse／keyboard／goto；不能把 letterbox 或 CSS 縮放後座標直接當目標座標。分頁／popup 有自己的 pageId，頁面切換後更新串流。導航欄、分頁選擇與 locator／assertion 編輯器屬工作台 UI；不是把遠端瀏覽器桌面硬嵌進網站。工作台 DB 頁不遞迴嵌入自己的 viewer。

### 9.2 開始／停止及可檢查草稿

1. 人類按「開始錄製」取得 recordingId；設定動作序列起點及目前 URL／page。開始前動作不回填。
2. viewer 真實輸入由 BrowserSession 執行；錄製器以已送出的動作序號、完成結果及 DOM 事件資訊建立 action 草稿。透過 context.addInitScript 與 exposeBinding 在新頁／新 frame 觀察 click／input／change 的目標、值及所在 frame，既有頁另安裝一次；此橋接只傳錄製動作資料，不是任意 shell／Node RPC。[addInitScript](https://playwright.dev/docs/api/class-browsercontext#browser-context-add-init-script)、[exposeBinding](https://playwright.dev/docs/api/class-browsercontext#browser-context-expose-binding)
3. 使用者選 locator（優先 testId／role／label 等可重播描述）及預期值，明確新增 visible／text／value 等斷言。page.pickLocator() 可在被操作頁協助選元素，但回傳 Locator 物件，不承諾能序列化成穩定 source；不靠 Locator.toString() 逆向產碼。候選屬性加人類編輯形成自有 locator recipe，再由程式 emitter 產 TS。[pickLocator](https://playwright.dev/docs/api/class-page#page-pick-locator)
4. 按「停止」由服務固定最後接受的動作序號，收完該序號之前的事件後回覆 stopped；停止後新操作不加入此次草稿。停止語意錄製不等於停止 viewer 的畫面串流。中斷則顯示未完成草稿，不能偽稱完整。
5. 以 navigate／click／fill／selectOption／明確 assertion 等自有 action model 產生可檢查 Playwright TS；導航、定位器與斷言保留頁面／frame 歸屬。只觀察到事件不能自動得知使用者想驗證什麼，斷言須明確指定。

這是網頁內自建錄製器。官方 playwright codegen 會開啟 browser 及 Inspector，屬桌面開發流程；它不是此 Vue 網頁可直接嵌入的 recorder SDK。Screencast 只提供畫格；Trace Viewer 是事後證據瀏覽，兩者均不取代語意錄製。[官方 codegen](https://playwright.dev/docs/codegen)、[Trace Viewer](https://playwright.dev/docs/trace-viewer)

基本導航、點擊、輸入、選擇與斷言是初版核心。瀏覽器 chrome、OS 檔案／權限對話框、canvas 內部語意、封閉 shadow DOM、拖放、下載／上傳及複雜跨 frame 操作不保證自動取得穩定 locator；保留明確待補項與原動作，不發明定位器或空斷言。跨站 frame 以 Playwright frame locator 及 frame 歸屬處理，不能用頂層頁面 DOM 假裝已讀取全部 frame。這些是錄製可靠性的界線，不是額外批准或停用產品功能。

### 9.3 獨立另存與實際重播

停止後人類另存到 recording 清單：完整 TS 原文、版本/hash、action 序列、執行目標設定，及可選的需求／來源案例對應。沒有對應就保持 NULL／零 mapping，不跑標準生成測試的完整覆蓋檢核。保存不碰 target Git／CI 清單，也不改 feature。

重播讀取指定已存版本，匯出到 workspace runner，以 Playwright 真正執行 saved script／assertions，記錄 status、實際錯誤及證據；不重新錄一份或只跑預覽 action 而冒充已存腳本結果。獨立 run 不推進需求到 VERIFIED。編輯後必須另存新版本；舊重播仍指向舊 hash。

## 10. Workspace、PTY 與執行生命週期

Workspace adapter 使用現有雲端工作區；開啟專案後建立相應可修改產物工作目錄與固定基線快照。xterm.js ↔ WS ↔ node-pty 輸入／resize／output／exit；終端是真實程序結果，不用靜態文字模擬。shell、agent、瀏覽器與測試 runner 在既有隔離執行能力下運作，不新增宿主任意 shell 公網端點；node-pty 繼承程序權限而不提供隔離。[node-pty 官方說明](https://github.com/microsoft/node-pty)

BrowserSession 與 PTY 分別有 created／running／closed 或 exited 狀態。關閉 workspace 時先固定已接受的錄製動作與結果，再停止 PTY 子程序、screencast 與 context；context 關閉會關掉其 pages。正在執行的 run 保留中斷／INCOMPLETE，不能變成成功。[BrowserContext.close](https://playwright.dev/docs/api/class-browsercontext#browser-context-close)

重播預設建立新的 context，保留保存的起始 URL／明確前置計畫，不能假設人類先前 cookie 或臨時頁面永遠存在。人類錄製與 agent／程式觀看各自明確指定使用的 session；本次不新增控制權租約、忙碌排隊 UI、交接或閒置配額。環境不支援所需能力時回報真實不可用，不修改雲端安全設定。

## 11. codegen 快照、LLM 補齊快照與兩個測試 commit

### 11.1 先保存 codegen 骨架

輸入為確認的 Gherkin／SD version/hash、generator／adapter 版本，以及明確 step patterns／參數／slot 宣告。輸出為 SKELETON spec.ts、穩定 test IDs、來源 manifest 及待補狀態。本次應有 28 個 Scenario ID／44 個來源展開案例；它們不是 LLM 補齊後測試數的上限。

骨架只含測試結構、Given/When/Then 分派或明確 completion slots、來源案例／step 對應；不含實際 locator、操作、業務斷言、DB fixture、重登入或截圖實作。為讓 bddgen 註冊 pattern 而存在的 stub 一旦執行必須拋 UnimplementedStepError；生成／list／型別檢查可成功，completionStatus 仍 PENDING，不能標成完整可執行驗收測試或 PASSED。

skeleton manifest 綁定 skeletonVersionId／raw hash、Gherkin／SD version/hash、generator 版本、testKey／sourceCase／step／slot IDs 及 manifest hash；codegen 的輸入 hash 不混入後階段的 world／操作／DB／截圖實作。保存後版本不可變，重新 codegen 建立另一快照，不直接覆寫既有殼或已補齊版本。未註冊或歧義的 step 阻擋生成；已註冊 pending slot 不因尚無產品實作而阻擋生成。[bddgen 缺 step 選項](https://github.com/vitalets/playwright-bdd/blob/v9.2.1/docs/configuration/options.md)

### 11.2 再由 LLM 另存補齊版本

CompleteTests 明確指定 sourceSkeletonVersionId/hash 及其確認文件。LLM 產出另一份 COMPLETION_DRAFT／COMPLETED spec 快照或其 implementation modules，包含真正操作／locator／斷言／fixtures／DB UI 驗證／逐步截圖與報告接線；不得改寫骨架快照、批准文件、原 testKey／來源案例，或以刪測試補齊。可新增唯一 testKey 補同一來源 case，維持多對一及完整映射。

補齊 manifest 保留來源 skeleton version/raw hash/manifest hash、確認文件版本、完整 test／step 映射及實作檔 hash。語法及明確映射有效的待補稿可保存為 COMPLETION_DRAFT；未解決 slot 或 questions 仍顯示待補齊。型別、discovery、所有必要操作與真實斷言及證據實作檢查完成後才標 COMPLETED、固定 baseline，開始產品開發。沒有產品時不要求先得到 E2E 綠燈；runtime 結果仍 NOT_RUN。

AC005 的完整與缺預期資訊分支使用獨立輸入：缺資訊分支必須在 Gherkin／SD／context 全部找不到所需預期值，回傳 questions／needs_input 並保留待補狀態。不得一面提供可用的 expected 值，一面無條件要求 needs_input。這是補齊階段的測試資料問題，不阻擋 codegen。LlmProviderPort 仍為 generateSd、completeTests、proposeImplementation，輸出提案 files/patches、questions、usage；application 按階段保存，模型文字不作執行或成功證據。

### 11.3 本 bdd 專案的兩個可比較 commit

本版 SD 確認後才依使用者原授權恢復兩個 local commits，兩者固定相同的 28／44 feature 與已確認 SD hash，不改既有 Git 歷史，也沒有 push 授權：

1. **Commit 1：codegen skeleton。** 必要套件／設定、明確 pending registry/stubs、生成殼、案例／step 映射與來源 hash、生成／list／型別／重現及 pending 拒絕假綠燈的工具證據。尚未落 Git 的已確認 feature／SD 基準一併保存以可重現。不得帶入完整 world、操作、斷言、DB、截圖或報告實作，codegen 也不得依賴它們。
2. **Commit 2：LLM completion。** 在 commit 1 之上，新增獨立補齊版本／modules、fixtures、真實操作／斷言／DB UI／截圖及報告測試實作、完成狀態與對來源殼 hash 的引用。保留 commit 1 的骨架檔與快照；使用不同輸出目錄或版本檔，不能重跑 generator 蓋掉已保存殼或補齊碼。檢查及報告區分工具成功與產品 E2E 的 NOT_RUN／實際結果。

產品的 SQLite 版本與本 repo 的 Git commits 是兩種保存機制；codegen→completion 的內容分界相同，不把「每次產品補齊都必須新增 Git commit」變成額外功能。已保存的完整舊稿與骨架備份只作可恢復參考，不自動當成本版完成基線；舊 27／43 證據須在新 SD 確認後重建。

證據鏈為：需求／Scenario ID → 確認 Gherkin/SD version/hash → codegen skeleton version/hash/slots → completion version/hash／明確映射 → 固定完成 baseline＋程式版本 → run scope／所選 cases／完整 E(r) → 實際 test → session/context/page／source step/action → actual/expected／截圖／結果。LLM 提案與生成殼都不能取代執行證據。

## 12. DB UI、人類流程測試及報告

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
| 017 | dbPage 開工作台 DB UI，查 scenario_user，斷言 role=A/state=active；每個操作及斷言保存圖 |
| 018 DB 變更 | 從 DB UI 改 A→B、保存、重新查回並斷言 B；保存後與重查後留圖 |
| 018 登入 | appPage 登出舊登入，再以同帳號登入；斷言 B 編輯入口，留登出／登入／登入後圖 |
| 018 允許／拒絕 | 改文件 edited 並斷言成功，再從 DB UI 查回 edited；開管理帳號頁斷言拒絕且帳號資料未改 |
| 019 | 網頁或 DB assertion 不符時先保存失敗當下頁面與 expected／actual／source step，再保留原錯誤 |
| 020 | 每次重跑先從 DB UI 還原帳號 A／active、文件 initial，結束舊登入，查回初始狀態並截圖才重跑 |

拒絕管理帳號操作的資料比較基準是「已改 B、拒絕操作之前」，不誤拿原先 A 值當未變更基準。fixture 初始化計畫與測試 baseline 綁定；驗證只執行該計畫。不能用 Node 直接 SQL 取代 feature 要求的 DB UI 流程。

driver 對每個操作／assertion 記 runId、testDefinitionId、sourceCaseId、actionIndex、sourceStepId、sessionId/contextRef/pageId/bindingSeq，於步驟完成後 page.screenshot()，以 testInfo.attach 附加並存 artifact/hash；前置圖標 precondition，失敗圖標 failure。截圖失敗不吞掉 assertion 錯誤，圖片成功也不使測試成功。[Screenshot API](https://playwright.dev/docs/api/class-page#page-screenshot)、[testInfo.attach](https://playwright.dev/docs/api/class-testinfo#test-info-attach)

### 12.3 報告及不可假綠燈

報告列 runId、execution_scope、所選 source cases、E(r)、實際執行 tests、全案必要數及未選未執行數；並列來源種類、需求／Scenario／Examples、各 test ID、骨架／完成版本與基線/hash、target commit／實際 tested commit 或 DB scriptVersion、環境與初始計畫、每步 expected/actual、session/context/page、截圖與錯誤。同一案例的全部映射 tests 都列出。未選 b 不產成功結果，不挪用其他 run 的成功。錄製／整合重播與標準 Git 測試分開列示。

單次 run 的 PASSED 需要 E(r) 中全部必要 tests 實際執行、斷言通過、必要逐步／失敗證據完整；某選取 case 的全部映射 tests 都通過才標該 case 通過。SELECTED_CASES 即使 PASSED，coverageComplete 仍為 false，需求不變成 VERIFIED；只有 ALL_REQUIRED 完整通過才能代表全案通過。E(r) 為零、E(r) 內遺漏 test／steps、未實作、無斷言、僅保存文件／截圖、未執行、缺證據、中斷或不同 commit 的舊結果都不能填通過。未選案例不是局部 run 的遺漏，但必須保留全案未完整狀態。失敗為 FAILED，執行或證據不完整為 INCOMPLETE，上游改動後為 INVALID，尚未執行為 NOT_RUN。先保存真實結果再輸出 HTML／JSON，不讓 LLM 的成功文字決定結果。

## 13. 實作順序、文件覆蓋及待核准事項

本 SD 0.4 核准後才恢復 TESTS：先做純 codegen 快照及第一個 commit，再做獨立 LLM 補齊快照／操作／斷言／fixtures／證據實作與第二個 commit；必要檢查完成後才固定完成測試基線。接著才依測試實作產品，最後固定版本驗證 AC028 的清單→選取→runner→右側畫面→同 run 結果鏈。這是既有核心的先後順序，不刪減 DB UI、錄製或重播。

| AC | 本 SD 對應 |
|---|---|
| AC-WB-001 | §1 Git 自舉及本次核准基準；§4 階段 |
| AC-WB-002 | §3 共用 Project／Store；§5 文件；§8 API |
| AC-WB-003 | §4 確認 Gherkin→SD；§6 版本/hash；§7 DDL/DML |
| AC-WB-004 | §2、§4、§11.1 純 codegen 骨架／pending slots／來源 manifest |
| AC-WB-005 | §4、§11.2 獨立補齊快照、兩種輸入及 needs_input |
| AC-WB-006 | §4、§11 固定測試後開發 |
| AC-WB-007 | §7、§12 真實 SQLite schema／SQL／重新讀取 |
| AC-WB-008 | §10 PTY 真實 I/O |
| AC-WB-009 | §9.1 managed 同會話及即時畫格 |
| AC-WB-010 | §9.2 人類操作、開始／停止、定位器／斷言及 TS 草稿 |
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
| AC-WB-028 | §4 待補／完成分界；§7.4 完整選取集合；§8.1 清單到執行；§9.1 同 run/test/session/page；§12.3 局部與全案結果 |

本輪僅做文件靜態一致性檢查：固定 28／44 feature 的 hash、AC001～028 覆蓋、骨架／補齊邊界、DDL 鍵／FK／空值及執行集合／viewer 關係；**未執行 SQL、型別檢查、生成、build 或 E2E，也未改測試／README／review metadata**。DDL、runner 精確選取、實際串流與報告仍待本 SD 確認後驗證。舊工具結果不能當成本版通過。

請審閱本版的兩個快照／commit 分界、案例到完整 test 集合的精確選取、右側同 run/current test/session/page，以及局部／全案結果判定。Vue、六邊形、SQLite、獨立錄製及多對一維持既有範圍。本版仍 pending approval；確認後才恢復兩個測試 commit，本輪不 commit／push。

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
