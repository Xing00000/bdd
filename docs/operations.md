# 操作、升級與資料保護

[README](../README.md) · [架構](architecture/workstation.md) · [相容邊界](compatibility.md)

## 入口與設定

| 設定 | 用途／預設 |
|---|---|
| `WB_HOME` | Git 工作站私有資料，預設 `~/.bdd-workstation` |
| `WB_REPOSITORY_PORT` | 獨立站台 port，預設 4180；固定 loopback |
| `WB_GIT_HOSTS` | 允許的遠端主機，預設 `github.com`，逗號分隔 |
| `WB_ALLOW_LOCAL_GIT=1` | 允許本機 Repo 路徑，供可信開發／測試使用；預設關閉 |
| `WB_ENABLE_TRUSTED_EXECUTION=1` | 允許執行 Repo 程式，僅限可信隔離環境；預設關閉 |
| `WB_LEGACY_DB` | 舊資料唯讀匯入來源；獨立站台必須明確設定 |
| `WB_LEGACY_ARTIFACTS` | 舊截圖允許讀取的根目錄 |
| `PLAYWRIGHT_BROWSERS_PATH` | 已安裝、版本相符的瀏覽器位置 |

整合站台沿用 `WB_ROOT`、`WB_PORT`（4173）、`WB_BASE_URL`、`WB_METADATA_DB` 與 `WB_DATA_ROOT`。整合入口預設把自己的舊 DB／artifacts 提供給唯讀遷移工具；不會自動匯入。

Git 設定刻意忽略主機 global/system config。SSH 使用可信主機的 agent 與 known-host 設定；v1 尚未整合 HTTPS 私有 Token provider。不要把密碼放入 URL、Git 設定檔、截圖或 logs。

## 初始化 Spec Repo

登錄 Repo → Clone → 初始化範本。來源 Repo 是私有時，先在執行主機配置可用認證。空 Repo 不指定尚不存在的 branch。建立 Feature 後，三個平行目錄使用同一組 REQ／Feature ID。

Repo B 自己安裝依賴與生成 lockfile，不能借用站台的 `node_modules`：

```sh
# 以下在 Spec Repo 執行，不是在工作站 Repo。
npm install
npx playwright install chromium
# 審查並提交真正生成的 package-lock.json。
```

Repo B 的 `bdd:validate`、`bdd:generate`、`bdd:list`、`bdd:test` 是 portable toolkit 預覽入口。CLI 使用形式如下；這些不是 Repo A 的 npm scripts：

```sh
node .workbench-tools/spec-toolkit/cli.mjs validate
node .workbench-tools/spec-toolkit/cli.mjs generate REQ-001 login
node .workbench-tools/spec-toolkit/cli.mjs list REQ-001 login
node .workbench-tools/spec-toolkit/cli.mjs test REQ-001 login
```

初始化產生的步驟會明確拋錯，直到實作真實操作與斷言。預覽不是正式 VERIFIED。

## CLI 與 HTTP

`node scripts/workstation.mjs help` 列出支援操作。CLI 讀 stdin JSON，stdout 回傳一份 JSON；診斷放 stderr。

```sh
printf '%s' '{"id":"WS-bdd","title":"BDD Spec","remoteUrl":"git@github.com:Xing00000/bdd-spec.git"}' \
  | node scripts/workstation.mjs register
printf '%s' '{"workspaceId":"WS-bdd","operationId":"OP-clone-1"}' \
  | node scripts/git/clone.mjs
printf '%s' '{"workspaceId":"WS-bdd"}' \
  | node scripts/git/inspect.mjs
```

後續寫入使用剛讀取的 `expected.head`，空 Repo 的 HEAD 是 null。產品 Git 操作附 `target: {"kind":"project","projectId":"bdd"}`，而非傳任意伺服器目錄。

| 範圍 | 操作 |
|---|---|
| Workspace | clone、initialize、validate |
| Git | fetch、branch、commit、push；不隱含 merge 或 Force Push |
| Submodule | add、restore、pin、remove |
| Spec | feature.create、file.save、review.confirm |
| Run | prepare、execute、publish |
| 維護 | upgrade.preview／apply、transaction.resume、legacy.preview／import、reports.reindex |

HTTP 前綴為 `/repository-api/v1`。寫入要求 JSON、`X-Workbench-Request: 1`，有 Origin 時必須同源。長任務回 202 與 operation ID；查詢 `/operations/<id>` 取得結果。瀏覽器關閉不等於取消。

## 正式驗收與報告

依序確認 Gherkin、SD、Tests，提交產品與 Spec candidate，然後準備 Run。執行前開啟可信 Worker 設定。工作區必須乾淨，所有引用的 SHA 必須可取得。

Run 的測試結果、驗收有效性與發布狀態分開顯示。先檢查 logs／截圖是否含機密，再明確建立報告 commit／Push evidence 分支。Git 儲存上限目前為單檔 32 MiB、整份 256 MiB，未實作 LFS 或自動秘密偵測。

跨機器先明確 Fetch，再點「從已 Fetch 的 Git 版本重建報告索引」，或用 `scripts/run/reindex.mjs`。預設檢查 HEAD、local evidence refs、origin evidence refs。可傳 `input.refs` 指定既有 refs；不隱含 Fetch、不切分支、不覆寫 dirty 檔案。

## 工具升級與中斷恢復

先執行 `workspace.upgrade.preview`（`scripts/spec/upgrade-preview.mjs`），審查檔案與 hash，再以 `input.planDigest` 執行 `workspace.upgrade.apply`（`scripts/spec/upgrade.mjs`）。Apply 要求乾淨的 Spec checkout；只變更受管理工具，不覆寫 authored specs/tests/config/lockfile。

工具有本地修改或未知檔案會阻擋。升級後 Tests 確認失效，需要重新審查。操作只保存工作區，不自動 Commit／Push。

中斷後用 `workspace.transaction.resume`（`scripts/spec/resume.mjs`）及原 transaction ID。HEAD 必須相同；每個檔案只能仍是原內容或預期新內容。人類後續修改會造成衝突，不能為了完成作業將它抹掉。

## 舊 DB 匯入

```sh
WB_LEGACY_DB=/absolute/path/metadata.sqlite \
WB_LEGACY_ARTIFACTS=/absolute/path/artifacts \
npm run start:repositories
```

先預覽所選 legacy requirement IDs，再傳 preview digest 與 `acknowledgeUnverified: true` 套用。HTTP 呼叫者不能指定任意 DB 檔案。來源 SQLite 以唯讀 transaction 讀取，不修改。

Gherkin／SD heads 與文件歷史保留原文；舊測試封存為 `.ts.txt`，新的 executable steps 明確阻擋執行。Case ID、Project binding、hooks 需要人工重接。舊確認不啟用，舊 PASSED 不等於新 VERIFIED。缺少 SHA 或截圖就保留未知／警告，不補造證據。

匯入前保存的是**所選資料匯出備份**，不是整個 DB 的完整備份。文件內仍可能有使用者寫入的秘密，提交前需審查。已存在的目標 Requirement 不合併或覆蓋。

## 部署與資料保護

`deploy/` 是舊整合站台 **metadata DB 的可重建 SQL bundle**，不是 Git 工作站 operational DB 的 schema。原始來源只有 `src/adapters/sqlite/`、`tools/deploy.mjs`、`tools/migrate.mjs` 與 `tools/dbgate.Dockerfile`。不要手改 SQL 副本或把生成結果當成另一套 schema。

```sh
# 在工作站 Repo 執行，會先 build，再生成 deploy/。
npm run deploy
node deploy/migrate.mjs /absolute/path/metadata.sqlite
# 已有資料庫升級必須提供全新的備份路徑。
node deploy/migrate.mjs /absolute/path/metadata.sqlite --backup /absolute/path/before.sqlite
```

`deploy/` 不再版本控制。要部署離線環境，先在可信的建置環境生成完整 bundle，再一同搬運 `manifest.json`、SQL、runner 與 README。Runner 在開啟 DB 前核對 SQL hashes／版本；有資料的 DB 不可省略備份。DDL／DML 是檢視檔，執行完整 migrations 才能保持交易順序；seed 由應用程式依 key 套用，不手動重跑。

Git 工作站的 `WB_HOME/metadata.sqlite` 由 `packages/workstation/store.mjs` 管理 schema。目前 schema 2 additive migration 保留既有 workspace／operation／run。不要對它執行上述舊站台 deploy bundle。

升級前停止相關寫入並備份兩種 DB、未提交工作區、未發布 evidence 與 transactions。不要刪除 `.workbench/`、`WB_HOME` 或 `.test-fixtures/` 來清理原始碼。

## 清理與重建

`npm run build` 會先移除 compiler-owned 的 `dist/src`、`dist/tests`，避免已刪除的 TS 留下可執行 JS；Vite 管理 `dist/public`。這不會清除任何 DB 或受管理 workspace。

舊工作台的 generated spec 由 `npm run spec:generate` 重建；`spec:list` 與 `test:tooling` 的前置腳本也會生成。Git-backed Repo B 的 `.generated/` 則由它自己的 portable toolkit 生成。兩者不能混用。

`npm run check:repository` 用 Git 的 tracked 檔案清單防止衍生物重新被提交，並驗證維護文件的相對連結及工作站 npm script 名稱。它不將「沒有靜態 import」的 Worker、reporter、CLI、MCP stdio 誤判為死碼。
