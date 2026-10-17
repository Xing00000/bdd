// Generated from: spec/REQ-WB-001/workbench/workbench.feature
import { test } from "./testing/support/fixtures.ts";

test.describe('多人共用的BDD軟體開發工作台', () => {

  test.beforeEach('Background', async ({ Given, sut }, testInfo) => { if (testInfo.error) return;
    await Given('已選擇工作台的共用專案', null, { sut });
  });

  test('本工作台自身依Git中的確認流程開發', { tag: ['@AC-WB-001'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-001/default" }]}, async ({ Given, When, Then, And, sut }) => {
    await Given('本專案的Gherkin已寫入Xing00000的bdd Git儲存庫', null, { sut });
    await When('使用者尚未確認這份Gherkin', null, { sut });
    await Then('本專案維持等待Gherkin確認且不產生SD或產品實作', null, { sut });
    await When('使用者確認Gherkin後再確認對應SD', null, { sut });
    await Then('本專案才依序進入測試產生補齊與產品實作階段', null, { sut });
    await And('本專案的規格與文件與確認紀錄與測試全部保存在Git', null, { sut });
  });

  test('多人使用共用專案與集中文件', { tag: ['@AC-WB-002'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-002/default" }]}, async ({ Given, When, Then, sut }) => {
    await Given('兩位使用者開啟同一個共用專案', null, { sut });
    await When('一位使用者在專案保存Gherkin或SD文件', null, { sut });
    await Then('另一位使用者可在該專案讀取相同文件內容', null, { sut });
  });

  test('人類確認Gherkin後才產生SD', { tag: ['@AC-WB-003'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-003/default" }]}, async ({ Given, When, Then, And, sut }) => {
    await Given('工作台顯示專案處於Gherkin確認階段且已有Gherkin草稿', null, { sut });
    await When('人類按下確認Gherkin並要求產生SD', null, { sut });
    await Then('工作台流程狀態顯示SD確認且開啟SD編輯', null, { sut });
    await And('產生對應Gherkin的SD草稿供人類確認', null, { sut });
    await And('SD包含程式架構以及本次資料庫DDL與DML內容', null, { sut });
    await And('人類尚未確認SD時不進入產品開發', null, { sut });
  });

  test('SD確認後將Gherkin產生成Playwright測試骨架', { tag: ['@AC-WB-004'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-004/default" }]}, async ({ Given, When, Then, And, sut }) => {
    await Given('人類已確認專案Gherkin且工作台正顯示SD確認階段', null, { sut });
    await And('已備妥Gherkin生成器設定與明確的step definitions', null, { sut });
    await When('人類按下確認SD並要求產生測試', null, { sut });
    await Then('工作台流程狀態顯示test generation/completion', null, { sut });
    await And('產生可由Playwright找到的spec.ts檔案', null, { sut });
    await And('每個生成案例可對應來源Scenario及Examples列', null, { sut });
  });

  test('LLM補齊測試規格', { tag: ['@AC-WB-005'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-005/default" }]}, async ({ Given, When, Then, And, sut }) => {
    await Given('已產生對應確認文件的測試骨架', null, { sut });
    await When('LLM補齊操作步驟與預期結果的測試內容', null, { sut });
    await Then('補齊的測試仍對應人類已確認的驗收條件', null, { sut });
    await And('缺少預期結果資訊時列出待補內容而不自行改寫驗收條件', null, { sut });
  });

  test('依確認文件與測試進行開發', { tag: ['@AC-WB-006'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-006/default" }]}, async ({ Given, When, Then, And, sut }) => {
    await Given('Gherkin與SD已確認且測試規格已補齊', null, { sut });
    await When('使用者在工作台按下開始開發', null, { sut });
    await Then('工作台流程狀態顯示implementation', null, { sut });
    await And('可使用確認文件與測試作為開發依據', null, { sut });
    await And('開發完成後可開始驗證該次開發成果', null, { sut });
  });

  test('實際操作專案SQLite資料庫', { tag: ['@AC-WB-007'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-007/default" }]}, async ({ Given, When, Then, And, sut }) => {
    await Given('共用專案已有SQLite資料庫連線', null, { sut });
    await When('使用者瀏覽schema與資料並執行本次SD內的DDL或DML', null, { sut });
    await Then('工作台顯示實際schema與資料及SQL執行結果', null, { sut });
    await And('重新讀取資料庫時可看到實際變更', null, { sut });
  });

  test('使用PTY終端進行開發', { tag: ['@AC-WB-008'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-008/default" }]}, async ({ Given, When, Then, And, sut }) => {
    await Given('專案工作區已開啟', null, { sut });
    await When('使用者在PTY終端輸入命令並啟動專案程式', null, { sut });
    await Then('終端顯示該命令或程式的實際輸出', null, { sut });
    await And('使用者可繼續透過同一終端輸入', null, { sut });
  });

  test.describe('即時觀看Playwright使用中的瀏覽器', () => {

    test('agent', { tag: ['@AC-WB-009'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-009/agent" }]}, async ({ Given, When, Then, And, sut }) => {
      await Given('專案已有Playwright瀏覽器會話', null, { sut });
      await When('"agent"使用Playwright操作該會話的網頁', null, { sut });
      await Then('工作台內嵌畫面顯示該會話當前的網頁操作結果', null, { sut });
      await And('顯示的是操作中的會話而不是事後trace報告', null, { sut });
    });

    test('program', { tag: ['@AC-WB-009'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-009/program" }]}, async ({ Given, When, Then, And, sut }) => {
      await Given('專案已有Playwright瀏覽器會話', null, { sut });
      await When('"程式"使用Playwright操作該會話的網頁', null, { sut });
      await Then('工作台內嵌畫面顯示該會話當前的網頁操作結果', null, { sut });
      await And('顯示的是操作中的會話而不是事後trace報告', null, { sut });
    });

  });

  test('使用者親自操作內嵌瀏覽器並開始與停止錄製', { tag: ['@AC-WB-010'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-010/default" }]}, async ({ Given, When, Then, And, sut }) => {
    await Given('使用者已在工作台開啟可親自操作的內嵌瀏覽器', null, { sut });
    await When('使用者按下開始錄製', null, { sut });
    await And('使用者親自導覽網頁與點擊及輸入並選擇定位器與預期結果', null, { sut });
    await And('使用者按下停止錄製', null, { sut });
    await Then('產生包含該次操作與斷言的可檢查Playwright TypeScript腳本草稿', null, { sut });
    await And('停止後的新操作不再加入該次錄製', null, { sut });
    await And('該草稿屬於使用者自錄腳本而不是自動新增的標準CI測試', null, { sut });
    await And('不會自動更改Gherkin驗收條件', null, { sut });
  });

  test('被開發專案的CI測試跟著該專案Git', { tag: ['@AC-WB-011'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-011/default" }]}, async ({ Given, When, Then, And, sut }) => {
    await Given('測試被指定為被開發專案的CI測試', null, { sut });
    await When('保存測試並在該專案CI執行', null, { sut });
    await Then('測試檔案跟著該專案Git的branch與commit', null, { sut });
    await And('CI結果可對應該專案的實際commit', null, { sut });
    await And('工作台可在SQLite保存及讀回該commit對應的spec.ts內容副本', null, { sut });
    await And('該資料庫副本不取代target Git的標準CI測試版本或改變CI測試清單', null, { sut });
  });

  test('使用者自建整合測試保存在工作台資料庫', { tag: ['@AC-WB-012'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-012/default" }]}, async ({ Given, When, Then, And, sut }) => {
    await Given('使用者建立自己的整合測試', null, { sut });
    await When('在工作台保存測試定義與目標環境並要求執行', null, { sut });
    await Then('測試定義與執行紀錄保存在工作台SQLite', null, { sut });
    await And('該測試不會自動寫入被開發專案Git', null, { sut });
  });

  test('驗證開發成果並產生E2E報告', { tag: ['@AC-WB-013'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-013/default" }]}, async ({ Given, When, Then, And, sut }) => {
    await Given('專案開發完成且驗證測試已備妥', null, { sut });
    await When('使用者在工作台提交驗證並執行對應E2E測試', null, { sut });
    await Then('工作台流程狀態顯示verification/report', null, { sut });
    await And('報告列出各驗收案例的實際執行結果', null, { sut });
    await And('報告可對應Gherkin案例與被驗證的程式版本', null, { sut });
    await And('未通過或未執行的案例不被報成通過', null, { sut });
    await And('Playwright截圖可對應Scenario與step及該步驟實際結果', null, { sut });
  });

  test('缺少測試步驟實作不能當成通過', { tag: ['@AC-WB-014'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-014/default" }]}, async ({ Given, When, Then, And, sut }) => {
    await Given('Gherkin含有尚未定義或尚未實作的測試步驟', null, { sut });
    await When('產生或執行對應測試', null, { sut });
    await Then('生成器阻擋缺少定義的步驟或測試明確回報未實作', null, { sut });
    await And('不以空函式或刪除驗收案例換取通過', null, { sut });
  });

  test.describe('每個階段只可修改該階段的產物', () => {

    test('gherkin', { tag: ['@AC-WB-015'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-015/gherkin" }]}, async ({ Given, When, Then, And, sut }) => {
      await Given('工作台顯示專案目前在"Gherkin確認"階段且已有保存內容', null, { sut });
      await When('使用者在工作台嘗試保存禁止變更的"spec.ts"', null, { sut });
      await Then('工作台顯示此階段不可修改該產物', null, { sut });
      await And('該產物仍為上次保存內容', null, { sut });
      await And('工作台只對"Gherkin"提供本階段的編輯或執行入口', null, { sut });
      await And('"SD與測試與產品程式"維持鎖定', null, { sut });
    });

    test('sd', { tag: ['@AC-WB-015'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-015/sd" }]}, async ({ Given, When, Then, And, sut }) => {
      await Given('工作台顯示專案目前在"SD確認"階段且已有保存內容', null, { sut });
      await When('使用者在工作台嘗試保存禁止變更的"Gherkin"', null, { sut });
      await Then('工作台顯示此階段不可修改該產物', null, { sut });
      await And('該產物仍為上次保存內容', null, { sut });
      await And('工作台只對"SD文件"提供本階段的編輯或執行入口', null, { sut });
      await And('"已確認Gherkin與測試與產品程式"維持鎖定', null, { sut });
    });

    test('tests', { tag: ['@AC-WB-015'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-015/tests" }]}, async ({ Given, When, Then, And, sut }) => {
      await Given('工作台顯示專案目前在"test generation/completion"階段且已有保存內容', null, { sut });
      await When('使用者在工作台嘗試保存禁止變更的"Gherkin或SD"', null, { sut });
      await Then('工作台顯示此階段不可修改該產物', null, { sut });
      await And('該產物仍為上次保存內容', null, { sut });
      await And('工作台只對"spec.ts與step及測試所需檔案"提供本階段的編輯或執行入口', null, { sut });
      await And('"已確認Gherkin與SD"維持鎖定', null, { sut });
    });

    test('implementation', { tag: ['@AC-WB-015'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-015/implementation" }]}, async ({ Given, When, Then, And, sut }) => {
      await Given('工作台顯示專案目前在"implementation"階段且已有保存內容', null, { sut });
      await When('使用者在工作台嘗試保存禁止變更的"測試基線"', null, { sut });
      await Then('工作台顯示此階段不可修改該產物', null, { sut });
      await And('該產物仍為上次保存內容', null, { sut });
      await And('工作台只對"產品程式"提供本階段的編輯或執行入口', null, { sut });
      await And('"已確認Gherkin與SD及測試基線"維持鎖定', null, { sut });
    });

    test('verification', { tag: ['@AC-WB-015'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-015/verification" }]}, async ({ Given, When, Then, And, sut }) => {
      await Given('工作台顯示專案目前在"verification/report"階段且已有保存內容', null, { sut });
      await When('使用者在工作台嘗試保存禁止變更的"程式或測試"', null, { sut });
      await Then('工作台顯示此階段不可修改該產物', null, { sut });
      await And('該產物仍為上次保存內容', null, { sut });
      await And('工作台只對"執行既定測試與產生結果報告"提供本階段的編輯或執行入口', null, { sut });
      await And('"Gherkin與SD與測試基線及產品程式"維持鎖定', null, { sut });
    });

  });

  test.describe('修改上游產物必須退回對應階段並使下游結果失效', () => {

    test('gherkin', { tag: ['@AC-WB-016'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-016/gherkin" }]}, async ({ Given, When, Then, And, sut }) => {
      await Given('專案已有測試基線與驗證結果', null, { sut });
      await When('使用者在工作台選擇退回修改並指定"Gherkin"', null, { sut });
      await Then('工作台流程狀態顯示"Gherkin確認"才開啟該產物編輯', null, { sut });
      await And('工作台將依賴該產物的下游產物與驗證結果標示失效', null, { sut });
      await And('Gherkin或SD修改後未重新確認時不能再次前進', null, { sut });
      await And('完成該階段要求後依序重新產生或驗證下游結果', null, { sut });
      await And('不會在同一階段同時修改Gherkin與spec.ts', null, { sut });
    });

    test('sd', { tag: ['@AC-WB-016'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-016/sd" }]}, async ({ Given, When, Then, And, sut }) => {
      await Given('專案已有測試基線與驗證結果', null, { sut });
      await When('使用者在工作台選擇退回修改並指定"SD"', null, { sut });
      await Then('工作台流程狀態顯示"SD確認"才開啟該產物編輯', null, { sut });
      await And('工作台將依賴該產物的下游產物與驗證結果標示失效', null, { sut });
      await And('Gherkin或SD修改後未重新確認時不能再次前進', null, { sut });
      await And('完成該階段要求後依序重新產生或驗證下游結果', null, { sut });
      await And('不會在同一階段同時修改Gherkin與spec.ts', null, { sut });
    });

    test('tests', { tag: ['@AC-WB-016'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-016/tests" }]}, async ({ Given, When, Then, And, sut }) => {
      await Given('專案已有測試基線與驗證結果', null, { sut });
      await When('使用者在工作台選擇退回修改並指定"測試基線"', null, { sut });
      await Then('工作台流程狀態顯示"test generation/completion"才開啟該產物編輯', null, { sut });
      await And('工作台將依賴該產物的下游產物與驗證結果標示失效', null, { sut });
      await And('Gherkin或SD修改後未重新確認時不能再次前進', null, { sut });
      await And('完成該階段要求後依序重新產生或驗證下游結果', null, { sut });
      await And('不會在同一階段同時修改Gherkin與spec.ts', null, { sut });
    });

    test('source', { tag: ['@AC-WB-016'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-016/source" }]}, async ({ Given, When, Then, And, sut }) => {
      await Given('專案已有測試基線與驗證結果', null, { sut });
      await When('使用者在工作台選擇退回修改並指定"產品程式"', null, { sut });
      await Then('工作台流程狀態顯示"implementation"才開啟該產物編輯', null, { sut });
      await And('工作台將依賴該產物的下游產物與驗證結果標示失效', null, { sut });
      await And('Gherkin或SD修改後未重新確認時不能再次前進', null, { sut });
      await And('完成該階段要求後依序重新產生或驗證下游結果', null, { sut });
      await And('不會在同一階段同時修改Gherkin與spec.ts', null, { sut });
    });

  });

  test('spec透過Playwright操作網頁版DB並斷言測試資料', { tag: ['@AC-WB-017'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-017/default" }]}, async ({ Given, When, Then, And, sut }) => {
    await Given('被測專案的測試資料庫有帳號"scenario_user"且角色為"A"與狀態為"active"', null, { sut });
    await When('spec使用Playwright開啟工作台網頁版DB介面並查詢"scenario_user"', null, { sut });
    await Then('spec斷言實際查詢資料的角色為"A"且狀態為"active"', null, { sut });
    await And('每個Playwright操作與斷言步驟保存截圖並對應Scenario與step', null, { sut });
    await And('只有實際資料斷言符合預期才算該步驟通過', null, { sut });
  });

  test('修改被測帳號角色後重新登入驗證允許與拒絕的操作', { tag: ['@AC-WB-018'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-018/default" }]}, async ({ Given, When, Then, And, sut }) => {
    await Given('被測專案的測試帳號"scenario_user"在測試資料庫角色為"A"且已登入被測網站', null, { sut });
    await And('被測網站角色"A"僅可閱讀測試文件而角色"B"可編輯測試文件但不可管理帳號', null, { sut });
    await When('spec使用Playwright透過工作台網頁版DB將"scenario_user"角色由"A"改為"B"並保存', null, { sut });
    await And('spec重新查詢測試資料並斷言角色已實際變成"B"', null, { sut });
    await And('spec登出被測網站的舊登入狀態並以"scenario_user"重新登入', null, { sut });
    await And('spec在被測網站將"scenario_document"內容改為"edited"並開啟管理帳號頁面', null, { sut });
    await Then('spec斷言新登入頁面可看到角色"B"的編輯入口且文件保存成功', null, { sut });
    await And('spec透過網頁版DB斷言"scenario_document"的實際內容為"edited"', null, { sut });
    await And('spec斷言管理帳號頁面顯示拒絕且帳號資料沒有因此變更', null, { sut });
    await And('spec在前置資料確認與DB變更後及重新登入後保存截圖', null, { sut });
    await And('spec在每個主要操作與斷言步驟保存截圖並關聯實際結果', null, { sut });
  });

  test('人類測試流程的斷言失敗時留下截圖與失敗證據', { tag: ['@AC-WB-019'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-019/default" }]}, async ({ Given, When, Then, And, sut }) => {
    await Given('spec正在執行被測專案測試資料庫變更與重新登入的端到端情境', null, { sut });
    await When('spec在網頁畫面或DB資料斷言得到與預期不同的實際結果', null, { sut });
    await Then('Playwright保存失敗當下頁面的截圖', null, { sut });
    await And('報告列出該Scenario與失敗step及預期值與實際值及截圖', null, { sut });
    await And('該案例標示失敗而不因截圖保存成功改成通過', null, { sut });
  });

  test('重跑前重建明確的測試資料與登入初始狀態', { tag: ['@AC-WB-020'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-020/default" }]}, async ({ Given, When, Then, And, sut }) => {
    await Given('上一次執行已將測試帳號"scenario_user"改為角色"B"且測試文件內容已變更', null, { sut });
    await When('spec開始下一次執行並透過網頁版DB將該測試帳號角色設為"A"與"scenario_document"內容設為"initial"', null, { sut });
    await And('spec結束被測網站上一輪的登入狀態', null, { sut });
    await Then('spec斷言測試資料庫中的角色為"A"且"scenario_document"內容為"initial"', null, { sut });
    await And('Playwright保存本次前置資料初始狀態的截圖', null, { sut });
    await And('本次情境從該初始狀態重新執行DB變更與登入及操作驗證流程', null, { sut });
  });

  test.describe('在SQLite保存並重新讀取當次需求的Gherkin與spec.ts及SD', () => {

    test('gherkin', { tag: ['@AC-WB-021'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-021/gherkin" }]}, async ({ Given, When, Then, And, sut }) => {
      await Given('共用專案的當次需求已有"Gherkin"內容及需求編號與情境編號對應', null, { sut });
      await When('使用者在"Gherkin確認"階段將該產物保存到工作台SQLite', null, { sut });
      await And('使用者關閉並重新開啟該需求後讀取該產物', null, { sut });
      await Then('工作台從SQLite讀回與保存時相同的完整內容', null, { sut });
      await And('該產物仍連結相同的需求編號與對應情境編號', null, { sut });
      await And('這項產品儲存能力不改變bdd專案自身以Git保存開發文件與測試的方式', null, { sut });
    });

    test('tests', { tag: ['@AC-WB-021'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-021/tests" }]}, async ({ Given, When, Then, And, sut }) => {
      await Given('共用專案的當次需求已有"spec.ts"內容及需求編號與情境編號對應', null, { sut });
      await When('使用者在"test generation/completion"階段將該產物保存到工作台SQLite', null, { sut });
      await And('使用者關閉並重新開啟該需求後讀取該產物', null, { sut });
      await Then('工作台從SQLite讀回與保存時相同的完整內容', null, { sut });
      await And('該產物仍連結相同的需求編號與對應情境編號', null, { sut });
      await And('這項產品儲存能力不改變bdd專案自身以Git保存開發文件與測試的方式', null, { sut });
    });

    test('sd', { tag: ['@AC-WB-021'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-021/sd" }]}, async ({ Given, When, Then, And, sut }) => {
      await Given('共用專案的當次需求已有"SD"內容及需求編號與情境編號對應', null, { sut });
      await When('使用者在"SD確認"階段將該產物保存到工作台SQLite', null, { sut });
      await And('使用者關閉並重新開啟該需求後讀取該產物', null, { sut });
      await Then('工作台從SQLite讀回與保存時相同的完整內容', null, { sut });
      await And('該產物仍連結相同的需求編號與對應情境編號', null, { sut });
      await And('這項產品儲存能力不改變bdd專案自身以Git保存開發文件與測試的方式', null, { sut });
    });

  });

  test('另存並重播使用者自錄腳本而不混入標準CI測試', { tag: ['@AC-WB-022'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-022/default" }]}, async ({ Given, When, Then, And, sut }) => {
    await Given('使用者已停止一次內嵌瀏覽器錄製並取得腳本草稿', null, { sut });
    await When('使用者將腳本另存到工作台SQLite的使用者錄製腳本清單', null, { sut });
    await And('使用者重新開啟該已保存腳本並按下重播', null, { sut });
    await Then('工作台在瀏覽器實際重播已保存的操作與斷言', null, { sut });
    await And('顯示該次重播的實際結果而不是把保存成功當成測試通過', null, { sut });
    await And('該腳本保留已提供的需求與相關情境對應並與標準專案CI測試分開列示', null, { sut });
    await And('不會自動新增或修改target Git的CI測試檔案或CI測試清單', null, { sut });
  });

  test.describe('入庫前以對應語法解析器拒絕無效內容並保留有效版本', () => {

    test('gherkin', { tag: ['@AC-WB-023'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-023/gherkin" }]}, async ({ Given, When, Then, And, sut }) => {
      await Given('工作台SQLite已有"Gherkin"的有效原文與結構化資料', null, { sut });
      await And('使用者準備保存的同一檔案內容含語法錯誤', null, { sut });
      await When('使用者要求將該"Gherkin"內容保存到SQLite', null, { sut });
      await Then('工作台先以"Gherkin語法解析器"解析內容並拒絕將錯誤內容保存為有效版本', null, { sut });
      await And('回報錯誤的檔案名稱與行號及欄號與原因', null, { sut });
      await And('原有有效版本的原文與結構化資料及來源對應保持不變', null, { sut });
    });

    test('tests', { tag: ['@AC-WB-023'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-023/tests" }]}, async ({ Given, When, Then, And, sut }) => {
      await Given('工作台SQLite已有"spec.ts"的有效原文與結構化資料', null, { sut });
      await And('使用者準備保存的同一檔案內容含語法錯誤', null, { sut });
      await When('使用者要求將該"spec.ts"內容保存到SQLite', null, { sut });
      await Then('工作台先以"TypeScript語法解析器"解析內容並拒絕將錯誤內容保存為有效版本', null, { sut });
      await And('回報錯誤的檔案名稱與行號及欄號與原因', null, { sut });
      await And('原有有效版本的原文與結構化資料及來源對應保持不變', null, { sut });
    });

  });

  test('保存有效Gherkin原文及可查詢的結構化情境與步驟', { tag: ['@AC-WB-024'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-024/default" }]}, async ({ Given, When, Then, And, sut }) => {
    await Given('語法有效的Gherkin原文對應需求"REQ-DEMO-001"', null, { sut });
    await And('原文含Scenario Outline的Scenario ID"AC-DEMO-001"及有順序的steps與兩列Examples', null, { sut });
    await When('使用者將該Gherkin保存到SQLite', null, { sut });
    await Then('讀回的完整原文與提交內容逐字相同', null, { sut });
    await And('可結構化查詢需求編號與Scenario ID及各step的關鍵字與文字及順序', null, { sut });
    await And('可結構化查詢Examples的欄名與各列值及case_id且保留列順序', null, { sut });
    await And('原文與結構化資料均連結同一來源文件版本與內容hash', null, { sut });
  });

  test('保存標準生成spec.ts原文及明確的測試與來源情境對應', { tag: ['@AC-WB-025'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-025/default" }]}, async ({ Given, When, Then, And, sut }) => {
    await Given('指定來源版本的已確認Gherkin含情境"AC-DEMO-001"及Examples案例"a"與"b"', null, { sut });
    await And('標準生成的spec.ts語法有效且測試"test-a"與"test-b"分別明確對應該情境的案例"a"與"b"', null, { sut });
    await And('另一測試"test-a-extra"以不同test ID明確對應同一情境的案例"a"', null, { sut });
    await When('使用者將該spec.ts與明確ID對應保存到SQLite', null, { sut });
    await Then('讀回的完整spec.ts原文與提交內容逐字相同', null, { sut });
    await And('可結構化查詢每個test ID及其需求編號與Scenario ID及Examples case_id', null, { sut });
    await And('每筆對應可追溯spec.ts版本與內容hash及來源Gherkin版本與內容hash', null, { sut });
    await And('相同Scenario ID下的不同Examples案例可各自對應不同測試', null, { sut });
    await And('測試"test-a"與"test-a-extra"的映射均被保存且同時對應相同Scenario ID與Examples案例"a"', null, { sut });
    await And('重新讀取時仍取得原本的來源版本而不是自動改指向最新Gherkin', null, { sut });
  });

  test.describe('標準生成測試的明確ID映射不完整或無效時不能入庫為有效版本', () => {

    test('unmapped_test', { tag: ['@AC-WB-026'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-026/unmapped_test" }]}, async ({ Given, When, Then, And, sut }) => {
      await Given('工作台SQLite已有一份有效的標準生成spec.ts及其情境對應', null, { sut });
      await And('待保存的新spec.ts通過TypeScript語法解析但其明確ID映射存在"有測試未提供明確的情境與案例對應"', null, { sut });
      await When('使用者要求保存該標準生成測試與映射', null, { sut });
      await Then('工作台依指定來源版本的Gherkin與明確test ID映射拒絕該次保存', null, { sut });
      await And('回報"有測試未提供明確的情境與案例對應"及相關test ID或來源案例ID', null, { sut });
      await And('未提供的情境對應不被自動推測或補造', null, { sut });
      await And('原有有效spec.ts原文與結構化映射保持不變', null, { sut });
    });

    test('missing_case', { tag: ['@AC-WB-026'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-026/missing_case" }]}, async ({ Given, When, Then, And, sut }) => {
      await Given('工作台SQLite已有一份有效的標準生成spec.ts及其情境對應', null, { sut });
      await And('待保存的新spec.ts通過TypeScript語法解析但其明確ID映射存在"來源Gherkin有應生成的案例未對應任何測試"', null, { sut });
      await When('使用者要求保存該標準生成測試與映射', null, { sut });
      await Then('工作台依指定來源版本的Gherkin與明確test ID映射拒絕該次保存', null, { sut });
      await And('回報"來源Gherkin有應生成的案例未對應任何測試"及相關test ID或來源案例ID', null, { sut });
      await And('未提供的情境對應不被自動推測或補造', null, { sut });
      await And('原有有效spec.ts原文與結構化映射保持不變', null, { sut });
    });

    test('duplicate_test', { tag: ['@AC-WB-026'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-026/duplicate_test" }]}, async ({ Given, When, Then, And, sut }) => {
      await Given('工作台SQLite已有一份有效的標準生成spec.ts及其情境對應', null, { sut });
      await And('待保存的新spec.ts通過TypeScript語法解析但其明確ID映射存在"不同測試定義使用相同test ID"', null, { sut });
      await When('使用者要求保存該標準生成測試與映射', null, { sut });
      await Then('工作台依指定來源版本的Gherkin與明確test ID映射拒絕該次保存', null, { sut });
      await And('回報"不同測試定義使用相同test ID"及相關test ID或來源案例ID', null, { sut });
      await And('未提供的情境對應不被自動推測或補造', null, { sut });
      await And('原有有效spec.ts原文與結構化映射保持不變', null, { sut });
    });

    test('duplicate_case', { tag: ['@AC-WB-026'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-026/duplicate_case" }]}, async ({ Given, When, Then, And, sut }) => {
      await Given('工作台SQLite已有一份有效的標準生成spec.ts及其情境對應', null, { sut });
      await And('待保存的新spec.ts通過TypeScript語法解析但其明確ID映射存在"完全相同test ID與來源案例的映射資料重複"', null, { sut });
      await When('使用者要求保存該標準生成測試與映射', null, { sut });
      await Then('工作台依指定來源版本的Gherkin與明確test ID映射拒絕該次保存', null, { sut });
      await And('回報"完全相同test ID與來源案例的映射資料重複"及相關test ID或來源案例ID', null, { sut });
      await And('未提供的情境對應不被自動推測或補造', null, { sut });
      await And('原有有效spec.ts原文與結構化映射保持不變', null, { sut });
    });

    test('unknown_scenario', { tag: ['@AC-WB-026'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-026/unknown_scenario" }]}, async ({ Given, When, Then, And, sut }) => {
      await Given('工作台SQLite已有一份有效的標準生成spec.ts及其情境對應', null, { sut });
      await And('待保存的新spec.ts通過TypeScript語法解析但其明確ID映射存在"引用指定來源版本中不存在的Scenario ID"', null, { sut });
      await When('使用者要求保存該標準生成測試與映射', null, { sut });
      await Then('工作台依指定來源版本的Gherkin與明確test ID映射拒絕該次保存', null, { sut });
      await And('回報"引用指定來源版本中不存在的Scenario ID"及相關test ID或來源案例ID', null, { sut });
      await And('未提供的情境對應不被自動推測或補造', null, { sut });
      await And('原有有效spec.ts原文與結構化映射保持不變', null, { sut });
    });

    test('unknown_example', { tag: ['@AC-WB-026'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-026/unknown_example" }]}, async ({ Given, When, Then, And, sut }) => {
      await Given('工作台SQLite已有一份有效的標準生成spec.ts及其情境對應', null, { sut });
      await And('待保存的新spec.ts通過TypeScript語法解析但其明確ID映射存在"引用指定來源情境中不存在的Examples case_id"', null, { sut });
      await When('使用者要求保存該標準生成測試與映射', null, { sut });
      await Then('工作台依指定來源版本的Gherkin與明確test ID映射拒絕該次保存', null, { sut });
      await And('回報"引用指定來源情境中不存在的Examples case_id"及相關test ID或來源案例ID', null, { sut });
      await And('未提供的情境對應不被自動推測或補造', null, { sut });
      await And('原有有效spec.ts原文與結構化映射保持不變', null, { sut });
    });

  });

  test('未關聯需求情境的使用者自錄腳本仍可獨立保存及重播', { tag: ['@AC-WB-027'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-027/default" }]}, async ({ Given, When, Then, And, sut }) => {
    await Given('使用者已取得語法有效且未連結需求編號或Scenario ID的自錄Playwright腳本', null, { sut });
    await When('使用者將該腳本另存到SQLite的使用者錄製腳本清單', null, { sut });
    await Then('工作台保存完整原文且需求與情境對應維持未關聯', null, { sut });
    await And('不要求補造需求或Scenario ID以通過標準生成測試的映射檢核', null, { sut });
    await And('使用者可重新開啟該腳本並重播', null, { sut });
    await And('該腳本仍獨立於標準專案CI且不會自動新增或修改target Git的CI測試', null, { sut });
  });

  test('點選Gherkin案例執行並在右側觀看同次測試過程與結果', { tag: ['@AC-WB-028'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-028/default" }]}, async ({ Given, When, Then, And, sut }) => {
    await Given('專案已有Gherkin情境"AC-DEMO-001"及Examples案例"a"與"b"的spec.ts骨架與明確測試映射', null, { sut });
    await And('案例"a"對應測試"test-a"與"test-a-extra"且案例"b"對應測試"test-b"', null, { sut });
    await And('這些測試目前只有尚未由LLM補齊的codegen殼', null, { sut });
    await When('使用者開啟工作台的Gherkin測試清單', null, { sut });
    await Then('清單列出該情境與案例"a"及"b"及各自對應的test ID', null, { sut });
    await And('只有codegen殼的測試顯示待補齊且不可標示已通過', null, { sut });
    await When('使用者在測試已由LLM補齊且測試基線與程式版本已固定後點選案例"a"並按下執行', null, { sut });
    await Then('工作台建立本次run且runner只執行對應的spec.ts測試"test-a"與"test-a-extra"', null, { sut });
    await And('未選取的"test-b"本次不執行也不標示通過', null, { sut });
    await And('右側內嵌瀏覽器即時呈現本次run目前測試所用的同一session與page的真實操作', null, { sut });
    await And('各測試的實際斷言與每步截圖及成功或失敗結果均對應本次run與所選情境及案例', null, { sut });
    await And('只有所選案例的必要測試與斷言及證據完整通過才標示該案例通過', null, { sut });
    await And('所選案例通過不代表未執行的全專案案例已通過', null, { sut });
  });

});

// == technical section ==

test.use({
  $test: [({}, use) => use(test), { scope: 'test', box: true }],
  $uri: [({}, use) => use('spec/REQ-WB-001/workbench/workbench.feature'), { scope: 'test', box: true }],
  $bddFileData: [({}, use) => use(bddFileData as import('playwright-bdd').BddTestFixtures['$bddFileData']), { scope: "test", box: true }],
});

const bddFileData = [ // bdd-data-start
  {"pwTestLine":10,"pickleLine":12,"tags":["@AC-WB-001"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":11,"gherkinStepLine":13,"keywordType":"Context","textWithKeyword":"Given 本專案的Gherkin已寫入Xing00000的bdd Git儲存庫","stepMatchArguments":[]},{"pwStepLine":12,"gherkinStepLine":14,"keywordType":"Action","textWithKeyword":"When 使用者尚未確認這份Gherkin","stepMatchArguments":[]},{"pwStepLine":13,"gherkinStepLine":15,"keywordType":"Outcome","textWithKeyword":"Then 本專案維持等待Gherkin確認且不產生SD或產品實作","stepMatchArguments":[]},{"pwStepLine":14,"gherkinStepLine":16,"keywordType":"Action","textWithKeyword":"When 使用者確認Gherkin後再確認對應SD","stepMatchArguments":[]},{"pwStepLine":15,"gherkinStepLine":17,"keywordType":"Outcome","textWithKeyword":"Then 本專案才依序進入測試產生補齊與產品實作階段","stepMatchArguments":[]},{"pwStepLine":16,"gherkinStepLine":18,"keywordType":"Outcome","textWithKeyword":"And 本專案的規格與文件與確認紀錄與測試全部保存在Git","stepMatchArguments":[]}]},
  {"pwTestLine":19,"pickleLine":21,"tags":["@AC-WB-002"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":20,"gherkinStepLine":22,"keywordType":"Context","textWithKeyword":"Given 兩位使用者開啟同一個共用專案","stepMatchArguments":[]},{"pwStepLine":21,"gherkinStepLine":23,"keywordType":"Action","textWithKeyword":"When 一位使用者在專案保存Gherkin或SD文件","stepMatchArguments":[]},{"pwStepLine":22,"gherkinStepLine":24,"keywordType":"Outcome","textWithKeyword":"Then 另一位使用者可在該專案讀取相同文件內容","stepMatchArguments":[]}]},
  {"pwTestLine":25,"pickleLine":27,"tags":["@AC-WB-003"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":26,"gherkinStepLine":28,"keywordType":"Context","textWithKeyword":"Given 工作台顯示專案處於Gherkin確認階段且已有Gherkin草稿","stepMatchArguments":[]},{"pwStepLine":27,"gherkinStepLine":29,"keywordType":"Action","textWithKeyword":"When 人類按下確認Gherkin並要求產生SD","stepMatchArguments":[]},{"pwStepLine":28,"gherkinStepLine":30,"keywordType":"Outcome","textWithKeyword":"Then 工作台流程狀態顯示SD確認且開啟SD編輯","stepMatchArguments":[]},{"pwStepLine":29,"gherkinStepLine":31,"keywordType":"Outcome","textWithKeyword":"And 產生對應Gherkin的SD草稿供人類確認","stepMatchArguments":[]},{"pwStepLine":30,"gherkinStepLine":32,"keywordType":"Outcome","textWithKeyword":"And SD包含程式架構以及本次資料庫DDL與DML內容","stepMatchArguments":[]},{"pwStepLine":31,"gherkinStepLine":33,"keywordType":"Outcome","textWithKeyword":"And 人類尚未確認SD時不進入產品開發","stepMatchArguments":[]}]},
  {"pwTestLine":34,"pickleLine":36,"tags":["@AC-WB-004"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":35,"gherkinStepLine":37,"keywordType":"Context","textWithKeyword":"Given 人類已確認專案Gherkin且工作台正顯示SD確認階段","stepMatchArguments":[]},{"pwStepLine":36,"gherkinStepLine":38,"keywordType":"Context","textWithKeyword":"And 已備妥Gherkin生成器設定與明確的step definitions","stepMatchArguments":[]},{"pwStepLine":37,"gherkinStepLine":39,"keywordType":"Action","textWithKeyword":"When 人類按下確認SD並要求產生測試","stepMatchArguments":[]},{"pwStepLine":38,"gherkinStepLine":40,"keywordType":"Outcome","textWithKeyword":"Then 工作台流程狀態顯示test generation/completion","stepMatchArguments":[]},{"pwStepLine":39,"gherkinStepLine":41,"keywordType":"Outcome","textWithKeyword":"And 產生可由Playwright找到的spec.ts檔案","stepMatchArguments":[]},{"pwStepLine":40,"gherkinStepLine":42,"keywordType":"Outcome","textWithKeyword":"And 每個生成案例可對應來源Scenario及Examples列","stepMatchArguments":[]}]},
  {"pwTestLine":43,"pickleLine":45,"tags":["@AC-WB-005"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":44,"gherkinStepLine":46,"keywordType":"Context","textWithKeyword":"Given 已產生對應確認文件的測試骨架","stepMatchArguments":[]},{"pwStepLine":45,"gherkinStepLine":47,"keywordType":"Action","textWithKeyword":"When LLM補齊操作步驟與預期結果的測試內容","stepMatchArguments":[]},{"pwStepLine":46,"gherkinStepLine":48,"keywordType":"Outcome","textWithKeyword":"Then 補齊的測試仍對應人類已確認的驗收條件","stepMatchArguments":[]},{"pwStepLine":47,"gherkinStepLine":49,"keywordType":"Outcome","textWithKeyword":"And 缺少預期結果資訊時列出待補內容而不自行改寫驗收條件","stepMatchArguments":[]}]},
  {"pwTestLine":50,"pickleLine":52,"tags":["@AC-WB-006"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":51,"gherkinStepLine":53,"keywordType":"Context","textWithKeyword":"Given Gherkin與SD已確認且測試規格已補齊","stepMatchArguments":[]},{"pwStepLine":52,"gherkinStepLine":54,"keywordType":"Action","textWithKeyword":"When 使用者在工作台按下開始開發","stepMatchArguments":[]},{"pwStepLine":53,"gherkinStepLine":55,"keywordType":"Outcome","textWithKeyword":"Then 工作台流程狀態顯示implementation","stepMatchArguments":[]},{"pwStepLine":54,"gherkinStepLine":56,"keywordType":"Outcome","textWithKeyword":"And 可使用確認文件與測試作為開發依據","stepMatchArguments":[]},{"pwStepLine":55,"gherkinStepLine":57,"keywordType":"Outcome","textWithKeyword":"And 開發完成後可開始驗證該次開發成果","stepMatchArguments":[]}]},
  {"pwTestLine":58,"pickleLine":60,"tags":["@AC-WB-007"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":59,"gherkinStepLine":61,"keywordType":"Context","textWithKeyword":"Given 共用專案已有SQLite資料庫連線","stepMatchArguments":[]},{"pwStepLine":60,"gherkinStepLine":62,"keywordType":"Action","textWithKeyword":"When 使用者瀏覽schema與資料並執行本次SD內的DDL或DML","stepMatchArguments":[]},{"pwStepLine":61,"gherkinStepLine":63,"keywordType":"Outcome","textWithKeyword":"Then 工作台顯示實際schema與資料及SQL執行結果","stepMatchArguments":[]},{"pwStepLine":62,"gherkinStepLine":64,"keywordType":"Outcome","textWithKeyword":"And 重新讀取資料庫時可看到實際變更","stepMatchArguments":[]}]},
  {"pwTestLine":65,"pickleLine":67,"tags":["@AC-WB-008"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":66,"gherkinStepLine":68,"keywordType":"Context","textWithKeyword":"Given 專案工作區已開啟","stepMatchArguments":[]},{"pwStepLine":67,"gherkinStepLine":69,"keywordType":"Action","textWithKeyword":"When 使用者在PTY終端輸入命令並啟動專案程式","stepMatchArguments":[]},{"pwStepLine":68,"gherkinStepLine":70,"keywordType":"Outcome","textWithKeyword":"Then 終端顯示該命令或程式的實際輸出","stepMatchArguments":[]},{"pwStepLine":69,"gherkinStepLine":71,"keywordType":"Outcome","textWithKeyword":"And 使用者可繼續透過同一終端輸入","stepMatchArguments":[]}]},
  {"pwTestLine":74,"pickleLine":81,"tags":["@AC-WB-009"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":75,"gherkinStepLine":75,"keywordType":"Context","textWithKeyword":"Given 專案已有Playwright瀏覽器會話","stepMatchArguments":[]},{"pwStepLine":76,"gherkinStepLine":76,"keywordType":"Action","textWithKeyword":"When \"agent\"使用Playwright操作該會話的網頁","stepMatchArguments":[{"group":{"start":1,"value":"agent"}}]},{"pwStepLine":77,"gherkinStepLine":77,"keywordType":"Outcome","textWithKeyword":"Then 工作台內嵌畫面顯示該會話當前的網頁操作結果","stepMatchArguments":[]},{"pwStepLine":78,"gherkinStepLine":78,"keywordType":"Outcome","textWithKeyword":"And 顯示的是操作中的會話而不是事後trace報告","stepMatchArguments":[]}]},
  {"pwTestLine":81,"pickleLine":82,"tags":["@AC-WB-009"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":82,"gherkinStepLine":75,"keywordType":"Context","textWithKeyword":"Given 專案已有Playwright瀏覽器會話","stepMatchArguments":[]},{"pwStepLine":83,"gherkinStepLine":76,"keywordType":"Action","textWithKeyword":"When \"程式\"使用Playwright操作該會話的網頁","stepMatchArguments":[{"group":{"start":1,"value":"程式"}}]},{"pwStepLine":84,"gherkinStepLine":77,"keywordType":"Outcome","textWithKeyword":"Then 工作台內嵌畫面顯示該會話當前的網頁操作結果","stepMatchArguments":[]},{"pwStepLine":85,"gherkinStepLine":78,"keywordType":"Outcome","textWithKeyword":"And 顯示的是操作中的會話而不是事後trace報告","stepMatchArguments":[]}]},
  {"pwTestLine":90,"pickleLine":85,"tags":["@AC-WB-010"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":91,"gherkinStepLine":86,"keywordType":"Context","textWithKeyword":"Given 使用者已在工作台開啟可親自操作的內嵌瀏覽器","stepMatchArguments":[]},{"pwStepLine":92,"gherkinStepLine":87,"keywordType":"Action","textWithKeyword":"When 使用者按下開始錄製","stepMatchArguments":[]},{"pwStepLine":93,"gherkinStepLine":88,"keywordType":"Action","textWithKeyword":"And 使用者親自導覽網頁與點擊及輸入並選擇定位器與預期結果","stepMatchArguments":[]},{"pwStepLine":94,"gherkinStepLine":89,"keywordType":"Action","textWithKeyword":"And 使用者按下停止錄製","stepMatchArguments":[]},{"pwStepLine":95,"gherkinStepLine":90,"keywordType":"Outcome","textWithKeyword":"Then 產生包含該次操作與斷言的可檢查Playwright TypeScript腳本草稿","stepMatchArguments":[]},{"pwStepLine":96,"gherkinStepLine":91,"keywordType":"Outcome","textWithKeyword":"And 停止後的新操作不再加入該次錄製","stepMatchArguments":[]},{"pwStepLine":97,"gherkinStepLine":92,"keywordType":"Outcome","textWithKeyword":"And 該草稿屬於使用者自錄腳本而不是自動新增的標準CI測試","stepMatchArguments":[]},{"pwStepLine":98,"gherkinStepLine":93,"keywordType":"Outcome","textWithKeyword":"And 不會自動更改Gherkin驗收條件","stepMatchArguments":[]}]},
  {"pwTestLine":101,"pickleLine":96,"tags":["@AC-WB-011"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":102,"gherkinStepLine":97,"keywordType":"Context","textWithKeyword":"Given 測試被指定為被開發專案的CI測試","stepMatchArguments":[]},{"pwStepLine":103,"gherkinStepLine":98,"keywordType":"Action","textWithKeyword":"When 保存測試並在該專案CI執行","stepMatchArguments":[]},{"pwStepLine":104,"gherkinStepLine":99,"keywordType":"Outcome","textWithKeyword":"Then 測試檔案跟著該專案Git的branch與commit","stepMatchArguments":[]},{"pwStepLine":105,"gherkinStepLine":100,"keywordType":"Outcome","textWithKeyword":"And CI結果可對應該專案的實際commit","stepMatchArguments":[]},{"pwStepLine":106,"gherkinStepLine":101,"keywordType":"Outcome","textWithKeyword":"And 工作台可在SQLite保存及讀回該commit對應的spec.ts內容副本","stepMatchArguments":[]},{"pwStepLine":107,"gherkinStepLine":102,"keywordType":"Outcome","textWithKeyword":"And 該資料庫副本不取代target Git的標準CI測試版本或改變CI測試清單","stepMatchArguments":[]}]},
  {"pwTestLine":110,"pickleLine":105,"tags":["@AC-WB-012"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":111,"gherkinStepLine":106,"keywordType":"Context","textWithKeyword":"Given 使用者建立自己的整合測試","stepMatchArguments":[]},{"pwStepLine":112,"gherkinStepLine":107,"keywordType":"Action","textWithKeyword":"When 在工作台保存測試定義與目標環境並要求執行","stepMatchArguments":[]},{"pwStepLine":113,"gherkinStepLine":108,"keywordType":"Outcome","textWithKeyword":"Then 測試定義與執行紀錄保存在工作台SQLite","stepMatchArguments":[]},{"pwStepLine":114,"gherkinStepLine":109,"keywordType":"Outcome","textWithKeyword":"And 該測試不會自動寫入被開發專案Git","stepMatchArguments":[]}]},
  {"pwTestLine":117,"pickleLine":112,"tags":["@AC-WB-013"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":118,"gherkinStepLine":113,"keywordType":"Context","textWithKeyword":"Given 專案開發完成且驗證測試已備妥","stepMatchArguments":[]},{"pwStepLine":119,"gherkinStepLine":114,"keywordType":"Action","textWithKeyword":"When 使用者在工作台提交驗證並執行對應E2E測試","stepMatchArguments":[]},{"pwStepLine":120,"gherkinStepLine":115,"keywordType":"Outcome","textWithKeyword":"Then 工作台流程狀態顯示verification/report","stepMatchArguments":[]},{"pwStepLine":121,"gherkinStepLine":116,"keywordType":"Outcome","textWithKeyword":"And 報告列出各驗收案例的實際執行結果","stepMatchArguments":[]},{"pwStepLine":122,"gherkinStepLine":117,"keywordType":"Outcome","textWithKeyword":"And 報告可對應Gherkin案例與被驗證的程式版本","stepMatchArguments":[]},{"pwStepLine":123,"gherkinStepLine":118,"keywordType":"Outcome","textWithKeyword":"And 未通過或未執行的案例不被報成通過","stepMatchArguments":[]},{"pwStepLine":124,"gherkinStepLine":119,"keywordType":"Outcome","textWithKeyword":"And Playwright截圖可對應Scenario與step及該步驟實際結果","stepMatchArguments":[]}]},
  {"pwTestLine":127,"pickleLine":122,"tags":["@AC-WB-014"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":128,"gherkinStepLine":123,"keywordType":"Context","textWithKeyword":"Given Gherkin含有尚未定義或尚未實作的測試步驟","stepMatchArguments":[]},{"pwStepLine":129,"gherkinStepLine":124,"keywordType":"Action","textWithKeyword":"When 產生或執行對應測試","stepMatchArguments":[]},{"pwStepLine":130,"gherkinStepLine":125,"keywordType":"Outcome","textWithKeyword":"Then 生成器阻擋缺少定義的步驟或測試明確回報未實作","stepMatchArguments":[]},{"pwStepLine":131,"gherkinStepLine":126,"keywordType":"Outcome","textWithKeyword":"And 不以空函式或刪除驗收案例換取通過","stepMatchArguments":[]}]},
  {"pwTestLine":136,"pickleLine":138,"tags":["@AC-WB-015"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":137,"gherkinStepLine":130,"keywordType":"Context","textWithKeyword":"Given 工作台顯示專案目前在\"Gherkin確認\"階段且已有保存內容","stepMatchArguments":[{"group":{"start":11,"value":"Gherkin確認"}}]},{"pwStepLine":138,"gherkinStepLine":131,"keywordType":"Action","textWithKeyword":"When 使用者在工作台嘗試保存禁止變更的\"spec.ts\"","stepMatchArguments":[{"group":{"start":17,"value":"spec.ts"}}]},{"pwStepLine":139,"gherkinStepLine":132,"keywordType":"Outcome","textWithKeyword":"Then 工作台顯示此階段不可修改該產物","stepMatchArguments":[]},{"pwStepLine":140,"gherkinStepLine":133,"keywordType":"Outcome","textWithKeyword":"And 該產物仍為上次保存內容","stepMatchArguments":[]},{"pwStepLine":141,"gherkinStepLine":134,"keywordType":"Outcome","textWithKeyword":"And 工作台只對\"Gherkin\"提供本階段的編輯或執行入口","stepMatchArguments":[{"group":{"start":6,"value":"Gherkin"}}]},{"pwStepLine":142,"gherkinStepLine":135,"keywordType":"Outcome","textWithKeyword":"And \"SD與測試與產品程式\"維持鎖定","stepMatchArguments":[{"group":{"start":1,"value":"SD與測試與產品程式"}}]}]},
  {"pwTestLine":145,"pickleLine":139,"tags":["@AC-WB-015"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":146,"gherkinStepLine":130,"keywordType":"Context","textWithKeyword":"Given 工作台顯示專案目前在\"SD確認\"階段且已有保存內容","stepMatchArguments":[{"group":{"start":11,"value":"SD確認"}}]},{"pwStepLine":147,"gherkinStepLine":131,"keywordType":"Action","textWithKeyword":"When 使用者在工作台嘗試保存禁止變更的\"Gherkin\"","stepMatchArguments":[{"group":{"start":17,"value":"Gherkin"}}]},{"pwStepLine":148,"gherkinStepLine":132,"keywordType":"Outcome","textWithKeyword":"Then 工作台顯示此階段不可修改該產物","stepMatchArguments":[]},{"pwStepLine":149,"gherkinStepLine":133,"keywordType":"Outcome","textWithKeyword":"And 該產物仍為上次保存內容","stepMatchArguments":[]},{"pwStepLine":150,"gherkinStepLine":134,"keywordType":"Outcome","textWithKeyword":"And 工作台只對\"SD文件\"提供本階段的編輯或執行入口","stepMatchArguments":[{"group":{"start":6,"value":"SD文件"}}]},{"pwStepLine":151,"gherkinStepLine":135,"keywordType":"Outcome","textWithKeyword":"And \"已確認Gherkin與測試與產品程式\"維持鎖定","stepMatchArguments":[{"group":{"start":1,"value":"已確認Gherkin與測試與產品程式"}}]}]},
  {"pwTestLine":154,"pickleLine":140,"tags":["@AC-WB-015"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":155,"gherkinStepLine":130,"keywordType":"Context","textWithKeyword":"Given 工作台顯示專案目前在\"test generation/completion\"階段且已有保存內容","stepMatchArguments":[{"group":{"start":11,"value":"test generation/completion"}}]},{"pwStepLine":156,"gherkinStepLine":131,"keywordType":"Action","textWithKeyword":"When 使用者在工作台嘗試保存禁止變更的\"Gherkin或SD\"","stepMatchArguments":[{"group":{"start":17,"value":"Gherkin或SD"}}]},{"pwStepLine":157,"gherkinStepLine":132,"keywordType":"Outcome","textWithKeyword":"Then 工作台顯示此階段不可修改該產物","stepMatchArguments":[]},{"pwStepLine":158,"gherkinStepLine":133,"keywordType":"Outcome","textWithKeyword":"And 該產物仍為上次保存內容","stepMatchArguments":[]},{"pwStepLine":159,"gherkinStepLine":134,"keywordType":"Outcome","textWithKeyword":"And 工作台只對\"spec.ts與step及測試所需檔案\"提供本階段的編輯或執行入口","stepMatchArguments":[{"group":{"start":6,"value":"spec.ts與step及測試所需檔案"}}]},{"pwStepLine":160,"gherkinStepLine":135,"keywordType":"Outcome","textWithKeyword":"And \"已確認Gherkin與SD\"維持鎖定","stepMatchArguments":[{"group":{"start":1,"value":"已確認Gherkin與SD"}}]}]},
  {"pwTestLine":163,"pickleLine":141,"tags":["@AC-WB-015"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":164,"gherkinStepLine":130,"keywordType":"Context","textWithKeyword":"Given 工作台顯示專案目前在\"implementation\"階段且已有保存內容","stepMatchArguments":[{"group":{"start":11,"value":"implementation"}}]},{"pwStepLine":165,"gherkinStepLine":131,"keywordType":"Action","textWithKeyword":"When 使用者在工作台嘗試保存禁止變更的\"測試基線\"","stepMatchArguments":[{"group":{"start":17,"value":"測試基線"}}]},{"pwStepLine":166,"gherkinStepLine":132,"keywordType":"Outcome","textWithKeyword":"Then 工作台顯示此階段不可修改該產物","stepMatchArguments":[]},{"pwStepLine":167,"gherkinStepLine":133,"keywordType":"Outcome","textWithKeyword":"And 該產物仍為上次保存內容","stepMatchArguments":[]},{"pwStepLine":168,"gherkinStepLine":134,"keywordType":"Outcome","textWithKeyword":"And 工作台只對\"產品程式\"提供本階段的編輯或執行入口","stepMatchArguments":[{"group":{"start":6,"value":"產品程式"}}]},{"pwStepLine":169,"gherkinStepLine":135,"keywordType":"Outcome","textWithKeyword":"And \"已確認Gherkin與SD及測試基線\"維持鎖定","stepMatchArguments":[{"group":{"start":1,"value":"已確認Gherkin與SD及測試基線"}}]}]},
  {"pwTestLine":172,"pickleLine":142,"tags":["@AC-WB-015"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":173,"gherkinStepLine":130,"keywordType":"Context","textWithKeyword":"Given 工作台顯示專案目前在\"verification/report\"階段且已有保存內容","stepMatchArguments":[{"group":{"start":11,"value":"verification/report"}}]},{"pwStepLine":174,"gherkinStepLine":131,"keywordType":"Action","textWithKeyword":"When 使用者在工作台嘗試保存禁止變更的\"程式或測試\"","stepMatchArguments":[{"group":{"start":17,"value":"程式或測試"}}]},{"pwStepLine":175,"gherkinStepLine":132,"keywordType":"Outcome","textWithKeyword":"Then 工作台顯示此階段不可修改該產物","stepMatchArguments":[]},{"pwStepLine":176,"gherkinStepLine":133,"keywordType":"Outcome","textWithKeyword":"And 該產物仍為上次保存內容","stepMatchArguments":[]},{"pwStepLine":177,"gherkinStepLine":134,"keywordType":"Outcome","textWithKeyword":"And 工作台只對\"執行既定測試與產生結果報告\"提供本階段的編輯或執行入口","stepMatchArguments":[{"group":{"start":6,"value":"執行既定測試與產生結果報告"}}]},{"pwStepLine":178,"gherkinStepLine":135,"keywordType":"Outcome","textWithKeyword":"And \"Gherkin與SD與測試基線及產品程式\"維持鎖定","stepMatchArguments":[{"group":{"start":1,"value":"Gherkin與SD與測試基線及產品程式"}}]}]},
  {"pwTestLine":185,"pickleLine":155,"tags":["@AC-WB-016"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":186,"gherkinStepLine":146,"keywordType":"Context","textWithKeyword":"Given 專案已有測試基線與驗證結果","stepMatchArguments":[]},{"pwStepLine":187,"gherkinStepLine":147,"keywordType":"Action","textWithKeyword":"When 使用者在工作台選擇退回修改並指定\"Gherkin\"","stepMatchArguments":[{"group":{"start":17,"value":"Gherkin"}}]},{"pwStepLine":188,"gherkinStepLine":148,"keywordType":"Outcome","textWithKeyword":"Then 工作台流程狀態顯示\"Gherkin確認\"才開啟該產物編輯","stepMatchArguments":[{"group":{"start":10,"value":"Gherkin確認"}}]},{"pwStepLine":189,"gherkinStepLine":149,"keywordType":"Outcome","textWithKeyword":"And 工作台將依賴該產物的下游產物與驗證結果標示失效","stepMatchArguments":[]},{"pwStepLine":190,"gherkinStepLine":150,"keywordType":"Outcome","textWithKeyword":"And Gherkin或SD修改後未重新確認時不能再次前進","stepMatchArguments":[]},{"pwStepLine":191,"gherkinStepLine":151,"keywordType":"Outcome","textWithKeyword":"And 完成該階段要求後依序重新產生或驗證下游結果","stepMatchArguments":[]},{"pwStepLine":192,"gherkinStepLine":152,"keywordType":"Outcome","textWithKeyword":"And 不會在同一階段同時修改Gherkin與spec.ts","stepMatchArguments":[]}]},
  {"pwTestLine":195,"pickleLine":156,"tags":["@AC-WB-016"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":196,"gherkinStepLine":146,"keywordType":"Context","textWithKeyword":"Given 專案已有測試基線與驗證結果","stepMatchArguments":[]},{"pwStepLine":197,"gherkinStepLine":147,"keywordType":"Action","textWithKeyword":"When 使用者在工作台選擇退回修改並指定\"SD\"","stepMatchArguments":[{"group":{"start":17,"value":"SD"}}]},{"pwStepLine":198,"gherkinStepLine":148,"keywordType":"Outcome","textWithKeyword":"Then 工作台流程狀態顯示\"SD確認\"才開啟該產物編輯","stepMatchArguments":[{"group":{"start":10,"value":"SD確認"}}]},{"pwStepLine":199,"gherkinStepLine":149,"keywordType":"Outcome","textWithKeyword":"And 工作台將依賴該產物的下游產物與驗證結果標示失效","stepMatchArguments":[]},{"pwStepLine":200,"gherkinStepLine":150,"keywordType":"Outcome","textWithKeyword":"And Gherkin或SD修改後未重新確認時不能再次前進","stepMatchArguments":[]},{"pwStepLine":201,"gherkinStepLine":151,"keywordType":"Outcome","textWithKeyword":"And 完成該階段要求後依序重新產生或驗證下游結果","stepMatchArguments":[]},{"pwStepLine":202,"gherkinStepLine":152,"keywordType":"Outcome","textWithKeyword":"And 不會在同一階段同時修改Gherkin與spec.ts","stepMatchArguments":[]}]},
  {"pwTestLine":205,"pickleLine":157,"tags":["@AC-WB-016"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":206,"gherkinStepLine":146,"keywordType":"Context","textWithKeyword":"Given 專案已有測試基線與驗證結果","stepMatchArguments":[]},{"pwStepLine":207,"gherkinStepLine":147,"keywordType":"Action","textWithKeyword":"When 使用者在工作台選擇退回修改並指定\"測試基線\"","stepMatchArguments":[{"group":{"start":17,"value":"測試基線"}}]},{"pwStepLine":208,"gherkinStepLine":148,"keywordType":"Outcome","textWithKeyword":"Then 工作台流程狀態顯示\"test generation/completion\"才開啟該產物編輯","stepMatchArguments":[{"group":{"start":10,"value":"test generation/completion"}}]},{"pwStepLine":209,"gherkinStepLine":149,"keywordType":"Outcome","textWithKeyword":"And 工作台將依賴該產物的下游產物與驗證結果標示失效","stepMatchArguments":[]},{"pwStepLine":210,"gherkinStepLine":150,"keywordType":"Outcome","textWithKeyword":"And Gherkin或SD修改後未重新確認時不能再次前進","stepMatchArguments":[]},{"pwStepLine":211,"gherkinStepLine":151,"keywordType":"Outcome","textWithKeyword":"And 完成該階段要求後依序重新產生或驗證下游結果","stepMatchArguments":[]},{"pwStepLine":212,"gherkinStepLine":152,"keywordType":"Outcome","textWithKeyword":"And 不會在同一階段同時修改Gherkin與spec.ts","stepMatchArguments":[]}]},
  {"pwTestLine":215,"pickleLine":158,"tags":["@AC-WB-016"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":216,"gherkinStepLine":146,"keywordType":"Context","textWithKeyword":"Given 專案已有測試基線與驗證結果","stepMatchArguments":[]},{"pwStepLine":217,"gherkinStepLine":147,"keywordType":"Action","textWithKeyword":"When 使用者在工作台選擇退回修改並指定\"產品程式\"","stepMatchArguments":[{"group":{"start":17,"value":"產品程式"}}]},{"pwStepLine":218,"gherkinStepLine":148,"keywordType":"Outcome","textWithKeyword":"Then 工作台流程狀態顯示\"implementation\"才開啟該產物編輯","stepMatchArguments":[{"group":{"start":10,"value":"implementation"}}]},{"pwStepLine":219,"gherkinStepLine":149,"keywordType":"Outcome","textWithKeyword":"And 工作台將依賴該產物的下游產物與驗證結果標示失效","stepMatchArguments":[]},{"pwStepLine":220,"gherkinStepLine":150,"keywordType":"Outcome","textWithKeyword":"And Gherkin或SD修改後未重新確認時不能再次前進","stepMatchArguments":[]},{"pwStepLine":221,"gherkinStepLine":151,"keywordType":"Outcome","textWithKeyword":"And 完成該階段要求後依序重新產生或驗證下游結果","stepMatchArguments":[]},{"pwStepLine":222,"gherkinStepLine":152,"keywordType":"Outcome","textWithKeyword":"And 不會在同一階段同時修改Gherkin與spec.ts","stepMatchArguments":[]}]},
  {"pwTestLine":227,"pickleLine":162,"tags":["@AC-WB-017"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":228,"gherkinStepLine":163,"keywordType":"Context","textWithKeyword":"Given 被測專案的測試資料庫有帳號\"scenario_user\"且角色為\"A\"與狀態為\"active\"","stepMatchArguments":[]},{"pwStepLine":229,"gherkinStepLine":164,"keywordType":"Action","textWithKeyword":"When spec使用Playwright開啟工作台網頁版DB介面並查詢\"scenario_user\"","stepMatchArguments":[]},{"pwStepLine":230,"gherkinStepLine":165,"keywordType":"Outcome","textWithKeyword":"Then spec斷言實際查詢資料的角色為\"A\"且狀態為\"active\"","stepMatchArguments":[]},{"pwStepLine":231,"gherkinStepLine":166,"keywordType":"Outcome","textWithKeyword":"And 每個Playwright操作與斷言步驟保存截圖並對應Scenario與step","stepMatchArguments":[]},{"pwStepLine":232,"gherkinStepLine":167,"keywordType":"Outcome","textWithKeyword":"And 只有實際資料斷言符合預期才算該步驟通過","stepMatchArguments":[]}]},
  {"pwTestLine":235,"pickleLine":170,"tags":["@AC-WB-018"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":236,"gherkinStepLine":171,"keywordType":"Context","textWithKeyword":"Given 被測專案的測試帳號\"scenario_user\"在測試資料庫角色為\"A\"且已登入被測網站","stepMatchArguments":[]},{"pwStepLine":237,"gherkinStepLine":172,"keywordType":"Context","textWithKeyword":"And 被測網站角色\"A\"僅可閱讀測試文件而角色\"B\"可編輯測試文件但不可管理帳號","stepMatchArguments":[]},{"pwStepLine":238,"gherkinStepLine":173,"keywordType":"Action","textWithKeyword":"When spec使用Playwright透過工作台網頁版DB將\"scenario_user\"角色由\"A\"改為\"B\"並保存","stepMatchArguments":[]},{"pwStepLine":239,"gherkinStepLine":174,"keywordType":"Action","textWithKeyword":"And spec重新查詢測試資料並斷言角色已實際變成\"B\"","stepMatchArguments":[]},{"pwStepLine":240,"gherkinStepLine":175,"keywordType":"Action","textWithKeyword":"And spec登出被測網站的舊登入狀態並以\"scenario_user\"重新登入","stepMatchArguments":[]},{"pwStepLine":241,"gherkinStepLine":176,"keywordType":"Action","textWithKeyword":"And spec在被測網站將\"scenario_document\"內容改為\"edited\"並開啟管理帳號頁面","stepMatchArguments":[]},{"pwStepLine":242,"gherkinStepLine":177,"keywordType":"Outcome","textWithKeyword":"Then spec斷言新登入頁面可看到角色\"B\"的編輯入口且文件保存成功","stepMatchArguments":[]},{"pwStepLine":243,"gherkinStepLine":178,"keywordType":"Outcome","textWithKeyword":"And spec透過網頁版DB斷言\"scenario_document\"的實際內容為\"edited\"","stepMatchArguments":[]},{"pwStepLine":244,"gherkinStepLine":179,"keywordType":"Outcome","textWithKeyword":"And spec斷言管理帳號頁面顯示拒絕且帳號資料沒有因此變更","stepMatchArguments":[]},{"pwStepLine":245,"gherkinStepLine":180,"keywordType":"Outcome","textWithKeyword":"And spec在前置資料確認與DB變更後及重新登入後保存截圖","stepMatchArguments":[]},{"pwStepLine":246,"gherkinStepLine":181,"keywordType":"Outcome","textWithKeyword":"And spec在每個主要操作與斷言步驟保存截圖並關聯實際結果","stepMatchArguments":[]}]},
  {"pwTestLine":249,"pickleLine":184,"tags":["@AC-WB-019"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":250,"gherkinStepLine":185,"keywordType":"Context","textWithKeyword":"Given spec正在執行被測專案測試資料庫變更與重新登入的端到端情境","stepMatchArguments":[]},{"pwStepLine":251,"gherkinStepLine":186,"keywordType":"Action","textWithKeyword":"When spec在網頁畫面或DB資料斷言得到與預期不同的實際結果","stepMatchArguments":[]},{"pwStepLine":252,"gherkinStepLine":187,"keywordType":"Outcome","textWithKeyword":"Then Playwright保存失敗當下頁面的截圖","stepMatchArguments":[]},{"pwStepLine":253,"gherkinStepLine":188,"keywordType":"Outcome","textWithKeyword":"And 報告列出該Scenario與失敗step及預期值與實際值及截圖","stepMatchArguments":[]},{"pwStepLine":254,"gherkinStepLine":189,"keywordType":"Outcome","textWithKeyword":"And 該案例標示失敗而不因截圖保存成功改成通過","stepMatchArguments":[]}]},
  {"pwTestLine":257,"pickleLine":192,"tags":["@AC-WB-020"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":258,"gherkinStepLine":193,"keywordType":"Context","textWithKeyword":"Given 上一次執行已將測試帳號\"scenario_user\"改為角色\"B\"且測試文件內容已變更","stepMatchArguments":[]},{"pwStepLine":259,"gherkinStepLine":194,"keywordType":"Action","textWithKeyword":"When spec開始下一次執行並透過網頁版DB將該測試帳號角色設為\"A\"與\"scenario_document\"內容設為\"initial\"","stepMatchArguments":[]},{"pwStepLine":260,"gherkinStepLine":195,"keywordType":"Action","textWithKeyword":"And spec結束被測網站上一輪的登入狀態","stepMatchArguments":[]},{"pwStepLine":261,"gherkinStepLine":196,"keywordType":"Outcome","textWithKeyword":"Then spec斷言測試資料庫中的角色為\"A\"且\"scenario_document\"內容為\"initial\"","stepMatchArguments":[]},{"pwStepLine":262,"gherkinStepLine":197,"keywordType":"Outcome","textWithKeyword":"And Playwright保存本次前置資料初始狀態的截圖","stepMatchArguments":[]},{"pwStepLine":263,"gherkinStepLine":198,"keywordType":"Outcome","textWithKeyword":"And 本次情境從該初始狀態重新執行DB變更與登入及操作驗證流程","stepMatchArguments":[]}]},
  {"pwTestLine":268,"pickleLine":210,"tags":["@AC-WB-021"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":269,"gherkinStepLine":202,"keywordType":"Context","textWithKeyword":"Given 共用專案的當次需求已有\"Gherkin\"內容及需求編號與情境編號對應","stepMatchArguments":[{"group":{"start":12,"value":"Gherkin"}}]},{"pwStepLine":270,"gherkinStepLine":203,"keywordType":"Action","textWithKeyword":"When 使用者在\"Gherkin確認\"階段將該產物保存到工作台SQLite","stepMatchArguments":[{"group":{"start":5,"value":"Gherkin確認"}}]},{"pwStepLine":271,"gherkinStepLine":204,"keywordType":"Action","textWithKeyword":"And 使用者關閉並重新開啟該需求後讀取該產物","stepMatchArguments":[]},{"pwStepLine":272,"gherkinStepLine":205,"keywordType":"Outcome","textWithKeyword":"Then 工作台從SQLite讀回與保存時相同的完整內容","stepMatchArguments":[]},{"pwStepLine":273,"gherkinStepLine":206,"keywordType":"Outcome","textWithKeyword":"And 該產物仍連結相同的需求編號與對應情境編號","stepMatchArguments":[]},{"pwStepLine":274,"gherkinStepLine":207,"keywordType":"Outcome","textWithKeyword":"And 這項產品儲存能力不改變bdd專案自身以Git保存開發文件與測試的方式","stepMatchArguments":[]}]},
  {"pwTestLine":277,"pickleLine":211,"tags":["@AC-WB-021"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":278,"gherkinStepLine":202,"keywordType":"Context","textWithKeyword":"Given 共用專案的當次需求已有\"spec.ts\"內容及需求編號與情境編號對應","stepMatchArguments":[{"group":{"start":12,"value":"spec.ts"}}]},{"pwStepLine":279,"gherkinStepLine":203,"keywordType":"Action","textWithKeyword":"When 使用者在\"test generation/completion\"階段將該產物保存到工作台SQLite","stepMatchArguments":[{"group":{"start":5,"value":"test generation/completion"}}]},{"pwStepLine":280,"gherkinStepLine":204,"keywordType":"Action","textWithKeyword":"And 使用者關閉並重新開啟該需求後讀取該產物","stepMatchArguments":[]},{"pwStepLine":281,"gherkinStepLine":205,"keywordType":"Outcome","textWithKeyword":"Then 工作台從SQLite讀回與保存時相同的完整內容","stepMatchArguments":[]},{"pwStepLine":282,"gherkinStepLine":206,"keywordType":"Outcome","textWithKeyword":"And 該產物仍連結相同的需求編號與對應情境編號","stepMatchArguments":[]},{"pwStepLine":283,"gherkinStepLine":207,"keywordType":"Outcome","textWithKeyword":"And 這項產品儲存能力不改變bdd專案自身以Git保存開發文件與測試的方式","stepMatchArguments":[]}]},
  {"pwTestLine":286,"pickleLine":212,"tags":["@AC-WB-021"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":287,"gherkinStepLine":202,"keywordType":"Context","textWithKeyword":"Given 共用專案的當次需求已有\"SD\"內容及需求編號與情境編號對應","stepMatchArguments":[{"group":{"start":12,"value":"SD"}}]},{"pwStepLine":288,"gherkinStepLine":203,"keywordType":"Action","textWithKeyword":"When 使用者在\"SD確認\"階段將該產物保存到工作台SQLite","stepMatchArguments":[{"group":{"start":5,"value":"SD確認"}}]},{"pwStepLine":289,"gherkinStepLine":204,"keywordType":"Action","textWithKeyword":"And 使用者關閉並重新開啟該需求後讀取該產物","stepMatchArguments":[]},{"pwStepLine":290,"gherkinStepLine":205,"keywordType":"Outcome","textWithKeyword":"Then 工作台從SQLite讀回與保存時相同的完整內容","stepMatchArguments":[]},{"pwStepLine":291,"gherkinStepLine":206,"keywordType":"Outcome","textWithKeyword":"And 該產物仍連結相同的需求編號與對應情境編號","stepMatchArguments":[]},{"pwStepLine":292,"gherkinStepLine":207,"keywordType":"Outcome","textWithKeyword":"And 這項產品儲存能力不改變bdd專案自身以Git保存開發文件與測試的方式","stepMatchArguments":[]}]},
  {"pwTestLine":297,"pickleLine":215,"tags":["@AC-WB-022"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":298,"gherkinStepLine":216,"keywordType":"Context","textWithKeyword":"Given 使用者已停止一次內嵌瀏覽器錄製並取得腳本草稿","stepMatchArguments":[]},{"pwStepLine":299,"gherkinStepLine":217,"keywordType":"Action","textWithKeyword":"When 使用者將腳本另存到工作台SQLite的使用者錄製腳本清單","stepMatchArguments":[]},{"pwStepLine":300,"gherkinStepLine":218,"keywordType":"Action","textWithKeyword":"And 使用者重新開啟該已保存腳本並按下重播","stepMatchArguments":[]},{"pwStepLine":301,"gherkinStepLine":219,"keywordType":"Outcome","textWithKeyword":"Then 工作台在瀏覽器實際重播已保存的操作與斷言","stepMatchArguments":[]},{"pwStepLine":302,"gherkinStepLine":220,"keywordType":"Outcome","textWithKeyword":"And 顯示該次重播的實際結果而不是把保存成功當成測試通過","stepMatchArguments":[]},{"pwStepLine":303,"gherkinStepLine":221,"keywordType":"Outcome","textWithKeyword":"And 該腳本保留已提供的需求與相關情境對應並與標準專案CI測試分開列示","stepMatchArguments":[]},{"pwStepLine":304,"gherkinStepLine":222,"keywordType":"Outcome","textWithKeyword":"And 不會自動新增或修改target Git的CI測試檔案或CI測試清單","stepMatchArguments":[]}]},
  {"pwTestLine":309,"pickleLine":234,"tags":["@AC-WB-023"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":310,"gherkinStepLine":226,"keywordType":"Context","textWithKeyword":"Given 工作台SQLite已有\"Gherkin\"的有效原文與結構化資料","stepMatchArguments":[{"group":{"start":12,"value":"Gherkin"}}]},{"pwStepLine":311,"gherkinStepLine":227,"keywordType":"Context","textWithKeyword":"And 使用者準備保存的同一檔案內容含語法錯誤","stepMatchArguments":[]},{"pwStepLine":312,"gherkinStepLine":228,"keywordType":"Action","textWithKeyword":"When 使用者要求將該\"Gherkin\"內容保存到SQLite","stepMatchArguments":[{"group":{"start":8,"value":"Gherkin"}}]},{"pwStepLine":313,"gherkinStepLine":229,"keywordType":"Outcome","textWithKeyword":"Then 工作台先以\"Gherkin語法解析器\"解析內容並拒絕將錯誤內容保存為有效版本","stepMatchArguments":[{"group":{"start":6,"value":"Gherkin語法解析器"}}]},{"pwStepLine":314,"gherkinStepLine":230,"keywordType":"Outcome","textWithKeyword":"And 回報錯誤的檔案名稱與行號及欄號與原因","stepMatchArguments":[]},{"pwStepLine":315,"gherkinStepLine":231,"keywordType":"Outcome","textWithKeyword":"And 原有有效版本的原文與結構化資料及來源對應保持不變","stepMatchArguments":[]}]},
  {"pwTestLine":318,"pickleLine":235,"tags":["@AC-WB-023"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":319,"gherkinStepLine":226,"keywordType":"Context","textWithKeyword":"Given 工作台SQLite已有\"spec.ts\"的有效原文與結構化資料","stepMatchArguments":[{"group":{"start":12,"value":"spec.ts"}}]},{"pwStepLine":320,"gherkinStepLine":227,"keywordType":"Context","textWithKeyword":"And 使用者準備保存的同一檔案內容含語法錯誤","stepMatchArguments":[]},{"pwStepLine":321,"gherkinStepLine":228,"keywordType":"Action","textWithKeyword":"When 使用者要求將該\"spec.ts\"內容保存到SQLite","stepMatchArguments":[{"group":{"start":8,"value":"spec.ts"}}]},{"pwStepLine":322,"gherkinStepLine":229,"keywordType":"Outcome","textWithKeyword":"Then 工作台先以\"TypeScript語法解析器\"解析內容並拒絕將錯誤內容保存為有效版本","stepMatchArguments":[{"group":{"start":6,"value":"TypeScript語法解析器"}}]},{"pwStepLine":323,"gherkinStepLine":230,"keywordType":"Outcome","textWithKeyword":"And 回報錯誤的檔案名稱與行號及欄號與原因","stepMatchArguments":[]},{"pwStepLine":324,"gherkinStepLine":231,"keywordType":"Outcome","textWithKeyword":"And 原有有效版本的原文與結構化資料及來源對應保持不變","stepMatchArguments":[]}]},
  {"pwTestLine":329,"pickleLine":238,"tags":["@AC-WB-024"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":330,"gherkinStepLine":239,"keywordType":"Context","textWithKeyword":"Given 語法有效的Gherkin原文對應需求\"REQ-DEMO-001\"","stepMatchArguments":[]},{"pwStepLine":331,"gherkinStepLine":240,"keywordType":"Context","textWithKeyword":"And 原文含Scenario Outline的Scenario ID\"AC-DEMO-001\"及有順序的steps與兩列Examples","stepMatchArguments":[]},{"pwStepLine":332,"gherkinStepLine":241,"keywordType":"Action","textWithKeyword":"When 使用者將該Gherkin保存到SQLite","stepMatchArguments":[]},{"pwStepLine":333,"gherkinStepLine":242,"keywordType":"Outcome","textWithKeyword":"Then 讀回的完整原文與提交內容逐字相同","stepMatchArguments":[]},{"pwStepLine":334,"gherkinStepLine":243,"keywordType":"Outcome","textWithKeyword":"And 可結構化查詢需求編號與Scenario ID及各step的關鍵字與文字及順序","stepMatchArguments":[]},{"pwStepLine":335,"gherkinStepLine":244,"keywordType":"Outcome","textWithKeyword":"And 可結構化查詢Examples的欄名與各列值及case_id且保留列順序","stepMatchArguments":[]},{"pwStepLine":336,"gherkinStepLine":245,"keywordType":"Outcome","textWithKeyword":"And 原文與結構化資料均連結同一來源文件版本與內容hash","stepMatchArguments":[]}]},
  {"pwTestLine":339,"pickleLine":248,"tags":["@AC-WB-025"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":340,"gherkinStepLine":249,"keywordType":"Context","textWithKeyword":"Given 指定來源版本的已確認Gherkin含情境\"AC-DEMO-001\"及Examples案例\"a\"與\"b\"","stepMatchArguments":[]},{"pwStepLine":341,"gherkinStepLine":250,"keywordType":"Context","textWithKeyword":"And 標準生成的spec.ts語法有效且測試\"test-a\"與\"test-b\"分別明確對應該情境的案例\"a\"與\"b\"","stepMatchArguments":[]},{"pwStepLine":342,"gherkinStepLine":251,"keywordType":"Context","textWithKeyword":"And 另一測試\"test-a-extra\"以不同test ID明確對應同一情境的案例\"a\"","stepMatchArguments":[]},{"pwStepLine":343,"gherkinStepLine":252,"keywordType":"Action","textWithKeyword":"When 使用者將該spec.ts與明確ID對應保存到SQLite","stepMatchArguments":[]},{"pwStepLine":344,"gherkinStepLine":253,"keywordType":"Outcome","textWithKeyword":"Then 讀回的完整spec.ts原文與提交內容逐字相同","stepMatchArguments":[]},{"pwStepLine":345,"gherkinStepLine":254,"keywordType":"Outcome","textWithKeyword":"And 可結構化查詢每個test ID及其需求編號與Scenario ID及Examples case_id","stepMatchArguments":[]},{"pwStepLine":346,"gherkinStepLine":255,"keywordType":"Outcome","textWithKeyword":"And 每筆對應可追溯spec.ts版本與內容hash及來源Gherkin版本與內容hash","stepMatchArguments":[]},{"pwStepLine":347,"gherkinStepLine":256,"keywordType":"Outcome","textWithKeyword":"And 相同Scenario ID下的不同Examples案例可各自對應不同測試","stepMatchArguments":[]},{"pwStepLine":348,"gherkinStepLine":257,"keywordType":"Outcome","textWithKeyword":"And 測試\"test-a\"與\"test-a-extra\"的映射均被保存且同時對應相同Scenario ID與Examples案例\"a\"","stepMatchArguments":[]},{"pwStepLine":349,"gherkinStepLine":258,"keywordType":"Outcome","textWithKeyword":"And 重新讀取時仍取得原本的來源版本而不是自動改指向最新Gherkin","stepMatchArguments":[]}]},
  {"pwTestLine":354,"pickleLine":271,"tags":["@AC-WB-026"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":355,"gherkinStepLine":262,"keywordType":"Context","textWithKeyword":"Given 工作台SQLite已有一份有效的標準生成spec.ts及其情境對應","stepMatchArguments":[]},{"pwStepLine":356,"gherkinStepLine":263,"keywordType":"Context","textWithKeyword":"And 待保存的新spec.ts通過TypeScript語法解析但其明確ID映射存在\"有測試未提供明確的情境與案例對應\"","stepMatchArguments":[{"group":{"start":39,"value":"有測試未提供明確的情境與案例對應"}}]},{"pwStepLine":357,"gherkinStepLine":264,"keywordType":"Action","textWithKeyword":"When 使用者要求保存該標準生成測試與映射","stepMatchArguments":[]},{"pwStepLine":358,"gherkinStepLine":265,"keywordType":"Outcome","textWithKeyword":"Then 工作台依指定來源版本的Gherkin與明確test ID映射拒絕該次保存","stepMatchArguments":[]},{"pwStepLine":359,"gherkinStepLine":266,"keywordType":"Outcome","textWithKeyword":"And 回報\"有測試未提供明確的情境與案例對應\"及相關test ID或來源案例ID","stepMatchArguments":[{"group":{"start":3,"value":"有測試未提供明確的情境與案例對應"}}]},{"pwStepLine":360,"gherkinStepLine":267,"keywordType":"Outcome","textWithKeyword":"And 未提供的情境對應不被自動推測或補造","stepMatchArguments":[]},{"pwStepLine":361,"gherkinStepLine":268,"keywordType":"Outcome","textWithKeyword":"And 原有有效spec.ts原文與結構化映射保持不變","stepMatchArguments":[]}]},
  {"pwTestLine":364,"pickleLine":272,"tags":["@AC-WB-026"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":365,"gherkinStepLine":262,"keywordType":"Context","textWithKeyword":"Given 工作台SQLite已有一份有效的標準生成spec.ts及其情境對應","stepMatchArguments":[]},{"pwStepLine":366,"gherkinStepLine":263,"keywordType":"Context","textWithKeyword":"And 待保存的新spec.ts通過TypeScript語法解析但其明確ID映射存在\"來源Gherkin有應生成的案例未對應任何測試\"","stepMatchArguments":[{"group":{"start":39,"value":"來源Gherkin有應生成的案例未對應任何測試"}}]},{"pwStepLine":367,"gherkinStepLine":264,"keywordType":"Action","textWithKeyword":"When 使用者要求保存該標準生成測試與映射","stepMatchArguments":[]},{"pwStepLine":368,"gherkinStepLine":265,"keywordType":"Outcome","textWithKeyword":"Then 工作台依指定來源版本的Gherkin與明確test ID映射拒絕該次保存","stepMatchArguments":[]},{"pwStepLine":369,"gherkinStepLine":266,"keywordType":"Outcome","textWithKeyword":"And 回報\"來源Gherkin有應生成的案例未對應任何測試\"及相關test ID或來源案例ID","stepMatchArguments":[{"group":{"start":3,"value":"來源Gherkin有應生成的案例未對應任何測試"}}]},{"pwStepLine":370,"gherkinStepLine":267,"keywordType":"Outcome","textWithKeyword":"And 未提供的情境對應不被自動推測或補造","stepMatchArguments":[]},{"pwStepLine":371,"gherkinStepLine":268,"keywordType":"Outcome","textWithKeyword":"And 原有有效spec.ts原文與結構化映射保持不變","stepMatchArguments":[]}]},
  {"pwTestLine":374,"pickleLine":273,"tags":["@AC-WB-026"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":375,"gherkinStepLine":262,"keywordType":"Context","textWithKeyword":"Given 工作台SQLite已有一份有效的標準生成spec.ts及其情境對應","stepMatchArguments":[]},{"pwStepLine":376,"gherkinStepLine":263,"keywordType":"Context","textWithKeyword":"And 待保存的新spec.ts通過TypeScript語法解析但其明確ID映射存在\"不同測試定義使用相同test ID\"","stepMatchArguments":[{"group":{"start":39,"value":"不同測試定義使用相同test ID"}}]},{"pwStepLine":377,"gherkinStepLine":264,"keywordType":"Action","textWithKeyword":"When 使用者要求保存該標準生成測試與映射","stepMatchArguments":[]},{"pwStepLine":378,"gherkinStepLine":265,"keywordType":"Outcome","textWithKeyword":"Then 工作台依指定來源版本的Gherkin與明確test ID映射拒絕該次保存","stepMatchArguments":[]},{"pwStepLine":379,"gherkinStepLine":266,"keywordType":"Outcome","textWithKeyword":"And 回報\"不同測試定義使用相同test ID\"及相關test ID或來源案例ID","stepMatchArguments":[{"group":{"start":3,"value":"不同測試定義使用相同test ID"}}]},{"pwStepLine":380,"gherkinStepLine":267,"keywordType":"Outcome","textWithKeyword":"And 未提供的情境對應不被自動推測或補造","stepMatchArguments":[]},{"pwStepLine":381,"gherkinStepLine":268,"keywordType":"Outcome","textWithKeyword":"And 原有有效spec.ts原文與結構化映射保持不變","stepMatchArguments":[]}]},
  {"pwTestLine":384,"pickleLine":274,"tags":["@AC-WB-026"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":385,"gherkinStepLine":262,"keywordType":"Context","textWithKeyword":"Given 工作台SQLite已有一份有效的標準生成spec.ts及其情境對應","stepMatchArguments":[]},{"pwStepLine":386,"gherkinStepLine":263,"keywordType":"Context","textWithKeyword":"And 待保存的新spec.ts通過TypeScript語法解析但其明確ID映射存在\"完全相同test ID與來源案例的映射資料重複\"","stepMatchArguments":[{"group":{"start":39,"value":"完全相同test ID與來源案例的映射資料重複"}}]},{"pwStepLine":387,"gherkinStepLine":264,"keywordType":"Action","textWithKeyword":"When 使用者要求保存該標準生成測試與映射","stepMatchArguments":[]},{"pwStepLine":388,"gherkinStepLine":265,"keywordType":"Outcome","textWithKeyword":"Then 工作台依指定來源版本的Gherkin與明確test ID映射拒絕該次保存","stepMatchArguments":[]},{"pwStepLine":389,"gherkinStepLine":266,"keywordType":"Outcome","textWithKeyword":"And 回報\"完全相同test ID與來源案例的映射資料重複\"及相關test ID或來源案例ID","stepMatchArguments":[{"group":{"start":3,"value":"完全相同test ID與來源案例的映射資料重複"}}]},{"pwStepLine":390,"gherkinStepLine":267,"keywordType":"Outcome","textWithKeyword":"And 未提供的情境對應不被自動推測或補造","stepMatchArguments":[]},{"pwStepLine":391,"gherkinStepLine":268,"keywordType":"Outcome","textWithKeyword":"And 原有有效spec.ts原文與結構化映射保持不變","stepMatchArguments":[]}]},
  {"pwTestLine":394,"pickleLine":275,"tags":["@AC-WB-026"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":395,"gherkinStepLine":262,"keywordType":"Context","textWithKeyword":"Given 工作台SQLite已有一份有效的標準生成spec.ts及其情境對應","stepMatchArguments":[]},{"pwStepLine":396,"gherkinStepLine":263,"keywordType":"Context","textWithKeyword":"And 待保存的新spec.ts通過TypeScript語法解析但其明確ID映射存在\"引用指定來源版本中不存在的Scenario ID\"","stepMatchArguments":[{"group":{"start":39,"value":"引用指定來源版本中不存在的Scenario ID"}}]},{"pwStepLine":397,"gherkinStepLine":264,"keywordType":"Action","textWithKeyword":"When 使用者要求保存該標準生成測試與映射","stepMatchArguments":[]},{"pwStepLine":398,"gherkinStepLine":265,"keywordType":"Outcome","textWithKeyword":"Then 工作台依指定來源版本的Gherkin與明確test ID映射拒絕該次保存","stepMatchArguments":[]},{"pwStepLine":399,"gherkinStepLine":266,"keywordType":"Outcome","textWithKeyword":"And 回報\"引用指定來源版本中不存在的Scenario ID\"及相關test ID或來源案例ID","stepMatchArguments":[{"group":{"start":3,"value":"引用指定來源版本中不存在的Scenario ID"}}]},{"pwStepLine":400,"gherkinStepLine":267,"keywordType":"Outcome","textWithKeyword":"And 未提供的情境對應不被自動推測或補造","stepMatchArguments":[]},{"pwStepLine":401,"gherkinStepLine":268,"keywordType":"Outcome","textWithKeyword":"And 原有有效spec.ts原文與結構化映射保持不變","stepMatchArguments":[]}]},
  {"pwTestLine":404,"pickleLine":276,"tags":["@AC-WB-026"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":405,"gherkinStepLine":262,"keywordType":"Context","textWithKeyword":"Given 工作台SQLite已有一份有效的標準生成spec.ts及其情境對應","stepMatchArguments":[]},{"pwStepLine":406,"gherkinStepLine":263,"keywordType":"Context","textWithKeyword":"And 待保存的新spec.ts通過TypeScript語法解析但其明確ID映射存在\"引用指定來源情境中不存在的Examples case_id\"","stepMatchArguments":[{"group":{"start":39,"value":"引用指定來源情境中不存在的Examples case_id"}}]},{"pwStepLine":407,"gherkinStepLine":264,"keywordType":"Action","textWithKeyword":"When 使用者要求保存該標準生成測試與映射","stepMatchArguments":[]},{"pwStepLine":408,"gherkinStepLine":265,"keywordType":"Outcome","textWithKeyword":"Then 工作台依指定來源版本的Gherkin與明確test ID映射拒絕該次保存","stepMatchArguments":[]},{"pwStepLine":409,"gherkinStepLine":266,"keywordType":"Outcome","textWithKeyword":"And 回報\"引用指定來源情境中不存在的Examples case_id\"及相關test ID或來源案例ID","stepMatchArguments":[{"group":{"start":3,"value":"引用指定來源情境中不存在的Examples case_id"}}]},{"pwStepLine":410,"gherkinStepLine":267,"keywordType":"Outcome","textWithKeyword":"And 未提供的情境對應不被自動推測或補造","stepMatchArguments":[]},{"pwStepLine":411,"gherkinStepLine":268,"keywordType":"Outcome","textWithKeyword":"And 原有有效spec.ts原文與結構化映射保持不變","stepMatchArguments":[]}]},
  {"pwTestLine":416,"pickleLine":279,"tags":["@AC-WB-027"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":417,"gherkinStepLine":280,"keywordType":"Context","textWithKeyword":"Given 使用者已取得語法有效且未連結需求編號或Scenario ID的自錄Playwright腳本","stepMatchArguments":[]},{"pwStepLine":418,"gherkinStepLine":281,"keywordType":"Action","textWithKeyword":"When 使用者將該腳本另存到SQLite的使用者錄製腳本清單","stepMatchArguments":[]},{"pwStepLine":419,"gherkinStepLine":282,"keywordType":"Outcome","textWithKeyword":"Then 工作台保存完整原文且需求與情境對應維持未關聯","stepMatchArguments":[]},{"pwStepLine":420,"gherkinStepLine":283,"keywordType":"Outcome","textWithKeyword":"And 不要求補造需求或Scenario ID以通過標準生成測試的映射檢核","stepMatchArguments":[]},{"pwStepLine":421,"gherkinStepLine":284,"keywordType":"Outcome","textWithKeyword":"And 使用者可重新開啟該腳本並重播","stepMatchArguments":[]},{"pwStepLine":422,"gherkinStepLine":285,"keywordType":"Outcome","textWithKeyword":"And 該腳本仍獨立於標準專案CI且不會自動新增或修改target Git的CI測試","stepMatchArguments":[]}]},
  {"pwTestLine":425,"pickleLine":288,"tags":["@AC-WB-028"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的共用專案","isBg":true,"stepMatchArguments":[]},{"pwStepLine":426,"gherkinStepLine":289,"keywordType":"Context","textWithKeyword":"Given 專案已有Gherkin情境\"AC-DEMO-001\"及Examples案例\"a\"與\"b\"的spec.ts骨架與明確測試映射","stepMatchArguments":[]},{"pwStepLine":427,"gherkinStepLine":290,"keywordType":"Context","textWithKeyword":"And 案例\"a\"對應測試\"test-a\"與\"test-a-extra\"且案例\"b\"對應測試\"test-b\"","stepMatchArguments":[]},{"pwStepLine":428,"gherkinStepLine":291,"keywordType":"Context","textWithKeyword":"And 這些測試目前只有尚未由LLM補齊的codegen殼","stepMatchArguments":[]},{"pwStepLine":429,"gherkinStepLine":292,"keywordType":"Action","textWithKeyword":"When 使用者開啟工作台的Gherkin測試清單","stepMatchArguments":[]},{"pwStepLine":430,"gherkinStepLine":293,"keywordType":"Outcome","textWithKeyword":"Then 清單列出該情境與案例\"a\"及\"b\"及各自對應的test ID","stepMatchArguments":[]},{"pwStepLine":431,"gherkinStepLine":294,"keywordType":"Outcome","textWithKeyword":"And 只有codegen殼的測試顯示待補齊且不可標示已通過","stepMatchArguments":[]},{"pwStepLine":432,"gherkinStepLine":295,"keywordType":"Action","textWithKeyword":"When 使用者在測試已由LLM補齊且測試基線與程式版本已固定後點選案例\"a\"並按下執行","stepMatchArguments":[]},{"pwStepLine":433,"gherkinStepLine":296,"keywordType":"Outcome","textWithKeyword":"Then 工作台建立本次run且runner只執行對應的spec.ts測試\"test-a\"與\"test-a-extra\"","stepMatchArguments":[]},{"pwStepLine":434,"gherkinStepLine":297,"keywordType":"Outcome","textWithKeyword":"And 未選取的\"test-b\"本次不執行也不標示通過","stepMatchArguments":[]},{"pwStepLine":435,"gherkinStepLine":298,"keywordType":"Outcome","textWithKeyword":"And 右側內嵌瀏覽器即時呈現本次run目前測試所用的同一session與page的真實操作","stepMatchArguments":[]},{"pwStepLine":436,"gherkinStepLine":299,"keywordType":"Outcome","textWithKeyword":"And 各測試的實際斷言與每步截圖及成功或失敗結果均對應本次run與所選情境及案例","stepMatchArguments":[]},{"pwStepLine":437,"gherkinStepLine":300,"keywordType":"Outcome","textWithKeyword":"And 只有所選案例的必要測試與斷言及證據完整通過才標示該案例通過","stepMatchArguments":[]},{"pwStepLine":438,"gherkinStepLine":301,"keywordType":"Outcome","textWithKeyword":"And 所選案例通過不代表未執行的全專案案例已通過","stepMatchArguments":[]}]},
]; // bdd-data-end