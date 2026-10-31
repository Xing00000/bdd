# 操作、升級與故障處理

[README](../README.md) · [架構](architecture/workstation.md) · [相容](compatibility.md)

## 啟動

Node.js 24；管理入口使用 Node 內建模組，不需先安裝舊 Vue／PTY 功能依賴。

```sh
npm start
```

預設 `http://127.0.0.1:4173/`，`WB_HOME` 預設 `~/.bdd-workstation`。需要測試執行時設定 `WB_ENABLE_TRUSTED_EXECUTION=1`。Git、SSH agent／known-host、系統瀏覽器相依套件仍由主機管理；不要把 Token 寫進 Git URL。

## 儲存不是同步

綁定網址、確認者、產品來源及啟動設定只需要存入 SQLite。填好後按儲存，不會驗證遠端帳號，不會下載／執行 Repo，也不要求先 commit。

建立需求、編輯 Gherkin／SD／測試或產品，按儲存後即可重新載入確認。資料在 `WB_HOME/metadata.sqlite`，不是只留在瀏覽器或尚未提交的檔案。畫面顯示已儲存並不等於已同步。

「遠端同步」才會連線並分享；「確認測試」「開始驗收」會在需要時取得來源及準備固定版本。首次開啟尚未取得的產品原始碼也會執行來源準備。這些操作可能因網路、憑證、環境或 Repo 衝突失敗，但不影響後續儲存。

## 完整流程

綁定 Spec Repo → 儲存基本設定 → 上方描述／匯入文件 → 產生草稿 → 下方編輯 Gherkin → 儲存／確認 Gherkin → 儲存／確認設計 → 編寫測試 → 一次授權必要安裝 → 檢查並確認測試 → 編輯產品並儲存 → 開始驗收 → 查看結果 → 遠端同步。

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

工具升級、legacy 匯入與 Git 低階腳本保留給明確的維護工作，不能將其直接修改 checkout 的結果視為新的 SQL 作者修訂。主要 UI 使用 SQL 流程；既有作者資料請透過儲存介面更新。舊 SQLite documents 的唯讀匯入、報告 Git 索引仍保留，無法憑舊 PASSED 紀錄產生新驗收資格。

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
