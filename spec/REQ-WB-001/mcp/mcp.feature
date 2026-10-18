# language: en
Feature: 工作台內建MCP服務供CLI Agent查詢資料與提交提案
  工作台為互動式CLI Agent提供內建MCP工具與Prompt介面，支援取得階段指派Agent對應的資料庫Prompt與Skill指引、查詢需求階段文件、結構化Gherkin、工作區檔案與測試資料庫Schema，並即時檢核及提交各階段提案。

  Background:
    Given 需求已關聯綁定本機目錄與SQLite測試資料庫的工作區且已完成Gherkin確認

  @AC-WB-MCP-001
  Scenario: CLI Agent透過內建MCP工具查詢對應Prompt、需求文件、結構化Gherkin、工作區檔案與資料庫Schema
    When 使用者啟動已指派的階段Agent並連線工作台內建MCP服務
    Then CLI Agent可透過MCP取得目前階段指派Agent對應的資料庫Prompt與Skill指引
    And CLI Agent可透過MCP工具讀取目前需求階段狀態與已確認Gherkin及現有SD文件
    And CLI Agent可透過MCP工具查詢結構化Gherkin情境、步驟與Examples案例對應
    And CLI Agent可透過MCP工具列出並讀取關聯工作區內的專案檔案且拒絕越界路徑
    And CLI Agent可透過MCP工具查詢關聯專案SQLite測試資料庫的實際Schema

  @AC-WB-MCP-002
  Scenario: CLI Agent透過MCP工具提交系統設計提案或待補問題並即時檢核格式
    Given 需求目前處於系統設計階段且已啟動系統設計Agent的MCP會話
    When CLI Agent透過MCP工具提交缺少必要章節的無效SD提案
    Then MCP工具即時回傳SD格式檢核錯誤供同一CLI會話修正且不保存無效版本
    When CLI Agent透過MCP工具提交資訊不足的待補問題清單
    Then 工作台記錄待補問題供人類檢視且維持系統設計階段未確認
    When CLI Agent透過MCP工具提交符合統一格式的完整SD提案
    Then 工作台保存新的SD版本並完成本次系統設計CLI提案流程

  @AC-WB-MCP-003
  Scenario: CLI Agent透過MCP工具提交測試步驟補齊提案並即時檢核映射與型別
    Given 需求已確認SD並產生測試骨架且已啟動測試情境Agent的MCP會話
    When CLI Agent透過MCP工具提交刪除既有workbenchTestId或型別錯誤的測試補齊提案
    Then MCP工具即時回傳映射或編譯檢核診斷供同一CLI會話修正且不覆蓋有效測試版本
    When CLI Agent透過MCP工具提交保留完整測試ID映射且通過檢核的測試補齊提案
    Then 工作台保存COMPLETED測試版本並完成本次測試補齊CLI提案流程
