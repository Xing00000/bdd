# 相容功能與清理邊界

[README](../README.md) · [目前架構](architecture/workstation.md) · [操作指南](operations.md)

## 本次移除什麼

| 移除內容 | 為何可以移除 | 保留的原始來源 |
|---|---|---|
| `deploy/` 的 33 個已提交檔案 | 都是 DDL／DML、runner、seed、manifest、Dockerfile 或說明的生成副本；可完整重建 | `src/adapters/sqlite/`、`tools/deploy.mjs`、`tools/migrate.mjs`、`tools/dbgate.Dockerfile` |
| `spec/REQ-WB-001/workbench/workbench.feature.spec.ts` | 已有受追蹤的生成器，不應靠舊生成結果讓 discovery 看似正常 | 原 `.feature`、`.steps.ts`、testing helpers、`tools/bdd/generate.mjs` |
| 早期 `docs/architecture/git-workstation-v1.md` 與 `git-workstation-v2.md` | 一份說未實作、一份說已完成，不能繼續作為平行的目前操作說明 | 本次整合的 README、架構、操作與相容文件；歷史仍在 Git |
| 未使用的 imports、局部變數、phase map 與內部 adapter 參數 | 已確認無資料流用途；移除並更新呼叫點 | 原有有副作用的驗證呼叫仍保留 |

沒有刪使用者資料、沒有刪任何人工編寫的 Gherkin／SD、沒有修改其批准 hash，也沒有減少測試案例或用刪測試來掩蓋失敗。

## 為什麼不是刪掉所有 `src/`、`ui/`、`tools/`

目前它們仍被整合入口 `src/main.ts` → `src/http/server.ts` 使用。舊功能尚未全部接上 Git-backed model，單純刪除會造成實際功能退化。

| 保留範圍 | 實際使用者／入口 | 移除前提 |
|---|---|---|
| SQLite document／workflow model | 原需求頁、確認、generation、runs、遷移來源 | 已完成 Git-backed 替代流程與資料轉移驗證 |
| `src/adapters/generation/` | 原 Agent proposal／completion validation | 新 Agent 路徑具備相同來源、格式與確認規則 |
| `src/adapters/mcp/` | HTTP MCP 與 CLI stdio bridge | 新 MCP API／會話隔離完成；實際使用者完成切換 |
| `src/adapters/runtime/` | Terminal、live browser、錄製、DB 操作 | 新入口具備等效功能與回歸測試 |
| `src/adapters/git/`、`runner/` | 原文件候選／replay／target CI | 替換呼叫點及行為測試，而不是只刪 adapter |
| `ui/` | 原 Agent 設定、流程、錄製等介面 | 全部使用中的頁面完成替換 |
| SQLite migrations／seed | 既有資料庫安全升級及部署 | 不能只因版本較舊就刪 migration history |
| `src/fixtures/`、相關工具與測試 | 實際 UI／資料庫整合測試 | 對應新測試與可重建環境已完整取代 |
| `skills/playwright-bdd/SKILL.md` | Agent seed／generation 的固定內容 | 替代版本與批准流程完成 |

**沒有靜態 import 不等於沒用到。** Worker、reporter、MCP stdio、CLI 及瀏覽器入口可能由檔案路徑、設定或子程序啟動。本次盤點包含這些入口、npm scripts、測試與動態路徑。

## 舊驗收鏈的定位

`spec/REQ-WB-001/` 是本站原有整合工作台的驗收來源，不是新 Spec Repo 的模板。它尚未搬到 `bdd-spec`；新產品一律依 `templates/spec-repo/v1/` 的平行結構建立。移除原始來源必須先完成可驗證搬遷，不能把還沒搬的測試當成已淘汰。

原 `.feature`、`.sd.md`、`.steps.ts`、review 記錄與 hooks/helpers 保留。SD 內的舊描述是被批准的歷史契約，本次不悄悄改寫或重新批准它；目前架構以維護文件為準。

MCP 的 `.feature.spec.ts` 暫時仍保留：它含額外的 test ID annotations，目前沒有相同的受追蹤再生成工具可以重建全部內容。不能只看副檔名就刪掉這份尚未可重建的測試。它不是新的 portable toolkit 或新的 Spec Repo 生成物。

以下指令仍是舊驗收／相容檢查，**不是** Git-backed 工作區的正式驗收：

```sh
npm run spec:generate    # 核對批准來源，從原 Gherkin 重建測試與 manifest
npm run spec:list        # 先生成再 discovery；不依賴已提交的舊 generated spec
npm run test:tooling     # 先生成再測工具接線
npm run test:checks      # 映射、型別、生成、工具正反例；不代表產品 E2E
npm test                # 舊產品驗收；缺環境或有效 receipt 即 NOT_RUN
npm run verify          # 舊元件檢查及來源綁定；不代表產品 E2E
```

舊驗收環境使用 `init-fixtures`、`serve-fixtures`、`test:e2e`，需要正式 Chromium、CLI Agent、DbGate 與專用 DB。這些能力沒有因新工作站 CI 通過就視為全部已驗收。

## 維護準則

刪除模組前必須檢查 runtime imports、動態檔案引用、CLI、npm scripts、tests、build/deploy 與設定；先替換必要入口，再刪實作。生成物移除後，CI 要從乾淨 checkout 重建，不能靠本機舊 `dist/` 或已生成檔案通過。

目前的 `check:repository` 會阻擋移除過的 generated 副本重新提交、失效的維護文件連結與不存在的 npm 指令；`check:unused` 對生產 TypeScript 檢查未使用宣告／參數。文件不硬編寫「最新通過案例數」作為驗收證明，請以該 commit 的 CI receipt 為準。
