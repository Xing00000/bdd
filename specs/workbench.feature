# language: en
# 工作台產品的驗收草案；尚未核准、尚未binding、尚未執行。
# 31個Scenario ID；兩個Outline各3列，合計35個展開案例。
# Gherkin目前pending；人類確認後才產生SD，兩者確認後才開發。
Feature: 多人協作且具版本核准與證據鏈的Node.js開發工作台
  人類以集中文件協作並核准Gherkin與SD
  專案CI測試跟target Git而使用者自建整合測試跟工作台SQLite
  agent在隔離環境開發並提供即時瀏覽器與可追溯報告

  Background:
    Given 有隔離的測試組織與專案及固定測試資料
    And 系統已載入受控的權限與資源政策

  @AC-WB-001
  Scenario: 依序完成Gherkin與SD人工核准才產生測試
    Given change尚未具有有效G1及G2核准
    When developer要求產生測試
    Then 回應GATE_NOT_APPROVED且沒有執行開發或驗證job
    When 有權人類核准精確Gherkin版本及依賴它的SD版本
    Then 可以產生spec骨架但在G3核准前不能進入正式開發驗證流程

  @AC-WB-002
  Scenario: 審查期間文件改版不能把舊批准套給新版
    Given reviewer正在審查revision1且內容hash為H1
    And 另一人已保存revision2且內容hash為H2
    When reviewer用revision1及H1批准current head
    Then 回應412 REVISION_STALE且revision2沒有新核准
    And 稽核紀錄保留請求與被拒原因

  @AC-WB-003
  Scenario Outline: 修改核准依賴使下游失效
    Given G1與G2與G3及舊run均關聯有效的精確hash
    When 新增一個修改了<subject>的revision
    Then <invalidated>失效且新run在重審前被阻擋
    And 舊run保留證據但標記STALE
    Examples:
      | case_id | subject          | invalidated |
      | feature | Gherkin Examples | G1 G2 G3 G4 |
      | design  | SD的DDL與rollback | G2 G3 G4    |
      | oracle  | 測試oracle及config | G3 G4       |

  @AC-WB-004
  Scenario: 決定性compiler完整展開Outline與Background
    Given 核准feature含2列Examples與Background且工具版本已固定
    When 以相同輸入產生兩次spec與manifest
    Then 兩次輸出位元組及hash相同
    And 每列有穩定Scenario與case_id及所有Background與Then映射

  @AC-WB-005
  Scenario: 缺binding不能產生空測試或跳過
    Given 核准feature有一個未實作step
    When compiler產生測試骨架
    Then 該step保留source reference及UNIMPLEMENTED_BINDING失敗placeholder
    And 不會透過skip或空函式被認定補齊或通過

  @AC-WB-006
  Scenario: LLM不能修改核准條件或核准自己
    Given LLM收到核准Gherkin及受限補齊slots
    When LLM提案修改Then或刪案例或修改gate policy
    Then 提案被拒且原文件及核准hash保持可查
    And agent不能透過approval API自行批准提案

  @AC-WB-007
  Scenario Outline: 縮小實際執行分母不能通過
    Given mandatory inventory要求所有核准案例
    When 候選測試透過<mechanism>少執行一個案例
    Then 工作台verdict不為PASSED
    And 報告列出缺少的穩定test ID並保留原mandatory分母
    Examples:
      | case_id | mechanism |
      | delete  | 刪除test   |
      | skip    | test.skip |
      | filter  | grep選集  |

  @AC-WB-008
  Scenario: LLM補齊受審核的具體oracle
    Given Then已核准可觀察結果但尚未綁locator
    When LLM輸出locator及oracle IR提案
    Then 每個Then都有SUT觀察值與expected及source mapping供人類審查
    And 缺expected資訊時標NEEDS_CLARIFICATION而不是自行發明條件
    And 只有精確test bundle獲得G3才可用作驗收測試

  @AC-WB-009
  Scenario: 實際連線SQLite並預設唯讀瀏覽
    Given workspace allowlist內有固定SQLite fixture且不含metadata資料
    When db_reader註冊該檔並取得schema與分頁資料
    Then API回傳實際table欄位及fixture的資料列
    And 連線以readOnly開啟且authorizer拒絕UPDATE與ATTACH及危險PRAGMA
    And 越出allowlist或連到metadata檔或symlink替換被拒絕

  @AC-WB-010
  Scenario: 核准後才對精確開發SQLite執行DDL或DML
    Given 已在clone演練的SQL plan綁target identity及baseline與備份
    When 尚無獨立DB_WRITE批准就要求apply
    Then 不會執行任何SQL寫入
    When 有權人類批准精確plan且executor取得maintenance lease及BEGIN IMMEDIATE
    Then 執行受批准SQL並回傳實際schema或影響筆數及前後證據
    And SQL參數或目標或baseline變動使批准失效
    And production寫入在MVP一律拒絕

  @AC-WB-011
  Scenario: SQLite昂貴查詢與單writer競爭有上限
    Given DatabaseSync工作在獨立process且query deadline為2秒
    When 查詢超過deadline或資料超過200rows或2MiB
    Then supervisor取消查詢或限制回應且API與browser event loop仍可服務
    And busy timeout僅處理等鎖且不被當作query deadline
    And 第二個writer必須排隊或明確回DB_BUSY而不無限等待

  @AC-WB-012
  Scenario: PTY只在授權沙箱內啟動
    Given 未持有效workspace execution grant的caller
    When caller要求開啟terminal或重播過期ticket
    Then 連線被拒且宿主沒有啟動shell
    When 授權developer在獨立workspace開啟terminal
    Then shell不能取得宿主憑證或browser控制端點或metadata volume

  @AC-WB-013
  Scenario: 即時與下載通道檢查專案權限
    Given caller只可存取專案A
    When caller使用專案B的session或run或artifact ID
    Then REST與SSE與WS與下載均拒絕且不洩漏內容
    And WS錯誤Origin或錯scope或舊generation也會被拒絕

  @AC-WB-014
  Scenario: 人類觀看的是agent使用的同一context
    Given agent session已登入測試App且開啟一個popup
    When 人類取得唯讀觀看票證並切換tab清單
    Then 畫格及UI標示相同browser instance與context identity及generation
    And 能看到agent操作結果但不能用觀看票證送輸入

  @AC-WB-015
  Scenario: 交接後舊epoch指令不能影響同一session
    Given agent持有epoch7且人類要求接管
    When owner關閉queue並完成inflight及drain ACK後授予人類epoch8
    Then 舊epoch7的延遲指令在執行前被拒絕
    And 人類與agent不會同時擁有可執行輸入權
    And 交還也必須flush輸入並確認相同context identity

  @AC-WB-016
  Scenario: 目前action結果不明時交接fail-closed
    Given 目前Playwright action無法在deadline內確認完成
    When 人類要求接手或lease過期
    Then session進FROZEN且沒有把控制權立即交給另一owner
    And requestPause回應不被當成目前action已取消的證明

  @AC-WB-017
  Scenario: 網頁錄製器輸出可審查的語意TypeScript草稿
    Given 人類持有同session lease並開始自有semantic recording
    When 操作導航與跨frame欄位及popup並選locator與assertion
    Then IR保存page alias與frame chain及document generation並合併同欄連續輸入
    And 敏感輸入只保存secretRef且未支援動作明示unsupported
    And 固定emitter輸出帶Scenario與Then映射的TypeScript草稿等待G3
    And 不依賴Playwright私有recorder API或自動修改已核准Gherkin

  @AC-WB-018
  Scenario: 桌面codegen不被冒充為網頁錄製SDK
    When 使用者查看錄製能力說明
    Then 明確區分官方codegen與Inspector桌面流程及本產品自有網頁recorder
    And 新codegen session或storageState複本不被宣稱原agent的同一完整session
    And pickLocator與Screencast不被宣稱自帶腳本錄製

  @AC-WB-019
  Scenario: 串流背壓與座標及延遲可量測
    Given 1280x720動態頁與固定2vCPU及20Mbps網路和50ms RTT的量測profile
    When 收集暖機後60秒的至少3次input-to-visible與畫格指標
    Then 報告實際fps及p95延遲與CPU及頻寬且不僅報input ACK
    And 以目標有效fps至少10與input-to-visible p95不超過300ms判定待優化項
    And 慢觀眾queue不超過2frames且丟舊保新
    And letterbox與DPR映射正確且導航後stale input被拒絕

  @AC-WB-020
  Scenario: 人類接管過的run不能作乾淨驗收
    Given 驗證run已啟動且只讀viewer不會污染結果
    When 人類輸入或改fixture或轉入互動debug
    Then run被標TAINTED或STALE且即使斷言全過也不能PASSED
    And 必須用相同核准bundle及新context與乾淨fixture重新驗證

  @AC-WB-021
  Scenario: retry成功仍保留flaky
    Given 第一個attempt失敗而診斷retry成功
    When 產生報告
    Then 報告保留兩次attempt並標FLAKY而不是PASSED
    And 原始失敗證據及mandatory案例分母仍可查

  @AC-WB-022
  Scenario: 缺證據或未完整執行不能假綠燈
    Given runner遇到缺trace或crash或OOM或取消或零mandatory cases
    When reporter缺少完整結束訊號或必要artifact未封存
    Then 工作台結果為相應INCOMPLETE或FAILED或CANCELLED或BLOCKED
    And 不因exit0或任意HTML成功文字顯示綠燈
    And 完整報告能逐Scenario與Then追溯到核准hash及run與artifact digest

  @AC-WB-023
  Scenario: 到期與關閉回收資源並撤銷能力
    Given workspace或session或PTY已到期限或被有權人關閉
    When reconciler完成撤銷及drain與程序終止
    Then 舊tickets及epoch與generation不能復用
    And profile與秘密及tmp清除且DB connections安全關閉
    And 未完成錄製或trace明示incomplete而非悄悄遺失

  @AC-WB-024
  Scenario: SQLite migration有備份回復與未知結果處理
    Given SD附精確DDL與DML及影響數及備份與rollback風險
    When executor執行已核准的隔離fixture migration
    Then 一般受支援DDL與DML在交易內處理而VACUUM等特殊操作被拒絕
    And 備份使用一致online backup而不是只複製active主檔
    And restore在停止所有connections後驗證且更新target generation
    And COMMIT結果未知時標OUTCOME_UNKNOWN並核對ledger而不自動重跑

  @AC-WB-025
  Scenario: 多人同時編輯不覆蓋另一人的文件
    Given 成員甲與乙都以文件revision1為base編輯
    When 甲先保存revision2而乙仍用revision1及If-Match保存
    Then 乙收到412且自己的draft保留
    And 顯示三向diff供人類合併為新revision而不是last-write-wins

  @AC-WB-026
  Scenario: 文件評論與審核集中且綁精確版本
    Given reviewer對集中SD revision1的指定段落建立comment thread
    When SD改版導致該段落語意變動
    Then 舊評論保留且anchor標outdated並可查作者與audit
    And 評論LGTM不等於正式批准且revision2須對應新hash審核

  @AC-WB-027
  Scenario: 專案成員與角色撤銷立即影響協作存取
    Given 組織成員只在專案A有editor與reviewer權限
    When 管理人撤銷其專案角色
    Then 新編輯與評論與審核與run與下載被拒且既有即時通道撤銷
    And 歷史版本與原批准actor保留不被刪除或改名冒用

  @AC-WB-028
  Scenario: 被開發專案CI測試跟隨該repo的精確commit
    Given G3測試bundle已匯入target repo專用branch並commit為C1
    When target repo CI在受信任workflow執行對應tested commit
    Then spec與binding來自該repo且結果綁repo ID與branch與head及tested commit
    And 中央文件以immutable批准manifest引用而不是Git可編輯第二主版本
    And branch改到C2後C1結果標stale而不轉用到C2

  @AC-WB-029
  Scenario: 使用者自建整合測試以SQLite定義為權威
    Given owner在工作台SQLite保存private整合測試revision1與目標環境
    When owner明確分享run權給同專案成員並要求執行精確revision1
    Then runner只取得immutable snapshot且結果記owner與ACL版本與definition hash
    And 該定義不自動寫入target Git且修改建立revision2不覆寫舊run
    And 沒有view或run權的成員不能取得定義或執行或下載證據

  @AC-WB-030
  Scenario: 三種測試來源不混淆權威或驗收分母
    Given target Git CI與user DB整合測試及workbench自身測試各有結果
    When 工作台聚合報告及人工G4驗收
    Then 分別列project_git與user_db與workbench_git及其commit或DB revision
    And 不用一類通過掩蓋另一類未跑或缺證據
    And private DB測試內容不因共享project報告洩漏

  @AC-WB-031
  Scenario: 工作台自身以Git保存規格與人工核准再進入下一階段
    Given 本工作台尚未建成且本專案規格的權威來源為Xing00000/bdd Git
    When Gherkin提交到專用審查分支但尚未收到使用者確認
    Then 核准狀態保持pending且不能代替使用者核准
    And 不產生新的SD或開始功能實作
    When 使用者明確確認精確Gherkin版本與hash
    Then 可產生與該版本綁定的SD並在Git等待使用者確認
    And 只有Gherkin及SD都確認後才開始實作與對應測試
    And 自身規格與文件與核准證據及測試全部跟Git而不依賴尚未建成的工作台DB
