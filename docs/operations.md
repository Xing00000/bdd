# 操作指南

[README](../README.md) · [架構](architecture/workstation.md) · [相容](compatibility.md)

## 部署與備份

使用 Node.js 24 與 Git。`npm start` 直接提供新工作台，不需要舊 UI build。預設網址 `http://127.0.0.1:4173/`，`WB_PORT` 可指定連接埠，`WB_HOME` 預設為 `~/.bdd-workstation`。

```sh
WB_HOME=/absolute/private/workbench \
WB_ENABLE_TRUSTED_EXECUTION=1 \
npm start
```

只在可信任、隔離的執行主機開啟此旗標。Git SSH agent 與 known-host 由主機設定。`WB_GIT_HOSTS` 控制允許的 Git host。`WB_ALLOW_LOCAL_GIT=1` 只供明確允許本機 Git remote 的環境，CI 使用它連接真實 bare remotes。

`PLAYWRIGHT_BROWSERS_PATH` 可共用受管理 browser binaries；未設定時工作台使用 `WB_HOME/browsers`。UI 可安裝 Chromium binaries，不會用 sudo 安裝 OS 套件；系統相依套件請先準備。其他 browser profile 可以在主機安裝對應正式版本。

停止舊程序及 workers，備份完整 `WB_HOME`、舊 metadata DB 與原證據，再啟動 schema 3。升級保留舊 Spec ID 與未提交 checkout 檔案；若 `workspaces/` 和 `repositories/` 同時存在，系統拒絕合併，需先保存並排除重複目錄。metadata 的升級備份不是完整工作目錄備份。

## UI 完整路徑

### 綁定與初始化

首頁「綁定 Spec Repo」填入名稱與既有 remote。空 remote 的分支欄留白。選擇 Repo 後按「取得 Repo」「初始化 Spec 結構」，再到「Git 與 Remotes」勾選初始檔案、輸入訊息、Commit。初始化遇到非空不相容 Repo 會拒絕，不覆蓋它。

第二個 Spec Repo 走相同流程，彼此的功能 ID、Projects 與執行紀錄獨立。產品不能直接加到工作台總覽。

### 加入產品與 remote

在 Spec Repo 的 Projects 頁按「加入 Project」，填產品 ID、產品 remote 與來源分支。來源分支解析到完整 SHA 並寫成 gitlink。回 Spec Git 頁審閱並提交 `.gitmodules`、`workbench.yaml` 與 gitlink。

Git 頁可選「Spec Repo」或該 Repo 的某個 Project；每個 Git 目標有自己的 remote 清單。新增／編輯 named remote 時，fetch URL 與 push URL 可不同；「Fetch 選取 Remote」不隱含 Merge，「Push 選取目標」先列出 SHA、remote URL 與遠端分支並要求確認。產品版本請先 Push，再 Push 包含新 gitlink 的 Spec 候選。

### 驗收環境與依賴

總覽選服務 Project，填入 loopback 目標網址、健康檢查網址、啟動 executable 與逐行 argv。健康檢查應回傳 `{ "commit": "<WB_SOURCE_COMMIT>" }`。Runner 會從 pinned Project 啟動服務，不把既有 port 的回應當成自己部署的版本。

按「安裝／更新測試依賴」：無 lockfile 使用固定的 npm install，有 lockfile 使用 npm ci，兩者皆忽略 lifecycle scripts。按「安裝 Chromium」安裝與規格庫 Playwright 版本相容的 browser binaries。設定與 lockfile 是要審閱、提交的來源。

### 需求到測試

建立 Requirement ID／Feature ID 與產品關聯。五階段每頁有文件、下一步及阻擋原因。依序保存及確認 Gherkin、SD，再編寫 steps／hooks。案例 ID 與 browser profile 可在「案例、瀏覽器與產品範圍」調整。

檢查測試接線會執行真正生成與 discovery，必須與配置中的案例集合一致。成功後才可確認測試基線；修改檔案後必須重檢。人工確認不會自動 Commit，也不宣稱產品通過。

### 產品開發與驗收

在 Projects 選產品。固定版本通常是 detached HEAD，按「此 Project 的 Git」建立開發分支，再回編輯器修改 UTF-8 產品檔案。保存時檢查目前內容 hash，拒絕覆蓋其他人剛改的內容。

產品 Commit → 明確 Push → Projects「固定目前產品 Commit」→ Spec Commit → Spec Push。回功能開發／驗收頁按「準備驗收候選」，在執行紀錄啟動真正測試。前置確認、dirty checkout 或產品版本不符會阻擋，畫面給出原因。

失敗也封存報告。修正產品後建立新 candidate／run；不能覆寫舊 run。通過只對應當次固定輸入。上游內容或產品改變後顯示過期，不延用舊 VERIFIED。

### 證據與發布

「檢視證據」顯示案例、瀏覽器、結果、斷言、逐步圖片、受測版本與下載連結。「建立報告 Commit」使用獨立 clone；「Push 報告分支」明確發布到 origin 的 `evidence/<run-id>`。R 與被測 S 不同，不改動 main。

其他機器先明確 Fetch，再「重建 Git 報告索引」。驗證不通過的 report 不當作有效證據。報告、截圖、logs 可能含敏感資料，Push 前需人工審閱。

## API 與腳本

API prefix `/repository-api/v1`。資源為 `/workbench`、`/spec-repositories`、`/spec-repositories/:id/projects/:projectId/files`、`/operations` 與各 Repo 的 run artifacts。不存在全域 Project 或舊 `/workspaces` API。

寫入使用 JSON、`X-Workbench-Request: 1`；Origin 出現時必須符合站台。操作輸入：

```json
{
  "schemaVersion": 1,
  "operationId": "OP-unique",
  "repositoryId": "SPEC-id",
  "operation": "git.commit",
  "expected": { "head": "<actual-full-sha>" },
  "input": { "paths": ["spec/REQ-001/login/login.feature"], "message": "Define login" }
}
```

Project Git 操作另外指定 `target: {"kind":"project","projectId":"product"}`，仍必須帶父層 repositoryId。`git.push` 可指定 `input.remote` 與 `input.branch`。所有 scripts 讀 stdin JSON、回 stdout JSON；不接受任意伺服器 cwd 或任意 shell。

`repository.clone`、`repository.initialize`、`repository.validate`、`repository.dependencies.install`、`repository.browsers.install`、`spec.tests.check`、`project.file.save`、`git.remote`、`submodule.*`、`run.*` 共用後端實作。舊 request 名稱只在儲存資料升級時轉換，不是持續存在的 API alias。

## 維護與相容檢查

維護頁提供工具升級預覽／套用、舊 DB 唯讀匯入與中斷續做。原資料匯入不重新批准來源，也不執行被封存的舊測試；參見相容文件。

```sh
npm run check:repository
npm run check:workstation
npm run test:workstation
npm run test:workstation:e2e
```

舊元件回歸使用 `npm ci`、`npm run spec:list`、`npm run check:unused`、`npm run check`、`npm run build`、`npm run test:app`。這些是相容性維護，不會啟動舊工作區作為正常入口。

UI 驗收測試會保存真實瀏覽器 trace、手機／桌面截圖、UI 發出的寫入請求與 Git 收據。基礎設施可以預先建立 Git 服務及 browser binaries，業務流程不得透過 API 或檔案預填來跳過 UI。
