# 匯入尚未接線執行器的規格

`feature.yaml` 可明確宣告 `authoringOnly: true`，並以空的 `profiles` 表示工作台沒有這份規格的執行矩陣。此模式仍要求正式 Gherkin、SD、情境識別碼、需求索引和審閱紀錄；不建立空的 TypeScript steps 或 hooks。

索引回傳 `testPlan.ready: false`。畫面提供需求和設計閱讀，測試生成、案例檢查、執行與整庫回歸均拒絕未接線規格。既有可執行功能的 metadata、瀏覽器矩陣及測試檔要求維持原契約。

既有本機規格庫即使尚未建立第一筆 Git commit，只要設定和來源有效，也可匯入 SQLite。首次 commit 和遠端發布不屬於閱讀規格的先決條件；匯入沿用草稿版本檢查與衝突保護。
