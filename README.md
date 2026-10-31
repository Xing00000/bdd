# BDD 工作站

這個 Repository 是 **Repo A：管理站台與工具**。它管理獨立的 Spec Repo，不把被管理產品的規格、驗收測試與報告當成站台自己的資料。

```text
bdd（本站）
  └─ 管理 Spec Repo（例如 bdd-spec）
       ├─ spec/<REQ>/<feature>/                 規格、Gherkin、SD
       ├─ tests/<REQ>/<feature>/                Steps、Hooks、Fixtures
       ├─ reports/<REQ>/<feature>/<run-id>/     報告、截圖、Trace
       └─ projects/<project-id>/               產品 Git Submodule
```

**目前主線是 Git-backed 工作區。** 既有 SQLite 工作台的 Agent、MCP、Terminal、瀏覽器錄製與 DB 操作仍有實際使用入口，尚未全面遷移；不是可以直接刪除的死碼。兩套入口及保留原因見 [相容功能與清理邊界](docs/compatibility.md)。

## 啟動 Git 工作區

需要 **Node.js 24、Git**。獨立管理服務本身只使用 Node 內建模組，不需要先安裝舊 UI 的原生依賴。

```sh
npm run start:repositories
# http://127.0.0.1:4180/repositories
```

在頁面登錄 Spec Repo，依序執行 **Clone → 初始化 Spec 結構 → 新增 Project Submodule → 建立需求／Feature**。空 Repo 的分支欄位留白。初始化只接受空工作區，不覆寫已有檔案，也不自動 Commit 或 Push。

新增 Submodule 時提供完整產品 commit SHA。它的版本由 Git gitlink 管理；「還原固定 Projects」與「改成另一個 commit」是不同操作。

若需原有 Agent、MCP、錄製等功能，使用整合入口：

```sh
npm ci
npm run build
npm start
# http://127.0.0.1:4173；側邊欄「Git / Spec 工作區」連到 /repositories
```

整合部署需要完整 checkout，不能只複製 `dist/`。`npm start` **不會**自動把既有資料搬到 Spec Repo。

## 資料與執行安全

Git 工作站資料預設位於 `~/.bdd-workstation`，可用 `WB_HOME` 指定；舊工作台預設位於 `.workbench/`。兩者不是同一個資料庫。未提交文件、尚未發布的報告與遷移紀錄仍需備份。

測試程式執行預設關閉。完成隔離與信任設定後才啟用：

```sh
WB_ENABLE_TRUSTED_EXECUTION=1 npm run start:repositories
```

服務只綁定 loopback，沒有完整公開站台 ACL。工作目錄及子程序不是 OS 沙箱。不要將 API／Terminal 公開，也不要讓不受信任測試取得 Git Push 憑證。

## 常用操作與驗證

| 指令 | 範圍 |
|---|---|
| `npm run check:repository` | 檢查文件連結、npm script 參照、禁止提交的生成物 |
| `npm run check:workstation` | Git 工作站 JavaScript 語法 |
| `npm run test:workstation` | 真實 Git、SQLite、CLI、HTTP、升級、遷移與報告回歸測試 |
| `npm run test:workstation:e2e` | 真實 Chromium、Spec Repo／Submodule、BDD 與報告管理閉環 |
| `npm run check` | 整合站台 TypeScript／Vue 型別檢查；需先 `npm ci` |
| `npm run check:unused` | 生產 TypeScript 的未使用宣告／參數檢查；需先 `npm ci` |
| `npm run build` | 重建後端、測試與前端；清除已刪原始碼的舊編譯副本 |
| `npm run test:app` | 既有站台單元、整合及 UI 測試；需 build 與正式 Chromium |

CI 分別驗證工作站核心、真實瀏覽器閉環及整合站台；失敗不能轉成略過。通過這些檢查不代表所有歷史產品 Gherkin 都已重新驗收。`npm test`、`spec:*` 與 `test:checks` 目前仍屬舊驗收鏈，不是 Git 工作區的驗收狀態來源，詳見 [相容功能文件](docs/compatibility.md)。

## 原始碼導覽

| 位置 | 責任 |
|---|---|
| `packages/contracts/` | Repo B 設定與資料交換契約 |
| `packages/git-core/` | 共用 Git 操作與樂觀併發檢查 |
| `packages/spec-toolkit/` | Spec 結構、確認基線、Runner、證據與發布 |
| `packages/workstation/` | 站台服務、作業 Worker、SQLite 管理資料、UI、匯入／升級 |
| `scripts/git/`、`scripts/spec/`、`scripts/run/` | 呼叫相同核心的 JSON CLI 入口 |
| `templates/spec-repo/v1/` | 新 Spec Repo 範本；不是工作站自己的驗收來源 |
| `src/`、`ui/` | 仍使用中的整合／相容站台 |
| `tests/workstation/`、`tests/workstation-e2e/` | Git 工作站的回歸與瀏覽器測試 |
| `tests/unit/`、`tests/integration/` | 整合站台的既有回歸測試 |

`deploy/`、`dist/` 與工作台生成的 `.feature.spec.ts` 是可重建產物，不再提交重複副本。部署 SQL 的原始來源仍是 `src/adapters/sqlite/` 與 `tools/deploy.mjs`，使用方式見 [部署與資料保護](docs/operations.md#部署與資料保護)。既有批准的 Gherkin／SD 與測試實作沒有被刪掉或重新批准。

## 文件

[架構與資料流](docs/architecture/workstation.md) · [操作、設定、升級與報告](docs/operations.md) · [相容功能、移除範圍與遷移條件](docs/compatibility.md)

這三份文件是目前維護的說明。早期 v1／v2 迭代文件已由本版整合，舊內容可從 Git 歷史查閱，不再以互相矛盾的操作指南並存。
