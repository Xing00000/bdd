# 實作驗證阻礙

## Chromium 與真實瀏覽器驗證

動作：以 `chromiumSandbox:true` 啟動正式 Playwright Chromium。結果：`BROWSER_UNAVAILABLE`，環境沒有相容執行檔。先前官方安裝已遭 CDN 403 Domain forbidden；本次沒有重試下載、使用替代鏡像／瀏覽器或降低 sandbox。

因此即時 JPEG、DOM 錄製、同會話輸入、實際重播、Vue UI E2E 與 44 個既有產品驗收案例仍未驗證。程式、真實 discovery、SQLite／PTY 與拒絕錯綠規則可獨立檢查。

## 真實 LLM provider

動作：產生 SD／補齊測試。結果：尚未設定 API key、model 及 provider context；API 回 503 `LLM_UNCONFIGURED`。沒有使用測試用 HTTP provider fixture 或預置案例內容替代真模型成功。

需在 server 設定憑證與模型，並提供實際專案缺少的 locator／fixture／業務資訊後才能跑相關驗收；若驗收條件不完整應回 NEEDS_INPUT，不擅自補造。

## AC021 輸入 fixture 會刪除骨架測試

位置：

- `tests/completion/support/database.ts:36–42`，固定骨架包含 `test-a`、`test-b`、`test-a-extra`，完成版也引用此骨架。
- `tests/completion/support/workbench.ts:111` 以 `Boolean(p.extra)` 產生要保存的 spec，`:113` 也只在 `p.extra` 時保留 extra mapping。
- `tests/completion/steps/workbench.steps.ts:1545` 的 AC021 保存呼叫只帶 `kind`，未帶 `extra:true`。因此 spec.ts 分支會從原三個 tests 減為兩個，卻仍引用原骨架並要求保存成功。

feature `workbench.feature:201–206` 要求合法產物保存、完整原文讀回與映射保留，沒有要求刪除第三個測試。fixture 輸入卻仍帶原骨架 ID/hash，卻減少其必要集合；這與 SD 0.4 `SD.md:650` §11.2「不得改寫……原 testKey／來源案例，或以刪測試補齊」衝突。產品保留 `MAPPING_INVALID` 拒絕，不放寬基線規則，不偷偷修改既有 fixture／assertion。

最小建議：只修正 AC021 的**有效 spec 保存輸入**，明確帶 `extra:true` 並保留其三筆 mapping；其他驗證錯誤 fixture 維持原設計。這是待確認的測試修正提案，**尚未套用**。修改後也必須重新生成／檢查測試 implementation manifest，不能只改測試再沿用舊收據。

此項是 fixture 修正，不需更改 Gherkin／SD 的驗收條件。若改成允許刪除原測試，才是驗收語意變更，需要上游文件失效重審；本次未採用。

## AC021／AC024 的 Gherkin 原文變數別名

`tests/completion/support/workbench.ts:36` 初始化 `vars.feature`，`:130` 保存後也只更新 `vars.feature`。批准 steps `workbench.steps.ts:1564` 的 Gherkin 分支及 `:1841`、`:1869` 卻取從未初始化的 `vars.gherkin`。正確的字串讀回也會與 undefined 比較失敗。

最小建議：統一上述三處使用 `vars.feature`，或在 constructor／成功保存時維護 `vars.gherkin` 別名。這是 fixture 變數錯誤，**尚未修改**；不應要求產品改存 undefined 或略過原文斷言。

## 本輪修復與驗證界線

本輪已修正產品的截圖 artifact 根目錄與 hash 檢查、canonical HTML 判定、首幀與背壓順序、獨立重播 binding、CI 固定 checkout 原檔核對、版本競態防護與 manifest 狀態。詳細對照見 [28 項驗收稽核](ACCEPTANCE-AUDIT.md)，最終檢查以最新 [收據](evidence/verification.json) 為準。這些產品修復不代表 44 個批准 E2E 已執行。

Git revision 解析可證明指定 commit 存在，編輯器來源須匹配提交內容；既有 target URL 執行的程式是否正是該 commit，仍需目標程式提供 revision 證明或後續建置／啟動整合。本次沒有部署、推送或捏造該證明。

## 尚未證實的支援範圍

獨立重播的 popup／context.newPage 目前採拒絕未受管新頁的方式，不能假稱有完整逐步證據。網頁錄製並不等同官方桌面 codegen；原生視窗、CAPTCHA、複雜拖放及所有網站／iframe 不在此版已驗證支援範圍。

這些限制未改寫核准的 Gherkin／SD；產品目前是可啟動、可檢查的初版，尚非已驗收完成的工作台。
