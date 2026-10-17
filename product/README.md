# BDD 工作台產品

這是依既有已核准 SD 0.4 與 REQ-WB-001 補齊測試實作的 Node.js 24／Vue 3／SQLite 初版。原核准文件、feature、測試 assertions 及根 package 保持原位；產品依賴由這個目錄的 package-lock 獨立管理。

已提供文件／階段 API、SQLite 原文與正規化資料、版本/hash 確認、失效與鎖定、多對一測試映射、真實 PTY／SQL、Git 指定 commit 副本與本地保存、真實 CLI discovery、測試執行／證據彙整、Vue 介面，以及可替換的 DB／LLM／runtime ports。

瀏覽器與 LLM 的程式接線已實作，但目前環境缺 Chromium 執行檔與 LLM provider 設定，尚不能宣稱瀏覽器串流／錄製、LLM 真補齊或 44 個產品 E2E 已通過。[已知阻礙](KNOWN-BLOCKERS.md)與[檢查收據](evidence/verification.json)有明確區分。

## 啟動

在 `/workspace/bdd`：

```bash
npm --prefix product ci
npm --prefix product run build
npm --prefix product start
```

服務只監聽雲端 `127.0.0.1:4173`，`GET /health` 可檢查。這是工作區服務，沒有部署到外部網址；`127.0.0.1` 指雲端環境，不是使用者電腦。使用平台提供的連接埠轉送時仍應保留私有存取；這個版本沒有另加 SD 明確排除的 ACL 子系統，不應直接把 shell/API port 公開。

本次依賴已在此雲端安裝，node-pty 透過官方 Node headers 編譯；`.npmrc` 把 npm/node-gyp cache 放可寫暫存目錄。build 自動建立已忽略的 `src/node_modules`、`ui/node_modules` 連結，輸出至 `product/dist`、`product/public`，不更改根測試套件清單。

預設 metadata：`.workbench/metadata.sqlite`；執行／圖片／暫存工作區：`.workbench/`。新建 metadata 由真實 SQLite worker migration 初始化；既有不相容資料庫會拒絕啟動，不清空使用者資料。瀏覽器不在安裝或啟動服務時自動下載。

## 專用驗收環境

```bash
npm --prefix product run init-fixtures
npm --prefix product run serve-fixtures
# 另開雲端 terminal
npm --prefix product run test:e2e
```

初始化只建立 repo 內 `.test-fixtures/` 的專用 metadata、target DB、target Git。測試網站是真實的 A/B 登入、SQLite 文件持久化及管理拒絕；它不是假工作台或成功回應 mock。既有 fixture 不重設，重跑可指定新的專用 fixture 目錄；請勿刪除使用者資料。

測試工作台位於 `http://127.0.0.1:4310`，目標網站 `http://127.0.0.1:4311`。fixture 密碼與環境檔保存在 `.test-fixtures/target-password`、`.test-fixtures/product.env`，權限 0600，未加入 Git；不會印出密碼。

`test:e2e` 先以 `chromiumSandbox:true` 真正檢查 browser 是否可啟動，再檢查 provider 與服務；缺條件即 exit 2／NOT_RUN，不啟動 44 案或改成 skip。條件足夠時才呼叫既有 `tools/completion/run-e2e.mjs`，仍受原 manifest、固定集合與證據 reporter 檢查。正式 E2E 輸出仍由既有 runner 產生，不以產品單元測試收據替代。

## LLM 與瀏覽器設定

LLM adapter 使用 HTTP Chat Completions 相容協定。設定 `WB_LLM_API_KEY`（或 `OPENAI_API_KEY`）、`WB_LLM_MODEL`，必要時設定 `WB_LLM_BASE_URL`（預設 `https://api.openai.com/v1`）。provider 必須明確選模型；沒有設定就回 503 `LLM_UNCONFIGURED`，不從 fixture 產出成功文字。憑證只放 server 環境，不放 Git、UI、terminal 或測試程序。

補齊輸入固定目前核准 Gherkin／SD、原骨架版本/hash、映射、同專案 step definitions/context 與目標 URL。輸出先經語法、pending/停用測試、ID集合、真實型別與 discovery 檢查；不通過就保存待補稿或回問題。骨架不覆寫，原 test IDs 不可刪或改映射。實作檢查成功仍不代表產品執行通過。

模型須支援本 adapter 使用的 `POST /chat/completions` 與 JSON object 回應格式；其他 provider API 需要另一個 adapter。金鑰透過 server 的私有環境／秘密管理機制注入，無需貼進對話。缺少業務預期、locator 或 fixture 時應補入專案 context，不能讓模型自行弱化已確認條件。長任務保存時會重驗起點文件 head 與確認版本；即使文字 hash 相同，換版仍須重新核對來源。

Chromium 必須使用與 Playwright 1.64.1 相容的正式發行版。此環境先前官方下載被 CDN 403 阻擋；本次沒有改用鏡像、其他瀏覽器或關閉 sandbox。解決環境下載限制後才能執行真瀏覽器驗證。

## 介面與生命週期

- domain／application 保存流程規則；SQLite、Git、generation、PTY、browser、runner 透過 ports/adapters 接入；Fastify 在 composition root 組裝，Vue 不持有 DB 憑證。
- 文件保存只解析原文；有效版本、投影、head 在同交易更新。確認綁版本/hash；回退使下游 baseline/run 失效並保留歷史資料。
- PTY 使用真 node-pty，工作目錄是對應階段的獨立子目錄，僅帶最少環境變數；PTY 並非 OS sandbox，執行安全依賴這個既有隔離雲端工作區。此版不聲稱能阻止同一雲端 UID 跨目錄操作。
- Browser adapter 使用同一受管 context/page、公開 Screencast JPEG、WebSocket 與 canvas；不使用 iframe 或 Trace Viewer 代替 live。原始 Playwright endpoint 僅供此私有環境內 managed fixture 接線，不放 UI。
- 網頁 recorder 產結構化 action、locator recipe、明確斷言及 TS；密碼改用 `WB_SECRET_*` 引用。錄製保存與需求基線、target Git CI 分開。停止會固定動作邊界，後續操作不回填。
- 保存版的 `executionConfig.secretBindings` 只放 `[{"alias":"WB_SECRET_…","secretRef":"已登錄參照ID"}]`。重播前由 server allowlist resolver 解析，只傳該版必需別名；缺參照即拒絕，原始值不存設定。預設 composition 只登錄 `target-fixture-password` 對應測試網站設定，其他秘密須以可信 resolver 擴充，不能以任意環境變數名稱取值。
- runner 以完整 test-list 精準選取同案例的全部 tests，固定 bundle/config/filter hashes；原文及 runtime materialization 各留 hash。run 結束關閉受管 sessions，服務關閉終止子程序、PTY 與 DB workers。
- 獨立重播初版僅對初始 managed page 提供完整逐步證據；新頁／popup 未完整支援時拒絕，不能顯示假通過。任意既有 Playwright API 的全面相容尚未驗證。

## 檢查與報告

```bash
npm --prefix product run check
npm --prefix product run build
npm --prefix product test
node product/tools/verify.mjs
```

`verify.mjs` 保留命令 logs 至 `.workbench/receipts/`，記錄產品原始碼 hashes，核對所有凍結測試 implementation hashes，輸出 `product/evidence/verification.json`。單元測試的 HTTP provider fixture、數值斷言或 browser-unavailable 拒絕測試都不是產品 E2E 通過證據。

執行報告：`GET /runs/:id/report`、`report.json`、`report.html`；逐步圖片 `GET /screenshots/:id`。Native HTML 位於該 run 的私有 artifacts 路徑。零測試、缺步驟／斷言／圖檔、未執行、失敗、失效或中斷皆不能 PASSED；SELECTED_CASES 即使通過，仍 `coverageComplete=false`，需求不能 VERIFIED。

Git 保存僅在明確操作時對目標 repo 建立本地 commit；CI 用固定 candidate commit 的 detached worktree，保存實際 tested commit／exit／輸出。獨立腳本或一般 DB 保存不寫 Git。這次新增產品 commits 未 push，也未部署。

CI 的 trusted checkout helper 逐檔核對 Git 原檔與固定 DB 定義的 bytes/hash，完整 discovery 與精準 test-list 一致後才呼叫專案測試命令；測試檔來自 checkout，設定及報告留在 run artifact 目錄。專案 CI 若不使用此配置／managed reporter，缺少實際事件與證據就不能通過。Git commit 解析尚不能證明既有目標 URL 部署的就是該 commit。

逐項完成度與原測試 fixture 差異見 [28 項驗收稽核](ACCEPTANCE-AUDIT.md)。
