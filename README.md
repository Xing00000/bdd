# BDD 軟體開發工作台：LLM 測試補齊版

本版在已推送的純骨架 commit `95fb2960aa56cce22c17ad40b5cfa535da315a28` 上，完成 **28 Scenario IDs／44 cases 的測試程式補齊**。產品尚未實作，產品 E2E 為 **NOT_RUN**；沒有以工具檢查成功宣稱產品驗收通過。

[workbench.feature](spec/REQ-WB-001/workbench.feature) 與 [SD 0.4](spec/REQ-WB-001/SD.md) 維持已核准的原文/hash。文件頭的歷史快照文字不改寫；最新確認與本階段授權在 [review.json](spec/REQ-WB-001/review.json)。本次只做第二個本地測試 commit，不 push 或進入產品開發。

## 兩版快照

| 階段 | 位置與狀態 |
|---|---|
| Codegen skeleton | [generated/skeleton/](generated/skeleton/REQ-WB-001/workbench.feature.spec.ts)、tests/skeleton/、原 generation-manifest 與工具證據保持原 bytes。執行 stub 預期明確失敗，狀態 PENDING_COMPLETION。 |
| LLM completion | [generated/completed/](generated/completed/REQ-WB-001/workbench.feature.spec.ts) 載入 tests/completion/ 的操作、斷言、fixtures、逐步截圖與報告。相同 44 個 testKey／來源 case，不刪除或改寫原骨架。 |

[補齊 manifest](spec/REQ-WB-001/evidence/completion/generation-manifest.json) 固定來源 skeleton commit／spec hash／manifest hash／bundle hash、feature／SD hash、全部實作檔 hash 與 test／step 映射。原套件、config 與生成器輸入保持不變，因此沿用已鎖定的測試依賴，不另安裝依賴或下載瀏覽器。

## 重現與檢查

Node.js 24；全新 checkout 可執行 `npm ci --ignore-scripts --cache /tmp/bdd-npm-cache`。補齊版命令：

```sh
node tools/completion/checks.mjs
```

依序檢查來源殼完整性、真正 bddgen 生成、完整映射、Playwright --list、TypeScript 與九項工具測試。工具測試會重新生成並要求 spec／manifest 完全一致；原殼／文件／工具證據的 29 個固定檔不得改變。沒有產品也能執行這些工具檢查。明確的回歸結果保存在 [check-results](spec/REQ-WB-001/evidence/completion/check-results.json) 與同目錄 checks/*.log。

```sh
node tools/completion/generate.mjs
node tools/completion/verify.mjs
node node_modules/@playwright/test/cli.js test --config completion.config.ts --list --reporter=list
node node_modules/typescript/bin/tsc --noEmit -p completion.tsconfig.json
node --import ./tools/completion/register-ts.mjs --test tools/completion/tooling.test.mjs
```

第一版的 npm scripts 仍保留。它的舊 test:checks 會重寫第一版歷史 log，應在該 commit 的獨立 checkout 重現；本版 checks 只將新證據寫入 evidence/completion/。生成檔不要手改。

## 實際補齊內容

- 174 個精確 patterns／319 個展開 step 都有非空操作計畫；UI/API、文件版本／SQLite 投影、Git commit、PTY 真實輸出、錄製與重播都使用產品及專用 fixture。
- AC005 在同一原情境內使用兩個獨立 project：完整 Gherkin／SD／context 須真正完成；缺預期資訊的 Gherkin／SD／骨架不得含 expected 值，須留下 questions 與待補狀態。兩者都不得改上游。
- AC015 真正從 UI 送出保存候選，檢查畫面提示、HTTP 拒絕及原文／投影／來源未變。AC016 透過 UI 退回階段。
- AC017～020 經 DB UI 改 A→B、重查、登出／重登入，驗證 B 編輯與管理頁拒絕；拒絕前後帳號比較以改 B 後為基準，重跑先還原 A／initial。故意失敗的 nested fixture 要留下實際 A/B mismatch 及 failure 圖。
- AC028 從真實情境清單選 a，核對本 run 完整集合為 test-a／test-a-extra，test-b 不執行且 NOT_RUN；檢查兩個 tests 的同 run/current test/session/context/page、JPEG 與 canvas 像素及每步圖片/hash。局部通過維持 coverageComplete=false，不使全案 VERIFIED。
- managed resolver 依完整 session/context/page marker 找恰好一頁，可有多個 contexts。沒有採 contexts()[0]、iframe 或 trace 冒充 live。
- StepEvidence／managed runner 保存操作與斷言圖片、實際／預期值與失敗。Reporter 對空集合、部分執行、重複 ID、skip、缺斷言／步驟／圖片拒絕假綠燈；截圖失敗保留原 assertion 錯誤。

詳細 DTO、selectors、內部 runner 接線與必要產品能力見 [測試接線契約](tests/completion/CONTRACT.md)。這些是供產品實作對齊的測試介面，尚未有對應 server/Vue/DB adapter 實作。

## 產品 E2E 尚未執行

```sh
node tools/completion/run-e2e.mjs
```

必須先提供真實工作台、被測網站、產品初始化的專用 metadata/target DB、測試帳號、來源版本與專用 target Git/CI。當前這些前置條件未配置，入口在瀏覽器或測試啟動前停止：**exit 2／NOT_RUN**，見 [e2e-status](spec/REQ-WB-001/evidence/completion/e2e-status.json)。沒有實際產品 E2E 截圖或成功報告。

產品存在後，真正執行才會生成 `playwright-report/completion/` HTML、`test-results/completion/playwright.json` 與 `evidence-chain.json`。目前僅固定完成測試程式快照；工具通過不能取代這些執行證據。

原完整舊稿、pre-codegen 工作樹與開始補齊前的 95fb296 快照均在 `/workspace/bdd-stage-snapshots/` 可恢復；不將舊 27／43 manifest 冒充本版。此 repo 的 feature、唯一當次 SD、確認紀錄與標準測試仍保存在 Git，doc/ 只供 ADR。
