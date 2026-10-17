# 多人協作 BDD 軟體開發工作台

目前階段：**Gherkin 規格審查，核准狀態 `pending`**。

請先審查 [Gherkin 規格](specs/workbench.feature)（31 個 Scenario ID、35 個展開案例）與 [需求索引](specs/requirements.md)。本分支只提交規格、審查說明與待審紀錄，沒有 SD、產品程式或執行測試結果。

## 本專案自己的開發流程

1. 在 Git 提交 Gherkin，使用者確認精確版本／hash。
2. 確認 Gherkin 後才產生 SD，寫入 Git，使用者確認精確版本／hash。
3. Gherkin 與 SD 都確認後，才開始實作與對應測試。
4. 變更已確認內容產生新版本，相關核准失效並重審。

本專案自身的規格、文件、核准證據與測試全部由 `Xing00000/bdd` Git 管理；不依賴尚未建成的工作台資料庫。人工確認必須由使用者明確提出，代理不能把提交、評論、逾時或沒有回覆當成批准。[目前審查紀錄](specs/reviews/gherkin-review.json) 只記 `pending`，不是核准證據。

## 要開發的產品

核心是多人協作與統一文件管理：組織／專案／成員角色、版本、評論／審核、衝突處理與 audit trail。產品內的人類流程也是 Gherkin → 人工確認 → SD → 人工確認 → 產生測試骨架與 LLM 補齊 → 開發 → 驗證與 E2E 報告。

兩種測試分別管理：

- 被開發專案的 CI 測試：存該 target repository，跟 branch／commit，由該 repo CI 執行。
- 使用者自建整合測試：定義存工作台 SQLite，保留 owner、共享權限、版本、目標環境與執行紀錄；執行快照可以匯出，但不偷偷同步進 target Git。

工作台本身的測試則跟本 repo Git，與上述產品功能分清。

MVP 以 TypeScript／Node.js／SQLite 為前提，實際連接專案 SQLite，預設唯讀瀏覽，DDL／DML 需精確計畫與獨立核准。瀏覽器需讓人類觀看並互斥接手同一 Playwright session，且能從網頁錄製可審查的腳本；PTY、瀏覽器及程式執行都必須隔離與授權。

noVNC 已排除。公開 Playwright Screencast 是目前候選方向，傳輸選型與效能尚未驗證；正式 SD 階段才比較與定案。不能把串流、輸入接管與腳本錄製視為同一功能；不能以 iframe 宣稱可操作任意網站。

## 審查方式與限制

逐 Scenario 提出同意或修改，並核對需求索引是否有遺漏。核准應指向實際 Git commit 與 feature SHA-256；修改後必須重新核對。若審查分支再變更，舊確認不能自動適用新內容。

本次只有檔案／案例 ID／需求映射／hash 的靜態完整性檢查；沒有執行這份 Gherkin、沒有產品驗證通過結果，也沒有部署。前一輪過早產生的未核准 SD／部分程式已隔離保留在雲端，不納入本規格提交，不能作為已確認設計。
