# 操作、升級與故障處理

[README](../README.md) · [架構](architecture/workstation.md) · [相容](compatibility.md)

## 啟動

Node.js 24；管理入口使用 Node 內建模組，不需先安裝舊 Vue／PTY 功能依賴。

```sh
npm start
```

預設 `http://127.0.0.1:4173/`，`WB_HOME` 預設 `~/.bdd-workstation`。**直接 `npm start` 即可在頁面確認測試與執行驗收，不需傳入旗標。** 測試僅由使用者明確觸發；首次安裝套件及瀏覽器仍必須同意，需求／設計／測試的人工審核也不會自動代簽。只有要刻意停用執行時才設定 `WB_ENABLE_TRUSTED_EXECUTION=0`（亦接受 `false` 或 `off`），並重啟服務。Git、SSH agent／known-host、系統瀏覽器相依套件仍由主機管理；不要把 Token 寫進 Git URL。本機服務與測試執行並非 OS 沙箱，僅適合可信任的使用環境。

受管理的工作台候選會從 `WB_TARGET_BASE_URL` 取得監聽埠；明確設定的 `WB_PORT`／`WB_REPOSITORY_PORT` 優先。`GET /health` 回報產品目錄的實際 Git HEAD，供 runner 核對候選版本。驗收 runner 使用獨立 HOME／TMPDIR，候選的 SQLite 不會寫入管理工作台的資料目錄；請使用不同於管理入口的本機網址。

## 規格庫的本地目錄

綁定時可在 **Spec Repo 本地目錄** 填入絕對路徑或 `~/`，例如 `/Users/xing/Desktop/projects/bdd-spec`。這是執行工作台服務的電腦上的路徑，不是瀏覽器上傳目錄，也不是 `/Users/xing/Desktop/projects/bdd` 工作台原始碼目錄。留空沿用 `WB_HOME/repositories/<repositoryId>/repo`，不要求額外設定。

空目錄或不存在的位置會取得 Spec Repo；已有相同來源的 clone 會直接使用，不重複下載另一份編輯目錄，不 reset、切分支或丟棄暫存內容。既有本地未提交規格會保留，不用遠端內容覆蓋。不同 Repo、非空的一般資料夾、捷徑、其他綁定／產品範圍或系統／工作台資料目錄會拒絕採用並指出原因。

已綁定的規格庫可在 **設定 → Spec Repo 本地目錄 → 儲存設定** 更換位置。不搬移或刪除舊目錄、不清空 SQLite、不自動遠端同步。目錄有衝突時其他設定與草稿仍已存入 SQLite，可更正路徑再儲存。正在同步或回歸時會保留目前使用的位置，待該作業結束再更換。

本地 clone 的遠端暫時離線仍可查看已取得內容，畫面會提示未取得遠端更新。Schema 8 新增 `spec_repositories.local_path` 與位置變更歷史；既有綁定預設路徑不變，升級前自動備份為 `before-local-directories-v8.sqlite`。另選的本地目錄不在 `WB_HOME` 備份內，請一併備份其未提交檔案。

## 儲存不是同步

綁定資料先存 SQLite，系統立即建立專屬本地目錄並以獨立作業取得規格、產品與歷史。載入失敗不撤銷綁定；畫面會顯示「內容取得失敗」，而不是把未知內容當成空規格庫。日常儲存設定與草稿仍只寫 SQLite，不下載、執行或提交 Repo。

建立需求、編輯 Gherkin／SD／測試或產品，按儲存後即可重新載入確認。資料在 `WB_HOME/metadata.sqlite`，不是只留在瀏覽器或尚未提交的檔案。畫面顯示已儲存並不等於已同步。

「遠端同步」才會分享已儲存內容；綁定／更新版本也會讀取遠端，但不推送；「確認測試」「開始驗收」會在需要時取得來源及準備固定版本。首次開啟尚未取得的產品原始碼也會執行來源準備。這些操作可能因網路、憑證、環境或 Repo 衝突失敗，但不影響後續儲存。

## 完整流程

綁定 Spec Repo → 儲存基本設定並一次準備該 Spec Repo 的測試套件 → 下方描述／匯入文件 → LLM 生成 Gherkin（預覽後送出 CLI）→ 上方編輯 Gherkin → 儲存／確認需求 → 確認系統設計 → 測試計劃頁自動以 Playwright-BDD 產生骨架 → 點選「LLM 生成測試計劃」補齊細節（也可人工編輯）→ 檢查並確認測試 → 編輯產品並儲存 → 開始驗收 → 查看結果 → 遠端同步。

「產生測試計劃骨架」與「LLM 生成測試計劃」是獨立操作，前者不啟動 Agent，兩者都不執行套件安裝。骨架的未完成 step 明確拋錯，不能當成完整計劃確認；LLM 補齊後仍須通過型別檢查、bddgen 與案例發現，再由人類確認。套件缺少或版本變動時，返回設定頁儲存並準備工具；相同 Spec Repo 的不同需求共用同一次安裝。瀏覽器執行環境在設定準備工具時一併檢查；新增瀏覽器 profile 或執行檔遺失時，須重新準備必要項目。

按「LLM 生成 Gherkin」、「LLM 生成系統文件」、「LLM 生成測試計劃」或「確認開發」時，先預覽實際 CLI Prompt，可修改後按「送出」，或取消而不派工。預設只給任務及 MCP 工具入口，Agent 透過本次唯讀 MCP 按需讀取規格、設計與回報；使用者送出的文字不會再被附加說明。預覽後來源或設定變更時須重新預覽。自訂 CLI 的參數必須以 `{mcp}`（Codex）或 `{task}`（自訂 MCP adapter）接上任務資料。

每次送出 LLM 任務（生成 Gherkin、生成系統文件、補完測試計劃、實作）會在該階段下方新增一筆互動留言及可收合的執行 log，保留送出內容、時間與執行結果，不覆蓋前一次。一般儲存、匯入、本機草稿生成與測試執行不顯示為留言。各階段共用互動 PTY 終端，CLI 終端內每次 Enter 也各自成一筆；未送達 CLI 的輸入會明確標示失敗。重新整理或重啟後，可繼續查看 SQLite 中的紀錄，並載入更早歷程。`metadata.sqlite` 現在也包含執行輸出、程序與退出資訊；截圖、trace 等驗收附件仍須連同其檔案目錄保存。既有檔案式 log 在首次讀取時匯入 SQLite，原檔不會被刪除。

需求、系統設計、測試計劃、開發實作與驗收頁各自顯示該階段的互動，維持最新在上；CLI 回覆跟隨原作業的分類，切換階段不會混入其他階段的紀錄。

失敗的產品測試保留結果；修正並儲存產品後可重跑，不需要先同步。沒有遠端或 checkout 也可以做到需求與設計儲存／確認；執行測試則仍需要真正的產品來源與環境。

## 更新到 SQLite authoring

先停止舊工作台程序並備份 `WB_HOME`，再更新程式與啟動。Schema 5 為新增資料表，不刪舊紀錄；既有 schema 會先建立 `before-authoring-v5.sqlite`。舊 schema 1／2 的模型遷移仍保留 `before-repository-model-v3.sqlite`。

第一次儲存時，既有受管理 Spec checkout 的規格文字會唯讀匯入 SQLite，包括尚未提交的草稿。不檢查 clean 狀態、不 commit、不移除暫存檔。舊版本留下的設定修改會保留在匯入歷史，新的設定另存成 SQL 修訂。

舊 `workspaces/` → `repositories/` 目錄遷移仍保留；兩份目錄同時存在時不猜測合併。已有 SQL authoring 的規格庫不會每次啟動重新匯入並覆蓋較新的資料。

## 出錯時

| 狀況 | 結果與處理 |
|---|---|
| 遠端無法存取、憑證錯誤 | 影響連線／同步；設定與草稿仍可儲存。 |
| Repo 有其他草稿或暫存內容 | 不影響 SQL 儲存，不會被偷偷提交。 |
| 同一份 SQL 文件被其他人更新 | 保留畫面草稿，重新讀取後合併；不覆蓋他人的版本。 |
| `EXPORT_CONFLICT`／`IMPORT_CONFLICT` | SQLite 與 Repo 各有不同內容；兩邊保留，輸出／同步暫停。正常編輯儲存仍可使用。 |
| 安裝或測試失敗 | 內容已保存，但不授予測試確認或 VERIFIED。 |
| Worker 在保存後中斷 | 重新啟動時依 SQL 交易收據恢復已完成狀態。 |

不要用 `git reset --hard`、刪除工作目錄或刪除資料庫來嘗試解除儲存問題。未同步作者內容只有 SQLite 與其歷史持有。

## 備份

SQLite 不再是只有 metadata 的可重建索引。務必備份 `metadata.sqlite` 及它的 WAL 狀態；最簡單是正常停止服務後備份整個 `WB_HOME`。線上備份應使用 SQLite backup 工具，不能只複製正在寫入的主 DB 檔。也備份 executions 的證據、尚未發布 reports、transactions、舊資料庫與受管理 checkout 中的外部草稿。

`authoring_history` 保存歷史原文；資料庫與備份只開放給可信任使用者。沒有自動 secret 偵測承諾，分享報告與來源前仍需注意敏感資料。

## 維護工具

`node scripts/workstation.mjs help` 列出 CLI；HTTP 與 CLI 共用程式。`repository.setup`／`repository.save`／`workflow.create`／`workflow.draft` 是 SQL authoring；`repository.prepare` 是衍生檔案輸出，不能當成儲存 API。

工具升級的 `repository.upgrade.preview/apply` 使用 SQLite 作者修訂：先驗證目前 manifest 列出的所有檔案摘要、拒絕未知或另有修改的工具檔，再以計畫 digest 確認完整升級內容，單筆 SQL 交易保存新版工具及 manifest；不需要修改 checkout。legacy 匯入與 Git 低階腳本保留給明確的維護工作，不能將其直接修改 checkout 的結果視為新的 SQL 作者修訂。主要 UI 使用 SQL 流程；既有作者資料請透過儲存介面更新。舊 SQLite documents 的唯讀匯入、報告 Git 索引仍保留，無法憑舊 PASSED 紀錄產生新驗收資格。

```sh
npm run check:repository
npm run check:workstation
npm run test:workstation
npm run test:workstation:e2e
```

既有元件的 `npm run check`、`npm run check:unused`、`npm run build`、`npm run test:app` 仍由 CI 執行。`npm run deploy` 可重建歷史部署產物，生成副本不提交。

## 上下兩區的需求編輯

點「新增需求」直接開啟空白的兩區編輯器，不再顯示多欄位表單或要求自行輸入代號。上方作為來源素材，下方是後續設計與測試依據。下方可直接貼上既有完整 Gherkin，不強制重新生成。

「上傳文件」接受 TXT／MD／Markdown／Feature／DOCX，單檔最多 1 MiB，提取文字最多 256 KiB。只把文字附加到上方，不自動生成、不改動下方、不執行文件指令。DOCX 限制壓縮及解壓尺寸、拒絕外部實體；不提取嵌入圖片。二進位原始附件不保存，提取出的文字隨需求存入 SQLite。PDF／舊 DOC 請先轉成文字。

重新生成屬於替換操作，因此需要一次確認。現有下方內容（包括尚未儲存的修改）與新提案存進 `requirement_proposals`，再顯示新草稿；可在「先前的生成草稿」取回，不會自動更改正式規格或審核狀態。新增需求的生成歷史在第一次儲存時轉到該需求名下。

儲存即使沒有可用 Git remote 仍然成功；描述與 Gherkin 使用共同的內容 token，其他人改動任一區時會保留畫面草稿並拒絕覆寫。格式錯誤不妨礙儲存，確認時才顯示行號與修正提示。上方描述單獨修改不撤銷未變的正式規格確認；下方規格改動則使下游確認過期。

Schema 6 新增生成恢復資料表，舊資料先備份至 `before-requirement-editor-v6.sqlite`，不刪除 schema 5 的儲存內容。新 SQL 儲存命令是 `workflow.requirement.save`。HTTP 的 `requirement/generate` 與 `requirement/import` 提供草稿及文件提取；兩者都不是 Git 操作。


## 需求確認不以關鍵字判斷業務內容

「請先補上可驗收的結果」的舊字串卡控已移除。舊範本的 `Then 請補充可驗收的結果` 只顯示行號及不阻擋的內容提醒，不妨礙儲存或人工確認。註解、Doc String 或預期畫面文字包含同樣字串時不會被誤擋；系統不以這些字詞推斷內容是否足夠。

儲存接受未完成或格式錯誤的草稿。上傳既有但尚未完成的 Gherkin 後，產生草稿也會保留原文並顯示格式提示。按「確認需求並繼續」只檢查基本結構與目前內容版本：例如必須有 Feature、Scenario 及可供後續接線的步驟，不要求每個情境機械地重複 When／Then，也不再要求額外驗收結果欄位。格式問題會指出行號，已儲存的 SQLite 原稿不變。

內容是否符合需求由人確認；需求確認只前進到設計，不會產生 PASSED 或 VERIFIED。後續的真正測試接線、斷言、覆蓋範圍、部署版本與執行證據檢查沒有放寬。


## 綁定就緒與版本回歸（schema 7）

綁定自動建立 `WB_HOME/repositories/<repositoryId>/repo`，取得選定綁定分支、需求／設計／測試、宣告的產品 gitlinks 與歷史報告。空遠端自動建立範本；既有 Repo 不套空白範本。只取得來源，不自動執行安裝程式。離線會保留本地父目錄與綁定紀錄，可在提示中重試；SQLite 儲存不受影響。

「版本與回歸」提供已取得的分支／標籤及完整 commit 輸入，並可查看該版本所有功能的 Gherkin、SD、Steps 與 Hooks。讀取歷史不切換目前編輯工作區。產品選單依該 Spec 版本的 `.gitmodules`，不能引用另一規格庫的任意產品。整庫回歸以所有功能為範圍，不把局部成功當成全部通過。

選擇分支時，開始會取得最新可用 ref 並立即固定 SHA；選完整 SHA 則使用已取得的不可變版本。授權安裝期間也不追蹤分支變動。每個功能使用獨立 clone 與輸出，失敗繼續下一項。未有人工確認仍可跑回歸，但不會因此自動審核需求。服務／依賴無法啟動、discovery 不符、案例跳過、取消及中斷均不授予整庫通過。

`regressions/<batchId>/baseline.json` 記錄固定規格與產品版本、依賴鎖、Node／OS 資訊。每個功能的正式結果仍在 `executions/<runId>/evidence`；整批摘要保存在 SQLite 和 `summary.json`。完成後自動建立本機 evidence commit，遠端同步才上傳，內容包含 `reports/_runs/<batchId>/summary.json` 與全部可取得的子報告。別台工作台可從該分支還原索引及重跑同版本。

回歸執行期間可繼續編輯及儲存；本次只使用已固定內容。重啟／取消保留已完成項目，未完成項目顯示中斷而非通過。回歸不是 OS 映像還原：要完全重現外部服務或舊作業系統仍須提供相同環境。V1 單一受管服務限制仍適用；沒有部署證明的非 UI 測試可以有真實 PASSED 結果，但不授予部署 VERIFIED。

歷史索引讀取已取得的 evidence 分支和過去 report commits，包括已從分支頂端刪除的報告；首批上限有明確提示，較早資料可使用歷史載入。原格式不符、缺少附件或重用同 run-id 的內容會顯示問題，不偽裝完整證據。

升級前正常停止服務並備份 WB_HOME。Schema 7 增加 `repository_connections` 和 `regressions`，保留原內容並先建立 `before-catalog-regression-v7.sqlite`。SQLite 設定／草稿仍是需備份的正式資料；catalog 快照與報告索引為衍生內容。底層測試 fixture 可用 `autoAcquire:false` 單獨測試 clone helper；正式 CLI/UI 不關閉自動載入。

## CLI 推進與 Spec Repo 流程狀態

UI 與 CLI 共用 `workflowState`／作業執行引擎及同一個 `WB_HOME`，不另存一套 Agent 進度。CLI 支援規格庫名稱、網址或綁定 ID；省略時只會選唯一的綁定或目前所在的綁定目錄，歧義會回報可用選項。

```sh
npm run bdd -- workflow status --repo bdd-spec
npm run bdd -- workflow next --repo bdd-spec --feature REQ-WB-101/development-flow
npm run bdd -- workflow run --repo bdd-spec --feature REQ-WB-101/development-flow
npm run bdd -- workflow regress --repo bdd-spec --spec main --project bdd=main
# 也可直接呼叫 node scripts/bdd.mjs workflow ...；npm link 後使用 bdd workflow ...
```

`status` 讀取目前狀態與對應報告。`next` 在必要人工審核時回傳 `AWAITING_REVIEW`，不代簽；審核完成後自動執行驗收，已完成則不重複執行。`run` 明確重跑單功能，`regress` 跑所選規格的整庫。需要重新產生內容或修改產品的工作仍由使用者／外部 Agent 完成；這不是自動撰寫設計或程式的 LLM 代理。

輸出預設為 JSON，錯誤輸出到同一 JSON 結構，執行診斷走 stderr。程序退出碼：0 為成功（`status` 讀取成功也為 0），1 為錯誤、測試失敗或單功能尚未完整驗證，2 為等待人類審核，3 為需要安裝授權。不能只看內部作業 `SUCCEEDED` 就認為產品測試通過。安裝回傳精確計畫摘要及回歸批次，經確認後用 `--install-consent <digest>` 重試；回歸同時帶 `--batch <id>` 和原版本選擇。無 `--yes` 或跳過審核參數。`--rerun <batch-id>` 使用歷史固定版本，不可再覆寫產品或 Spec 版本。這些指令不隱含遠端同步。

每個功能的版本化進度位於 `spec/<REQ>/<feature>/workflow.json`。它包含來源摘要、目前階段、人工確認狀態及對應 `reports/<REQ>/<feature>/<run>/manifest.json` 的證據引用；人類審核原始紀錄仍在 `spec/<REQ>/review.json`。普通儲存先以同一筆 SQLite 交易保存內容與狀態；遠端同步一起輸出到 Spec Repo，其他工作台可從 Repo 重新載入。狀態不同步會明確標示為本機修訂，不宣稱遠端已更新。機器 PID、執行中作業與安裝快取仍是本機操作資料，不寫入可共享的需求狀態。

狀態不是可任意指定的枚舉：來源改變、產品版本不同、缺少證據或同版本出現較新的失敗，都會重新計算；僅修改 `workflow.json` 的 `VERIFIED` 字樣不會通過。直接從原始碼編輯器寫入此系統衍生檔也會被拒絕。狀態檔不納入自身的來源確認摘要，避免每次推進又讓自己失效。狀態／報告同步可能新增 commit，但受測 commit 仍保持原值，不冒充新的進度 commit 也已受測。

需求流程的「驗收」頁只顯示目前綁定及該需求／功能的報告，合併本機與 Repo 索引、避免重複。可直接看案例結果、截圖及下載報告，並標示受測版本、歷史／目前內容及來源；不需要離開需求去猜全庫報告。版本不符的歷史仍保留但不授予目前驗收。證據衝突或檔案損毀會顯示原因，而不是改成通過。


## CLI Agent 開發與問題回報

在集中設定指定 **CLI Agent 執行檔** 和逐行參數，執行檔使用本機 PATH 或完整路徑。`{prompt}`、`{spec}`、`{project}` 只能作為整個參數，會由系統替換成需求指令、Spec 目錄及產品目錄；不使用 shell 拼接。未提供 `{prompt}` 時會將指令追加為最後一個參數。登入由該 CLI 的正常機制管理，不在需求文件存 Token。

同頁可編輯 **CLI Agent Prompt**、**CLI Agent Skills**、最大嘗試次數與逾時毫秒，保存至所選規格庫的 SQLite 設定。Prompt 支援 `{requirementId}`、`{featureId}`、`{spec}`、`{projects}`、`{feedback}`、`{previousFailure}`；未知變數、空白 Prompt 與超出大小限制會拒絕整次設定保存，已存內容保留。Skills 是附加至有效 Prompt 的純文字，可清空停用。重開設定或保存其他欄位不會重設自訂內容；登入憑證不在此表單顯示。

開發時按「確認開發」，真實 PTY 會顯示 Agent 的輸出，支援輸入、尺寸變更及停止。首次缺少 PTY／終端元件時在流程內確認安裝；這包含 node-pty 原生編譯，主機需具備編譯工具。正常 `npm ci` 已安裝這些鎖定依賴時不會另問。安裝終端元件不代表同意更換測試依賴，測試套件仍按原有精確計畫授權。

Agent 在關聯產品目錄內執行；多產品需求以 Spec 目錄為 cwd，指令列出允許的產品。這不是額外的 OS 沙箱。不要對不信任的 Repo 執行任意 Agent。已存在外部產品草稿時會停止，並保留原檔。Agent 修改已確認規格、測試、其他產品或遇到新的 SQLite 修訂時，不會覆蓋或代簽；必須處理實際差異。支援產品 UTF-8 文字新增、修改及刪除，二進位或超大檔案會保留在原處並回報，不冒充保存成功。

CLI 成功退出後仍會獨立執行該功能全部 BDD，包含覆蓋矩陣、斷言及逐步截圖證據。未通過則將失敗交給 Agent 再修正，最多三輪。任何一輪驗收結果都保留。只有完整通過才能自動跳轉報告。原有 CLI `workflow run`／`next` 保留直接驗證的相容用途，不是呼叫外部 Agent 的入口。

驗收不提供再次驗收按鈕。問題回報以一個文字區描述問題，綁定該需求及所選 run，送出後返回開發；狀態在重新整理或重啟後仍保留。只有問題提出之後開始的合格新測試結果才能解除回退狀態，歷史 PASSED 不會把問題蓋掉。實際業務問題是否已修正仍由使用者檢視，不宣稱測試能涵蓋所有人工觀察。

終端紀錄與執行指令位於 `WB_HOME/development/<operationId>/`，是本機診斷資料，不隨 Spec 同步；可能包含 Agent 主動印出的資料，請依機器的資料保護政策保管。報告內嵌頁面以獨立 sandbox 執行，不能存取工作台父頁或使用父頁的身份操作 API。
