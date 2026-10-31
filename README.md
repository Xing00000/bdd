# BDD 工作台

一個工作台綁定多個 **Spec Repository 與 Git remotes**；產品只存在於各 Spec Repo 的 `projects/` submodules。規格、測試與報告使用相同的 `REQ/feature` 層級。不是另一個全域「產品工作區」系統。

```text
工作台
  ├─ Spec Repo A（origin / 其他 remotes）
  │   ├─ spec/REQ/feature/
  │   ├─ tests/REQ/feature/
  │   ├─ reports/REQ/feature/run/
  │   └─ projects/product-a/ → Git submodule
  └─ Spec Repo B（自己的 remotes、需求、Projects、作業及驗收）
```

## 啟動

主機需要 Node.js 24 與 Git。管理服務使用 Node 內建模組，不需要先安裝舊 Vue／PTY 應用的依賴。

```sh
npm start
# http://127.0.0.1:4173/
```

`/` 就是新工作台。`/repositories` 是相同頁面的相容網址，不是另一個管理產品；舊 `/requirements`、全域 `/projects` 以及舊工作區 API 不再由正式入口提供。

在已隔離、可信任的執行主機上開啟測試與依賴安裝：

```sh
WB_ENABLE_TRUSTED_EXECUTION=1 npm start
```

程式設定、套件與測試是可執行程式碼。此旗標不是 OS sandbox，也不適合直接公開多租戶使用。主機仍須具備正式瀏覽器的系統相依套件。SSH agent／known-host 設定由主機管理，不把 Token、密碼或私鑰放進 Git URL。

## 從 UI 推進一個需求

1. **綁定 Spec Repo**：輸入名稱與 remote → 取得 Repo → 空 Repo 初始化 → Git 頁檢視並提交初始結構。
2. **加入 Projects**：在所屬 Spec Repo 加入產品 remote 與分支，解析成固定 commit；提交 gitlink。
3. **準備環境**：選服務 Project、啟動程式與參數、測試網址、health URL；從 UI 安裝測試依賴與 Chromium，審閱 lockfile。
4. **需求 → 設計 → 測試**：建立功能、編輯原始檔、逐階段確認；實際生成／discovery 通過後才能確認測試基線。
5. **開發 → 驗收**：編輯 Project 的產品檔案，建立分支、Commit、Push；固定產品版本並提交 Spec 候選，從 UI 準備及執行驗收。
6. **報告**：檢視真實結果與逐步截圖；獨立建立報告 commit，明確 Push 到 evidence 分支。失敗紀錄不覆寫，歷史通過不冒充當前版本已驗收。

每個按鈕有前置條件與阻擋原因。保存檔案不等於 Commit，Commit 不等於 Push。未保存的編輯在離開前需要確認；過期 HEAD 或檔案 hash 不會被默默覆寫。

## 文件

- [架構、資料模型與 UI 資訊架構](docs/architecture/workstation.md)
- [操作、部署、備份與完整 UI 流程](docs/operations.md)
- [舊資料相容與退役邊界](docs/compatibility.md)

## 驗證

```sh
npm run check:repository
npm run check:workstation
npm run test:workstation
npm run test:workstation:e2e
```

真實瀏覽器測試從**兩個空的 bare Git remotes**開始；只預先準備 Git 遠端、刻意未完成的產品及瀏覽器依賴。不預填 Spec、確認狀態、作業或報告。綁定、編輯、接線檢查、人工確認、產品修正、所有 Commit／Push、失敗重跑及證據發布皆由頁面上的使用者控制項完成。

測試保留 UI trace、桌面／手機截圖、所有 UI 寫入請求與 Git 收據。它驗證真實 Git 推送到隔離的 bare remotes，不代表已代替你的私有 GitHub SSH 憑證做驗證。缺少前置條件直接失敗，不轉成 skip。

原有 Agent／MCP／錄製程式尚未全面遷移到此新介面，保留其來源與相容性回歸檢查，但不以「舊工作區」重新暴露在主要導航。詳細限制見相容文件。
