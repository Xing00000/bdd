# REQ-WB-001 實作與驗證稽核

日期：2026-10-17。這是依已核准 Gherkin、SD 0.4 及既有補齊測試核對目前實作的稽核紀錄，不是新 SD、驗收條件變更或新的測試基線。28 個 `AC-WB` ID 共展開 44 個既有產品案例。

後續狀態：使用者已批准限定修正下列 AC021／AC024 fixture；本輪只增加有效保存的 `extra:true`，以及初始化／同步 `vars.gherkin`，保留 Gherkin、SD 與所有斷言。原稽核描述及歷史收據保留於先前 commit；最新修正範圍、manifest 與驗證結果見 [fixture-correction.json](evidence/fixture-correction.json)。這不代表 44 案 E2E 已執行。

**目前尚未執行這 44 個產品 E2E，也沒有真實 LLM 產生／補齊成功證據。** Chromium 正式下載先前遭 CDN 403，環境沒有相容執行檔；目前也沒有可用的 LLM provider 設定。瀏覽器不可用的拒絕測試、TypeScript 檢查、CLI discovery 或 HTTP provider 替身測試成功，都不能解讀成產品 E2E 通過。

## 來源與 Git 邊界

沿用的測試歷史完整 SHA：

| 階段 | Commit |
|---|---|
| 原待補齊骨架 | `95fb2960aa56cce22c17ad40b5cfa535da315a28` |
| 44 案補齊快照 | `f8678bdc59dbcd582bb9cdb3cc8be4060a9e6efe` |
| 原生可讀 BDD steps 修復版 | `4e3ad3ed5048bc62e20e1be9a1ebb61d3d997375` |

本輪最初三個產品本地 commit：`b7060de1309aae1226569d5db2bc90cbf3a20b21`、`f94c6f5cb96f98cddb475488c169a2915e04c380`、`1e765399b3483b2a927dc00afdb7b15f471199e8`。本文撰寫時仍有後續修正，最終本地 HEAD 與收據由整合驗證更新；不能把前一份收據套到之後修改的程式。

本次已授權的 push 是既有修復版 `4e3ad3ed5048bc62e20e1be9a1ebb61d3d997375`。稽核時重新唯讀查詢遠端，`refs/heads/spec/workbench-gherkin-review` 仍為該 SHA；遠端 `main` 仍為 `a1dffc11c9e29664a15287574a59c83d272864cc`。新增產品 commits 沒有 push，沒有部署，也沒有操作使用者電腦。

初輪未修改核准 feature、SD、`tests/completion` 的 fixture／assertions；後續僅依明確批准修正上述 fixture，另生成 implementation manifest。核准條件與所有斷言保持不變，核准原文 SHA-256 維持：

- `spec/REQ-WB-001/workbench.feature`：`88a51d341375ca58750df37cae184a81662469d9047354fd23b75a3006bbad66`。
- `spec/REQ-WB-001/SD.md`：`a0bd73923884da67c0c71be2aaf945319fcb1a5bb380b7c704460989d3b565b4`。

## 如何解讀證據

| 證據種類 | 可以支持的結論 | 不能支持的結論 |
|---|---|---|
| 真 SQLite、node-pty、Git 子程序、Fastify HTTP 與實際 Playwright CLI | 相應儲存、交易、程序輸出、Git 固定版本、HTTP 接線與 discovery 的觀察結果 | 使用者在 Vue／Chromium 中已走完驗收流程 |
| TypeScript、Vue 型別與 Vite build | 目前快照可以通過其型別／建置檢查 | 業務驗收已通過、畫面或輸入已實際正常 |
| 顯式 browser／runner／page／HTTP provider doubles | 拒絕規則、事件驗證、序號、回傳格式與特定分支的單元行為 | 真瀏覽器畫格、實際截圖、真模型理解或真實網站互動 |
| 不要求 browser fixture 的真 Playwright 程序 | 真 runner／reporter 接線；缺少瀏覽器步驟證據時仍應 `INCOMPLETE` | 工作台或目標網站的 E2E 成功 |
| 原始碼中已有模組與路由 | 相應功能已接線、可供後續驗證 | 該功能已驗收 |

證據入口為 [verification.json](evidence/verification.json)、[test.log](evidence/test.log)、[check.log](evidence/check.log)、[build.log](evidence/build.log)、[startup.json](evidence/startup.json) 與 [e2e-prerequisites.json](evidence/e2e-prerequisites.json)。`verification.json` 的 `scope` 是 `PRODUCT_COMPONENT_AND_HTTP_API_TESTS`，並記錄原始碼 hashes；應核對其快照、命令退出碼及時間，不能只看 `PASSED`。執行總數以最終整合收據與 log 為準，本文不把較早一輪的測試數當成後續修正的結果。

`startup.json` 的 HTTP 200 證明服務與 HTML 可回應；它明確標示 `HTTP_STARTUP_ONLY`／`browserUiE2E=NOT_RUN`。`e2e-prerequisites.json` 記錄前置檢查停止、`executionAttempted=false`、exit 2，並不是已啟動 44 案後的成功報告。詳細阻礙見 [KNOWN-BLOCKERS.md](KNOWN-BLOCKERS.md)。

## 28 項驗收追蹤

下表的「已有」指實作或對應模組證據，不代表既有產品驗收案例通過。表中提及新回歸測試時，必須由最終 `verification.json` 的檔案 hash 與 `test.log` 證明該版本實際執行。

| AC ID／目的 | 實際模組與行為 | 目前證據及尚待驗證 |
|---|---|---|
| **AC-WB-001** 自身遵守確認流程 | Git 內既有 `spec/REQ-WB-001`、review／測試快照；[core](../src/application/core.ts) 的確認與開始開發關卡；[Vue](../ui/src/App.vue) 呈現階段。 | Git 歷史與原文 hash 可查；core／HTTP 測試涵蓋版本 hash 與階段拒絕。本輪依既有核准基線實作，沒有重新起草規格；完整 UI 流程未跑。 |
| **AC-WB-002** 共用專案與文件 | [server](../src/http/server.ts) 的 projects／requirements／documents 路由、[SQLite worker](../src/adapters/sqlite/worker.ts) 與 document heads 共用持久資料。 | `core.test.ts`、`http-integration.test.ts` 使用真 DB，包含關閉重開後讀回；兩個真 BrowserContext 的多人 UI 驗收未跑。 |
| **AC-WB-003** Gherkin 確認後產生 SD | [extensions](../src/application/extensions.ts) 檢查 `SD` 階段與 Gherkin 確認；[LLM](../src/adapters/generation/llm.ts) 提案要求架構、DDL／DML、migration、rollback 與資料風險，保存成獨立版本再由人確認。 | HTTP 已驗證未設定 provider 回 `503 LLM_UNCONFIGURED` 且不保存假 SD；真模型 SD 內容品質及人類 UI 審閱未驗證。SD 業務完整性仍須人確認，prompt 本身不是完整性證明。 |
| **AC-WB-004** 產生可發現且可追溯的骨架 | [generator](../src/adapters/generation/generator.ts)、[definitions](../src/adapters/generation/definitions.ts) 使用實際 `playwright-bdd`，保存 spec、bundle、manifest 與來源案例映射；生成殼保持 `SKELETON`。 | `generation.test.ts` 真正執行 bddgen／Playwright discovery，涵蓋明確 definitions、Outline 展開及來源不符拒絕；未把 discovery 當成執行。Vue 上傳／按鈕全流程未跑。 |
| **AC-WB-005** LLM 補齊且不偷改驗收 | LLM 提案 → [validation](../src/adapters/generation/validation.ts)／[semantic-validation](../src/adapters/generation/semantic-validation.ts) → core 保存獨立 completion；檢查原 IDs、映射、來源 hash、停用／pending、型別、discovery 與可辨識操作／斷言。長操作的預期 head／確認版本須在保存時重驗。 | `generation.test.ts` 的 HTTP provider 是顯式測試 fixture，驗證協定、questions 與刪 ID 拒絕；`generation-semantics.test.ts` 涵蓋常數斷言、偽 action、未執行 callback 與吞錯等拒絕。core 測試涵蓋 stale proposal 與重新核准來源。真模型補齊尚未執行；靜態分析不能證明任意程式等價於業務驗收。 |
| **AC-WB-006** 按確認文件開始開發 | core 固定 `COMPLETED` 測試基線；extensions 開發前重驗 bundle；[workspace](../src/adapters/workspace.ts) 保存 source 與固定真 Git commit；Vue 依階段開啟開發入口。 | core／HTTP／workspace 測試核對鎖定、真 revision 及 source bytes 與 commit；完整使用者開發到驗證的 UI 流程未跑。 |
| **AC-WB-007** 真實 SQLite 操作 | [target-db](../src/adapters/runtime/target-db.ts)／[worker](../src/adapters/runtime/target-db-worker.ts) 執行實際 schema introspection、prepare／bind、DDL／DML；metadata 與 target DB 分離；Vue DB 頁呼叫 query。 | `runtime.test.ts` 與 `http-integration.test.ts` 使用真 SQLite，重查實際內容與交易；長 SQL 測試確認 worker 不阻塞 API event loop。Vue 操作及角色情境的瀏覽器證據未跑。 |
| **AC-WB-008** 真 PTY 持續輸入 | [terminal](../src/adapters/runtime/terminal.ts) 的 node-pty、server 的 terminal WebSocket、[TerminalPane](../ui/src/TerminalPane.vue) 的 xterm；stage 目錄由 workspace 提供。 | `runtime.test.ts` 啟動真 TTY，驗證解碼後程序 marker 並非命令 echo；完整 xterm UI 互動未跑。階段子目錄不是 OS sandbox，同 UID 跨目錄操作尚不能靠它阻止。 |
| **AC-WB-009** 即時看 agent／程式會話 | [browser](../src/adapters/runtime/browser.ts) 以同一受管 context/page 與 marker 接線，公開 Screencast 輸出真 JPEG；server／[frame-channel](../src/http/frame-channel.ts) 經 WS 傳送；[BrowserViewer](../ui/src/BrowserViewer.vue) 呈現 canvas。 | `ui-transport.test.ts`／`transport-regressions.test.ts` 驗證 tuple、序號、縮放與背壓規則，使用資料或 socket 替身；正式 browser probe 目前只有 `BROWSER_UNAVAILABLE`。沒有真 JPEG／canvas／agent 觀看成功證據。 |
| **AC-WB-010** 網頁內操作與錄製 | viewer 輸入回同 managed page；browser 的 DOM recorder／[recorder](../src/adapters/runtime/recorder.ts) 收語意 locator、輸入、導覽與明確斷言並輸出 TS；停止時 drain 邊界後凍結，與標準 CI 分開。 | recorder 純函式與顯式 DOM／page lifecycle fixture 測試涵蓋合併 fill、Enter 去重、popup／stop 邊界、敏感值不入原文；真瀏覽器錄製未跑。這是自有網頁 recorder，不是官方桌面 codegen，也不是任意網站錄製全面支援宣告。 |
| **AC-WB-011** target Git／CI 權威 | [Git adapter](../src/adapters/git/index.ts) 固定 commit 逐字讀取、明確本地保存與 detached worktree 執行；[checkout](../src/adapters/runner/checkout.ts) 讀實際 checkout bundle，核對 spec／helper bytes hash、完整與過濾 discovery，產出可信 config／test-list；server 只跑同一 managed run，保存 candidate／tested commit。 | `git-adapter.test.ts` 真執行 Git、npm／Node 命令，驗證成功／失敗退出碼、HEAD 不變及 prepare 失敗不執行專案命令；`runner-checkout.test.ts` 真 discovery，含 helper bytes 改變、ID 不符及 symlink 拒絕。這些測試不等於 target CI 的瀏覽器 E2E 已過。獨立 SQLite 腳本重播不能替代標準 Git CI。 |
| **AC-WB-012** 自建整合測試獨立入 DB | core 的 independent documents／execution config；`POST /integration-tests` 與 [runs](../src/application/runs.ts) 重播保留 `INDEPENDENT`，一般保存不寫 target Git。 | core／HTTP 測試證明原文與設定保存、不自動建立 passing run 或 Git snapshot；runner discovery 可查。實際整合測試瀏覽器執行未跑。 |
| **AC-WB-013** 真驗證報告及來源／截圖鏈 | runs 固定 baseline、source snapshot 與完整選取集合；[Playwright runner](../src/adapters/runner/playwright.ts)、[reporter](../src/adapters/runner/reporter.ts) 接真程序事件；JSON 與 [canonical HTML](../src/http/report-html.ts) 呈現最終證據判定，圖片 endpoint 重核 artifact root／hash。 | runner 測試真跑無 browser fixture 的 Playwright 程序，證明程序 passed 仍因缺證據保持 `INCOMPLETE`；HTTP 圖片測試是明確靜態 PNG fixture，僅驗傳輸／hash／越界拒絕；不是 Playwright 截圖。44 案真報告尚未產生。 |
| **AC-WB-014** 缺步驟不能假綠 | definitions／bddgen 拒絕 missing／ambiguous；core／completion validator 拒絕 pending、停用、刪 IDs 或不完整映射；runs 檢查所有必要步驟／斷言／圖片。 | `generation.test.ts` 真 bddgen 診斷；core、semantic regression 與 runner incomplete 測試驗拒絕分支。這些拒絕測試成功只證明相應防線，不是未實作步驟已完成。 |
| **AC-WB-015** 階段產物鎖 | core 在同交易重驗 stage，拒絕時 `409 ARTIFACT_LOCKED_IN_STAGE`、不更新 head／投影；server／extensions 與 Vue 編輯入口依階段限制。 | core／HTTP 測試檢查拒絕及保存不變；Vue 鎖定候選對話未經真 browser 驗證。PTY 同 UID 的檔案存取不由 UI 鎖定隔離。 |
| **AC-WB-016** 回退與下游失效 | core `returnTo`、確認紀錄／baselines／runs 原子失效並保留歷史；測試基線中文 alias 回 `TESTS`；重前進需重新確認及完成要求。 | `core.test.ts` 包含 alias、原子失效與歷史保留、上游新版本與 hash 變更；四個 Outline UI 分支未跑。 |
| **AC-WB-017** 經網頁 DB 查真值並逐步截圖 | DB 頁 → query API → 真 target SQLite；既有 managed runner／source steps 提供查詢斷言、session tuple 與截圖事件鏈。 | 真 SQL／HTTP 接線已測；既有 fixture 原始碼可追蹤，但沒有 Playwright 操作 DB UI、每步真 screenshot 或本 AC 的執行證據。 |
| **AC-WB-018** 改角色、重新登入、允許與拒絕 | [target-app](../src/fixtures/target-app.ts) 為獨立真網站；登入讀實際 role/state 固定 session，舊 A session 不因 DB 改 B 自動提權；B 保存真文件，管理 GET／POST 皆拒絕。 | `git-target-fixture.test.ts` 真 Fastify HTTP／SQLite 驗證錯密碼、A 拒寫、角色變更後重新登入、B 持久化、管理拒絕與帳號不變；沒有使用瀏覽器走跨網站 DB UI／logout／relogin 或截圖，故本 AC 未驗收。 |
| **AC-WB-019** 失敗結果與截圖一致 | runs 驗證原 assertion 狀態，失敗需 failure 圖；JSON／canonical HTML 同列 expected／actual／step／image，原始 Playwright HTML 另標為附件，不推翻 canonical 判定。 | runner 事件驗證使用明確 adapter doubles，核對 FAILED 不被圖檔保存改綠；HTTP regression 核對 `INCOMPLETE` HTML 與圖片 hash。真畫面失敗截圖及對應 E2E 未跑。 |
| **AC-WB-020** 重跑初始化與清登入 | 既有 E2E fixture SQL／managed runner 明確重設 A／initial，target app logout 失效 session；產品 DB adapter 真執行，不以 setup 重置所有既有資料冒充該流程。 | target HTTP 測試驗 logout；DB 測試驗真 UPDATE。setup 測試反而確認既有 DB 不被偷偷重設；瀏覽器本輪初始化、清登入與重跑截圖未跑。 |
| **AC-WB-021** 三類文件逐字重讀 | core document versions／heads／source linkage，server 原文與 structure endpoints，Vue 文件讀回。 | core／HTTP 重開服務後逐字讀回及保留映射已有證據；既有 AC021 spec 分支有「刪掉骨架第三個 test」的有效輸入 fixture 衝突，下節列明，不放寬產品防線。 |
| **AC-WB-022** 錄製腳本另存與真重播 | recording purpose／actions／可選映射保存，runs 固定指定 `scriptVersionId` 重播；[replay-fixture](../src/adapters/runner/replay-fixture.ts) 接 managed page 與逐步證據，與 Git CI 分開。 | core／HTTP 證明保存版本與無隱含 Git 寫入；`runner-replay.test.ts` 的 page／locator／keyboard／mouse 是顯式 doubles；CLI discovery 是實際程序。真錄製→保存→指定版本重播未跑。 |
| **AC-WB-023** 語法失敗保留有效版本 | [parsers](../src/domain/parsers.ts) 使用官方 Gherkin 與 TypeScript syntax diagnostics；core 在版本／head／投影交易前拒絕無效內容。 | core／HTTP 測試使用實際 parser 與 SQLite，驗檔名／行／欄／原因及原狀保留；Vue 顯示診斷的真 browser 流程未跑。 |
| **AC-WB-024** Gherkin 原文與正規化結構 | parsers 與 core projection 保存 scenario、background／steps、Examples 欄／列／cells、source cases、位置與同版本 hash。 | core 測試真 DB 驗 UTF-8 原文、歷史投影、順序及新 head 不改舊來源；既有 steps 在保存前讀 `vars.gherkin` 的純 fixture 初始化缺陷見下節。 |
| **AC-WB-025** 多 test 對同 case 的明確映射 | core 的 test definitions／case mappings 以版本 FK 連 source Gherkin，保留 `test-a`／`test-a-extra` 同對 a 與 b 的獨立 test；新 Gherkin head 不改舊 mapping。 | core 真 DB 測試含多對一、歷史版本／hash、來源固定；generator／runner 真 discovery 核對完整 ID 集合。完整案例 UI 驗收未跑。 |
| **AC-WB-026** 六種無效映射拒絕 | core 先診斷 missing test、missing case、duplicate ID／mapping、unknown scenario／example，再檢查骨架保留；失敗不寫有效新版本／投影。 | `core.test.ts` 逐類驗證錯誤內容及無部分保存；不得為符合既有 fixture 的錯誤輸入而刪掉保留 IDs 檢核。Outline 產品 UI／HTTP 全 6 案未跑。 |
| **AC-WB-027** 未關聯錄製仍可獨立保存 | recording 的 requirement/source mapping 可空；replay 不需要假造 Git 或 DB connection，使用保存的目標 URL，拒絕跨 project／目標不符。 | core／HTTP 真持久化未關聯腳本；runner discovery 真執行；`runner-replay.test.ts` 的 execution context／browser 是明確 doubles、執行結束為 `INCOMPLETE`。真重播尚未驗證。 |
| **AC-WB-028** 選 a 全部 tests、同 run live 與證據 | core scenario list／readiness；runs 拒絕 skeleton 後固定 baseline、source cases、a 的兩個 tests 與完整 test-list；browser tuple／bindingSeq 連 case result、step 及 frames；canonical 報告保留 b 為 NOT_RUN，selected pass 不轉 VERIFIED。 | 真 CLI discovery／精準選取測試核對 a、a-extra 並排除 b；事件／binding／背壓與缺證據規則有單元測試，其中 browser／runner 有顯式 doubles。沒有同次真 session/page JPEG 與完整選取 run 的產品證據，仍未驗收。 |

## 瀏覽器與錄製能力的具體邊界

目前接線是 `chromium.launchServer({chromiumSandbox:true})` → 同受管 BrowserContext／Page → `page.screencast.start({onFrame})` 的 JPEG bytes → JSON tuple 後接 WS binary JPEG → canvas 解碼呈現。`BrowserContext` 本身不是嵌入畫面；`playwrightEndpoint` 是私有 managed runner 接線，不是可嵌入的網址。沒有用 iframe 宣稱能觀看任意網站，也沒有以 Trace Viewer 冒充即時觀看。

frame tuple 保留 run／test／case result／session／context／page／binding sequence；前端只在已解碼呈現後標示該畫格。背壓保留最新畫格，晚到／重複序號與不同 binding 必須拒絕。viewer pointer／key／text／wheel 送回同 managed page；輸入佇列、DOM recorder binding 與 stop drain 讓錄製邊界可檢查。這些程式與回歸測試不能替代缺少的真 Chromium JPEG、canvas 像素與人類輸入驗證。

網頁 recorder 產生 locator recipe、frame path、操作與明確斷言；非忠實可重現操作以 unsupported／error 留下問題，不應偷偷略過。它與官方桌面 `playwright codegen` 分開。popup、複雜跨 frame／原生對話框、CAPTCHA、拖放及任意既有 Playwright API 的完整相容，尚無實際支援驗證；獨立重播對未受管新頁採拒絕，不能把少錄步驟當成功。

敏感輸入以 `WB_SECRET_*` alias 代替 literal；[secrets](../src/adapters/runtime/secrets.ts) 的 reference／allowlist resolver 僅能證明明確引用的驗證與解析規則，不能聲稱目前已完成密碼輸入、保存、secret binding、真重播與截圖遮罩的全流程。不得把整份 server environment 或 LLM key 傳給 terminal／測試程序以圖方便。

官方文件於 2026-10-17 重新核對：[Screencast](https://playwright.dev/docs/api/class-screencast) 說明 `onFrame` 提供 JPEG、捕獲時間與 viewport；[Test generator](https://playwright.dev/docs/codegen) 的 codegen 會開啟瀏覽器與 Inspector 兩個視窗；[Trace Viewer](https://playwright.dev/docs/trace-viewer) 用於查看已記錄的執行追蹤。因此網頁內 canvas、輸入回傳與 recorder 都是此產品另行實作的接線，不是這些工具自動提供的網頁嵌入錄製功能。

## LLM 接線與最少設定

`src/main.ts` 僅在 server 有 `WB_LLM_API_KEY`（或 `OPENAI_API_KEY`）及 `WB_LLM_MODEL` 時建立 provider；`WB_LLM_BASE_URL` 可選，預設 `https://api.openai.com/v1`。adapter 使用 HTTP Chat Completions 相容協定，固定已確認原文、骨架與來源 metadata，模型輸出是提案，缺資訊需回 `needs_input` 和非空問題。

本稽核只讀取上述設定程式碼，沒有讀環境值、憑證或秘密檔。需要設定的最小鍵名如下，值由部署該私有 server 的人提供：

```text
WB_LLM_API_KEY 或 OPENAI_API_KEY
WB_LLM_MODEL
WB_LLM_BASE_URL（可選）
```

現有 provider 協定測試是顯式本機 HTTP fixture；沒有由它產生「模型已理解／完成」的產品結論。實際專案仍需提供可驗證的 locator、fixture、目標 URL 與業務預期。型別、AST 與 discovery 能排除一些空測試／偽斷言，但不能普遍證明任意 helper、網路服務或模型提案沒有弱化人類驗收；仍需人工審閱與真 E2E。

## 不可假綠燈與來源保證

1. 骨架／completion draft 不可成為完成基線；不接受刪原 test IDs、重映射、停用／pending 或缺少必要來源案例。
2. 固定來源文件版本／hash、骨架來源、完整 test 集合與本次選取集合；長任務回來時重驗 head／確認，來源變更後重新審核，不能只比文字相同。
3. 程序退出 0 只是必要條件。缺 test、step、斷言、matching tuple、圖片／hash、runner completion 或完整必要集合，最終仍須 FAILED／INCOMPLETE／NOT_RUN，不能靠靜態圖或保存成功變綠。
4. 失敗 assertion 不因截圖保存成功而改判通過。canonical JSON／HTML 才是工作台最終判定；原始 Playwright HTML 是另列且明確標示的執行器附件。
5. `SELECTED_CASES` 通過不等於 `ALL_REQUIRED`，未選 test 不建偽結果、不標綠；只有全案必要集合與完整證據通過才可 VERIFIED。
6. target Git CI 應讀實際 checkout 的 spec 及 helper bytes，核對 hash 後 discovery／執行，不把 SQLite 副本覆蓋 checkout 再聲稱是原 commit 的測試。candidate／tested commit 分別保存；獨立 DB 腳本與一般 DB 保存不會自動改 CI。
7. **Git commit 存在、source bytes 與 commit 相符，不代表既有 `targetUrl` 正在服務該 revision。** 目前沒有把固定來源自動建置／部署到 target URL，也沒有目標服務 revision attestation。報告應保留 source snapshot 與實際 target URL，不能把未證實的對應當成已驗證版本保證。

## 已辨識的原測試 fixture 問題（後續已依批准修正）

### AC021 有效輸入遺漏原骨架 test

`tests/completion/support/database.ts:36` 的骨架建立 `test-a`、`test-b`、`test-a-extra`，`:42` 的完成版也引用該骨架。`tests/completion/support/workbench.ts:111` 以 `Boolean(p.extra)` 決定保存 spec 是否保留第三個 test，`:113` 的 mapping 同樣只在 extra 時保留。

`tests/completion/steps/workbench.steps.ts:1545` 的 AC021 保存只呼叫 `sut.save({kind:sut.vars.artifact})`，沒有 `extra:true`。因此 `spec.ts` 分支提出只有兩個 tests 的完成版，卻仍引用原三個 tests 的骨架並要求成功。這會違反已核准 SD 的「不得刪原 test IDs／映射」。產品應維持 `MAPPING_INVALID`，不能為這個輸入放寬驗收。

後續已按批准只調整 AC021 有效保存輸入，帶 `extra:true` 並保留三筆既有 mapping；錯誤映射 fixture 保留原用途，重新生成／檢查 implementation manifest 與收據。

### `vars.gherkin` 未初始化的純 fixture 缺陷

`tests/completion/support/workbench.ts:36` 的 constructor 初始化 `vars.feature=sourceFeature`，沒有初始化 `vars.gherkin`。`:130` 的 `save({kind:'gherkin'})` 仍只更新 `vars.feature`，沒有設定 `vars.gherkin`。

`tests/completion/steps/workbench.steps.ts:1841` 的 AC024 Given 在第一次 save 前已拿真 DB 的 `raw_text` 比 `sut.vars.gherkin`；此時後者為 `undefined`。AC021 Gherkin 分支的 `:1564` 及 AC024 Then 的 `:1869` 同樣引用此欄位；先 save 也不會補上它，因此這些斷言仍有相同 fixture 命名缺陷。

後續已按批准在 constructor 同時初始化 `gherkin:sourceFeature`，並在成功保存後同步 `vars.gherkin=raw`；上述斷言完全保留。這是 fixture 別名修正，不是允許移除斷言或更改驗收條件。

## 尚餘實作邊界與待驗證事項

- 解除正式 Chromium 下載限制後，須以相容版本與 `chromiumSandbox:true` 驗證實際 Screencast、WS／canvas 呈現、同 session 輸入、DOM 錄製邊界、跨頁／frame 行為、真重播、逐步與失敗截圖，再執行既有 44 案；不能以改 skip／替代瀏覽器／降低 sandbox 取代。
- 設定真 provider 並補足專案資訊後，須驗證 SD、缺資訊問題、完整 completion、來源 CAS、型別／discovery 與真 E2E；靜態語意檢查不是任意程式的完整業務證明。
- 原測試兩項 fixture 已取得限定批准並修正，重新產生 manifest 與回歸收據；其完整 UI 情境仍須 Chromium 恢復後執行。
- PTY 的階段目錄與最少環境不等於 OS 層隔離；目前只適用既有私有雲端工作區，同 UID 可跨目錄存取。不可直接把 shell／API 公開到公網，也不能宣稱 UI 階段鎖具有完整檔案安全隔離。
- 目前沒有證明任意既有 target URL 與 source commit 相同。若要提供該保證，仍需可檢查的目標服務 revision／啟動紀錄或另行授權的隔離建置與執行接線；本輪未自動部署。
- 受管初始 page 之外的 popup／新 context、原生視窗、複雜網站與 secret binding／遮罩流程仍需實際相容性驗證；不支援時應保留明確失敗或待補狀態。
- 最後一次整合必須重跑 check／build／test、刷新產品 source hashes，並再確認核准測試 implementation 未變；這些通過後仍只能報元件與 HTTP 驗證成功，產品 E2E 與真模型驗證分開回報。
