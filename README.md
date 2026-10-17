# BDD 軟體開發工作台

目前是 **SD 確認階段，SD 狀態 pending approval**。請審閱 [spec/REQ-WB-001/SD.md](spec/REQ-WB-001/SD.md)。

[REQ-WB-001 的 Gherkin](spec/REQ-WB-001/workbench.feature) 已由使用者定稿：**27 個情境、43 個展開案例**，ID 為 AC-WB-001～027。[確認紀錄](spec/REQ-WB-001/review.json) 綁定原文 hash；feature 既有待確認註解保持定稿內容不動，以此確認紀錄為準。

SD 採 Vue／TypeScript／Node.js、六邊形架構及 SQLite，涵蓋文件原文與正規化版本、明確測試映射、PTY、Playwright 即時觀看、使用者親自錄製／獨立保存／重播及 E2E 證據。產品 DB 可存 Gherkin／spec.ts／SD；標準 CI 仍以 target Git 為準，bdd 自身 bootstrap 文件與測試全部存 Git。

每次需求的 Gherkin、唯一一份 SD 與確認 metadata 同存 `spec/<requirementId>/`；doc/ 只放 ADR，目前沒有新增 ADR 或 requirements.md。需求 ID 與 release ID 分開，不新增 release 管理功能。

流程維持：**Gherkin 確認 → SD 確認 → 測試生成／補齊 → 開發 → 驗證／報告**。本次只有文件；未產生 spec.ts、未實作或安裝依賴，未執行 SQL／build／E2E。文件提交／推送不代表 SD 核准。
