# BDD 軟體開發工作台：codegen 骨架版

本版只完成 **Gherkin → playwright-bdd → spec.ts 骨架與來源映射**，狀態為 **待 LLM 補齊**。沒有產品 server／Vue／DB 功能，也沒有 UI 操作、業務斷言、DB 驗證、截圖／報告的補齊實作。產品 E2E 為 **NOT_RUN**。

批准基準為 commit `40a4c0df3fddf37225d7b0975a94a206d66f98bb` 的 [feature](spec/REQ-WB-001/workbench.feature)（28 IDs／44 cases）與 [SD 0.4](spec/REQ-WB-001/SD.md)，原文/hash 固定。文件頭保留原快照文字；使用者最新確認與本次範圍記在 [review.json](spec/REQ-WB-001/review.json)。本次只授權第一個 codegen commit，沒有 push 或開始補齊／第二 commit 的授權。

## 重現命令

需要 Node.js 24。依賴鎖於 package-lock.json，不需要產品、LLM、DB、被測網站或下載瀏覽器。

```sh
npm ci --ignore-scripts --cache /tmp/bdd-npm-cache
npm run test:checks
```

各項檢查可分別執行：

```sh
npm run spec:generate
npm run spec:verify
npm run spec:list
npm run spec:typecheck
npm run test:tooling
```

底層實際呼叫 `BDDGEN_RAW=1 node_modules/.bin/bddgen test --config playwright.config.ts`。bddgen 9.2.1 原生輸出 JS；確定性 adapter 增加明確 test ID annotation 與 metadata 型別斷言，保存到 [generated/skeleton/REQ-WB-001/workbench.feature.spec.ts](generated/skeleton/REQ-WB-001/workbench.feature.spec.ts)。移除新增 annotation 並擦除型別後，必須與原生 JS 一致；來源行號保持不變。生成檔不要手改。

## 為什麼有 stub

playwright-bdd 需要註冊 step pattern 才能生成。tests/skeleton/registry.json 由批准 Gherkin 自動取得 pattern、參數位置與來源行號；它沒有操作 plan。skeleton.steps.ts 只註冊這些 pattern，執行時呼叫 pending.ts 並拋出 **UnimplementedStepError / PENDING_IMPLEMENTATION**。沒有空函式、skip 或永真業務斷言。

```sh
npm run test:skeleton:pending
```

這是負面殼探測，**預期 exit 1，1 failed、0 passed、0 skipped**，不是產品 E2E。只有骨架時不能標示驗收通過；`--list` 找到測試也不表示已實作。

## 可審閱證據與檔案

- [manifest](spec/REQ-WB-001/evidence/generation-manifest.json)：批准來源 hash、原生／TS 輸出 hash、codegen 輸入 hash、28 個 ID／44 個唯一案例與步驟映射。codegen 輸入只含 skeleton，不掃入後階段實作。
- [checks](spec/REQ-WB-001/evidence/check-results.json) 與 checks/*.log：bddgen、映射、44 tests discovery、型別、六項工具檢查，以及 pending 預期失敗探測的原始輸出。
- tests/skeleton/：純註冊與 pending stub；missing／negative.steps.ts 只供生成器缺漏／歧義負測試，正常設定不載入。
- tools/generate.mjs、verify.mjs、checks.mjs、tooling.test.mjs：可重現生成與工具驗證。
- playwright*.config.ts、tsconfig.json、package*.json、.gitignore：必要測試工具設定。

實際檢查：五個命令 exit 0；28 Scenario IDs、44 tests、174 個 pending patterns、319 個展開 step 匹配，缺漏／歧義 0；六項工具測試通過。重複生成的 spec 與 manifest 完全一致。這些都是 **codegen 工具結果**，不代表產品驗收通過。

## 後續階段

原完整補齊草稿、舊生成稿與目前工作稿已在原雲端工作區建立可恢復且逐檔驗證的備份，沒有放入此骨架版。此 commit 完成後停止；之後依使用者指示，LLM 才能以本骨架/hash 為來源建立獨立補齊快照與第二個 commit，保留本版骨架，不覆寫或混入第一版。

本 bdd 專案的文件與標準測試保存在 Git；每次需求的 feature、唯一 SD 與確認紀錄同置 `spec/<requirementId>/`，doc/ 只用 ADR，未新增 requirements.md 或其他 SD。
