# BDD 工作台

工作台綁定多個 Spec Repo；產品隸屬各 Spec Repo 的 `projects/`。**SQLite 儲存設定、需求、設計、測試草稿、人工確認與產品編輯。日常功能流程只有「建立功能」與「人工驗收通過」兩個 Git 邊界；中間的編輯、確認、開發、測試與狀態讀取不啟動 Git。**

## 開始使用

使用 Node.js 24。在本機啟動：

```sh
npm start
# http://127.0.0.1:4173/
```

只有這一套工作台入口。舊 `ui/` Vue 網站與 Vite 建置已移除；`npm run build` 編譯共用後端並清除失效的舊前端產物，不會再建立第二個網站。`npm test` 直接驗證正式工作台；共用後端與 API 相容性測試使用 `npm run test:app`。

先填規格庫網址與確認者。綁定與設定先存 SQLite，建立功能時才初始化 Spec Repo 及產品來源；初始化失敗保留已儲存內容並顯示原因。既有功能的儲存不會 Clone、查詢遠端、要求乾淨 checkout 或建立 commit。離線、遠端憑證錯誤、工作目錄有草稿時，仍能儲存到 `WB_HOME/metadata.sqlite`。

**直接 `npm start` 就能確認測試並執行驗收，無須另外設定環境變數。** 伺服器只監聽本機 `127.0.0.1`；只有按下確認／執行，才會啟動對應的測試程式。首次需要安裝測試套件與瀏覽器時仍會詢問同意，不會偷偷安裝或代簽審核。

若要在不信任的環境中**停用測試執行**，才使用 `WB_ENABLE_TRUSTED_EXECUTION=0 npm start`（也接受 `false`／`off`）。主機仍須提供 Git、遠端憑證與瀏覽器系統相依套件；本機網頁服務與測試子程序不構成作業系統沙箱。

## 需求頁：只用上下兩個編輯區

聊天室位於左側「對話」，按「新對話」直接在中間開啟獨立頁籤，不需輸入名稱；第一則訊息會自動成為對話標題。訊息原文、狀態與 Codex thread 對應保存於同一份 `WB_HOME/metadata.sqlite`；關閉頁籤不刪除紀錄。聊天由 Node.js 24 直接載入 canonical TypeScript 來源，安裝依賴後執行 `npm start` 即可，不依賴 `dist`。Codex（`@openai/codex`）與 Copilot（`@github/copilot`）都由專案依賴安裝，預設不依賴全域 CLI；GitHub Copilot 須先登入並具有模型權限。執行檔、模型及逾時可在「對話設定」調整。

聊天由 Codex 管理上下文，透過 **Copilot ACP** 提供模型回答，文字會逐段串流顯示。工作台啟動 `copilot --acp --stdio` 並使用標準 ACP JSON-RPC；不再使用私有 headless RPC，也不解析 CLI 終端文字。工作台入口可查詢專案與進度、產生及讀回需求提案；提案仍須人工審閱，不會直接確認階段或執行 shell。目前不支援聊天附件。Codex 壓縮不刪除原始聊天訊息；失敗或重啟中斷會保留明確狀態。[GitHub ACP 文件](https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server)

同一聊天室的連續訊息會重用 Codex 背景程序，Copilot 模型請求與模型清單查詢會重用 ACP 連線。每次推理仍使用獨立 Copilot session，由 Codex 提供當次上下文，避免重複累積歷史或混入其他聊天室。串流、取消與權限回覆均走 ACP；協定不相容時明確回報，不退回其他 CLI 模式。空閒程序會回收；設定變更或程序故障時會重新建立，並從已保存的 Codex thread 繼續。實際首字速度仍取決於所選模型、上下文與服務狀態。

上方 **Gherkin** 是一直展開的正式規格編輯區，下方 **需求描述** 可直接打字或按「上傳文件」匯入。按 **LLM 生成 Gherkin** 會先預覽可修改的 Prompt，送出後才由選定的 Agent 透過 Codex SDK 生成草稿；新需求也能直接生成。沒有功能名稱、角色、條件或案例 ID 等額外必填欄位，名稱由 Gherkin 的 Feature 自動取得。

修改需求描述不會覆蓋 Gherkin。重新生成前的原稿與 Agent 生成提案保存在 SQLite 生成歷史，可以還原。「儲存」以同一筆 SQLite 交易保存描述及手動編輯的完整 Gherkin；未完成或格式有錯的草稿也可先存，只有「確認需求並繼續」才阻擋不完整規格。

支援 UTF-8 TXT、Markdown、Gherkin 與 DOCX（1 MiB 內），提取文字放入需求描述；目前不支援 PDF、掃描圖片或舊 DOC。Agent 產出會經官方 Cucumber parser 與格式檢查後保存為提案，仍需人類審閱及儲存。需求、系統設計、測試計劃與開發階段共用執行紀錄；以多行輸入框補充 SDK 後續回合，執行終端僅供檢視。每次派工與補充訊息都保留獨立的 SQLite 留言與 log；實際測試接線及完整 discovery 仍在測試階段驗證。

系統設計頁的「LLM 生成系統文件」同樣先預覽 Prompt，再派出 Agent。Codex SDK 透過 MCP 讀取已確認需求與目前文件，生成後放入編輯區供審閱、儲存，不會自動確認設計；失敗時保留原稿。

## 日常操作

| 操作 | 實際效果 |
|---|---|
| **建立功能** | 保存需求並初始化來源，建立功能起點的 Git 版本。 |
| **儲存設定／需求／產品** | SQLite 交易同時寫入內容、修訂、設定及儲存收據。與 Git、網路和遠端同步無關。 |
| **確認需求／設計並繼續** | 以目前內容摘要記錄人工確認到 SQLite，不需要 Repo checkout。 |
| **確認測試並繼續** | 輸出已儲存檔案、檢查必要套件、執行真實 discovery；通過才確認測試，全程不建立 Git 版本。 |
| **確認開發** | 由 Codex SDK 執行並顯示結構化事件；完成後獨立執行該功能全部 BDD，通過才進入驗收。 |
| **驗收／問題回報** | 查看 Gherkin 步驟、截圖與 Playwright 報告；回報問題後返回開發，保留原報告。 |
| **人工驗收通過** | 核對報告與目前內容摘要，保存人工確認後固定產品、Spec 與報告的 Git 版本。自動測試通過只進入等待人工驗收。 |
| **遠端同步** | 明確分享已完成人工驗收的固定版本；有新草稿或驗收步驟未完成時拒絕同步，不替中間步驟建立 commit。 |

來源初始化使用 Repo 記錄的產品版本，不會默默改用產品最新分支；初始化失敗仍保留 SQLite 草稿。既有同名不同內容不會互相覆寫。「版本與回歸」的歷史取得、固定舊版本測試與遠端同步是使用者明確發起的版本維護操作，不由切頁、儲存或一般狀態讀取觸發。

一般功能測試使用獨立檔案快照，以 SHA-256 摘要識別規格及產品內容。報告中的 `sourceKind: WORKSPACE`、`specDigest`、`inputDigest` 與產品 `contentDigest` 表示實際受測內容；`testedSpecCommit` 保持 `null`，不把內容摘要冒充 Git commit。`specSourceDigest` 額外核對完整規格來源，包括功能目錄外的共用 helper，只排除工作台管理的確認／驗收等衍生紀錄。人工驗收建立的 commit 也須符合這份來源摘要。歷史版本回歸仍記錄實際 Git SHA。

人工確認後若建立版本或保存證據失敗，畫面會顯示「驗收版本待完成」，可按「重試完成驗收」接續，不會重複記錄人工確認。來源改變時必須重新驗證，不能沿用過期報告完成驗收。

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
npm run test:seed
npm run test:chat:runtime
npm run test:workstation
npm run test:workstation:e2e
npm run test:ui:protocol
```

`test:seed` 驗證首次初始化、缺少任務預設的補齊、重複執行不增加資料、舊版 Prompt 遷移、使用者自訂值保留，以及 SDK／Agent／Skill／Prompt 的關聯完整性。使用 Node.js 24 並先執行 `npm ci`，不需要瀏覽器或外部 LLM 登入。

`test:chat:runtime` 驗證聊天程序重用、串流、取消、聊天室隔離、故障與設定變更後恢復，以及專案安裝的真實 Codex app-server／Copilot ACP 協定。測試使用隔離資料與本機模型 fixture，不需要外部帳號，也不代表已量測真實模型的回答速度。CI 的 application checks 同時執行這些測試。

`test:ui:protocol` 執行 7 項使用本機 fixture 的協定驗證（6 項真實 Chromium UI、1 項 API），須先執行 `npm ci`、`npm run build` 與 `npx playwright install chromium`，不需外部帳號。`npm test` 仍執行全部 16 項測試，包含需要真實 Codex／Copilot 登入的案例。

`npm run spec:list` 只列出目前工作台的瀏覽器測試，不生成舊版規格或修改人工審核紀錄。舊版 `spec:generate`、`spec:verify` 與 `test:tooling` 仍保留原有來源審核檢查。

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

需求生成、系統設計、測試計劃補齊與開發實作一律由 **Codex SDK** 執行。Codex 負責規劃、任務 MCP、檔案修改與命令執行；**Copilot ACP 只提供模型文字與工具呼叫提案**，工作台不授予它檔案或終端工具。實作推理的 ACP 程序及 session 使用獨立空暫存目錄，不把產品或 Spec 目錄當作工作目錄；這是程序與工具分工，不是額外的 OS 沙箱。SDK 經本機 Responses 轉接層呼叫 ACP，沿用對話設定中的 Codex／Copilot 執行檔與 Copilot 登入；Agent 的 `model: auto` 沿用對話模型，可為個別 Agent 指定模型。

先執行 `npm install` 與 `npm run build`，再於「Agent、Prompt 與 Skill 管理」設定模型與執行限制；執行引擎固定為 `Codex SDK`。官方 `@openai/codex-sdk` 與 Codex 固定在相同版本；SDK 底層仍啟動原生 Codex 程序。工作台讀取 SDK 結構化事件，保留原有 sandbox、取消與作業紀錄。執行中輸入的補充文字會排入同一 thread 的後續回合，不冒充即時插話。已移除自訂 CLI 派工入口；舊設定在新預覽時轉成 SDK 設定，原始歷史仍保留。SDK 失敗直接回報，不改由 Copilot 執行。聊天仍使用 Codex app-server 保留即時串流、壓縮及持續程序。

Agent 結束後，工作台將產品修改保存到 SQLite 與工作目錄，再以內容快照獨立執行該功能全部 BDD 案例／瀏覽器組合。失敗時將結果回交 Agent（最多三次）；開發、重試與測試不操作 Git。完整通過才進入等待人工驗收，按「驗收通過」才固定 Git 版本；不把 Agent 的結束碼當驗收成功，也不自動遠端同步。

驗收頁只呈現對應報告、Gherkin 步驟與截圖，也可展開原生 Playwright HTML 報告。沒有流程內的再次驗收區塊；整庫回歸在「版本與回歸」。問題回報保存在 `spec/<REQ>/<feature>/feedback.json`，隨明確同步分享到 Repo；新開發會讀取問題，原始報告不被刪除。

設定中的「Playwright 整體逾時毫秒」可選填 1000–600000；留空時沿用測試庫原有的 Playwright globalTimeout。

### Local read-only MCP progress

The Settings page shows the `MCP 進度 API` URL for the running local workbench. A local stdio MCP client can run `node scripts/mcp-progress.mjs http://127.0.0.1:<port>/repository-api/v1/mcp/progress` with the actual port from Settings. The bridge forwards JSON-RPC to that loopback endpoint and does not configure any client automatically. A cloud parent conversation cannot directly reach the Mac's localhost; remote access is outside this feature.

需求清單旁可按「刪除需求」，確認後從清單移除。已保存文件、測試與執行歷程會保留，刪除後的需求不能再編輯、退回或確認；目前沒有還原按鈕。刪除最後一筆後仍可新增，系統不會重用已刪除需求的識別碼。
