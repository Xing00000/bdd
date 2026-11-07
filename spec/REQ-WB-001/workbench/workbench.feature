# language: en
# 需求為主要工作入口，專案綁定本機程式碼目錄。
# 核心範圍：34個Scenario ID、54個展開案例。Gherkin確認後才SD，SD確認後自動產生測試骨架。
Feature: 多人共用的BDD軟體開發工作台
  以需求為工作入口，需求可關聯多個綁定本機目錄的程式碼專案
  依Gherkin確認、SD確認、測試產生、開發、驗證的順序工作

  Background:
    Given 已選擇工作台的需求

  @AC-WB-001
  Scenario: 本工作台自身依Git中的確認流程開發
    Given 本專案的Gherkin已寫入Xing00000的bdd Git儲存庫
    When 使用者尚未確認這份Gherkin
    Then 本專案維持等待Gherkin確認且不產生SD或產品實作
    When 使用者確認Gherkin後再確認對應SD
    Then 本專案才依序進入測試產生補齊與產品實作階段
    And 本專案的規格與文件與確認紀錄與測試全部保存在Git

  @AC-WB-002
  Scenario: 多人處理同一需求與集中文件
    Given 兩位使用者開啟同一個需求
    When 一位使用者在需求保存Gherkin或SD文件
    Then 另一位使用者可在該需求讀取相同文件內容

  @AC-WB-003
  Scenario: 人類確認Gherkin後才產生SD
    Given 工作台顯示所選Gherkin處於確認階段且已有草稿
    When 人類確認Gherkin並選擇已指派的系統設計Agent產生SD
    Then 工作台流程狀態顯示SD確認且開啟SD編輯
    And 使用設定的互動CLI在網頁terminal提出SD草稿
    And 產生對應Gherkin的SD草稿供人類確認
    And SD包含程式架構以及本次資料庫DDL與DML內容
    And 人類尚未確認SD時不進入產品開發

  @AC-WB-004
  Scenario: SD確認後將Gherkin產生成Playwright測試骨架
    Given 人類已確認該Gherkin與SD
    When 人類確認SD
    Then 工作台進入測試情境階段並自動產生唯讀的spec.ts骨架
    And spec.ts預設收合且每個案例對應來源Scenario及Examples列
    And 人類不能直接編輯生成骨架

  @AC-WB-005
  Scenario: 使用已指派Agent補齊測試步驟
    Given 已產生對應確認文件的測試骨架
    When 使用者選擇已指派的測試Agent並透過互動CLI補齊測試步驟
    Then 補齊的測試仍對應人類已確認的驗收條件
    And CLI在獨立工作目錄讀取經SHA-256核對的官方Playwright-BDD Skill
    And 缺少預期結果資訊時列出待補內容而不自行改寫驗收條件

  @AC-WB-006
  Scenario: 依確認文件與測試進行開發
    Given Gherkin與SD已確認且測試規格已補齊
    When 人類確認已完成檢核的測試步驟
    Then 工作台流程狀態顯示implementation
    And 測試基線固定且自動進入程式開發階段
    And 可使用已確認文件及測試基線作為開發依據
    And 開發完成後可開始驗證該次開發成果

  @AC-WB-007
  Scenario: 透過DbGate實際操作專案SQLite資料庫
    Given 共用專案已設定DbGate網頁入口與SQLite測試資料庫連線
    When 使用者透過DbGate瀏覽schema與資料並執行本次SD內的DDL或DML
    Then DbGate顯示該測試資料庫的實際schema與資料及SQL執行結果
    And 重新讀取資料庫時可看到實際變更

  @AC-WB-008
  Scenario: 從固定工作區選單開啟真實PTY終端
    Given 至少一個工作區已綁定本機程式碼目錄
    When 使用者從左側Terminal選擇工作區
    Then 右側直接開啟該工作區的終端頁籤且內容只有終端
    When 使用者輸入命令並啟動專案程式
    Then 同一PTY顯示實際輸出且可繼續輸入
    When 使用者關閉終端頁籤
    Then 該PTY程序被中止

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
  Scenario: 使用全域瀏覽器錄製並保存重播
    Given 使用者從固定選單開啟瀏覽器錄製
    When 使用者輸入網址前往、錄製並操作網頁、停止後命名保存
    Then 已保存名稱出現在左側瀏覽器錄製下方
    And 開啟保存內容時上方顯示播放與刪除且下方顯示Playwright腳本
    When 使用者按播放
    Then 瀏覽器視窗展開並重播保存的動作
    And 全域錄製不要求關聯專案或需求且不自動成為CI測試

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
  Scenario: spec透過Playwright操作DbGate並斷言測試資料
    Given 被測專案的測試資料庫有帳號"scenario_user"且角色為"A"與狀態為"active"
    When spec使用Playwright開啟專案的DbGate網頁介面並查詢"scenario_user"
    Then spec斷言實際查詢資料的角色為"A"且狀態為"active"
    And 每個Playwright操作與斷言步驟保存截圖並對應Scenario與step
    And 只有實際資料斷言符合預期才算該步驟通過

  @AC-WB-018
  Scenario: 修改被測帳號角色後重新登入驗證允許與拒絕的操作
    Given 被測專案的測試帳號"scenario_user"在測試資料庫角色為"A"且已登入被測網站
    And 被測網站角色"A"僅可閱讀測試文件而角色"B"可編輯測試文件但不可管理帳號
    When spec使用Playwright透過專案的DbGate網頁介面將"scenario_user"角色由"A"改為"B"並保存
    And spec重新查詢測試資料並斷言角色已實際變成"B"
    And spec登出被測網站的舊登入狀態並以"scenario_user"重新登入
    And spec在被測網站將"scenario_document"內容改為"edited"並開啟管理帳號頁面
    Then spec斷言新登入頁面可看到角色"B"的編輯入口且文件保存成功
    And spec透過DbGate網頁介面斷言"scenario_document"的實際內容為"edited"
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
    When spec開始下一次執行並透過DbGate網頁介面將該測試帳號角色設為"A"與"scenario_document"內容設為"initial"
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

  @AC-WB-029
  Scenario: Playwright透過DbGate驗證資料並將DB畫面納入測試報告
    Given 專案已設定DbGate網頁入口且連接該專案的測試資料庫
    And 測試已明確指定查詢SQL與預期欄位值
    When spec使用Playwright在DbGate執行查詢並等待本次結果顯示
    Then spec從DbGate結果表格讀取實際欄位值並斷言符合預期
    And Playwright擷取本次DbGate查詢與結果表格的畫面
    And 測試報告保存查詢SQL與預期值及實際值並可開啟對應DbGate截圖
    And DbGate截圖與資料斷言對應同一次run與Gherkin情境及案例與step及被驗證程式版本
    And 查詢失敗或資料不符時報告保留失敗結果與錯誤及DbGate畫面
    And DbGate無法連線或結果未載入時明確顯示錯誤且不標示資料驗證通過
    And 截圖保存成功本身不代表資料斷言通過

  @AC-WB-030
  Scenario: 左側固定需求選單展開各份Gherkin並切換專屬流程
    Given 使用者開啟需求首頁且已有可選工作區
    When 使用者新增需求並在同一表單選擇一個以上工作區
    Then 新需求建立時即關聯所選工作區
    When 使用者在該需求新增第二份Gherkin
    Then 左側需求節點展開列出兩份Gherkin與各自狀態
    When 使用者在需求清單展開需求並編輯名稱
    Then Gherkin在原列下方樹狀展開且名稱旁直接出現輸入框與多選工作區下拉選單
    And 保存需求名稱時一併保存工作區關聯
    And 工作區管理位於需求首頁下方而非獨立頁面
    When 使用者從左側點選其中一份Gherkin並捲動右側工作區
    Then 左側需求選單維持固定且右側頁籤顯示所選Gherkin的滿版流程內容
    And 右側可開啟及切換多個頁籤
    And 重新載入後仍顯示相同需求及所選Gherkin

  @AC-WB-031
  Scenario: 同一需求關聯多個本機程式碼專案
    Given 兩個程式碼專案已各自綁定不同的本機目錄
    When 使用者在需求中關聯這兩個專案
    Then 工作台保留一份需求與其Gherkin及專屬SD和BDD而不按專案複製需求
    When 使用者在需求開發區切換目前操作專案並開啟terminal
    Then 每個terminal的實際工作目錄等於所選專案綁定的本機目錄
    And 工作區管理與需求清單位於同一首頁且需求不隸屬單一工作區

  @AC-WB-032
  Scenario: 首次啟動建立可編輯且持續保存的CLI、Skill與Agent設定
    Given 工作台資料庫尚未套用預設設定
    When 工作台首次啟動
    Then 資料庫建立Codex與Kiro CLI及從skills/playwright-bdd/SKILL.md載入的Playwright BDD Skill
    And 資料庫建立需求確認、系統設計、測試情境及程式開發Agent，並綁定Codex CLI與Playwright BDD Skill
    And 流程設定預設將四個Agent各自指派到對應可編輯階段，驗證報告維持唯讀
    When 使用者修改流程指派、編輯或刪除預設資料並重新啟動工作台
    Then 流程指派與編輯內容持續保存且已刪除的預設資料不會重新建立

  @AC-WB-035
  Scenario: 升級既有資料庫時補齊四階段Agent預設
    Given 工作台資料庫已有舊版LLM預設設定且缺少系統設計、測試情境及程式開發Agent
    And 使用者已自訂CLI、Skill、Agent或流程指派
    When 工作台啟動新版
    Then 資料庫補齊缺少的Playwright BDD Skill與流程Agent
    And 四個可編輯階段各指派一個對應Agent且驗證報告維持唯讀
    And 未修改的舊版Codex預設參數升級為目前預設
    And 使用者已自訂的設定值保持不變
    When 工作台再次啟動
    Then 升級不重複執行且已刪除的預設資料不會重新建立

  @AC-WB-033
  Scenario: 為可編輯階段多選Agent並限制其操作入口
    Given CLI、Skill及Agent已保存
    When 使用者為需求確認、系統設計、測試情境及程式開發各自指派多個Agent
    Then 設定持續保存且驗證報告維持唯讀
    When 使用者開啟其中一個目前可編輯的需求階段
    Then 該階段只顯示已指派Agent的操作按鈕
    And 啟動Agent會在網頁terminal開啟設定的互動CLI並帶入Prompt、Skill及階段文件
    And Agent未指派到該階段時伺服器拒絕啟動

  @AC-WB-034
  Scenario Outline: 重啟已完成階段並使該階段及下游狀態失效
    Given 該Gherkin已完成需求確認、系統設計、測試基線、程式基線及驗證
    When 使用者選擇已完成的"<stage>"並按右下角重啟階段
    Then 該階段成為目前階段且後續階段回到未完成狀態
    And 確認狀態與基線結果符合"<preserved>"及"<invalidated>"
    And 執行結果標為失效但歷史版本及報告仍保留
    Examples:
      | case_id | stage          | preserved                         | invalidated                 |
      | gherkin | GHERKIN        | 無確認                            | Gherkin及SD確認與全部基線   |
      | sd      | SD             | Gherkin確認                       | SD確認及全部基線            |
      | tests   | TESTS          | Gherkin及SD確認                   | 測試與程式基線              |
      | source  | IMPLEMENTATION | Gherkin及SD確認與測試基線         | 程式基線                    |
      | verify  | VERIFICATION   | Gherkin及SD確認與測試及程式基線   | 僅執行結果                  |

  @AC-WB-036
  Scenario: 從左側聊天室清單開啟中間對話頁籤
    Given 使用者已開啟需求工作台
    When 使用者從左側聊天室區建立聊天室
    Then 左側清單顯示該聊天室
    And 中間開啟該聊天室的對話頁籤與訊息輸入區
    When 使用者切換其他頁籤再點選該聊天室
    Then 回到相同對話且不重複建立頁籤
    And 關閉頁籤不刪除聊天室

  @AC-WB-037
  Scenario: Codex 管理上下文並經 Copilot 回覆且保存聊天紀錄
    Given Codex 與 GitHub Copilot CLI 已可用且具有推論權限
    And 使用者已開啟聊天室
    When 使用者送出文字訊息
    Then 使用者訊息先保存至 SQLite
    And Codex 使用該聊天室對應的 thread 管理上下文並經 adapter 呼叫 Copilot
    And 對話視窗顯示真實助手回覆並將內容與完成狀態保存至 SQLite
    When 使用者重新載入並開啟該聊天室
    Then 顯示先前保存的訊息
    And 後續訊息延續同一 Codex thread
    And Codex 壓縮上下文不刪除 SQLite 的原始訊息

  @AC-WB-038
  Scenario: 推論失敗時保留訊息並顯示可核對的錯誤
    Given 使用者已開啟要驗證失敗處理的聊天室
    When 訊息送出後 CLI 不可用、未授權或推論失敗
    Then SQLite 保留已送出的使用者訊息與失敗狀態
    And 對話視窗顯示錯誤且不建立假助手回覆
    And 同一聊天室有進行中的回覆時不接受重複送出

  @AC-WB-039
  Scenario: 聊天透過 Codex 呼叫真實工作站能力
    Given 隔離工作站已有唯一識別的規格庫且真實 Codex 與 Copilot 可用
    When 使用者要求查詢規格庫並產生指定內容的需求提案
    Then Codex 透過 MCP 查詢規格庫並呼叫工作站既有需求提案服務
    And 提案可從工作站 API 與 SQLite 核對且不自行確認需求階段
    When 工作站重啟後使用者追問提案
    Then 同一 Codex thread 能取得保存的提案並回答

  @AC-WB-040
  Scenario: 聊天文字即時串流且斷線後可恢復
    Given 使用者已開啟聊天室且真實 Codex 與 Copilot 可用
    When 使用者送出需要多段文字的訊息
    Then 回覆完成前 SSE 已傳送多筆真實文字增量
    And 推論期間前端不輪詢聊天室清單或完整對話
    And 完成文字與 SQLite 保存內容一致且不重複顯示
    When 使用者重新連線聊天室
    Then 快照恢復已保存訊息且不重複顯示
    And 推論失敗不建立假的完成回覆

  @AC-WB-041
  Scenario: 驗收意見交給 LLM 修改實作
    Given 使用者已在需求驗收頁開啟 Playwright 報告
    When 使用者輸入驗收意見並按下 LLM 修改實作
    Then 意見保存為實作區的一段新互動並交給既有 LLM 實作流程
    And 頁面回到實作區且保留既有互動與歷史報告
    And 需求仍未完成且新報告需要重新驗收

  @AC-WB-042
  Scenario: 使用者確認驗收後結束需求流程
    Given 當前版本的完整驗證已通過且報告有效
    Then 需求等待人工驗收且不因測試通過自動完成
    When 使用者按下驗收通過
    Then 保存使用者對本次報告與版本的確認並結束流程
    And 重新載入後仍顯示完成

  @AC-WB-043
  Scenario: 統一管理 Agent 與 Skills 並選擇生成組合
    Given 已開啟隔離的 Agent 與 Skill 工作台
    When 使用者新增 Agent 與含文字資源的 Skill 並設定任務預設
    And 重啟工作台並重新載入管理頁
    Then 原有設定與 Skill 資源保留於 SQLite
    When 使用者在 LLM 生成 Gherkin 選擇 Agent 與 Skills 並預覽
    And 確認後執行真實 CLI 生成
    Then 生成結果符合所選技能且作業保存不可變版本快照
    And 設定更新後拒絕舊預覽且不改變既有派工快照

  @AC-WB-044
  Scenario: Agent、Prompt 與 Skills 分別選擇及版本管理
    Given 已開啟隔離的 Agent 與 Skill 工作台
    When 使用者新增 Agent 與含文字資源的 Skill 並設定任務預設
    And 重啟工作台並重新載入管理頁
    When 使用者在 LLM 生成 Gherkin 選擇 Agent 與 Skills 並預覽
    Then 切換 Agent 後仍保留所選 Prompt 與 Skills
    When 確認後執行真實 CLI 生成
    Then 生成結果符合所選技能且作業保存不可變版本快照
    And 設定更新後拒絕舊預覽且不改變既有派工快照

  @AC-WB-045
  Scenario: 系統文件未決項目由使用者回答並保存為決策
    Given 已開啟可生成系統文件的隔離工作台
    When 使用者生成包含未決項目的系統文件
    Then 每個未決項目提供單選選項與其他自訂輸入
    And 尚未回答時無法確認系統設計
    When 使用者選擇其他或既有選項並儲存系統決策
    Then 重新載入後仍保留使用者的決策

  @AC-WB-046
  Scenario: 系統文件生成與儲存後預覽並在跨階段後重設
    Given 已開啟可生成系統文件的隔離工作台
    When 使用者生成包含未決項目的系統文件
    Then 每個未決項目提供單選選項與其他自訂輸入
    And 尚未回答時無法確認系統設計
    When 使用者選擇其他或既有選項並儲存系統決策
    And 使用者切換文件編輯預覽儲存並跨階段返回
    Then 文件回到預覽且保留已儲存內容並互斥顯示編輯與儲存

  @AC-WB-047
  Scenario: 從對話取得並選擇 Copilot 模型
    Given 對話已取得 Copilot CLI 回傳的模型清單
    When 使用者從對話模型選單選擇模型
    Then 模型選擇保存於 SQLite 且重新載入仍保留
    And 重新整理模型清單不更動目前選擇

  @AC-WB-048
  Scenario: Copilot ACP 純模型推論與 Codex 原生 MCP 工具執行隔離
    Given Codex SDK 與 Copilot ACP 已啟用且對話或派工已宣告原生 MCP 工具
    When 使用者送出需要呼叫多個 MCP 工具的任務或對話訊息
    Then Adapter 向 Copilot ACP 建立 session/new 時 mcpServers 恆為空陣列且禁用內建 MCP 與內建工具
    And Copilot ACP 僅回傳純模型推論與符合工具宣告名稱及參數 JSON Schema 白名單的結構化工具呼叫提案，不註冊、不連接、不執行任何 MCP Server
    And Prompt 正規化僅過濾衝突的內建工具樣板並完整保留禁止呼叫 Git、權限邊界與人類授權指令
    And Codex SDK 透過自己的原生 MCP 執行實際工具並將結果送回下一輪推論完成回覆

  @AC-WB-049
  Scenario: Codex SDK 與聊天室透過單一共用 Agent Supervisor 派工長駐互動式 CLI Agent 並支援人類明確佇列或中斷介入
    Given 工作站已在聊天室與派工皆啟用單一共用 agent_supervisor 原生 MCP Server 與受 Git 邊界及目錄權限保護的互動式 CLI Agent
    When Codex 呼叫 agent_start 啟動長駐 CLI Agent 工作階段並送出初始任務
    Then Supervisor 立即回傳持久 sessionId 並保留同一 CLI Agent 程序與 QUEUED、DELIVERED、PROCESSED 訊息狀態紀錄
    When CLI Agent 執行回合期間人類從工作站介入同一 sessionId 發送修正指令且指定 queue 或 interrupt 策略
    Then queue 模式不自動取消執行中回合但將人類訊息優先排在待執行佇列最前端，interrupt 模式才明確取消目前回合並優先於同一 CLI Agent Session 執行人類介入指令
    And Codex 透過 agent_events 讀取包含人類介入與 Agent 輸出的增量事件，並可透過 agent_list、agent_cancel 或 agent_stop 管理該工作階段

  @AC-WB-050
  Scenario: 在 Copilot ACP 與 Kiro CLI ACP 之間切換純模型推論來源並維持零 MCP 隔離
    Given 工作站同時支援 "copilot" 與 "kiro" 兩組 ACP 純模型推論來源
    When 使用者將推論來源切換為 "kiro" 並重新載入模型清單
    Then 工作站透過 kiro-cli acp 取得可選模型清單並將選擇保存於 SQLite chat_settings
    And Adapter 在隔離推論目錄同時寫入零工具 bdd_inference agent 設定與空的 .kiro/settings/mcp.json，且每個 session/new 皆強制 mcpServers 為空陣列並驗證 currentModeId 為 "bdd_inference"
    When 使用者在聊天室或 Codex SDK 派工執行需要呼叫原生 MCP 工具的任務
    Then Kiro CLI ACP 僅提供純模型推論與符合 JSON Schema 的工具呼叫提案，不載入或執行任何 MCP 工具，實際 MCP 工具仍由 Codex 原生執行
    And 使用者可隨時切換回 "copilot" ACP 推論來源且對話歷史與工作階段保持完整

  @AC-WB-051
  Scenario: 透過受控 CLI Agent Profile 白名單派工並在 Web UI 面板進行即時監看、佇列介入、中斷與結束
    Given Persistent Agent Supervisor 已註冊受控的 CLI Agent Profile 白名單（"copilot"、"kiro"、"codex"、"claude"）並強制套用 Git 攔截守衛與環境變數淨化
    When 主 Agent 從聊天室透過 agent_start 或人類從 Web UI 選擇指定 agentProfile 啟動長駐 CLI Agent 工作階段
    Then Supervisor 依白名單解析對應執行檔與協定（ACP 優先、PTY 相容）啟動程序，並拒絕任何未在白名單內的執行檔或越權參數
    And Web UI 的 CLI Agent 工作階段面板即時顯示該 sessionId、agentProfile、狀態（IDLE/BUSY/STOPPED/FAILED）與完整事件串流
    When 人類從 Web UI 面板對同一 sessionId 執行佇列送出（queue）、強制中斷插話（interrupt）、取消當前回合（cancel）或結束工作階段（stop）
    Then Supervisor 立即在同一個 CLI Agent Session 上套用對應控制並更新 SQLite 狀態與事件串流，主 Agent 亦可從聊天室透過 agent_events 同步讀取最新互動紀錄
