# 退役與相容資料

[README](../README.md) · [架構](architecture/workstation.md) · [操作](operations.md)

## 已退役的產品入口

舊「全域產品／SQLite 文件工作區」不再是工作台產品模型。`npm start`、`src/main.ts` 與 `/` 都進入新 Spec Repo 工作台；沒有舊站切換連結，也不掛載舊 `/requirements` 或 `/projects` HTTP routes。

依 2026-11-02 的單一入口要求，`ui/` 的 Vue 畫面、Vite 設定與前端相依套件已移除；build 清理舊 `dist/public`，`src/http/server.ts` 不再註冊 SPA、靜態檔案或 HTML fallback。正式網站只由 `packages/workstation/public/` 提供，沿用 `npm start` 與既有 `?repo=...&view=features&feature=...&stage=...` 網址。

`src/application/`、SQLite migrations、Codex／Copilot adapter、MCP、錄製及資料庫 API 保留。這些是共用後端／相容性測試來源，不是第二個網站；例如 `/projects` 可回傳 API JSON，但不會回傳 Vue HTML。不能把保留 API 宣稱為所有舊控制項都已遷移到正式畫面。

原 Vue 整合測試中的 sibling／stage／baseline／Agent／PTY／預設範例持久化斷言，改由同一個真實 API 與 runtime 執行，沒有刪除測試案例或放寬資料斷言。已移除元件的版面、Vue 選單與頁籤 selector 不再是產品契約；正式畫面改由 `tests/chat-ui` 與 `tests/workstation-e2e` 驗證。純畫格綁定與座標邏輯移至 `src/domain/browser-binding.ts`，既有斷言保留；退役 viewer 的輸入程式只以 `tests/fixtures/retired-viewer-input.source.txt` 保存為固定協定測試資料，不包含可建置的網站入口，也不冒充目前 UI 的瀏覽器驗收。

## SQLite authoring（schema 5）

設定、草稿、內容確認與產品編輯改存 SQLite。日常流程只有建立功能與人工驗收完成時建立 Git checkpoint，期間讀取、儲存、開發與測試都使用本機內容。舊 checkout 原文第一次唯讀匯入，不把 clean 工作目錄當作儲存前提。主資料庫、歷史原文和未同步內容必須備份，不能只靠重新 Clone 恢復。

低階 Git／遷移 helper 保留相容測試用途；它們修改 checkout 不代表已更新新的 SQL authoring。正式 UI 的儲存只有一套 SQL 交易路徑。

## 管理模型遷移

Operational DB schema 4 保留 schema 3 的轉換，新增 `repository_preferences` 保存一次設定及同步收據。尚未設定的舊登錄只需完成集中設定，不重建 checkout。

原 Operational DB 的 `workspaces` 登錄資料實際代表以前加入的 Spec checkout。Schema 3 明確改為 `spec_repositories`，其 jobs、checks、runs 與 report index 以 repository ID 關聯。原 ID 保留；原 operation request 另存，轉換後標準格式用 repositoryId。這是一次遷移，不是繼續開放舊工作區 API。

舊 checkout 目錄 `WB_HOME/workspaces` 改名為 `WB_HOME/repositories`，保留 git refs、未提交文件與本機產品內容。舊 run evidence/seal 不重寫，讀取 ownership 時辨識舊欄位。遷移 journal 的舊 root 僅接受同一個受管理 checkout 的舊位置，不允許任意路徑。

## 原始文件與測試資料

舊 SQLite documents 可透過明確配置的 `WB_LEGACY_DB` 唯讀匯入；原文、歷史與可驗證圖片保留，舊完成／PASSED 狀態不轉成新確認。原測試先存為文字，需人工映射到新的 tests/REQ/feature 與產品。

`spec/REQ-WB-001` 仍是原工作台的歷史驗收契約與 codegen／BDD mapping 測試資料，尚未搬到使用者的 `bdd-spec`。它不是新 Repo 模板，也不代表目前工作台的完整功能來源。移除 UI 不改寫其歷史情境或宣稱舊畫面驗收仍通過；`npm run spec:generate`／`spec:verify`／`test:tooling` 保留工具相容性檢查。`npm test` 與 `npm run test:e2e` 統一使用正式工作台的 Playwright 設定，報告只有 `workstation` 產品入口。

原 generated workbench spec 及 deploy 副本已不提交。`npm run spec:list`／`npm run test:tooling` 會先生成；canonical SQLite migrations、seed 與 `npm run deploy` 的來源保留。MCP 的 annotated spec 尚無可完全重建的生成器，因此暫不當成可刪副本。

## 仍未宣稱完成

新工作台目前是 loopback 的可信任單機管理服務，沒有公開多租戶 ACL 或 OS sandbox。設定為 JSON-compatible YAML，暫不支援任意 YAML 語法。Nested submodule、多個服務同時部署的來源證明、Agent／MCP／Terminal／錄製在新 UI 的完整工作流程仍需後續實作與獨立驗收。

這些限制不能以「舊工作區還能做」包裝成新產品已支援。正式入口不暴露第二套模型；保留來源是為了可驗證遷移，而不是叫使用者在兩個站台之間完成同一個需求。

## 防止退化

`check:repository` 阻擋生成副本、過期文件與不存在的 npm 指令；`check:unused` 檢查生產 TypeScript 中的未使用宣告；Build 清除失效的編譯輸出。原有相容性測試仍執行，不用刪測試讓新的 UI 變更看似成功。

## 日常 UI 的機械操作已退役

Git 操作頁、分開 Clone／初始化／Commit／Push／pin、獨立套件及瀏覽器安裝、接線檢查、準備候選與報告發布按鈕均不再是主流程。低階 API／CLI 保留供維護；正式 UI 只送出 setup、save、sync 與 workflow 語意操作。原有元件回歸仍保留，瀏覽器驗收改為使用新操作並檢查未同步先驗收、安裝取消與一次同意續行。

## 需求編輯器改版

舊多欄位 guided／quick-create UI 已移除，正常入口只有來源描述與 Gherkin 兩區。舊 `.feature` 不重寫，`workflow.create`／`workflow.draft` 保留為舊程式呼叫相容層，不是新 UI 的流程。SQLite schema 6 保留舊 authoring 與確認紀錄，只新增可恢復的生成歷史。


## 延後來源初始化與歷史回歸

新綁定與位置設定不再自動取得遠端，來源初始化延後到建立功能；既有 SQLite 草稿與已取得來源保留。歷史版本的明確取得、整庫回歸與同步仍提供維護用途，不由一般頁面讀取觸發。歷史單功能報告持續可用；工作樹測試以 `sourceKind: WORKSPACE` 及內容摘要識別，舊報告的實際 commit SHA 不改寫。自動通過不授予人工驗收，仍須明確按「驗收通過」。

工作樹報告須以 `specSourceDigest` 證明完整 Spec source 與目前內容一致。缺少此欄位的 WORKSPACE 報告保留為歷史，但需重新驗證才能人工驗收；既有 commit-based 報告仍沿用原契約。此摘要包含功能目錄外的 helper，排除工作台管理的衍生紀錄，避免新增驗收紀錄使其自身失效。

## Copilot ACP 傳輸

聊天設定的 `copilotExecutable`／`copilotArgs` 保留，指向 ACP server 啟動器；預設仍使用專案鎖定的 `@github/copilot`。工作台固定加入 `--acp --stdio`，拒絕會改回 headless、prompt/TUI 模式或覆寫工具權限的參數。舊自訂設定若包含這些選項，請移除衝突參數後重試；不會偷偷改用其他傳輸。Codex thread 與 SQLite 原始訊息保留。ACP 對外部模型的延遲仍取決於供應商，不將本機協定測試當成效能量測。

## Codex SDK 任務執行

Agent runtime 明確分為 `codex-sdk` 與 `custom-cli`。新設定預設 SDK，保存 `model`、`maxAttempts`、`timeoutMs`；自訂 CLI 保存 command／args 及執行限制。未標示 runtime 的舊資料只對精確 factory Codex 命令與參數套用 SDK 遷移，其餘保留自訂 CLI。既有版本原始 JSON 不重寫，讀取與派工使用同一份有效設定解析，凍結中的任務不被新設定改寫。

SDK 任務與聊天共用 Copilot 連線設定，但聊天的 app-server 與歷史資料不換成 SDK。SDK 沒有 app-server 的 compact 或即時插話介面，新增文字排入後續回合；不要把 SDK 結構事件宣稱為逐 token 串流。官方 SDK 仍需原生 Codex 執行環境，缺少 sandbox 能力時會明確失敗，不取消 sandbox 或改用 Copilot 工具執行。
