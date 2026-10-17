# language: en
# 待使用者確認；目前只允許Gherkin與簡短階段說明，不含step、spec.ts、SD或產品實作。
# 核心範圍：28個Scenario ID、44個展開案例。Gherkin確認後才SD，SD確認後才產生測試並開發。
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
  Scenario: 使用者親自操作內嵌瀏覽器並開始與停止錄製
    Given 使用者已在工作台開啟可親自操作的內嵌瀏覽器
    When 使用者按下開始錄製
    And 使用者親自導覽網頁與點擊及輸入並選擇定位器與預期結果
    And 使用者按下停止錄製
    Then 產生包含該次操作與斷言的可檢查Playwright TypeScript腳本草稿
    And 停止後的新操作不再加入該次錄製
    And 該草稿屬於使用者自錄腳本而不是自動新增的標準CI測試
    And 不會自動更改Gherkin驗收條件

  @AC-WB-011
  Scenario: 被開發專案的CI測試跟著該專案Git
    Given 測試被指定為被開發專案的CI測試
    When 保存測試並在該專案CI執行
    Then 測試檔案跟著該專案Git的branch與commit
    And CI結果可對應該專案的實際commit
    And 工作台可在SQLite保存及讀回該commit對應的spec.ts內容副本
    And 該資料庫副本不取代target Git的標準CI測試版本或改變CI測試清單

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
    And Playwright截圖可對應Scenario與step及該步驟實際結果

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

  # 以下DB情境只操作被測專案的測試資料庫，不表示操作正式資料庫。
  @AC-WB-017
  Scenario: spec透過Playwright操作網頁版DB並斷言測試資料
    Given 被測專案的測試資料庫有帳號"scenario_user"且角色為"A"與狀態為"active"
    When spec使用Playwright開啟工作台網頁版DB介面並查詢"scenario_user"
    Then spec斷言實際查詢資料的角色為"A"且狀態為"active"
    And 每個Playwright操作與斷言步驟保存截圖並對應Scenario與step
    And 只有實際資料斷言符合預期才算該步驟通過

  @AC-WB-018
  Scenario: 修改被測帳號角色後重新登入驗證允許與拒絕的操作
    Given 被測專案的測試帳號"scenario_user"在測試資料庫角色為"A"且已登入被測網站
    And 被測網站角色"A"僅可閱讀測試文件而角色"B"可編輯測試文件但不可管理帳號
    When spec使用Playwright透過工作台網頁版DB將"scenario_user"角色由"A"改為"B"並保存
    And spec重新查詢測試資料並斷言角色已實際變成"B"
    And spec登出被測網站的舊登入狀態並以"scenario_user"重新登入
    And spec在被測網站將"scenario_document"內容改為"edited"並開啟管理帳號頁面
    Then spec斷言新登入頁面可看到角色"B"的編輯入口且文件保存成功
    And spec透過網頁版DB斷言"scenario_document"的實際內容為"edited"
    And spec斷言管理帳號頁面顯示拒絕且帳號資料沒有因此變更
    And spec在前置資料確認與DB變更後及重新登入後保存截圖
    And spec在每個主要操作與斷言步驟保存截圖並關聯實際結果

  @AC-WB-019
  Scenario: 人類測試流程的斷言失敗時留下截圖與失敗證據
    Given spec正在執行被測專案測試資料庫變更與重新登入的端到端情境
    When spec在網頁畫面或DB資料斷言得到與預期不同的實際結果
    Then Playwright保存失敗當下頁面的截圖
    And 報告列出該Scenario與失敗step及預期值與實際值及截圖
    And 該案例標示失敗而不因截圖保存成功改成通過

  @AC-WB-020
  Scenario: 重跑前重建明確的測試資料與登入初始狀態
    Given 上一次執行已將測試帳號"scenario_user"改為角色"B"且測試文件內容已變更
    When spec開始下一次執行並透過網頁版DB將該測試帳號角色設為"A"與"scenario_document"內容設為"initial"
    And spec結束被測網站上一輪的登入狀態
    Then spec斷言測試資料庫中的角色為"A"且"scenario_document"內容為"initial"
    And Playwright保存本次前置資料初始狀態的截圖
    And 本次情境從該初始狀態重新執行DB變更與登入及操作驗證流程

  @AC-WB-021
  Scenario Outline: 在SQLite保存並重新讀取當次需求的Gherkin與spec.ts及SD
    Given 共用專案的當次需求已有"<artifact>"內容及需求編號與情境編號對應
    When 使用者在"<phase>"階段將該產物保存到工作台SQLite
    And 使用者關閉並重新開啟該需求後讀取該產物
    Then 工作台從SQLite讀回與保存時相同的完整內容
    And 該產物仍連結相同的需求編號與對應情境編號
    And 這項產品儲存能力不改變bdd專案自身以Git保存開發文件與測試的方式
    Examples:
      | case_id | artifact | phase                      |
      | gherkin | Gherkin  | Gherkin確認                 |
      | tests   | spec.ts  | test generation/completion |
      | sd      | SD       | SD確認                      |

  @AC-WB-022
  Scenario: 另存並重播使用者自錄腳本而不混入標準CI測試
    Given 使用者已停止一次內嵌瀏覽器錄製並取得腳本草稿
    When 使用者將腳本另存到工作台SQLite的使用者錄製腳本清單
    And 使用者重新開啟該已保存腳本並按下重播
    Then 工作台在瀏覽器實際重播已保存的操作與斷言
    And 顯示該次重播的實際結果而不是把保存成功當成測試通過
    And 該腳本保留已提供的需求與相關情境對應並與標準專案CI測試分開列示
    And 不會自動新增或修改target Git的CI測試檔案或CI測試清單

  @AC-WB-023
  Scenario Outline: 入庫前以對應語法解析器拒絕無效內容並保留有效版本
    Given 工作台SQLite已有"<artifact>"的有效原文與結構化資料
    And 使用者準備保存的同一檔案內容含語法錯誤
    When 使用者要求將該"<artifact>"內容保存到SQLite
    Then 工作台先以"<parser>"解析內容並拒絕將錯誤內容保存為有效版本
    And 回報錯誤的檔案名稱與行號及欄號與原因
    And 原有有效版本的原文與結構化資料及來源對應保持不變
    Examples:
      | case_id | artifact | parser              |
      | gherkin | Gherkin  | Gherkin語法解析器    |
      | tests   | spec.ts  | TypeScript語法解析器 |

  @AC-WB-024
  Scenario: 保存有效Gherkin原文及可查詢的結構化情境與步驟
    Given 語法有效的Gherkin原文對應需求"REQ-DEMO-001"
    And 原文含Scenario Outline的Scenario ID"AC-DEMO-001"及有順序的steps與兩列Examples
    When 使用者將該Gherkin保存到SQLite
    Then 讀回的完整原文與提交內容逐字相同
    And 可結構化查詢需求編號與Scenario ID及各step的關鍵字與文字及順序
    And 可結構化查詢Examples的欄名與各列值及case_id且保留列順序
    And 原文與結構化資料均連結同一來源文件版本與內容hash

  @AC-WB-025
  Scenario: 保存標準生成spec.ts原文及明確的測試與來源情境對應
    Given 指定來源版本的已確認Gherkin含情境"AC-DEMO-001"及Examples案例"a"與"b"
    And 標準生成的spec.ts語法有效且測試"test-a"與"test-b"分別明確對應該情境的案例"a"與"b"
    And 另一測試"test-a-extra"以不同test ID明確對應同一情境的案例"a"
    When 使用者將該spec.ts與明確ID對應保存到SQLite
    Then 讀回的完整spec.ts原文與提交內容逐字相同
    And 可結構化查詢每個test ID及其需求編號與Scenario ID及Examples case_id
    And 每筆對應可追溯spec.ts版本與內容hash及來源Gherkin版本與內容hash
    And 相同Scenario ID下的不同Examples案例可各自對應不同測試
    And 測試"test-a"與"test-a-extra"的映射均被保存且同時對應相同Scenario ID與Examples案例"a"
    And 重新讀取時仍取得原本的來源版本而不是自動改指向最新Gherkin

  @AC-WB-026
  Scenario Outline: 標準生成測試的明確ID映射不完整或無效時不能入庫為有效版本
    Given 工作台SQLite已有一份有效的標準生成spec.ts及其情境對應
    And 待保存的新spec.ts通過TypeScript語法解析但其明確ID映射存在"<problem>"
    When 使用者要求保存該標準生成測試與映射
    Then 工作台依指定來源版本的Gherkin與明確test ID映射拒絕該次保存
    And 回報"<problem>"及相關test ID或來源案例ID
    And 未提供的情境對應不被自動推測或補造
    And 原有有效spec.ts原文與結構化映射保持不變
    Examples:
      | case_id          | problem                                      |
      | unmapped_test    | 有測試未提供明確的情境與案例對應               |
      | missing_case     | 來源Gherkin有應生成的案例未對應任何測試         |
      | duplicate_test   | 不同測試定義使用相同test ID                    |
      | duplicate_case   | 完全相同test ID與來源案例的映射資料重複         |
      | unknown_scenario | 引用指定來源版本中不存在的Scenario ID          |
      | unknown_example  | 引用指定來源情境中不存在的Examples case_id      |

  @AC-WB-027
  Scenario: 未關聯需求情境的使用者自錄腳本仍可獨立保存及重播
    Given 使用者已取得語法有效且未連結需求編號或Scenario ID的自錄Playwright腳本
    When 使用者將該腳本另存到SQLite的使用者錄製腳本清單
    Then 工作台保存完整原文且需求與情境對應維持未關聯
    And 不要求補造需求或Scenario ID以通過標準生成測試的映射檢核
    And 使用者可重新開啟該腳本並重播
    And 該腳本仍獨立於標準專案CI且不會自動新增或修改target Git的CI測試

  @AC-WB-028
  Scenario: 點選Gherkin案例執行並在右側觀看同次測試過程與結果
    Given 專案已有Gherkin情境"AC-DEMO-001"及Examples案例"a"與"b"的spec.ts骨架與明確測試映射
    And 案例"a"對應測試"test-a"與"test-a-extra"且案例"b"對應測試"test-b"
    And 這些測試目前只有尚未由LLM補齊的codegen殼
    When 使用者開啟工作台的Gherkin測試清單
    Then 清單列出該情境與案例"a"及"b"及各自對應的test ID
    And 只有codegen殼的測試顯示待補齊且不可標示已通過
    When 使用者在測試已由LLM補齊且測試基線與程式版本已固定後點選案例"a"並按下執行
    Then 工作台建立本次run且runner只執行對應的spec.ts測試"test-a"與"test-a-extra"
    And 未選取的"test-b"本次不執行也不標示通過
    And 右側內嵌瀏覽器即時呈現本次run目前測試所用的同一session與page的真實操作
    And 各測試的實際斷言與每步截圖及成功或失敗結果均對應本次run與所選情境及案例
    And 只有所選案例的必要測試與斷言及證據完整通過才標示該案例通過
    And 所選案例通過不代表未執行的全專案案例已通過
