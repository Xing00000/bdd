# 工作台架構與 UI 模型

[README](../../README.md) · [操作](../operations.md) · [相容](../compatibility.md)

## 單一產品入口

`npm start` → `scripts/workstation.mjs` → `packages/workstation/cli.mjs` → HTTP／Worker／靜態前端。根路徑 `/` 提供工作台；不再先啟動 SQLite 文件工作區，也沒有「切回舊工作台」導航。

工作台是一個管理站台，不是一個產品 Repo。它登錄多個 `SpecRepository`。一個 Spec Repo 有自己的 checkout、Git remotes、requirements、features、product gitlinks、jobs 與 runs。`Project` 只可透過 `repositoryId + projectId` 定位，沒有全域 Project API。

## 主要程式責任

| 路徑 | 責任 |
|---|---|
| `packages/workstation/public/` | 主入口、Repo 導覽、階段流程、產品編輯、儲存／同步、集中設定與證據 UI |
| `packages/workstation/service.mjs` | Repository registry、Worker 調度、目前驗收有效性 |
| `packages/workstation/flows.mjs` | 一次設定、局部儲存、自動版本、單次安裝授權、內容審核、驗收與遠端同步編排 |
| `packages/workstation/operations.mjs` | 明確命名操作、所有權與預期版本檢查 |
| `packages/workstation/repository-actions.mjs` | 產品文字檔案、案例／環境設定、固定依賴安裝、真實 discovery |
| `packages/workstation/store.mjs` | 操作 metadata、互斥、去重、schema migration、接線 receipt、衍生報告索引 |
| `packages/workstation/migrate.mjs` | 舊管理資料的單次遷移，不是第二套工作區模型 |
| `packages/git-core/` | Git argv、named remotes、指定路徑 Commit、Submodule、CAS 與 Push 核對 |
| `packages/spec-toolkit/` | 可攜工具快照、規格結構、內容確認、候選 clone、runner、報告封存 |
| `templates/spec-repo/v1/` | Repo B 範本；`.workbench-tools` 使用明確版本與 hash |

CLI 和 HTTP Worker 呼叫相同實作，不另寫一套 shell 行為。Repo B 不 import 正在開發的 `projects/bdd` 來取得工具。

## 資料模型與儲存

Operational schema 4 使用 `spec_repositories`，其他表以 `repository_id` 關聯。`tooling_checks` 固定目前測試輸入摘要的真實生成與 discovery 結果；這不是產品驗收結果。

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

## UI 與人工界線

首頁管理多個規格庫；產品隸屬於規格庫。一般畫面只顯示名稱、儲存／同步狀態與可操作的下一步，不要求使用者閱讀 branch、SHA 或 gitlink。詳細來源保留在診斷與報告，沒有被刪除。

首次表單集中收集規格庫位置、確認者、產品來源及啟動方式。系統執行 Clone／初始化／初始版本／產品綁定。四個工作頁為需求流程、產品、驗收紀錄、設定；不再有日常 Git 操作頁。

| 人需要決定 | 系統需要完成 |
|---|---|
| 規格庫與產品是哪個、如何啟動 | 取得來源、建立結構、自動記錄本機版本 |
| 需求意圖、設計與驗收條件是否正確 | 檢查接線、鎖定輸入、判定是否可推進 |
| 首次授權目前定義的必要安裝 | 安裝依賴＋瀏覽器、保存 lockfile、續行 |
| 何時分享、衝突如何選擇 | 安全同步、依序上傳、核對回執 |

儲存、同步、準備候選、執行、保存報告不重複彈確認框。移除的是機械操作，不是內容批准、安裝授權或衝突保護。

## 語意交易與版本

`repository.save` 原子替換當前檔案，使用隔離 index 只記錄該檔案；產品未附著分支時自動建立受管理的本機編輯分支，隨後記錄父層 gitlink。跨檔案／Repo 不是單一原子交易；失敗保留來源並回報，不假稱儲存完成。未選取的 staged 內容不進入儲存版本。

`repository.sync` 先檢查目的地與無衝突歷史，再依序同步產品、Spec 與獨立報告分支。只允許無分歧的快轉，不自動解衝突。不用 Force Push。每步寫入同步收據，部分成功可辨認。

`workflow.review` 保留三個人類內容審核，點擊即確認，不額外再問。測試階段自動安裝檢查與真正 discovery，通過才確認。目前依賴摘要未授權時回 INSTALL_REQUIRED，附套件與瀏覽器清單；一次授權後接續同操作。安裝完成的 receipt 記錄依賴及執行檔，環境未改變不重問。

`workflow.verify` 使用已儲存來源一次完成候選、執行及本機報告保存。候選中的產品直接從受管理本機 checkout 複製固定 commit，不必事先上傳。整個過程不改寫遠端。報告的 R 與受測 S 仍嚴格區別。

確認仍綁定 feature 內容摘要。Gherkin 改變使下游過期；共用測試／設定／lockfile／toolkit 改變使測試確認過期；只有報告變動不影響來源確認。第一次解依賴時新增的 lockfile 在安裝授權下記錄，人工測試來源不能被安裝命令默默更換。

## 證據完整性

Runner 產生事件、報告與逐步截圖；篩選案例不是全案驗收。產品部署須對應固定 commit。報告 R 記錄 `testedSpecCommit=S`，不宣稱 R 已被測試。發布不會改動開發中的 checkout 或 main 分支。

Git report reindex 可從已 Fetch 的 refs 恢復跨機報告，驗證 seal、內容 hash、身份、artifact 集合與祖先來源；衝突 run 身份隔離。驗收頁再次比對目前來源與 products；歷史 `VERIFIED` 不代表目前仍有效。

## UI 與執行安全

文件文字透過 textContent／textarea 呈現，HTML 報告下載不執行於管理 origin。編輯器拒絕 symlink、binary、secret/runtime 路徑；保存使用 expectedHash。離開 dirty editor 需要確認；失敗不丟棄原稿。

集中設定保存於 `repository_preferences`；它包含確認者、核對過的同步目標與最後同步回執，沒有帳密。Schema 4 的此表為 additive migration，既有 ID 與內容不重寫。

長任務有持久作業 ID、進度與取消。工作台只有一個 UI 正在操作的 job，後端則對每個 Repo 獨立互斥。取消到程序真正停止才放鎖。不是把非同步作業塞在 HTTP request 裡執行。

服務預設 loopback、程式執行預設關閉。受信任執行不是沙箱；系統級權限、網路、SSH 身分及瀏覽器系統套件由部署環境管理。沒有公開多租戶 ACL 或任意程式碼沙箱的承諾。
