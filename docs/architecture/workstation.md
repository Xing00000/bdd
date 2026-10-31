# 工作站架構與資料流

本文件描述目前實作；操作方式見 [操作指南](../operations.md)，尚未遷移的功能見 [相容邊界](../compatibility.md)。不把設計目標寫成已完成能力。

## Repository 所有權

| 邊界 | 原始來源 |
|---|---|
| Repo A：工作站 | 管理 UI/API、Git 工具、Runner、Schema、範本及工作站自己的程式測試 |
| Repo B：Spec Repo | 規格、Gherkin、SD、Steps、Hooks、Fixtures、報告與產品 gitlinks |
| Project Repo | 產品程式、建置與產品自己的程式測試 |

Repo A 不把 Repo B 加進自己的 Git 樹。工作站透過登錄的 Repo URL 管理獨立 checkout。

```text
UI / HTTP API ──→ Operation journal / Worker ──→ Application operations
CLI scripts ───→ 同一組 Operation API                    │
                                                       ├─ git-core
                                                       ├─ spec-toolkit
                                                       └─ migration / report indexing
```

CLI 不另實作一套 shell 邏輯。HTTP 不接受任意伺服器目錄或任意 shell command；執行設定只能在明確啟用的可信 Worker 環境中使用。

## Spec Repo 契約

```text
workbench.yaml
.gitmodules
package.json / package-lock.json
bdd.config.ts / playwright.config.ts
.workbench-tools/manifest.json            版本化工具快照與 hash
spec/<REQ>/requirement.yaml
spec/<REQ>/review.json
spec/<REQ>/<feature>/feature.yaml
spec/<REQ>/<feature>/<feature>.feature
spec/<REQ>/<feature>/<feature>.sd.md
tests/_shared/
tests/<REQ>/_shared/
tests/<REQ>/<feature>/<feature>.steps.ts
tests/<REQ>/<feature>/<feature>.hooks.ts
tests/<REQ>/<feature>/{fixtures,support}/
reports/<REQ>/<feature>/<run-id>/
reports/_runs/<run-id>/summary.json
projects/<project-id>/                    Git submodule
.generated/                              忽略提交
.runtime/                                忽略提交
```

`spec/`、`tests/`、`reports/` 使用相同 requirement／feature 身分。沒有執行就沒有正式報告；空目錄或生成成功不代表驗收通過。

`workbench.yaml` 管理 Project ID／path，`.gitmodules` 管理來源 URL，Git gitlink 管理固定 SHA。不再人工維護第二份產品版本鎖。Run manifest 記錄實際版本，是證據而不是另一份可編輯設定。

目前 `.yaml` 使用 **JSON 語法的 YAML 子集**；不支援任意 YAML。工具快照由本站封裝並列出 hash，Repo B 不 import `projects/bdd/src` 或執行中站台的內部模組。工具升級必須明確預覽／套用。

## 儲存與工作區

```text
WB_HOME/
├─ metadata.sqlite
├─ workspaces/<workspace-id>/repo/       可編輯 Repo B
├─ executions/<run-id>/
│   ├─ repo/                            固定候選版本的獨立 clone
│   ├─ scratch/                         安裝、編譯與 runner 暫存
│   └─ evidence/                        封存的不可覆寫證據
├─ publishers/<run-id>/repo/             獨立報告發布 clone
├─ report-cache/<cache-key>/             從 Git 重建的報告副本
├─ transactions/<workspace>/<id>.json    可恢復的檔案變更紀錄
└─ legacy-backups/<digest>.json          舊 DB 選取資料的匯出備份
```

規格、測試、確認與已發布報告以 Repo B 的 Git 內容為準。SQLite 保存 Workspace 登錄、Job、Run 與報告索引。報告索引可以重建，未提交工作、作業紀錄及尚未發布證據不能靠 Git 代替備份。

開發、正式驗收與發布不用同一個可寫 checkout。正式候選用獨立 clone，不依賴帶有 submodule 的 linked worktree 隔離。第一版不遞迴接受未驗證來源的巢狀 submodules。

## Git 操作契約

寫入請求包含 `workspaceId`、`operationId`、操作名稱、結構化 input，以及讀取時的 `expected.head`。可附 branch 與工作區 fingerprint；不符即拒絕，不能自動 reset 使用者工作。

同一工作區同時只能有一個寫入 Job。相同 ID／內容回傳既有結果；相同 ID／不同內容拒絕。指定檔案 Commit 使用隔離 index 與 ref compare-and-swap，保留未選取的 staged／unstaged 變更。`save`、`commit`、`pin`、`push` 是四個不同操作。

產品 commit 先在產品 Repo 完成並明確推送，Repo B 再記錄 gitlink。多 Repo 發布不是原子交易；失敗要從已知進度恢復，而不是 Force Push 回滾別人的歷史。

## 確認與驗收

Feature 的準備階段由確認內容決定：Gherkin → SD → Tests → Implementation。確認紀錄綁文件及依賴的內容 digest，不綁整個 Repo HEAD，因此只新增報告不會誤撤銷批准。

正式執行要求乾淨已提交的 Spec 候選、有效確認、真實依賴 lockfile，以及乾淨且符合 gitlink 的 Project checkout。流程如下：

```text
固定候選 S → 獨立 clone → 還原 projects → 安裝／建置／啟動
  → 完整 discovery → 指定案例與 profile 執行
  → 操作／斷言／逐步截圖 → 檢查輸入與部署版本 → 封存
```

每個 Feature 使用獨立測試 process，只載入全域、需求與自身的明確共用範圍。Case ID、profile、attempt 是證據識別的一部分。重複步驟不能共用一張圖片當作多筆證據。

VERIFIED 需要完整案例範圍、實際斷言與逐步證據、無 skipped／retry、輸入未變及可確認的部署版本。Selected cases 不授予完整驗收。沒有執行、測試失敗、證據不足、來源不明與發布失敗是不同狀態。

目前 managed service adapter 支援一個產品服務及 loopback health endpoint，要求回報與固定 SHA 相同的 `commit`，且測試 base URL 同源。單靠任意 URL 不能宣稱已驗收某個程式 commit；多服務部署證明仍未完成。

## 報告與發布

Runner 寫入本次專用 scratch，不將 Playwright 可清空的輸出根目錄指向歷史 `reports/`。封存 bundle 包含 JSON／HTML、原生報告附件、logs、events、截圖、trace、manifest 與 seal；驗證精確檔案集合及 hash。

測試固定的是 **S**。新增證據後的報告 commit 是 **R**：manifest 保存 `testedSpecCommit=S`，publication receipt 保存 R。不要求檔案包含它自己的未來 commit SHA。

Publisher 只在獨立 `evidence/<run-id>` 分支加入報告，Commit 與 Push 分開；不切換開發區、不覆寫前一次 run。報告發布失敗不改寫實際測試結果。CI 忽略純 `reports/**` push，避免報告觸發測試的循環。

重新索引從已 Fetch 的 Git refs 讀 blob，核對身分、seal、hash、檔案類型與大小，再寫入私有 cache。無需原機的執行資料。相同 requirement／feature／run ID 對應不同內容時隔離衝突。歷史成功結果只有仍符合目前確認與所有 Project SHA 才顯示 VERIFIED，否則顯示 STALE。

## 恢復與信任限制

取消作業先進入 CANCELLING，Worker／子程序結束後才釋放鎖。中斷的執行不能變成成功。升級／匯入逐檔保存原 hash 與預期內容，可續做但不是全檔案原子交易；若 HEAD 或人類編輯改變，阻擋恢復。

Loopback、路徑檢查、環境 allowlist、程序群組及 hash 都不等於多租戶 OS 沙箱，也不能證明惡意測試誠實或斷言完整涵蓋業務意義。公開 ACL、一般 Git merge／PR、自動 Agent／MCP 遷移、巢狀 submodule、多服務 attestation 與 LFS／object storage 不在目前完成範圍。
