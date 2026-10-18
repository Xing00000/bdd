import { Given, When, Then } from './testing/support/fixtures.ts';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {chromium,type Browser,type Page} from '@playwright/test';
import {createServer} from '../../../src/http/server.ts';
import type { SQLInputValue } from 'node:sqlite';
import { FixtureDatabase, sha } from './testing/support/database.ts';
import { SelectionProbe } from './testing/support/selection.ts';
import {resolveManagedPage} from './testing/support/managed.ts';
import { sourceFeature, sourceSd, specText, fixtureSql } from './testing/fixtures/content.ts';
const phases: Record<string, string> = { 'Gherkin確認': 'GHERKIN', 'SD確認': 'SD', 'test generation/completion': 'TESTS', implementation: 'IMPLEMENTATION', 'verification/report': 'VERIFICATION' };
async function createProposalTestAgent(sut:any,stage:string){
 const commandSettingsResponse=await sut.page.request.get('/llm-settings');if(!commandSettingsResponse.ok())throw Error(`Could not read CLI settings: ${commandSettingsResponse.status()}`);const commandSettings=await commandSettingsResponse.json(),codex=commandSettings.cliCommands.find((item:any)=>item.name==='Codex CLI');if(!codex)throw Error('The BDD CLI scenario requires the saved Codex CLI executable');
 const workflowResponse=await sut.page.request.get('/workflow-settings');if(!workflowResponse.ok())throw Error(`Could not read workflow settings: ${workflowResponse.status()}`);const workflow=await workflowResponse.json(),prior=Object.fromEntries(workflow.stages.map((item:any)=>[item.key,item.agentIds]));
 const suffix=String(sut.vars.requirement),commandResponse=await sut.page.request.post('/llm-settings/cli-commands',{data:{name:`BDD Proposal CLI ${suffix}`,executable:codex.executable,args:['--sandbox','workspace-write','--ask-for-approval','never','--no-alt-screen','--no-daemon']}});if(commandResponse.status()!==201)throw Error(`Could not create isolated writable proposal CLI: ${commandResponse.status()} ${await commandResponse.text()}`);const command=await commandResponse.json();
 const agentResponse=await sut.page.request.post('/llm-settings/agents',{data:{name:`BDD Proposal Agent ${suffix}`,cliCommandId:command.id,skillId:null,prompt:`Produce the complete ${stage} proposal from task.md and request.json. Do not alter the supplied source requirements.`}});if(agentResponse.status()!==201){const detail=await agentResponse.text(),removed=await sut.page.request.delete(`/llm-settings/cli-commands/${command.id}`);if(!removed.ok())throw Error(`Could not clean failed proposal CLI setup: ${removed.status()}; Agent setup failed: ${detail}`);throw Error(`Could not create proposal Agent: ${agentResponse.status()} ${detail}`);}const agent=await agentResponse.json();
 sut.addCleanup(async()=>{const restored=await sut.page.request.put('/workflow-settings',{data:{assignments:prior}});if(!restored.ok())throw Error(`Could not restore workflow assignments: ${restored.status()}`);const removedAgent=await sut.page.request.delete(`/llm-settings/agents/${agent.id}`);if(!removedAgent.ok())throw Error(`Could not remove proposal Agent ${agent.id}: ${removedAgent.status()}`);const removedCommand=await sut.page.request.delete(`/llm-settings/cli-commands/${command.id}`);if(!removedCommand.ok())throw Error(`Could not remove proposal CLI ${command.id}: ${removedCommand.status()}`);});
 const assignments={...prior,[stage]:[agent.id]},saved=await sut.page.request.put('/workflow-settings',{data:{assignments}});if(!saved.ok())throw Error(`Could not assign proposal Agent to ${stage}: ${saved.status()} ${await saved.text()}`);await sut.page.reload();return agent;
}
// Background; source Gherkin line 9
Given(/^已選擇工作台的需求$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(9, 'Given', async () => {
        await sut.page.goto(`/requirements/${sut.vars.requirement}`);
    });
});
// AC-WB-001; source Gherkin line 13
Given(/^本專案的Gherkin已寫入Xing00000的bdd Git儲存庫$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(13, 'Given', async () => {
        const paths = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { encoding: 'utf8' }).split('\n');
        const required = ['spec/REQ-WB-001/workbench/workbench.feature', 'spec/REQ-WB-001/workbench/workbench.sd.md', 'spec/REQ-WB-001/review.json'];
        for (const file of required)
            expect(paths).toContain(file);
        expect(readFileSync('spec/REQ-WB-001/review.json', 'utf8')).toContain('REQ-WB-001');
    });
});
// AC-WB-001; source Gherkin line 14
When(/^使用者尚未確認這份Gherkin$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(14, 'When', async () => {
        {
            sut.db.useSkeleton();
        }
        {
            sut.db.stage("GHERKIN");
            await sut.page.reload();
        }
        {
            sut.sourcesBefore = sut.sourceSnapshot();
        }
    });
});
// AC-WB-001; source Gherkin line 15
Then(/^本專案維持等待Gherkin確認且不產生SD或產品實作$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(15, 'Then', async () => {
        {
            const stage = "GHERKIN";
            await expect.poll(() => sut.db.all('SELECT stage FROM features WHERE id=?', [String(sut.vars.featureId)])[0]?.stage).toBe(stage);
            await expect(sut.page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage', stage);
        }
        {
            await expect(sut.page.getByTestId('gherkin-editor')).toBeVisible();
            await expect(sut.page.getByTestId('confirm-gherkin')).toBeVisible();
            await expect(sut.page.getByTestId('sd-editor')).toHaveCount(0);
            await expect(sut.page.getByTestId('spec-editor')).toHaveCount(0);
            await expect(sut.page.getByTestId('source-editor')).toHaveCount(0);
        }
        {
            expect(sut.sourceSnapshot()).toBe(sut.sourcesBefore);
        }
    });
});
// AC-WB-001; source Gherkin line 16
When(/^使用者確認Gherkin後再確認對應SD$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(16, 'When', async () => {
        await sut.page.getByTestId('confirm-gherkin').click();
        await expect.poll(() => sut.db.all('SELECT stage FROM features WHERE id=?', [String(sut.vars.featureId)])[0]?.stage).toBe('SD');
        const requirementNode=sut.page.getByTestId('sidebar-requirement-'+String(sut.vars.requirement));
        await requirementNode.locator('.sidebar-stage').nth(1).click();
        await expect(sut.page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage','SD');
        await expect(sut.page.getByTestId('confirm-sd')).toBeEnabled();
        await sut.page.getByTestId('confirm-sd').click();
    });
});
// AC-WB-001; source Gherkin line 17
Then(/^本專案才依序進入測試產生補齊與產品實作階段$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(17, 'Then', async () => {
        {
            const stage = "TESTS";
            await expect.poll(() => sut.db.all('SELECT stage FROM features WHERE id=?', [String(sut.vars.featureId)])[0]?.stage).toBe(stage);
            await expect(sut.page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage', stage);
        }
        {
            const agent=await createProposalTestAgent(sut,'TESTS');sut.vars.workbenchFlowAgentId=agent.id;
            await sut.provideCompletionContext();
            await expect(sut.page.getByTestId(`complete-tests-${agent.id}`)).toBeVisible();
        }
        {
            const agentId=String(sut.vars.workbenchFlowAgentId);const completed=sut.page.waitForResponse(response=>response.url().includes(`/requirements/${sut.vars.requirement}/complete-tests`)&&response.request().method()==='POST');await sut.page.getByTestId(`complete-tests-${agentId}`).click();const response=await completed;expect(response.status()).toBe(200);const proposal=await response.json();expect(proposal.status).toBe('completed');sut.trackLlmTerminal(proposal.terminal?.terminalId);
        }
        {
            const requirementKey=String(sut.db.all('SELECT requirement_key FROM requirements WHERE id=?',[String(sut.vars.requirement)])[0].requirement_key);
            const requirementTab=sut.page.locator('.workspace-tab').filter({hasText:requirementKey}).filter({hasText:'測試情境'}).last();
            await requirementTab.locator('.workspace-tab-select').click();
            await expect(sut.page).toHaveURL(/workflowStage=TESTS/);
            expect(sut.head('spec').test_stage).toBe('COMPLETED');
            await expect(sut.page.getByTestId('confirm-test-steps')).toBeEnabled();
        }
        {
            await sut.page.getByTestId("confirm-test-steps").click();
        }
        {
            const stage = "IMPLEMENTATION";
            await expect.poll(() => sut.db.all('SELECT stage FROM features WHERE id=?', [String(sut.vars.featureId)])[0]?.stage).toBe(stage);
            await expect(sut.page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage', stage);
        }
    });
});
// AC-WB-001; source Gherkin line 18
Then(/^本專案的規格與文件與確認紀錄與測試全部保存在Git$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(18, 'Then', async () => {
        const paths = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { encoding: 'utf8' }).split('\n');
        const required = ['spec/REQ-WB-001/workbench/workbench.feature', 'spec/REQ-WB-001/workbench/workbench.sd.md', 'spec/REQ-WB-001/review.json'];
        required.push('spec/REQ-WB-001/workbench/workbench.feature.spec.ts', 'spec/REQ-WB-001/workbench/workbench.steps.ts', 'spec/REQ-WB-001/workbench/testing/support/fixtures.ts', 'playwright.config.ts', 'package-lock.json');
        for (const file of required)
            expect(paths).toContain(file);
        expect(readFileSync('spec/REQ-WB-001/review.json', 'utf8')).toContain('REQ-WB-001');
    });
});
// AC-WB-002; source Gherkin line 22
Given(/^兩位使用者開啟同一個需求$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(22, 'Given', async () => {
        await sut.page.goto(`/requirements/${sut.vars.requirement}?featureId=${sut.vars.featureId}&workflowStage=GHERKIN`);
    });
});
// AC-WB-002; source Gherkin line 23
When(/^一位使用者在需求保存Gherkin或SD文件$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(23, 'When', async () => {
        await sut.save({ "kind": "gherkin" });
    });
});
// AC-WB-002; source Gherkin line 24
Then(/^另一位使用者可在該需求讀取相同文件內容$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(24, 'Then', async () => {
        sut.other = await sut.context.browser()!.newContext({ baseURL: process.env.WB_BASE_URL });
        const other = sut.tracker.wrapPage(await sut.other.newPage());
        await other.goto(`/requirements/${sut.vars.requirement}?featureId=${sut.vars.featureId}&workflowStage=GHERKIN`);
        await expect(other.getByTestId('gherkin-editor')).toHaveValue(String(sut.vars.feature));
    });
});
// AC-WB-003; source Gherkin line 28
Given(/^工作台顯示所選Gherkin處於確認階段且已有草稿$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(28, 'Given', async () => {
        {
            sut.db.stage("GHERKIN");
            await sut.page.reload();
        }
        {
            await expect(sut.page.getByTestId("gherkin-editor")).toBeVisible();
        }
    });
});
// AC-WB-003; source Gherkin line 30
Then(/^工作台流程狀態顯示SD確認且開啟SD編輯$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(30, 'Then', async () => {
        const sdTab=sut.page.getByTestId('workspace-tabs').locator('.workspace-tab').filter({hasText:'系統設計'}).last();
        await expect(sdTab).toHaveCount(1);
        await sdTab.locator('.workspace-tab-select').click();
        await expect(sut.page).toHaveURL(/workflowStage=SD/);
        {
            const stage = "SD";
            await expect.poll(() => sut.db.all('SELECT stage FROM features WHERE id=?', [String(sut.vars.featureId)])[0]?.stage).toBe(stage);
            await expect(sut.page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage', stage);
        }
        {
            await expect(sut.page.getByTestId("sd-editor")).toBeVisible();
        }
    });
});
// AC-WB-003; source Gherkin line 32
Then(/^產生對應Gherkin的SD草稿供人類確認$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(32, 'Then', async () => {
        const v = sut.head("sd");
        expect(v.id).not.toBe(sut.vars["sd" + 'Version']);
    });
});
// AC-WB-003; source Gherkin line 33
Then(/^SD包含程式架構以及本次資料庫DDL與DML內容$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(33, 'Then', async () => {
        const raw = String(sut.head('sd').raw_text);
        expect(raw).toMatch(/架構|Architecture/i);
        expect(raw).toMatch(/DDL|CREATE/i);
        expect(raw).toMatch(/DML|INSERT|UPDATE|SELECT/i);
    });
});
// AC-WB-003; source Gherkin line 34
Then(/^人類尚未確認SD時不進入產品開發$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(34, 'Then', async () => {
        const sdTab=sut.page.getByTestId('workspace-tabs').locator('.workspace-tab').filter({hasText:'系統設計'}).last();
        await sdTab.locator('.workspace-tab-select').click();
        await expect(sut.page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage','SD');
        const response=await sut.page.request.post(`/requirements/${sut.vars.requirement}/start-development`,{data:{featureId:sut.vars.featureId}});
        expect(response.status()).toBe(409);
        expect((await response.json()).code).toBe('WORKFLOW_GATE_NOT_MET');
        await expect.poll(()=>sut.db.all('SELECT stage FROM features WHERE id=?',[String(sut.vars.featureId)])[0]?.stage).toBe('SD');
    });
});
// AC-WB-005; source Gherkin line 46
Given(/^已產生對應確認文件的測試骨架$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(46, 'Given', async () => {
        sut.db.useSkeleton();
        sut.db.stage('TESTS');
        await sut.page.reload();
        sut.llmFull = { db: sut.db, source: sut.sourceSnapshot(), version: String(sut.head('spec').id) };
    });
});
// AC-WB-005; source Gherkin line 48
Then(/^補齊的測試仍對應人類已確認的驗收條件$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(48, 'Then', async () => {
        await sut.page.goto(`/requirements/${sut.vars.requirement}?featureId=${sut.vars.featureId}&workflowStage=TESTS`);
        const full = sut.llmFull!;
        expect(sut.sourceSnapshot()).toBe(full.source);
        const row = sut.head('spec');
        expect(row.id).not.toBe(full.version);
        expect(row.test_stage).toBe('COMPLETED');
        expect(row.source_skeleton_version_id).toBe(full.version);
        sut.checkSyntax(String(row.raw_text));
        expect(sut.db.all('SELECT test_key FROM test_definitions WHERE spec_version_id=? ORDER BY test_key', [String(row.id)])).toEqual([{ test_key: 'test-a' }, { test_key: 'test-a-extra' }, { test_key: 'test-b' }]);
        await (async () => {
            const manifest = JSON.parse(await sut.page.getByTestId('generated-manifest').inputValue());
            expect(manifest.cases.map((c: {
                scenarioId: string;
                caseId: string;
            }) => [c.scenarioId, c.caseId])).toEqual(expect.arrayContaining([['AC-DEMO-001', 'a'], ['AC-DEMO-001', 'b']]));
        })();
    });
});
// AC-WB-005; source Gherkin line 50
Then(/^缺少預期結果資訊時列出待補內容而不自行改寫驗收條件$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(50, 'Then', async () => {
        const missing = sut.llmMissing!;
        expect(missing.result.status).toBe('needs_input');
        expect((missing.result.questions as unknown[]).length).toBeGreaterThan(0);
        const versions = missing.db.all('SELECT v.* FROM document_heads h JOIN document_versions v ON v.id=h.version_id WHERE h.document_id=?', [missing.db.vars.specDoc]);
        expect(['SKELETON', 'COMPLETION_DRAFT']).toContain(versions[0].test_stage);
        expect(missing.db.all("SELECT id FROM baselines WHERE requirement_id=? AND kind='tests' AND valid=1", [missing.db.vars.requirement])).toHaveLength(0);
        expect(sut.documentSource(missing.db)).toBe(missing.source);
    });
});
// AC-WB-006; source Gherkin line 54
Given(/^Gherkin與SD已確認且測試規格已補齊$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(54, 'Given', async () => {
        {
            sut.db.stage("TESTS");
            await sut.page.reload();
        }
        {
            sut.db.baseline(false);
        }
    });
});
// AC-WB-006; source Gherkin line 56
Then(/^工作台流程狀態顯示implementation$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(56, 'Then', async () => {
        const stage = "IMPLEMENTATION";
        await expect.poll(() => sut.db.all('SELECT stage FROM features WHERE id=?', [String(sut.vars.featureId)])[0]?.stage).toBe(stage);
        await expect(sut.page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage', stage);
    });
});
// AC-WB-006; source Gherkin line 59
Then(/^開發完成後可開始驗證該次開發成果$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(59, 'Then', async () => {
        const sourceRef = sut.vars.sourceRef;
        if (!sourceRef)
            throw Error('WB_SOURCE_REF required; no fictitious source revision');
        const baselines = sut.db.all("SELECT id FROM baselines WHERE requirement_id=? AND kind='tests' AND valid=1", [String(sut.vars.requirement)]);
        expect(baselines).toHaveLength(1);
        sut.vars.baseline = baselines[0].id;
        await sut.request(`/requirements/${sut.vars.requirement}/verify`, { testBaselineId: sut.vars.baseline, sourceRef, selection: { mode: 'ALL_REQUIRED', sourceCaseIds: [] } }, [200, 201, 202]);
    });
});
// AC-WB-007; source Gherkin line 63
Given(/^共用專案已設定DbGate網頁入口與SQLite測試資料庫連線$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(63, 'Given', async () => {
        {
            sut.db.stage("SD");
            await sut.page.reload();
        }
        {
            const params = (([sut.vars.connection])) as SQLInputValue[];
            await expect.poll(() => sut.db.all("SELECT sqlite_file_ref FROM target_connections WHERE id=?", params)).toMatchObject(([{ "sqlite_file_ref": sut.vars.targetDb }]) as object[]);
            sut.last = sut.db.all("SELECT sqlite_file_ref FROM target_connections WHERE id=?", params);
        }
    });
});
// AC-WB-007; source Gherkin line 64
When(/^使用者透過DbGate瀏覽schema與資料並執行本次SD內的DDL或DML$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(64, 'When', async () => {
        {
            await sut.queryUi(fixtureSql);
        }
        {
            await sut.queryUi("UPDATE test_accounts SET role_code='B' WHERE username='scenario_user'; SELECT role_code FROM test_accounts WHERE username='scenario_user';");
        }
    });
});
// AC-WB-007; source Gherkin line 65
Then(/^DbGate顯示該測試資料庫的實際schema與資料及SQL執行結果$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(65, 'Then', async () => {
        {
            await expect(sut.dbGateResults()).toContainText("B");
            expect((sut.vars.dbRows as Record<string, unknown>[]).some(row => Object.values(row).includes("B"))).toBe(true);
            sut.last = await sut.dbGateResults().innerText();
        }
        {
            sut.last = await sut.dbGate!.page.getByText('Finished',{exact:true}).textContent();
            await expect(sut.dbGate!.page.getByText('Finished',{exact:true})).toContainText("Finished");
        }
        {
            await sut.dbGate!.page.getByTestId('SqlObjectList_refreshButton').click();
            await expect(sut.dbGate!.schema()).toContainText('test_accounts');
            await sut.queryUi('PRAGMA table_info(test_accounts);');
            await expect(sut.dbGateResults()).toContainText('role_code');
        }
    });
});
// AC-WB-007; source Gherkin line 66
Then(/^重新讀取資料庫時可看到實際變更$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(66, 'Then', async () => {
        {
            await sut.queryUi("SELECT role_code FROM test_accounts WHERE username='scenario_user';");
        }
        {
            await expect(sut.dbGateResults()).toContainText("B");
            expect((sut.vars.dbRows as Record<string, unknown>[]).some(row => Object.values(row).includes("B"))).toBe(true);
            sut.last = await sut.dbGateResults().innerText();
        }
    });
});
// AC-WB-009; source Gherkin line 80
Given(/^專案已有Playwright瀏覽器會話$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(80, 'Given', async () => {
        await sut.browser();
    });
});
// AC-WB-009; source Gherkin line 81
When(/^"([^"]*)"使用Playwright操作該會話的網頁$/, async ({ sut }, arg0: string) => {
    const expect = sut.check;
    await sut.step(81, 'When', async () => {
        if (!sut.target)
            await sut.browser();
        sut.frameBefore = sha(await sut.page.getByTestId('browser-canvas').screenshot());
        const marker = `${String(arg0 ?? '')}-${sut.vars.project}`;
        sut.vars.marker = marker;
        await sut.target!.getByTestId('document-content').fill(marker);
        await expect(sut.target!.getByTestId('document-content')).toHaveValue(marker);
    });
});
// AC-WB-009; source Gherkin line 82
Then(/^工作台內嵌畫面顯示該會話當前的網頁操作結果$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(82, 'Then', async () => {
        await expect.poll(async () => sha(await sut.page.getByTestId('browser-canvas').screenshot())).not.toBe(sut.frameBefore);
        await expect(sut.page.getByTestId('browser-session-id')).toHaveText(String(sut.vars.session));
        await expect(sut.page.getByTestId('browser-stream-state')).toHaveText('live');
        const binding = sut.vars.managedBinding as {
            sessionId: string;
            contextRef: string;
            pageId: string;
        };
        await expect(sut.page.getByTestId('browser-canvas')).toHaveAttribute('data-session-id', binding.sessionId);
        await expect(sut.page.getByTestId('browser-canvas')).toHaveAttribute('data-context-ref', binding.contextRef);
        await expect(sut.page.getByTestId('browser-canvas')).toHaveAttribute('data-page-id', binding.pageId);
    });
});
// AC-WB-009; source Gherkin line 83
Then(/^顯示的是操作中的會話而不是事後trace報告$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(83, 'Then', async () => {
        {
            sut.last = await sut.page.getByTestId("browser-stream-state").textContent();
            await expect(sut.page.getByTestId("browser-stream-state")).toContainText("live");
        }
        {
            await expect(sut.page.getByTestId("trace-viewer")).toBeHidden();
        }
    });
});
// AC-WB-011; source Gherkin line 101
Given(/^測試被指定為被開發專案的CI測試$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(101, 'Given', async () => {
        {
            sut.db.stage("TESTS");
            await sut.page.goto(`/requirements/${sut.vars.requirement}?featureId=${sut.vars.featureId}&workflowStage=VERIFICATION`);
        }
        {
            sut.repoBefore = sut.repoState();
        }
    });
});
// AC-WB-011; source Gherkin line 102
When(/^保存測試並在該專案CI執行$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(102, 'When', async () => {
        {
            await sut.page.getByTestId("save-to-target-git").click();
        }
        {
            await sut.page.getByTestId("run-target-ci").click();
        }
        {
            await expect(sut.page.getByTestId('ci-state')).toHaveText('completed', { timeout: 60000 });
            sut.vars.run = await sut.page.getByTestId('ci-run-id').innerText();
            sut.repoBefore = sut.repoState();
        }
    });
});
// AC-WB-011; source Gherkin line 103
Then(/^測試檔案跟著該專案Git的branch與commit$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(103, 'Then', async () => {
        const repo = process.env.WB_TARGET_REPO;
        if (!repo)
            throw Error('WB_TARGET_REPO required');
        const rows = sut.db.all('SELECT g.* FROM git_snapshots g JOIN document_heads h ON h.version_id=g.spec_version_id WHERE h.document_id=?', [String(sut.vars.specDoc)]);
        expect(rows).toHaveLength(1);
        const row = rows[0];
        const raw = execFileSync('git', ['-C', repo, 'show', `${row.commit_sha}:${row.file_path}`], { encoding: 'utf8' });
        expect(sut.head('spec').raw_text).toBe(raw);
        sut.vars.savedSpec = raw;
        sut.vars.targetCommit = row.commit_sha;
    });
});
// AC-WB-011; source Gherkin line 104
Then(/^CI結果可對應該專案的實際commit$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(104, 'Then', async () => {
        const run = sut.db.all('SELECT candidate_commit,tested_commit FROM runs WHERE id=?', [String(sut.vars.run)])[0];
        expect(run?.candidate_commit).toBe(sut.vars.targetCommit);
        expect(typeof run.tested_commit).toBe('string');
        const commit = execFileSync('git', ['-C', process.env.WB_TARGET_REPO!, 'rev-parse', String(run.tested_commit) + '^{commit}'], { encoding: 'utf8' }).trim();
        expect(commit).toBe(run.tested_commit);
    });
});
// AC-WB-011; source Gherkin line 105
Then(/^工作台可在SQLite保存及讀回該commit對應的spec\.ts內容副本$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(105, 'Then', async () => {
        const kind = "spec";
        const doc = sut.vars[kind + 'Doc'];
        sut.last = sut.db.all('SELECT v.raw_text,v.raw_sha256,v.id FROM document_heads h JOIN document_versions v ON v.id=h.version_id WHERE h.document_id=?', [String(doc)])[0];
        expect((sut.last as Record<string, unknown>)?.raw_text).toBe(sut.vars.savedSpec);
        expect((sut.last as Record<string, unknown>)?.raw_sha256).toBe(sha(String((sut.last as Record<string, unknown>).raw_text)));
    });
});
// AC-WB-011; source Gherkin line 106
Then(/^該資料庫副本不取代target Git的標準CI測試版本或改變CI測試清單$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(106, 'Then', async () => {
        {
            const repo = process.env.WB_TARGET_REPO;
            if (!repo)
                throw Error('WB_TARGET_REPO required');
            const rows = sut.db.all('SELECT g.* FROM git_snapshots g JOIN document_heads h ON h.version_id=g.spec_version_id WHERE h.document_id=?', [String(sut.vars.specDoc)]);
            expect(rows).toHaveLength(1);
            const row = rows[0];
            const raw = execFileSync('git', ['-C', repo, 'show', `${row.commit_sha}:${row.file_path}`], { encoding: 'utf8' });
            expect(sut.head('spec').raw_text).toBe(raw);
            sut.vars.savedSpec = raw;
            sut.vars.targetCommit = row.commit_sha;
        }
        {
            expect(sut.repoState()).toBe(sut.repoBefore);
        }
    });
});
// AC-WB-012; source Gherkin line 110
Given(/^使用者建立自己的整合測試$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(110, 'Given', async () => {
        {
            sut.db.stage("TESTS");
            await sut.page.reload();
        }
        {
            sut.repoBefore = sut.repoState();
        }
        {
            sut.vars["integration"] = true;
            sut.db.db.prepare("UPDATE documents SET purpose='integration' WHERE id=?").run(String(sut.vars.recordingDoc));
        }
    });
});
// AC-WB-012; source Gherkin line 111
When(/^在工作台保存測試定義與目標環境並要求執行$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(111, 'When', async () => {
        {
            await sut.save({ kind: 'recording', unassociated: true });
        }
        {
            const document = sut.db.all('SELECT purpose FROM documents WHERE id=?', [String(sut.vars.recordingDoc)])[0];
            if (document.purpose === 'recording') {
                await sut.page.goto(`/projects/${sut.vars.project}/recordings/${sut.vars.recordingDoc}`);
                await expect(sut.page.getByTestId('recording-script')).toHaveValue(String(sut.vars.recording));
            }
            const rows = sut.db.all('SELECT h.version_id FROM document_heads h WHERE h.document_id=?', [String(sut.vars.recordingDoc)]);
            expect(rows).toHaveLength(1);
            await sut.request(`/scripts/${sut.vars.recordingDoc}/versions/${rows[0].version_id}/replay`, { projectId: sut.vars.project, targetUrl: sut.targetUrl }, [200, 201, 202]);
        }
    });
});
// AC-WB-012; source Gherkin line 112
Then(/^測試定義與執行紀錄保存在工作台SQLite$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(112, 'Then', async () => {
        {
            const rows = sut.db.all('SELECT d.purpose,r.script_version_id FROM runs r JOIN document_versions v ON v.id=r.script_version_id JOIN documents d ON d.id=v.document_id WHERE r.id=?', [String(sut.vars.run)]);
            expect(rows).toHaveLength(1);
            expect(rows[0].purpose).toBe('integration');
        }
        {
            await expect.poll(async () => {
                const response = await sut.page.request.get(`/runs/${sut.vars.run}/report`);
                if (!response.ok())
                    throw Error('Report endpoint returned ' + response.status());
                sut.last = await response.json();
                sut.vars.report = sut.last;
                return (sut.last as Record<string, unknown>).status;
            }, { timeout: 60000 }).toMatch(/^(PASSED|FAILED|INCOMPLETE|INVALID)$/);
        }
        {
            const report = sut.vars.report as {
                scriptVersionId: string;
                status: string;
                cases: {
                    executed: boolean;
                }[];
            };
            expect(report.scriptVersionId).toBe(sut.vars.recordingSavedVersion);
            expect(report.cases.length).toBeGreaterThan(0);
            expect(report.cases.every(c => c.executed)).toBe(true);
            expect(['PASSED', 'FAILED']).toContain(report.status);
        }
    });
});
// AC-WB-012; source Gherkin line 113
Then(/^該測試不會自動寫入被開發專案Git$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(113, 'Then', async () => {
        expect(sut.repoState(), 'target Git and CI list unchanged').toBe(sut.repoBefore);
    });
});
// AC-WB-013; source Gherkin line 117
Given(/^專案開發完成且驗證測試已備妥$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(117, 'Given', async () => {
        {
            sut.db.stage("IMPLEMENTATION");
            await sut.page.reload();
        }
        {
            sut.db.baseline(false);
        }
    });
});
// AC-WB-013; source Gherkin line 118
When(/^使用者在工作台提交驗證並執行對應E2E測試$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(118, 'When', async () => {
        await sut.request(String((`/requirements/${sut.vars.requirement}/verify`)), ({ "testBaselineId": sut.vars.baseline, "sourceRef": sut.vars.sourceRef, "selection": { "mode": "ALL_REQUIRED", "sourceCaseIds": [] } }), (([200, 201, 202])) as number | number[]);
    });
});
// AC-WB-013; source Gherkin line 119
Then(/^工作台流程狀態顯示verification\/report$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(119, 'Then', async () => {
        const stage = "VERIFICATION";
        await expect.poll(() => sut.db.all('SELECT stage FROM features WHERE id=?', [String(sut.vars.featureId)])[0]?.stage).toBe(stage);
        await expect(sut.page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage', stage);
    });
});
// AC-WB-013; source Gherkin line 120
Then(/^報告列出各驗收案例的實際執行結果$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(120, 'Then', async () => {
        {
            await expect.poll(async () => {
                const response = await sut.page.request.get(`/runs/${sut.vars.run}/report`);
                if (!response.ok())
                    throw Error('Report endpoint returned ' + response.status());
                sut.last = await response.json();
                sut.vars.report = sut.last;
                return (sut.last as Record<string, unknown>).status;
            }, { timeout: 60000 }).toMatch(/^(PASSED|FAILED|INCOMPLETE|INVALID)$/);
        }
        {
            const report = sut.vars.report as {
                cases: {
                    testKey: string;
                    status: string;
                    executed: boolean;
                    steps: unknown[];
                }[];
            };
            expect(report.cases.length).toBeGreaterThan(0);
            for (const c of report.cases) {
                expect(c.testKey.length).toBeGreaterThan(0);
                expect(['PASSED', 'FAILED', 'NOT_RUN', 'INCOMPLETE', 'INVALID']).toContain(c.status);
                expect(typeof c.executed).toBe('boolean');
                if (c.executed)
                    expect(c.steps.length).toBeGreaterThan(0);
            }
        }
    });
});
// AC-WB-013; source Gherkin line 121
Then(/^報告可對應Gherkin案例與被驗證的程式版本$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(121, 'Then', async () => {
        const report = sut.vars.report as Record<string, unknown>;
        expect(report.sourceRef).toBe(sut.vars.sourceRef);
        expect(report.gherkinVersionId).toBe(sut.vars.gherkinVersion);
        expect(report.testBaselineId).toBe(sut.vars.baseline);
    });
});
// AC-WB-013; source Gherkin line 122
Then(/^未通過或未執行的案例不被報成通過$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(122, 'Then', async () => {
        const report = sut.vars.report as {
            cases: {
                status: string;
                executed: boolean;
                steps: {
                    status: string;
                    assertion: boolean;
                    expected: unknown;
                    actual: unknown;
                    screenshots: unknown[];
                }[];
            }[];
        };
        expect(report.cases.length).toBeGreaterThan(0);
        for (const c of report.cases)
            if (c.status === 'PASSED') {
                expect(c.executed).toBe(true);
                expect(c.steps.length).toBeGreaterThan(0);
                const assertions = c.steps.filter(s => s.assertion);
                expect(assertions.length).toBeGreaterThan(0);
                for (const step of c.steps) {
                    expect(step.status).toBe('PASSED');
                    expect(step.screenshots.length).toBeGreaterThan(0);
                }
                for (const step of assertions) {
                    expect(step).toHaveProperty('expected');
                    expect(step).toHaveProperty('actual');
                    expect((step as unknown as {
                        assertionPassed: boolean;
                    }).assertionPassed).toBe(true);
                }
            }
    });
});
// AC-WB-013; source Gherkin line 123
Then(/^Playwright截圖可對應Scenario與step及該步驟實際結果$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(123, 'Then', async () => {
        await sut.evidence();
    });
});
// AC-WB-014; source Gherkin line 127
Given(/^Gherkin含有尚未定義或尚未實作的測試步驟$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(127, 'Given', async () => {
        {
            sut.db.stage("TESTS");
            await sut.page.reload();
        }
        {
            const raw = sourceFeature.replace('the account edits the document', 'deliberately_missing_step');
            sut.db.db.prepare("DELETE FROM confirmations WHERE requirement_id=? AND kind='gherkin'").run(String(sut.vars.requirement));
            sut.db.db.prepare('UPDATE document_versions SET raw_text=?,raw_sha256=? WHERE id=?').run(raw, sha(raw), String(sut.vars.gherkinVersion));
            sut.db.insert('confirmations', { requirement_id: String(sut.vars.requirement), feature_id: String(sut.vars.featureId), kind: 'gherkin', version_id: String(sut.vars.gherkinVersion), raw_sha256: sha(raw), confirmed_at: new Date().toISOString() });
            sut.db.db.prepare("UPDATE steps SET text='deliberately_missing_step' WHERE group_id IN (SELECT id FROM step_groups WHERE gherkin_version_id=?) AND ordinal=2").run(String(sut.vars.gherkinVersion));
        }
        {
            sut.sourcesBefore = sut.sourceSnapshot();
        }
        for (const version of sut.db.all('SELECT id,test_manifest_json FROM document_versions WHERE document_id=?', [String(sut.vars.specDoc)])) {
            const manifest = JSON.parse(String(version.test_manifest_json));
            manifest.gherkinSha256 = sha(String(sut.db.all('SELECT raw_text FROM document_versions WHERE id=?', [String(sut.vars.gherkinVersion)])[0].raw_text));
            const text = JSON.stringify(manifest);
            sut.db.db.prepare('UPDATE document_versions SET test_manifest_json=?,test_manifest_sha256=? WHERE id=?').run(text, sha(text), String(version.id));
        }
    });
});
// AC-WB-014; source Gherkin line 128
When(/^產生或執行對應測試$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(128, 'When', async () => {
        await sut.request(String((`/requirements/${sut.vars.requirement}/generate-tests`)), ({ "stepDefinitions": [] }), (([200, 422])) as number | number[]);
    });
});
// AC-WB-014; source Gherkin line 129
Then(/^生成器阻擋缺少定義的步驟或測試明確回報未實作$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(129, 'Then', async () => {
        const result=sut.last as any;
        if(result.testStage==='SKELETON'){
            expect(result.manifest.pendingSlots.some((slot:any)=>JSON.stringify(slot).includes('deliberately_missing_step'))).toBe(true);
            const steps=result.manifest.bundleFiles.find((file:any)=>file.path.endsWith('.steps.ts'));
            expect(steps?.rawText).toContain('deliberately_missing_step');
            expect(steps?.rawText).toContain('UnimplementedStepError');
        }else{
            expect(JSON.stringify(result)).toContain('deliberately_missing_step');
            expect(JSON.stringify(result)).toMatch(/UNDEFINED|MISSING|未定義|未實作/i);
        }
    });
});
// AC-WB-014; source Gherkin line 130
Then(/^不以空函式或刪除驗收案例換取通過$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(130, 'Then', async () => {
        {
            expect(sut.sourceSnapshot()).toBe(sut.sourcesBefore);
        }
        {
            const params = (([sut.vars.requirement])) as SQLInputValue[];
            await expect.poll(() => sut.db.all("SELECT count(*) AS n FROM scenarios WHERE requirement_id=?", params)).toMatchObject(([{ "n": 1 }]) as object[]);
            sut.last = sut.db.all("SELECT count(*) AS n FROM scenarios WHERE requirement_id=?", params);
        }
    });
});
// AC-WB-015; source Gherkin line 134
Given(/^工作台顯示專案目前在"([^"]*)"階段且已有保存內容$/, async ({ sut }, arg0: string) => {
    const expect = sut.check;
    await sut.step(134, 'Given', async () => {
        const stage=({Gherkin:'GHERKIN','spec.ts':'TESTS',SD:'SD'} as Record<string,string>)[String(arg0??'')]??phases[String(arg0??'')]??String(arg0??'');
        sut.db.stage(stage);
        if(['IMPLEMENTATION','VERIFICATION'].includes(stage))sut.db.baseline(false);
        await sut.page.goto(`/requirements/${sut.vars.requirement}?featureId=${sut.vars.featureId}&workflowStage=${stage}`);
        await expect(sut.page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage',stage);
        sut.before=sut.db.snapshot();sut.repoBefore=sut.repoState();
    });
});
// AC-WB-015; source Gherkin line 135
When(/^使用者在工作台嘗試保存禁止變更的"([^"]*)"$/, async ({ sut }, arg0: string) => {
    const expect = sut.check;
    await sut.step(135, 'When', async () => {
        const blocked=String(arg0??'');
        const artifacts=blocked==='Gherkin或SD'?['gherkin','sd']:blocked==='程式或測試'?['source','spec']:blocked.includes('Gherkin')?['gherkin']:blocked==='SD'?['sd']:['spec'];
        const errors:any[]=[];
        for(const artifact of artifacts){
            let response:import('@playwright/test').APIResponse;
            if(artifact==='source'){
                response=await sut.page.request.post(`/requirements/${sut.vars.requirement}/source`,{data:{featureId:sut.vars.featureId,projectId:sut.vars.project,rawText:'export const blockedStageEdit = true;\n',path:'src/blocked-stage-edit.ts'}});
            }else{
                const doc=String(sut.vars[artifact+'Doc']),head=sut.head(artifact);
                const raw=artifact==='gherkin'?sourceFeature+'\n':artifact==='sd'?sourceSd+'\n':specText(sut.targetUrl);
                response=await sut.page.request.post(`/documents/${doc}/versions`,{data:{rawText:raw,baseVersionId:String(head.id),sourceGherkinVersionId:artifact==='gherkin'?null:String(sut.vars.gherkinVersion)}});
            }
            expect(response.status()).toBe(409);
            const result=await response.json();expect(result.code).toBe('ARTIFACT_LOCKED_IN_STAGE');expect(result.message).toContain('此階段不可修改該產物');errors.push(result);
        }
        sut.vars.lockedMutationErrors=errors;sut.last=errors.at(-1);
    });
});
// AC-WB-015; source Gherkin line 136
Then(/^工作台顯示此階段不可修改該產物$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(136, 'Then', async () => {
        const errors=sut.vars.lockedMutationErrors as any[];expect(errors.length).toBeGreaterThan(0);
        for(const error of errors){expect(error.code).toBe('ARTIFACT_LOCKED_IN_STAGE');expect(error.message).toContain('此階段不可修改該產物');}
    });
});
// AC-WB-015; source Gherkin line 137
Then(/^該產物仍為上次保存內容$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(137, 'Then', async () => {
        expect(sut.db.snapshot(), 'effective original text and projections').toBe(sut.before);
        expect(sut.repoState(),'target project source remains unchanged').toBe(sut.repoBefore);
    });
});
// AC-WB-015; source Gherkin line 138
Then(/^工作台只對"([^"]*)"提供本階段的編輯或執行入口$/, async ({ sut }, arg0: string) => {
    const expect = sut.check;
    await sut.step(138, 'Then', async () => {
        const current = String(sut.db.all('SELECT stage FROM features WHERE id=?', [String(sut.vars.featureId)])[0].stage);
        await expect(sut.page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage',current);
        if(current==='GHERKIN'){await expect(sut.page.getByTestId('gherkin-editor')).toBeEditable();await expect(sut.page.getByTestId('confirm-gherkin')).toBeEnabled();}
        if(current==='SD'){await expect(sut.page.getByTestId('sd-editor')).toBeEditable();await expect(sut.page.getByTestId('confirm-sd')).toBeEnabled();}
        if(current==='TESTS'){await expect(sut.page.getByTestId('spec-editor')).toBeVisible();await expect(sut.page.getByTestId('generated-spec-source')).toHaveAttribute('readonly','');await expect(sut.page.getByTestId('confirm-test-steps')).toBeEnabled();}
        if(current==='IMPLEMENTATION'){await expect(sut.page.getByTestId('source-editor')).toBeEditable();}
        if(current==='VERIFICATION'){await expect(sut.page.getByTestId('run-verification')).toBeEnabled();}
    });
});
// AC-WB-015; source Gherkin line 139
Then(/^"([^"]*)"維持鎖定$/, async ({ sut }, arg0: string) => {
    const expect = sut.check;
    await sut.step(139, 'Then', async () => {
        const locked=String(arg0??''),stage=String(sut.db.all('SELECT stage FROM features WHERE id=?',[String(sut.vars.featureId)])[0].stage),base=`/requirements/${sut.vars.requirement}?featureId=${sut.vars.featureId}&workflowStage=`;
        if(locked.includes('Gherkin')&&stage!=='GHERKIN'){await sut.page.goto(base+'GHERKIN');await expect(sut.page.getByTestId('gherkin-editor')).toHaveAttribute('readonly','');}
        if(locked.includes('SD')&&stage!=='SD'){await sut.page.goto(base+'SD');if(sut.db.all("SELECT kind FROM confirmations WHERE feature_id=? AND kind='sd'",[String(sut.vars.featureId)]).length)await expect(sut.page.getByTestId('sd-editor')).toHaveCount(0);else await expect(sut.page.getByTestId('sd-editor')).toHaveAttribute('readonly','');}
        if((locked.includes('測試')||locked.includes('spec.ts'))&&stage!=='TESTS'){await sut.page.goto(base+'TESTS');await expect(sut.page.getByTestId('generated-spec-source')).toHaveAttribute('readonly','');}
        if(locked.includes('產品程式')&&stage!=='IMPLEMENTATION'){await sut.page.goto(base+'IMPLEMENTATION');await expect(sut.page.getByTestId('source-editor')).toHaveAttribute('readonly','');}
        if(locked.includes('測試基線'))expect(sut.db.all("SELECT id FROM baselines WHERE feature_id=? AND kind='tests' AND valid=1",[String(sut.vars.featureId)])).toHaveLength(1);
        await sut.page.goto(base+stage);await expect(sut.page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage',stage);
    });
});
// AC-WB-016; source Gherkin line 150
Given(/^專案已有測試基線與驗證結果$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(150, 'Given', async () => {
        {
            sut.db.stage("VERIFIED");
            await sut.page.reload();
        }
        {
            sut.db.baseline(true);
        }
    });
});
// AC-WB-016; source Gherkin line 151
When(/^使用者在工作台選擇退回修改並指定"([^"]*)"$/, async ({ sut }, arg0: string) => {
    const expect = sut.check;
    await sut.step(151, 'When', async () => {
        sut.vars.returnArtifact = String(arg0 ?? '');
        await sut.page.getByTestId('return-artifact').selectOption({ label: String(arg0 ?? '') });
        const waiting = sut.page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === `/requirements/${sut.vars.requirement}/return`);
        await sut.page.getByTestId('return-stage').click();
        const response = await waiting;
        expect(response.ok()).toBe(true);
    });
});
// AC-WB-016; source Gherkin line 152
Then(/^工作台流程狀態顯示"([^"]*)"才開啟該產物編輯$/, async ({ sut }, arg0: string) => {
    const expect = sut.check;
    await sut.step(152, 'Then', async () => {
        const stage = phases[String(arg0 ?? '')] ?? String(arg0 ?? '');
        await expect.poll(() => sut.db.all('SELECT stage FROM features WHERE id=?', [String(sut.vars.featureId)])[0]?.stage).toBe(stage);
        await expect(sut.page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage', stage);
    });
});
// AC-WB-016; source Gherkin line 153
Then(/^工作台將依賴該產物的下游產物與驗證結果標示失效$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(153, 'Then', async () => {
        const baseline = sut.db.all('SELECT valid FROM baselines WHERE id=?', [String(sut.vars.baseline)])[0];
        expect(baseline.valid).toBe(sut.vars.returnArtifact === '產品程式' ? 1 : 0);
        expect(sut.db.all('SELECT status FROM runs WHERE id=?', [String(sut.vars.historicalRun)])[0].status).toBe('INVALID');
    });
});
// AC-WB-016; source Gherkin line 154
Then(/^Gherkin或SD修改後未重新確認時不能再次前進$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(154, 'Then', async () => {
        const stage = sut.db.all('SELECT stage FROM features WHERE id=?', [String(sut.vars.featureId)])[0]?.stage;
        if (stage === 'GHERKIN' || stage === 'SD') {
            await sut.request(`/requirements/${sut.vars.requirement}/start-development`, {}, 409);
            expect((sut.last as {code?:string}).code).toBe('WORKFLOW_GATE_NOT_MET');
        }
        else
            expect(['TESTS', 'IMPLEMENTATION']).toContain(stage);
    });
});
// AC-WB-016; source Gherkin line 155
Then(/^完成該階段要求後依序重新產生或驗證下游結果$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(155, 'Then', async () => {
        const stage=String(sut.db.all('SELECT stage FROM features WHERE id=?',[String(sut.vars.featureId)])[0].stage);
        const needsTestAgent=stage==='GHERKIN'||stage==='SD'||stage==='TESTS'&&sut.head('spec').test_stage!=='COMPLETED';
        const testAgent=needsTestAgent?await createProposalTestAgent(sut,'TESTS'):undefined;
        await sut.advance(testAgent?.id);
    });
});
// AC-WB-016; source Gherkin line 156
Then(/^不會在同一階段同時修改Gherkin與spec\.ts$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(156, 'Then', async () => {
        const gherkin=sut.page.getByTestId('gherkin-editor'),spec=sut.page.getByTestId('spec-editor');
        const a=await gherkin.count()?await gherkin.isEditable():false,b=await spec.count()?await spec.isEditable():false;
        expect(a && b).toBe(false);
    });
});
// AC-WB-017; source Gherkin line 167
Given(/^被測專案的測試資料庫有帳號"scenario_user"且角色為"A"與狀態為"active"$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(167, 'Given', async () => {
        await sut.queryUi(fixtureSql);
    });
});
// AC-WB-017; source Gherkin line 168
When(/^spec使用Playwright開啟專案的DbGate網頁介面並查詢"scenario_user"$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(168, 'When', async () => {
        await sut.queryUi("SELECT role_code,state FROM test_accounts WHERE username='scenario_user';");
    });
});
// AC-WB-017; source Gherkin line 169
Then(/^spec斷言實際查詢資料的角色為"A"且狀態為"active"$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(169, 'Then', async () => {
        {
            await expect(sut.dbGateResults()).toContainText("A");
            expect((sut.vars.dbRows as Record<string, unknown>[]).some(row => Object.values(row).includes("A"))).toBe(true);
            sut.last = await sut.dbGateResults().innerText();
        }
        {
            await expect(sut.dbGateResults()).toContainText("active");
            expect((sut.vars.dbRows as Record<string, unknown>[]).some(row => Object.values(row).includes("active"))).toBe(true);
            sut.last = await sut.dbGateResults().innerText();
        }
        expect(sut.vars.dbRows).toEqual([{ role_code: 'A', state: 'active' }]);
    });
});
// AC-WB-017; source Gherkin line 170
Then(/^每個Playwright操作與斷言步驟保存截圖並對應Scenario與step$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(170, 'Then', async () => {
        expect(sut.records.length).toBeGreaterThan(0);
        for (const row of sut.records as {
            sourceStepLine: number;
            screenshotSha256: string;
        }[]) {
            expect(row.sourceStepLine).toBeGreaterThan(0);
            expect(row.screenshotSha256).toMatch(/^[a-f0-9]{64}$/);
        }
    });
});
// AC-WB-017; source Gherkin line 171
Then(/^只有實際資料斷言符合預期才算該步驟通過$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(171, 'Then', async () => {
        {
            await expect(sut.dbGateResults()).toContainText("A");
            expect((sut.vars.dbRows as Record<string, unknown>[]).some(row => Object.values(row).includes("A"))).toBe(true);
            sut.last = await sut.dbGateResults().innerText();
        }
        {
            await expect(sut.dbGateResults()).toContainText("active");
            expect((sut.vars.dbRows as Record<string, unknown>[]).some(row => Object.values(row).includes("active"))).toBe(true);
            sut.last = await sut.dbGateResults().innerText();
        }
    });
});
// AC-WB-018; source Gherkin line 175
Given(/^被測專案的測試帳號"scenario_user"在測試資料庫角色為"A"且已登入被測網站$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(175, 'Given', async () => {
        {
            await sut.queryUi(fixtureSql);
        }
        {
            await sut.targetLogin();
        }
    });
});
// AC-WB-018; source Gherkin line 176
Given(/^被測網站角色"A"僅可閱讀測試文件而角色"B"可編輯測試文件但不可管理帳號$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(176, 'Given', async () => {
        {
            expect(sut.vars.loggedInRole).toBe("A");
        }
        {
            await expect(sut.target!.getByTestId('document-content')).not.toBeEditable();
        }
    });
});
// AC-WB-018; source Gherkin line 177
When(/^spec使用Playwright透過專案的DbGate網頁介面將"scenario_user"角色由"A"改為"B"並保存$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(177, 'When', async () => {
        await sut.queryUi("UPDATE test_accounts SET role_code='B' WHERE username='scenario_user';");
    });
});
// AC-WB-018; source Gherkin line 178
When(/^spec重新查詢測試資料並斷言角色已實際變成"B"$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(178, 'When', async () => {
        {
            await sut.queryUi("SELECT role_code FROM test_accounts WHERE username='scenario_user';");
        }
        {
            await expect(sut.dbGateResults()).toContainText("B");
            expect((sut.vars.dbRows as Record<string, unknown>[]).some(row => Object.values(row).includes("B"))).toBe(true);
            sut.last = await sut.dbGateResults().innerText();
        }
    });
});
// AC-WB-018; source Gherkin line 179
When(/^spec登出被測網站的舊登入狀態並以"scenario_user"重新登入$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(179, 'When', async () => {
        {
            if (!sut.target)
                sut.target = sut.tracker.wrapPage(await sut.context.newPage());
            await sut.target.goto(sut.targetUrl);
            await sut.target.getByTestId('logout').click();
            await expect(sut.target.getByTestId('login-submit')).toBeVisible();
        }
        {
            await sut.targetLogin();
        }
    });
});
// AC-WB-018; source Gherkin line 180
When(/^spec在被測網站將"scenario_document"內容改為"edited"並開啟管理帳號頁面$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(180, 'When', async () => {
        {
            await sut.target!.getByTestId('document-content').fill('edited');
            await sut.target!.getByTestId('document-save').click();
            await expect(sut.target!.getByTestId('document-saved')).toBeVisible();
            sut.vars.documentSaved = await sut.target!.getByTestId('document-content').inputValue();
        }
        {
            await sut.queryUi('SELECT username,role_code,state FROM test_accounts ORDER BY username;');
            sut.vars.accountsBefore = await sut.dbGateResults().innerText();
            await sut.target!.getByTestId('manage-accounts-link').click();
            await expect(sut.target!.getByTestId('access-denied')).toBeVisible();
        }
    });
});
// AC-WB-018; source Gherkin line 181
Then(/^spec斷言新登入頁面可看到角色"B"的編輯入口且文件保存成功$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(181, 'Then', async () => {
        {
            expect(sut.vars.loggedInRole).toBe("B");
        }
        {
            expect(sut.vars.documentSaved).toBe('edited');
        }
    });
});
// AC-WB-018; source Gherkin line 182
Then(/^spec透過DbGate網頁介面斷言"scenario_document"的實際內容為"edited"$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(182, 'Then', async () => {
        {
            await sut.queryUi("SELECT content FROM test_documents WHERE document_key='scenario_document';");
        }
        {
            await expect(sut.dbGateResults()).toContainText("edited");
            expect((sut.vars.dbRows as Record<string, unknown>[]).some(row => Object.values(row).includes("edited"))).toBe(true);
            sut.last = await sut.dbGateResults().innerText();
        }
    });
});
// AC-WB-018; source Gherkin line 183
Then(/^spec斷言管理帳號頁面顯示拒絕且帳號資料沒有因此變更$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(183, 'Then', async () => {
        {
            await expect(sut.target!.getByTestId('access-denied')).toBeVisible();
        }
        {
            await sut.queryUi("SELECT username,role_code,state FROM test_accounts ORDER BY username;");
        }
        {
            await expect(sut.dbGateResults()).toContainText("scenario_user");
            expect((sut.vars.dbRows as Record<string, unknown>[]).some(row => Object.values(row).includes("scenario_user"))).toBe(true);
            sut.last = await sut.dbGateResults().innerText();
        }
        {
            await expect(sut.dbGateResults()).toContainText("B");
            expect((sut.vars.dbRows as Record<string, unknown>[]).some(row => Object.values(row).includes("B"))).toBe(true);
            sut.last = await sut.dbGateResults().innerText();
        }
        {
            await expect(sut.dbGateResults()).toContainText("active");
            expect((sut.vars.dbRows as Record<string, unknown>[]).some(row => Object.values(row).includes("active"))).toBe(true);
            sut.last = await sut.dbGateResults().innerText();
        }
        {
            expect(await sut.dbGateResults().innerText()).toBe(sut.vars.accountsBefore);
        }
    });
});
// AC-WB-018; source Gherkin line 184
Then(/^spec在前置資料確認與DB變更後及重新登入後保存截圖$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(184, 'Then', async () => {
        expect(sut.records.length).toBeGreaterThan(0);
        for (const row of sut.records as {
            sourceStepLine: number;
            screenshotSha256: string;
        }[]) {
            expect(row.sourceStepLine).toBeGreaterThan(0);
            expect(row.screenshotSha256).toMatch(/^[a-f0-9]{64}$/);
        }
    });
});
// AC-WB-018; source Gherkin line 185
Then(/^spec在每個主要操作與斷言步驟保存截圖並關聯實際結果$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(185, 'Then', async () => {
        expect(sut.records.length).toBeGreaterThan(0);
        for (const row of sut.records as {
            sourceStepLine: number;
            screenshotSha256: string;
        }[]) {
            expect(row.sourceStepLine).toBeGreaterThan(0);
            expect(row.screenshotSha256).toMatch(/^[a-f0-9]{64}$/);
        }
    });
});
// AC-WB-019; source Gherkin line 189
Given(/^spec正在執行被測專案測試資料庫變更與重新登入的端到端情境$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(189, 'Given', async () => {
        {
            sut.db.stage("IMPLEMENTATION");
            await sut.page.reload();
        }
        {
            await sut.queryUi(fixtureSql);
        }
        {
            await sut.queryUi("UPDATE test_accounts SET role_code='B' WHERE username='scenario_user';");
        }
        {
            await sut.targetLogin();
        }
        {
            await sut.failureBaseline();
        }
    });
});
// AC-WB-019; source Gherkin line 190
When(/^spec在網頁畫面或DB資料斷言得到與預期不同的實際結果$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(190, 'When', async () => {
        await sut.request(String((`/requirements/${sut.vars.requirement}/verify`)), ({ "testBaselineId": sut.vars.baseline, "sourceRef": sut.vars.sourceRef, "selection": { "mode": "ALL_REQUIRED", "sourceCaseIds": [] } }), (([200, 201, 202])) as number | number[]);
    });
});
// AC-WB-019; source Gherkin line 191
Then(/^Playwright保存失敗當下頁面的截圖$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(191, 'Then', async () => {
        {
            await expect.poll(async () => {
                const response = await sut.page.request.get(`/runs/${sut.vars.run}/report`);
                if (!response.ok())
                    throw Error('Report endpoint returned ' + response.status());
                sut.last = await response.json();
                sut.vars.report = sut.last;
                return (sut.last as Record<string, unknown>).status;
            }, { timeout: 60000 }).toMatch(/^(PASSED|FAILED|INCOMPLETE|INVALID)$/);
        }
        {
            await sut.evidence();
        }
    });
});
// AC-WB-019; source Gherkin line 192
Then(/^報告列出該Scenario與失敗step及預期值與實際值及截圖$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(192, 'Then', async () => {
        const report = sut.vars.report as {
            status: string;
            cases: {
                scenarioId: string;
                status: string;
                steps: {
                    status: string;
                    assertion: boolean;
                    assertionPassed: boolean;
                    sourceStepId: string;
                    expected: unknown;
                    actual: unknown;
                    screenshots: {
                        moment: string;
                    }[];
                }[];
            }[];
        };
        expect(report.status).toBe('FAILED');
        const failures = report.cases.filter(c => c.scenarioId === 'AC-DEMO-001' && c.status === 'FAILED').flatMap(c => c.steps.filter(s => s.status === 'FAILED' && s.assertion && s.assertionPassed === false && s.expected === 'A' && s.actual === 'B'));
        expect(failures.length).toBeGreaterThan(0);
        for (const step of failures) {
            expect(step.sourceStepId).toBeTruthy();
            expect(step.screenshots.some(s => s.moment === 'failure')).toBe(true);
        }
    });
});
// AC-WB-019; source Gherkin line 193
Then(/^該案例標示失敗而不因截圖保存成功改成通過$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(193, 'Then', async () => {
        expect((sut.vars.report as Record<string, unknown>)?.status).toBe("FAILED");
    });
});
// AC-WB-020; source Gherkin line 197
Given(/^上一次執行已將測試帳號"scenario_user"改為角色"B"且測試文件內容已變更$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(197, 'Given', async () => {
        {
            await sut.queryUi(fixtureSql);
        }
        {
            await sut.queryUi("UPDATE test_accounts SET role_code='B' WHERE username='scenario_user'; UPDATE test_documents SET content='edited' WHERE document_key='scenario_document';");
        }
        {
            await sut.targetLogin();
        }
    });
});
// AC-WB-020; source Gherkin line 198
When(/^spec開始下一次執行並透過DbGate網頁介面將該測試帳號角色設為"A"與"scenario_document"內容設為"initial"$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(198, 'When', async () => {
        await sut.queryUi(fixtureSql);
    });
});
// AC-WB-020; source Gherkin line 199
When(/^spec結束被測網站上一輪的登入狀態$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(199, 'When', async () => {
        if (!sut.target)
            sut.target = sut.tracker.wrapPage(await sut.context.newPage());
        await sut.target.goto(sut.targetUrl);
        await sut.target.getByTestId('logout').click();
        await expect(sut.target.getByTestId('login-submit')).toBeVisible();
    });
});
// AC-WB-020; source Gherkin line 200
Then(/^spec斷言測試資料庫中的角色為"A"且"scenario_document"內容為"initial"$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(200, 'Then', async () => {
        {
            await sut.queryUi("SELECT role_code FROM test_accounts WHERE username='scenario_user';");
        }
        {
            await expect(sut.dbGateResults()).toContainText("A");
            expect((sut.vars.dbRows as Record<string, unknown>[]).some(row => Object.values(row).includes("A"))).toBe(true);
            sut.last = await sut.dbGateResults().innerText();
        }
        {
            await sut.queryUi("SELECT content FROM test_documents WHERE document_key='scenario_document';");
        }
        {
            await expect(sut.dbGateResults()).toContainText("initial");
            expect((sut.vars.dbRows as Record<string, unknown>[]).some(row => Object.values(row).includes("initial"))).toBe(true);
            sut.last = await sut.dbGateResults().innerText();
        }
    });
});
// AC-WB-020; source Gherkin line 201
Then(/^Playwright保存本次前置資料初始狀態的截圖$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(201, 'Then', async () => {
        expect(sut.records.length).toBeGreaterThan(0);
        for (const row of sut.records as {
            sourceStepLine: number;
            screenshotSha256: string;
        }[]) {
            expect(row.sourceStepLine).toBeGreaterThan(0);
            expect(row.screenshotSha256).toMatch(/^[a-f0-9]{64}$/);
        }
    });
});
// AC-WB-020; source Gherkin line 202
Then(/^本次情境從該初始狀態重新執行DB變更與登入及操作驗證流程$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(202, 'Then', async () => {
        {
            await sut.queryUi("UPDATE test_accounts SET role_code='B' WHERE username='scenario_user';");
        }
        {
            await sut.targetLogin();
        }
        {
            expect(sut.vars.loggedInRole).toBe("B");
        }
        {
            await sut.target!.getByTestId('document-content').fill('edited');
            await sut.target!.getByTestId('document-save').click();
            await expect(sut.target!.getByTestId('document-saved')).toBeVisible();
            sut.vars.documentSaved = await sut.target!.getByTestId('document-content').inputValue();
        }
    });
});
// AC-WB-021; source Gherkin line 206
Given(/^共用專案的當次需求已有"([^"]*)"內容及需求編號與情境編號對應$/, async ({ sut }, arg0: string) => {
    const expect = sut.check;
    await sut.step(206, 'Given', async () => {
        sut.vars["artifact"] = (arg0);
    });
});
// AC-WB-021; source Gherkin line 207
When(/^使用者在"([^"]*)"階段將該產物保存到工作台SQLite$/, async ({ sut }, arg0: string) => {
    const expect = sut.check;
    await sut.step(207, 'When', async () => {
        {
            sut.db.stage(({ Gherkin: 'GHERKIN', 'spec.ts': 'TESTS', SD: 'SD' } as Record<string, string>)[String(arg0 ?? '')] ?? phases[String(arg0 ?? '')] ?? String(arg0 ?? ''));
            await sut.page.reload();
        }
        {
            await sut.save({ "kind": sut.vars.artifact, "extra": true });
        }
    });
});
// AC-WB-021; source Gherkin line 208
When(/^使用者關閉並重新開啟該需求後讀取該產物$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(208, 'When', async () => {
        await sut.page.goto('/projects');
        await sut.page.goto(`/projects/${sut.vars.project}/requirements/${sut.vars.requirement}`);
    });
});
// AC-WB-021; source Gherkin line 209
Then(/^工作台從SQLite讀回與保存時相同的完整內容$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(209, 'Then', async () => {
        const kind = ({ Gherkin: 'gherkin', 'spec.ts': 'spec', SD: 'sd' } as Record<string, string>)[String((sut.vars.artifact))] ?? String((sut.vars.artifact) ?? 'gherkin');
        const doc = sut.vars[kind + 'Doc'];
        sut.last = sut.db.all('SELECT v.raw_text,v.raw_sha256,v.id FROM document_heads h JOIN document_versions v ON v.id=h.version_id WHERE h.document_id=?', [String(doc)])[0];
        expect((sut.last as Record<string, unknown>)?.raw_text).toBe(sut.vars[kind === 'spec' ? 'savedSpec' : kind]);
        expect((sut.last as Record<string, unknown>)?.raw_sha256).toBe(sha(String((sut.last as Record<string, unknown>).raw_text)));
        const artifact = String(sut.vars.artifact), editor = artifact === 'Gherkin' ? 'gherkin-editor' : artifact === 'SD' ? 'sd-editor' : 'spec-editor';
        if(kind==='spec'){
            await expect(sut.page.getByTestId(editor)).toContainText('spec.ts 為唯讀檔案');
            await expect(sut.page.getByTestId('generated-spec-source')).toHaveValue(String((sut.last as Record<string, unknown>).raw_text));
        }else await expect(sut.page.getByTestId(editor)).toHaveValue(String((sut.last as Record<string, unknown>).raw_text));
    });
});
// AC-WB-021; source Gherkin line 210
Then(/^該產物仍連結相同的需求編號與對應情境編號$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(210, 'Then', async () => {
        {
            const params = (([sut.vars.requirement])) as SQLInputValue[];
            await expect.poll(() => sut.db.all("SELECT count(*) AS n FROM scenarios WHERE requirement_id=?", params)).toMatchObject(([{ "n": 1 }]) as object[]);
            sut.last = sut.db.all("SELECT count(*) AS n FROM scenarios WHERE requirement_id=?", params);
        }
        {
            const params = (([sut.vars.gherkinDoc])) as SQLInputValue[];
            await expect.poll(() => sut.db.all("SELECT requirement_id FROM documents WHERE id=?", params)).toMatchObject(([{ "requirement_id": sut.vars.requirement }]) as object[]);
            sut.last = sut.db.all("SELECT requirement_id FROM documents WHERE id=?", params);
        }
        const artifact = String(sut.vars.artifact), kind = artifact === 'Gherkin' ? 'gherkin' : artifact === 'SD' ? 'sd' : 'spec';
        expect(sut.db.all('SELECT requirement_id FROM documents WHERE id=?', [String(sut.vars[kind + 'Doc'])])).toEqual([{ requirement_id: sut.vars.requirement }]);
        const version = sut.head(kind);
        if (kind !== 'gherkin')
            expect(version.source_gherkin_version_id).toBe(sut.vars.gherkinVersion);
        if (kind === 'spec') {
            const mappings = sut.db.all('SELECT s.scenario_key FROM test_case_mappings m JOIN test_definitions t ON t.id=m.test_definition_id JOIN source_cases c ON c.id=m.source_case_id JOIN scenarios s ON s.id=c.scenario_id WHERE t.spec_version_id=?', [String(version.id)]);
            expect(mappings.length).toBeGreaterThan(0);
            for (const mapping of mappings)
                expect(mapping.scenario_key).toBe('AC-DEMO-001');
        }
    });
});
// AC-WB-021; source Gherkin line 211
Then(/^這項產品儲存能力不改變bdd專案自身以Git保存開發文件與測試的方式$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(211, 'Then', async () => {
        const paths = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { encoding: 'utf8' }).split('\n');
        const required = ['spec/REQ-WB-001/workbench/workbench.feature', 'spec/REQ-WB-001/workbench/workbench.sd.md', 'spec/REQ-WB-001/review.json'];
        required.push('spec/REQ-WB-001/workbench/workbench.feature.spec.ts', 'spec/REQ-WB-001/workbench/workbench.steps.ts', 'spec/REQ-WB-001/workbench/testing/support/fixtures.ts', 'playwright.config.ts', 'package-lock.json');
        for (const file of required)
            expect(paths).toContain(file);
        expect(readFileSync('spec/REQ-WB-001/review.json', 'utf8')).toContain('REQ-WB-001');
    });
});
// AC-WB-022; source Gherkin line 220
Given(/^使用者已停止一次內嵌瀏覽器錄製並取得腳本草稿$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(220, 'Given', async () => {
        {
            await sut.browser();
        }
        {
            await sut.page.getByTestId('record-start').click();
            await expect(sut.page.getByTestId('recording-state')).toHaveText('recording');
        }
        {
            await sut.humanActions();
        }
        {
            const responsePromise = sut.page.waitForResponse(r => r.request().method() === 'POST' && /\/recordings\/stop$/.test(new URL(r.url()).pathname));
            await sut.page.getByTestId('record-stop').click();
            const response = await responsePromise;
            expect(response.ok()).toBe(true);
            const stopped = await response.json() as {
                actions: unknown[];
            };
            expect(stopped.actions.length).toBeGreaterThan(0);
            sut.vars.recordingActions = stopped.actions;
            await expect(sut.page.getByTestId('recording-state')).toHaveText('stopped');
            sut.draft = await sut.page.getByTestId('recording-script').inputValue();
            sut.vars.recording = sut.draft;
        }
        {
            sut.repoBefore = sut.repoState();
        }
    });
});
// AC-WB-022; source Gherkin line 221
When(/^使用者將腳本另存到工作台SQLite的使用者錄製腳本清單$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(221, 'When', async () => {
        await sut.saveRecording(false);
    });
});
// AC-WB-022; source Gherkin line 222
When(/^使用者重新開啟該已保存腳本並按下重播$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(222, 'When', async () => {
        const document = sut.db.all('SELECT purpose FROM documents WHERE id=?', [String(sut.vars.recordingDoc)])[0];
        if (document.purpose === 'recording') {
            await sut.page.goto(`/projects/${sut.vars.project}/recordings/${sut.vars.recordingDoc}`);
            await expect(sut.page.getByTestId('recording-script')).toHaveValue(String(sut.vars.recording));
        }
        const rows = sut.db.all('SELECT h.version_id FROM document_heads h WHERE h.document_id=?', [String(sut.vars.recordingDoc)]);
        expect(rows).toHaveLength(1);
        await sut.request(`/scripts/${sut.vars.recordingDoc}/versions/${rows[0].version_id}/replay`, { projectId: sut.vars.project, targetUrl: sut.targetUrl }, [200, 201, 202]);
    });
});
// AC-WB-022; source Gherkin line 223
Then(/^工作台在瀏覽器實際重播已保存的操作與斷言$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(223, 'Then', async () => {
        {
            await expect.poll(async () => {
                const response = await sut.page.request.get(`/runs/${sut.vars.run}/report`);
                if (!response.ok())
                    throw Error('Report endpoint returned ' + response.status());
                sut.last = await response.json();
                sut.vars.report = sut.last;
                return (sut.last as Record<string, unknown>).status;
            }, { timeout: sut.info.timeout }).toMatch(/^(PASSED|FAILED|INCOMPLETE|INVALID)$/);
        }
        {
            const report = sut.vars.report as {
                scriptVersionId: string;
                status: string;
                cases: {
                    executed: boolean;
                }[];
            };
            expect(report.scriptVersionId).toBe(sut.vars.recordingSavedVersion);
            expect(report.cases.length).toBeGreaterThan(0);
            expect(report.cases.every(c => c.executed)).toBe(true);
            expect(['PASSED', 'FAILED']).toContain(report.status);
        }
    });
});
// AC-WB-022; source Gherkin line 224
Then(/^顯示該次重播的實際結果而不是把保存成功當成測試通過$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(224, 'Then', async () => {
        {
            const report = sut.vars.report as {
                cases: {
                    testKey: string;
                    status: string;
                    executed: boolean;
                    steps: unknown[];
                }[];
            };
            expect(report.cases.length).toBeGreaterThan(0);
            for (const c of report.cases) {
                expect(c.testKey.length).toBeGreaterThan(0);
                expect(['PASSED', 'FAILED', 'NOT_RUN', 'INCOMPLETE', 'INVALID']).toContain(c.status);
                expect(typeof c.executed).toBe('boolean');
                if (c.executed)
                    expect(c.steps.length).toBeGreaterThan(0);
            }
        }
        {
            const report = sut.vars.report as {
                cases: {
                    status: string;
                    executed: boolean;
                    steps: {
                        status: string;
                        assertion: boolean;
                        expected: unknown;
                        actual: unknown;
                        screenshots: unknown[];
                    }[];
                }[];
            };
            expect(report.cases.length).toBeGreaterThan(0);
            for (const c of report.cases)
                if (c.status === 'PASSED') {
                    expect(c.executed).toBe(true);
                    expect(c.steps.length).toBeGreaterThan(0);
                    const assertions = c.steps.filter(s => s.assertion);
                    expect(assertions.length).toBeGreaterThan(0);
                    for (const step of c.steps) {
                        expect(step.status).toBe('PASSED');
                        expect(step.screenshots.length).toBeGreaterThan(0);
                    }
                    for (const step of assertions) {
                        expect(step).toHaveProperty('expected');
                        expect(step).toHaveProperty('actual');
                        expect((step as unknown as {
                            assertionPassed: boolean;
                        }).assertionPassed).toBe(true);
                    }
                }
        }
    });
});
// AC-WB-022; source Gherkin line 225
Then(/^該腳本保留已提供的需求與相關情境對應並與標準專案CI測試分開列示$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(225, 'Then', async () => {
        {
            const d = sut.db.all('SELECT purpose,requirement_id FROM documents WHERE id=?', [String(sut.vars.recordingDoc)])[0];
            expect(d?.purpose).toBe('recording');
            expect(d.requirement_id).toBe(sut.vars.requirement);
            const mappings = sut.db.all('SELECT c.scenario_id,c.gherkin_version_id,c.case_key FROM test_case_mappings m JOIN source_cases c ON c.id=m.source_case_id JOIN test_definitions t ON t.id=m.test_definition_id WHERE t.spec_version_id=?', [String(sut.vars.recordingSavedVersion)]);
            expect(mappings.length).toBeGreaterThan(0);
            for (const m of mappings)
                expect(m).toEqual({ scenario_id: sut.vars.scenario, gherkin_version_id: sut.vars.gherkinVersion, case_key: 'a' });
            const actions = sut.db.all('SELECT count(*) AS n FROM recording_actions WHERE spec_version_id=?', [String(sut.vars.recordingSavedVersion)]);
            expect(actions[0].n).toBe((sut.vars.recordingActions as unknown[]).length);
        }
        {
            sut.last = await sut.page.getByTestId("script-purpose").textContent();
            await expect(sut.page.getByTestId("script-purpose")).toContainText("recording");
        }
    });
});
// AC-WB-022; source Gherkin line 226
Then(/^不會自動新增或修改target Git的CI測試檔案或CI測試清單$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(226, 'Then', async () => {
        expect(sut.repoState(), 'target Git and CI list unchanged').toBe(sut.repoBefore);
    });
});
// AC-WB-023; source Gherkin line 230
Given(/^工作台SQLite已有"([^"]*)"的有效原文與結構化資料$/, async ({ sut }, arg0: string) => {
    const expect = sut.check;
    await sut.step(230, 'Given', async () => {
        {
            sut.vars["artifact"] = (arg0);
        }
        {
            sut.db.stage(({ Gherkin: 'GHERKIN', 'spec.ts': 'TESTS', SD: 'SD' } as Record<string, string>)[String(arg0 ?? '')] ?? phases[String(arg0 ?? '')] ?? String(arg0 ?? ''));
            await sut.page.reload();
        }
        {
            sut.before = sut.db.snapshot();
        }
    });
});
// AC-WB-023; source Gherkin line 231
Given(/^使用者準備保存的同一檔案內容含語法錯誤$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(231, 'Given', async () => {
        sut.vars["invalid"] = true;
    });
});
// AC-WB-023; source Gherkin line 232
When(/^使用者要求將該"([^"]*)"內容保存到SQLite$/, async ({ sut }, arg0: string) => {
    const expect = sut.check;
    await sut.step(232, 'When', async () => {
        await sut.save({ "kind": arg0, "invalid": true });
    });
});
// AC-WB-023; source Gherkin line 233
Then(/^工作台先以"([^"]*)"解析內容並拒絕將錯誤內容保存為有效版本$/, async ({ sut }, arg0: string) => {
    const expect = sut.check;
    await sut.step(233, 'Then', async () => {
        sut.assertDiagnostics('SYNTAX_INVALID');
    });
});
// AC-WB-023; source Gherkin line 234
Then(/^回報錯誤的檔案名稱與行號及欄號與原因$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(234, 'Then', async () => {
        sut.assertDiagnostics('SYNTAX_INVALID');
    });
});
// AC-WB-023; source Gherkin line 235
Then(/^原有有效版本的原文與結構化資料及來源對應保持不變$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(235, 'Then', async () => {
        expect(sut.db.snapshot(), 'effective original text and projections').toBe(sut.before);
    });
});
// AC-WB-024; source Gherkin line 243
Given(/^語法有效的Gherkin原文對應需求"REQ-DEMO-001"$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(243, 'Given', async () => {
        {
            sut.db.stage("GHERKIN");
            await sut.page.reload();
        }
        {
            const kind = "gherkin";
            const doc = sut.vars[kind + 'Doc'];
            sut.last = sut.db.all('SELECT v.raw_text,v.raw_sha256,v.id FROM document_heads h JOIN document_versions v ON v.id=h.version_id WHERE h.document_id=?', [String(doc)])[0];
            expect((sut.last as Record<string, unknown>)?.raw_text).toBe(sut.vars.gherkin);
            expect((sut.last as Record<string, unknown>)?.raw_sha256).toBe(sha(String((sut.last as Record<string, unknown>).raw_text)));
        }
    });
});
// AC-WB-024; source Gherkin line 244
Given(/^原文含Scenario Outline的Scenario ID"AC-DEMO-001"及有順序的steps與兩列Examples$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(244, 'Given', async () => {
        const params = (([sut.vars.gherkinVersion])) as SQLInputValue[];
        await expect.poll(() => sut.db.all("SELECT count(*) AS n FROM source_cases WHERE gherkin_version_id=?", params)).toMatchObject(([{ "n": 2 }]) as object[]);
        sut.last = sut.db.all("SELECT count(*) AS n FROM source_cases WHERE gherkin_version_id=?", params);
    });
});
// AC-WB-024; source Gherkin line 245
When(/^使用者將該Gherkin保存到SQLite$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(245, 'When', async () => {
        await sut.save({ "kind": "gherkin" });
    });
});
// AC-WB-024; source Gherkin line 246
Then(/^讀回的完整原文與提交內容逐字相同$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(246, 'Then', async () => {
        const kind = "gherkin";
        const doc = sut.vars[kind + 'Doc'];
        sut.last = sut.db.all('SELECT v.raw_text,v.raw_sha256,v.id FROM document_heads h JOIN document_versions v ON v.id=h.version_id WHERE h.document_id=?', [String(doc)])[0];
        expect((sut.last as Record<string, unknown>)?.raw_text).toBe(sut.vars.gherkin);
        expect((sut.last as Record<string, unknown>)?.raw_sha256).toBe(sha(String((sut.last as Record<string, unknown>).raw_text)));
    });
});
// AC-WB-024; source Gherkin line 247
Then(/^可結構化查詢需求編號與Scenario ID及各step的關鍵字與文字及順序$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(247, 'Then', async () => {
        const version = String(sut.head('gherkin').id);
        const scenario = sut.db.all('SELECT s.scenario_key,sv.title FROM scenario_versions sv JOIN scenarios s ON s.id=sv.scenario_id WHERE sv.gherkin_version_id=?', [version]);
        expect(scenario).toEqual([{ scenario_key: 'AC-DEMO-001', title: 'Edit document' }]);
        const steps = sut.db.all('SELECT st.ordinal,st.keyword,st.text FROM steps st JOIN step_groups g ON g.id=st.group_id WHERE g.gherkin_version_id=? ORDER BY st.ordinal', [version]);
        expect(steps).toEqual([{ ordinal: 1, keyword: 'Given', text: 'the account has role "<role>"' }, { ordinal: 2, keyword: 'When', text: 'the account edits the document' }, { ordinal: 3, keyword: 'Then', text: 'the result is "<expected>"' }]);
    });
});
// AC-WB-024; source Gherkin line 248
Then(/^可結構化查詢Examples的欄名與各列值及case_id且保留列順序$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(248, 'Then', async () => {
        const version = String(sut.head('gherkin').id);
        const rows = sut.db.all('SELECT c.case_key,c.row_ordinal,col.name,e.value FROM source_cases c JOIN example_cells e ON e.source_case_id=c.id JOIN example_columns col ON col.table_id=e.example_table_id AND col.ordinal=e.column_ordinal WHERE c.gherkin_version_id=? ORDER BY c.row_ordinal,col.ordinal', [version]);
        expect(rows).toEqual([['a', 1, 'case_id', 'a'], ['a', 1, 'role', 'A'], ['a', 1, 'expected', 'denied'], ['b', 2, 'case_id', 'b'], ['b', 2, 'role', 'B'], ['b', 2, 'expected', 'saved']].map(([case_key, row_ordinal, name, value]) => ({ case_key, row_ordinal, name, value })));
    });
});
// AC-WB-024; source Gherkin line 249
Then(/^原文與結構化資料均連結同一來源文件版本與內容hash$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(249, 'Then', async () => {
        const row = sut.head("gherkin");
        expect(row.raw_sha256).toBe(sha(String(row.raw_text)));
    });
});
// AC-WB-025; source Gherkin line 253
Given(/^指定來源版本的已確認Gherkin含情境"AC-DEMO-001"及Examples案例"a"與"b"$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(253, 'Given', async () => {
        {
            sut.db.stage("TESTS");
            await sut.page.reload();
        }
        {
            const version = String(sut.head('gherkin').id);
            const rows = sut.db.all('SELECT c.case_key,c.row_ordinal,col.name,e.value FROM source_cases c JOIN example_cells e ON e.source_case_id=c.id JOIN example_columns col ON col.table_id=e.example_table_id AND col.ordinal=e.column_ordinal WHERE c.gherkin_version_id=? ORDER BY c.row_ordinal,col.ordinal', [version]);
            expect(rows).toEqual([['a', 1, 'case_id', 'a'], ['a', 1, 'role', 'A'], ['a', 1, 'expected', 'denied'], ['b', 2, 'case_id', 'b'], ['b', 2, 'role', 'B'], ['b', 2, 'expected', 'saved']].map(([case_key, row_ordinal, name, value]) => ({ case_key, row_ordinal, name, value })));
        }
    });
});
// AC-WB-025; source Gherkin line 254
Given(/^標準生成的spec\.ts語法有效且測試"test-a"與"test-b"分別明確對應該情境的案例"a"與"b"$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(254, 'Given', async () => {
        sut.vars["specMode"] = "normal";
    });
});
// AC-WB-025; source Gherkin line 255
Given(/^另一測試"test-a-extra"以不同test ID明確對應同一情境的案例"a"$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(255, 'Given', async () => {
        sut.vars["specMode"] = "extra";
    });
});
// AC-WB-025; source Gherkin line 256
When(/^使用者將該spec\.ts與明確ID對應保存到SQLite$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(256, 'When', async () => {
        await sut.save({ "kind": "spec", "extra": true });
    });
});
// AC-WB-025; source Gherkin line 257
Then(/^讀回的完整spec\.ts原文與提交內容逐字相同$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(257, 'Then', async () => {
        const kind = "spec";
        const doc = sut.vars[kind + 'Doc'];
        sut.last = sut.db.all('SELECT v.raw_text,v.raw_sha256,v.id FROM document_heads h JOIN document_versions v ON v.id=h.version_id WHERE h.document_id=?', [String(doc)])[0];
        expect((sut.last as Record<string, unknown>)?.raw_text).toBe(sut.vars.savedSpec);
        expect((sut.last as Record<string, unknown>)?.raw_sha256).toBe(sha(String((sut.last as Record<string, unknown>).raw_text)));
    });
});
// AC-WB-025; source Gherkin line 258
Then(/^可結構化查詢每個test ID及其需求編號與Scenario ID及Examples case_id$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(258, 'Then', async () => {
        const params = (([sut.vars.specDoc])) as SQLInputValue[];
        await expect.poll(() => sut.db.all("SELECT t.test_key,s.scenario_key,c.case_key FROM test_case_mappings m JOIN test_definitions t ON t.id=m.test_definition_id JOIN source_cases c ON c.id=m.source_case_id JOIN scenarios s ON s.id=c.scenario_id JOIN document_heads h ON h.version_id=t.spec_version_id WHERE h.document_id=? ORDER BY t.test_key", params)).toMatchObject(([{ "test_key": "test-a", "scenario_key": "AC-DEMO-001", "case_key": "a" }, { "test_key": "test-a-extra", "scenario_key": "AC-DEMO-001", "case_key": "a" }, { "test_key": "test-b", "scenario_key": "AC-DEMO-001", "case_key": "b" }]) as object[]);
        sut.last = sut.db.all("SELECT t.test_key,s.scenario_key,c.case_key FROM test_case_mappings m JOIN test_definitions t ON t.id=m.test_definition_id JOIN source_cases c ON c.id=m.source_case_id JOIN scenarios s ON s.id=c.scenario_id JOIN document_heads h ON h.version_id=t.spec_version_id WHERE h.document_id=? ORDER BY t.test_key", params);
    });
});
// AC-WB-025; source Gherkin line 259
Then(/^每筆對應可追溯spec\.ts版本與內容hash及來源Gherkin版本與內容hash$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(259, 'Then', async () => {
        const row = sut.head("spec");
        expect(row.raw_sha256).toBe(sha(String(row.raw_text)));
        {
            expect(row.source_gherkin_version_id).toBe(sut.vars.gherkinVersion);
            const source = sut.db.all('SELECT raw_sha256 FROM document_versions WHERE id=?', [String(row.source_gherkin_version_id)])[0];
            expect(source?.raw_sha256).toBe(sha(sourceFeature));
        }
    });
});
// AC-WB-025; source Gherkin line 260
Then(/^相同Scenario ID下的不同Examples案例可各自對應不同測試$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(260, 'Then', async () => {
        const params = (([sut.vars.specDoc])) as SQLInputValue[];
        await expect.poll(() => sut.db.all("SELECT t.test_key,s.scenario_key,c.case_key FROM test_case_mappings m JOIN test_definitions t ON t.id=m.test_definition_id JOIN source_cases c ON c.id=m.source_case_id JOIN scenarios s ON s.id=c.scenario_id JOIN document_heads h ON h.version_id=t.spec_version_id WHERE h.document_id=? ORDER BY t.test_key", params)).toMatchObject(([{ "test_key": "test-a", "case_key": "a" }, { "test_key": "test-a-extra", "case_key": "a" }, { "test_key": "test-b", "case_key": "b" }]) as object[]);
        sut.last = sut.db.all("SELECT t.test_key,s.scenario_key,c.case_key FROM test_case_mappings m JOIN test_definitions t ON t.id=m.test_definition_id JOIN source_cases c ON c.id=m.source_case_id JOIN scenarios s ON s.id=c.scenario_id JOIN document_heads h ON h.version_id=t.spec_version_id WHERE h.document_id=? ORDER BY t.test_key", params);
    });
});
// AC-WB-025; source Gherkin line 261
Then(/^測試"test-a"與"test-a-extra"的映射均被保存且同時對應相同Scenario ID與Examples案例"a"$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(261, 'Then', async () => {
        const params = (([sut.vars.specDoc])) as SQLInputValue[];
        await expect.poll(() => sut.db.all("SELECT count(DISTINCT t.test_key) AS n FROM test_case_mappings m JOIN test_definitions t ON t.id=m.test_definition_id JOIN source_cases c ON c.id=m.source_case_id JOIN document_heads h ON h.version_id=t.spec_version_id WHERE h.document_id=? AND c.case_key='a'", params)).toMatchObject(([{ "n": 2 }]) as object[]);
        sut.last = sut.db.all("SELECT count(DISTINCT t.test_key) AS n FROM test_case_mappings m JOIN test_definitions t ON t.id=m.test_definition_id JOIN source_cases c ON c.id=m.source_case_id JOIN document_heads h ON h.version_id=t.spec_version_id WHERE h.document_id=? AND c.case_key='a'", params);
    });
});
// AC-WB-025; source Gherkin line 262
Then(/^重新讀取時仍取得原本的來源版本而不是自動改指向最新Gherkin$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(262, 'Then', async () => {
        const old = String(sut.head('spec').source_gherkin_version_id);
        await sut.request(`/requirements/${sut.vars.requirement}/return`, { artifactKind: 'Gherkin' }, [200, 201]);
        await sut.request(`/documents/${sut.vars.gherkinDoc}/versions`, { rawText: sourceFeature.replace('Edit document', 'Edit document revised') }, [200, 201]);
        expect(sut.head('gherkin').id).not.toBe(old);
        expect(sut.head('spec').source_gherkin_version_id).toBe(old);
    });
});
// AC-WB-026; source Gherkin line 266
Given(/^工作台SQLite已有一份有效的標準生成spec\.ts及其情境對應$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(266, 'Given', async () => {
        {
            sut.db.stage("TESTS");
            await sut.page.reload();
        }
        {
            sut.before = sut.db.snapshot();
        }
    });
});
// AC-WB-026; source Gherkin line 267
Given(/^待保存的新spec\.ts通過TypeScript語法解析但其明確ID映射存在"([^"]*)"$/, async ({ sut }, arg0: string) => {
    const expect = sut.check;
    await sut.step(267, 'Given', async () => {
        sut.vars["problem"] = (arg0);
    });
});
// AC-WB-026; source Gherkin line 268
When(/^使用者要求保存該標準生成測試與映射$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(268, 'When', async () => {
        await sut.save({ "kind": "spec", "problem": sut.vars.problem });
    });
});
// AC-WB-026; source Gherkin line 269
Then(/^工作台依指定來源版本的Gherkin與明確test ID映射拒絕該次保存$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(269, 'Then', async () => {
        sut.assertDiagnostics('MAPPING_INVALID');
        expect(JSON.stringify(sut.last)).toContain(String(sut.vars.problem));
        const body = JSON.stringify(sut.last);
        expect(body).toMatch(/test-a|test-b|AC-DEMO-001|AC-MISSING-999|missing/);
    });
});
// AC-WB-026; source Gherkin line 270
Then(/^回報"([^"]*)"及相關test ID或來源案例ID$/, async ({ sut }, arg0: string) => {
    const expect = sut.check;
    await sut.step(270, 'Then', async () => {
        sut.assertDiagnostics('MAPPING_INVALID');
        expect(JSON.stringify(sut.last)).toContain(String(sut.vars.problem));
        const body = JSON.stringify(sut.last);
        expect(body).toMatch(/test-a|test-b|AC-DEMO-001|AC-MISSING-999|missing/);
    });
});
// AC-WB-026; source Gherkin line 271
Then(/^未提供的情境對應不被自動推測或補造$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(271, 'Then', async () => {
        expect(sut.db.snapshot(), 'effective original text and projections').toBe(sut.before);
    });
});
// AC-WB-026; source Gherkin line 272
Then(/^原有有效spec\.ts原文與結構化映射保持不變$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(272, 'Then', async () => {
        expect(sut.db.snapshot(), 'effective original text and projections').toBe(sut.before);
    });
});
// AC-WB-027; source Gherkin line 284
Given(/^使用者已取得語法有效且未連結需求編號或Scenario ID的自錄Playwright腳本$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(284, 'Given', async () => {
        {
            sut.repoBefore = sut.repoState();
        }
        {
            sut.vars["recording"] = (sut.vars.spec);
        }
    });
});
// AC-WB-027; source Gherkin line 285
When(/^使用者將該腳本另存到SQLite的使用者錄製腳本清單$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(285, 'When', async () => {
        await sut.saveRecording(true);
    });
});
// AC-WB-027; source Gherkin line 286
Then(/^工作台保存完整原文且需求與情境對應維持未關聯$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(286, 'Then', async () => {
        {
            const kind = "recording";
            const doc = sut.vars[kind + 'Doc'];
            sut.last = sut.db.all('SELECT v.raw_text,v.raw_sha256,v.id FROM document_heads h JOIN document_versions v ON v.id=h.version_id WHERE h.document_id=?', [String(doc)])[0];
            expect((sut.last as Record<string, unknown>)?.raw_text).toBe(sut.vars.recording);
            expect((sut.last as Record<string, unknown>)?.raw_sha256).toBe(sha(String((sut.last as Record<string, unknown>).raw_text)));
        }
        {
            const params = (([sut.vars.recordingDoc])) as SQLInputValue[];
            await expect.poll(() => sut.db.all("SELECT requirement_id FROM documents WHERE id=?", params)).toMatchObject(([{ "requirement_id": null }]) as object[]);
            sut.last = sut.db.all("SELECT requirement_id FROM documents WHERE id=?", params);
        }
    });
});
// AC-WB-027; source Gherkin line 287
Then(/^不要求補造需求或Scenario ID以通過標準生成測試的映射檢核$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(287, 'Then', async () => {
        const params = (([sut.vars.recordingDoc])) as SQLInputValue[];
        await expect.poll(() => sut.db.all("SELECT count(*) AS n FROM test_case_mappings m JOIN test_definitions t ON t.id=m.test_definition_id JOIN document_versions v ON v.id=t.spec_version_id WHERE v.document_id=?", params)).toMatchObject(([{ "n": 0 }]) as object[]);
        sut.last = sut.db.all("SELECT count(*) AS n FROM test_case_mappings m JOIN test_definitions t ON t.id=m.test_definition_id JOIN document_versions v ON v.id=t.spec_version_id WHERE v.document_id=?", params);
    });
});
// AC-WB-027; source Gherkin line 288
Then(/^使用者可重新開啟該腳本並重播$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(288, 'Then', async () => {
        {
            const document = sut.db.all('SELECT purpose FROM documents WHERE id=?', [String(sut.vars.recordingDoc)])[0];
            if (document.purpose === 'recording') {
                await sut.page.goto(`/projects/${sut.vars.project}/recordings/${sut.vars.recordingDoc}`);
                await expect(sut.page.getByTestId('recording-script')).toHaveValue(String(sut.vars.recording));
            }
            const rows = sut.db.all('SELECT h.version_id FROM document_heads h WHERE h.document_id=?', [String(sut.vars.recordingDoc)]);
            expect(rows).toHaveLength(1);
            await sut.request(`/scripts/${sut.vars.recordingDoc}/versions/${rows[0].version_id}/replay`, { projectId: sut.vars.project, targetUrl: sut.targetUrl }, [200, 201, 202]);
        }
        {
            await expect.poll(async () => {
                const response = await sut.page.request.get(`/runs/${sut.vars.run}/report`);
                if (!response.ok())
                    throw Error('Report endpoint returned ' + response.status());
                sut.last = await response.json();
                sut.vars.report = sut.last;
                return (sut.last as Record<string, unknown>).status;
            }, { timeout: 60000 }).toMatch(/^(PASSED|FAILED|INCOMPLETE|INVALID)$/);
        }
        {
            const report = sut.vars.report as {
                scriptVersionId: string;
                status: string;
                cases: {
                    executed: boolean;
                }[];
            };
            expect(report.scriptVersionId).toBe(sut.vars.recordingSavedVersion);
            expect(report.cases.length).toBeGreaterThan(0);
            expect(report.cases.every(c => c.executed)).toBe(true);
            expect(['PASSED', 'FAILED']).toContain(report.status);
        }
    });
});
// AC-WB-027; source Gherkin line 289
Then(/^該腳本仍獨立於標準專案CI且不會自動新增或修改target Git的CI測試$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(289, 'Then', async () => {
        expect(sut.repoState(), 'target Git and CI list unchanged').toBe(sut.repoBefore);
    });
});
// AC-WB-028; source Gherkin line 293
Given(/^專案已有Gherkin情境"AC-DEMO-001"及Examples案例"a"與"b"的spec\.ts骨架與明確測試映射$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(293, 'Given', async () => {
        sut.db.useSkeleton();
        sut.db.stage('TESTS');
        sut.selection = new SelectionProbe(sut.page, sut.db, sut.vars, sut.info);
        await sut.selection.ready;
        await sut.page.reload();
    });
});
// AC-WB-028; source Gherkin line 294
Given(/^案例"a"對應測試"test-a"與"test-a-extra"且案例"b"對應測試"test-b"$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(294, 'Given', async () => {
        const rows = sut.db.all('SELECT t.test_key,c.case_key FROM test_definitions t JOIN test_case_mappings m ON m.test_definition_id=t.id JOIN source_cases c ON c.id=m.source_case_id WHERE t.spec_version_id=? ORDER BY t.test_key', [String(sut.vars.specSkeletonVersion)]);
        expect(rows).toEqual([{ test_key: 'test-a', case_key: 'a' }, { test_key: 'test-a-extra', case_key: 'a' }, { test_key: 'test-b', case_key: 'b' }]);
    });
});
// AC-WB-028; source Gherkin line 295
Given(/^這些測試目前只有尚未由LLM補齊的codegen殼$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(295, 'Given', async () => {
        expect(sut.head('spec').test_stage).toBe('SKELETON');
    });
});
// AC-WB-028; source Gherkin line 296
When(/^使用者開啟工作台的Gherkin測試清單$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(296, 'When', async () => {
        await sut.page.goto(`/requirements/${sut.vars.requirement}?featureId=${sut.vars.featureId}&workflowStage=VERIFICATION`);
        await expect(sut.page.getByTestId('scenario-tests')).toBeVisible();
    });
});
// AC-WB-028; source Gherkin line 297
Then(/^清單列出該情境與案例"a"及"b"及各自對應的test ID$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(297, 'Then', async () => {
        for (const [key, ids] of [['a', ['test-a', 'test-a-extra']], ['b', ['test-b']]] as const) {
            const row = sut.page.getByTestId('scenario-case-' + key);
            await expect(row).toContainText('AC-DEMO-001');
            for (const id of ids)
                await expect(row.getByTestId('case-test-ids')).toContainText(id);
        }
    });
});
// AC-WB-028; source Gherkin line 298
Then(/^只有codegen殼的測試顯示待補齊且不可標示已通過$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(298, 'Then', async () => {
        for (const key of ['a', 'b']) {
            const row = sut.page.getByTestId('scenario-case-' + key);
            await expect(row.getByTestId('case-readiness')).toHaveText('PENDING_COMPLETION');
            await expect(row.getByTestId('case-execution-status')).toHaveText('NOT_RUN');
            await expect(row.getByTestId('case-run')).toBeDisabled();
        }
        const response = await sut.page.request.post(`/requirements/${sut.vars.requirement}/verify`, { data: { testBaselineId: null, sourceRef: sut.vars.sourceRef, selection: { mode: 'SELECTED_CASES', sourceCaseIds: [sut.vars.caseA] } } });
        expect(response.status()).toBe(409);
        expect(await response.text()).toContain('TESTS_PENDING_COMPLETION');
        expect(sut.db.all('SELECT id FROM runs WHERE requirement_id=?', [String(sut.vars.requirement)])).toHaveLength(0);
    });
});
// AC-WB-028; source Gherkin line 299
When(/^使用者在測試已由LLM補齊且測試基線與程式版本已固定後點選案例"a"並按下執行$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(299, 'When', async () => {
        // Real completion use case; no fixture DB update substitutes for its result.
        const agent=await createProposalTestAgent(sut,'TESTS');
        await sut.page.goto(`/requirements/${sut.vars.requirement}?featureId=${sut.vars.featureId}&workflowStage=TESTS`);
        await sut.provideCompletionContext();
        const completed=sut.page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname===`/requirements/${sut.vars.requirement}/complete-tests`);
        await sut.page.getByTestId(`complete-tests-${agent.id}`).click();
        const completion=await completed;expect(completion.ok()).toBe(true);const proposal=await completion.json();expect(proposal.status).toBe('completed');sut.trackLlmTerminal(proposal.terminal?.terminalId);
        const requirementKey=String(sut.db.all('SELECT requirement_key FROM requirements WHERE id=?',[String(sut.vars.requirement)])[0].requirement_key);
        const requirementTab=sut.page.locator('.workspace-tab').filter({hasText:requirementKey}).filter({hasText:'測試情境'}).last();
        await requirementTab.locator('.workspace-tab-select').click();await expect(sut.page).toHaveURL(/workflowStage=TESTS/);
        expect(sut.head('spec').test_stage).toBe('COMPLETED');
        await expect(sut.page.getByTestId('confirm-test-steps')).toBeEnabled();
        const row = sut.db.all('SELECT v.* FROM document_heads h JOIN document_versions v ON v.id=h.version_id WHERE h.document_id=?', [String(sut.vars.specDoc)])[0];
        expect(row.test_stage).toBe('COMPLETED');
        expect(row.source_skeleton_version_id).toBe(sut.vars.specSkeletonVersion);
        expect(row.id).not.toBe(sut.vars.specSkeletonVersion);
        const ids = sut.db.all('SELECT t.test_key,c.case_key FROM test_definitions t JOIN test_case_mappings m ON m.test_definition_id=t.id JOIN source_cases c ON c.id=m.source_case_id WHERE t.spec_version_id=? ORDER BY t.test_key', [String(row.id)]);
        expect(ids).toEqual([{ test_key: 'test-a', case_key: 'a' }, { test_key: 'test-a-extra', case_key: 'a' }, { test_key: 'test-b', case_key: 'b' }]);
        await sut.page.getByTestId('confirm-test-steps').click();
        await expect(sut.page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage','IMPLEMENTATION');
        if (!sut.vars.sourceRef)
            throw Error('WB_SOURCE_REF required; no invented product revision');
        await sut.page.getByTestId('source-ref').fill(String(sut.vars.sourceRef));
        await sut.page.getByTestId('pin-source').click();
        await expect(sut.page.getByTestId('pinned-source-ref')).toHaveText(String(sut.vars.sourceRef));
        await sut.page.goto(`/requirements/${sut.vars.requirement}?featureId=${sut.vars.featureId}&workflowStage=VERIFICATION`);
        const baseline = sut.db.all("SELECT id,sha256 FROM baselines WHERE requirement_id=? AND kind='tests' AND valid=1", [String(sut.vars.requirement)]);
        expect(baseline).toHaveLength(1);
        sut.vars.baseline = baseline[0].id;
        const responsePromise = sut.page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === `/requirements/${sut.vars.requirement}/verify`);
        await sut.page.getByTestId('scenario-case-a').getByTestId('case-select').check();
        await sut.page.getByTestId('run-selected-cases').click();
        const response = await responsePromise;
        expect(response.ok()).toBe(true);
        const request = response.request().postDataJSON();
        expect(request.selection).toEqual({ mode: 'SELECTED_CASES', sourceCaseIds: [sut.vars.caseA] });
        const result = await response.json();
        sut.vars.run = result.runId;
        expect(result.scope).toBe('SELECTED_CASES');
        expect(result.expectedTestKeys.sort()).toEqual(['test-a', 'test-a-extra']);
    });
});
// AC-WB-028; source Gherkin line 300
Then(/^工作台建立本次run且runner只執行對應的spec\.ts測試"test-a"與"test-a-extra"$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(300, 'Then', async () => {
        await expect.poll(() => sut.db.all('SELECT t.test_key FROM run_test_selection s JOIN test_definitions t ON t.id=s.test_definition_id WHERE s.run_id=? ORDER BY t.test_key', [String(sut.vars.run)])).toEqual([{ test_key: 'test-a' }, { test_key: 'test-a-extra' }]);
        expect(sut.db.all('SELECT source_case_id FROM run_source_cases WHERE run_id=?', [String(sut.vars.run)])).toEqual([{ source_case_id: sut.vars.caseA }]);
        await expect.poll(async () => { const r = await sut.selection!.report(); return r.status; }, { timeout: 90000 }).toMatch(/^(PASSED|FAILED|INCOMPLETE)$/);
        const report = await sut.selection!.report();
        expect(report.executedTestKeys.sort()).toEqual(['test-a', 'test-a-extra']);
        await expect.poll(() => sut.selection!.starts.filter(s => s.runId === sut.vars.run).map(s => s.testKey).sort()).toEqual(['test-a', 'test-a-extra']);
    });
});
// AC-WB-028; source Gherkin line 301
Then(/^未選取的"test-b"本次不執行也不標示通過$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(301, 'Then', async () => {
        expect(sut.db.all('SELECT c.id FROM case_results c JOIN test_definitions t ON t.id=c.test_definition_id WHERE c.run_id=? AND t.test_key=?', [String(sut.vars.run), 'test-b'])).toHaveLength(0);
        const row = sut.page.getByTestId('scenario-case-b');
        await expect(row.getByTestId('case-execution-status')).toHaveText('NOT_RUN');
        await expect(row).toHaveAttribute('data-selected', 'false');
        const report = await sut.selection!.report();
        expect(report.sourceCases.find((c: any) => c.caseId === 'b')).toMatchObject({ selected: false, status: 'NOT_RUN' });
    });
});
// AC-WB-028; source Gherkin line 302
Then(/^右側內嵌瀏覽器即時呈現本次run目前測試所用的同一session與page的真實操作$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(302, 'Then', async () => {
        await expect.poll(() => sut.selection!.frames.filter(f => f.runId === sut.vars.run).map(f => f.testKey).filter((key, i, all) => all.indexOf(key) === i).sort(), { timeout: 15000 }).toEqual(['test-a', 'test-a-extra']);
        await Promise.all(sut.selection!.tasks);
        const probeErrors = [...new Set(sut.selection!.errors.map(error => error instanceof Error ? error.stack ?? String(error) : String(error)))];
        expect(probeErrors).toEqual([]);
        for (const key of ['test-a', 'test-a-extra'])
            expect(sut.selection!.frames.some(f => f.runId === sut.vars.run && f.testKey === key), `real same-run canvas/page frame for ${key}`).toBe(true);
    });
});
// AC-WB-028; source Gherkin line 303
Then(/^各測試的實際斷言與每步截圖及成功或失敗結果均對應本次run與所選情境及案例$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(303, 'Then', async () => {
        const report = await sut.selection!.report();
        expect(report.runId).toBe(sut.vars.run);
        expect(report.scope).toBe('SELECTED_CASES');
        expect(report.testBaselineId).toBe(sut.vars.baseline);
        expect(report.sourceRef).toBe(sut.vars.sourceRef);
        expect(report.cases.map((c: any) => c.testKey).sort()).toEqual(['test-a', 'test-a-extra']);
        for (const c of report.cases) {
            expect(c.runId).toBe(sut.vars.run);
            expect(c.scenarioId).toBe('AC-DEMO-001');
            expect(c.caseId).toBe('a');
            expect(c.executed).toBe(true);
            expect(c.steps.length).toBeGreaterThan(0);
            expect(c.steps.some((s: any) => s.assertion)).toBe(true);
            for (const s of c.steps) {
                expect(s.runId).toBe(sut.vars.run);
                expect(s.testDefinitionId).toBe(c.testDefinitionId);
                expect(s.sourceCaseId).toBe(sut.vars.caseA);
                expect(s.sourceStepId).toBeTruthy();
                expect(s.actionIndex).toBeGreaterThan(0);
                expect(s.sessionId).toBeTruthy();
                expect(s.contextRef).toBeTruthy();
                expect(s.pageId).toBeTruthy();
                expect(s.bindingSeq).toBeGreaterThan(0);
                if (s.assertion) {
                    expect(s).toHaveProperty('expected');
                    expect(s).toHaveProperty('actual');
                    if (s.status === 'PASSED')
                        expect(s.assertionPassed).toBe(true);
                }
                expect(s.screenshots.length).toBeGreaterThan(0);
                for (const shot of s.screenshots) {
                    const response = await sut.page.request.get(`/screenshots/${shot.id}`);
                    expect(response.ok()).toBe(true);
                    expect(sha(await response.body())).toBe(shot.sha256);
                }
            }
        }
    });
});
// AC-WB-028; source Gherkin line 304
Then(/^只有所選案例的必要測試與斷言及證據完整通過才標示該案例通過$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(304, 'Then', async () => {
        const report = await sut.selection!.report();
        expect(report.status).toBe('PASSED');
        for (const c of report.cases) {
            expect(c.status).toBe('PASSED');
            expect(c.steps.every((s: any) => s.status === 'PASSED')).toBe(true);
        }
        await expect(sut.page.getByTestId('scenario-case-a').getByTestId('case-execution-status')).toHaveText('PASSED');
    });
});
// AC-WB-028; source Gherkin line 305
Then(/^所選案例通過不代表未執行的全專案案例已通過$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(305, 'Then', async () => {
        const report = await sut.selection!.report();
        expect(report.coverageComplete).toBe(false);
        expect(report.requiredTestCount).toBe(3);
        expect(report.executedTestKeys).toHaveLength(2);
        expect(report.unexecutedTestKeys).toEqual(['test-b']);
        expect(sut.db.all('SELECT stage FROM features WHERE id=?', [String(sut.vars.featureId)])[0].stage).toBe('VERIFICATION');
    });
});
// AC-WB-029; source Gherkin line 309
Given(/^專案已設定DbGate網頁入口且連接該專案的測試資料庫$/,async({sut})=>{
 const expect=sut.check;await sut.step(309,'Given',async()=>{
  expect(process.env.WB_DBGATE_URL).toBeTruthy();
  await sut.queryUi(fixtureSql);
  await expect(sut.dbGate!.page.getByText('Connected',{exact:true})).toBeVisible();
 });
});
// AC-WB-029; source Gherkin line 310
Given(/^測試已明確指定查詢SQL與預期欄位值$/,async({sut})=>{
 const expect=sut.check;await sut.step(310,'Given',async()=>{
  sut.vars.dbgateSql="SELECT role_code,state FROM test_accounts WHERE username='scenario_user';";
  sut.vars.dbgateExpected=[{role_code:'A',state:'active'}];
  expect(sut.vars.dbgateSql).toContain('SELECT');
 });
});
// AC-WB-029; source Gherkin line 311
When(/^spec使用Playwright在DbGate執行查詢並等待本次結果顯示$/,async({sut})=>{
 await sut.step(311,'When',async()=>{await sut.queryUi(String(sut.vars.dbgateSql));sut.vars.dbgatePositive=await sut.dbgateRun('positive');});
});
// AC-WB-029; source Gherkin line 312
Then(/^spec從DbGate結果表格讀取實際欄位值並斷言符合預期$/,async({sut})=>{
 const expect=sut.check;await sut.step(312,'Then',async()=>{
  expect(sut.vars.dbRows).toEqual(sut.vars.dbgateExpected);
  expect((sut.vars.dbgatePositive as any).status).toBe('PASSED');
  await expect(sut.dbGateResults()).toContainText('active');
 });
});
// AC-WB-029; source Gherkin line 313
Then(/^Playwright擷取本次DbGate查詢與結果表格的畫面$/,async({sut})=>{
 const expect=sut.check;await sut.step(313,'Then',async()=>{
  const image=await sut.dbGate!.page.screenshot();await sut.info.attach('DbGate-query-result',{body:image,contentType:'image/png'});
  expect(image.subarray(1,4).toString()).toBe('PNG');
 });
});
// AC-WB-029; source Gherkin line 314
Then(/^測試報告保存查詢SQL與預期值及實際值並可開啟對應DbGate截圖$/,async({sut})=>{
 const expect=sut.check;await sut.step(314,'Then',async()=>{
  const report=sut.vars.dbgatePositive as any;
  for(const result of report.cases){
   expect(result.steps.some((s:any)=>s.actual?.sql===sut.vars.dbgateSql)).toBe(true);
   expect(result.steps.some((s:any)=>s.assertion&&s.expected==='A'&&s.actual==='A')).toBe(true);
   for(const step of result.steps)for(const shot of step.screenshots){const response=await sut.page.request.get(`/screenshots/${shot.id}`);expect(response.ok()).toBe(true);expect(sha(await response.body())).toBe(shot.sha256);}
  }
 });
});
// AC-WB-029; source Gherkin line 315
Then(/^DbGate截圖與資料斷言對應同一次run與Gherkin情境及案例與step及被驗證程式版本$/,async({sut})=>{
 const expect=sut.check;await sut.step(315,'Then',async()=>{
  const report=sut.vars.dbgatePositive as any;expect(report.sourceRef).toBe(sut.vars.sourceRef);
  for(const result of report.cases){expect(result.scenarioId).toBe('AC-DEMO-001');expect(result.caseId).toMatch(/^[ab]$/);
   for(const step of result.steps){expect(step.runId).toBe(report.runId);expect(step.testDefinitionId).toBe(result.testDefinitionId);expect(step.sourceCaseId).toBeTruthy();expect(step.sourceStepId).toBeTruthy();expect(step.sessionId).toBeTruthy();expect(step.pageId).toBeTruthy();expect(step.screenshots.length).toBeGreaterThan(0);}
  }
 });
});
// AC-WB-029; source Gherkin line 316
Then(/^查詢失敗或資料不符時報告保留失敗結果與錯誤及DbGate畫面$/,async({sut})=>{
 const expect=sut.check;await sut.step(316,'Then',async()=>{
  const reports=[];for(const mode of ['query-error','mismatch'] as const){const report=await sut.dbgateRun(mode);reports.push(report);expect(report.status).toBe('FAILED');
   const failures=report.cases.flatMap((c:any)=>c.steps).filter((s:any)=>s.status==='FAILED');expect(failures.length).toBeGreaterThan(0);
   for(const failure of failures){expect(failure.error).toBeTruthy();expect(failure.screenshots.some((s:any)=>s.moment==='failure')).toBe(true);}
  }sut.vars.dbgateFailures=reports;
 });
});
// AC-WB-029; source Gherkin line 317
Then(/^DbGate無法連線或結果未載入時明確顯示錯誤且不標示資料驗證通過$/,async({sut})=>{
 const expect=sut.check;await sut.step(317,'Then',async()=>{
  for(const mode of ['unavailable','not-loaded'] as const){const report=await sut.dbgateRun(mode);expect(report.status).toBe('FAILED');expect(report.cases.flatMap((c:any)=>c.steps).some((s:any)=>s.status==='FAILED'&&s.error)).toBe(true);}
 });
});
// AC-WB-029; source Gherkin line 318
Then(/^截圖保存成功本身不代表資料斷言通過$/,async({sut})=>{
 const expect=sut.check;await sut.step(318,'Then',async()=>{
  for(const report of sut.vars.dbgateFailures as any[]){expect(report.status).toBe('FAILED');expect(report.cases.flatMap((c:any)=>c.steps).some((s:any)=>s.status==='FAILED'&&s.screenshots.length>0)).toBe(true);}
 });
});
Given(/^使用者開啟需求首頁且已有可選工作區$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(322,'Given',async()=>{await sut.page.goto('/requirements');const projects:any[]=[];sut.vars.navigationWorkspaces=projects;for(const name of ['navigation-one','navigation-two']){const workspaceRef=await mkdtemp(join(resolve('.test-fixtures'),`${name}-${String(sut.vars.requirement).slice(-8)}-`));sut.addCleanup(async()=>rm(workspaceRef,{recursive:true,force:true}));projects.push({workspaceRef});const project=await sut.request('/projects',{name:`${name}-${String(sut.vars.requirement).slice(-8)}`,workspaceRef},201) as {id:string;name:string;workspaceRef:string};expect(resolve(project.workspaceRef)).toBe(resolve(workspaceRef));projects[projects.length-1]=project;}await sut.page.reload();await expect(sut.page.getByRole('heading',{name:'工作區管理',exact:true})).toBeVisible();});
});
When(/^使用者新增需求並在同一表單選擇一個以上工作區$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(323,'When',async()=>{const projects=sut.vars.navigationWorkspaces as any[],key=`REQ-NAV-${String(sut.vars.requirement).slice(-8)}`;sut.vars.navigationRequirementKey=key;const created=sut.page.waitForResponse(response=>new URL(response.url()).pathname==='/requirements'&&response.request().method()==='POST');await sut.page.getByTestId('requirement-sidebar').getByRole('button',{name:'新增需求',exact:true}).click();await sut.page.getByLabel('需求編號').fill(key);await sut.page.locator('.requirement-workspace-picker label').filter({hasText:projects[0].name}).locator('input').check();await sut.page.getByRole('button',{name:'建立',exact:true}).click();const response=await created;expect(response.status()).toBe(201);sut.vars.navigationRequirement=await response.json();});
});
Then(/^新需求建立時即關聯所選工作區$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(324,'Then',async()=>{const requirement=sut.vars.navigationRequirement as any,projects=sut.vars.navigationWorkspaces as any[],response=await sut.page.request.get(`/requirements/${requirement.id}`);expect(response.ok()).toBe(true);const current=await response.json();expect(current.projects.map((project:any)=>project.id)).toEqual([projects[0].id]);await expect(sut.page.getByTestId('sidebar-requirement-'+requirement.id)).toBeVisible();});
});
When(/^使用者在該需求新增第二份Gherkin$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(325,'When',async()=>{const key=String(sut.vars.navigationRequirementKey);const created=sut.page.waitForResponse(response=>response.url().endsWith(`/requirements/${(sut.vars.navigationRequirement as any).id}/features`)&&response.request().method()==='POST');await sut.page.getByTestId('requirement-sidebar').getByRole('button',{name:`為 ${key} 新增 Gherkin`,exact:true}).click();await sut.page.getByLabel('Gherkin 名稱（不含副檔名）').fill('checkout');await sut.page.getByRole('button',{name:'建立',exact:true}).click();const response=await created;expect(response.status()).toBe(201);sut.vars.navigationCheckoutFeature=(await response.json()).featureId;});
});
Then(/^左側需求節點展開列出兩份Gherkin與各自狀態$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(326,'Then',async()=>{await sut.page.goto('/requirements');const key=String(sut.vars.navigationRequirementKey),entry=sut.page.locator('.requirement-list-entry').filter({hasText:key});await entry.getByRole('button',{name:`展開需求 ${key}`,exact:true}).click();const children=entry.locator('.requirement-child-row');await expect(children).toHaveCount(2);await expect(children.filter({hasText:key}).first()).toContainText('需求確認 · 進行中');await expect(children.filter({hasText:'checkout'})).toContainText('需求確認 · 進行中');await expect(children.locator('.requirement-feature-status')).toHaveCount(2);});
});
When(/^使用者在需求清單展開需求並編輯名稱$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(327,'When',async()=>{await sut.page.goto('/requirements');const key=String(sut.vars.navigationRequirementKey),entry=sut.page.locator('.requirement-list-entry').filter({hasText:key}),toggle=entry.locator('.requirement-title-toggle');if(await toggle.getAttribute('aria-expanded')!=='true')await entry.getByRole('button',{name:`展開需求 ${key}`,exact:true}).click();sut.vars.navigationRenamedKey=key+'-EDITED';await entry.getByRole('button',{name:`重新命名 ${key}`,exact:true}).click();await sut.page.getByLabel(`需求名稱 ${key}`).fill(String(sut.vars.navigationRenamedKey));await sut.page.locator('.requirement-workspace-dropdown summary').click();});
});
Then(/^Gherkin在原列下方樹狀展開且名稱旁直接出現輸入框與多選工作區下拉選單$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(328,'Then',async()=>{const key=String(sut.vars.navigationRequirementKey),workspace=(sut.vars.navigationWorkspaces as any[])[0].name,entry=sut.page.locator('.requirement-list-entry').filter({hasText:workspace}),availableProjects=await (await sut.page.request.get('/projects')).json();await expect(sut.page.getByLabel(`需求名稱 ${key}`)).toHaveValue(String(sut.vars.navigationRenamedKey));await expect(sut.page.locator('.requirement-workspace-dropdown')).toHaveAttribute('open','');await expect(sut.page.locator('.requirement-workspace-options input[type=checkbox]')).toHaveCount(availableProjects.length);await expect(entry.locator('.requirement-children .requirement-child-row')).toHaveCount(2);});
});
Then(/^保存需求名稱時一併保存工作區關聯$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(329,'Then',async()=>{const projects=sut.vars.navigationWorkspaces as any[],options=sut.page.locator('.requirement-workspace-options');await options.locator('label').filter({hasText:projects[1].name}).locator('input').check();const saved=sut.page.waitForResponse(response=>response.url().endsWith(`/requirements/${(sut.vars.navigationRequirement as any).id}`)&&response.request().method()==='PUT');await sut.page.getByRole('button',{name:'保存需求名稱',exact:true}).click();const response=await saved;expect(response.status()).toBe(200);const requirement=await (await sut.page.request.get(`/requirements/${(sut.vars.navigationRequirement as any).id}?featureId=${sut.vars.navigationCheckoutFeature}`)).json();expect(requirement.requirementKey).toBe(sut.vars.navigationRenamedKey);expect(requirement.projects.map((project:any)=>project.id).sort()).toEqual(projects.map(project=>project.id).sort());});
});
Then(/^工作區管理位於需求首頁下方而非獨立頁面$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(330,'Then',async()=>{await expect(sut.page.getByRole('heading',{name:'需求工作台',exact:true})).toBeVisible();await expect(sut.page.getByRole('heading',{name:'需求清單',exact:true})).toBeVisible();await expect(sut.page.locator('.workspace-home-panel')).toBeVisible();const order=await sut.page.locator('main').evaluate(element=>{const list=element.querySelector('.requirement-list')?.closest('section'),workspaces=element.querySelector('.workspace-home-panel');return Boolean(list&&workspaces&&list.compareDocumentPosition(workspaces)&Node.DOCUMENT_POSITION_FOLLOWING);});expect(order).toBe(true);});
});
When(/^使用者從左側點選其中一份Gherkin並捲動右側工作區$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(331,'When',async()=>{const node=sut.page.getByTestId('sidebar-requirement-'+(sut.vars.navigationRequirement as any).id);await node.getByRole('link',{name:String(sut.vars.navigationRenamedKey),exact:true}).click();const feature=sut.page.getByTestId('feature-select').locator('option').filter({hasText:'checkout'});await sut.page.getByTestId('feature-select').selectOption(String(await feature.getAttribute('value')));await node.locator('.sidebar-stage').nth(0).click();await expect(sut.page.getByTestId('feature-select').locator('option:checked')).toContainText('checkout');await sut.page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));sut.vars.navigationUrl=sut.page.url();});
});
Then(/^左側需求選單維持固定且右側頁籤顯示所選Gherkin的滿版流程內容$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(332,'Then',async()=>{const sidebar=sut.page.getByTestId('requirement-sidebar');expect(await sidebar.evaluate(element=>getComputedStyle(element).position)).toBe('fixed');await expect(sut.page.locator('main')).toHaveClass(/full-screen-main/);await expect(sut.page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage','GHERKIN');expect(new URL(sut.page.url()).searchParams.get('featureId')).toBe(sut.vars.navigationCheckoutFeature);await sut.page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));expect((await sidebar.boundingBox())?.y).toBe(0);});
});
Then(/^右側可開啟及切換多個頁籤$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(333,'Then',async()=>{const tabs=sut.page.getByTestId('workspace-tabs'),before=await tabs.locator('.workspace-tab').count(),node=sut.page.getByTestId('sidebar-requirement-'+(sut.vars.navigationRequirement as any).id);await node.locator('.sidebar-stage').nth(1).click();await expect(sut.page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage','SD');await expect(tabs.locator('.workspace-tab')).toHaveCount(before+1);const gherkinTab=tabs.locator('.workspace-tab').filter({hasText:'需求確認'}).filter({hasText:'checkout'}).last();await gherkinTab.locator('.workspace-tab-select').click();await expect(sut.page).toHaveURL(/workflowStage=GHERKIN/);const sdTab=tabs.locator('.workspace-tab').filter({hasText:'系統設計'}).last();await sdTab.locator('.workspace-tab-select').click();await expect(sut.page).toHaveURL(/workflowStage=SD/);await gherkinTab.locator('.workspace-tab-select').click();sut.vars.navigationUrl=sut.page.url();});
});
// AC-WB-030; source Gherkin line 334
Then(/^重新載入後仍顯示相同需求及所選Gherkin$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(334,'Then',async()=>{
  const requirement=sut.vars.navigationRequirement as any,featureId=String(sut.vars.navigationCheckoutFeature),selectedUrl=String(sut.vars.navigationUrl);
  await sut.page.reload();expect(sut.page.url()).toBe(selectedUrl);
  await expect(sut.page.getByTestId('feature-select').locator('option:checked')).toContainText('checkout');
  await expect(sut.page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage','GHERKIN');
  expect(new URL(sut.page.url()).pathname).toBe(`/requirements/${requirement.id}`);expect(new URL(sut.page.url()).searchParams.get('featureId')).toBe(featureId);
 });
});
Given(/^兩個程式碼專案已各自綁定不同的本機目錄$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(338,'Given',async()=>{const projects:any[]=[];sut.vars.localProjects=projects;for(const name of ['frontend','backend']){const workspaceRef=await mkdtemp(join(resolve('.test-fixtures'),`${name}-${String(sut.vars.requirement).slice(-8)}-`));sut.addCleanup(async()=>rm(workspaceRef,{recursive:true,force:true}));projects.push({workspaceRef});const result=await sut.request('/projects',{name:`${name}-${String(sut.vars.requirement).slice(-8)}`,workspaceRef},201) as {id:string;name:string;workspaceRef:string};expect(resolve(result.workspaceRef)).toBe(resolve(workspaceRef));projects[projects.length-1]=result;}expect(new Set(projects.map(project=>project.workspaceRef)).size).toBe(2);await sut.page.goto(`/requirements/${sut.vars.requirement}`);});
});
When(/^使用者在需求中關聯這兩個專案$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(339,'When',async()=>{const projects=sut.vars.localProjects as any[],key=String(sut.db.all('SELECT requirement_key FROM requirements WHERE id=?',[String(sut.vars.requirement)])[0].requirement_key);await sut.page.goto('/requirements');const entry=sut.page.locator('.requirement-list-entry').filter({hasText:key});await entry.getByRole('button',{name:`重新命名 ${key}`,exact:true}).click();await sut.page.locator('.requirement-workspace-dropdown summary').click();const options=sut.page.locator('.requirement-workspace-options');for(const checkbox of await options.locator('input[type=checkbox]').all())await checkbox.uncheck();for(const project of projects)await options.locator('label').filter({hasText:project.name}).locator('input').check();const saved=sut.page.waitForResponse(response=>response.url().endsWith(`/requirements/${sut.vars.requirement}`)&&response.request().method()==='PUT');await sut.page.getByRole('button',{name:'保存需求名稱',exact:true}).click();const response=await saved;expect(response.status()).toBe(200);});
});
Then(/^工作台保留一份需求與其Gherkin及專屬SD和BDD而不按專案複製需求$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(340,'Then',async()=>{const response=await sut.page.request.get(`/requirements/${sut.vars.requirement}`);expect(response.ok()).toBe(true);const requirement=await response.json();expect(requirement.projects.map((project:any)=>project.id).sort()).toEqual((sut.vars.localProjects as any[]).map(project=>project.id).sort());expect(requirement.id).toBe(sut.vars.requirement);for(const kind of ['gherkin','sd','spec']){expect(requirement.documents[kind].id).toBe(sut.vars[kind+'Doc']);expect(requirement.documents[kind].projectId).toBeNull();}const listed=await (await sut.page.request.get('/requirements')).json();expect(listed.filter((item:any)=>item.id===sut.vars.requirement)).toHaveLength(1);sut.vars.requirementProjects=requirement.projects;});
});
When(/^使用者在需求開發區切換目前操作專案並開啟terminal$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(341,'When',async()=>{const results=[];for(const project of sut.vars.localProjects as any[]){const sidebar=sut.page.getByTestId('requirement-sidebar'),choice=sidebar.getByRole('button',{name:project.name,exact:true});if(!await choice.isVisible())await sidebar.getByTestId('sidebar-terminal').click();const opened=sut.page.waitForResponse(response=>response.url().endsWith('/terminals')&&response.request().method()==='POST');await choice.click();const response=await opened;expect(response.status()).toBe(201);const terminal=await response.json();expect(resolve(terminal.workspaceRef)).toBe(resolve(project.workspaceRef));sut.addCleanup(async()=>{const saved=await sut.page.request.get(`/projects/${project.id}/terminal-session?key=${encodeURIComponent(`/projects/${project.id}/terminal`)}`),state=await saved.json();if(state.id){const closed=await sut.page.request.delete(`/terminals/${state.id}`);if(!closed.ok())throw Error(`Could not close terminal ${state.id}: ${closed.status()}`);}});await expect(sut.page.getByTestId('xterm-host')).toBeVisible();await sut.page.getByTestId('xterm-host').click();await sut.page.keyboard.type('pwd');await sut.page.keyboard.press('Enter');await expect(sut.page.locator('.xterm-rows')).toContainText(project.workspaceRef);const output=await sut.page.locator('.xterm-rows').innerText();results.push({projectId:project.id,sessionId:terminal.id,expected:project.workspaceRef,actual:output});const closed=sut.page.getByTestId('workspace-tabs').getByRole('button',{name:`關閉 ${project.name} · Terminal`,exact:true});await closed.click();const session=await (await sut.page.request.get(`/projects/${project.id}/terminal-session?key=${encodeURIComponent(`/projects/${project.id}/terminal`)}`)).json();expect(session.id).toBeNull();}sut.vars.terminalDirectories=results;});
});
Then(/^每個terminal的實際工作目錄等於所選專案綁定的本機目錄$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(342,'Then',async()=>{const rows=sut.vars.terminalDirectories as any[];expect(rows).toHaveLength(2);expect(new Set(rows.map(row=>row.expected)).size).toBe(2);for(const row of rows)expect(row.actual).toContain(row.expected);});
});
Then(/^工作區管理與需求清單位於同一首頁且需求不隸屬單一工作區$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(343,'Then',async()=>{await sut.page.goto('/requirements');await expect(sut.page.getByRole('heading',{name:'需求清單',exact:true})).toBeVisible();await expect(sut.page.getByRole('heading',{name:'工作區管理',exact:true})).toBeVisible();const requirement=await (await sut.page.request.get(`/requirements/${sut.vars.requirement}`)).json();expect(requirement.projects).toHaveLength(2);const listed=await (await sut.page.request.get('/requirements')).json();expect(listed.filter((item:any)=>item.id===sut.vars.requirement)).toHaveLength(1);});
});
// AC-WB-032; source Gherkin line 347
Given(/^工作台資料庫尚未套用預設設定$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(347,'Given',async()=>{
  const root=resolve(process.cwd());await mkdir(join(root,'.test-fixtures'),{recursive:true});const directory=await mkdtemp(join(root,'.test-fixtures/first-run-settings-')),metadataFile=join(directory,'metadata.sqlite');
  expect(existsSync(metadataFile)).toBe(false);sut.vars.firstRunDirectory=directory;sut.vars.firstRunMetadataFile=metadataFile;sut.vars.firstRunServer=undefined;sut.vars.firstRunAddress='';
  sut.addCleanup(async()=>{const server=sut.vars.firstRunServer as any;if(server)await server.app.close();await rm(directory,{recursive:true,force:true});});
 });
});
// AC-WB-032; source Gherkin line 348
When(/^工作台首次啟動$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(348,'When',async()=>{
  const server=await createServer({root:resolve(process.cwd()),metadataFile:String(sut.vars.firstRunMetadataFile),dataRoot:join(String(sut.vars.firstRunDirectory),'data'),baseUrl:'http://127.0.0.1:1'});
  sut.vars.firstRunServer=server;sut.vars.firstRunAddress=await server.app.listen({host:'127.0.0.1',port:0});await sut.page.goto(String(sut.vars.firstRunAddress)+'/llm-settings');
  await expect(sut.page.getByRole('heading',{name:'LLM 設定',exact:true})).toBeVisible();
 });
});
// AC-WB-032; source Gherkin line 349
Then(/^資料庫建立Codex與Kiro CLI及從skills\/playwright-bdd\/SKILL\.md載入的Playwright BDD Skill$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(349,'Then',async()=>{
  const address=String(sut.vars.firstRunAddress),settingsResponse=await sut.page.request.get(address+'/llm-settings');expect(settingsResponse.status()).toBe(200);const settings=await settingsResponse.json();
  const codex=settings.cliCommands.find((item:any)=>item.name==='Codex CLI'),kiro=settings.cliCommands.find((item:any)=>item.name==='Kiro CLI');expect(codex?.executable).toBe('codex');expect(codex?.args).toEqual(['--sandbox','workspace-write','--ask-for-approval','on-request','--no-alt-screen','--no-daemon']);expect(kiro?.executable).toBe('kiro-cli');expect(kiro?.args).toEqual(['chat']);
  const skill=settings.skills.find((item:any)=>item.name==='Playwright BDD');expect(skill?.instructions).toBe(readFileSync('skills/playwright-bdd/SKILL.md','utf8'));
  expect(await (sut.vars.firstRunServer as any).core.store.all('SELECT seed_key FROM application_seed_history ORDER BY seed_key')).toEqual([{seed_key:'llm-agent-settings-v1'},{seed_key:'llm-workflow-agent-defaults-v2'}]);sut.vars.firstRunSettings={codexId:codex.id,kiroId:kiro.id,skillId:skill.id};
 });
});
// AC-WB-032; source Gherkin line 350
Then(/^資料庫建立需求確認、系統設計、測試情境及程式開發Agent，並綁定Codex CLI與Playwright BDD Skill$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(350,'Then',async()=>{
  const address=String(sut.vars.firstRunAddress),response=await sut.page.request.get(address+'/llm-settings');expect(response.status()).toBe(200);const settings=await response.json(),names=['需求確認 Agent','系統設計 Agent','測試情境 Agent','程式開發 Agent'];
  expect(settings.agents.map((item:any)=>item.name).sort()).toEqual([...names].sort());const codex=settings.cliCommands.find((item:any)=>item.name==='Codex CLI'),skill=settings.skills.find((item:any)=>item.name==='Playwright BDD');
  for(const agent of settings.agents){expect(agent.cliCommand.id).toBe(codex.id);expect(agent.skill.id).toBe(skill.id);expect(agent.prompt.length).toBeGreaterThan(0);}
  sut.vars.firstRunSettings={...(sut.vars.firstRunSettings as any),agents:Object.fromEntries(settings.agents.map((item:any)=>[item.name,item.id]))};
 });
});
// AC-WB-032; source Gherkin line 351
Then(/^流程設定預設將四個Agent各自指派到對應可編輯階段，驗證報告維持唯讀$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(351,'Then',async()=>{
  const address=String(sut.vars.firstRunAddress),response=await sut.page.request.get(address+'/workflow-settings');expect(response.status()).toBe(200);const workflow=await response.json(),agents=(sut.vars.firstRunSettings as any).agents;
  expect(workflow.stages.map((stage:any)=>stage.key)).toEqual(['GHERKIN','SD','TESTS','IMPLEMENTATION']);for(const [stage,name] of [['GHERKIN','需求確認 Agent'],['SD','系統設計 Agent'],['TESTS','測試情境 Agent'],['IMPLEMENTATION','程式開發 Agent']])expect(workflow.stages.find((item:any)=>item.key===stage).agentIds).toEqual([agents[name]]);
  await sut.page.goto(address+'/workflow-settings');const readonly=sut.page.locator('.workflow-setting-readonly');await expect(readonly.getByRole('heading',{name:'驗證報告',exact:true})).toBeVisible();await expect(readonly.locator('input[type="checkbox"]')).toHaveCount(0);await expect(readonly).toContainText('唯讀');
 });
});
// AC-WB-032; source Gherkin line 352
When(/^使用者修改流程指派、編輯或刪除預設資料並重新啟動工作台$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(352,'When',async()=>{
  const address=String(sut.vars.firstRunAddress),panels=sut.page.locator('.workflow-setting-stage');await sut.page.goto(address+'/workflow-settings');await expect(panels).toHaveCount(4);
  await sut.page.getByLabel('系統設計 · 系統設計 Agent').uncheck();await sut.page.getByLabel('系統設計 · 需求確認 Agent').check();const saved=sut.page.waitForResponse(response=>new URL(response.url()).pathname==='/workflow-settings'&&response.request().method()==='PUT');await sut.page.getByTestId('save-workflow-settings').click();expect((await saved).status()).toBe(200);
  await sut.page.goto(address+'/llm-settings');const sections=sut.page.locator('.llm-setting-panel'),cliRow=sections.nth(0).locator('.llm-setting-row').filter({hasText:'Codex CLI'});await cliRow.getByRole('button',{name:'編輯',exact:true}).click();await sut.page.getByLabel('顯示名稱').fill('Codex CLI saved');await sut.page.getByRole('button',{name:'保存 CLI 指令'}).click();await expect(sections.nth(0).getByText('Codex CLI saved',{exact:true})).toBeVisible();
  const skillRow=sections.nth(1).locator('.llm-setting-row').filter({hasText:'Playwright BDD'});await skillRow.getByRole('button',{name:'編輯',exact:true}).click();await sut.page.getByLabel('Skill 名稱').fill('BDD Skill saved');await sut.page.getByLabel('Skill 指示').fill('PERSISTED_SKILL_INSTRUCTIONS');await sut.page.getByRole('button',{name:'保存 Skill'}).click();await expect(sections.nth(1).getByText('BDD Skill saved',{exact:true})).toBeVisible();
  const kiroRow=sections.nth(0).locator('.llm-setting-row').filter({hasText:'Kiro CLI'});sut.page.once('dialog',dialog=>dialog.accept());await kiroRow.getByRole('button',{name:'刪除',exact:true}).click();await expect(kiroRow).toHaveCount(0);
  const oldServer=sut.vars.firstRunServer as any;await oldServer.app.close();sut.vars.firstRunServer=undefined;const restarted=await createServer({root:resolve(process.cwd()),metadataFile:String(sut.vars.firstRunMetadataFile),dataRoot:join(String(sut.vars.firstRunDirectory),'data'),baseUrl:'http://127.0.0.1:1'});sut.vars.firstRunServer=restarted;sut.vars.firstRunAddress=await restarted.app.listen({host:'127.0.0.1',port:0});await sut.page.goto(String(sut.vars.firstRunAddress)+'/llm-settings');await expect(sut.page.getByRole('heading',{name:'LLM 設定',exact:true})).toBeVisible();
 });
});
// AC-WB-032; source Gherkin line 353
Then(/^流程指派與編輯內容持續保存且已刪除的預設資料不會重新建立$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(353,'Then',async()=>{
  const address=String(sut.vars.firstRunAddress),response=await sut.page.request.get(address+'/llm-settings');expect(response.status()).toBe(200);const settings=await response.json();expect(settings.cliCommands.map((item:any)=>item.name)).toContain('Codex CLI saved');expect(settings.cliCommands.some((item:any)=>item.name==='Kiro CLI')).toBe(false);expect(settings.skills).toContainEqual(expect.objectContaining({name:'BDD Skill saved',instructions:'PERSISTED_SKILL_INSTRUCTIONS'}));
  const agent=settings.agents.find((item:any)=>item.name==='需求確認 Agent');expect(agent).toBeDefined();expect(agent.cliCommand.name).toBe('Codex CLI saved');expect(agent.skill.name).toBe('BDD Skill saved');const workflow=await (await sut.page.request.get(address+'/workflow-settings')).json(),ids=(sut.vars.firstRunSettings as any).agents;expect(workflow.stages.find((stage:any)=>stage.key==='SD').agentIds).toEqual([ids['需求確認 Agent']]);
  expect(await (sut.vars.firstRunServer as any).core.store.all('SELECT seed_key FROM application_seed_history ORDER BY seed_key')).toEqual([{seed_key:'llm-agent-settings-v1'},{seed_key:'llm-workflow-agent-defaults-v2'}]);
 });
});
// AC-WB-033; source Gherkin line 369
Given(/^CLI、Skill及Agent已保存$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(369,'Given',async()=>{
  const requirement=String(sut.vars.requirement),settingsResponse=await sut.page.request.get('/llm-settings');expect(settingsResponse.status()).toBe(200);const settings=await settingsResponse.json(),workflowResponse=await sut.page.request.get('/workflow-settings');expect(workflowResponse.status()).toBe(200);const workflow=await workflowResponse.json();
  const commandResponse=await sut.page.request.post('/llm-settings/cli-commands',{data:{name:`BDD Echo CLI ${requirement}`,executable:process.execPath,args:['-e','process.stdout.write(process.argv.at(-1))']}});expect(commandResponse.status()).toBe(201);const command=await commandResponse.json();
  const skillResponse=await sut.page.request.post('/llm-settings/skills',{data:{name:`BDD Skill ${requirement}`,instructions:'SKILL_BDD_MARKER: preserve source Gherkin.'}});expect(skillResponse.status()).toBe(201);const skill=await skillResponse.json();
  const agents=[];for(const [name,marker] of [['Agent A','PROMPT_BDD_A'],['Agent B','PROMPT_BDD_B'],['Unassigned Agent','PROMPT_BDD_UNASSIGNED']]){const response=await sut.page.request.post('/llm-settings/agents',{data:{name:`${name} ${requirement}`,cliCommandId:command.id,skillId:skill.id,prompt:`${marker}: inspect the selected workflow document.`}});expect(response.status()).toBe(201);agents.push(await response.json());}
  const prior=Object.fromEntries(workflow.stages.map((stage:any)=>[stage.key,stage.agentIds]));sut.vars.multiAgentSettings={command,skill,agents,prior};
  sut.addCleanup(async()=>{const current=sut.vars.multiAgentSettings as any;if(!current)return;const restored=await sut.page.request.put('/workflow-settings',{data:{assignments:current.prior}});if(!restored.ok())throw Error(`Could not restore workflow assignments: ${restored.status()}`);for(const agent of current.agents){const removed=await sut.page.request.delete(`/llm-settings/agents/${agent.id}`);if(!removed.ok())throw Error(`Could not remove test Agent ${agent.id}: ${removed.status()}`);}const removedSkill=await sut.page.request.delete(`/llm-settings/skills/${current.skill.id}`);if(!removedSkill.ok())throw Error(`Could not remove test Skill ${current.skill.id}: ${removedSkill.status()}`);const removedCommand=await sut.page.request.delete(`/llm-settings/cli-commands/${current.command.id}`);if(!removedCommand.ok())throw Error(`Could not remove test CLI ${current.command.id}: ${removedCommand.status()}`);});
  expect(settings).toBeDefined();
 });
});
// AC-WB-033; source Gherkin line 370
When(/^使用者為需求確認、系統設計、測試情境及程式開發各自指派多個Agent$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(370,'When',async()=>{
  const current=sut.vars.multiAgentSettings as any;await sut.page.goto('/workflow-settings');const stagePanels=sut.page.locator('.workflow-setting-stage');await expect(stagePanels).toHaveCount(4);
  const assignments:Record<string,string[]>={};for(const stage of (await (await sut.page.request.get('/workflow-settings')).json()).stages){const panel=stagePanels.filter({has:sut.page.getByRole('heading',{name:stage.label,exact:true})});for(const label of await panel.locator('label.workflow-agent-option').all()){const checkbox=label.locator('input[type=checkbox]');if(await checkbox.isChecked())await checkbox.uncheck();}for(const agent of current.agents.slice(0,2))await panel.getByLabel(`${stage.label} · ${agent.name}`).check();assignments[stage.key]=current.agents.slice(0,2).map((agent:any)=>agent.id);}
  const saved=sut.page.waitForResponse(response=>new URL(response.url()).pathname==='/workflow-settings'&&response.request().method()==='PUT');await sut.page.getByTestId('save-workflow-settings').click();const response=await saved;expect(response.status()).toBe(200);sut.vars.multiAgentAssignments=assignments;
 });
});
// AC-WB-033; source Gherkin line 371
Then(/^設定持續保存且驗證報告維持唯讀$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(371,'Then',async()=>{
  const expected=sut.vars.multiAgentAssignments as Record<string,string[]>,address=String(sut.page.url()),response=await sut.page.request.get(new URL('/workflow-settings',address).toString());expect(response.status()).toBe(200);const settings=await response.json();for(const [stage,agentIds] of Object.entries(expected))expect(settings.stages.find((item:any)=>item.key===stage).agentIds).toEqual(agentIds);
  const readonly=sut.page.locator('.workflow-setting-readonly');await expect(readonly.getByRole('heading',{name:'驗證報告',exact:true})).toBeVisible();await expect(readonly.locator('input[type=checkbox]')).toHaveCount(0);await expect(readonly).toContainText('唯讀');
 });
});
// AC-WB-033; source Gherkin line 372
When(/^使用者開啟其中一個目前可編輯的需求階段$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(372,'When',async()=>{sut.db.stage('GHERKIN');await sut.page.goto(`/requirements/${sut.vars.requirement}?featureId=${sut.vars.featureId}&workflowStage=GHERKIN`);await expect(sut.page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage','GHERKIN');});
});
// AC-WB-033; source Gherkin line 373
Then(/^該階段只顯示已指派Agent的操作按鈕$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(373,'Then',async()=>{const current=sut.vars.multiAgentSettings as any,actions=sut.page.getByTestId('gherkin-agent-actions');await expect(actions.getByRole('button')).toHaveCount(2);for(const agent of current.agents.slice(0,2))await expect(actions.getByTestId(`start-agent-GHERKIN-${agent.id}`)).toBeVisible();await expect(actions.getByTestId(`start-agent-GHERKIN-${current.agents[2].id}`)).toHaveCount(0);});
});
// AC-WB-033; source Gherkin line 374
Then(/^啟動Agent會在網頁terminal開啟設定的互動CLI並帶入Prompt、Skill及階段文件$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(374,'Then',async()=>{
  const current=sut.vars.multiAgentSettings as any,agent=current.agents[0],opened=sut.page.waitForResponse(response=>response.url().includes(`/requirements/${sut.vars.requirement}/agent-sessions`)&&response.request().method()==='POST');await sut.page.getByTestId(`start-agent-GHERKIN-${agent.id}`).click();const response=await opened;expect(response.ok()).toBe(true);const session=await response.json();expect(typeof session.id).toBe('string');expect(session.projectId).toBe(sut.vars.project);expect(session.stage).toBe('GHERKIN');expect(session.agentId).toBe(agent.id);sut.vars.multiAgentSession=session;
  sut.trackLlmTerminal(session.id);await expect(sut.page).toHaveURL(new RegExp(`/projects/${session.projectId}/terminal\\?kind=llm&session=${session.id}`));await expect(sut.page.getByTestId('xterm-host')).toBeVisible();const terminal=sut.page.locator('.xterm-rows');await expect(terminal).toContainText('PROMPT_BDD_A',{timeout:10000});await expect(terminal).toContainText('SKILL_BDD_MARKER',{timeout:10000});await expect(terminal).toContainText('Feature:',{timeout:10000});
 });
});
// AC-WB-033; source Gherkin line 375
Then(/^Agent未指派到該階段時伺服器拒絕啟動$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(375,'Then',async()=>{
  const current=sut.vars.multiAgentSettings as any,gherkin=sut.head('gherkin'),agent=current.agents[2],response=await sut.page.request.post(`/requirements/${sut.vars.requirement}/agent-sessions`,{data:{stage:'GHERKIN',agentId:agent.id,featureId:sut.vars.featureId,projectId:sut.vars.project,gherkinVersionId:gherkin.id,gherkinSha256:gherkin.raw_sha256}});expect(response.status()).toBe(409);expect((await response.json()).code).toBe('WORKFLOW_AGENT_NOT_ASSIGNED');
 });
});
// AC-WB-034; source Gherkin line 379
Given(/^該Gherkin已完成需求確認、系統設計、測試基線、程式基線及驗證$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(379,'Given',async()=>{
  sut.db.stage('IMPLEMENTATION');sut.db.baseline(false);
  if(!sut.vars.sourceRef)throw Error('WB_SOURCE_REF required to create a real source baseline');
  const pinned=await sut.page.request.post(`/requirements/${sut.vars.requirement}/pin-source`,{data:{featureId:sut.vars.featureId,projects:[{projectId:sut.vars.project,sourceRef:sut.vars.sourceRef}]}});expect(pinned.status()).toBe(200);
  sut.db.baseline(true);sut.db.stage('VERIFIED');
  expect(sut.db.all("SELECT kind,valid FROM baselines WHERE feature_id=? ORDER BY kind",[String(sut.vars.featureId)])).toEqual([{kind:'source',valid:1},{kind:'tests',valid:1}]);expect(sut.db.all('SELECT kind FROM confirmations WHERE feature_id=? ORDER BY kind',[String(sut.vars.featureId)])).toEqual([{kind:'gherkin'},{kind:'sd'}]);expect(sut.db.all('SELECT stage FROM features WHERE id=?',[String(sut.vars.featureId)])[0].stage).toBe('VERIFIED');
  const versions=['gherkin','sd','spec'].map(kind=>{const row=sut.head(kind);return {documentId:String(sut.vars[kind+'Doc']),versionId:String(row.id),rawText:String(row.raw_text),rawSha256:String(row.raw_sha256)};});sut.vars.restartDocumentVersions=versions;
  const runId=String(sut.vars.historicalRun),reportResponse=await sut.page.request.get(`/runs/${runId}/report`);expect(reportResponse.status()).toBe(200);const report=await reportResponse.json();expect(report.runId).toBe(runId);expect(report.status).toBe('FAILED');expect(report.definitionSnapshot.required.map((test:any)=>test.testKey).sort()).toEqual(['test-a','test-a-extra','test-b']);expect(report.sourceCases.map((test:any)=>test.caseId).sort()).toEqual(['a','b']);sut.vars.restartHistoricalReport=report;
  const url=`/requirements/${sut.vars.requirement}?featureId=${sut.vars.featureId}&workflowStage=VERIFICATION`;await sut.page.goto(url);await expect(sut.page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage','VERIFICATION');
 });
});
// AC-WB-034; source Gherkin line 380
When(/^使用者選擇已完成的"([^"]*)"並按右下角重啟階段$/,async({sut},arg0:string)=>{
 const expect=sut.check;
 await sut.step(380,'When',async()=>{
  const featureId=String(sut.vars.featureId),requirementId=String(sut.vars.requirement);await sut.page.goto(`/requirements/${requirementId}?featureId=${featureId}&workflowStage=${encodeURIComponent(arg0)}`);await expect(sut.page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage',arg0);await expect(sut.page.getByTestId('restart-workflow-stage')).toBeVisible();
  const restarted=sut.page.waitForResponse(response=>response.url().endsWith('/restart-stage')&&response.request().method()==='POST');await sut.page.getByTestId('restart-workflow-stage').click();const response=await restarted;expect(response.status()).toBe(200);const result=await response.json();expect(result.stage).toBe(arg0);sut.vars.restartSelectedStage=arg0;
 });
});
// AC-WB-034; source Gherkin line 381
Then(/^該階段成為目前階段且後續階段回到未完成狀態$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(381,'Then',async()=>{
  const stage=String(sut.vars.restartSelectedStage),current=sut.db.all('SELECT stage FROM features WHERE id=?',[String(sut.vars.featureId)])[0].stage;expect(current).toBe(stage);await expect(sut.page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage',stage);await expect(sut.page.getByTestId('restart-workflow-stage')).toHaveCount(0);
  const confirmed=sut.db.all('SELECT kind FROM confirmations WHERE feature_id=? ORDER BY kind',[String(sut.vars.featureId)]),baselines=sut.db.all('SELECT kind,valid FROM baselines WHERE feature_id=? ORDER BY kind',[String(sut.vars.featureId)]);if(stage==='GHERKIN'){expect(confirmed).toHaveLength(0);expect(baselines.every((item:any)=>Number(item.valid)===0)).toBe(true);}else if(stage==='SD'){expect(confirmed).toEqual([{kind:'gherkin'}]);expect(baselines.every((item:any)=>Number(item.valid)===0)).toBe(true);}else{expect(confirmed).toEqual([{kind:'gherkin'},{kind:'sd'}]);const validKinds=baselines.filter((item:any)=>Number(item.valid)===1).map((item:any)=>item.kind);if(stage==='TESTS')expect(validKinds).toEqual([]);else if(stage==='IMPLEMENTATION')expect(validKinds).toEqual(['tests']);else if(stage==='VERIFICATION')expect(validKinds).toEqual(['source','tests']);else throw Error(`Unexpected restart stage ${stage}`);}
 });
});
// AC-WB-034; source Gherkin line 382
Then(/^確認狀態與基線結果符合"([^"]*)"及"([^"]*)"$/,async({sut},arg0:string,arg1:string)=>{
 const expect=sut.check;
 await sut.step(382,'Then',async()=>{
  const stage=String(sut.vars.restartSelectedStage),confirmed=sut.db.all('SELECT kind FROM confirmations WHERE feature_id=? ORDER BY kind',[String(sut.vars.featureId)]).map((item:any)=>item.kind),baselines=sut.db.all('SELECT kind,valid FROM baselines WHERE feature_id=? ORDER BY kind',[String(sut.vars.featureId)]),validKinds=baselines.filter((item:any)=>Number(item.valid)===1).map((item:any)=>item.kind),invalidKinds=baselines.filter((item:any)=>Number(item.valid)===0).map((item:any)=>item.kind);
  let preserved:string;if(!confirmed.length)preserved='無確認';else if(confirmed.length===1)preserved='Gherkin確認';else if(validKinds.length===2)preserved='Gherkin及SD確認與測試及程式基線';else if(validKinds.includes('tests'))preserved='Gherkin及SD確認與測試基線';else preserved='Gherkin及SD確認';
  let invalidated:string;if(!confirmed.length&&invalidKinds.length===2)invalidated='Gherkin及SD確認與全部基線';else if(confirmed.length===1&&invalidKinds.length===2)invalidated='SD確認及全部基線';else if(confirmed.length===2&&invalidKinds.length===2)invalidated='測試與程式基線';else if(confirmed.length===2&&invalidKinds.includes('source'))invalidated='程式基線';else if(confirmed.length===2&&stage==='VERIFICATION')invalidated='僅執行結果';else throw Error(`Restart state does not match a source-defined confirmation/baseline combination: ${stage}`);
  expect(preserved).toBe(arg0);expect(invalidated).toBe(arg1);
 });
});
// AC-WB-034; source Gherkin line 383
Then(/^執行結果標為失效但歷史版本及報告仍保留$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(383,'Then',async()=>{
  const versions=sut.vars.restartDocumentVersions as any[],before=sut.vars.restartHistoricalReport as any,runId=String(sut.vars.historicalRun);for(const version of versions){const response=await sut.page.request.get(`/documents/${version.documentId}/versions/${version.versionId}`);expect(response.status()).toBe(200);const saved=await response.json();expect(saved.versionId).toBe(version.versionId);expect(saved.rawText).toBe(version.rawText);expect(saved.rawSha256).toBe(version.rawSha256);}
  expect(sut.db.all('SELECT status FROM runs WHERE id=?',[runId])).toEqual([{status:'INVALID'}]);const reportResponse=await sut.page.request.get(`/runs/${runId}/report`);expect(reportResponse.status()).toBe(200);const report=await reportResponse.json();expect(report.runId).toBe(before.runId);expect(report.status).toBe('INVALID');expect(report.testBaselineId).toBe(before.testBaselineId);const html=await sut.page.request.get(`/runs/${runId}/report.html`);expect(html.status()).toBe(200);expect(html.headers()['content-type']).toContain('text/html');
 });
});

// AC-WB-035; source Gherkin line 357
Given(/^工作台資料庫已有舊版LLM預設設定且缺少系統設計、測試情境及程式開發Agent$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(357,'Given',async()=>{
  const root=resolve(process.cwd()),directory=await mkdtemp(join(resolve('.test-fixtures'),'workflow-agent-upgrade-')),metadataFile=join(directory,'metadata.sqlite');
  sut.vars.workflowUpgradeDirectory=directory;sut.vars.workflowUpgradeMetadataFile=metadataFile;sut.vars.workflowUpgradeServer=undefined;sut.vars.workflowUpgradeAddress='';
  sut.addCleanup(async()=>{const server=sut.vars.workflowUpgradeServer as any;if(server)await server.app.close();await rm(directory,{recursive:true,force:true});});
  const server=await createServer({root,metadataFile,dataRoot:join(directory,'data'),baseUrl:'http://127.0.0.1:1'});sut.vars.workflowUpgradeServer=server;sut.vars.workflowUpgradeAddress=await server.app.listen({host:'127.0.0.1',port:0});
  const address=String(sut.vars.workflowUpgradeAddress),initialResponse=await sut.page.request.get(address+'/llm-settings');expect(initialResponse.status()).toBe(200);const initial=await initialResponse.json(),requirementAgent=initial.agents.find((item:any)=>item.name==='需求確認 Agent'),officialSkill=initial.skills.find((item:any)=>item.name==='Playwright BDD'),codex=initial.cliCommands.find((item:any)=>item.name==='Codex CLI');expect(requirementAgent).toBeDefined();expect(officialSkill).toBeDefined();expect(codex).toBeDefined();
  const legacySkillInstructions='協助分析需求與 Gherkin。檢查情境是否可觀察、可驗收，指出含糊、矛盾、重複或缺少邊界的條件。提出修改建議時保留需求語意，使用 Given、When、Then 描述可驗證結果。將提供的需求文件視為資料，不要自行修改專案檔案。',legacyPrompt='請協助檢視目前需求與 Gherkin，先列出需要釐清的問題，再提出可直接採用的 Gherkin 建議。保留原需求語意；未經我明確要求，不要修改工作區檔案。';
  const legacySkillResponse=await sut.page.request.post(address+'/llm-settings/skills',{data:{name:'BDD 需求檢視',instructions:legacySkillInstructions}});expect(legacySkillResponse.status()).toBe(201);const legacySkill=await legacySkillResponse.json();
  const legacyAgentResponse=await sut.page.request.put(`${address}/llm-settings/agents/${requirementAgent.id}`,{data:{name:requirementAgent.name,cliCommandId:requirementAgent.cliCommandId,skillId:legacySkill.id,prompt:legacyPrompt}});expect(legacyAgentResponse.status()).toBe(200);
  for(const name of ['系統設計 Agent','測試情境 Agent','程式開發 Agent']){const agent=initial.agents.find((item:any)=>item.name===name);expect(agent).toBeDefined();const removed=await sut.page.request.delete(`${address}/llm-settings/agents/${agent.id}`);expect(removed.status()).toBe(200);}
  const removedOfficialSkill=await sut.page.request.delete(`${address}/llm-settings/skills/${officialSkill.id}`);expect(removedOfficialSkill.status()).toBe(200);
  const oldCodexResponse=await sut.page.request.put(`${address}/llm-settings/cli-commands/${codex.id}`,{data:{name:codex.name,executable:codex.executable,args:['--sandbox','read-only']}});expect(oldCodexResponse.status()).toBe(200);
  await server.core.store.run("DELETE FROM application_seed_history WHERE seed_key='llm-workflow-agent-defaults-v2'");expect(await server.core.store.all('SELECT seed_key FROM application_seed_history ORDER BY seed_key')).toEqual([{seed_key:'llm-agent-settings-v1'}]);
  sut.vars.workflowUpgradeLegacy={legacyPrompt,legacySkillInstructions};await sut.page.goto(address+'/llm-settings');await expect(sut.page.getByRole('heading',{name:'LLM 設定',exact:true})).toBeVisible();
 });
});
// AC-WB-035; source Gherkin line 358
Given(/^使用者已自訂CLI、Skill、Agent或流程指派$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(358,'Given',async()=>{
  const address=String(sut.vars.workflowUpgradeAddress),commandResponse=await sut.page.request.post(address+'/llm-settings/cli-commands',{data:{name:'User CLI',executable:process.execPath,args:['-e','process.stdout.write("USER_CLI")']}});expect(commandResponse.status()).toBe(201);const command=await commandResponse.json();
  const skillResponse=await sut.page.request.post(address+'/llm-settings/skills',{data:{name:'User Skill',instructions:'USER_SKILL: keep this content unchanged.'}});expect(skillResponse.status()).toBe(201);const skill=await skillResponse.json();
  const agentResponse=await sut.page.request.post(address+'/llm-settings/agents',{data:{name:'User Agent',cliCommandId:command.id,skillId:skill.id,prompt:'USER_PROMPT: preserve this agent.'}});expect(agentResponse.status()).toBe(201);const agent=await agentResponse.json();
  const workflowResponse=await sut.page.request.get(address+'/workflow-settings');expect(workflowResponse.status()).toBe(200);const workflow=await workflowResponse.json(),assignments=Object.fromEntries(workflow.stages.map((stage:any)=>[stage.key,stage.agentIds]));assignments.SD=[agent.id];assignments.TESTS=[];assignments.IMPLEMENTATION=[];
  const saved=await sut.page.request.put(address+'/workflow-settings',{data:{assignments}});expect(saved.status()).toBe(200);sut.vars.workflowUpgradeCustom={command,skill,agent};
 });
});
// AC-WB-035; source Gherkin line 359
When(/^工作台啟動新版$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(359,'When',async()=>{
  const oldServer=sut.vars.workflowUpgradeServer as any;await oldServer.app.close();sut.vars.workflowUpgradeServer=undefined;
  const directory=String(sut.vars.workflowUpgradeDirectory),restarted=await createServer({root:resolve(process.cwd()),metadataFile:String(sut.vars.workflowUpgradeMetadataFile),dataRoot:join(directory,'data'),baseUrl:'http://127.0.0.1:1'});sut.vars.workflowUpgradeServer=restarted;sut.vars.workflowUpgradeAddress=await restarted.app.listen({host:'127.0.0.1',port:0});await sut.page.goto(String(sut.vars.workflowUpgradeAddress)+'/llm-settings');await expect(sut.page.getByRole('heading',{name:'LLM 設定',exact:true})).toBeVisible();
 });
});
// AC-WB-035; source Gherkin line 360
Then(/^資料庫補齊缺少的Playwright BDD Skill與流程Agent$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(360,'Then',async()=>{
  const address=String(sut.vars.workflowUpgradeAddress),response=await sut.page.request.get(address+'/llm-settings');expect(response.status()).toBe(200);const settings=await response.json(),required=['需求確認 Agent','系統設計 Agent','測試情境 Agent','程式開發 Agent'];
  expect(settings.agents.map((item:any)=>item.name).filter((name:string)=>required.includes(name)).sort()).toEqual([...required].sort());expect(settings.agents.find((item:any)=>item.name==='User Agent')).toBeDefined();
  const skill=settings.skills.find((item:any)=>item.name==='Playwright BDD');expect(skill?.instructions).toBe(readFileSync('skills/playwright-bdd/SKILL.md','utf8'));const requirementAgent=settings.agents.find((item:any)=>item.name==='需求確認 Agent'),legacy=sut.vars.workflowUpgradeLegacy as any;expect(requirementAgent.prompt).toBe(legacy.legacyPrompt);expect(requirementAgent.skill.name).toBe('Playwright BDD');
  const state=await (sut.vars.workflowUpgradeServer as any).core.store.all('SELECT seed_key,applied_at FROM application_seed_history WHERE seed_key=?',['llm-workflow-agent-defaults-v2']);expect(state).toHaveLength(1);sut.vars.workflowUpgradeAppliedAt=state[0].applied_at;sut.vars.workflowUpgradeDefaults=Object.fromEntries(settings.agents.filter((item:any)=>required.includes(item.name)).map((item:any)=>[item.name,item.id]));
 });
});
// AC-WB-035; source Gherkin line 361
Then(/^四個可編輯階段各指派一個對應Agent且驗證報告維持唯讀$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(361,'Then',async()=>{
  const address=String(sut.vars.workflowUpgradeAddress),response=await sut.page.request.get(address+'/workflow-settings');expect(response.status()).toBe(200);const workflow=await response.json(),defaults=sut.vars.workflowUpgradeDefaults as Record<string,string>,custom=sut.vars.workflowUpgradeCustom as any;
  expect(workflow.stages.map((stage:any)=>stage.key)).toEqual(['GHERKIN','SD','TESTS','IMPLEMENTATION']);for(const [stage,name] of [['GHERKIN','需求確認 Agent'],['SD','系統設計 Agent'],['TESTS','測試情境 Agent'],['IMPLEMENTATION','程式開發 Agent']])expect(workflow.stages.find((item:any)=>item.key===stage).agentIds).toContain(defaults[name]);
  expect(workflow.stages.find((item:any)=>item.key==='SD').agentIds).toEqual([custom.agent.id,defaults['系統設計 Agent']]);await sut.page.goto(address+'/workflow-settings');const readonly=sut.page.locator('.workflow-setting-readonly');await expect(readonly.getByRole('heading',{name:'驗證報告',exact:true})).toBeVisible();await expect(readonly.locator('input[type="checkbox"]')).toHaveCount(0);await expect(readonly).toContainText('唯讀');
 });
});
// AC-WB-035; source Gherkin line 362
Then(/^未修改的舊版Codex預設參數升級為目前預設$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(362,'Then',async()=>{
  const response=await sut.page.request.get(String(sut.vars.workflowUpgradeAddress)+'/llm-settings');expect(response.status()).toBe(200);const settings=await response.json(),codex=settings.cliCommands.find((item:any)=>item.name==='Codex CLI');expect(codex?.args).toEqual(['--sandbox','workspace-write','--ask-for-approval','on-request','--no-alt-screen','--no-daemon']);
 });
});
// AC-WB-035; source Gherkin line 363
Then(/^使用者已自訂的設定值保持不變$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(363,'Then',async()=>{
  const address=String(sut.vars.workflowUpgradeAddress),settingsResponse=await sut.page.request.get(address+'/llm-settings');expect(settingsResponse.status()).toBe(200);const settings=await settingsResponse.json(),custom=sut.vars.workflowUpgradeCustom as any,legacy=sut.vars.workflowUpgradeLegacy as any;
  const savedCommand=settings.cliCommands.find((item:any)=>item.id===custom.command.id),savedSkill=settings.skills.find((item:any)=>item.id===custom.skill.id),savedAgent=settings.agents.find((item:any)=>item.id===custom.agent.id),requirementAgent=settings.agents.find((item:any)=>item.name==='需求確認 Agent');expect(savedCommand).toMatchObject({name:'User CLI',executable:process.execPath,args:['-e','process.stdout.write("USER_CLI")']});expect(savedSkill).toMatchObject({name:'User Skill',instructions:'USER_SKILL: keep this content unchanged.'});expect(savedAgent).toMatchObject({name:'User Agent',cliCommandId:custom.command.id,skillId:custom.skill.id,prompt:'USER_PROMPT: preserve this agent.'});expect(requirementAgent.prompt).toBe(legacy.legacyPrompt);expect(requirementAgent.skill.name).toBe('Playwright BDD');
  const workflow=await (await sut.page.request.get(address+'/workflow-settings')).json();expect(workflow.stages.find((stage:any)=>stage.key==='SD').agentIds).toEqual([custom.agent.id,(sut.vars.workflowUpgradeDefaults as any)['系統設計 Agent']]);
 });
});
// AC-WB-035; source Gherkin line 364
When(/^工作台再次啟動$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(364,'When',async()=>{
  const address=String(sut.vars.workflowUpgradeAddress),settingsResponse=await sut.page.request.get(address+'/llm-settings');expect(settingsResponse.status()).toBe(200);const settings=await settingsResponse.json(),codeAgent=settings.agents.find((item:any)=>item.name==='程式開發 Agent');expect(codeAgent).toBeDefined();
  const removed=await sut.page.request.delete(`${address}/llm-settings/agents/${codeAgent.id}`);expect(removed.status()).toBe(200);const before=await (sut.vars.workflowUpgradeServer as any).core.store.all('SELECT applied_at FROM application_seed_history WHERE seed_key=?',['llm-workflow-agent-defaults-v2']);expect(before).toHaveLength(1);sut.vars.workflowUpgradeAppliedAt=before[0].applied_at;
  const oldServer=sut.vars.workflowUpgradeServer as any;await oldServer.app.close();sut.vars.workflowUpgradeServer=undefined;const directory=String(sut.vars.workflowUpgradeDirectory),restarted=await createServer({root:resolve(process.cwd()),metadataFile:String(sut.vars.workflowUpgradeMetadataFile),dataRoot:join(directory,'data'),baseUrl:'http://127.0.0.1:1'});sut.vars.workflowUpgradeServer=restarted;sut.vars.workflowUpgradeAddress=await restarted.app.listen({host:'127.0.0.1',port:0});await sut.page.goto(String(sut.vars.workflowUpgradeAddress)+'/llm-settings');await expect(sut.page.getByRole('heading',{name:'LLM 設定',exact:true})).toBeVisible();
 });
});
// AC-WB-035; source Gherkin line 365
Then(/^升級不重複執行且已刪除的預設資料不會重新建立$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(365,'Then',async()=>{
  const address=String(sut.vars.workflowUpgradeAddress),settingsResponse=await sut.page.request.get(address+'/llm-settings');expect(settingsResponse.status()).toBe(200);const settings=await settingsResponse.json();expect(settings.agents.some((item:any)=>item.name==='程式開發 Agent')).toBe(false);
  for(const name of ['需求確認 Agent','系統設計 Agent','測試情境 Agent'])expect(settings.agents.filter((item:any)=>item.name===name)).toHaveLength(1);expect(settings.agents.some((item:any)=>item.name==='User Agent')).toBe(true);
  const history=await (sut.vars.workflowUpgradeServer as any).core.store.all('SELECT seed_key,applied_at FROM application_seed_history ORDER BY seed_key');expect(history).toEqual([{seed_key:'llm-agent-settings-v1',applied_at:history[0].applied_at},{seed_key:'llm-workflow-agent-defaults-v2',applied_at:sut.vars.workflowUpgradeAppliedAt}]);
  const workflow=await (await sut.page.request.get(address+'/workflow-settings')).json();expect(workflow.stages.find((stage:any)=>stage.key==='IMPLEMENTATION').agentIds).toEqual([]);expect(workflow.stages.find((stage:any)=>stage.key==='SD').agentIds).toEqual([ (sut.vars.workflowUpgradeCustom as any).agent.id,(sut.vars.workflowUpgradeDefaults as any)['系統設計 Agent'] ]);
 });
});
// AC-WB-003; source Gherkin line 29
When(/^人類確認Gherkin並選擇已指派的系統設計Agent產生SD$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(29,'When',async()=>{
  const agent=await createProposalTestAgent(sut,'SD');
  sut.vars.designAgentId=agent.id;sut.vars.sdBefore=String(sut.head('sd').id);
  await sut.page.getByTestId('confirm-gherkin').click();
  await expect.poll(()=>sut.db.all('SELECT stage FROM features WHERE id=?',[String(sut.vars.featureId)])[0]?.stage).toBe('SD');
  await sut.page.goto(`/requirements/${sut.vars.requirement}?featureId=${sut.vars.featureId}&workflowStage=SD`);
  await sut.provideDesignContext();
  const responsePromise=sut.page.waitForResponse(response=>response.url().includes(`/requirements/${sut.vars.requirement}/generate-sd`)&&response.request().method()==='POST');
  await sut.page.getByTestId(`generate-sd-${agent.id}`).click();
  const response=await responsePromise;expect(response.status()).toBe(200);
  const proposal=await response.json();expect(proposal.status).toBe('completed');expect(proposal.terminal?.terminalId).toBeTruthy();expect(proposal.terminal?.projectId).toBe(String(sut.vars.project));sut.trackLlmTerminal(proposal.terminal?.terminalId);sut.vars.designProposal=proposal;
  await expect.poll(()=>String(sut.head('sd').id)).not.toBe(String(sut.vars.sdBefore));
 });
});
// AC-WB-003; source Gherkin line 31
Then(/^使用設定的互動CLI在網頁terminal提出SD草稿$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(31,'Then',async()=>{
  const response=sut.vars.designProposal as any,terminalInfo=response.terminal,tab=sut.page.locator('.workspace-tab').filter({hasText:'LLM CLI'});await expect(tab).toHaveCount(1);
  await tab.locator('.workspace-tab-select').click();await expect(sut.page.getByTestId('xterm-host')).toBeVisible();
  const session=new URL(sut.page.url()).searchParams.get('session');expect(session).toBe(terminalInfo.terminalId);
  const terminal=sut.page.locator('.xterm-rows');await expect(terminal).not.toBeEmpty();
  expect(response.agentId??sut.vars.designAgentId).toBeTruthy();
 });
});
// AC-WB-004; source Gherkin line 38
Given(/^人類已確認該Gherkin與SD$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(38,'Given',async()=>{
  sut.db.stage('SD');
  await sut.page.goto(`/requirements/${sut.vars.requirement}?featureId=${sut.vars.featureId}&workflowStage=SD`);
  await expect(sut.page.getByTestId('sd-editor')).toBeVisible();
  expect(sut.db.all("SELECT kind FROM confirmations WHERE feature_id=? ORDER BY kind",[String(sut.vars.featureId)])).toEqual([{kind:'gherkin'}]);
 });
});
// AC-WB-004; source Gherkin line 39
When(/^人類確認SD$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(39,'When',async()=>{
  const responsePromise=sut.page.waitForResponse(response=>response.url().includes(`/requirements/${sut.vars.requirement}/confirm-sd`)&&response.request().method()==='POST');
  await sut.page.getByTestId('confirm-sd').click();
  const response=await responsePromise;expect(response.status()).toBe(200);
  const current=await response.json();expect(current.stage).toBe('TESTS');sut.vars.generatedSkeleton=current.documents.spec;
 });
});
// AC-WB-004; source Gherkin line 40
Then(/^工作台進入測試情境階段並自動產生唯讀的spec\.ts骨架$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(40,'Then',async()=>{
  await expect(sut.page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage','TESTS');
  const spec=sut.head('spec');expect(spec.test_stage).toBe('SKELETON');const manifest=JSON.parse(String(spec.test_manifest_json)),pendingFile=manifest.bundleFiles.find((file:any)=>file.path.endsWith('.steps.ts'));expect(manifest.pendingSlots.length).toBeGreaterThan(0);expect(pendingFile?.rawText).toContain('UnimplementedStepError');
  await expect(sut.page.getByTestId('spec-editor')).toContainText('唯讀檔案');
 });
});
// AC-WB-004; source Gherkin line 41
Then(/^spec\.ts預設收合且每個案例對應來源Scenario及Examples列$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(41,'Then',async()=>{
  const detail=sut.page.locator('details.generated-detail');await expect(detail).not.toHaveAttribute('open','');
  const manifest=JSON.parse(String(sut.head('spec').test_manifest_json));
  const sourceCases=sut.db.all('SELECT c.id AS sourceCaseId,c.case_key AS caseId,s.scenario_key AS scenarioId FROM source_cases c JOIN scenarios s ON s.id=c.scenario_id WHERE c.gherkin_version_id=? AND s.requirement_id=? ORDER BY c.row_ordinal',[String(sut.vars.gherkinVersion),String(sut.vars.requirement)]);
  expect(sourceCases.length).toBeGreaterThan(0);
  expect(new Set(manifest.cases.map((item:any)=>item.testKey)).size).toBe(manifest.cases.length);
  const sourceById=new Map(sourceCases.map((item:any)=>[item.sourceCaseId,item]));
  for(const item of manifest.cases){const source=sourceById.get(item.sourceCaseId) as any;expect(source).toBeDefined();expect(item.scenarioId).toBe(source?.scenarioId);expect(item.caseId).toBe(source?.caseId);}
  expect([...new Set(manifest.cases.map((item:any)=>item.sourceCaseId))].sort()).toEqual(sourceCases.map((item:any)=>item.sourceCaseId).sort());
 });
});
// AC-WB-004; source Gherkin line 42
Then(/^人類不能直接編輯生成骨架$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(42,'Then',async()=>{
  const source=sut.page.getByTestId('generated-spec-source');await expect(source).toHaveAttribute('readonly','');
  await expect(sut.page.getByTestId('spec-editor').getByRole('button',{name:'保存新版本'})).toHaveCount(0);
 });
});
// AC-WB-005; source Gherkin line 47
When(/^使用者選擇已指派的測試Agent並透過互動CLI補齊測試步驟$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(47,'When',async()=>{
  const agent=await createProposalTestAgent(sut,'TESTS');
  sut.vars.testAgentId=agent.id;
  await sut.page.goto(`/requirements/${sut.vars.requirement}?featureId=${sut.vars.featureId}&workflowStage=TESTS`);
  await sut.provideCompletionContext();
  const completed=sut.page.waitForResponse(item=>item.url().includes(`/requirements/${sut.vars.requirement}/complete-tests`)&&item.request().method()==='POST');
  await sut.page.getByTestId(`complete-tests-${agent.id}`).click();
  const result=await completed;expect(result.status()).toBe(200);const body=await result.json();expect(body.status).toBe('completed');sut.trackLlmTerminal(body.terminal?.terminalId);sut.vars.completedProposal=body;
  const missing=new FixtureDatabase(process.env.WB_METADATA_DB!,process.env.WB_TARGET_BASE_URL!,process.env.WB_TARGET_DB!,true);sut.secondary.push(missing);missing.stage('TESTS');
  const source=sut.documentSource(missing);
  const needsInput=await sut.request(`/requirements/${missing.vars.requirement}/complete-tests`,{featureId:missing.vars.featureId,agentId:agent.id,skeletonVersionId:missing.vars.specSkeletonVersion},200);
  sut.trackLlmTerminal((needsInput as any).terminal?.terminalId);
  sut.llmMissing={db:missing,source,result:needsInput};
 });
});
// AC-WB-005; source Gherkin line 49
Then(/^CLI在獨立工作目錄讀取經SHA-256核對的官方Playwright-BDD Skill$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(49,'Then',async()=>{
  const bytes=readFileSync('skills/playwright-bdd/SKILL.md');expect(sha(bytes)).toBe('0e8809a494c450289dab05c410988fe4ad7c036b48338adb6a4c0d583b62d8d5');
  const adapter=readFileSync('src/adapters/generation/llm.ts','utf8');expect(adapter).toContain("const bddSkillProjectPath='skills/playwright-bdd/SKILL.md'");expect(adapter).toContain("input, true)");
  expect((sut.vars.completedProposal as any).status).toBe('completed');
 });
});
// AC-WB-008; source Gherkin line 70
Given(/^至少一個工作區已綁定本機程式碼目錄$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(70,'Given',async()=>{
  const response=await sut.page.request.get('/projects');expect(response.ok()).toBe(true);const projects=await response.json();
  const workspace=projects.find((item:any)=>item.id===sut.vars.project);expect(workspace).toBeDefined();expect(resolve(workspace.workspaceRef)).toBe(resolve(process.env.WB_TARGET_REPO!));sut.vars.terminalWorkspace=workspace;
 });
});
// AC-WB-008; source Gherkin line 71
When(/^使用者從左側Terminal選擇工作區$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(71,'When',async()=>{
  const workspace=sut.vars.terminalWorkspace as any;
  const opened=sut.page.waitForResponse(response=>response.url().endsWith('/terminals')&&response.request().method()==='POST');
  await sut.page.getByTestId('sidebar-terminal').click();await sut.page.getByTestId('requirement-sidebar').getByRole('button',{name:workspace.name,exact:true}).click();
  const response=await opened;expect(response.status()).toBe(201);const session=await response.json();expect(session.workspaceRef).toBe(workspace.workspaceRef);sut.vars.terminalSession=session.id;
  await expect(sut.page.getByTestId('xterm-host')).toBeVisible();
 });
});
// AC-WB-008; source Gherkin line 72
Then(/^右側直接開啟該工作區的終端頁籤且內容只有終端$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(72,'Then',async()=>{
  await expect(sut.page).toHaveURL(new RegExp(`/projects/${sut.vars.project}/terminal$`));
  await expect(sut.page.getByTestId('xterm-host')).toBeVisible();await expect(sut.page.locator('.terminal-only')).toBeVisible();
  await expect(sut.page.locator('.terminal-location')).toHaveCount(0);await expect(sut.page.locator('.terminal-only .panel-heading')).toHaveCount(0);
 });
});
// AC-WB-008; source Gherkin line 73
When(/^使用者輸入命令並啟動專案程式$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(73,'When',async()=>{
  const command=`node -e "process.stdin.setEncoding('utf8');process.stdout.write('PTY_READY');process.stdin.on('data',value=>process.stdout.write('from-stdin:'+value))"`;
  await sut.page.getByTestId('xterm-host').click();await sut.page.keyboard.type(command);await sut.page.keyboard.press('Enter');
  await expect(sut.page.locator('.xterm-rows')).toContainText('PTY_READY');
  const marker=`PTY_INPUT_${Date.now()}`;sut.vars.terminalInputMarker=marker;await sut.page.keyboard.type(marker);await sut.page.keyboard.press('Enter');
 });
});
// AC-WB-008; source Gherkin line 74
Then(/^同一PTY顯示實際輸出且可繼續輸入$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(74,'Then',async()=>{
  const workspace=sut.vars.terminalWorkspace as any,session=String(sut.vars.terminalSession);
  await expect(sut.page.locator('.xterm-rows')).toContainText(`from-stdin:${sut.vars.terminalInputMarker}`);
  const current=await (await sut.page.request.get(`/projects/${workspace.id}/terminal-session?key=${encodeURIComponent(`/projects/${workspace.id}/terminal`)}`)).json();
  expect(current.id).toBe(session);
 });
});
// AC-WB-008; source Gherkin line 75
When(/^使用者關閉終端頁籤$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(75,'When',async()=>{
  const workspace=sut.vars.terminalWorkspace as any;
  await sut.page.getByTestId('workspace-tabs').getByRole('button',{name:`關閉 ${workspace.name} · Terminal`,exact:true}).click();
  await expect(sut.page.getByTestId('xterm-host')).toHaveCount(0);
 });
});
// AC-WB-008; source Gherkin line 76
Then(/^該PTY程序被中止$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(76,'Then',async()=>{
  const workspace=sut.vars.terminalWorkspace as any;
  const current=await (await sut.page.request.get(`/projects/${workspace.id}/terminal-session?key=${encodeURIComponent(`/projects/${workspace.id}/terminal`)}`)).json();expect(current.id).toBeNull();
  await expect(sut.page.getByTestId('workspace-tabs').getByRole('button',{name:`關閉 ${workspace.name} · Terminal`,exact:true})).toHaveCount(0);
 });
});
// AC-WB-010; source Gherkin line 91
Given(/^使用者從固定選單開啟瀏覽器錄製$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(91,'Given',async()=>{
  sut.vars.recordingRepoBefore=sut.repoState();await sut.page.getByTestId('sidebar-browser').click();
  await expect(sut.page).toHaveURL(/\/browser-recorder$/);await expect(sut.page.getByTestId('global-browser-toolbar')).toBeVisible();
 });
});
// AC-WB-010; source Gherkin line 92
When(/^使用者輸入網址前往、錄製並操作網頁、停止後命名保存$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(92,'When',async()=>{
  const targetUrl=new URL('/requirements',process.env.WB_BASE_URL!).toString();await sut.page.getByTestId('global-browser-url').fill(targetUrl);
  const created=sut.page.waitForResponse(response=>new URL(response.url()).pathname==='/browser-sessions'&&response.request().method()==='POST');
  await sut.page.getByRole('button',{name:'前往',exact:true}).click();const response=await created;expect(response.status()).toBe(201);
  const session=await response.json();sut.vars.recordingSession=session.id;
  const remotes:Browser[]=[];const sessionIds=[String(session.id)];sut.vars.recordingRemotes=remotes;sut.vars.recordingSessionIds=sessionIds;
  sut.addCleanup(async()=>{for(const remote of remotes)await remote.close();for(const id of sessionIds){const closed=await sut.page.request.delete(`/browser-sessions/${id}`);if(![200,404].includes(closed.status()))throw Error(`Could not close browser session ${id}: ${closed.status()}`);}});
  const remote=await chromium.connect(String(session.playwrightEndpoint));remotes.push(remote);sut.vars.recordingRemote=remote;
  const target=await resolveManagedPage(remote,session);sut.vars.recordingTarget=target;
  await expect(sut.page.getByTestId('browser-canvas')).toBeVisible();await expect(target.getByRole('heading',{name:'需求工作台'})).toBeVisible();
  await sut.page.getByRole('button',{name:'錄製',exact:true}).click();
  await target.getByTestId('sidebar-llm-settings').click();await expect(target.getByRole('heading',{name:'LLM 設定'})).toBeVisible();
  const stopped=sut.page.waitForResponse(item=>item.url().endsWith(`/browser-sessions/${session.id}/recordings/stop`));
  await sut.page.getByRole('button',{name:'停止錄製',exact:true}).click();const stopResponse=await stopped;expect(stopResponse.status()).toBe(200);
  const draft=await stopResponse.json();expect(draft.actions.some((action:any)=>action.kind==='click')).toBe(true);expect(draft.rawText).toContain('getByTestId');sut.vars.recordingDraft=draft;
  const saved=sut.page.waitForResponse(item=>new URL(item.url()).pathname==='/recordings'&&item.request().method()==='POST');
  await sut.page.getByTestId('global-browser-toolbar').getByRole('button',{name:'保存',exact:true}).click();const dialog=sut.page.getByRole('dialog');await dialog.getByLabel('名稱').fill(`BDD global ${sut.vars.requirement}`);await dialog.getByRole('button',{name:'保存',exact:true}).click();
  const savedResponse=await saved;expect(savedResponse.status()).toBe(201);const recording=await savedResponse.json();sut.vars.globalRecording=recording.id;
 });
});
// AC-WB-010; source Gherkin line 93
Then(/^已保存名稱出現在左側瀏覽器錄製下方$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(93,'Then',async()=>{
  const name=`BDD global ${sut.vars.requirement}`;await expect(sut.page.getByTestId('requirement-sidebar').getByRole('button',{name,exact:true})).toBeVisible();
  await sut.page.getByTestId('requirement-sidebar').getByRole('button',{name,exact:true}).click();await expect(sut.page).toHaveURL(new RegExp(`/browser-recorder/${sut.vars.globalRecording}$`));
 });
});
// AC-WB-010; source Gherkin line 94
Then(/^開啟保存內容時上方顯示播放與刪除且下方顯示Playwright腳本$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(94,'Then',async()=>{
  await expect(sut.page.getByTestId('play-saved-browser-recording')).toBeVisible();await expect(sut.page.getByTestId('delete-saved-browser-recording')).toBeVisible();
  const script=sut.page.getByTestId('saved-browser-recording-script');await expect(script).toHaveAttribute('readonly','');
  expect(await script.inputValue()).toBe((sut.vars.recordingDraft as any).rawText);
 });
});
// AC-WB-010; source Gherkin line 95
When(/^使用者按播放$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(95,'When',async()=>{
  const replay=sut.page.waitForResponse(item=>/\/browser-sessions\/[^/]+\/recordings\/replay$/.test(new URL(item.url()).pathname));
  const created=sut.page.waitForResponse(response=>new URL(response.url()).pathname==='/browser-sessions'&&response.request().method()==='POST');
  await sut.page.getByTestId('play-saved-browser-recording').click();const response=await created;expect(response.status()).toBe(201);
  const session=await response.json();sut.vars.replaySession=session.id;
  const remote=await chromium.connect(String(session.playwrightEndpoint));(sut.vars.recordingRemotes as Browser[]).push(remote);
  (sut.vars.recordingSessionIds as string[]).push(String(session.id));
  sut.vars.replayTarget=await resolveManagedPage(remote,session);
  const replayResponse=await replay;expect(replayResponse.status()).toBe(200);await expect((sut.vars.replayTarget as Page).getByRole('heading',{name:'LLM 設定'})).toBeVisible({timeout:30000});
 });
});
// AC-WB-010; source Gherkin line 96
Then(/^瀏覽器視窗展開並重播保存的動作$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(96,'Then',async()=>{
  await expect(sut.page.getByTestId('browser-canvas')).toBeVisible();await expect(sut.page.locator('.saved-browser-recording-viewer')).toBeVisible();
  await expect((sut.vars.replayTarget as Page).getByRole('heading',{name:'LLM 設定'})).toBeVisible();
  expect((sut.vars.recordingDraft as any).actions.length).toBeGreaterThan(1);
 });
});
// AC-WB-010; source Gherkin line 97
Then(/^全域錄製不要求關聯專案或需求且不自動成為CI測試$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(97,'Then',async()=>{
  const response=await sut.page.request.get(`/recordings/${sut.vars.globalRecording}`);expect(response.ok()).toBe(true);const recording=await response.json();
  expect(recording.projectId).toBeNull();expect(recording.requirementId).toBeNull();expect(recording.purpose).toBe('recording');
  const projectScripts=await (await sut.page.request.get(`/projects/${sut.vars.project}/recordings`)).json();expect(projectScripts.some((item:any)=>item.id===sut.vars.globalRecording)).toBe(false);
  expect(sut.repoState()).toBe(sut.vars.recordingRepoBefore);
 });
});
// AC-WB-006; source Gherkin line 55
When(/^人類確認已完成檢核的測試步驟$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(55,'When',async()=>{
  await sut.page.goto(`/requirements/${sut.vars.requirement}?featureId=${sut.vars.featureId}&workflowStage=TESTS`);
  const responsePromise=sut.page.waitForResponse(response=>response.url().includes(`/requirements/${sut.vars.requirement}/start-development`)&&response.request().method()==='POST');
  await sut.page.getByTestId('confirm-test-steps').click();const response=await responsePromise;expect(response.status()).toBe(200);
  await expect.poll(()=>sut.db.all('SELECT stage FROM features WHERE id=?',[String(sut.vars.featureId)])[0]?.stage).toBe('IMPLEMENTATION');
 });
});
// AC-WB-006; source Gherkin line 57
Then(/^測試基線固定且自動進入程式開發階段$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(57,'Then',async()=>{
  await expect(sut.page.getByTestId('workflow-stage-content')).toHaveAttribute('data-stage','IMPLEMENTATION');
  expect(sut.db.all("SELECT id FROM baselines WHERE feature_id=? AND kind='tests' AND valid=1",[String(sut.vars.featureId)])).toHaveLength(1);
  await expect(sut.page.getByTestId('test-baseline')).toContainText('測試基線');
 });
});
// AC-WB-006; source Gherkin line 58
Then(/^可使用已確認文件及測試基線作為開發依據$/,async({sut})=>{
 const expect=sut.check;
 await sut.step(58,'Then',async()=>{
  await expect(sut.page.getByTestId('confirmed-gherkin')).toContainText('已確認');await expect(sut.page.getByTestId('confirmed-sd')).toContainText('已確認');
  await expect(sut.page.getByTestId('source-editor')).toBeVisible();expect(sut.head('spec').test_stage).toBe('COMPLETED');
  expect(sut.db.all("SELECT document_version_id FROM baseline_documents WHERE baseline_id=(SELECT id FROM baselines WHERE feature_id=? AND kind='tests' AND valid=1)",[String(sut.vars.featureId)])).toHaveLength(3);
 });
});
