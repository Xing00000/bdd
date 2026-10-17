# BDD 軟體開發工作台

目前是 **Gherkin確認階段，狀態 `pending`**。只需審閱 [specs/workbench.feature](specs/workbench.feature)：16個Scenario、24個展開案例。

Gherkin是需求唯一來源，已移除重複的需求索引。內容包含核心功能，以及產品內的階段控制：**Gherkin確認 → SD確認 → 測試生成／補齊 → 開發 → 驗證／報告**。每階段只改該階段產物；修改上游須退回對應階段、重新確認並使下游結果失效。

本專案自身的規格、文件、確認紀錄與測試全部跟Git。目前尚未確認Gherkin，不進行SD或產品實作；也不修改step、spec.ts或生成工具鏈。先前越階段建立的檔案已隔離保留，不納入本次提交。

本版只用已存在parser做唯讀語法檢查；沒有對本版生成spec.ts，也沒有產品E2E結果。機器用pending metadata不需人類另行審閱。
