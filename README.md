# BDD 工作台：可直接審閱的 TypeScript steps

沿用 [官方 playwright-bdd 9.2.1 教學](https://github.com/vitalets/playwright-bdd/blob/v9.2.1/docs/getting-started/write-first-test.md)：Gherkin → bddgen 生成 spec → runtime 執行已實作 steps。[generated/completed spec](generated/completed/REQ-WB-001/workbench.feature.spec.ts) 保持正常 Given／When／Then 呼叫；真正的操作、locator、SQL 與 `expect` 在 [workbench.steps.ts](tests/completion/steps/workbench.steps.ts)。不再使用 JSON plan／大型 switch interpreter。`sut.step()` 僅包裝來源識別與逐步證據，傳入的 callback 就是可閱讀的實作。

本修復以 `f8678bdc59dbcd582bb9cdb3cc8be4060a9e6efe` 為父版本，保留骨架 commit `95fb2960aa56cce22c17ad40b5cfa535da315a28` 及兩版歷史。批准 [feature](spec/REQ-WB-001/workbench.feature)／[SD 0.4](spec/REQ-WB-001/SD.md) bytes/hash、28 Scenario IDs／44 cases 不變。本輪只修測試，不實作產品或 push。

## 預設入口

```sh
npm run spec:generate
npm run spec:verify
npm run spec:list
npm run spec:typecheck
npm run test:tooling
npm run test:checks
npm test
```

`playwright.config.ts` 現在指向 completion.config.ts；直接 `npx playwright test` 也會載入補齊版。`npm test` 額外先檢查產品環境，缺設定時 exit 2 / NOT_RUN。直接 runner 在自動前置 fixture 報 ProductEnvironmentBlockedError，與未實作 stub 的錯誤不同。

骨架有獨立、明確入口：

```sh
npm run test:skeleton:list
npm run test:skeleton:pending
```

後者預期 exit 1／UnimplementedStepError，0 passed、0 skipped。它只證明骨架不假綠燈，不是產品 E2E。原生成器／套件腳本的完整歷史可在 95fb296 checkout 重現；不重跑去覆蓋保存的骨架 manifest／證據。

## 實作與審查

- 174 個直接 TypeScript step callbacks，保留所有情境／Examples／testKey 與來源步驟映射；共用 fixtures/helpers 管理 DB 前置、登入、SQL UI、版本保存與證據，沒有 runtime 指令表。
- AC005 用獨立完整／缺預期資訊 projects；AC015 實際 UI 保存拒絕、資料未變與編輯／執行入口鎖定；AC017～020 真實 DB UI A→B、重新登入、允許／拒絕、重跑還原與失敗圖。
- AC021 檢查重新開啟的實際 editor 值與所選文件關聯。AC028 的清單、精確兩個 tests、b 未執行、同 run/current test/session/context/page 的 JPEG／canvas／報告／圖片 hash 斷言直接放在 steps；SelectionProbe 僅觀察 WS/畫格與 managed page。
- [case-review](spec/REQ-WB-001/evidence/repair/case-review.json) 逐一列出 44 cases 的展開驗收文字、手動審閱的操作／oracle、實作行號、body hash 與追溯到的真正 assertion。這是程式審閱，不冒充產品行為已驗證。
- 分析器拒絕空 step、缺來源／結果斷言、pending、opcode dispatcher、JSON import 與 literal actual 的假斷言。單元測試包含這些拒絕案例；不能只因 pattern 非空、能列出或型別通過就固定完成。
- 額外的原生 bddgen runtime probe 讀取真實批准來源檔並斷言 hash：正例通過、故意給錯 hash 的反例失敗；另外驗證缺／歧義 step 拒絕生成、預設產品環境阻擋與骨架預期失敗。這些全部標為工具檢查。

## 狀態與證據

新的 [manifest](spec/REQ-WB-001/evidence/repair/generation-manifest.json) 引用來源殼與前版 completion/hash。generator 只產 COMPLETION_DRAFT 與實際掃描結果；[check-results](spec/REQ-WB-001/evidence/repair/check-results.json) 依完整檢查結果推導 TEST_IMPLEMENTATION_CHECKED／COMPLETED 測試程式狀態。產品執行狀態獨立記錄。

[執行探測](spec/REQ-WB-001/evidence/repair/runtime-probes.json) 區分工具正例／預期反例、ENVIRONMENT_BLOCKED 與 EXPECTED_UNIMPLEMENTED_FAILURE。[產品 E2E](spec/REQ-WB-001/evidence/repair/e2e-status.json) 維持 NOT_RUN；沒有產品成功報告或實際驗收圖片。測試工具 pass 不能取代產品 E2E。

官方 Chromium 安裝命令使用官方 cdn.playwright.dev，環境回覆 403 Domain forbidden，尚未取得執行檔，見 [browser-install](spec/REQ-WB-001/evidence/repair/browser-install.json)。未更換非官方來源、停用 sandbox 或加 --no-sandbox。實際 browser launch 固定 chromiumSandbox=true。

產品執行還需要真正工作台／被測網站、產品 migration 初始化的專用 DB、帳號密碼、固定 source ref 與可丟棄的 target Git/CI。完整 DTO、selectors、內部 managed runner 接線及官方來源在 [CONTRACT.md](tests/completion/CONTRACT.md)。首兩版證據仍保留原路徑並標原來源版本；本次檢查寫到 evidence/repair/。

Node.js 24；依賴鎖版未變。新 checkout 可 `npm ci --ignore-scripts --cache /tmp/bdd-npm-cache`。雲端備份位於 `/workspace/bdd-stage-snapshots/`，含修復前 f8678bd 快照；沒有移除舊完整草稿。已停在測試階段。
