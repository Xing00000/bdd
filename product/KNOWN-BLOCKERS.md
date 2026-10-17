# 實作驗證阻礙

## Chromium 與真實瀏覽器驗證

動作：以 `chromiumSandbox:true` 啟動正式 Playwright Chromium。結果：`BROWSER_UNAVAILABLE`，環境沒有相容執行檔。先前官方安裝已遭 CDN 403 Domain forbidden；本次沒有重試下載、使用替代鏡像／瀏覽器或降低 sandbox。

因此即時 JPEG、DOM 錄製、同會話輸入、實際重播、Vue UI E2E 與 44 個既有產品驗收案例仍未驗證。程式、真實 discovery、SQLite／PTY 與拒絕錯綠規則可獨立檢查。

## 真實 LLM provider

動作：產生 SD／補齊測試。結果：尚未設定 API key、model 及 provider context；API 回 503 `LLM_UNCONFIGURED`。沒有使用測試用 HTTP provider fixture 或預置案例內容替代真模型成功。

需在 server 設定憑證與模型，並提供實際專案缺少的 locator／fixture／業務資訊後才能跑相關驗收；若驗收條件不完整應回 NEEDS_INPUT，不擅自補造。

## AC021 輸入 fixture 會刪除骨架測試

位置：

- `tests/completion/support/database.ts:50` 前後，固定骨架包含 `test-a`、`test-b`、`test-a-extra`，完成版也引用此骨架。
- `tests/completion/support/workbench.ts:111` 以 `Boolean(p.extra)` 產生要保存的 spec，`:113` 也只在 `p.extra` 時保留 extra mapping。
- `tests/completion/steps/workbench.steps.ts:1545` 的 AC021 保存呼叫只帶 `kind`，未帶 `extra:true`。因此 spec.ts 分支會從原三個 tests 減為兩個，卻仍引用原骨架並要求保存成功。

這與 SD 0.4 §11.2「不得刪除原 test IDs／映射」相衝突。產品保留 `MAPPING_INVALID` 拒絕，不放寬基線規則，不偷偷修改既有 fixture／assertion。

最小建議：只修正 AC021 的**有效 spec 保存輸入**，明確帶 `extra:true` 並保留其三筆 mapping；其他驗證錯誤 fixture 維持原設計。這是待確認的測試修正提案，**尚未套用**。修改後也必須重新生成／檢查測試 implementation manifest，不能只改測試再沿用舊收據。

## 尚未證實的支援範圍

獨立重播的 popup／context.newPage 目前採拒絕未受管新頁的方式，不能假稱有完整逐步證據。網頁錄製並不等同官方桌面 codegen；原生視窗、CAPTCHA、複雜拖放及所有網站／iframe 不在此版已驗證支援範圍。

這些限制未改寫核准的 Gherkin／SD；產品目前是可啟動、可檢查的初版，尚非已驗收完成的工作台。
