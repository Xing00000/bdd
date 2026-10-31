# 退役與相容資料

[README](../README.md) · [架構](architecture/workstation.md) · [操作](operations.md)

## 已退役的產品入口

舊「全域產品／SQLite 文件工作區」不再是工作台產品模型。`npm start`、`src/main.ts` 與 `/` 都進入新 Spec Repo 工作台；沒有舊站切換連結，也不掛載舊 `/requirements` 或 `/projects` HTTP routes。

原 `ui/`、`src/application/`、`src/http/server.ts` 等保留為尚未全面遷移之 Agent、MCP、錄製與資料庫能力的相容來源／回歸測試。它們不被正式工作台入口載入。不能把這些功能宣稱為已完成新 UI 接線；本次完整 UI 驗收涵蓋規格庫、產品開發、驗收與 Git 發布流程。

## SQLite authoring（schema 5）

設定、草稿、內容確認與產品編輯改存 SQLite，Repo 僅是綁定與同步／驗收輸出。舊 checkout 原文第一次唯讀匯入，不把 clean 工作目錄當作儲存前提。主資料庫、歷史原文和未同步內容必須備份，不能只靠重新 Clone 恢復。

低階 Git／遷移 helper 保留相容測試用途；它們修改 checkout 不代表已更新新的 SQL authoring。正式 UI 的儲存只有一套 SQL 交易路徑。

## 管理模型遷移

Operational DB schema 4 保留 schema 3 的轉換，新增 `repository_preferences` 保存一次設定及同步收據。尚未設定的舊登錄只需完成集中設定，不重建 checkout。

原 Operational DB 的 `workspaces` 登錄資料實際代表以前加入的 Spec checkout。Schema 3 明確改為 `spec_repositories`，其 jobs、checks、runs 與 report index 以 repository ID 關聯。原 ID 保留；原 operation request 另存，轉換後標準格式用 repositoryId。這是一次遷移，不是繼續開放舊工作區 API。

舊 checkout 目錄 `WB_HOME/workspaces` 改名為 `WB_HOME/repositories`，保留 git refs、未提交文件與本機產品內容。舊 run evidence/seal 不重寫，讀取 ownership 時辨識舊欄位。遷移 journal 的舊 root 僅接受同一個受管理 checkout 的舊位置，不允許任意路徑。

## 原始文件與測試資料

舊 SQLite documents 可透過明確配置的 `WB_LEGACY_DB` 唯讀匯入；原文、歷史與可驗證圖片保留，舊完成／PASSED 狀態不轉成新確認。原測試先存為文字，需人工映射到新的 tests/REQ/feature 與產品。

`spec/REQ-WB-001` 仍是原工作台的歷史驗收契約，尚未搬到使用者的 `bdd-spec`。它不是新 Repo 模板，也不代表新工作台的功能來源。沒有默改已批准的 hash 或刪除作者寫的情境來掩蓋缺口。

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


## 自動綁定載入與歷史回歸

新綁定即建立目錄、取得既有內容及報告，不再等到「第一次測試」才下載。既有未載入的綁定會顯示「載入需求與歷史」，不刪除 SQLite 草稿；無法取得遠端也不阻擋日常儲存。歷史單功能報告持續可用，新增的整批回歸報告使用相同平行目錄並增加總摘要。回歸未授予人類確認、不更動目前產品分支，既有單功能驗收行為保留。
