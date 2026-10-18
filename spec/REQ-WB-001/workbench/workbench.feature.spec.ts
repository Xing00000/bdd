// Generated from: spec/REQ-WB-001/workbench/workbench.feature
import { test } from "./testing/support/fixtures.ts";

test.describe('多人共用的BDD軟體開發工作台', () => {

  test.beforeEach('Background', async ({ Given, sut }, testInfo) => { if (testInfo.error) return;
    await Given('已選擇工作台的需求', null, { sut });
  });

  test('本工作台自身依Git中的確認流程開發', { tag: ['@AC-WB-001'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-001/default" }]}, async ({ Given, When, Then, And, sut }) => {
    await Given('本專案的Gherkin已寫入Xing00000的bdd Git儲存庫', null, { sut });
    await When('使用者尚未確認這份Gherkin', null, { sut });
    await Then('本專案維持等待Gherkin確認且不產生SD或產品實作', null, { sut });
    await When('使用者確認Gherkin後再確認對應SD', null, { sut });
    await Then('本專案才依序進入測試產生補齊與產品實作階段', null, { sut });
    await And('本專案的規格與文件與確認紀錄與測試全部保存在Git', null, { sut });
  });

  test('多人處理同一需求與集中文件', { tag: ['@AC-WB-002'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-002/default" }]}, async ({ Given, When, Then, sut }) => {
    await Given('兩位使用者開啟同一個需求', null, { sut });
    await When('一位使用者在需求保存Gherkin或SD文件', null, { sut });
    await Then('另一位使用者可在該需求讀取相同文件內容', null, { sut });
  });

  test('人類確認Gherkin後才產生SD', { tag: ['@AC-WB-003'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-003/default" }]}, async ({ Given, When, Then, And, sut }) => {
    await Given('工作台顯示所選Gherkin處於確認階段且已有草稿', null, { sut });
    await When('人類確認Gherkin並選擇已指派的系統設計Agent產生SD', null, { sut });
    await Then('工作台流程狀態顯示SD確認且開啟SD編輯', null, { sut });
    await And('使用設定的互動CLI在網頁terminal提出SD草稿', null, { sut });
    await And('產生對應Gherkin的SD草稿供人類確認', null, { sut });
    await And('SD包含程式架構以及本次資料庫DDL與DML內容', null, { sut });
    await And('人類尚未確認SD時不進入產品開發', null, { sut });
  });

  test('SD確認後將Gherkin產生成Playwright測試骨架', { tag: ['@AC-WB-004'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-004/default" }]}, async ({ Given, When, Then, And, sut }) => {
    await Given('人類已確認該Gherkin與SD', null, { sut });
    await When('人類確認SD', null, { sut });
    await Then('工作台進入測試情境階段並自動產生唯讀的spec.ts骨架', null, { sut });
    await And('spec.ts預設收合且每個案例對應來源Scenario及Examples列', null, { sut });
    await And('人類不能直接編輯生成骨架', null, { sut });
  });

  test('使用已指派Agent補齊測試步驟', { tag: ['@AC-WB-005'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-005/default" }]}, async ({ Given, When, Then, And, sut }) => {
    await Given('已產生對應確認文件的測試骨架', null, { sut });
    await When('使用者選擇已指派的測試Agent並透過互動CLI補齊測試步驟', null, { sut });
    await Then('補齊的測試仍對應人類已確認的驗收條件', null, { sut });
    await And('CLI在獨立工作目錄讀取經SHA-256核對的官方Playwright-BDD Skill', null, { sut });
    await And('缺少預期結果資訊時列出待補內容而不自行改寫驗收條件', null, { sut });
  });

  test('依確認文件與測試進行開發', { tag: ['@AC-WB-006'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-006/default" }]}, async ({ Given, When, Then, And, sut }) => {
    await Given('Gherkin與SD已確認且測試規格已補齊', null, { sut });
    await When('人類確認已完成檢核的測試步驟', null, { sut });
    await Then('工作台流程狀態顯示implementation', null, { sut });
    await And('測試基線固定且自動進入程式開發階段', null, { sut });
    await And('可使用已確認文件及測試基線作為開發依據', null, { sut });
    await And('開發完成後可開始驗證該次開發成果', null, { sut });
  });

  test('透過DbGate實際操作專案SQLite資料庫', { tag: ['@AC-WB-007'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-007/default" }]}, async ({ Given, When, Then, And, sut }) => {
    await Given('共用專案已設定DbGate網頁入口與SQLite測試資料庫連線', null, { sut });
    await When('使用者透過DbGate瀏覽schema與資料並執行本次SD內的DDL或DML', null, { sut });
    await Then('DbGate顯示該測試資料庫的實際schema與資料及SQL執行結果', null, { sut });
    await And('重新讀取資料庫時可看到實際變更', null, { sut });
  });

  test('從固定工作區選單開啟真實PTY終端', { tag: ['@AC-WB-008'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-008/default" }]}, async ({ Given, When, Then, sut }) => {
    await Given('至少一個工作區已綁定本機程式碼目錄', null, { sut });
    await When('使用者從左側Terminal選擇工作區', null, { sut });
    await Then('右側直接開啟該工作區的終端頁籤且內容只有終端', null, { sut });
    await When('使用者輸入命令並啟動專案程式', null, { sut });
    await Then('同一PTY顯示實際輸出且可繼續輸入', null, { sut });
    await When('使用者關閉終端頁籤', null, { sut });
    await Then('該PTY程序被中止', null, { sut });
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

  test('使用全域瀏覽器錄製並保存重播', { tag: ['@AC-WB-010'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-010/default" }]}, async ({ Given, When, Then, And, sut }) => {
    await Given('使用者從固定選單開啟瀏覽器錄製', null, { sut });
    await When('使用者輸入網址前往、錄製並操作網頁、停止後命名保存', null, { sut });
    await Then('已保存名稱出現在左側瀏覽器錄製下方', null, { sut });
    await And('開啟保存內容時上方顯示播放與刪除且下方顯示Playwright腳本', null, { sut });
    await When('使用者按播放', null, { sut });
    await Then('瀏覽器視窗展開並重播保存的動作', null, { sut });
    await And('全域錄製不要求關聯專案或需求且不自動成為CI測試', null, { sut });
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

  test('spec透過Playwright操作DbGate並斷言測試資料', { tag: ['@AC-WB-017'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-017/default" }]}, async ({ Given, When, Then, And, sut }) => {
    await Given('被測專案的測試資料庫有帳號"scenario_user"且角色為"A"與狀態為"active"', null, { sut });
    await When('spec使用Playwright開啟專案的DbGate網頁介面並查詢"scenario_user"', null, { sut });
    await Then('spec斷言實際查詢資料的角色為"A"且狀態為"active"', null, { sut });
    await And('每個Playwright操作與斷言步驟保存截圖並對應Scenario與step', null, { sut });
    await And('只有實際資料斷言符合預期才算該步驟通過', null, { sut });
  });

  test('修改被測帳號角色後重新登入驗證允許與拒絕的操作', { tag: ['@AC-WB-018'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-018/default" }]}, async ({ Given, When, Then, And, sut }) => {
    await Given('被測專案的測試帳號"scenario_user"在測試資料庫角色為"A"且已登入被測網站', null, { sut });
    await And('被測網站角色"A"僅可閱讀測試文件而角色"B"可編輯測試文件但不可管理帳號', null, { sut });
    await When('spec使用Playwright透過專案的DbGate網頁介面將"scenario_user"角色由"A"改為"B"並保存', null, { sut });
    await And('spec重新查詢測試資料並斷言角色已實際變成"B"', null, { sut });
    await And('spec登出被測網站的舊登入狀態並以"scenario_user"重新登入', null, { sut });
    await And('spec在被測網站將"scenario_document"內容改為"edited"並開啟管理帳號頁面', null, { sut });
    await Then('spec斷言新登入頁面可看到角色"B"的編輯入口且文件保存成功', null, { sut });
    await And('spec透過DbGate網頁介面斷言"scenario_document"的實際內容為"edited"', null, { sut });
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
    await When('spec開始下一次執行並透過DbGate網頁介面將該測試帳號角色設為"A"與"scenario_document"內容設為"initial"', null, { sut });
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

  test('Playwright透過DbGate驗證資料並將DB畫面納入測試報告', { tag: ['@AC-WB-029'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-029/default" }]}, async ({ Given, When, Then, And, sut }) => {
    await Given('專案已設定DbGate網頁入口且連接該專案的測試資料庫', null, { sut });
    await And('測試已明確指定查詢SQL與預期欄位值', null, { sut });
    await When('spec使用Playwright在DbGate執行查詢並等待本次結果顯示', null, { sut });
    await Then('spec從DbGate結果表格讀取實際欄位值並斷言符合預期', null, { sut });
    await And('Playwright擷取本次DbGate查詢與結果表格的畫面', null, { sut });
    await And('測試報告保存查詢SQL與預期值及實際值並可開啟對應DbGate截圖', null, { sut });
    await And('DbGate截圖與資料斷言對應同一次run與Gherkin情境及案例與step及被驗證程式版本', null, { sut });
    await And('查詢失敗或資料不符時報告保留失敗結果與錯誤及DbGate畫面', null, { sut });
    await And('DbGate無法連線或結果未載入時明確顯示錯誤且不標示資料驗證通過', null, { sut });
    await And('截圖保存成功本身不代表資料斷言通過', null, { sut });
  });

  test('左側固定需求選單展開各份Gherkin並切換專屬流程', { tag: ['@AC-WB-030'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-030/default" }]}, async ({ Given, When, Then, And, sut }) => {
    await Given('使用者開啟需求首頁且已有可選工作區', null, { sut });
    await When('使用者新增需求並在同一表單選擇一個以上工作區', null, { sut });
    await Then('新需求建立時即關聯所選工作區', null, { sut });
    await When('使用者在該需求新增第二份Gherkin', null, { sut });
    await Then('左側需求節點展開列出兩份Gherkin與各自狀態', null, { sut });
    await When('使用者在需求清單展開需求並編輯名稱', null, { sut });
    await Then('Gherkin在原列下方樹狀展開且名稱旁直接出現輸入框與多選工作區下拉選單', null, { sut });
    await And('保存需求名稱時一併保存工作區關聯', null, { sut });
    await And('工作區管理位於需求首頁下方而非獨立頁面', null, { sut });
    await When('使用者從左側點選其中一份Gherkin並捲動右側工作區', null, { sut });
    await Then('左側需求選單維持固定且右側頁籤顯示所選Gherkin的滿版流程內容', null, { sut });
    await And('右側可開啟及切換多個頁籤', null, { sut });
    await And('重新載入後仍顯示相同需求及所選Gherkin', null, { sut });
  });

  test('同一需求關聯多個本機程式碼專案', { tag: ['@AC-WB-031'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-031/default" }]}, async ({ Given, When, Then, And, sut }) => {
    await Given('兩個程式碼專案已各自綁定不同的本機目錄', null, { sut });
    await When('使用者在需求中關聯這兩個專案', null, { sut });
    await Then('工作台保留一份需求與其Gherkin及專屬SD和BDD而不按專案複製需求', null, { sut });
    await When('使用者在需求開發區切換目前操作專案並開啟terminal', null, { sut });
    await Then('每個terminal的實際工作目錄等於所選專案綁定的本機目錄', null, { sut });
    await And('工作區管理與需求清單位於同一首頁且需求不隸屬單一工作區', null, { sut });
  });

  test('首次啟動建立可編輯且持續保存的CLI、Skill與Agent設定', { tag: ['@AC-WB-032'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-032/default" }]}, async ({ Given, When, Then, And, sut }) => {
    await Given('工作台資料庫尚未套用預設設定', null, { sut });
    await When('工作台首次啟動', null, { sut });
    await Then('資料庫建立Codex與Kiro CLI及從skills/playwright-bdd/SKILL.md載入的Playwright BDD Skill', null, { sut });
    await And('資料庫建立需求確認、系統設計、測試情境及程式開發Agent，並綁定Codex CLI與Playwright BDD Skill', null, { sut });
    await And('流程設定預設將四個Agent各自指派到對應可編輯階段，驗證報告維持唯讀', null, { sut });
    await When('使用者修改流程指派、編輯或刪除預設資料並重新啟動工作台', null, { sut });
    await Then('流程指派與編輯內容持續保存且已刪除的預設資料不會重新建立', null, { sut });
  });

  test('升級既有資料庫時補齊四階段Agent預設', { tag: ['@AC-WB-035'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-035/default" }]}, async ({ Given, When, Then, And, sut }) => {
    await Given('工作台資料庫已有舊版LLM預設設定且缺少系統設計、測試情境及程式開發Agent', null, { sut });
    await And('使用者已自訂CLI、Skill、Agent或流程指派', null, { sut });
    await When('工作台啟動新版', null, { sut });
    await Then('資料庫補齊缺少的Playwright BDD Skill與流程Agent', null, { sut });
    await And('四個可編輯階段各指派一個對應Agent且驗證報告維持唯讀', null, { sut });
    await And('未修改的舊版Codex預設參數升級為目前預設', null, { sut });
    await And('使用者已自訂的設定值保持不變', null, { sut });
    await When('工作台再次啟動', null, { sut });
    await Then('升級不重複執行且已刪除的預設資料不會重新建立', null, { sut });
  });

  test('為可編輯階段多選Agent並限制其操作入口', { tag: ['@AC-WB-033'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-033/default" }]}, async ({ Given, When, Then, And, sut }) => {
    await Given('CLI、Skill及Agent已保存', null, { sut });
    await When('使用者為需求確認、系統設計、測試情境及程式開發各自指派多個Agent', null, { sut });
    await Then('設定持續保存且驗證報告維持唯讀', null, { sut });
    await When('使用者開啟其中一個目前可編輯的需求階段', null, { sut });
    await Then('該階段只顯示已指派Agent的操作按鈕', null, { sut });
    await And('啟動Agent會在網頁terminal開啟設定的互動CLI並帶入Prompt、Skill及階段文件', null, { sut });
    await And('Agent未指派到該階段時伺服器拒絕啟動', null, { sut });
  });

  test.describe('重啟已完成階段並使該階段及下游狀態失效', () => {

    test('gherkin', { tag: ['@AC-WB-034'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-034/gherkin" }]}, async ({ Given, When, Then, And, sut }) => {
      await Given('該Gherkin已完成需求確認、系統設計、測試基線、程式基線及驗證', null, { sut });
      await When('使用者選擇已完成的"GHERKIN"並按右下角重啟階段', null, { sut });
      await Then('該階段成為目前階段且後續階段回到未完成狀態', null, { sut });
      await And('確認狀態與基線結果符合"無確認"及"Gherkin及SD確認與全部基線"', null, { sut });
      await And('執行結果標為失效但歷史版本及報告仍保留', null, { sut });
    });

    test('sd', { tag: ['@AC-WB-034'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-034/sd" }]}, async ({ Given, When, Then, And, sut }) => {
      await Given('該Gherkin已完成需求確認、系統設計、測試基線、程式基線及驗證', null, { sut });
      await When('使用者選擇已完成的"SD"並按右下角重啟階段', null, { sut });
      await Then('該階段成為目前階段且後續階段回到未完成狀態', null, { sut });
      await And('確認狀態與基線結果符合"Gherkin確認"及"SD確認及全部基線"', null, { sut });
      await And('執行結果標為失效但歷史版本及報告仍保留', null, { sut });
    });

    test('tests', { tag: ['@AC-WB-034'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-034/tests" }]}, async ({ Given, When, Then, And, sut }) => {
      await Given('該Gherkin已完成需求確認、系統設計、測試基線、程式基線及驗證', null, { sut });
      await When('使用者選擇已完成的"TESTS"並按右下角重啟階段', null, { sut });
      await Then('該階段成為目前階段且後續階段回到未完成狀態', null, { sut });
      await And('確認狀態與基線結果符合"Gherkin及SD確認"及"測試與程式基線"', null, { sut });
      await And('執行結果標為失效但歷史版本及報告仍保留', null, { sut });
    });

    test('source', { tag: ['@AC-WB-034'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-034/source" }]}, async ({ Given, When, Then, And, sut }) => {
      await Given('該Gherkin已完成需求確認、系統設計、測試基線、程式基線及驗證', null, { sut });
      await When('使用者選擇已完成的"IMPLEMENTATION"並按右下角重啟階段', null, { sut });
      await Then('該階段成為目前階段且後續階段回到未完成狀態', null, { sut });
      await And('確認狀態與基線結果符合"Gherkin及SD確認與測試基線"及"程式基線"', null, { sut });
      await And('執行結果標為失效但歷史版本及報告仍保留', null, { sut });
    });

    test('verify', { tag: ['@AC-WB-034'] , annotation: [{ type: 'workbenchTestId', description: "REQ-WB-001/AC-WB-034/verify" }]}, async ({ Given, When, Then, And, sut }) => {
      await Given('該Gherkin已完成需求確認、系統設計、測試基線、程式基線及驗證', null, { sut });
      await When('使用者選擇已完成的"VERIFICATION"並按右下角重啟階段', null, { sut });
      await Then('該階段成為目前階段且後續階段回到未完成狀態', null, { sut });
      await And('確認狀態與基線結果符合"Gherkin及SD確認與測試及程式基線"及"僅執行結果"', null, { sut });
      await And('執行結果標為失效但歷史版本及報告仍保留', null, { sut });
    });

  });

});

// == technical section ==

test.use({
  $test: [({}, use) => use(test), { scope: 'test', box: true }],
  $uri: [({}, use) => use('spec/REQ-WB-001/workbench/workbench.feature'), { scope: 'test', box: true }],
  $bddFileData: [({}, use) => use(bddFileData as import('playwright-bdd').BddTestFixtures['$bddFileData']), { scope: "test", box: true }],
});

const bddFileData = [ // bdd-data-start
  {"pwTestLine":10,"pickleLine":12,"tags":["@AC-WB-001"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":11,"gherkinStepLine":13,"keywordType":"Context","textWithKeyword":"Given 本專案的Gherkin已寫入Xing00000的bdd Git儲存庫","stepMatchArguments":[]},{"pwStepLine":12,"gherkinStepLine":14,"keywordType":"Action","textWithKeyword":"When 使用者尚未確認這份Gherkin","stepMatchArguments":[]},{"pwStepLine":13,"gherkinStepLine":15,"keywordType":"Outcome","textWithKeyword":"Then 本專案維持等待Gherkin確認且不產生SD或產品實作","stepMatchArguments":[]},{"pwStepLine":14,"gherkinStepLine":16,"keywordType":"Action","textWithKeyword":"When 使用者確認Gherkin後再確認對應SD","stepMatchArguments":[]},{"pwStepLine":15,"gherkinStepLine":17,"keywordType":"Outcome","textWithKeyword":"Then 本專案才依序進入測試產生補齊與產品實作階段","stepMatchArguments":[]},{"pwStepLine":16,"gherkinStepLine":18,"keywordType":"Outcome","textWithKeyword":"And 本專案的規格與文件與確認紀錄與測試全部保存在Git","stepMatchArguments":[]}]},
  {"pwTestLine":19,"pickleLine":21,"tags":["@AC-WB-002"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":20,"gherkinStepLine":22,"keywordType":"Context","textWithKeyword":"Given 兩位使用者開啟同一個需求","stepMatchArguments":[]},{"pwStepLine":21,"gherkinStepLine":23,"keywordType":"Action","textWithKeyword":"When 一位使用者在需求保存Gherkin或SD文件","stepMatchArguments":[]},{"pwStepLine":22,"gherkinStepLine":24,"keywordType":"Outcome","textWithKeyword":"Then 另一位使用者可在該需求讀取相同文件內容","stepMatchArguments":[]}]},
  {"pwTestLine":25,"pickleLine":27,"tags":["@AC-WB-003"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":26,"gherkinStepLine":28,"keywordType":"Context","textWithKeyword":"Given 工作台顯示所選Gherkin處於確認階段且已有草稿","stepMatchArguments":[]},{"pwStepLine":27,"gherkinStepLine":29,"keywordType":"Action","textWithKeyword":"When 人類確認Gherkin並選擇已指派的系統設計Agent產生SD","stepMatchArguments":[]},{"pwStepLine":28,"gherkinStepLine":30,"keywordType":"Outcome","textWithKeyword":"Then 工作台流程狀態顯示SD確認且開啟SD編輯","stepMatchArguments":[]},{"pwStepLine":29,"gherkinStepLine":31,"keywordType":"Outcome","textWithKeyword":"And 使用設定的互動CLI在網頁terminal提出SD草稿","stepMatchArguments":[]},{"pwStepLine":30,"gherkinStepLine":32,"keywordType":"Outcome","textWithKeyword":"And 產生對應Gherkin的SD草稿供人類確認","stepMatchArguments":[]},{"pwStepLine":31,"gherkinStepLine":33,"keywordType":"Outcome","textWithKeyword":"And SD包含程式架構以及本次資料庫DDL與DML內容","stepMatchArguments":[]},{"pwStepLine":32,"gherkinStepLine":34,"keywordType":"Outcome","textWithKeyword":"And 人類尚未確認SD時不進入產品開發","stepMatchArguments":[]}]},
  {"pwTestLine":35,"pickleLine":37,"tags":["@AC-WB-004"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":36,"gherkinStepLine":38,"keywordType":"Context","textWithKeyword":"Given 人類已確認該Gherkin與SD","stepMatchArguments":[]},{"pwStepLine":37,"gherkinStepLine":39,"keywordType":"Action","textWithKeyword":"When 人類確認SD","stepMatchArguments":[]},{"pwStepLine":38,"gherkinStepLine":40,"keywordType":"Outcome","textWithKeyword":"Then 工作台進入測試情境階段並自動產生唯讀的spec.ts骨架","stepMatchArguments":[]},{"pwStepLine":39,"gherkinStepLine":41,"keywordType":"Outcome","textWithKeyword":"And spec.ts預設收合且每個案例對應來源Scenario及Examples列","stepMatchArguments":[]},{"pwStepLine":40,"gherkinStepLine":42,"keywordType":"Outcome","textWithKeyword":"And 人類不能直接編輯生成骨架","stepMatchArguments":[]}]},
  {"pwTestLine":43,"pickleLine":45,"tags":["@AC-WB-005"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":44,"gherkinStepLine":46,"keywordType":"Context","textWithKeyword":"Given 已產生對應確認文件的測試骨架","stepMatchArguments":[]},{"pwStepLine":45,"gherkinStepLine":47,"keywordType":"Action","textWithKeyword":"When 使用者選擇已指派的測試Agent並透過互動CLI補齊測試步驟","stepMatchArguments":[]},{"pwStepLine":46,"gherkinStepLine":48,"keywordType":"Outcome","textWithKeyword":"Then 補齊的測試仍對應人類已確認的驗收條件","stepMatchArguments":[]},{"pwStepLine":47,"gherkinStepLine":49,"keywordType":"Outcome","textWithKeyword":"And CLI在獨立工作目錄讀取經SHA-256核對的官方Playwright-BDD Skill","stepMatchArguments":[]},{"pwStepLine":48,"gherkinStepLine":50,"keywordType":"Outcome","textWithKeyword":"And 缺少預期結果資訊時列出待補內容而不自行改寫驗收條件","stepMatchArguments":[]}]},
  {"pwTestLine":51,"pickleLine":53,"tags":["@AC-WB-006"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":52,"gherkinStepLine":54,"keywordType":"Context","textWithKeyword":"Given Gherkin與SD已確認且測試規格已補齊","stepMatchArguments":[]},{"pwStepLine":53,"gherkinStepLine":55,"keywordType":"Action","textWithKeyword":"When 人類確認已完成檢核的測試步驟","stepMatchArguments":[]},{"pwStepLine":54,"gherkinStepLine":56,"keywordType":"Outcome","textWithKeyword":"Then 工作台流程狀態顯示implementation","stepMatchArguments":[]},{"pwStepLine":55,"gherkinStepLine":57,"keywordType":"Outcome","textWithKeyword":"And 測試基線固定且自動進入程式開發階段","stepMatchArguments":[]},{"pwStepLine":56,"gherkinStepLine":58,"keywordType":"Outcome","textWithKeyword":"And 可使用已確認文件及測試基線作為開發依據","stepMatchArguments":[]},{"pwStepLine":57,"gherkinStepLine":59,"keywordType":"Outcome","textWithKeyword":"And 開發完成後可開始驗證該次開發成果","stepMatchArguments":[]}]},
  {"pwTestLine":60,"pickleLine":62,"tags":["@AC-WB-007"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":61,"gherkinStepLine":63,"keywordType":"Context","textWithKeyword":"Given 共用專案已設定DbGate網頁入口與SQLite測試資料庫連線","stepMatchArguments":[]},{"pwStepLine":62,"gherkinStepLine":64,"keywordType":"Action","textWithKeyword":"When 使用者透過DbGate瀏覽schema與資料並執行本次SD內的DDL或DML","stepMatchArguments":[]},{"pwStepLine":63,"gherkinStepLine":65,"keywordType":"Outcome","textWithKeyword":"Then DbGate顯示該測試資料庫的實際schema與資料及SQL執行結果","stepMatchArguments":[]},{"pwStepLine":64,"gherkinStepLine":66,"keywordType":"Outcome","textWithKeyword":"And 重新讀取資料庫時可看到實際變更","stepMatchArguments":[]}]},
  {"pwTestLine":67,"pickleLine":69,"tags":["@AC-WB-008"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":68,"gherkinStepLine":70,"keywordType":"Context","textWithKeyword":"Given 至少一個工作區已綁定本機程式碼目錄","stepMatchArguments":[]},{"pwStepLine":69,"gherkinStepLine":71,"keywordType":"Action","textWithKeyword":"When 使用者從左側Terminal選擇工作區","stepMatchArguments":[]},{"pwStepLine":70,"gherkinStepLine":72,"keywordType":"Outcome","textWithKeyword":"Then 右側直接開啟該工作區的終端頁籤且內容只有終端","stepMatchArguments":[]},{"pwStepLine":71,"gherkinStepLine":73,"keywordType":"Action","textWithKeyword":"When 使用者輸入命令並啟動專案程式","stepMatchArguments":[]},{"pwStepLine":72,"gherkinStepLine":74,"keywordType":"Outcome","textWithKeyword":"Then 同一PTY顯示實際輸出且可繼續輸入","stepMatchArguments":[]},{"pwStepLine":73,"gherkinStepLine":75,"keywordType":"Action","textWithKeyword":"When 使用者關閉終端頁籤","stepMatchArguments":[]},{"pwStepLine":74,"gherkinStepLine":76,"keywordType":"Outcome","textWithKeyword":"Then 該PTY程序被中止","stepMatchArguments":[]}]},
  {"pwTestLine":79,"pickleLine":86,"tags":["@AC-WB-009"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":80,"gherkinStepLine":80,"keywordType":"Context","textWithKeyword":"Given 專案已有Playwright瀏覽器會話","stepMatchArguments":[]},{"pwStepLine":81,"gherkinStepLine":81,"keywordType":"Action","textWithKeyword":"When \"agent\"使用Playwright操作該會話的網頁","stepMatchArguments":[{"group":{"start":1,"value":"agent"}}]},{"pwStepLine":82,"gherkinStepLine":82,"keywordType":"Outcome","textWithKeyword":"Then 工作台內嵌畫面顯示該會話當前的網頁操作結果","stepMatchArguments":[]},{"pwStepLine":83,"gherkinStepLine":83,"keywordType":"Outcome","textWithKeyword":"And 顯示的是操作中的會話而不是事後trace報告","stepMatchArguments":[]}]},
  {"pwTestLine":86,"pickleLine":87,"tags":["@AC-WB-009"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":87,"gherkinStepLine":80,"keywordType":"Context","textWithKeyword":"Given 專案已有Playwright瀏覽器會話","stepMatchArguments":[]},{"pwStepLine":88,"gherkinStepLine":81,"keywordType":"Action","textWithKeyword":"When \"程式\"使用Playwright操作該會話的網頁","stepMatchArguments":[{"group":{"start":1,"value":"程式"}}]},{"pwStepLine":89,"gherkinStepLine":82,"keywordType":"Outcome","textWithKeyword":"Then 工作台內嵌畫面顯示該會話當前的網頁操作結果","stepMatchArguments":[]},{"pwStepLine":90,"gherkinStepLine":83,"keywordType":"Outcome","textWithKeyword":"And 顯示的是操作中的會話而不是事後trace報告","stepMatchArguments":[]}]},
  {"pwTestLine":95,"pickleLine":90,"tags":["@AC-WB-010"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":96,"gherkinStepLine":91,"keywordType":"Context","textWithKeyword":"Given 使用者從固定選單開啟瀏覽器錄製","stepMatchArguments":[]},{"pwStepLine":97,"gherkinStepLine":92,"keywordType":"Action","textWithKeyword":"When 使用者輸入網址前往、錄製並操作網頁、停止後命名保存","stepMatchArguments":[]},{"pwStepLine":98,"gherkinStepLine":93,"keywordType":"Outcome","textWithKeyword":"Then 已保存名稱出現在左側瀏覽器錄製下方","stepMatchArguments":[]},{"pwStepLine":99,"gherkinStepLine":94,"keywordType":"Outcome","textWithKeyword":"And 開啟保存內容時上方顯示播放與刪除且下方顯示Playwright腳本","stepMatchArguments":[]},{"pwStepLine":100,"gherkinStepLine":95,"keywordType":"Action","textWithKeyword":"When 使用者按播放","stepMatchArguments":[]},{"pwStepLine":101,"gherkinStepLine":96,"keywordType":"Outcome","textWithKeyword":"Then 瀏覽器視窗展開並重播保存的動作","stepMatchArguments":[]},{"pwStepLine":102,"gherkinStepLine":97,"keywordType":"Outcome","textWithKeyword":"And 全域錄製不要求關聯專案或需求且不自動成為CI測試","stepMatchArguments":[]}]},
  {"pwTestLine":105,"pickleLine":100,"tags":["@AC-WB-011"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":106,"gherkinStepLine":101,"keywordType":"Context","textWithKeyword":"Given 測試被指定為被開發專案的CI測試","stepMatchArguments":[]},{"pwStepLine":107,"gherkinStepLine":102,"keywordType":"Action","textWithKeyword":"When 保存測試並在該專案CI執行","stepMatchArguments":[]},{"pwStepLine":108,"gherkinStepLine":103,"keywordType":"Outcome","textWithKeyword":"Then 測試檔案跟著該專案Git的branch與commit","stepMatchArguments":[]},{"pwStepLine":109,"gherkinStepLine":104,"keywordType":"Outcome","textWithKeyword":"And CI結果可對應該專案的實際commit","stepMatchArguments":[]},{"pwStepLine":110,"gherkinStepLine":105,"keywordType":"Outcome","textWithKeyword":"And 工作台可在SQLite保存及讀回該commit對應的spec.ts內容副本","stepMatchArguments":[]},{"pwStepLine":111,"gherkinStepLine":106,"keywordType":"Outcome","textWithKeyword":"And 該資料庫副本不取代target Git的標準CI測試版本或改變CI測試清單","stepMatchArguments":[]}]},
  {"pwTestLine":114,"pickleLine":109,"tags":["@AC-WB-012"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":115,"gherkinStepLine":110,"keywordType":"Context","textWithKeyword":"Given 使用者建立自己的整合測試","stepMatchArguments":[]},{"pwStepLine":116,"gherkinStepLine":111,"keywordType":"Action","textWithKeyword":"When 在工作台保存測試定義與目標環境並要求執行","stepMatchArguments":[]},{"pwStepLine":117,"gherkinStepLine":112,"keywordType":"Outcome","textWithKeyword":"Then 測試定義與執行紀錄保存在工作台SQLite","stepMatchArguments":[]},{"pwStepLine":118,"gherkinStepLine":113,"keywordType":"Outcome","textWithKeyword":"And 該測試不會自動寫入被開發專案Git","stepMatchArguments":[]}]},
  {"pwTestLine":121,"pickleLine":116,"tags":["@AC-WB-013"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":122,"gherkinStepLine":117,"keywordType":"Context","textWithKeyword":"Given 專案開發完成且驗證測試已備妥","stepMatchArguments":[]},{"pwStepLine":123,"gherkinStepLine":118,"keywordType":"Action","textWithKeyword":"When 使用者在工作台提交驗證並執行對應E2E測試","stepMatchArguments":[]},{"pwStepLine":124,"gherkinStepLine":119,"keywordType":"Outcome","textWithKeyword":"Then 工作台流程狀態顯示verification/report","stepMatchArguments":[]},{"pwStepLine":125,"gherkinStepLine":120,"keywordType":"Outcome","textWithKeyword":"And 報告列出各驗收案例的實際執行結果","stepMatchArguments":[]},{"pwStepLine":126,"gherkinStepLine":121,"keywordType":"Outcome","textWithKeyword":"And 報告可對應Gherkin案例與被驗證的程式版本","stepMatchArguments":[]},{"pwStepLine":127,"gherkinStepLine":122,"keywordType":"Outcome","textWithKeyword":"And 未通過或未執行的案例不被報成通過","stepMatchArguments":[]},{"pwStepLine":128,"gherkinStepLine":123,"keywordType":"Outcome","textWithKeyword":"And Playwright截圖可對應Scenario與step及該步驟實際結果","stepMatchArguments":[]}]},
  {"pwTestLine":131,"pickleLine":126,"tags":["@AC-WB-014"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":132,"gherkinStepLine":127,"keywordType":"Context","textWithKeyword":"Given Gherkin含有尚未定義或尚未實作的測試步驟","stepMatchArguments":[]},{"pwStepLine":133,"gherkinStepLine":128,"keywordType":"Action","textWithKeyword":"When 產生或執行對應測試","stepMatchArguments":[]},{"pwStepLine":134,"gherkinStepLine":129,"keywordType":"Outcome","textWithKeyword":"Then 生成器阻擋缺少定義的步驟或測試明確回報未實作","stepMatchArguments":[]},{"pwStepLine":135,"gherkinStepLine":130,"keywordType":"Outcome","textWithKeyword":"And 不以空函式或刪除驗收案例換取通過","stepMatchArguments":[]}]},
  {"pwTestLine":140,"pickleLine":142,"tags":["@AC-WB-015"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":141,"gherkinStepLine":134,"keywordType":"Context","textWithKeyword":"Given 工作台顯示專案目前在\"Gherkin確認\"階段且已有保存內容","stepMatchArguments":[{"group":{"start":11,"value":"Gherkin確認"}}]},{"pwStepLine":142,"gherkinStepLine":135,"keywordType":"Action","textWithKeyword":"When 使用者在工作台嘗試保存禁止變更的\"spec.ts\"","stepMatchArguments":[{"group":{"start":17,"value":"spec.ts"}}]},{"pwStepLine":143,"gherkinStepLine":136,"keywordType":"Outcome","textWithKeyword":"Then 工作台顯示此階段不可修改該產物","stepMatchArguments":[]},{"pwStepLine":144,"gherkinStepLine":137,"keywordType":"Outcome","textWithKeyword":"And 該產物仍為上次保存內容","stepMatchArguments":[]},{"pwStepLine":145,"gherkinStepLine":138,"keywordType":"Outcome","textWithKeyword":"And 工作台只對\"Gherkin\"提供本階段的編輯或執行入口","stepMatchArguments":[{"group":{"start":6,"value":"Gherkin"}}]},{"pwStepLine":146,"gherkinStepLine":139,"keywordType":"Outcome","textWithKeyword":"And \"SD與測試與產品程式\"維持鎖定","stepMatchArguments":[{"group":{"start":1,"value":"SD與測試與產品程式"}}]}]},
  {"pwTestLine":149,"pickleLine":143,"tags":["@AC-WB-015"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":150,"gherkinStepLine":134,"keywordType":"Context","textWithKeyword":"Given 工作台顯示專案目前在\"SD確認\"階段且已有保存內容","stepMatchArguments":[{"group":{"start":11,"value":"SD確認"}}]},{"pwStepLine":151,"gherkinStepLine":135,"keywordType":"Action","textWithKeyword":"When 使用者在工作台嘗試保存禁止變更的\"Gherkin\"","stepMatchArguments":[{"group":{"start":17,"value":"Gherkin"}}]},{"pwStepLine":152,"gherkinStepLine":136,"keywordType":"Outcome","textWithKeyword":"Then 工作台顯示此階段不可修改該產物","stepMatchArguments":[]},{"pwStepLine":153,"gherkinStepLine":137,"keywordType":"Outcome","textWithKeyword":"And 該產物仍為上次保存內容","stepMatchArguments":[]},{"pwStepLine":154,"gherkinStepLine":138,"keywordType":"Outcome","textWithKeyword":"And 工作台只對\"SD文件\"提供本階段的編輯或執行入口","stepMatchArguments":[{"group":{"start":6,"value":"SD文件"}}]},{"pwStepLine":155,"gherkinStepLine":139,"keywordType":"Outcome","textWithKeyword":"And \"已確認Gherkin與測試與產品程式\"維持鎖定","stepMatchArguments":[{"group":{"start":1,"value":"已確認Gherkin與測試與產品程式"}}]}]},
  {"pwTestLine":158,"pickleLine":144,"tags":["@AC-WB-015"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":159,"gherkinStepLine":134,"keywordType":"Context","textWithKeyword":"Given 工作台顯示專案目前在\"test generation/completion\"階段且已有保存內容","stepMatchArguments":[{"group":{"start":11,"value":"test generation/completion"}}]},{"pwStepLine":160,"gherkinStepLine":135,"keywordType":"Action","textWithKeyword":"When 使用者在工作台嘗試保存禁止變更的\"Gherkin或SD\"","stepMatchArguments":[{"group":{"start":17,"value":"Gherkin或SD"}}]},{"pwStepLine":161,"gherkinStepLine":136,"keywordType":"Outcome","textWithKeyword":"Then 工作台顯示此階段不可修改該產物","stepMatchArguments":[]},{"pwStepLine":162,"gherkinStepLine":137,"keywordType":"Outcome","textWithKeyword":"And 該產物仍為上次保存內容","stepMatchArguments":[]},{"pwStepLine":163,"gherkinStepLine":138,"keywordType":"Outcome","textWithKeyword":"And 工作台只對\"spec.ts與step及測試所需檔案\"提供本階段的編輯或執行入口","stepMatchArguments":[{"group":{"start":6,"value":"spec.ts與step及測試所需檔案"}}]},{"pwStepLine":164,"gherkinStepLine":139,"keywordType":"Outcome","textWithKeyword":"And \"已確認Gherkin與SD\"維持鎖定","stepMatchArguments":[{"group":{"start":1,"value":"已確認Gherkin與SD"}}]}]},
  {"pwTestLine":167,"pickleLine":145,"tags":["@AC-WB-015"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":168,"gherkinStepLine":134,"keywordType":"Context","textWithKeyword":"Given 工作台顯示專案目前在\"implementation\"階段且已有保存內容","stepMatchArguments":[{"group":{"start":11,"value":"implementation"}}]},{"pwStepLine":169,"gherkinStepLine":135,"keywordType":"Action","textWithKeyword":"When 使用者在工作台嘗試保存禁止變更的\"測試基線\"","stepMatchArguments":[{"group":{"start":17,"value":"測試基線"}}]},{"pwStepLine":170,"gherkinStepLine":136,"keywordType":"Outcome","textWithKeyword":"Then 工作台顯示此階段不可修改該產物","stepMatchArguments":[]},{"pwStepLine":171,"gherkinStepLine":137,"keywordType":"Outcome","textWithKeyword":"And 該產物仍為上次保存內容","stepMatchArguments":[]},{"pwStepLine":172,"gherkinStepLine":138,"keywordType":"Outcome","textWithKeyword":"And 工作台只對\"產品程式\"提供本階段的編輯或執行入口","stepMatchArguments":[{"group":{"start":6,"value":"產品程式"}}]},{"pwStepLine":173,"gherkinStepLine":139,"keywordType":"Outcome","textWithKeyword":"And \"已確認Gherkin與SD及測試基線\"維持鎖定","stepMatchArguments":[{"group":{"start":1,"value":"已確認Gherkin與SD及測試基線"}}]}]},
  {"pwTestLine":176,"pickleLine":146,"tags":["@AC-WB-015"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":177,"gherkinStepLine":134,"keywordType":"Context","textWithKeyword":"Given 工作台顯示專案目前在\"verification/report\"階段且已有保存內容","stepMatchArguments":[{"group":{"start":11,"value":"verification/report"}}]},{"pwStepLine":178,"gherkinStepLine":135,"keywordType":"Action","textWithKeyword":"When 使用者在工作台嘗試保存禁止變更的\"程式或測試\"","stepMatchArguments":[{"group":{"start":17,"value":"程式或測試"}}]},{"pwStepLine":179,"gherkinStepLine":136,"keywordType":"Outcome","textWithKeyword":"Then 工作台顯示此階段不可修改該產物","stepMatchArguments":[]},{"pwStepLine":180,"gherkinStepLine":137,"keywordType":"Outcome","textWithKeyword":"And 該產物仍為上次保存內容","stepMatchArguments":[]},{"pwStepLine":181,"gherkinStepLine":138,"keywordType":"Outcome","textWithKeyword":"And 工作台只對\"執行既定測試與產生結果報告\"提供本階段的編輯或執行入口","stepMatchArguments":[{"group":{"start":6,"value":"執行既定測試與產生結果報告"}}]},{"pwStepLine":182,"gherkinStepLine":139,"keywordType":"Outcome","textWithKeyword":"And \"Gherkin與SD與測試基線及產品程式\"維持鎖定","stepMatchArguments":[{"group":{"start":1,"value":"Gherkin與SD與測試基線及產品程式"}}]}]},
  {"pwTestLine":189,"pickleLine":159,"tags":["@AC-WB-016"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":190,"gherkinStepLine":150,"keywordType":"Context","textWithKeyword":"Given 專案已有測試基線與驗證結果","stepMatchArguments":[]},{"pwStepLine":191,"gherkinStepLine":151,"keywordType":"Action","textWithKeyword":"When 使用者在工作台選擇退回修改並指定\"Gherkin\"","stepMatchArguments":[{"group":{"start":17,"value":"Gherkin"}}]},{"pwStepLine":192,"gherkinStepLine":152,"keywordType":"Outcome","textWithKeyword":"Then 工作台流程狀態顯示\"Gherkin確認\"才開啟該產物編輯","stepMatchArguments":[{"group":{"start":10,"value":"Gherkin確認"}}]},{"pwStepLine":193,"gherkinStepLine":153,"keywordType":"Outcome","textWithKeyword":"And 工作台將依賴該產物的下游產物與驗證結果標示失效","stepMatchArguments":[]},{"pwStepLine":194,"gherkinStepLine":154,"keywordType":"Outcome","textWithKeyword":"And Gherkin或SD修改後未重新確認時不能再次前進","stepMatchArguments":[]},{"pwStepLine":195,"gherkinStepLine":155,"keywordType":"Outcome","textWithKeyword":"And 完成該階段要求後依序重新產生或驗證下游結果","stepMatchArguments":[]},{"pwStepLine":196,"gherkinStepLine":156,"keywordType":"Outcome","textWithKeyword":"And 不會在同一階段同時修改Gherkin與spec.ts","stepMatchArguments":[]}]},
  {"pwTestLine":199,"pickleLine":160,"tags":["@AC-WB-016"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":200,"gherkinStepLine":150,"keywordType":"Context","textWithKeyword":"Given 專案已有測試基線與驗證結果","stepMatchArguments":[]},{"pwStepLine":201,"gherkinStepLine":151,"keywordType":"Action","textWithKeyword":"When 使用者在工作台選擇退回修改並指定\"SD\"","stepMatchArguments":[{"group":{"start":17,"value":"SD"}}]},{"pwStepLine":202,"gherkinStepLine":152,"keywordType":"Outcome","textWithKeyword":"Then 工作台流程狀態顯示\"SD確認\"才開啟該產物編輯","stepMatchArguments":[{"group":{"start":10,"value":"SD確認"}}]},{"pwStepLine":203,"gherkinStepLine":153,"keywordType":"Outcome","textWithKeyword":"And 工作台將依賴該產物的下游產物與驗證結果標示失效","stepMatchArguments":[]},{"pwStepLine":204,"gherkinStepLine":154,"keywordType":"Outcome","textWithKeyword":"And Gherkin或SD修改後未重新確認時不能再次前進","stepMatchArguments":[]},{"pwStepLine":205,"gherkinStepLine":155,"keywordType":"Outcome","textWithKeyword":"And 完成該階段要求後依序重新產生或驗證下游結果","stepMatchArguments":[]},{"pwStepLine":206,"gherkinStepLine":156,"keywordType":"Outcome","textWithKeyword":"And 不會在同一階段同時修改Gherkin與spec.ts","stepMatchArguments":[]}]},
  {"pwTestLine":209,"pickleLine":161,"tags":["@AC-WB-016"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":210,"gherkinStepLine":150,"keywordType":"Context","textWithKeyword":"Given 專案已有測試基線與驗證結果","stepMatchArguments":[]},{"pwStepLine":211,"gherkinStepLine":151,"keywordType":"Action","textWithKeyword":"When 使用者在工作台選擇退回修改並指定\"測試基線\"","stepMatchArguments":[{"group":{"start":17,"value":"測試基線"}}]},{"pwStepLine":212,"gherkinStepLine":152,"keywordType":"Outcome","textWithKeyword":"Then 工作台流程狀態顯示\"test generation/completion\"才開啟該產物編輯","stepMatchArguments":[{"group":{"start":10,"value":"test generation/completion"}}]},{"pwStepLine":213,"gherkinStepLine":153,"keywordType":"Outcome","textWithKeyword":"And 工作台將依賴該產物的下游產物與驗證結果標示失效","stepMatchArguments":[]},{"pwStepLine":214,"gherkinStepLine":154,"keywordType":"Outcome","textWithKeyword":"And Gherkin或SD修改後未重新確認時不能再次前進","stepMatchArguments":[]},{"pwStepLine":215,"gherkinStepLine":155,"keywordType":"Outcome","textWithKeyword":"And 完成該階段要求後依序重新產生或驗證下游結果","stepMatchArguments":[]},{"pwStepLine":216,"gherkinStepLine":156,"keywordType":"Outcome","textWithKeyword":"And 不會在同一階段同時修改Gherkin與spec.ts","stepMatchArguments":[]}]},
  {"pwTestLine":219,"pickleLine":162,"tags":["@AC-WB-016"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":220,"gherkinStepLine":150,"keywordType":"Context","textWithKeyword":"Given 專案已有測試基線與驗證結果","stepMatchArguments":[]},{"pwStepLine":221,"gherkinStepLine":151,"keywordType":"Action","textWithKeyword":"When 使用者在工作台選擇退回修改並指定\"產品程式\"","stepMatchArguments":[{"group":{"start":17,"value":"產品程式"}}]},{"pwStepLine":222,"gherkinStepLine":152,"keywordType":"Outcome","textWithKeyword":"Then 工作台流程狀態顯示\"implementation\"才開啟該產物編輯","stepMatchArguments":[{"group":{"start":10,"value":"implementation"}}]},{"pwStepLine":223,"gherkinStepLine":153,"keywordType":"Outcome","textWithKeyword":"And 工作台將依賴該產物的下游產物與驗證結果標示失效","stepMatchArguments":[]},{"pwStepLine":224,"gherkinStepLine":154,"keywordType":"Outcome","textWithKeyword":"And Gherkin或SD修改後未重新確認時不能再次前進","stepMatchArguments":[]},{"pwStepLine":225,"gherkinStepLine":155,"keywordType":"Outcome","textWithKeyword":"And 完成該階段要求後依序重新產生或驗證下游結果","stepMatchArguments":[]},{"pwStepLine":226,"gherkinStepLine":156,"keywordType":"Outcome","textWithKeyword":"And 不會在同一階段同時修改Gherkin與spec.ts","stepMatchArguments":[]}]},
  {"pwTestLine":231,"pickleLine":166,"tags":["@AC-WB-017"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":232,"gherkinStepLine":167,"keywordType":"Context","textWithKeyword":"Given 被測專案的測試資料庫有帳號\"scenario_user\"且角色為\"A\"與狀態為\"active\"","stepMatchArguments":[]},{"pwStepLine":233,"gherkinStepLine":168,"keywordType":"Action","textWithKeyword":"When spec使用Playwright開啟專案的DbGate網頁介面並查詢\"scenario_user\"","stepMatchArguments":[]},{"pwStepLine":234,"gherkinStepLine":169,"keywordType":"Outcome","textWithKeyword":"Then spec斷言實際查詢資料的角色為\"A\"且狀態為\"active\"","stepMatchArguments":[]},{"pwStepLine":235,"gherkinStepLine":170,"keywordType":"Outcome","textWithKeyword":"And 每個Playwright操作與斷言步驟保存截圖並對應Scenario與step","stepMatchArguments":[]},{"pwStepLine":236,"gherkinStepLine":171,"keywordType":"Outcome","textWithKeyword":"And 只有實際資料斷言符合預期才算該步驟通過","stepMatchArguments":[]}]},
  {"pwTestLine":239,"pickleLine":174,"tags":["@AC-WB-018"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":240,"gherkinStepLine":175,"keywordType":"Context","textWithKeyword":"Given 被測專案的測試帳號\"scenario_user\"在測試資料庫角色為\"A\"且已登入被測網站","stepMatchArguments":[]},{"pwStepLine":241,"gherkinStepLine":176,"keywordType":"Context","textWithKeyword":"And 被測網站角色\"A\"僅可閱讀測試文件而角色\"B\"可編輯測試文件但不可管理帳號","stepMatchArguments":[]},{"pwStepLine":242,"gherkinStepLine":177,"keywordType":"Action","textWithKeyword":"When spec使用Playwright透過專案的DbGate網頁介面將\"scenario_user\"角色由\"A\"改為\"B\"並保存","stepMatchArguments":[]},{"pwStepLine":243,"gherkinStepLine":178,"keywordType":"Action","textWithKeyword":"And spec重新查詢測試資料並斷言角色已實際變成\"B\"","stepMatchArguments":[]},{"pwStepLine":244,"gherkinStepLine":179,"keywordType":"Action","textWithKeyword":"And spec登出被測網站的舊登入狀態並以\"scenario_user\"重新登入","stepMatchArguments":[]},{"pwStepLine":245,"gherkinStepLine":180,"keywordType":"Action","textWithKeyword":"And spec在被測網站將\"scenario_document\"內容改為\"edited\"並開啟管理帳號頁面","stepMatchArguments":[]},{"pwStepLine":246,"gherkinStepLine":181,"keywordType":"Outcome","textWithKeyword":"Then spec斷言新登入頁面可看到角色\"B\"的編輯入口且文件保存成功","stepMatchArguments":[]},{"pwStepLine":247,"gherkinStepLine":182,"keywordType":"Outcome","textWithKeyword":"And spec透過DbGate網頁介面斷言\"scenario_document\"的實際內容為\"edited\"","stepMatchArguments":[]},{"pwStepLine":248,"gherkinStepLine":183,"keywordType":"Outcome","textWithKeyword":"And spec斷言管理帳號頁面顯示拒絕且帳號資料沒有因此變更","stepMatchArguments":[]},{"pwStepLine":249,"gherkinStepLine":184,"keywordType":"Outcome","textWithKeyword":"And spec在前置資料確認與DB變更後及重新登入後保存截圖","stepMatchArguments":[]},{"pwStepLine":250,"gherkinStepLine":185,"keywordType":"Outcome","textWithKeyword":"And spec在每個主要操作與斷言步驟保存截圖並關聯實際結果","stepMatchArguments":[]}]},
  {"pwTestLine":253,"pickleLine":188,"tags":["@AC-WB-019"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":254,"gherkinStepLine":189,"keywordType":"Context","textWithKeyword":"Given spec正在執行被測專案測試資料庫變更與重新登入的端到端情境","stepMatchArguments":[]},{"pwStepLine":255,"gherkinStepLine":190,"keywordType":"Action","textWithKeyword":"When spec在網頁畫面或DB資料斷言得到與預期不同的實際結果","stepMatchArguments":[]},{"pwStepLine":256,"gherkinStepLine":191,"keywordType":"Outcome","textWithKeyword":"Then Playwright保存失敗當下頁面的截圖","stepMatchArguments":[]},{"pwStepLine":257,"gherkinStepLine":192,"keywordType":"Outcome","textWithKeyword":"And 報告列出該Scenario與失敗step及預期值與實際值及截圖","stepMatchArguments":[]},{"pwStepLine":258,"gherkinStepLine":193,"keywordType":"Outcome","textWithKeyword":"And 該案例標示失敗而不因截圖保存成功改成通過","stepMatchArguments":[]}]},
  {"pwTestLine":261,"pickleLine":196,"tags":["@AC-WB-020"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":262,"gherkinStepLine":197,"keywordType":"Context","textWithKeyword":"Given 上一次執行已將測試帳號\"scenario_user\"改為角色\"B\"且測試文件內容已變更","stepMatchArguments":[]},{"pwStepLine":263,"gherkinStepLine":198,"keywordType":"Action","textWithKeyword":"When spec開始下一次執行並透過DbGate網頁介面將該測試帳號角色設為\"A\"與\"scenario_document\"內容設為\"initial\"","stepMatchArguments":[]},{"pwStepLine":264,"gherkinStepLine":199,"keywordType":"Action","textWithKeyword":"And spec結束被測網站上一輪的登入狀態","stepMatchArguments":[]},{"pwStepLine":265,"gherkinStepLine":200,"keywordType":"Outcome","textWithKeyword":"Then spec斷言測試資料庫中的角色為\"A\"且\"scenario_document\"內容為\"initial\"","stepMatchArguments":[]},{"pwStepLine":266,"gherkinStepLine":201,"keywordType":"Outcome","textWithKeyword":"And Playwright保存本次前置資料初始狀態的截圖","stepMatchArguments":[]},{"pwStepLine":267,"gherkinStepLine":202,"keywordType":"Outcome","textWithKeyword":"And 本次情境從該初始狀態重新執行DB變更與登入及操作驗證流程","stepMatchArguments":[]}]},
  {"pwTestLine":272,"pickleLine":214,"tags":["@AC-WB-021"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":273,"gherkinStepLine":206,"keywordType":"Context","textWithKeyword":"Given 共用專案的當次需求已有\"Gherkin\"內容及需求編號與情境編號對應","stepMatchArguments":[{"group":{"start":12,"value":"Gherkin"}}]},{"pwStepLine":274,"gherkinStepLine":207,"keywordType":"Action","textWithKeyword":"When 使用者在\"Gherkin確認\"階段將該產物保存到工作台SQLite","stepMatchArguments":[{"group":{"start":5,"value":"Gherkin確認"}}]},{"pwStepLine":275,"gherkinStepLine":208,"keywordType":"Action","textWithKeyword":"And 使用者關閉並重新開啟該需求後讀取該產物","stepMatchArguments":[]},{"pwStepLine":276,"gherkinStepLine":209,"keywordType":"Outcome","textWithKeyword":"Then 工作台從SQLite讀回與保存時相同的完整內容","stepMatchArguments":[]},{"pwStepLine":277,"gherkinStepLine":210,"keywordType":"Outcome","textWithKeyword":"And 該產物仍連結相同的需求編號與對應情境編號","stepMatchArguments":[]},{"pwStepLine":278,"gherkinStepLine":211,"keywordType":"Outcome","textWithKeyword":"And 這項產品儲存能力不改變bdd專案自身以Git保存開發文件與測試的方式","stepMatchArguments":[]}]},
  {"pwTestLine":281,"pickleLine":215,"tags":["@AC-WB-021"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":282,"gherkinStepLine":206,"keywordType":"Context","textWithKeyword":"Given 共用專案的當次需求已有\"spec.ts\"內容及需求編號與情境編號對應","stepMatchArguments":[{"group":{"start":12,"value":"spec.ts"}}]},{"pwStepLine":283,"gherkinStepLine":207,"keywordType":"Action","textWithKeyword":"When 使用者在\"test generation/completion\"階段將該產物保存到工作台SQLite","stepMatchArguments":[{"group":{"start":5,"value":"test generation/completion"}}]},{"pwStepLine":284,"gherkinStepLine":208,"keywordType":"Action","textWithKeyword":"And 使用者關閉並重新開啟該需求後讀取該產物","stepMatchArguments":[]},{"pwStepLine":285,"gherkinStepLine":209,"keywordType":"Outcome","textWithKeyword":"Then 工作台從SQLite讀回與保存時相同的完整內容","stepMatchArguments":[]},{"pwStepLine":286,"gherkinStepLine":210,"keywordType":"Outcome","textWithKeyword":"And 該產物仍連結相同的需求編號與對應情境編號","stepMatchArguments":[]},{"pwStepLine":287,"gherkinStepLine":211,"keywordType":"Outcome","textWithKeyword":"And 這項產品儲存能力不改變bdd專案自身以Git保存開發文件與測試的方式","stepMatchArguments":[]}]},
  {"pwTestLine":290,"pickleLine":216,"tags":["@AC-WB-021"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":291,"gherkinStepLine":206,"keywordType":"Context","textWithKeyword":"Given 共用專案的當次需求已有\"SD\"內容及需求編號與情境編號對應","stepMatchArguments":[{"group":{"start":12,"value":"SD"}}]},{"pwStepLine":292,"gherkinStepLine":207,"keywordType":"Action","textWithKeyword":"When 使用者在\"SD確認\"階段將該產物保存到工作台SQLite","stepMatchArguments":[{"group":{"start":5,"value":"SD確認"}}]},{"pwStepLine":293,"gherkinStepLine":208,"keywordType":"Action","textWithKeyword":"And 使用者關閉並重新開啟該需求後讀取該產物","stepMatchArguments":[]},{"pwStepLine":294,"gherkinStepLine":209,"keywordType":"Outcome","textWithKeyword":"Then 工作台從SQLite讀回與保存時相同的完整內容","stepMatchArguments":[]},{"pwStepLine":295,"gherkinStepLine":210,"keywordType":"Outcome","textWithKeyword":"And 該產物仍連結相同的需求編號與對應情境編號","stepMatchArguments":[]},{"pwStepLine":296,"gherkinStepLine":211,"keywordType":"Outcome","textWithKeyword":"And 這項產品儲存能力不改變bdd專案自身以Git保存開發文件與測試的方式","stepMatchArguments":[]}]},
  {"pwTestLine":301,"pickleLine":219,"tags":["@AC-WB-022"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":302,"gherkinStepLine":220,"keywordType":"Context","textWithKeyword":"Given 使用者已停止一次內嵌瀏覽器錄製並取得腳本草稿","stepMatchArguments":[]},{"pwStepLine":303,"gherkinStepLine":221,"keywordType":"Action","textWithKeyword":"When 使用者將腳本另存到工作台SQLite的使用者錄製腳本清單","stepMatchArguments":[]},{"pwStepLine":304,"gherkinStepLine":222,"keywordType":"Action","textWithKeyword":"And 使用者重新開啟該已保存腳本並按下重播","stepMatchArguments":[]},{"pwStepLine":305,"gherkinStepLine":223,"keywordType":"Outcome","textWithKeyword":"Then 工作台在瀏覽器實際重播已保存的操作與斷言","stepMatchArguments":[]},{"pwStepLine":306,"gherkinStepLine":224,"keywordType":"Outcome","textWithKeyword":"And 顯示該次重播的實際結果而不是把保存成功當成測試通過","stepMatchArguments":[]},{"pwStepLine":307,"gherkinStepLine":225,"keywordType":"Outcome","textWithKeyword":"And 該腳本保留已提供的需求與相關情境對應並與標準專案CI測試分開列示","stepMatchArguments":[]},{"pwStepLine":308,"gherkinStepLine":226,"keywordType":"Outcome","textWithKeyword":"And 不會自動新增或修改target Git的CI測試檔案或CI測試清單","stepMatchArguments":[]}]},
  {"pwTestLine":313,"pickleLine":238,"tags":["@AC-WB-023"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":314,"gherkinStepLine":230,"keywordType":"Context","textWithKeyword":"Given 工作台SQLite已有\"Gherkin\"的有效原文與結構化資料","stepMatchArguments":[{"group":{"start":12,"value":"Gherkin"}}]},{"pwStepLine":315,"gherkinStepLine":231,"keywordType":"Context","textWithKeyword":"And 使用者準備保存的同一檔案內容含語法錯誤","stepMatchArguments":[]},{"pwStepLine":316,"gherkinStepLine":232,"keywordType":"Action","textWithKeyword":"When 使用者要求將該\"Gherkin\"內容保存到SQLite","stepMatchArguments":[{"group":{"start":8,"value":"Gherkin"}}]},{"pwStepLine":317,"gherkinStepLine":233,"keywordType":"Outcome","textWithKeyword":"Then 工作台先以\"Gherkin語法解析器\"解析內容並拒絕將錯誤內容保存為有效版本","stepMatchArguments":[{"group":{"start":6,"value":"Gherkin語法解析器"}}]},{"pwStepLine":318,"gherkinStepLine":234,"keywordType":"Outcome","textWithKeyword":"And 回報錯誤的檔案名稱與行號及欄號與原因","stepMatchArguments":[]},{"pwStepLine":319,"gherkinStepLine":235,"keywordType":"Outcome","textWithKeyword":"And 原有有效版本的原文與結構化資料及來源對應保持不變","stepMatchArguments":[]}]},
  {"pwTestLine":322,"pickleLine":239,"tags":["@AC-WB-023"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":323,"gherkinStepLine":230,"keywordType":"Context","textWithKeyword":"Given 工作台SQLite已有\"spec.ts\"的有效原文與結構化資料","stepMatchArguments":[{"group":{"start":12,"value":"spec.ts"}}]},{"pwStepLine":324,"gherkinStepLine":231,"keywordType":"Context","textWithKeyword":"And 使用者準備保存的同一檔案內容含語法錯誤","stepMatchArguments":[]},{"pwStepLine":325,"gherkinStepLine":232,"keywordType":"Action","textWithKeyword":"When 使用者要求將該\"spec.ts\"內容保存到SQLite","stepMatchArguments":[{"group":{"start":8,"value":"spec.ts"}}]},{"pwStepLine":326,"gherkinStepLine":233,"keywordType":"Outcome","textWithKeyword":"Then 工作台先以\"TypeScript語法解析器\"解析內容並拒絕將錯誤內容保存為有效版本","stepMatchArguments":[{"group":{"start":6,"value":"TypeScript語法解析器"}}]},{"pwStepLine":327,"gherkinStepLine":234,"keywordType":"Outcome","textWithKeyword":"And 回報錯誤的檔案名稱與行號及欄號與原因","stepMatchArguments":[]},{"pwStepLine":328,"gherkinStepLine":235,"keywordType":"Outcome","textWithKeyword":"And 原有有效版本的原文與結構化資料及來源對應保持不變","stepMatchArguments":[]}]},
  {"pwTestLine":333,"pickleLine":242,"tags":["@AC-WB-024"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":334,"gherkinStepLine":243,"keywordType":"Context","textWithKeyword":"Given 語法有效的Gherkin原文對應需求\"REQ-DEMO-001\"","stepMatchArguments":[]},{"pwStepLine":335,"gherkinStepLine":244,"keywordType":"Context","textWithKeyword":"And 原文含Scenario Outline的Scenario ID\"AC-DEMO-001\"及有順序的steps與兩列Examples","stepMatchArguments":[]},{"pwStepLine":336,"gherkinStepLine":245,"keywordType":"Action","textWithKeyword":"When 使用者將該Gherkin保存到SQLite","stepMatchArguments":[]},{"pwStepLine":337,"gherkinStepLine":246,"keywordType":"Outcome","textWithKeyword":"Then 讀回的完整原文與提交內容逐字相同","stepMatchArguments":[]},{"pwStepLine":338,"gherkinStepLine":247,"keywordType":"Outcome","textWithKeyword":"And 可結構化查詢需求編號與Scenario ID及各step的關鍵字與文字及順序","stepMatchArguments":[]},{"pwStepLine":339,"gherkinStepLine":248,"keywordType":"Outcome","textWithKeyword":"And 可結構化查詢Examples的欄名與各列值及case_id且保留列順序","stepMatchArguments":[]},{"pwStepLine":340,"gherkinStepLine":249,"keywordType":"Outcome","textWithKeyword":"And 原文與結構化資料均連結同一來源文件版本與內容hash","stepMatchArguments":[]}]},
  {"pwTestLine":343,"pickleLine":252,"tags":["@AC-WB-025"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":344,"gherkinStepLine":253,"keywordType":"Context","textWithKeyword":"Given 指定來源版本的已確認Gherkin含情境\"AC-DEMO-001\"及Examples案例\"a\"與\"b\"","stepMatchArguments":[]},{"pwStepLine":345,"gherkinStepLine":254,"keywordType":"Context","textWithKeyword":"And 標準生成的spec.ts語法有效且測試\"test-a\"與\"test-b\"分別明確對應該情境的案例\"a\"與\"b\"","stepMatchArguments":[]},{"pwStepLine":346,"gherkinStepLine":255,"keywordType":"Context","textWithKeyword":"And 另一測試\"test-a-extra\"以不同test ID明確對應同一情境的案例\"a\"","stepMatchArguments":[]},{"pwStepLine":347,"gherkinStepLine":256,"keywordType":"Action","textWithKeyword":"When 使用者將該spec.ts與明確ID對應保存到SQLite","stepMatchArguments":[]},{"pwStepLine":348,"gherkinStepLine":257,"keywordType":"Outcome","textWithKeyword":"Then 讀回的完整spec.ts原文與提交內容逐字相同","stepMatchArguments":[]},{"pwStepLine":349,"gherkinStepLine":258,"keywordType":"Outcome","textWithKeyword":"And 可結構化查詢每個test ID及其需求編號與Scenario ID及Examples case_id","stepMatchArguments":[]},{"pwStepLine":350,"gherkinStepLine":259,"keywordType":"Outcome","textWithKeyword":"And 每筆對應可追溯spec.ts版本與內容hash及來源Gherkin版本與內容hash","stepMatchArguments":[]},{"pwStepLine":351,"gherkinStepLine":260,"keywordType":"Outcome","textWithKeyword":"And 相同Scenario ID下的不同Examples案例可各自對應不同測試","stepMatchArguments":[]},{"pwStepLine":352,"gherkinStepLine":261,"keywordType":"Outcome","textWithKeyword":"And 測試\"test-a\"與\"test-a-extra\"的映射均被保存且同時對應相同Scenario ID與Examples案例\"a\"","stepMatchArguments":[]},{"pwStepLine":353,"gherkinStepLine":262,"keywordType":"Outcome","textWithKeyword":"And 重新讀取時仍取得原本的來源版本而不是自動改指向最新Gherkin","stepMatchArguments":[]}]},
  {"pwTestLine":358,"pickleLine":275,"tags":["@AC-WB-026"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":359,"gherkinStepLine":266,"keywordType":"Context","textWithKeyword":"Given 工作台SQLite已有一份有效的標準生成spec.ts及其情境對應","stepMatchArguments":[]},{"pwStepLine":360,"gherkinStepLine":267,"keywordType":"Context","textWithKeyword":"And 待保存的新spec.ts通過TypeScript語法解析但其明確ID映射存在\"有測試未提供明確的情境與案例對應\"","stepMatchArguments":[{"group":{"start":39,"value":"有測試未提供明確的情境與案例對應"}}]},{"pwStepLine":361,"gherkinStepLine":268,"keywordType":"Action","textWithKeyword":"When 使用者要求保存該標準生成測試與映射","stepMatchArguments":[]},{"pwStepLine":362,"gherkinStepLine":269,"keywordType":"Outcome","textWithKeyword":"Then 工作台依指定來源版本的Gherkin與明確test ID映射拒絕該次保存","stepMatchArguments":[]},{"pwStepLine":363,"gherkinStepLine":270,"keywordType":"Outcome","textWithKeyword":"And 回報\"有測試未提供明確的情境與案例對應\"及相關test ID或來源案例ID","stepMatchArguments":[{"group":{"start":3,"value":"有測試未提供明確的情境與案例對應"}}]},{"pwStepLine":364,"gherkinStepLine":271,"keywordType":"Outcome","textWithKeyword":"And 未提供的情境對應不被自動推測或補造","stepMatchArguments":[]},{"pwStepLine":365,"gherkinStepLine":272,"keywordType":"Outcome","textWithKeyword":"And 原有有效spec.ts原文與結構化映射保持不變","stepMatchArguments":[]}]},
  {"pwTestLine":368,"pickleLine":276,"tags":["@AC-WB-026"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":369,"gherkinStepLine":266,"keywordType":"Context","textWithKeyword":"Given 工作台SQLite已有一份有效的標準生成spec.ts及其情境對應","stepMatchArguments":[]},{"pwStepLine":370,"gherkinStepLine":267,"keywordType":"Context","textWithKeyword":"And 待保存的新spec.ts通過TypeScript語法解析但其明確ID映射存在\"來源Gherkin有應生成的案例未對應任何測試\"","stepMatchArguments":[{"group":{"start":39,"value":"來源Gherkin有應生成的案例未對應任何測試"}}]},{"pwStepLine":371,"gherkinStepLine":268,"keywordType":"Action","textWithKeyword":"When 使用者要求保存該標準生成測試與映射","stepMatchArguments":[]},{"pwStepLine":372,"gherkinStepLine":269,"keywordType":"Outcome","textWithKeyword":"Then 工作台依指定來源版本的Gherkin與明確test ID映射拒絕該次保存","stepMatchArguments":[]},{"pwStepLine":373,"gherkinStepLine":270,"keywordType":"Outcome","textWithKeyword":"And 回報\"來源Gherkin有應生成的案例未對應任何測試\"及相關test ID或來源案例ID","stepMatchArguments":[{"group":{"start":3,"value":"來源Gherkin有應生成的案例未對應任何測試"}}]},{"pwStepLine":374,"gherkinStepLine":271,"keywordType":"Outcome","textWithKeyword":"And 未提供的情境對應不被自動推測或補造","stepMatchArguments":[]},{"pwStepLine":375,"gherkinStepLine":272,"keywordType":"Outcome","textWithKeyword":"And 原有有效spec.ts原文與結構化映射保持不變","stepMatchArguments":[]}]},
  {"pwTestLine":378,"pickleLine":277,"tags":["@AC-WB-026"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":379,"gherkinStepLine":266,"keywordType":"Context","textWithKeyword":"Given 工作台SQLite已有一份有效的標準生成spec.ts及其情境對應","stepMatchArguments":[]},{"pwStepLine":380,"gherkinStepLine":267,"keywordType":"Context","textWithKeyword":"And 待保存的新spec.ts通過TypeScript語法解析但其明確ID映射存在\"不同測試定義使用相同test ID\"","stepMatchArguments":[{"group":{"start":39,"value":"不同測試定義使用相同test ID"}}]},{"pwStepLine":381,"gherkinStepLine":268,"keywordType":"Action","textWithKeyword":"When 使用者要求保存該標準生成測試與映射","stepMatchArguments":[]},{"pwStepLine":382,"gherkinStepLine":269,"keywordType":"Outcome","textWithKeyword":"Then 工作台依指定來源版本的Gherkin與明確test ID映射拒絕該次保存","stepMatchArguments":[]},{"pwStepLine":383,"gherkinStepLine":270,"keywordType":"Outcome","textWithKeyword":"And 回報\"不同測試定義使用相同test ID\"及相關test ID或來源案例ID","stepMatchArguments":[{"group":{"start":3,"value":"不同測試定義使用相同test ID"}}]},{"pwStepLine":384,"gherkinStepLine":271,"keywordType":"Outcome","textWithKeyword":"And 未提供的情境對應不被自動推測或補造","stepMatchArguments":[]},{"pwStepLine":385,"gherkinStepLine":272,"keywordType":"Outcome","textWithKeyword":"And 原有有效spec.ts原文與結構化映射保持不變","stepMatchArguments":[]}]},
  {"pwTestLine":388,"pickleLine":278,"tags":["@AC-WB-026"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":389,"gherkinStepLine":266,"keywordType":"Context","textWithKeyword":"Given 工作台SQLite已有一份有效的標準生成spec.ts及其情境對應","stepMatchArguments":[]},{"pwStepLine":390,"gherkinStepLine":267,"keywordType":"Context","textWithKeyword":"And 待保存的新spec.ts通過TypeScript語法解析但其明確ID映射存在\"完全相同test ID與來源案例的映射資料重複\"","stepMatchArguments":[{"group":{"start":39,"value":"完全相同test ID與來源案例的映射資料重複"}}]},{"pwStepLine":391,"gherkinStepLine":268,"keywordType":"Action","textWithKeyword":"When 使用者要求保存該標準生成測試與映射","stepMatchArguments":[]},{"pwStepLine":392,"gherkinStepLine":269,"keywordType":"Outcome","textWithKeyword":"Then 工作台依指定來源版本的Gherkin與明確test ID映射拒絕該次保存","stepMatchArguments":[]},{"pwStepLine":393,"gherkinStepLine":270,"keywordType":"Outcome","textWithKeyword":"And 回報\"完全相同test ID與來源案例的映射資料重複\"及相關test ID或來源案例ID","stepMatchArguments":[{"group":{"start":3,"value":"完全相同test ID與來源案例的映射資料重複"}}]},{"pwStepLine":394,"gherkinStepLine":271,"keywordType":"Outcome","textWithKeyword":"And 未提供的情境對應不被自動推測或補造","stepMatchArguments":[]},{"pwStepLine":395,"gherkinStepLine":272,"keywordType":"Outcome","textWithKeyword":"And 原有有效spec.ts原文與結構化映射保持不變","stepMatchArguments":[]}]},
  {"pwTestLine":398,"pickleLine":279,"tags":["@AC-WB-026"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":399,"gherkinStepLine":266,"keywordType":"Context","textWithKeyword":"Given 工作台SQLite已有一份有效的標準生成spec.ts及其情境對應","stepMatchArguments":[]},{"pwStepLine":400,"gherkinStepLine":267,"keywordType":"Context","textWithKeyword":"And 待保存的新spec.ts通過TypeScript語法解析但其明確ID映射存在\"引用指定來源版本中不存在的Scenario ID\"","stepMatchArguments":[{"group":{"start":39,"value":"引用指定來源版本中不存在的Scenario ID"}}]},{"pwStepLine":401,"gherkinStepLine":268,"keywordType":"Action","textWithKeyword":"When 使用者要求保存該標準生成測試與映射","stepMatchArguments":[]},{"pwStepLine":402,"gherkinStepLine":269,"keywordType":"Outcome","textWithKeyword":"Then 工作台依指定來源版本的Gherkin與明確test ID映射拒絕該次保存","stepMatchArguments":[]},{"pwStepLine":403,"gherkinStepLine":270,"keywordType":"Outcome","textWithKeyword":"And 回報\"引用指定來源版本中不存在的Scenario ID\"及相關test ID或來源案例ID","stepMatchArguments":[{"group":{"start":3,"value":"引用指定來源版本中不存在的Scenario ID"}}]},{"pwStepLine":404,"gherkinStepLine":271,"keywordType":"Outcome","textWithKeyword":"And 未提供的情境對應不被自動推測或補造","stepMatchArguments":[]},{"pwStepLine":405,"gherkinStepLine":272,"keywordType":"Outcome","textWithKeyword":"And 原有有效spec.ts原文與結構化映射保持不變","stepMatchArguments":[]}]},
  {"pwTestLine":408,"pickleLine":280,"tags":["@AC-WB-026"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":409,"gherkinStepLine":266,"keywordType":"Context","textWithKeyword":"Given 工作台SQLite已有一份有效的標準生成spec.ts及其情境對應","stepMatchArguments":[]},{"pwStepLine":410,"gherkinStepLine":267,"keywordType":"Context","textWithKeyword":"And 待保存的新spec.ts通過TypeScript語法解析但其明確ID映射存在\"引用指定來源情境中不存在的Examples case_id\"","stepMatchArguments":[{"group":{"start":39,"value":"引用指定來源情境中不存在的Examples case_id"}}]},{"pwStepLine":411,"gherkinStepLine":268,"keywordType":"Action","textWithKeyword":"When 使用者要求保存該標準生成測試與映射","stepMatchArguments":[]},{"pwStepLine":412,"gherkinStepLine":269,"keywordType":"Outcome","textWithKeyword":"Then 工作台依指定來源版本的Gherkin與明確test ID映射拒絕該次保存","stepMatchArguments":[]},{"pwStepLine":413,"gherkinStepLine":270,"keywordType":"Outcome","textWithKeyword":"And 回報\"引用指定來源情境中不存在的Examples case_id\"及相關test ID或來源案例ID","stepMatchArguments":[{"group":{"start":3,"value":"引用指定來源情境中不存在的Examples case_id"}}]},{"pwStepLine":414,"gherkinStepLine":271,"keywordType":"Outcome","textWithKeyword":"And 未提供的情境對應不被自動推測或補造","stepMatchArguments":[]},{"pwStepLine":415,"gherkinStepLine":272,"keywordType":"Outcome","textWithKeyword":"And 原有有效spec.ts原文與結構化映射保持不變","stepMatchArguments":[]}]},
  {"pwTestLine":420,"pickleLine":283,"tags":["@AC-WB-027"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":421,"gherkinStepLine":284,"keywordType":"Context","textWithKeyword":"Given 使用者已取得語法有效且未連結需求編號或Scenario ID的自錄Playwright腳本","stepMatchArguments":[]},{"pwStepLine":422,"gherkinStepLine":285,"keywordType":"Action","textWithKeyword":"When 使用者將該腳本另存到SQLite的使用者錄製腳本清單","stepMatchArguments":[]},{"pwStepLine":423,"gherkinStepLine":286,"keywordType":"Outcome","textWithKeyword":"Then 工作台保存完整原文且需求與情境對應維持未關聯","stepMatchArguments":[]},{"pwStepLine":424,"gherkinStepLine":287,"keywordType":"Outcome","textWithKeyword":"And 不要求補造需求或Scenario ID以通過標準生成測試的映射檢核","stepMatchArguments":[]},{"pwStepLine":425,"gherkinStepLine":288,"keywordType":"Outcome","textWithKeyword":"And 使用者可重新開啟該腳本並重播","stepMatchArguments":[]},{"pwStepLine":426,"gherkinStepLine":289,"keywordType":"Outcome","textWithKeyword":"And 該腳本仍獨立於標準專案CI且不會自動新增或修改target Git的CI測試","stepMatchArguments":[]}]},
  {"pwTestLine":429,"pickleLine":292,"tags":["@AC-WB-028"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":430,"gherkinStepLine":293,"keywordType":"Context","textWithKeyword":"Given 專案已有Gherkin情境\"AC-DEMO-001\"及Examples案例\"a\"與\"b\"的spec.ts骨架與明確測試映射","stepMatchArguments":[]},{"pwStepLine":431,"gherkinStepLine":294,"keywordType":"Context","textWithKeyword":"And 案例\"a\"對應測試\"test-a\"與\"test-a-extra\"且案例\"b\"對應測試\"test-b\"","stepMatchArguments":[]},{"pwStepLine":432,"gherkinStepLine":295,"keywordType":"Context","textWithKeyword":"And 這些測試目前只有尚未由LLM補齊的codegen殼","stepMatchArguments":[]},{"pwStepLine":433,"gherkinStepLine":296,"keywordType":"Action","textWithKeyword":"When 使用者開啟工作台的Gherkin測試清單","stepMatchArguments":[]},{"pwStepLine":434,"gherkinStepLine":297,"keywordType":"Outcome","textWithKeyword":"Then 清單列出該情境與案例\"a\"及\"b\"及各自對應的test ID","stepMatchArguments":[]},{"pwStepLine":435,"gherkinStepLine":298,"keywordType":"Outcome","textWithKeyword":"And 只有codegen殼的測試顯示待補齊且不可標示已通過","stepMatchArguments":[]},{"pwStepLine":436,"gherkinStepLine":299,"keywordType":"Action","textWithKeyword":"When 使用者在測試已由LLM補齊且測試基線與程式版本已固定後點選案例\"a\"並按下執行","stepMatchArguments":[]},{"pwStepLine":437,"gherkinStepLine":300,"keywordType":"Outcome","textWithKeyword":"Then 工作台建立本次run且runner只執行對應的spec.ts測試\"test-a\"與\"test-a-extra\"","stepMatchArguments":[]},{"pwStepLine":438,"gherkinStepLine":301,"keywordType":"Outcome","textWithKeyword":"And 未選取的\"test-b\"本次不執行也不標示通過","stepMatchArguments":[]},{"pwStepLine":439,"gherkinStepLine":302,"keywordType":"Outcome","textWithKeyword":"And 右側內嵌瀏覽器即時呈現本次run目前測試所用的同一session與page的真實操作","stepMatchArguments":[]},{"pwStepLine":440,"gherkinStepLine":303,"keywordType":"Outcome","textWithKeyword":"And 各測試的實際斷言與每步截圖及成功或失敗結果均對應本次run與所選情境及案例","stepMatchArguments":[]},{"pwStepLine":441,"gherkinStepLine":304,"keywordType":"Outcome","textWithKeyword":"And 只有所選案例的必要測試與斷言及證據完整通過才標示該案例通過","stepMatchArguments":[]},{"pwStepLine":442,"gherkinStepLine":305,"keywordType":"Outcome","textWithKeyword":"And 所選案例通過不代表未執行的全專案案例已通過","stepMatchArguments":[]}]},
  {"pwTestLine":445,"pickleLine":308,"tags":["@AC-WB-029"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":446,"gherkinStepLine":309,"keywordType":"Context","textWithKeyword":"Given 專案已設定DbGate網頁入口且連接該專案的測試資料庫","stepMatchArguments":[]},{"pwStepLine":447,"gherkinStepLine":310,"keywordType":"Context","textWithKeyword":"And 測試已明確指定查詢SQL與預期欄位值","stepMatchArguments":[]},{"pwStepLine":448,"gherkinStepLine":311,"keywordType":"Action","textWithKeyword":"When spec使用Playwright在DbGate執行查詢並等待本次結果顯示","stepMatchArguments":[]},{"pwStepLine":449,"gherkinStepLine":312,"keywordType":"Outcome","textWithKeyword":"Then spec從DbGate結果表格讀取實際欄位值並斷言符合預期","stepMatchArguments":[]},{"pwStepLine":450,"gherkinStepLine":313,"keywordType":"Outcome","textWithKeyword":"And Playwright擷取本次DbGate查詢與結果表格的畫面","stepMatchArguments":[]},{"pwStepLine":451,"gherkinStepLine":314,"keywordType":"Outcome","textWithKeyword":"And 測試報告保存查詢SQL與預期值及實際值並可開啟對應DbGate截圖","stepMatchArguments":[]},{"pwStepLine":452,"gherkinStepLine":315,"keywordType":"Outcome","textWithKeyword":"And DbGate截圖與資料斷言對應同一次run與Gherkin情境及案例與step及被驗證程式版本","stepMatchArguments":[]},{"pwStepLine":453,"gherkinStepLine":316,"keywordType":"Outcome","textWithKeyword":"And 查詢失敗或資料不符時報告保留失敗結果與錯誤及DbGate畫面","stepMatchArguments":[]},{"pwStepLine":454,"gherkinStepLine":317,"keywordType":"Outcome","textWithKeyword":"And DbGate無法連線或結果未載入時明確顯示錯誤且不標示資料驗證通過","stepMatchArguments":[]},{"pwStepLine":455,"gherkinStepLine":318,"keywordType":"Outcome","textWithKeyword":"And 截圖保存成功本身不代表資料斷言通過","stepMatchArguments":[]}]},
  {"pwTestLine":458,"pickleLine":321,"tags":["@AC-WB-030"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":459,"gherkinStepLine":322,"keywordType":"Context","textWithKeyword":"Given 使用者開啟需求首頁且已有可選工作區","stepMatchArguments":[]},{"pwStepLine":460,"gherkinStepLine":323,"keywordType":"Action","textWithKeyword":"When 使用者新增需求並在同一表單選擇一個以上工作區","stepMatchArguments":[]},{"pwStepLine":461,"gherkinStepLine":324,"keywordType":"Outcome","textWithKeyword":"Then 新需求建立時即關聯所選工作區","stepMatchArguments":[]},{"pwStepLine":462,"gherkinStepLine":325,"keywordType":"Action","textWithKeyword":"When 使用者在該需求新增第二份Gherkin","stepMatchArguments":[]},{"pwStepLine":463,"gherkinStepLine":326,"keywordType":"Outcome","textWithKeyword":"Then 左側需求節點展開列出兩份Gherkin與各自狀態","stepMatchArguments":[]},{"pwStepLine":464,"gherkinStepLine":327,"keywordType":"Action","textWithKeyword":"When 使用者在需求清單展開需求並編輯名稱","stepMatchArguments":[]},{"pwStepLine":465,"gherkinStepLine":328,"keywordType":"Outcome","textWithKeyword":"Then Gherkin在原列下方樹狀展開且名稱旁直接出現輸入框與多選工作區下拉選單","stepMatchArguments":[]},{"pwStepLine":466,"gherkinStepLine":329,"keywordType":"Outcome","textWithKeyword":"And 保存需求名稱時一併保存工作區關聯","stepMatchArguments":[]},{"pwStepLine":467,"gherkinStepLine":330,"keywordType":"Outcome","textWithKeyword":"And 工作區管理位於需求首頁下方而非獨立頁面","stepMatchArguments":[]},{"pwStepLine":468,"gherkinStepLine":331,"keywordType":"Action","textWithKeyword":"When 使用者從左側點選其中一份Gherkin並捲動右側工作區","stepMatchArguments":[]},{"pwStepLine":469,"gherkinStepLine":332,"keywordType":"Outcome","textWithKeyword":"Then 左側需求選單維持固定且右側頁籤顯示所選Gherkin的滿版流程內容","stepMatchArguments":[]},{"pwStepLine":470,"gherkinStepLine":333,"keywordType":"Outcome","textWithKeyword":"And 右側可開啟及切換多個頁籤","stepMatchArguments":[]},{"pwStepLine":471,"gherkinStepLine":334,"keywordType":"Outcome","textWithKeyword":"And 重新載入後仍顯示相同需求及所選Gherkin","stepMatchArguments":[]}]},
  {"pwTestLine":474,"pickleLine":337,"tags":["@AC-WB-031"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":475,"gherkinStepLine":338,"keywordType":"Context","textWithKeyword":"Given 兩個程式碼專案已各自綁定不同的本機目錄","stepMatchArguments":[]},{"pwStepLine":476,"gherkinStepLine":339,"keywordType":"Action","textWithKeyword":"When 使用者在需求中關聯這兩個專案","stepMatchArguments":[]},{"pwStepLine":477,"gherkinStepLine":340,"keywordType":"Outcome","textWithKeyword":"Then 工作台保留一份需求與其Gherkin及專屬SD和BDD而不按專案複製需求","stepMatchArguments":[]},{"pwStepLine":478,"gherkinStepLine":341,"keywordType":"Action","textWithKeyword":"When 使用者在需求開發區切換目前操作專案並開啟terminal","stepMatchArguments":[]},{"pwStepLine":479,"gherkinStepLine":342,"keywordType":"Outcome","textWithKeyword":"Then 每個terminal的實際工作目錄等於所選專案綁定的本機目錄","stepMatchArguments":[]},{"pwStepLine":480,"gherkinStepLine":343,"keywordType":"Outcome","textWithKeyword":"And 工作區管理與需求清單位於同一首頁且需求不隸屬單一工作區","stepMatchArguments":[]}]},
  {"pwTestLine":483,"pickleLine":346,"tags":["@AC-WB-032"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":484,"gherkinStepLine":347,"keywordType":"Context","textWithKeyword":"Given 工作台資料庫尚未套用預設設定","stepMatchArguments":[]},{"pwStepLine":485,"gherkinStepLine":348,"keywordType":"Action","textWithKeyword":"When 工作台首次啟動","stepMatchArguments":[]},{"pwStepLine":486,"gherkinStepLine":349,"keywordType":"Outcome","textWithKeyword":"Then 資料庫建立Codex與Kiro CLI及從skills/playwright-bdd/SKILL.md載入的Playwright BDD Skill","stepMatchArguments":[]},{"pwStepLine":487,"gherkinStepLine":350,"keywordType":"Outcome","textWithKeyword":"And 資料庫建立需求確認、系統設計、測試情境及程式開發Agent，並綁定Codex CLI與Playwright BDD Skill","stepMatchArguments":[]},{"pwStepLine":488,"gherkinStepLine":351,"keywordType":"Outcome","textWithKeyword":"And 流程設定預設將四個Agent各自指派到對應可編輯階段，驗證報告維持唯讀","stepMatchArguments":[]},{"pwStepLine":489,"gherkinStepLine":352,"keywordType":"Action","textWithKeyword":"When 使用者修改流程指派、編輯或刪除預設資料並重新啟動工作台","stepMatchArguments":[]},{"pwStepLine":490,"gherkinStepLine":353,"keywordType":"Outcome","textWithKeyword":"Then 流程指派與編輯內容持續保存且已刪除的預設資料不會重新建立","stepMatchArguments":[]}]},
  {"pwTestLine":493,"pickleLine":356,"tags":["@AC-WB-035"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":494,"gherkinStepLine":357,"keywordType":"Context","textWithKeyword":"Given 工作台資料庫已有舊版LLM預設設定且缺少系統設計、測試情境及程式開發Agent","stepMatchArguments":[]},{"pwStepLine":495,"gherkinStepLine":358,"keywordType":"Context","textWithKeyword":"And 使用者已自訂CLI、Skill、Agent或流程指派","stepMatchArguments":[]},{"pwStepLine":496,"gherkinStepLine":359,"keywordType":"Action","textWithKeyword":"When 工作台啟動新版","stepMatchArguments":[]},{"pwStepLine":497,"gherkinStepLine":360,"keywordType":"Outcome","textWithKeyword":"Then 資料庫補齊缺少的Playwright BDD Skill與流程Agent","stepMatchArguments":[]},{"pwStepLine":498,"gherkinStepLine":361,"keywordType":"Outcome","textWithKeyword":"And 四個可編輯階段各指派一個對應Agent且驗證報告維持唯讀","stepMatchArguments":[]},{"pwStepLine":499,"gherkinStepLine":362,"keywordType":"Outcome","textWithKeyword":"And 未修改的舊版Codex預設參數升級為目前預設","stepMatchArguments":[]},{"pwStepLine":500,"gherkinStepLine":363,"keywordType":"Outcome","textWithKeyword":"And 使用者已自訂的設定值保持不變","stepMatchArguments":[]},{"pwStepLine":501,"gherkinStepLine":364,"keywordType":"Action","textWithKeyword":"When 工作台再次啟動","stepMatchArguments":[]},{"pwStepLine":502,"gherkinStepLine":365,"keywordType":"Outcome","textWithKeyword":"Then 升級不重複執行且已刪除的預設資料不會重新建立","stepMatchArguments":[]}]},
  {"pwTestLine":505,"pickleLine":368,"tags":["@AC-WB-033"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":506,"gherkinStepLine":369,"keywordType":"Context","textWithKeyword":"Given CLI、Skill及Agent已保存","stepMatchArguments":[]},{"pwStepLine":507,"gherkinStepLine":370,"keywordType":"Action","textWithKeyword":"When 使用者為需求確認、系統設計、測試情境及程式開發各自指派多個Agent","stepMatchArguments":[]},{"pwStepLine":508,"gherkinStepLine":371,"keywordType":"Outcome","textWithKeyword":"Then 設定持續保存且驗證報告維持唯讀","stepMatchArguments":[]},{"pwStepLine":509,"gherkinStepLine":372,"keywordType":"Action","textWithKeyword":"When 使用者開啟其中一個目前可編輯的需求階段","stepMatchArguments":[]},{"pwStepLine":510,"gherkinStepLine":373,"keywordType":"Outcome","textWithKeyword":"Then 該階段只顯示已指派Agent的操作按鈕","stepMatchArguments":[]},{"pwStepLine":511,"gherkinStepLine":374,"keywordType":"Outcome","textWithKeyword":"And 啟動Agent會在網頁terminal開啟設定的互動CLI並帶入Prompt、Skill及階段文件","stepMatchArguments":[]},{"pwStepLine":512,"gherkinStepLine":375,"keywordType":"Outcome","textWithKeyword":"And Agent未指派到該階段時伺服器拒絕啟動","stepMatchArguments":[]}]},
  {"pwTestLine":517,"pickleLine":386,"tags":["@AC-WB-034"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":518,"gherkinStepLine":379,"keywordType":"Context","textWithKeyword":"Given 該Gherkin已完成需求確認、系統設計、測試基線、程式基線及驗證","stepMatchArguments":[]},{"pwStepLine":519,"gherkinStepLine":380,"keywordType":"Action","textWithKeyword":"When 使用者選擇已完成的\"GHERKIN\"並按右下角重啟階段","stepMatchArguments":[{"group":{"start":10,"value":"GHERKIN"}}]},{"pwStepLine":520,"gherkinStepLine":381,"keywordType":"Outcome","textWithKeyword":"Then 該階段成為目前階段且後續階段回到未完成狀態","stepMatchArguments":[]},{"pwStepLine":521,"gherkinStepLine":382,"keywordType":"Outcome","textWithKeyword":"And 確認狀態與基線結果符合\"無確認\"及\"Gherkin及SD確認與全部基線\"","stepMatchArguments":[{"group":{"start":12,"value":"無確認"}},{"group":{"start":18,"value":"Gherkin及SD確認與全部基線"}}]},{"pwStepLine":522,"gherkinStepLine":383,"keywordType":"Outcome","textWithKeyword":"And 執行結果標為失效但歷史版本及報告仍保留","stepMatchArguments":[]}]},
  {"pwTestLine":525,"pickleLine":387,"tags":["@AC-WB-034"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":526,"gherkinStepLine":379,"keywordType":"Context","textWithKeyword":"Given 該Gherkin已完成需求確認、系統設計、測試基線、程式基線及驗證","stepMatchArguments":[]},{"pwStepLine":527,"gherkinStepLine":380,"keywordType":"Action","textWithKeyword":"When 使用者選擇已完成的\"SD\"並按右下角重啟階段","stepMatchArguments":[{"group":{"start":10,"value":"SD"}}]},{"pwStepLine":528,"gherkinStepLine":381,"keywordType":"Outcome","textWithKeyword":"Then 該階段成為目前階段且後續階段回到未完成狀態","stepMatchArguments":[]},{"pwStepLine":529,"gherkinStepLine":382,"keywordType":"Outcome","textWithKeyword":"And 確認狀態與基線結果符合\"Gherkin確認\"及\"SD確認及全部基線\"","stepMatchArguments":[{"group":{"start":12,"value":"Gherkin確認"}},{"group":{"start":24,"value":"SD確認及全部基線"}}]},{"pwStepLine":530,"gherkinStepLine":383,"keywordType":"Outcome","textWithKeyword":"And 執行結果標為失效但歷史版本及報告仍保留","stepMatchArguments":[]}]},
  {"pwTestLine":533,"pickleLine":388,"tags":["@AC-WB-034"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":534,"gherkinStepLine":379,"keywordType":"Context","textWithKeyword":"Given 該Gherkin已完成需求確認、系統設計、測試基線、程式基線及驗證","stepMatchArguments":[]},{"pwStepLine":535,"gherkinStepLine":380,"keywordType":"Action","textWithKeyword":"When 使用者選擇已完成的\"TESTS\"並按右下角重啟階段","stepMatchArguments":[{"group":{"start":10,"value":"TESTS"}}]},{"pwStepLine":536,"gherkinStepLine":381,"keywordType":"Outcome","textWithKeyword":"Then 該階段成為目前階段且後續階段回到未完成狀態","stepMatchArguments":[]},{"pwStepLine":537,"gherkinStepLine":382,"keywordType":"Outcome","textWithKeyword":"And 確認狀態與基線結果符合\"Gherkin及SD確認\"及\"測試與程式基線\"","stepMatchArguments":[{"group":{"start":12,"value":"Gherkin及SD確認"}},{"group":{"start":27,"value":"測試與程式基線"}}]},{"pwStepLine":538,"gherkinStepLine":383,"keywordType":"Outcome","textWithKeyword":"And 執行結果標為失效但歷史版本及報告仍保留","stepMatchArguments":[]}]},
  {"pwTestLine":541,"pickleLine":389,"tags":["@AC-WB-034"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":542,"gherkinStepLine":379,"keywordType":"Context","textWithKeyword":"Given 該Gherkin已完成需求確認、系統設計、測試基線、程式基線及驗證","stepMatchArguments":[]},{"pwStepLine":543,"gherkinStepLine":380,"keywordType":"Action","textWithKeyword":"When 使用者選擇已完成的\"IMPLEMENTATION\"並按右下角重啟階段","stepMatchArguments":[{"group":{"start":10,"value":"IMPLEMENTATION"}}]},{"pwStepLine":544,"gherkinStepLine":381,"keywordType":"Outcome","textWithKeyword":"Then 該階段成為目前階段且後續階段回到未完成狀態","stepMatchArguments":[]},{"pwStepLine":545,"gherkinStepLine":382,"keywordType":"Outcome","textWithKeyword":"And 確認狀態與基線結果符合\"Gherkin及SD確認與測試基線\"及\"程式基線\"","stepMatchArguments":[{"group":{"start":12,"value":"Gherkin及SD確認與測試基線"}},{"group":{"start":32,"value":"程式基線"}}]},{"pwStepLine":546,"gherkinStepLine":383,"keywordType":"Outcome","textWithKeyword":"And 執行結果標為失效但歷史版本及報告仍保留","stepMatchArguments":[]}]},
  {"pwTestLine":549,"pickleLine":390,"tags":["@AC-WB-034"],"steps":[{"pwStepLine":7,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"Given 已選擇工作台的需求","isBg":true,"stepMatchArguments":[]},{"pwStepLine":550,"gherkinStepLine":379,"keywordType":"Context","textWithKeyword":"Given 該Gherkin已完成需求確認、系統設計、測試基線、程式基線及驗證","stepMatchArguments":[]},{"pwStepLine":551,"gherkinStepLine":380,"keywordType":"Action","textWithKeyword":"When 使用者選擇已完成的\"VERIFICATION\"並按右下角重啟階段","stepMatchArguments":[{"group":{"start":10,"value":"VERIFICATION"}}]},{"pwStepLine":552,"gherkinStepLine":381,"keywordType":"Outcome","textWithKeyword":"Then 該階段成為目前階段且後續階段回到未完成狀態","stepMatchArguments":[]},{"pwStepLine":553,"gherkinStepLine":382,"keywordType":"Outcome","textWithKeyword":"And 確認狀態與基線結果符合\"Gherkin及SD確認與測試及程式基線\"及\"僅執行結果\"","stepMatchArguments":[{"group":{"start":12,"value":"Gherkin及SD確認與測試及程式基線"}},{"group":{"start":35,"value":"僅執行結果"}}]},{"pwStepLine":554,"gherkinStepLine":383,"keywordType":"Outcome","textWithKeyword":"And 執行結果標為失效但歷史版本及報告仍保留","stepMatchArguments":[]}]},
]; // bdd-data-end