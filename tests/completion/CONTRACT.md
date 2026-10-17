# REQ-WB-001 補齊測試接線

此檔是測試 fixture／DTO／locator 接線說明，依 SD 0.4 §8～12 細化；不修改 feature 或另建 SD。產品尚未實作，這些 endpoints、UI 與 managed runner 接收端仍須在產品階段提供。沒有用測試 server、route fulfill、假 DB 回應或 provider 成功文字替代產品。

## 快照與執行

- 來源：commit `95fb2960aa56cce22c17ad40b5cfa535da315a28`，28 IDs／44 cases；原 feature、SD、generated/skeleton、tests/skeleton、原 config／套件與原工具證據保持原 bytes。
- 本版 `generated/completed/` 載入 tests/completion，44 個明確 testKey 與來源 case／step 不變。manifest 固定來源殼 spec／manifest／bundle hash 及全部實作檔 hash。
- active step 的 174 個精確 patterns 都有具體 plan；unsupported operation 直接 throw。沒有 active pending、skip、空 callback 或永真斷言。database.ts 中的明確未實作文字只用於 AC005／028 的「產品收到 SKELETON」輸入 fixture，不是本版 runner 的 step stub。
- 工具檢查、型別、discovery、reproduction 與產品 E2E 狀態分開。正式執行入口為 tools/completion/run-e2e.mjs。缺前置條件在啟動 Playwright 前停止，exit 2 / NOT_RUN。

## 專用環境與 fixture

必須提供 WB_BASE_URL、WB_TARGET_BASE_URL、WB_METADATA_DB、WB_TARGET_DB、WB_TARGET_PASSWORD、WB_SOURCE_REF、WB_TARGET_REPO。前兩個是真實工作台／被測網站；metadata DB 必須由產品 migration 初始化成 SD0.4 schema。DB／target Git 都只能指向 repo 下 .test-fixtures/ 的專用資料，metadata 檔名必須 .e2e.sqlite。target repo 是可丟棄、含可執行 CI 的專用 repo；測試不 push。target DB／網站要先具備 SD §12 test_accounts、test_documents 與 scenario_user 密碼，沒有在此階段建造被測網站或產品 migration。

FixtureDatabase 僅安排隔離的 Given 前置資料。當受測保存／確認／補齊／流程／SQL 操作開始後，使用真實 UI/API；不能直接改 SQLite 假裝產品完成操作。角色 A/B 的變更、重查、重登入、文件保存與拒絕管理頁驗證均由 DB UI／被測網站進行。歷史 FAILED run 只是 AC016 的失效前置資料，不當成本輪執行證據。工具 unit test 在專用暫存 DB 執行 SD DDL，以核對 fixture 的欄位與 FK；它不是產品 migration 或產品 E2E。

每個 scenario 配置獨立 project/requirement ID；44 tests 使用一個 worker，避免共用 scenario_user 的角色與登入互相干擾。多使用者讀取用另一 BrowserContext。測試初始 fixtures 會占用專用 DB，重跑可使用全新 DB fixture；不清除使用者的資料。

## HTTP DTO

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

自錄 POST recordings 成功回 id/versionId。錄製 start／stop 回 actions；保存版本重播回 runId，報告含 scriptVersionId，獨立腳本 scope=INDEPENDENT。Git CI 同時保留 candidate_commit 與 tested_commit；tested commit 可以是實際 merge commit，不能直接要求它等於候選 commit。

## Managed runner 內部接線

這是 SD 的 BrowserSession／TestRunner adapter 接線，沒有新增產品人工關卡。fixture 模組 managed-runner.ts 由 nested spec 的絕對路徑 import；產品匯出 bundle 時保留／提供這個版本及 hash。runner 的 request baseURL 為 WB_BASE_URL，傳入真實 WB_RUN_ID 與目標環境變數；同一 Playwright minor 版本的 launchServer／connect 才相容。

1. GET /internal/runs/{runId}/tests/{testKey}/execution-context 回 runId、testDefinitionId、sourceCaseId、testKey、sourceSteps（來源行號→真實 step ID）、app／db attachment、dbUiUrl。app/db 各含 sessionId/contextRef/pageId/playwrightEndpoint。
2. application-managed context 以 init script 在每頁安裝 `globalThis.__workbenchManaged={sessionId,contextRef,pageId}`，新導覽保持該 page 的識別。這是自有 fixture resolver marker，不是 Playwright 公開 object ID。resolver 遍歷 contexts/pages，必須恰有一個完整 tuple 匹配；不假設第一個或只有一個 context。
3. POST /internal/runs/{runId}/events 接收 SD 的 event envelope。runner capture 先發 run.browserBound，回實際單調遞增 bindingSeq；每次 action/assertion 發 run.stepFinished，附 expected/actual/status 與真實 PNG bytes/base64/hash/moment。接收端依固定 run/test/case/step 及 selection 驗證、存 artifacts；圖片成功不推翻原 assertion 錯誤。run.testStarted／completed 由產品 TestRunner 發送並保存。
4. GET /internal/browser-sessions/{sessionId}/attachment 只供內部驗證程序回 Playwright endpoint；UI 只有 session tuple 與畫格。遠端 browser.close() 解除 client 接線；session/context/page 的銷毀仍由產品生命週期管理。

WS 的 run.testStarted 事件帶 runId/testKey。browser.frame 先送 JSON envelope（完整 binding tuple 及 payload.sha256/viewportWidth/viewportHeight），下一個 binary frame 為真實 JPEG。右側 canvas 的 data-* 保存目前**已呈現**畫格 tuple 與 frameSha256。測試同時驗證 JPEG hash、canvas 解碼像素、current viewer-binding、managed page 及 DB case_result；晚到舊 tuple 不算本次 live 證據。此處是即時串流，沒有用 iframe、Trace Viewer 或另開 URL 冒充。

## UI locator 綁定

固定 data-testid 供測試定位；可調整實際排版，不改 feature 含義。

| 區域 | 主要 test IDs／行為 |
|---|---|
| 文件／流程 | workflow-stage、gherkin-editor、sd-editor、spec-editor、confirm-gherkin、confirm-sd、generate-sd、generate-tests、complete-tests、test-readiness、start-development、stage-allowed-artifacts、stage-locked-artifacts、confirmed-gherkin、confirmed-sd、test-baseline、step-definitions-upload、generated-spec-source/path、generated-manifest、llm-needs-input。 |
| 鎖定保存嘗試 | open-artifact-save 開啟保存候選對話；artifact-save-kind 選文件；artifact-save-candidate 收候選原文；artifact-save-attempt 實際送保存；artifact-save-error 顯示「此階段不可修改該產物」。候選不是有效文件編輯，locked editor 保持鎖定。AC015 檢查 UI 提示及原 DB/投影/來源不變，也檢查真實 409。 |
| 回退 | return-artifact 選 artifact 中文 label，return-stage 送回退；之後 UI 與資料庫 stage 一致，重新確認前不能前進。 |
| DB | sql-editor、sql-run、sql-execution-state、db-results、db-schema-refresh、db-schema。 |
| PTY | open-terminal、terminal-session-id、terminal-input、terminal-output。測試輸入的命令只含 base64 token，輸出必須出現解碼後 marker，避免把 shell echo 當程序輸出。 |
| 瀏覽器／錄製 | browser-canvas、browser-url、browser-session-id、browser-stream-state、record-start/stop、recording-state/script/purpose、record-locator、record-assertion-type、record-expected、record-add-assertion；自錄輸入真的經 canvas pointer/keyboard 送至 managed page。 |
| 情境執行 | scenario-tests；scenario-case-a/b 各含 case-test-ids、case-readiness、case-execution-status、case-select、case-run；run-selected-cases、source-ref、pin-source、pinned-source-ref、run-browser-canvas。後者 data-run-id/test-definition-id/case-result-id/session-id/context-ref/page-id/binding-seq/frame-sha256 必須對應已呈現 frame。 |
| 被測網站 | login-username/password/submit、logout、account-role、document-content/save/saved、manage-accounts-link、access-denied。A 唯讀，B 可編輯但管理頁拒絕；拒絕前後帳號資料以改 B 後為比較基準。 |
| Git／獨立腳本 | save-to-target-git、run-target-ci、ci-state、ci-run-id、script-purpose；recordings 路由重新打開固定保存版本。 |

## 證據與限制

StepEvidence 包裝公開 Playwright page／locator／input 與 expect，逐操作／斷言截圖，保留預期／實際值、source line、test/case、session/context/page。同步斷言與失敗也加入附件；失敗截圖出錯不吞原 assertion。Playwright HTML／JSON 與 evidence-chain.json 由真實執行生成。Reporter 對空集合、少測試、重複 ID、skip、缺 assertion／steps／截圖或失敗拒絕全綠，即使 Playwright 最終 status 看似 passed 也回 failed。

AC028 檢查 selected a 的兩個 tests 全執行與回傳，b 沒有本 run case_result、清單 NOT_RUN；兩個所選 tests 都須有可驗證的 live 畫格與同 run 步驟／圖片。SELECTED_CASES passed 仍 coverageComplete=false，需求維持 VERIFICATION。

工具測試使用 dependency doubles 檢查 resolver／reporter 的拒絕規則，與產品 E2E 分開；未執行產品就沒有產品通過證據。沒有瀏覽器下載、產品 build、server/Vue/正式 DB adapter、部署或 push。

官方 API：
[BrowserType.connect](https://playwright.dev/docs/api/class-browsertype#browser-type-connect)、[Browser.contexts](https://playwright.dev/docs/api/class-browser#browser-contexts)、[Test list](https://playwright.dev/docs/test-cli#test-list)、[TestInfo.attach](https://playwright.dev/docs/api/class-testinfo#test-info-attach)、[Reporter.onEnd](https://playwright.dev/docs/api/class-reporter#reporter-on-end)、[Playwright fixtures](https://playwright.dev/docs/test-fixtures)。此版未使用私有 Playwright context/page IDs。
