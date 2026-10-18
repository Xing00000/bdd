// Generated from: mcp.feature
import { test } from "playwright-bdd";

test.describe('工作台內建MCP服務供CLI Agent查詢資料與提交提案', () => {

  test.beforeEach('Background', async ({ Given, page }, testInfo) => { if (testInfo.error) return;
    await Given('需求已關聯綁定本機目錄與SQLite測試資料庫的工作區且已完成Gherkin確認', null, { page }); 
  });
  
  test('CLI Agent透過內建MCP工具查詢對應Prompt、需求文件、結構化Gherkin、工作區檔案與資料庫Schema', { tag: ['@AC-WB-MCP-001'] , annotation: [{type:'workbenchTestId',description:"AC-WB-MCP-001/default"}]}, async ({ When, Then, And, page }) => { 
    await When('使用者啟動已指派的階段Agent並連線工作台內建MCP服務', null, { page }); 
    await Then('CLI Agent可透過MCP取得目前階段指派Agent對應的資料庫Prompt與Skill指引', null, { page }); 
    await And('CLI Agent可透過MCP工具讀取目前需求階段狀態與已確認Gherkin及現有SD文件', null, { page }); 
    await And('CLI Agent可透過MCP工具查詢結構化Gherkin情境、步驟與Examples案例對應', null, { page }); 
    await And('CLI Agent可透過MCP工具列出並讀取關聯工作區內的專案檔案且拒絕越界路徑', null, { page }); 
    await And('CLI Agent可透過MCP工具查詢關聯專案SQLite測試資料庫的實際Schema', null, { page }); 
  });

  test('CLI Agent透過MCP工具提交系統設計提案或待補問題並即時檢核格式', { tag: ['@AC-WB-MCP-002'] , annotation: [{type:'workbenchTestId',description:"AC-WB-MCP-002/default"}]}, async ({ Given, When, Then, page }) => { 
    await Given('需求目前處於系統設計階段且已啟動系統設計Agent的MCP會話', null, { page }); 
    await When('CLI Agent透過MCP工具提交缺少必要章節的無效SD提案', null, { page }); 
    await Then('MCP工具即時回傳SD格式檢核錯誤供同一CLI會話修正且不保存無效版本', null, { page }); 
    await When('CLI Agent透過MCP工具提交資訊不足的待補問題清單', null, { page }); 
    await Then('工作台記錄待補問題供人類檢視且維持系統設計階段未確認', null, { page }); 
    await When('CLI Agent透過MCP工具提交符合統一格式的完整SD提案', null, { page }); 
    await Then('工作台保存新的SD版本並完成本次系統設計CLI提案流程', null, { page }); 
  });

  test('CLI Agent透過MCP工具提交測試步驟補齊提案並即時檢核映射與型別', { tag: ['@AC-WB-MCP-003'] , annotation: [{type:'workbenchTestId',description:"AC-WB-MCP-003/default"}]}, async ({ Given, When, Then, page }) => { 
    await Given('需求已確認SD並產生測試骨架且已啟動測試情境Agent的MCP會話', null, { page }); 
    await When('CLI Agent透過MCP工具提交刪除既有workbenchTestId或型別錯誤的測試補齊提案', null, { page }); 
    await Then('MCP工具即時回傳映射或編譯檢核診斷供同一CLI會話修正且不覆蓋有效測試版本', null, { page }); 
    await When('CLI Agent透過MCP工具提交保留完整測試ID映射且通過檢核的測試補齊提案', null, { page }); 
    await Then('工作台保存COMPLETED測試版本並完成本次測試補齊CLI提案流程', null, { page }); 
  });

});

// == technical section ==

test.use({
  $test: [({}, use) => use(test), { scope: 'test', box: true }],
  $uri: [({}, use) => use('mcp.feature'), { scope: 'test', box: true }],
  $bddFileData: [({}, use) => use(bddFileData as import('playwright-bdd').BddTestFixtures['$bddFileData']), { scope: "test", box: true }],
});

const bddFileData = [ // bdd-data-start
  {"pwTestLine":10,"pickleLine":9,"tags":["@AC-WB-MCP-001"],"steps":[{"pwStepLine":7,"gherkinStepLine":6,"keywordType":"Context","textWithKeyword":"Given 需求已關聯綁定本機目錄與SQLite測試資料庫的工作區且已完成Gherkin確認","isBg":true,"stepMatchArguments":[]},{"pwStepLine":11,"gherkinStepLine":10,"keywordType":"Action","textWithKeyword":"When 使用者啟動已指派的階段Agent並連線工作台內建MCP服務","stepMatchArguments":[]},{"pwStepLine":12,"gherkinStepLine":11,"keywordType":"Outcome","textWithKeyword":"Then CLI Agent可透過MCP取得目前階段指派Agent對應的資料庫Prompt與Skill指引","stepMatchArguments":[]},{"pwStepLine":13,"gherkinStepLine":12,"keywordType":"Outcome","textWithKeyword":"And CLI Agent可透過MCP工具讀取目前需求階段狀態與已確認Gherkin及現有SD文件","stepMatchArguments":[]},{"pwStepLine":14,"gherkinStepLine":13,"keywordType":"Outcome","textWithKeyword":"And CLI Agent可透過MCP工具查詢結構化Gherkin情境、步驟與Examples案例對應","stepMatchArguments":[]},{"pwStepLine":15,"gherkinStepLine":14,"keywordType":"Outcome","textWithKeyword":"And CLI Agent可透過MCP工具列出並讀取關聯工作區內的專案檔案且拒絕越界路徑","stepMatchArguments":[]},{"pwStepLine":16,"gherkinStepLine":15,"keywordType":"Outcome","textWithKeyword":"And CLI Agent可透過MCP工具查詢關聯專案SQLite測試資料庫的實際Schema","stepMatchArguments":[]}]},
  {"pwTestLine":19,"pickleLine":18,"tags":["@AC-WB-MCP-002"],"steps":[{"pwStepLine":7,"gherkinStepLine":6,"keywordType":"Context","textWithKeyword":"Given 需求已關聯綁定本機目錄與SQLite測試資料庫的工作區且已完成Gherkin確認","isBg":true,"stepMatchArguments":[]},{"pwStepLine":20,"gherkinStepLine":19,"keywordType":"Context","textWithKeyword":"Given 需求目前處於系統設計階段且已啟動系統設計Agent的MCP會話","stepMatchArguments":[]},{"pwStepLine":21,"gherkinStepLine":20,"keywordType":"Action","textWithKeyword":"When CLI Agent透過MCP工具提交缺少必要章節的無效SD提案","stepMatchArguments":[]},{"pwStepLine":22,"gherkinStepLine":21,"keywordType":"Outcome","textWithKeyword":"Then MCP工具即時回傳SD格式檢核錯誤供同一CLI會話修正且不保存無效版本","stepMatchArguments":[]},{"pwStepLine":23,"gherkinStepLine":22,"keywordType":"Action","textWithKeyword":"When CLI Agent透過MCP工具提交資訊不足的待補問題清單","stepMatchArguments":[]},{"pwStepLine":24,"gherkinStepLine":23,"keywordType":"Outcome","textWithKeyword":"Then 工作台記錄待補問題供人類檢視且維持系統設計階段未確認","stepMatchArguments":[]},{"pwStepLine":25,"gherkinStepLine":24,"keywordType":"Action","textWithKeyword":"When CLI Agent透過MCP工具提交符合統一格式的完整SD提案","stepMatchArguments":[]},{"pwStepLine":26,"gherkinStepLine":25,"keywordType":"Outcome","textWithKeyword":"Then 工作台保存新的SD版本並完成本次系統設計CLI提案流程","stepMatchArguments":[]}]},
  {"pwTestLine":29,"pickleLine":28,"tags":["@AC-WB-MCP-003"],"steps":[{"pwStepLine":7,"gherkinStepLine":6,"keywordType":"Context","textWithKeyword":"Given 需求已關聯綁定本機目錄與SQLite測試資料庫的工作區且已完成Gherkin確認","isBg":true,"stepMatchArguments":[]},{"pwStepLine":30,"gherkinStepLine":29,"keywordType":"Context","textWithKeyword":"Given 需求已確認SD並產生測試骨架且已啟動測試情境Agent的MCP會話","stepMatchArguments":[]},{"pwStepLine":31,"gherkinStepLine":30,"keywordType":"Action","textWithKeyword":"When CLI Agent透過MCP工具提交刪除既有workbenchTestId或型別錯誤的測試補齊提案","stepMatchArguments":[]},{"pwStepLine":32,"gherkinStepLine":31,"keywordType":"Outcome","textWithKeyword":"Then MCP工具即時回傳映射或編譯檢核診斷供同一CLI會話修正且不覆蓋有效測試版本","stepMatchArguments":[]},{"pwStepLine":33,"gherkinStepLine":32,"keywordType":"Action","textWithKeyword":"When CLI Agent透過MCP工具提交保留完整測試ID映射且通過檢核的測試補齊提案","stepMatchArguments":[]},{"pwStepLine":34,"gherkinStepLine":33,"keywordType":"Outcome","textWithKeyword":"Then 工作台保存COMPLETED測試版本並完成本次測試補齊CLI提案流程","stepMatchArguments":[]}]},
]; // bdd-data-end