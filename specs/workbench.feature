# language: en
# 待使用者確認；目前只允許Gherkin與簡短階段說明，不含step、spec.ts、SD或產品實作。
# 核心範圍：16個Scenario ID、24個展開案例。Gherkin確認後才SD，SD確認後才產生測試並開發。
Feature: 多人共用的BDD軟體開發工作台
  人類共用專案與集中文件
  依Gherkin確認、SD確認、測試產生、開發、驗證的順序工作

  Background:
    Given 已選擇工作台的共用專案

  @AC-WB-001
  Scenario: 本工作台自身依Git中的確認流程開發
    Given 本專案的Gherkin已寫入Xing00000的bdd Git儲存庫
    When 使用者尚未確認這份Gherkin
    Then 本專案維持等待Gherkin確認且不產生SD或產品實作
    When 使用者確認Gherkin後再確認對應SD
    Then 本專案才依序進入測試產生補齊與產品實作階段
    And 本專案的規格與文件與確認紀錄與測試全部保存在Git

  @AC-WB-002
  Scenario: 多人使用共用專案與集中文件
    Given 兩位使用者開啟同一個共用專案
    When 一位使用者在專案保存Gherkin或SD文件
    Then 另一位使用者可在該專案讀取相同文件內容

  @AC-WB-003
  Scenario: 人類確認Gherkin後才產生SD
    Given 工作台顯示專案處於Gherkin確認階段且已有Gherkin草稿
    When 人類按下確認Gherkin並要求產生SD
    Then 工作台流程狀態顯示SD確認且開啟SD編輯
    And 產生對應Gherkin的SD草稿供人類確認
    And SD包含程式架構以及本次資料庫DDL與DML內容
    And 人類尚未確認SD時不進入產品開發

  @AC-WB-004
  Scenario: SD確認後將Gherkin產生成Playwright測試骨架
    Given 人類已確認專案Gherkin且工作台正顯示SD確認階段
    And 已備妥Gherkin生成器設定與明確的step definitions
    When 人類按下確認SD並要求產生測試
    Then 工作台流程狀態顯示test generation/completion
    And 產生可由Playwright找到的spec.ts檔案
    And 每個生成案例可對應來源Scenario及Examples列

  @AC-WB-005
  Scenario: LLM補齊測試規格
    Given 已產生對應確認文件的測試骨架
    When LLM補齊操作步驟與預期結果的測試內容
    Then 補齊的測試仍對應人類已確認的驗收條件
    And 缺少預期結果資訊時列出待補內容而不自行改寫驗收條件

  @AC-WB-006
  Scenario: 依確認文件與測試進行開發
    Given Gherkin與SD已確認且測試規格已補齊
    When 使用者在工作台按下開始開發
    Then 工作台流程狀態顯示implementation
    And 可使用確認文件與測試作為開發依據
    And 開發完成後可開始驗證該次開發成果

  @AC-WB-007
  Scenario: 實際操作專案SQLite資料庫
    Given 共用專案已有SQLite資料庫連線
    When 使用者瀏覽schema與資料並執行本次SD內的DDL或DML
    Then 工作台顯示實際schema與資料及SQL執行結果
    And 重新讀取資料庫時可看到實際變更

  @AC-WB-008
  Scenario: 使用PTY終端進行開發
    Given 專案工作區已開啟
    When 使用者在PTY終端輸入命令並啟動專案程式
    Then 終端顯示該命令或程式的實際輸出
    And 使用者可繼續透過同一終端輸入

  @AC-WB-009
  Scenario Outline: 即時觀看Playwright使用中的瀏覽器
    Given 專案已有Playwright瀏覽器會話
    When "<controller>"使用Playwright操作該會話的網頁
    Then 工作台內嵌畫面顯示該會話當前的網頁操作結果
    And 顯示的是操作中的會話而不是事後trace報告
    Examples:
      | case_id | controller |
      | agent   | agent      |
      | program | 程式       |

  @AC-WB-010
  Scenario: 使用者從網頁錄製Playwright腳本
    Given 使用者在工作台開啟瀏覽器錄製
    When 使用者操作網頁並選擇定位器與預期結果
    Then 產生可檢查的Playwright TypeScript腳本草稿
    And 錄製草稿可用於補齊測試而不自動更改Gherkin驗收條件

  @AC-WB-011
  Scenario: 被開發專案的CI測試跟著該專案Git
    Given 測試被指定為被開發專案的CI測試
    When 保存測試並在該專案CI執行
    Then 測試檔案跟著該專案Git的branch與commit
    And CI結果可對應該專案的實際commit

  @AC-WB-012
  Scenario: 使用者自建整合測試保存在工作台資料庫
    Given 使用者建立自己的整合測試
    When 在工作台保存測試定義與目標環境並要求執行
    Then 測試定義與執行紀錄保存在工作台SQLite
    And 該測試不會自動寫入被開發專案Git

  @AC-WB-013
  Scenario: 驗證開發成果並產生E2E報告
    Given 專案開發完成且驗證測試已備妥
    When 使用者在工作台提交驗證並執行對應E2E測試
    Then 工作台流程狀態顯示verification/report
    And 報告列出各驗收案例的實際執行結果
    And 報告可對應Gherkin案例與被驗證的程式版本
    And 未通過或未執行的案例不被報成通過

  @AC-WB-014
  Scenario: 缺少測試步驟實作不能當成通過
    Given Gherkin含有尚未定義或尚未實作的測試步驟
    When 產生或執行對應測試
    Then 生成器阻擋缺少定義的步驟或測試明確回報未實作
    And 不以空函式或刪除驗收案例換取通過

  @AC-WB-015
  Scenario Outline: 每個階段只可修改該階段的產物
    Given 工作台顯示專案目前在"<phase>"階段且已有保存內容
    When 使用者在工作台嘗試保存禁止變更的"<blocked>"
    Then 工作台顯示此階段不可修改該產物
    And 該產物仍為上次保存內容
    And 工作台只對"<allowed>"提供本階段的編輯或執行入口
    And "<locked>"維持鎖定
    Examples:
      | case_id       | phase                      | blocked       | allowed                      | locked                         |
      | gherkin       | Gherkin確認                 | spec.ts       | Gherkin             | SD與測試與產品程式             |
      | sd            | SD確認                      | Gherkin       | SD文件                       | 已確認Gherkin與測試與產品程式   |
      | tests         | test generation/completion | Gherkin或SD   | spec.ts與step及測試所需檔案    | 已確認Gherkin與SD              |
      | implementation | implementation           | 測試基線      | 產品程式                     | 已確認Gherkin與SD及測試基線     |
      | verification  | verification/report       | 程式或測試    | 執行既定測試與產生結果報告    | Gherkin與SD與測試基線及產品程式 |

  @AC-WB-016
  Scenario Outline: 修改上游產物必須退回對應階段並使下游結果失效
    Given 專案已有測試基線與驗證結果
    When 使用者在工作台選擇退回修改並指定"<artifact>"
    Then 工作台流程狀態顯示"<return_phase>"才開啟該產物編輯
    And 工作台將依賴該產物的下游產物與驗證結果標示失效
    And Gherkin或SD修改後未重新確認時不能再次前進
    And 完成該階段要求後依序重新產生或驗證下游結果
    And 不會在同一階段同時修改Gherkin與spec.ts
    Examples:
      | case_id | artifact | return_phase               |
      | gherkin | Gherkin  | Gherkin確認                 |
      | sd      | SD       | SD確認                      |
      | tests   | 測試基線 | test generation/completion |
      | source  | 產品程式 | implementation             |
