# BDD 工作台

工作台綁定多個 Spec Repo；產品隸屬各 Spec Repo 的 `projects/`。**SQLite 儲存設定、需求、設計、測試草稿、人工確認與產品編輯；Git 是綁定、同步及固定驗收版本的輸出，不是按下儲存的前置條件。**

## 開始使用

使用 Node.js 24。在本機啟動：

```sh
npm start
# http://127.0.0.1:4173/
```

只有這一套工作台入口。舊 `ui/` Vue 網站與 Vite 建置已移除；`npm run build` 編譯共用後端並清除失效的舊前端產物，不會再建立第二個網站。`npm test` 直接驗證正式工作台；共用後端與 API 相容性測試使用 `npm run test:app`。

先填規格庫網址與確認者。綁定會建立專屬本地目錄，自動取得既有需求、設計、產品與歷史報告，顯示就緒後開始工作；連線失敗則保留綁定並顯示原因。儲存不會 Clone、查詢遠端、要求乾淨 checkout 或建立 commit。離線、遠端憑證錯誤、工作目錄有草稿時，仍能儲存到 `WB_HOME/metadata.sqlite`。

**直接 `npm start` 就能確認測試並執行驗收，無須另外設定環境變數。** 伺服器只監聽本機 `127.0.0.1`；只有按下確認／執行，才會啟動對應的測試程式。首次需要安裝測試套件與瀏覽器時仍會詢問同意，不會偷偷安裝或代簽審核。

若要在不信任的環境中**停用測試執行**，才使用 `WB_ENABLE_TRUSTED_EXECUTION=0 npm start`（也接受 `false`／`off`）。主機仍須提供 Git、遠端憑證與瀏覽器系統相依套件；本機網頁服務與測試子程序不構成作業系統沙箱。

## 需求頁：只用上下兩個編輯區

聊天室位於左側「對話」，按「新對話」直接在中間開啟獨立頁籤，不需輸入名稱；第一則訊息會自動成為對話標題。訊息原文、狀態與 Codex thread 對應保存於同一份 `WB_HOME/metadata.sqlite`；關閉頁籤不刪除紀錄。首次使用聊天前執行 `npm install`、`npm run build`。Codex（`@openai/codex`）與 Copilot（`@github/copilot`）都由專案依賴安裝，預設不依賴全域 CLI；GitHub Copilot 須先登入並具有模型權限。執行檔、模型及逾時可在「對話設定」調整。

聊天由 Codex 管理上下文，經文字 adapter 呼叫 Copilot。目前提供文字回覆，不支援工具呼叫或附件，回答完成後顯示全文。Codex 壓縮不刪除原始聊天訊息；失敗或重啟中斷會保留明確狀態。

上方 **Gherkin** 是一直展開的正式規格編輯區，下方 **需求描述** 可直接打字或按「上傳文件」匯入。按 **LLM 生成 Gherkin** 會先預覽可修改的 Prompt，送出後才以設定的 CLI 生成草稿；新需求也能直接生成。沒有功能名稱、角色、條件或案例 ID 等額外必填欄位，名稱由 Gherkin 的 Feature 自動取得。

修改需求描述不會覆蓋 Gherkin。重新生成前的原稿與 CLI 生成提案保存在 SQLite 生成歷史，可以還原。「儲存」以同一筆 SQLite 交易保存描述及手動編輯的完整 Gherkin；未完成或格式有錯的草稿也可先存，只有「確認需求並繼續」才阻擋不完整規格。

支援 UTF-8 TXT、Markdown、Gherkin 與 DOCX（1 MiB 內），提取文字放入需求描述；目前不支援 PDF、掃描圖片或舊 DOC。CLI 產出會經官方 Cucumber parser 與格式檢查後保存為提案，仍需人類審閱及儲存。需求、測試計劃與開發階段共用同一種互動終端，每次派工與終端 Enter 都保留獨立的 SQLite 留言與 log；實際測試接線及完整 discovery 仍在測試階段驗證。

## 日常操作

| 操作 | 實際效果 |
|---|---|
| **儲存設定／需求／產品** | SQLite 交易同時寫入內容、修訂、設定及儲存收據。與 Git、網路和遠端同步無關。 |
| **確認需求／設計並繼續** | 以目前內容摘要記錄人工確認到 SQLite，不需要 Repo checkout。 |
| **確認測試並繼續** | 輸出已儲存版本、檢查必要套件、執行真實 discovery；通過才確認測試。 |
| **確認開發** | 啟動已設定的 CLI Agent，顯示真實 PTY 終端；完成後獨立執行該功能全部 BDD，通過才進入驗收。 |
| **驗收／問題回報** | 查看 Gherkin 步驟、截圖與 Playwright 報告；回報問題後返回開發，保留原報告。 |
| **遠端同步** | 將已儲存內容輸出，依序同步產品、Spec、報告。失敗只影響同步，不撤銷已儲存內容。 |

綁定載入與日常儲存是不同操作。綁定會取得 Repo 記錄的產品版本，不會默默改用產品最新分支；載入失敗仍可儲存 SQLite 草稿。既有同名不同內容不會互相覆寫。

同一份內容被另一個編輯者改變時，會保留畫面草稿並提示合併；這是內容衝突，不是 Git 的 Commit／dirty 錯誤。已儲存與已同步分開顯示。同步或輸出遇到 Repo 內的外部修改時，不強制覆寫，仍可繼續在 SQLite 編輯與儲存。

## 版本與整庫回歸

在「版本與回歸」選規格分支、標籤或完整版本，再選各產品版本（預設沿用該 Spec 的 gitlink），按「執行全部回歸測試」。系統固定整批版本，逐一執行該版所有功能及案例／瀏覽器組合；失敗不跳過其他功能，未執行或錯誤不會顯示全部通過。

歷史版本可唯讀查看 Gherkin、設計、Tests／Hooks，不切換編輯分支。回歸使用獨立目錄；不覆寫 SQLite、不修改編輯 checkout。整批與逐功能報告保留，可比較前後結果或按「相同版本重跑」。重跑不要求重新批准歷史需求，也不自動把未批准需求變成 VERIFIED。

首次必要安裝只需一次同意；同依賴定義授權可重用，變更版本鎖時重新確認。分享報告仍使用「遠端同步」，完整批次及所有子報告放在同一 evidence 分支。此處固定 source／lockfile／產品 SHA 並記錄執行環境，不宣稱可自動還原歷史 OS 或外部服務。

## 文件與驗證

- [架構與儲存界線](docs/architecture/workstation.md)
- [操作、升級與備份](docs/operations.md)
- [舊功能及資料相容](docs/compatibility.md)

```sh
npm run check:repository
npm run check:workstation
npm run test:workstation
npm run test:workstation:e2e
```

回歸測試涵蓋 SQLite 交易回滾、版本衝突、重啟恢復、離線保存、同步失敗後保存、舊 dirty checkout 匯入與原稿保留。瀏覽器驗收透過 UI 完成設定、儲存、內容確認、一次安裝授權、真實失敗、產品修正、成功驗收及同步；也包含移除測試遠端後儲存並重新載入。

隔離 bare remotes 的推送測試不代表已驗證使用者的私有 GitHub 憑證。Gherkin 表單產生草稿，不會假裝已實作、已確認或已通過測試。

## 指定 Spec Repo 本地位置

綁定對話框與集中設定都有「Spec Repo 本地目錄」。可填 `~/projects/bdd-spec`，或使用已有相同來源的 clone；留空使用工作台預設位置。產品仍位於該 Spec Repo 的 `projects/`，不要把工作台 `bdd` 原始碼目錄填成 Spec 目錄。更換位置保留舊目錄、SQLite 草稿與歷史，不隱含搬檔或上傳。[目錄與備份規則](docs/operations.md#規格庫的本地目錄)

## CLI 與一致的流程進度

```sh
npm run bdd -- workflow status --repo bdd-spec
npm run bdd -- workflow next --repo bdd-spec --feature REQ-WB-101/development-flow
npm run bdd -- workflow run --repo bdd-spec --feature REQ-WB-101/development-flow
npm run bdd -- workflow regress --repo bdd-spec --spec main --project bdd=main
```

`next` 只執行無須人工審核的步驟，遇到人類確認便停下，不自動代簽。狀態隨內容儲存到 SQLite，並以 `spec/<REQ>/<feature>/workflow.json` 同步到 Spec Repo；新工作台從來源、審核紀錄及證據還原，而不是相信過期的狀態字串。需求流程的「驗收」直接呈現該 Repo、該功能的歷史及本機報告、案例和截圖。查看 [CLI 授權、退出碼與狀態規則](docs/operations.md#cli-推進與-spec-repo-流程狀態)。


## 開發與驗收介面

需求、設計、測試的確認按鈕與各自「儲存」並列；本地目錄、連線及同步狀態集中在設定，不佔需求頁版面。

開發只有「確認開發」與執行中的終端。先在設定確認本機已安裝、登入的 CLI Agent；新設定預設為 `codex exec --model gpt-6.1-sol --sandbox workspace-write {prompt}`，可編輯執行檔、參數、Prompt、Skills 與執行限制。既有自訂值不被種子覆寫。工作台不安裝或替你登入付費 Agent，也不使用跳過授權／沙箱的選項。終端可輸入、取消與重新連接，頁面切換不會終止開發。

Agent 結束後，工作台將產品修改保存到 SQLite 及本機版本，再獨立執行該功能全部 BDD 案例／瀏覽器組合。失敗時將結果回交 Agent（最多三次）；未完整通過就停留開發，不把 Agent 的結束碼當驗收成功。此流程不自動遠端同步。

驗收頁只呈現對應報告、Gherkin 步驟與截圖，也可展開原生 Playwright HTML 報告。沒有流程內的再次驗收區塊；整庫回歸在「版本與回歸」。問題回報保存在 `spec/<REQ>/<feature>/feedback.json`，隨明確同步分享到 Repo；新開發會讀取問題，原始報告不被刪除。

設定中的「Playwright 整體逾時毫秒」可選填 1000–600000；留空時沿用測試庫原有的 Playwright globalTimeout。

### Local read-only MCP progress

The Settings page shows the `MCP 進度 API` URL for the running local workbench. A local stdio MCP client can run `node scripts/mcp-progress.mjs http://127.0.0.1:<port>/repository-api/v1/mcp/progress` with the actual port from Settings. The bridge forwards JSON-RPC to that loopback endpoint and does not configure any client automatically. A cloud parent conversation cannot directly reach the Mac's localhost; remote access is outside this feature.
