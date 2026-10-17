# BDD 軟體開發工作台

目前是 **SD確認階段，SD狀態 `pending`**。請審閱 [spec/REQ-WB-001/SD.md](spec/REQ-WB-001/SD.md)。

`spec/`按每次需求分目錄，同次需求的 [Gherkin](spec/REQ-WB-001/workbench.feature) 與SD放在一起；`doc/`只放ADR。需求ID為`REQ-WB-001`，既有情境ID `AC-WB-001`～`AC-WB-020`保持不變；沒有新增ADR或重複需求索引。需求ID與release ID分開，兩者可多對多對應，不新增release管理功能。

本次只整理文件路徑及需求綁定，保留已批准`ef497e6` feature的原始bytes；提交／推送不代表SD內容已核准。SD內記錄`a16f142`舊路徑到新路徑的對應。

流程維持：**Gherkin確認 → SD確認 → 測試生成／補齊 → 開發 → 驗證／報告**。沒有產生測試或程式，未執行SQL／build／E2E；SD確認後才進下一階段。
