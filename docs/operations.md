# 工作台操作

[README](../README.md) · [架構](architecture/workstation.md) · [相容](compatibility.md)

## 主機準備與更新

使用 Node.js 24、Git、SSH agent 與 known-host。`npm start` 直接啟動工作台，不需舊 Vue UI build。預設位址為 `http://127.0.0.1:4173/`；`WB_PORT` 設定連接埠，`WB_HOME` 保存受管理的來源與作業資料。

```sh
WB_HOME=/absolute/private/workbench \
WB_ENABLE_TRUSTED_EXECUTION=1 \
npm start
```

先停止舊程序及 workers、備份整個 WB_HOME，再更新。Schema 4 在既有 SpecRepository 管理模型新增集中設定與同步收據；不刪除舊 checkout 或證據。尚無集中設定的既有規格庫會引導完成設定一次，不必重新綁定。

`WB_GIT_HOSTS` 設定允許來源；`WB_ALLOW_LOCAL_GIT=1` 僅供管理者允許本機遠端的環境。`PLAYWRIGHT_BROWSERS_PATH` 可指定瀏覽器路徑，預設使用 `WB_HOME/browsers`。UI 安裝瀏覽器 binaries，不使用 sudo，也不安裝 OS 套件；OS 相依套件與 Git 登入由部署主機準備。

## 一次性設定

首頁「綁定 Spec Repo」集中填寫：規格庫名稱及網址、確認者名稱、零到多個產品的名稱及來源網址，以及驗收服務的啟動程式、逐行參數與產品網址。第一個產品預設作為服務；不同服務可在同一個設定頁選擇。健康檢查預設為同來源 `/health`，不同位置才需進階設定。

系統自動 Clone、初始化空 Spec Repo、保存初始結構、建立 submodules、固定產品版本。這些步驟沒有額外確認或提交按鈕。非空不相容規格庫會拒絕覆寫。現有產品來源不允許靜默替換或刪除。

服務的健康檢查需回傳 `{ "commit": "<WB_SOURCE_COMMIT>" }`。Runner 從固定版本啟動它，並核對產品網址；不把另一個已存在網站當成目前產品。多服務部署證明仍未支援。

## 儲存與遠端同步

**儲存**僅處理這次編輯的檔案與必要的父層產品引用；系統自行建立本機版本。未被選取的 staged／unstaged 內容保持原樣。失敗會保留內容並顯示錯誤，不以遠端同步成功代替儲存成功。

**遠端同步**才連線並分享已儲存內容。先核對集中設定的唯一同步位置、確認沒有未儲存外部變更及歷史衝突；然後依序同步產品、規格與全部已封存報告。報告使用系統管理的 evidence 分支，不改寫受測來源版本。分享報告可能包含頁面內容與 logs，點擊同步即代表要求上傳這些已儲存證據。

主流程沒有 Commit／Push／Fetch／gitlink／branch 操作，使用者不必取 SHA 或輸入提交訊息。底層 Git 功能仍供開發者維護，但不是 UI 的必要步驟。

無衝突且僅遠端較新時使用 fast-forward；分歧歷史不自動 merge、不 reset、不 Force Push。同步失敗會保存已完成步驟，顯示尚未完成，可重試。跨 Repo 不是原子交易，可能部分已上傳；不會假裝全部回滾。

## 三個內容確認

需求、設計、驗收測試是需要人決定的內容。確認者名稱來自集中設定，不逐頁再填。按「確認…並繼續」即為確認，不再彈第二次確認框。未儲存的當前文件會先儲存；其他尚未儲存的設定需先保存。

測試確認自動執行真正的生成及 discovery，必須與案例／瀏覽器範圍一致才會推進。一般使用預設 CASE-001、Chromium 及所選產品；不同案例 ID 或產品關係可在功能的進階範圍設定中修改，這些是每個功能的驗收內容，不是重複的環境設定。

上游改變會讓相關確認過期，必要的重新審閱仍保留。系統不代替人批准新的需求或修改後的驗收斷言。

## 套件只在流程需要時一次詢問

第一次確認測試或執行需要環境時，系統檢查套件定義、lockfile、Node 主版本、選取瀏覽器及已安裝檔案。缺少環境顯示一個「安裝必要套件並繼續」對話框，列出套件版本與瀏覽器。按一次會完成依賴與瀏覽器安裝、保存 lockfile、接續原操作。

沒有另外的安裝依賴、安裝 Chromium、提交 lockfile、檢查接線按鈕。取消不安裝也不推進。相同已安裝環境不重複詢問；依賴版本改變、新增瀏覽器或檔案缺失需要新的授權。安裝授權綁定當下依賴摘要，不能用舊授權安裝被更換的套件。

依賴安裝使用 npm install／ci 的 `--ignore-scripts`，不執行安裝 lifecycle scripts。新範本的正式驗收安裝也採用這個參數。已存在的可執行測試與產品命令仍須在可信任隔離環境執行，這不是惡意程式沙箱。

## 一次開始驗收

按「開始驗收」即可完成候選準備、真正執行、封存與本機報告保存。產品版本直接從受管理本機來源取得，因此產品儲存後，即使從未同步也可驗收。

失敗報告也保留。修正產品按儲存，再次驗收建立新 run。結果只對該次固定版本有效；舊 VERIFIED 不替新修改背書。報告與截圖自動保存，不需要「建立報告 Commit」「發布報告」按鈕；遠端同步一併上傳。

## 故障與人工處理

| 狀況 | 行為 |
|---|---|
| 來源在編輯期間被改過 | 拒絕覆蓋，保留畫面草稿，重新讀取比較。 |
| 安裝取消或失敗 | 流程不推進、已儲存內容不變；按原步驟重試。 |
| 測試接線或斷言失敗 | 顯示錯誤；修正內容，不把失敗轉成通過。 |
| 遠端歷史分歧 | 保留兩邊版本並阻擋同步；需要人工判斷差異。現階段不提供圖形化衝突合併器。 |
| 同步目的地被外部改動 | 阻擋；在集中設定重新核對來源與目的地。 |
| 程序中斷 | 作業紀錄保留；不宣稱原子完成。新的驗收使用新 run，不覆寫舊證據。 |
| 主機缺少 OS 瀏覽器相依套件／憑證 | 顯示錯誤，由管理者修復；不要求使用者執行 Git 步驟。 |

## 開發者 API 與維護

API 前綴 `/repository-api/v1`，資源為 SpecRepository 及其 Projects。主要操作為 `repository.setup`、`repository.save`、`repository.sync`、`workflow.create`、`workflow.review`、`workflow.verify`；共同使用持久作業、repositoryId、預期版本與互斥鎖。

儲存的 input 包含 `kind: source|project|scope`、檔案路徑、內容及 expectedHash；產品需 projectId。套件缺失回傳 INSTALL_REQUIRED 與依賴摘要；UI 唯一的安裝確認重送原操作並附 installConsent。不是接受任意安裝命令。

舊資料匯入、工具升級與恢復仍保留在管理 CLI，不在日常流程堆疊操作。`node scripts/workstation.mjs help` 列出底層及語意操作。相關工具不自動推送匯入的機密來源；操作前備份並審閱。

驗證使用 `npm run check:repository`、`npm run check:workstation`、`npm run test:workstation`、`npm run test:workstation:e2e`。相容元件的 build／typecheck／test:app 仍在 CI 執行。所有瀏覽器寫入必須透過 UI，不能用 API 或檔案預填來跳過真實流程。
