# 工作台架構與 UI 模型

[README](../../README.md) · [操作](../operations.md) · [相容](../compatibility.md)

## 單一產品入口

`npm start` → `scripts/workstation.mjs` → `packages/workstation/cli.mjs` → HTTP／Worker／靜態前端。根路徑 `/` 提供工作台；不再先啟動 SQLite 文件工作區，也沒有「切回舊工作台」導航。

工作台是一個管理站台，不是一個產品 Repo。它登錄多個 `SpecRepository`。一個 Spec Repo 有自己的 checkout、Git remotes、requirements、features、product gitlinks、jobs 與 runs。`Project` 只可透過 `repositoryId + projectId` 定位，沒有全域 Project API。

## 主要程式責任

| 路徑 | 責任 |
|---|---|
| `packages/workstation/public/` | 主入口、Repo 導覽、階段流程、產品編輯、Git／Remote、證據與維護 UI |
| `packages/workstation/service.mjs` | Repository registry、Worker 調度、目前驗收有效性 |
| `packages/workstation/operations.mjs` | 明確命名操作、所有權與預期版本檢查 |
| `packages/workstation/repository-actions.mjs` | 產品文字檔案、案例／環境設定、固定依賴安裝、真實 discovery |
| `packages/workstation/store.mjs` | 操作 metadata、互斥、去重、schema migration、接線 receipt、衍生報告索引 |
| `packages/workstation/migrate.mjs` | 舊管理資料的單次遷移，不是第二套工作區模型 |
| `packages/git-core/` | Git argv、named remotes、指定路徑 Commit、Submodule、CAS 與 Push 核對 |
| `packages/spec-toolkit/` | 可攜工具快照、規格結構、內容確認、候選 clone、runner、報告封存 |
| `templates/spec-repo/v1/` | Repo B 範本；`.workbench-tools` 使用明確版本與 hash |

CLI 和 HTTP Worker 呼叫相同實作，不另寫一套 shell 行為。Repo B 不 import 正在開發的 `projects/bdd` 來取得工具。

## 資料模型與儲存

Operational schema 3 使用 `spec_repositories`，其他表以 `repository_id` 關聯。`tooling_checks` 固定目前測試輸入摘要的真實生成與 discovery 結果；這不是產品驗收結果。

```text
SpecRepository
 ├─ Git remote names + fetch/push URLs（Git config）
 ├─ ProjectBinding（workbench.yaml + .gitmodules + gitlink）
 ├─ Requirement / Feature / Review（Git 檔案）
 ├─ Operation / ToolingCheck（operational DB）
 └─ Run / Artifact / Publication（不可變證據與發布收據）
```

`WB_HOME/repositories/<repository-id>/repo` 是工作台管理的 Spec checkout，不是使用者管理的「產品工作區」。驗收使用 `executions/<run-id>/repo` 的獨立 clone，報告使用獨立 publishers clone。Spec Repo 裡的 `projects/` 才是產品。

Schema 1／2 升級前建立 `before-repository-model-v3.sqlite` 備份。原 ID、歷史 runs、operation 收據保留；舊 request 原文另存，新的標準形式使用 `repositoryId`。原本 `workspaces/` checkout 目錄改名為 `repositories/`，不刪除未提交內容；兩者同時存在則拒絕猜測合併。舊 seal／報告不改寫。

## UI 資訊架構

左側：工作台總覽 → 多個 Spec Repo → 所選 Repo 的 Projects。右側顯示 Repo 名稱、origin、branch、HEAD、dirty 狀態及 breadcrumbs。切換 Repo 時不帶入其他 Repo 的 Project、editor、feature、run 或 Git 操作目標。

Repo 功能依使用情境分成「總覽與環境」「需求流程」「Projects」「Git 與 Remotes」「驗收紀錄」「維護」。初次使用以取得 Repo、初始化、初始提交三個明確步驟引導；不是把所有 Git 按鈕一起丟給使用者。

功能頁使用需求、設計、測試、開發、驗收五階段。頁面說明現在的產物、下一個操作及阻擋原因；按鈕的視覺 disabled 不是唯一防線，後端重做相同來源／所有權／版本檢查。

## 來源與狀態推進

確認是 feature 的內容摘要，不是整個 Repo HEAD。Gherkin 改變使下游過期；共用 fixtures／設定／lockfile／toolkit 改變使測試確認過期；只有報告變動不影響來源確認。

Tests 的 UI 確認必須有目前 digest 對應的真實 `bddgen` 與 Playwright discovery receipt。零案例、重複案例或不同 browser matrix 不能確認。產品 assertions 是否通過由正式執行判定，不由接線檢查判定。

產品開發從固定 submodule 建立分支。產品 Commit／Push 與 Spec Commit／Push 分開；UI 的 Git 目標、Remote、branch 與 SHA 均在確認框明示。Named remote 有獨立 fetch/push URL；修改時檢查前次設定，Push 後讀遠端 ref 驗證，不使用 Force Push。

正式驗收固定候選 S、每個產品 commit、設定與執行環境。在同一 Repo／Feature 中，失敗 → 透過 UI 修正產品 → 提交／固定版本 → 新 run 通過，才是可驗證的開發推進。

## 證據完整性

Runner 產生事件、報告與逐步截圖；篩選案例不是全案驗收。產品部署須對應固定 commit。報告 R 記錄 `testedSpecCommit=S`，不宣稱 R 已被測試。發布不會改動開發中的 checkout 或 main 分支。

Git report reindex 可從已 Fetch 的 refs 恢復跨機報告，驗證 seal、內容 hash、身份、artifact 集合與祖先來源；衝突 run 身份隔離。驗收頁再次比對目前來源與 products；歷史 `VERIFIED` 不代表目前仍有效。

## UI 與執行安全

文件文字透過 textContent／textarea 呈現，HTML 報告下載不執行於管理 origin。編輯器拒絕 symlink、binary、secret/runtime 路徑；保存使用 expectedHash。離開 dirty editor 需要確認；失敗不丟棄原稿。

長任務有持久作業 ID、進度與取消。工作台只有一個 UI 正在操作的 job，後端則對每個 Repo 獨立互斥。取消到程序真正停止才放鎖。不是把非同步作業塞在 HTTP request 裡執行。

服務預設 loopback、程式執行預設關閉。受信任執行不是沙箱；系統級權限、網路、SSH 身分及瀏覽器系統套件由部署環境管理。沒有公開多租戶 ACL 或任意程式碼沙箱的承諾。
