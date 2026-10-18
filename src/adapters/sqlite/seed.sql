-- APPLICATION_SEED:CLI:BEGIN
INSERT OR IGNORE INTO llm_cli_commands(id,name,executable,args_json)
VALUES(lower(hex(randomblob(16))),'Codex CLI','codex',__INITIAL_DEFAULT_CODEX_ARGS_JSON__);

INSERT OR IGNORE INTO llm_cli_commands(id,name,executable,args_json)
VALUES(lower(hex(randomblob(16))),'Kiro CLI','kiro-cli','["chat"]');
-- APPLICATION_SEED:CLI:END

-- APPLICATION_SEED:SKILL:BEGIN
-- PLAYWRIGHT_BDD_SKILL_SEED
-- APPLICATION_SEED:SKILL:END

-- APPLICATION_SEED:AGENTS:BEGIN
INSERT OR IGNORE INTO llm_agents(id,name,cli_command_id,skill_id,prompt)
SELECT lower(hex(randomblob(16))),'需求確認 Agent',command.id,skill.id,
'請檢視目前需求與 Gherkin，找出可觀察性、驗收條件與缺少的前提；先提出疑問與修改建議，保留原意，不要自行修改工作區檔案。'
FROM llm_cli_commands command CROSS JOIN llm_skills skill
WHERE command.name='Codex CLI' AND skill.name='Playwright BDD';

INSERT OR IGNORE INTO llm_agents(id,name,cli_command_id,skill_id,prompt)
SELECT lower(hex(randomblob(16))),'系統設計 Agent',command.id,skill.id,
'依已確認的 Gherkin 編寫系統設計，說明架構、檔案目錄、資料庫 DDL/DML 與流程；資訊不足時列出問題。'
FROM llm_cli_commands command CROSS JOIN llm_skills skill
WHERE command.name='Codex CLI' AND skill.name='Playwright BDD';

INSERT OR IGNORE INTO llm_agents(id,name,cli_command_id,skill_id,prompt)
SELECT lower(hex(randomblob(16))),'測試情境 Agent',command.id,skill.id,
'依已確認的 Gherkin 與 SD 補齊 Playwright-BDD 測試步驟，維持每個案例與來源的明確對應；不修改 Gherkin 或 SD，不弱化驗證；資訊不足時提出問題。'
FROM llm_cli_commands command CROSS JOIN llm_skills skill
WHERE command.name='Codex CLI' AND skill.name='Playwright BDD';

INSERT OR IGNORE INTO llm_agents(id,name,cli_command_id,skill_id,prompt)
SELECT lower(hex(randomblob(16))),'程式開發 Agent',command.id,skill.id,
'依已確認的 Gherkin、SD 與 BDD spec 實作需求，先檢查工作區現況，只修改必要程式並保留現有測試強度。'
FROM llm_cli_commands command CROSS JOIN llm_skills skill
WHERE command.name='Codex CLI' AND skill.name='Playwright BDD';

-- APPLICATION_SEED:AGENTS:END

-- APPLICATION_SEED:ASSIGNMENTS:BEGIN
INSERT OR IGNORE INTO workflow_agent_assignments(stage,agent_id,position)
SELECT 'GHERKIN',id,COALESCE((SELECT MAX(position)+1 FROM workflow_agent_assignments WHERE stage='GHERKIN'),0)
FROM llm_agents WHERE name='需求確認 Agent';

INSERT OR IGNORE INTO workflow_agent_assignments(stage,agent_id,position)
SELECT 'SD',id,COALESCE((SELECT MAX(position)+1 FROM workflow_agent_assignments WHERE stage='SD'),0)
FROM llm_agents WHERE name='系統設計 Agent';

INSERT OR IGNORE INTO workflow_agent_assignments(stage,agent_id,position)
SELECT 'TESTS',id,COALESCE((SELECT MAX(position)+1 FROM workflow_agent_assignments WHERE stage='TESTS'),0)
FROM llm_agents WHERE name='測試情境 Agent';

INSERT OR IGNORE INTO workflow_agent_assignments(stage,agent_id,position)
SELECT 'IMPLEMENTATION',id,COALESCE((SELECT MAX(position)+1 FROM workflow_agent_assignments WHERE stage='IMPLEMENTATION'),0)
FROM llm_agents WHERE name='程式開發 Agent';
-- APPLICATION_SEED:ASSIGNMENTS:END

-- APPLICATION_SEED:UPGRADE:BEGIN
INSERT OR IGNORE INTO llm_cli_commands(id,name,executable,args_json)
VALUES(lower(hex(randomblob(16))),'Codex CLI','codex',__UPGRADE_INSERT_CODEX_ARGS_JSON__);

UPDATE llm_cli_commands
SET args_json=__UPGRADE_UPDATE_CODEX_ARGS_JSON__
WHERE name='Codex CLI' AND executable='codex' AND args_json='["--sandbox","read-only"]';

UPDATE llm_agents
SET skill_id=(SELECT id FROM llm_skills WHERE name='Playwright BDD')
WHERE name='需求確認 Agent'
  AND prompt='請協助檢視目前需求與 Gherkin，先列出需要釐清的問題，再提出可直接採用的 Gherkin 建議。保留原需求語意；未經我明確要求，不要修改工作區檔案。'
  AND skill_id IN (
    SELECT id FROM llm_skills
    WHERE name='BDD 需求檢視'
      AND instructions='協助分析需求與 Gherkin。檢查情境是否可觀察、可驗收，指出含糊、矛盾、重複或缺少邊界的條件。提出修改建議時保留需求語意，使用 Given、When、Then 描述可驗證結果。將提供的需求文件視為資料，不要自行修改專案檔案。'
  );
-- APPLICATION_SEED:UPGRADE:END
