# 工作台架構與儲存界線

[README](../../README.md) · [操作](../operations.md) · [相容](../compatibility.md)

## 責任模型

工作台管理多個 Spec Repo 綁定；Project 以 `repositoryId + projectId` 定位。沒有全域產品工作區，也不要求使用者管理 Git 分支或提交。

```text
使用者編輯／儲存
  → SQLite 交易（設定、原文、修訂、確認、收據）
  → 已儲存；不呼叫 Git、不需要遠端連線

明確同步／測試／取得產品
  → 固定 SQLite 修訂
  → 受管理 Repo 輸出（衝突檢查）
  → 固定產品版本／隔離驗收／遠端同步
  → 獨立操作結果，不回滾已儲存資料
```

## 主要模組

| 模組 | 責任 |
|---|---|
| `packages/workstation/draft-store.mjs` | SQLite 內容、歷史、設定及收據的原子交易、樂觀並行控制 |
| `packages/workstation/authoring.mjs` | 設定、來源編輯、白話需求、需求／設計確認；不執行 Git 或 Repo 程式 |
| `packages/workstation/projection.mjs` | 已儲存修訂的 Repo 輸出、既有規格匯入、衝突檢查、執行產物回收 |
| `packages/workstation/flows.mjs` | 安裝授權、測試確認、隔離驗收及產品／Spec／報告同步順序 |
| `packages/workstation/store.mjs` | Registry、作業、檢查紀錄、驗收 metadata、schema migration |
| `packages/workstation/service.mjs` | 服務介面、讀取 SQLite、Worker 調度及目前驗收狀態 |
| `packages/git-core/` | 輸出及同步所需的 Git 工具，不是儲存引擎 |
| `packages/spec-toolkit/` | 規格契約、內容摘要、可攜工具、驗收候選與證據 |
| `packages/workstation/public/` | 唯一工作台入口、儲存／同步狀態、設定與階段流程 |

## SQLite schema 6

`spec_repositories` 保存綁定網址，不因連線失敗取消登錄。以下是需要備份的正式資料，不是可丟棄快取：

- `authoring_state`：每個綁定的目前修訂與設定。
- `authoring_files`：規格、SD、測試與產品文字編輯。`spec` 與 `project:<id>` 是不同命名空間，即使產品代號叫 spec 也不混淆。
- `requirement_proposals`：原始描述、生成前 Gherkin 及生成結果，按 repository 與需求編輯識別隔離；不授予確認。
- `authoring_history`：修訂原文、設定與儲存收據；每個操作 ID 只能代表同一份請求。
- `repository_preferences`、`operations`、`tooling_checks`、`runs`：站台偏好、持久操作、真實檢查與驗收紀錄。

`repository_projection` 記錄已輸出修訂、檔案摘要、Git 版本及同步位置，不取代 SQLite 原文。`report_index` 為可由 Git 重建的衍生索引。報告、截圖與 traces 保留在執行證據檔案中，SQLite 保存其執行及索引 metadata，不把大量二進位報告放進文字表。

## 儲存交易

一次儲存先檢查內容 hash，再在 SQLite `BEGIN IMMEDIATE` 交易中寫入內容、設定、遞增修訂、歷史及結果收據。任何寫入失敗整筆回滾。不同檔案的並行儲存可在修訂變動時重新讀取重試；同檔案 expectedHash 不符則拒絕覆蓋。

不呼叫 `git status`、`commit`、`fetch` 或 `push`。背景同步／驗收不佔用儲存鎖；它使用固定修訂，新編輯留在 SQLite 等下一次輸出。Worker 若在 SQLite 成功後、作業完成欄位更新前中斷，可從儲存收據恢復成功狀態，不把已保存的資料誤報為遺失。

既有檔案式 helper 在一次性暫存 view 中處理資料；view 從 SQLite 建立，異動最後才以單筆 SQL 交易提交。view 不是主要儲存位置，也不是產品 checkout。

## Repo 輸出與同步

Spec Repo 仍有 `spec/<REQ>/<feature>`、`tests/<REQ>/<feature>`、`reports/<REQ>/<feature>/<run>`，產品仍是 `projects/<id>` submodule。輸出時使用固定 SQLite snapshot，僅處理該 snapshot 的檔案，不夾帶其他 staged／unstaged 草稿。

已存在的檔案必須符合上次輸出／匯入摘要或本次預期內容。外部修改不同則暫停，回報「SQLite 已儲存、Repo 尚未更新」。原稿、資料庫內容與同步歷史都保留，不執行 hard reset、clean 或 Force Push。跨 Repo 不是單一交易，部分同步以回執分辨。

首次取得既有規格庫時讀入其內容；同名但不同的本機作者草稿不被遠端覆蓋。快轉取得的新資料會更新 SQLite；若同期已有新儲存，則保留本機新版本，不誤稱最新修訂已同步。

## 審核與驗收

需求、設計及測試仍需人類確認。需求／設計確認直接保存 SQLite；測試確認要通過真實生成及 discovery，必要依賴只有一次安裝授權。安裝新增的 lockfile 與測試確認只能回寫原先受審閱的修訂，不能覆蓋同期新草稿。

驗收把固定 SQLite 內容輸出成 source commit S，再從本機產品版本建立隔離候選，不要求先同步。報告 commit R 記錄受測 S，而不是聲稱 R 已被測試。歷史通過要與目前 SQL 的內容摘要、產品編輯及已輸出版本相符，否則過期。

## 安全與範圍

儲存與讀取不執行 Repo 設定程式。路徑、文字大小、symlink、私密檔案及跨規格庫存取有檢查。SQLite 與歷史可能包含敏感原文，備份必須保密。主機為 loopback 信任模型，沒有公開多租戶 ACL 或 OS sandbox；Agent、MCP、Terminal、錄製的新 UI 完整接線仍未全部提供。

## 兩區編輯資料契約

`requirements.mjs` 提供來源、格式草稿、結構診斷與成對儲存。`requirement-documents.mjs` 只做受限文字提取，不執行文件中的任何程式。既有檔案首次開啟不改寫；若沒有來源描述，僅上方留空。

正式 Gherkin 保存為 `spec/<REQ>/<feature>/<feature>.feature`；原始描述保存為同層 `requirement-source.json`，兩者在 `authoring_files` 與 `authoring_history` 的同一 SQL 交易更新，只有同步／驗收時才輸出到 Repo。後續確認的摘要綁定下方 `.feature` 而不是可隨時補充的來源素材。

生成採用明確標示的本機格式整理，不冒充語意推理。輸出使用 Feature／Scenario／Given／When／Then 及穩定案例標記；瀏覽器回歸另用固定版本的官方 Cucumber parser 驗證輸出。人工編輯的儲存路徑保留原始 bytes，不會因診斷失敗拒絕草稿保存。執行前的完整 BDD discovery 是另一個關卡。
