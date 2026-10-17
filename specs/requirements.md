# 待審需求索引

狀態：pending。這是 Gherkin 的查閱索引，不是 SD、架構定案或使用者核准。

| 需求 | 對應 Scenario |
|---|---|
| 本專案自舉：Gherkin確認後才SD，兩者確認後才開發；所有資料跟Git | AC-WB-031 |
| 產品內Gherkin／SD／test contract人工核准、版本hash與失效 | AC-WB-001、AC-WB-002、AC-WB-003、AC-WB-008 |
| 決定性spec產生、Outline／Background／step映射 | AC-WB-004、AC-WB-005 |
| LLM不能偷改條件、刪測試、自己批准或縮分母 | AC-WB-006、AC-WB-007、AC-WB-008 |
| SQLite實際連線、schema／資料瀏覽、預設唯讀與path限制 | AC-WB-009 |
| 核准後精確DDL／DML、正式寫入另批准且MVP禁用 | AC-WB-010 |
| 真實query期限／row limit、單writer與忙碌處理 | AC-WB-011 |
| migration、備份／restore、交易限制與未知結果 | AC-WB-024 |
| PTY／程式／browser隔離、權限、跨專案與即時通道 | AC-WB-012、AC-WB-013 |
| 觀看同session、多tab、agent／人類互斥與安全交接 | AC-WB-014、AC-WB-015、AC-WB-016 |
| 真正網頁錄製、semantic actions、locator／assertion、敏感資料保護 | AC-WB-017、AC-WB-018 |
| 串流效能、backpressure、座標、導航後stale input | AC-WB-019 |
| 人類接管污染、clean重跑、flaky與不可假綠 | AC-WB-020、AC-WB-021、AC-WB-022 |
| 工作區／session／PTY到期回收 | AC-WB-023 |
| 多人編輯衝突、統一文件評論與版本審查 | AC-WB-025、AC-WB-026 |
| 組織／project roles、權限撤銷與audit | AC-WB-027 |
| target Git的CI測試與commit綁定 | AC-WB-028 |
| 使用者自建整合測試定義在SQLite、owner／ACL／版本 | AC-WB-029 |
| target CI／DB integration／工作台自身測試的權威來源與報告分母 | AC-WB-030 |

## 目前假設，供人類確認

- 單一組織起步、多使用者與project角色；SQLite metadata與target專案DB分離。
- 效能／資源數字是待確認的驗收目標，不是實測。若修改門檻，更新 Gherkin 並重新確認。
- 不支援的錄製步驟要明示，不能假裝自動測試通過。
- 產品的正式DB寫入、部署與推送不在MVP自動授權範圍。
- 本專案規格寫Git已授權；提交本分支不代表規格已核准。

## 工具能力邊界的官方參考

- [Playwright Screencast](https://playwright.dev/docs/api/class-screencast)：畫格介面不等於輸入控制或腳本 recorder。
- [Playwright codegen](https://playwright.dev/docs/codegen)：官方桌面 browser／Inspector 錄製流程，不能直接當網頁錄製SDK。
- [Playwright Debugger](https://playwright.dev/docs/api/class-debugger)：requestPause 是下一action前暫停，不保證取消當前動作。
- [Playwright Tracing](https://playwright.dev/docs/api/class-tracing)：live trace更新不等於可接管的瀏覽器畫面。
- [Cucumber Gherkin](https://github.com/cucumber/gherkin)：AST／Pickles解析與案例展開。
- [SQLite WAL](https://sqlite.org/wal.html)、[Backup](https://sqlite.org/backup.html)、[Transactions](https://sqlite.org/lang_transaction.html)：單writer、備份及交易能力需按方言與實際版本確認。

以上僅保留規格中必要的能力事實，詳細選型、API與schema須待 Gherkin 確認後在 SD 階段提出。
