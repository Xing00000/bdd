import { Given, When, Then } from './testing/support/fixtures.ts';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { SQLInputValue } from 'node:sqlite';
import { FixtureDatabase, sha } from './testing/support/database.ts';
import { SelectionProbe } from './testing/support/selection.ts';
import { sourceFeature, specText, fixtureSql } from './testing/fixtures/content.ts';
const phases: Record<string, string> = { 'Gherkin確認': 'GHERKIN', 'SD確認': 'SD', 'test generation/completion': 'TESTS', implementation: 'IMPLEMENTATION', 'verification/report': 'VERIFICATION' };
// Background; source Gherkin line 9
Given(/^已選擇工作台的共用專案$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(9, 'Given', async () => {
        await sut.page.goto(`/projects/${sut.vars.project}/requirements/${sut.vars.requirement}`);
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
            await expect(sut.page.getByTestId('workflow-stage')).toContainText("Gherkin確認");
        }
        {
            await expect(sut.page.getByTestId("generate-tests")).toBeDisabled();
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
            await expect(sut.page.getByTestId('workflow-stage')).toContainText("test generation/completion");
        }
        {
            await expect(sut.page.getByTestId("complete-tests")).toBeVisible();
        }
        {
            await sut.page.getByTestId("complete-tests").click();
        }
        {
            await expect(sut.page.getByTestId('test-readiness')).toHaveText('COMPLETED', { timeout: 60000 });
        }
        {
            await sut.page.getByTestId("start-development").click();
        }
        {
            const stage = "IMPLEMENTATION";
            await expect.poll(() => sut.db.all('SELECT stage FROM features WHERE id=?', [String(sut.vars.featureId)])[0]?.stage).toBe(stage);
            await expect(sut.page.getByTestId('workflow-stage')).toContainText("implementation");
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
Given(/^兩位使用者開啟同一個共用專案$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(22, 'Given', async () => {
        await sut.page.goto(`/projects/${sut.vars.project}/requirements/${sut.vars.requirement}`);
    });
});
// AC-WB-002; source Gherkin line 23
When(/^一位使用者在專案保存Gherkin或SD文件$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(23, 'When', async () => {
        await sut.save({ "kind": "gherkin" });
    });
});
// AC-WB-002; source Gherkin line 24
Then(/^另一位使用者可在該專案讀取相同文件內容$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(24, 'Then', async () => {
        sut.other = await sut.context.browser()!.newContext({ baseURL: process.env.WB_BASE_URL });
        const other = sut.tracker.wrapPage(await sut.other.newPage());
        await other.goto(`/projects/${sut.vars.project}/requirements/${sut.vars.requirement}`);
        await expect(other.getByTestId('gherkin-editor')).toHaveValue(String(sut.vars.feature));
    });
});
// AC-WB-003; source Gherkin line 28
Given(/^工作台顯示專案處於Gherkin確認階段且已有Gherkin草稿$/, async ({ sut }) => {
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
// AC-WB-003; source Gherkin line 29
When(/^人類按下確認Gherkin並要求產生SD$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(29, 'When', async () => {
        {
            await sut.page.getByTestId("confirm-gherkin").click();
        }
        {
            const completed=sut.page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===`/requirements/${sut.vars.requirement}/generate-sd`);
            await sut.page.getByTestId("generate-sd").click();
            const response=await completed;expect(response.ok()).toBe(true);
        }
    });
});
// AC-WB-003; source Gherkin line 30
Then(/^工作台流程狀態顯示SD確認且開啟SD編輯$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(30, 'Then', async () => {
        {
            const stage = "SD";
            await expect.poll(() => sut.db.all('SELECT stage FROM features WHERE id=?', [String(sut.vars.featureId)])[0]?.stage).toBe(stage);
            await expect(sut.page.getByTestId('workflow-stage')).toContainText("SD確認");
        }
        {
            await expect(sut.page.getByTestId("sd-editor")).toBeVisible();
        }
    });
});
// AC-WB-003; source Gherkin line 31
Then(/^產生對應Gherkin的SD草稿供人類確認$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(31, 'Then', async () => {
        const v = sut.head("sd");
        expect(v.id).not.toBe(sut.vars["sd" + 'Version']);
    });
});
// AC-WB-003; source Gherkin line 32
Then(/^SD包含程式架構以及本次資料庫DDL與DML內容$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(32, 'Then', async () => {
        const raw = String(sut.head('sd').raw_text);
        expect(raw).toMatch(/架構|Architecture/i);
        expect(raw).toMatch(/DDL|CREATE/i);
        expect(raw).toMatch(/DML|INSERT|UPDATE|SELECT/i);
    });
});
// AC-WB-003; source Gherkin line 33
Then(/^人類尚未確認SD時不進入產品開發$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(33, 'Then', async () => {
        await expect(sut.page.getByTestId("start-development")).toBeDisabled();
    });
});
// AC-WB-004; source Gherkin line 37
Given(/^人類已確認專案Gherkin且工作台正顯示SD確認階段$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(37, 'Given', async () => {
        sut.db.stage("SD");
        await sut.page.reload();
    });
});
// AC-WB-004; source Gherkin line 38
Given(/^已備妥Gherkin生成器設定與明確的step definitions$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(38, 'Given', async () => {
        expect(readFileSync('spec/REQ-WB-001/workbench/testing/fixtures/target.steps.ts', 'utf8')).toContain('createBdd(test)');
    });
});
// AC-WB-004; source Gherkin line 39
When(/^人類按下確認SD並要求產生測試$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(39, 'When', async () => {
        {
            await sut.page.getByTestId("confirm-sd").click();
        }
        {
            await sut.page.getByTestId('step-definitions-upload').setInputFiles('spec/REQ-WB-001/workbench/testing/fixtures/target.steps.ts');
        }
        {
            await sut.provideCompletionContext();
            await sut.page.getByTestId("generate-tests").click();
        }
    });
});
// AC-WB-004; source Gherkin line 40
Then(/^工作台流程狀態顯示test generation\/completion$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(40, 'Then', async () => {
        const stage = "TESTS";
        await expect.poll(() => sut.db.all('SELECT stage FROM features WHERE id=?', [String(sut.vars.featureId)])[0]?.stage).toBe(stage);
        await expect(sut.page.getByTestId('workflow-stage')).toContainText("test generation/completion");
    });
});
// AC-WB-004; source Gherkin line 41
Then(/^產生可由Playwright找到的spec\.ts檔案$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(41, 'Then', async () => {
        const raw = await sut.page.getByTestId('generated-spec-source').inputValue();
        expect(raw).toMatch(/test\s*\(/);
        sut.checkSyntax(raw);
        await expect(sut.page.getByTestId('generated-spec-path')).toContainText('.spec.ts');
        await sut.discoverProductBundle(raw);
    });
});
// AC-WB-004; source Gherkin line 42
Then(/^每個生成案例可對應來源Scenario及Examples列$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(42, 'Then', async () => {
        const raw = await sut.page.getByTestId('generated-manifest').inputValue();
        const manifest = JSON.parse(raw) as {
            cases: {
                scenarioId: string;
                caseId: string;
                testKey: string;
            }[];
        };
        expect(manifest.cases.map(c => [c.scenarioId, c.caseId])).toEqual(expect.arrayContaining([['AC-DEMO-001', 'a'], ['AC-DEMO-001', 'b']]));
        expect(manifest.cases.length).toBeGreaterThanOrEqual(2);
        expect(new Set(manifest.cases.map(c => c.testKey)).size).toBe(manifest.cases.length);
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
// AC-WB-005; source Gherkin line 47
When(/^LLM補齊操作步驟與預期結果的測試內容$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(47, 'When', async () => {
        const runCompletion = async (db: FixtureDatabase) => {
            await sut.page.goto(`/projects/${db.vars.project}/requirements/${db.vars.requirement}`);
            const waiting = sut.page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === `/requirements/${db.vars.requirement}/complete-tests`);
            await sut.page.getByTestId('complete-tests').click();
            const response = await waiting;
            expect(response.ok()).toBe(true);
            return response.json() as Promise<Record<string, unknown>>;
        };
        await runCompletion(sut.db);
        await expect(sut.page.getByTestId('test-readiness')).toHaveText('COMPLETED', { timeout: 60000 });
        const missing = new FixtureDatabase(process.env.WB_METADATA_DB!, sut.targetUrl, process.env.WB_TARGET_DB!, true);
        sut.secondary.push(missing);
        missing.stage('TESTS');
        const source = sut.documentSource(missing), result = await runCompletion(missing);
        await expect(sut.page.getByTestId('llm-needs-input')).toContainText('預期');
        sut.llmMissing = { db: missing, source, result };
        await sut.page.goto(`/projects/${sut.vars.project}/requirements/${sut.vars.requirement}`);
    });
});
// AC-WB-005; source Gherkin line 48
Then(/^補齊的測試仍對應人類已確認的驗收條件$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(48, 'Then', async () => {
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
// AC-WB-005; source Gherkin line 49
Then(/^缺少預期結果資訊時列出待補內容而不自行改寫驗收條件$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(49, 'Then', async () => {
        const missing = sut.llmMissing!;
        expect(missing.result.status).toBe('needs_input');
        expect((missing.result.questions as unknown[]).length).toBeGreaterThan(0);
        const versions = missing.db.all('SELECT v.* FROM document_heads h JOIN document_versions v ON v.id=h.version_id WHERE h.document_id=?', [missing.db.vars.specDoc]);
        expect(['SKELETON', 'COMPLETION_DRAFT']).toContain(versions[0].test_stage);
        expect(missing.db.all("SELECT id FROM baselines WHERE requirement_id=? AND kind='tests' AND valid=1", [missing.db.vars.requirement])).toHaveLength(0);
        expect(sut.documentSource(missing.db)).toBe(missing.source);
    });
});
// AC-WB-006; source Gherkin line 53
Given(/^Gherkin與SD已確認且測試規格已補齊$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(53, 'Given', async () => {
        {
            sut.db.stage("TESTS");
            await sut.page.reload();
        }
        {
            sut.db.baseline(false);
        }
    });
});
// AC-WB-006; source Gherkin line 54
When(/^使用者在工作台按下開始開發$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(54, 'When', async () => {
        await sut.page.getByTestId("start-development").click();
    });
});
// AC-WB-006; source Gherkin line 55
Then(/^工作台流程狀態顯示implementation$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(55, 'Then', async () => {
        const stage = "IMPLEMENTATION";
        await expect.poll(() => sut.db.all('SELECT stage FROM features WHERE id=?', [String(sut.vars.featureId)])[0]?.stage).toBe(stage);
        await expect(sut.page.getByTestId('workflow-stage')).toContainText("implementation");
    });
});
// AC-WB-006; source Gherkin line 56
Then(/^可使用確認文件與測試作為開發依據$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(56, 'Then', async () => {
        {
            await expect(sut.page.getByTestId("confirmed-gherkin")).toBeVisible();
        }
        {
            await expect(sut.page.getByTestId("confirmed-sd")).toBeVisible();
        }
        {
            await expect(sut.page.getByTestId("test-baseline")).toBeVisible();
        }
    });
});
// AC-WB-006; source Gherkin line 57
Then(/^開發完成後可開始驗證該次開發成果$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(57, 'Then', async () => {
        const sourceRef = sut.vars.sourceRef;
        if (!sourceRef)
            throw Error('WB_SOURCE_REF required; no fictitious source revision');
        const baselines = sut.db.all("SELECT id FROM baselines WHERE requirement_id=? AND kind='tests' AND valid=1", [String(sut.vars.requirement)]);
        expect(baselines).toHaveLength(1);
        sut.vars.baseline = baselines[0].id;
        await sut.request(`/requirements/${sut.vars.requirement}/verify`, { testBaselineId: sut.vars.baseline, sourceRef, selection: { mode: 'ALL_REQUIRED', sourceCaseIds: [] } }, [200, 201, 202]);
    });
});
// AC-WB-007; source Gherkin line 61
Given(/^共用專案已有SQLite資料庫連線$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(61, 'Given', async () => {
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
// AC-WB-007; source Gherkin line 62
When(/^使用者瀏覽schema與資料並執行本次SD內的DDL或DML$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(62, 'When', async () => {
        {
            await sut.queryUi(fixtureSql);
        }
        {
            await sut.queryUi("UPDATE test_accounts SET role_code='B' WHERE username='scenario_user'; SELECT role_code FROM test_accounts WHERE username='scenario_user';");
        }
    });
});
// AC-WB-007; source Gherkin line 63
Then(/^工作台顯示實際schema與資料及SQL執行結果$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(63, 'Then', async () => {
        {
            await expect(sut.page.getByTestId('db-results')).toContainText("B");
            expect((sut.vars.dbRows as Record<string, unknown>[]).some(row => Object.values(row).includes("B"))).toBe(true);
            sut.last = await sut.page.getByTestId('db-results').innerText();
        }
        {
            sut.last = await sut.page.getByTestId("sql-execution-state").textContent();
            await expect(sut.page.getByTestId("sql-execution-state")).toContainText("completed");
        }
        {
            await sut.page.getByTestId('db-schema-refresh').click();
            await expect(sut.page.getByTestId('db-schema')).toContainText('test_accounts');
            await expect(sut.page.getByTestId('db-schema')).toContainText('role_code');
        }
    });
});
// AC-WB-007; source Gherkin line 64
Then(/^重新讀取資料庫時可看到實際變更$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(64, 'Then', async () => {
        {
            await sut.queryUi("SELECT role_code FROM test_accounts WHERE username='scenario_user';");
        }
        {
            await expect(sut.page.getByTestId('db-results')).toContainText("B");
            expect((sut.vars.dbRows as Record<string, unknown>[]).some(row => Object.values(row).includes("B"))).toBe(true);
            sut.last = await sut.page.getByTestId('db-results').innerText();
        }
    });
});
// AC-WB-008; source Gherkin line 68
Given(/^專案工作區已開啟$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(68, 'Given', async () => {
        {
            sut.db.stage("IMPLEMENTATION");
            await sut.page.reload();
        }
        {
            await sut.page.getByTestId("open-terminal").click();
        }
    });
});
// AC-WB-008; source Gherkin line 69
When(/^使用者在PTY終端輸入命令並啟動專案程式$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(69, 'When', async () => {
        const terminal = await sut.page.getByTestId('terminal-session-id').innerText();
        if (sut.vars.terminal)
            expect(terminal).toBe(sut.vars.terminal);
        else
            sut.vars.terminal = terminal;
        await sut.page.getByTestId('terminal-input').fill("node -e \"console.log(Buffer.from('UFRZX0ZJUlNU','base64').toString())\"".trimEnd());
        await sut.page.getByTestId('terminal-input').press('Enter');
    });
});
// AC-WB-008; source Gherkin line 70
Then(/^終端顯示該命令或程式的實際輸出$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(70, 'Then', async () => {
        sut.last = await sut.page.getByTestId("terminal-output").textContent();
        await expect(sut.page.getByTestId("terminal-output")).toContainText("PTY_FIRST");
    });
});
// AC-WB-008; source Gherkin line 71
Then(/^使用者可繼續透過同一終端輸入$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(71, 'Then', async () => {
        {
            const terminal = await sut.page.getByTestId('terminal-session-id').innerText();
            if (sut.vars.terminal)
                expect(terminal).toBe(sut.vars.terminal);
            else
                sut.vars.terminal = terminal;
            await sut.page.getByTestId('terminal-input').fill("node -e \"console.log(Buffer.from('UFRZX1NFQ09ORA==','base64').toString())\"".trimEnd());
            await sut.page.getByTestId('terminal-input').press('Enter');
        }
        {
            sut.last = await sut.page.getByTestId("terminal-output").textContent();
            await expect(sut.page.getByTestId("terminal-output")).toContainText("PTY_SECOND");
        }
    });
});
// AC-WB-009; source Gherkin line 75
Given(/^專案已有Playwright瀏覽器會話$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(75, 'Given', async () => {
        await sut.browser();
    });
});
// AC-WB-009; source Gherkin line 76
When(/^"([^"]*)"使用Playwright操作該會話的網頁$/, async ({ sut }, arg0: string) => {
    const expect = sut.check;
    await sut.step(76, 'When', async () => {
        if (!sut.target)
            await sut.browser();
        sut.frameBefore = sha(await sut.page.getByTestId('browser-canvas').screenshot());
        const marker = `${String(arg0 ?? '')}-${sut.vars.project}`;
        sut.vars.marker = marker;
        await sut.target!.getByTestId('document-content').fill(marker);
        await expect(sut.target!.getByTestId('document-content')).toHaveValue(marker);
    });
});
// AC-WB-009; source Gherkin line 77
Then(/^工作台內嵌畫面顯示該會話當前的網頁操作結果$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(77, 'Then', async () => {
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
// AC-WB-009; source Gherkin line 78
Then(/^顯示的是操作中的會話而不是事後trace報告$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(78, 'Then', async () => {
        {
            sut.last = await sut.page.getByTestId("browser-stream-state").textContent();
            await expect(sut.page.getByTestId("browser-stream-state")).toContainText("live");
        }
        {
            await expect(sut.page.getByTestId("trace-viewer")).toBeHidden();
        }
    });
});
// AC-WB-010; source Gherkin line 86
Given(/^使用者已在工作台開啟可親自操作的內嵌瀏覽器$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(86, 'Given', async () => {
        {
            await sut.browser();
        }
        {
            sut.sourcesBefore = sut.sourceSnapshot();
        }
        {
            sut.repoBefore = sut.repoState();
        }
    });
});
// AC-WB-010; source Gherkin line 87
When(/^使用者按下開始錄製$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(87, 'When', async () => {
        await sut.page.getByTestId('record-start').click();
        await expect(sut.page.getByTestId('recording-state')).toHaveText('recording');
    });
});
// AC-WB-010; source Gherkin line 88
When(/^使用者親自導覽網頁與點擊及輸入並選擇定位器與預期結果$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(88, 'When', async () => {
        await sut.humanActions();
    });
});
// AC-WB-010; source Gherkin line 89
When(/^使用者按下停止錄製$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(89, 'When', async () => {
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
    });
});
// AC-WB-010; source Gherkin line 90
Then(/^產生包含該次操作與斷言的可檢查Playwright TypeScript腳本草稿$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(90, 'Then', async () => {
        expect(sut.draft).toContain('recorded-');
        expect(sut.draft).toMatch(/expect\s*\(/);
        expect(sut.draft).toMatch(/fill\s*\(/);
    });
});
// AC-WB-010; source Gherkin line 91
Then(/^停止後的新操作不再加入該次錄製$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(91, 'Then', async () => {
        await sut.humanInput('after-stop');
        expect(await sut.page.getByTestId('recording-script').inputValue()).toBe(sut.draft);
    });
});
// AC-WB-010; source Gherkin line 92
Then(/^該草稿屬於使用者自錄腳本而不是自動新增的標準CI測試$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(92, 'Then', async () => {
        {
            sut.last = await sut.page.getByTestId("recording-purpose").textContent();
            await expect(sut.page.getByTestId("recording-purpose")).toContainText("recording");
        }
        {
            expect(sut.repoState(), 'target Git and CI list unchanged').toBe(sut.repoBefore);
        }
    });
});
// AC-WB-010; source Gherkin line 93
Then(/^不會自動更改Gherkin驗收條件$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(93, 'Then', async () => {
        expect(sut.sourceSnapshot()).toBe(sut.sourcesBefore);
    });
});
// AC-WB-011; source Gherkin line 97
Given(/^測試被指定為被開發專案的CI測試$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(97, 'Given', async () => {
        {
            sut.db.stage("TESTS");
            await sut.page.reload();
        }
        {
            sut.repoBefore = sut.repoState();
        }
    });
});
// AC-WB-011; source Gherkin line 98
When(/^保存測試並在該專案CI執行$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(98, 'When', async () => {
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
// AC-WB-011; source Gherkin line 99
Then(/^測試檔案跟著該專案Git的branch與commit$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(99, 'Then', async () => {
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
// AC-WB-011; source Gherkin line 100
Then(/^CI結果可對應該專案的實際commit$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(100, 'Then', async () => {
        const run = sut.db.all('SELECT candidate_commit,tested_commit FROM runs WHERE id=?', [String(sut.vars.run)])[0];
        expect(run?.candidate_commit).toBe(sut.vars.targetCommit);
        expect(typeof run.tested_commit).toBe('string');
        const commit = execFileSync('git', ['-C', process.env.WB_TARGET_REPO!, 'rev-parse', String(run.tested_commit) + '^{commit}'], { encoding: 'utf8' }).trim();
        expect(commit).toBe(run.tested_commit);
    });
});
// AC-WB-011; source Gherkin line 101
Then(/^工作台可在SQLite保存及讀回該commit對應的spec\.ts內容副本$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(101, 'Then', async () => {
        const kind = "spec";
        const doc = sut.vars[kind + 'Doc'];
        sut.last = sut.db.all('SELECT v.raw_text,v.raw_sha256,v.id FROM document_heads h JOIN document_versions v ON v.id=h.version_id WHERE h.document_id=?', [String(doc)])[0];
        expect((sut.last as Record<string, unknown>)?.raw_text).toBe(sut.vars.savedSpec);
        expect((sut.last as Record<string, unknown>)?.raw_sha256).toBe(sha(String((sut.last as Record<string, unknown>).raw_text)));
    });
});
// AC-WB-011; source Gherkin line 102
Then(/^該資料庫副本不取代target Git的標準CI測試版本或改變CI測試清單$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(102, 'Then', async () => {
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
// AC-WB-012; source Gherkin line 106
Given(/^使用者建立自己的整合測試$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(106, 'Given', async () => {
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
// AC-WB-012; source Gherkin line 107
When(/^在工作台保存測試定義與目標環境並要求執行$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(107, 'When', async () => {
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
// AC-WB-012; source Gherkin line 108
Then(/^測試定義與執行紀錄保存在工作台SQLite$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(108, 'Then', async () => {
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
// AC-WB-012; source Gherkin line 109
Then(/^該測試不會自動寫入被開發專案Git$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(109, 'Then', async () => {
        expect(sut.repoState(), 'target Git and CI list unchanged').toBe(sut.repoBefore);
    });
});
// AC-WB-013; source Gherkin line 113
Given(/^專案開發完成且驗證測試已備妥$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(113, 'Given', async () => {
        {
            sut.db.stage("IMPLEMENTATION");
            await sut.page.reload();
        }
        {
            sut.db.baseline(false);
        }
    });
});
// AC-WB-013; source Gherkin line 114
When(/^使用者在工作台提交驗證並執行對應E2E測試$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(114, 'When', async () => {
        await sut.request(String((`/requirements/${sut.vars.requirement}/verify`)), ({ "testBaselineId": sut.vars.baseline, "sourceRef": sut.vars.sourceRef, "selection": { "mode": "ALL_REQUIRED", "sourceCaseIds": [] } }), (([200, 201, 202])) as number | number[]);
    });
});
// AC-WB-013; source Gherkin line 115
Then(/^工作台流程狀態顯示verification\/report$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(115, 'Then', async () => {
        const stage = "VERIFICATION";
        await expect.poll(() => sut.db.all('SELECT stage FROM features WHERE id=?', [String(sut.vars.featureId)])[0]?.stage).toBe(stage);
        await expect(sut.page.getByTestId('workflow-stage')).toContainText("verification/report");
    });
});
// AC-WB-013; source Gherkin line 116
Then(/^報告列出各驗收案例的實際執行結果$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(116, 'Then', async () => {
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
// AC-WB-013; source Gherkin line 117
Then(/^報告可對應Gherkin案例與被驗證的程式版本$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(117, 'Then', async () => {
        const report = sut.vars.report as Record<string, unknown>;
        expect(report.sourceRef).toBe(sut.vars.sourceRef);
        expect(report.gherkinVersionId).toBe(sut.vars.gherkinVersion);
        expect(report.testBaselineId).toBe(sut.vars.baseline);
    });
});
// AC-WB-013; source Gherkin line 118
Then(/^未通過或未執行的案例不被報成通過$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(118, 'Then', async () => {
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
// AC-WB-013; source Gherkin line 119
Then(/^Playwright截圖可對應Scenario與step及該步驟實際結果$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(119, 'Then', async () => {
        await sut.evidence();
    });
});
// AC-WB-014; source Gherkin line 123
Given(/^Gherkin含有尚未定義或尚未實作的測試步驟$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(123, 'Given', async () => {
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
// AC-WB-014; source Gherkin line 124
When(/^產生或執行對應測試$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(124, 'When', async () => {
        await sut.request(String((`/requirements/${sut.vars.requirement}/generate-tests`)), ({ "stepDefinitions": [] }), (([422])) as number | number[]);
    });
});
// AC-WB-014; source Gherkin line 125
Then(/^生成器阻擋缺少定義的步驟或測試明確回報未實作$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(125, 'Then', async () => {
        expect(JSON.stringify(sut.last)).toContain('deliberately_missing_step');
        expect(JSON.stringify(sut.last)).toMatch(/UNDEFINED|MISSING|未定義|未實作/i);
    });
});
// AC-WB-014; source Gherkin line 126
Then(/^不以空函式或刪除驗收案例換取通過$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(126, 'Then', async () => {
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
// AC-WB-015; source Gherkin line 130
Given(/^工作台顯示專案目前在"([^"]*)"階段且已有保存內容$/, async ({ sut }, arg0: string) => {
    const expect = sut.check;
    await sut.step(130, 'Given', async () => {
        {
            sut.db.stage(({ Gherkin: 'GHERKIN', 'spec.ts': 'TESTS', SD: 'SD' } as Record<string, string>)[String(arg0 ?? '')] ?? phases[String(arg0 ?? '')] ?? String(arg0 ?? ''));
            await sut.page.reload();
        }
        {
            sut.before = sut.db.snapshot();
        }
    });
});
// AC-WB-015; source Gherkin line 131
When(/^使用者在工作台嘗試保存禁止變更的"([^"]*)"$/, async ({ sut }, arg0: string) => {
    const expect = sut.check;
    await sut.step(131, 'When', async () => {
        const artifact = String(arg0 ?? '').includes('Gherkin') ? 'gherkin' : 'spec';
        await sut.page.getByTestId('open-artifact-save').click();
        await sut.page.getByTestId('artifact-save-kind').selectOption(artifact);
        await sut.page.getByTestId('artifact-save-candidate').fill(artifact === 'gherkin' ? sourceFeature + '\n' : specText(sut.targetUrl));
        const waiting = sut.page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === `/documents/${sut.vars[artifact + 'Doc']}/versions`);
        await sut.page.getByTestId('artifact-save-attempt').click();
        const response = await waiting;
        expect(response.status()).toBe(409);
        sut.last = await response.json();
        await expect(sut.page.getByTestId('artifact-save-error')).toContainText('此階段不可修改該產物');
    });
});
// AC-WB-015; source Gherkin line 132
Then(/^工作台顯示此階段不可修改該產物$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(132, 'Then', async () => {
        expect(JSON.stringify(sut.last)).toContain("ARTIFACT_LOCKED_IN_STAGE");
        expect(JSON.stringify(sut.last)).toContain("此階段不可修改該產物");
    });
});
// AC-WB-015; source Gherkin line 133
Then(/^該產物仍為上次保存內容$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(133, 'Then', async () => {
        expect(sut.db.snapshot(), 'effective original text and projections').toBe(sut.before);
    });
});
// AC-WB-015; source Gherkin line 134
Then(/^工作台只對"([^"]*)"提供本階段的編輯或執行入口$/, async ({ sut }, arg0: string) => {
    const expect = sut.check;
    await sut.step(134, 'Then', async () => {
        sut.last = await sut.page.getByTestId("stage-allowed-artifacts").textContent();
        await expect(sut.page.getByTestId("stage-allowed-artifacts")).toContainText(String(arg0 ?? ''));
        const current = sut.db.all('SELECT stage FROM features WHERE id=?', [String(sut.vars.featureId)])[0].stage;
        if (current === 'GHERKIN')
            await expect(sut.page.getByTestId('gherkin-editor')).toBeEditable();
        if (current === 'SD')
            await expect(sut.page.getByTestId('sd-editor')).toBeEditable();
        if (current === 'TESTS') {
            await expect(sut.page.getByTestId('spec-editor')).toBeEditable();
            await expect(sut.page.getByTestId('step-definitions-upload')).toBeEnabled();
        }
        if (current === 'IMPLEMENTATION')
            await expect(sut.page.getByTestId('source-editor')).toBeEditable();
        if (current === 'VERIFICATION')
            await expect(sut.page.getByTestId('run-verification')).toBeEnabled();
    });
});
// AC-WB-015; source Gherkin line 135
Then(/^"([^"]*)"維持鎖定$/, async ({ sut }, arg0: string) => {
    const expect = sut.check;
    await sut.step(135, 'Then', async () => {
        sut.last = await sut.page.getByTestId("stage-locked-artifacts").textContent();
        await expect(sut.page.getByTestId("stage-locked-artifacts")).toContainText(String(arg0 ?? ''));
        const current = sut.db.all('SELECT stage FROM features WHERE id=?', [String(sut.vars.featureId)])[0].stage;
        if (current !== 'GHERKIN')
            await expect(sut.page.getByTestId('gherkin-editor')).not.toBeEditable();
        if (current !== 'SD')
            await expect(sut.page.getByTestId('sd-editor')).not.toBeEditable();
        if (current !== 'TESTS')
            await expect(sut.page.getByTestId('spec-editor')).not.toBeEditable();
        if (current !== 'IMPLEMENTATION')
            await expect(sut.page.getByTestId('source-editor')).not.toBeEditable();
    });
});
// AC-WB-016; source Gherkin line 146
Given(/^專案已有測試基線與驗證結果$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(146, 'Given', async () => {
        {
            sut.db.stage("VERIFIED");
            await sut.page.reload();
        }
        {
            sut.db.baseline(true);
        }
    });
});
// AC-WB-016; source Gherkin line 147
When(/^使用者在工作台選擇退回修改並指定"([^"]*)"$/, async ({ sut }, arg0: string) => {
    const expect = sut.check;
    await sut.step(147, 'When', async () => {
        sut.vars.returnArtifact = String(arg0 ?? '');
        await sut.page.getByTestId('return-artifact').selectOption({ label: String(arg0 ?? '') });
        const waiting = sut.page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === `/requirements/${sut.vars.requirement}/return`);
        await sut.page.getByTestId('return-stage').click();
        const response = await waiting;
        expect(response.ok()).toBe(true);
    });
});
// AC-WB-016; source Gherkin line 148
Then(/^工作台流程狀態顯示"([^"]*)"才開啟該產物編輯$/, async ({ sut }, arg0: string) => {
    const expect = sut.check;
    await sut.step(148, 'Then', async () => {
        const stage = phases[String(arg0 ?? '')] ?? String(arg0 ?? '');
        await expect.poll(() => sut.db.all('SELECT stage FROM features WHERE id=?', [String(sut.vars.featureId)])[0]?.stage).toBe(stage);
        await expect(sut.page.getByTestId('workflow-stage')).toContainText(String(arg0 ?? ''));
    });
});
// AC-WB-016; source Gherkin line 149
Then(/^工作台將依賴該產物的下游產物與驗證結果標示失效$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(149, 'Then', async () => {
        const baseline = sut.db.all('SELECT valid FROM baselines WHERE id=?', [String(sut.vars.baseline)])[0];
        expect(baseline.valid).toBe(sut.vars.returnArtifact === '產品程式' ? 1 : 0);
        expect(sut.db.all('SELECT status FROM runs WHERE id=?', [String(sut.vars.historicalRun)])[0].status).toBe('INVALID');
    });
});
// AC-WB-016; source Gherkin line 150
Then(/^Gherkin或SD修改後未重新確認時不能再次前進$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(150, 'Then', async () => {
        const stage = sut.db.all('SELECT stage FROM features WHERE id=?', [String(sut.vars.featureId)])[0]?.stage;
        if (stage === 'GHERKIN' || stage === 'SD') {
            await expect(sut.page.getByTestId('start-development')).toBeDisabled();
            await sut.request(`/requirements/${sut.vars.requirement}/start-development`, {}, 409);
        }
        else
            expect(['TESTS', 'IMPLEMENTATION']).toContain(stage);
    });
});
// AC-WB-016; source Gherkin line 151
Then(/^完成該階段要求後依序重新產生或驗證下游結果$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(151, 'Then', async () => {
        await sut.advance();
    });
});
// AC-WB-016; source Gherkin line 152
Then(/^不會在同一階段同時修改Gherkin與spec\.ts$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(152, 'Then', async () => {
        const a = await sut.page.getByTestId('gherkin-editor').isEditable(), b = await sut.page.getByTestId('spec-editor').isEditable();
        expect(a && b).toBe(false);
    });
});
// AC-WB-017; source Gherkin line 163
Given(/^被測專案的測試資料庫有帳號"scenario_user"且角色為"A"與狀態為"active"$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(163, 'Given', async () => {
        await sut.queryUi(fixtureSql);
    });
});
// AC-WB-017; source Gherkin line 164
When(/^spec使用Playwright開啟工作台網頁版DB介面並查詢"scenario_user"$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(164, 'When', async () => {
        await sut.queryUi("SELECT role_code,state FROM test_accounts WHERE username='scenario_user';");
    });
});
// AC-WB-017; source Gherkin line 165
Then(/^spec斷言實際查詢資料的角色為"A"且狀態為"active"$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(165, 'Then', async () => {
        {
            await expect(sut.page.getByTestId('db-results')).toContainText("A");
            expect((sut.vars.dbRows as Record<string, unknown>[]).some(row => Object.values(row).includes("A"))).toBe(true);
            sut.last = await sut.page.getByTestId('db-results').innerText();
        }
        {
            await expect(sut.page.getByTestId('db-results')).toContainText("active");
            expect((sut.vars.dbRows as Record<string, unknown>[]).some(row => Object.values(row).includes("active"))).toBe(true);
            sut.last = await sut.page.getByTestId('db-results').innerText();
        }
        expect(sut.vars.dbRows).toEqual([{ role_code: 'A', state: 'active' }]);
    });
});
// AC-WB-017; source Gherkin line 166
Then(/^每個Playwright操作與斷言步驟保存截圖並對應Scenario與step$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(166, 'Then', async () => {
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
// AC-WB-017; source Gherkin line 167
Then(/^只有實際資料斷言符合預期才算該步驟通過$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(167, 'Then', async () => {
        {
            await expect(sut.page.getByTestId('db-results')).toContainText("A");
            expect((sut.vars.dbRows as Record<string, unknown>[]).some(row => Object.values(row).includes("A"))).toBe(true);
            sut.last = await sut.page.getByTestId('db-results').innerText();
        }
        {
            await expect(sut.page.getByTestId('db-results')).toContainText("active");
            expect((sut.vars.dbRows as Record<string, unknown>[]).some(row => Object.values(row).includes("active"))).toBe(true);
            sut.last = await sut.page.getByTestId('db-results').innerText();
        }
    });
});
// AC-WB-018; source Gherkin line 171
Given(/^被測專案的測試帳號"scenario_user"在測試資料庫角色為"A"且已登入被測網站$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(171, 'Given', async () => {
        {
            await sut.queryUi(fixtureSql);
        }
        {
            await sut.targetLogin();
        }
    });
});
// AC-WB-018; source Gherkin line 172
Given(/^被測網站角色"A"僅可閱讀測試文件而角色"B"可編輯測試文件但不可管理帳號$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(172, 'Given', async () => {
        {
            expect(sut.vars.loggedInRole).toBe("A");
        }
        {
            await expect(sut.target!.getByTestId('document-content')).not.toBeEditable();
        }
    });
});
// AC-WB-018; source Gherkin line 173
When(/^spec使用Playwright透過工作台網頁版DB將"scenario_user"角色由"A"改為"B"並保存$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(173, 'When', async () => {
        await sut.queryUi("UPDATE test_accounts SET role_code='B' WHERE username='scenario_user';");
    });
});
// AC-WB-018; source Gherkin line 174
When(/^spec重新查詢測試資料並斷言角色已實際變成"B"$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(174, 'When', async () => {
        {
            await sut.queryUi("SELECT role_code FROM test_accounts WHERE username='scenario_user';");
        }
        {
            await expect(sut.page.getByTestId('db-results')).toContainText("B");
            expect((sut.vars.dbRows as Record<string, unknown>[]).some(row => Object.values(row).includes("B"))).toBe(true);
            sut.last = await sut.page.getByTestId('db-results').innerText();
        }
    });
});
// AC-WB-018; source Gherkin line 175
When(/^spec登出被測網站的舊登入狀態並以"scenario_user"重新登入$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(175, 'When', async () => {
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
// AC-WB-018; source Gherkin line 176
When(/^spec在被測網站將"scenario_document"內容改為"edited"並開啟管理帳號頁面$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(176, 'When', async () => {
        {
            await sut.target!.getByTestId('document-content').fill('edited');
            await sut.target!.getByTestId('document-save').click();
            await expect(sut.target!.getByTestId('document-saved')).toBeVisible();
            sut.vars.documentSaved = await sut.target!.getByTestId('document-content').inputValue();
        }
        {
            await sut.queryUi('SELECT username,role_code,state FROM test_accounts ORDER BY username;');
            sut.vars.accountsBefore = await sut.page.getByTestId('db-results').innerText();
            await sut.target!.getByTestId('manage-accounts-link').click();
            await expect(sut.target!.getByTestId('access-denied')).toBeVisible();
        }
    });
});
// AC-WB-018; source Gherkin line 177
Then(/^spec斷言新登入頁面可看到角色"B"的編輯入口且文件保存成功$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(177, 'Then', async () => {
        {
            expect(sut.vars.loggedInRole).toBe("B");
        }
        {
            expect(sut.vars.documentSaved).toBe('edited');
        }
    });
});
// AC-WB-018; source Gherkin line 178
Then(/^spec透過網頁版DB斷言"scenario_document"的實際內容為"edited"$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(178, 'Then', async () => {
        {
            await sut.queryUi("SELECT content FROM test_documents WHERE document_key='scenario_document';");
        }
        {
            await expect(sut.page.getByTestId('db-results')).toContainText("edited");
            expect((sut.vars.dbRows as Record<string, unknown>[]).some(row => Object.values(row).includes("edited"))).toBe(true);
            sut.last = await sut.page.getByTestId('db-results').innerText();
        }
    });
});
// AC-WB-018; source Gherkin line 179
Then(/^spec斷言管理帳號頁面顯示拒絕且帳號資料沒有因此變更$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(179, 'Then', async () => {
        {
            await expect(sut.target!.getByTestId('access-denied')).toBeVisible();
        }
        {
            await sut.queryUi("SELECT username,role_code,state FROM test_accounts ORDER BY username;");
        }
        {
            await expect(sut.page.getByTestId('db-results')).toContainText("scenario_user");
            expect((sut.vars.dbRows as Record<string, unknown>[]).some(row => Object.values(row).includes("scenario_user"))).toBe(true);
            sut.last = await sut.page.getByTestId('db-results').innerText();
        }
        {
            await expect(sut.page.getByTestId('db-results')).toContainText("B");
            expect((sut.vars.dbRows as Record<string, unknown>[]).some(row => Object.values(row).includes("B"))).toBe(true);
            sut.last = await sut.page.getByTestId('db-results').innerText();
        }
        {
            await expect(sut.page.getByTestId('db-results')).toContainText("active");
            expect((sut.vars.dbRows as Record<string, unknown>[]).some(row => Object.values(row).includes("active"))).toBe(true);
            sut.last = await sut.page.getByTestId('db-results').innerText();
        }
        {
            expect(await sut.page.getByTestId('db-results').innerText()).toBe(sut.vars.accountsBefore);
        }
    });
});
// AC-WB-018; source Gherkin line 180
Then(/^spec在前置資料確認與DB變更後及重新登入後保存截圖$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(180, 'Then', async () => {
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
// AC-WB-018; source Gherkin line 181
Then(/^spec在每個主要操作與斷言步驟保存截圖並關聯實際結果$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(181, 'Then', async () => {
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
// AC-WB-019; source Gherkin line 185
Given(/^spec正在執行被測專案測試資料庫變更與重新登入的端到端情境$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(185, 'Given', async () => {
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
// AC-WB-019; source Gherkin line 186
When(/^spec在網頁畫面或DB資料斷言得到與預期不同的實際結果$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(186, 'When', async () => {
        await sut.request(String((`/requirements/${sut.vars.requirement}/verify`)), ({ "testBaselineId": sut.vars.baseline, "sourceRef": sut.vars.sourceRef, "selection": { "mode": "ALL_REQUIRED", "sourceCaseIds": [] } }), (([200, 201, 202])) as number | number[]);
    });
});
// AC-WB-019; source Gherkin line 187
Then(/^Playwright保存失敗當下頁面的截圖$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(187, 'Then', async () => {
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
// AC-WB-019; source Gherkin line 188
Then(/^報告列出該Scenario與失敗step及預期值與實際值及截圖$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(188, 'Then', async () => {
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
// AC-WB-019; source Gherkin line 189
Then(/^該案例標示失敗而不因截圖保存成功改成通過$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(189, 'Then', async () => {
        expect((sut.vars.report as Record<string, unknown>)?.status).toBe("FAILED");
    });
});
// AC-WB-020; source Gherkin line 193
Given(/^上一次執行已將測試帳號"scenario_user"改為角色"B"且測試文件內容已變更$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(193, 'Given', async () => {
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
// AC-WB-020; source Gherkin line 194
When(/^spec開始下一次執行並透過網頁版DB將該測試帳號角色設為"A"與"scenario_document"內容設為"initial"$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(194, 'When', async () => {
        await sut.queryUi(fixtureSql);
    });
});
// AC-WB-020; source Gherkin line 195
When(/^spec結束被測網站上一輪的登入狀態$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(195, 'When', async () => {
        if (!sut.target)
            sut.target = sut.tracker.wrapPage(await sut.context.newPage());
        await sut.target.goto(sut.targetUrl);
        await sut.target.getByTestId('logout').click();
        await expect(sut.target.getByTestId('login-submit')).toBeVisible();
    });
});
// AC-WB-020; source Gherkin line 196
Then(/^spec斷言測試資料庫中的角色為"A"且"scenario_document"內容為"initial"$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(196, 'Then', async () => {
        {
            await sut.queryUi("SELECT role_code FROM test_accounts WHERE username='scenario_user';");
        }
        {
            await expect(sut.page.getByTestId('db-results')).toContainText("A");
            expect((sut.vars.dbRows as Record<string, unknown>[]).some(row => Object.values(row).includes("A"))).toBe(true);
            sut.last = await sut.page.getByTestId('db-results').innerText();
        }
        {
            await sut.queryUi("SELECT content FROM test_documents WHERE document_key='scenario_document';");
        }
        {
            await expect(sut.page.getByTestId('db-results')).toContainText("initial");
            expect((sut.vars.dbRows as Record<string, unknown>[]).some(row => Object.values(row).includes("initial"))).toBe(true);
            sut.last = await sut.page.getByTestId('db-results').innerText();
        }
    });
});
// AC-WB-020; source Gherkin line 197
Then(/^Playwright保存本次前置資料初始狀態的截圖$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(197, 'Then', async () => {
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
// AC-WB-020; source Gherkin line 198
Then(/^本次情境從該初始狀態重新執行DB變更與登入及操作驗證流程$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(198, 'Then', async () => {
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
// AC-WB-021; source Gherkin line 202
Given(/^共用專案的當次需求已有"([^"]*)"內容及需求編號與情境編號對應$/, async ({ sut }, arg0: string) => {
    const expect = sut.check;
    await sut.step(202, 'Given', async () => {
        sut.vars["artifact"] = (arg0);
    });
});
// AC-WB-021; source Gherkin line 203
When(/^使用者在"([^"]*)"階段將該產物保存到工作台SQLite$/, async ({ sut }, arg0: string) => {
    const expect = sut.check;
    await sut.step(203, 'When', async () => {
        {
            sut.db.stage(({ Gherkin: 'GHERKIN', 'spec.ts': 'TESTS', SD: 'SD' } as Record<string, string>)[String(arg0 ?? '')] ?? phases[String(arg0 ?? '')] ?? String(arg0 ?? ''));
            await sut.page.reload();
        }
        {
            await sut.save({ "kind": sut.vars.artifact, "extra": true });
        }
    });
});
// AC-WB-021; source Gherkin line 204
When(/^使用者關閉並重新開啟該需求後讀取該產物$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(204, 'When', async () => {
        await sut.page.goto('/projects');
        await sut.page.goto(`/projects/${sut.vars.project}/requirements/${sut.vars.requirement}`);
    });
});
// AC-WB-021; source Gherkin line 205
Then(/^工作台從SQLite讀回與保存時相同的完整內容$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(205, 'Then', async () => {
        const kind = ({ Gherkin: 'gherkin', 'spec.ts': 'spec', SD: 'sd' } as Record<string, string>)[String((sut.vars.artifact))] ?? String((sut.vars.artifact) ?? 'gherkin');
        const doc = sut.vars[kind + 'Doc'];
        sut.last = sut.db.all('SELECT v.raw_text,v.raw_sha256,v.id FROM document_heads h JOIN document_versions v ON v.id=h.version_id WHERE h.document_id=?', [String(doc)])[0];
        expect((sut.last as Record<string, unknown>)?.raw_text).toBe(sut.vars[kind === 'spec' ? 'savedSpec' : kind]);
        expect((sut.last as Record<string, unknown>)?.raw_sha256).toBe(sha(String((sut.last as Record<string, unknown>).raw_text)));
        const artifact = String(sut.vars.artifact), editor = artifact === 'Gherkin' ? 'gherkin-editor' : artifact === 'SD' ? 'sd-editor' : 'spec-editor';
        await expect(sut.page.getByTestId(editor)).toHaveValue(String((sut.last as Record<string, unknown>).raw_text));
    });
});
// AC-WB-021; source Gherkin line 206
Then(/^該產物仍連結相同的需求編號與對應情境編號$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(206, 'Then', async () => {
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
// AC-WB-021; source Gherkin line 207
Then(/^這項產品儲存能力不改變bdd專案自身以Git保存開發文件與測試的方式$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(207, 'Then', async () => {
        const paths = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { encoding: 'utf8' }).split('\n');
        const required = ['spec/REQ-WB-001/workbench/workbench.feature', 'spec/REQ-WB-001/workbench/workbench.sd.md', 'spec/REQ-WB-001/review.json'];
        required.push('spec/REQ-WB-001/workbench/workbench.feature.spec.ts', 'spec/REQ-WB-001/workbench/workbench.steps.ts', 'spec/REQ-WB-001/workbench/testing/support/fixtures.ts', 'playwright.config.ts', 'package-lock.json');
        for (const file of required)
            expect(paths).toContain(file);
        expect(readFileSync('spec/REQ-WB-001/review.json', 'utf8')).toContain('REQ-WB-001');
    });
});
// AC-WB-022; source Gherkin line 216
Given(/^使用者已停止一次內嵌瀏覽器錄製並取得腳本草稿$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(216, 'Given', async () => {
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
// AC-WB-022; source Gherkin line 217
When(/^使用者將腳本另存到工作台SQLite的使用者錄製腳本清單$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(217, 'When', async () => {
        await sut.saveRecording(false);
    });
});
// AC-WB-022; source Gherkin line 218
When(/^使用者重新開啟該已保存腳本並按下重播$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(218, 'When', async () => {
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
// AC-WB-022; source Gherkin line 219
Then(/^工作台在瀏覽器實際重播已保存的操作與斷言$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(219, 'Then', async () => {
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
// AC-WB-022; source Gherkin line 220
Then(/^顯示該次重播的實際結果而不是把保存成功當成測試通過$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(220, 'Then', async () => {
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
// AC-WB-022; source Gherkin line 221
Then(/^該腳本保留已提供的需求與相關情境對應並與標準專案CI測試分開列示$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(221, 'Then', async () => {
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
// AC-WB-022; source Gherkin line 222
Then(/^不會自動新增或修改target Git的CI測試檔案或CI測試清單$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(222, 'Then', async () => {
        expect(sut.repoState(), 'target Git and CI list unchanged').toBe(sut.repoBefore);
    });
});
// AC-WB-023; source Gherkin line 226
Given(/^工作台SQLite已有"([^"]*)"的有效原文與結構化資料$/, async ({ sut }, arg0: string) => {
    const expect = sut.check;
    await sut.step(226, 'Given', async () => {
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
// AC-WB-023; source Gherkin line 227
Given(/^使用者準備保存的同一檔案內容含語法錯誤$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(227, 'Given', async () => {
        sut.vars["invalid"] = true;
    });
});
// AC-WB-023; source Gherkin line 228
When(/^使用者要求將該"([^"]*)"內容保存到SQLite$/, async ({ sut }, arg0: string) => {
    const expect = sut.check;
    await sut.step(228, 'When', async () => {
        await sut.save({ "kind": arg0, "invalid": true });
    });
});
// AC-WB-023; source Gherkin line 229
Then(/^工作台先以"([^"]*)"解析內容並拒絕將錯誤內容保存為有效版本$/, async ({ sut }, arg0: string) => {
    const expect = sut.check;
    await sut.step(229, 'Then', async () => {
        sut.assertDiagnostics('SYNTAX_INVALID');
    });
});
// AC-WB-023; source Gherkin line 230
Then(/^回報錯誤的檔案名稱與行號及欄號與原因$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(230, 'Then', async () => {
        sut.assertDiagnostics('SYNTAX_INVALID');
    });
});
// AC-WB-023; source Gherkin line 231
Then(/^原有有效版本的原文與結構化資料及來源對應保持不變$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(231, 'Then', async () => {
        expect(sut.db.snapshot(), 'effective original text and projections').toBe(sut.before);
    });
});
// AC-WB-024; source Gherkin line 239
Given(/^語法有效的Gherkin原文對應需求"REQ-DEMO-001"$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(239, 'Given', async () => {
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
// AC-WB-024; source Gherkin line 240
Given(/^原文含Scenario Outline的Scenario ID"AC-DEMO-001"及有順序的steps與兩列Examples$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(240, 'Given', async () => {
        const params = (([sut.vars.gherkinVersion])) as SQLInputValue[];
        await expect.poll(() => sut.db.all("SELECT count(*) AS n FROM source_cases WHERE gherkin_version_id=?", params)).toMatchObject(([{ "n": 2 }]) as object[]);
        sut.last = sut.db.all("SELECT count(*) AS n FROM source_cases WHERE gherkin_version_id=?", params);
    });
});
// AC-WB-024; source Gherkin line 241
When(/^使用者將該Gherkin保存到SQLite$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(241, 'When', async () => {
        await sut.save({ "kind": "gherkin" });
    });
});
// AC-WB-024; source Gherkin line 242
Then(/^讀回的完整原文與提交內容逐字相同$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(242, 'Then', async () => {
        const kind = "gherkin";
        const doc = sut.vars[kind + 'Doc'];
        sut.last = sut.db.all('SELECT v.raw_text,v.raw_sha256,v.id FROM document_heads h JOIN document_versions v ON v.id=h.version_id WHERE h.document_id=?', [String(doc)])[0];
        expect((sut.last as Record<string, unknown>)?.raw_text).toBe(sut.vars.gherkin);
        expect((sut.last as Record<string, unknown>)?.raw_sha256).toBe(sha(String((sut.last as Record<string, unknown>).raw_text)));
    });
});
// AC-WB-024; source Gherkin line 243
Then(/^可結構化查詢需求編號與Scenario ID及各step的關鍵字與文字及順序$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(243, 'Then', async () => {
        const version = String(sut.head('gherkin').id);
        const scenario = sut.db.all('SELECT s.scenario_key,sv.title FROM scenario_versions sv JOIN scenarios s ON s.id=sv.scenario_id WHERE sv.gherkin_version_id=?', [version]);
        expect(scenario).toEqual([{ scenario_key: 'AC-DEMO-001', title: 'Edit document' }]);
        const steps = sut.db.all('SELECT st.ordinal,st.keyword,st.text FROM steps st JOIN step_groups g ON g.id=st.group_id WHERE g.gherkin_version_id=? ORDER BY st.ordinal', [version]);
        expect(steps).toEqual([{ ordinal: 1, keyword: 'Given', text: 'the account has role "<role>"' }, { ordinal: 2, keyword: 'When', text: 'the account edits the document' }, { ordinal: 3, keyword: 'Then', text: 'the result is "<expected>"' }]);
    });
});
// AC-WB-024; source Gherkin line 244
Then(/^可結構化查詢Examples的欄名與各列值及case_id且保留列順序$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(244, 'Then', async () => {
        const version = String(sut.head('gherkin').id);
        const rows = sut.db.all('SELECT c.case_key,c.row_ordinal,col.name,e.value FROM source_cases c JOIN example_cells e ON e.source_case_id=c.id JOIN example_columns col ON col.table_id=e.example_table_id AND col.ordinal=e.column_ordinal WHERE c.gherkin_version_id=? ORDER BY c.row_ordinal,col.ordinal', [version]);
        expect(rows).toEqual([['a', 1, 'case_id', 'a'], ['a', 1, 'role', 'A'], ['a', 1, 'expected', 'denied'], ['b', 2, 'case_id', 'b'], ['b', 2, 'role', 'B'], ['b', 2, 'expected', 'saved']].map(([case_key, row_ordinal, name, value]) => ({ case_key, row_ordinal, name, value })));
    });
});
// AC-WB-024; source Gherkin line 245
Then(/^原文與結構化資料均連結同一來源文件版本與內容hash$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(245, 'Then', async () => {
        const row = sut.head("gherkin");
        expect(row.raw_sha256).toBe(sha(String(row.raw_text)));
    });
});
// AC-WB-025; source Gherkin line 249
Given(/^指定來源版本的已確認Gherkin含情境"AC-DEMO-001"及Examples案例"a"與"b"$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(249, 'Given', async () => {
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
// AC-WB-025; source Gherkin line 250
Given(/^標準生成的spec\.ts語法有效且測試"test-a"與"test-b"分別明確對應該情境的案例"a"與"b"$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(250, 'Given', async () => {
        sut.vars["specMode"] = "normal";
    });
});
// AC-WB-025; source Gherkin line 251
Given(/^另一測試"test-a-extra"以不同test ID明確對應同一情境的案例"a"$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(251, 'Given', async () => {
        sut.vars["specMode"] = "extra";
    });
});
// AC-WB-025; source Gherkin line 252
When(/^使用者將該spec\.ts與明確ID對應保存到SQLite$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(252, 'When', async () => {
        await sut.save({ "kind": "spec", "extra": true });
    });
});
// AC-WB-025; source Gherkin line 253
Then(/^讀回的完整spec\.ts原文與提交內容逐字相同$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(253, 'Then', async () => {
        const kind = "spec";
        const doc = sut.vars[kind + 'Doc'];
        sut.last = sut.db.all('SELECT v.raw_text,v.raw_sha256,v.id FROM document_heads h JOIN document_versions v ON v.id=h.version_id WHERE h.document_id=?', [String(doc)])[0];
        expect((sut.last as Record<string, unknown>)?.raw_text).toBe(sut.vars.savedSpec);
        expect((sut.last as Record<string, unknown>)?.raw_sha256).toBe(sha(String((sut.last as Record<string, unknown>).raw_text)));
    });
});
// AC-WB-025; source Gherkin line 254
Then(/^可結構化查詢每個test ID及其需求編號與Scenario ID及Examples case_id$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(254, 'Then', async () => {
        const params = (([sut.vars.specDoc])) as SQLInputValue[];
        await expect.poll(() => sut.db.all("SELECT t.test_key,s.scenario_key,c.case_key FROM test_case_mappings m JOIN test_definitions t ON t.id=m.test_definition_id JOIN source_cases c ON c.id=m.source_case_id JOIN scenarios s ON s.id=c.scenario_id JOIN document_heads h ON h.version_id=t.spec_version_id WHERE h.document_id=? ORDER BY t.test_key", params)).toMatchObject(([{ "test_key": "test-a", "scenario_key": "AC-DEMO-001", "case_key": "a" }, { "test_key": "test-a-extra", "scenario_key": "AC-DEMO-001", "case_key": "a" }, { "test_key": "test-b", "scenario_key": "AC-DEMO-001", "case_key": "b" }]) as object[]);
        sut.last = sut.db.all("SELECT t.test_key,s.scenario_key,c.case_key FROM test_case_mappings m JOIN test_definitions t ON t.id=m.test_definition_id JOIN source_cases c ON c.id=m.source_case_id JOIN scenarios s ON s.id=c.scenario_id JOIN document_heads h ON h.version_id=t.spec_version_id WHERE h.document_id=? ORDER BY t.test_key", params);
    });
});
// AC-WB-025; source Gherkin line 255
Then(/^每筆對應可追溯spec\.ts版本與內容hash及來源Gherkin版本與內容hash$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(255, 'Then', async () => {
        const row = sut.head("spec");
        expect(row.raw_sha256).toBe(sha(String(row.raw_text)));
        {
            expect(row.source_gherkin_version_id).toBe(sut.vars.gherkinVersion);
            const source = sut.db.all('SELECT raw_sha256 FROM document_versions WHERE id=?', [String(row.source_gherkin_version_id)])[0];
            expect(source?.raw_sha256).toBe(sha(sourceFeature));
        }
    });
});
// AC-WB-025; source Gherkin line 256
Then(/^相同Scenario ID下的不同Examples案例可各自對應不同測試$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(256, 'Then', async () => {
        const params = (([sut.vars.specDoc])) as SQLInputValue[];
        await expect.poll(() => sut.db.all("SELECT t.test_key,s.scenario_key,c.case_key FROM test_case_mappings m JOIN test_definitions t ON t.id=m.test_definition_id JOIN source_cases c ON c.id=m.source_case_id JOIN scenarios s ON s.id=c.scenario_id JOIN document_heads h ON h.version_id=t.spec_version_id WHERE h.document_id=? ORDER BY t.test_key", params)).toMatchObject(([{ "test_key": "test-a", "case_key": "a" }, { "test_key": "test-a-extra", "case_key": "a" }, { "test_key": "test-b", "case_key": "b" }]) as object[]);
        sut.last = sut.db.all("SELECT t.test_key,s.scenario_key,c.case_key FROM test_case_mappings m JOIN test_definitions t ON t.id=m.test_definition_id JOIN source_cases c ON c.id=m.source_case_id JOIN scenarios s ON s.id=c.scenario_id JOIN document_heads h ON h.version_id=t.spec_version_id WHERE h.document_id=? ORDER BY t.test_key", params);
    });
});
// AC-WB-025; source Gherkin line 257
Then(/^測試"test-a"與"test-a-extra"的映射均被保存且同時對應相同Scenario ID與Examples案例"a"$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(257, 'Then', async () => {
        const params = (([sut.vars.specDoc])) as SQLInputValue[];
        await expect.poll(() => sut.db.all("SELECT count(DISTINCT t.test_key) AS n FROM test_case_mappings m JOIN test_definitions t ON t.id=m.test_definition_id JOIN source_cases c ON c.id=m.source_case_id JOIN document_heads h ON h.version_id=t.spec_version_id WHERE h.document_id=? AND c.case_key='a'", params)).toMatchObject(([{ "n": 2 }]) as object[]);
        sut.last = sut.db.all("SELECT count(DISTINCT t.test_key) AS n FROM test_case_mappings m JOIN test_definitions t ON t.id=m.test_definition_id JOIN source_cases c ON c.id=m.source_case_id JOIN document_heads h ON h.version_id=t.spec_version_id WHERE h.document_id=? AND c.case_key='a'", params);
    });
});
// AC-WB-025; source Gherkin line 258
Then(/^重新讀取時仍取得原本的來源版本而不是自動改指向最新Gherkin$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(258, 'Then', async () => {
        const old = String(sut.head('spec').source_gherkin_version_id);
        await sut.request(`/requirements/${sut.vars.requirement}/return`, { artifactKind: 'Gherkin' }, [200, 201]);
        await sut.request(`/documents/${sut.vars.gherkinDoc}/versions`, { rawText: sourceFeature.replace('Edit document', 'Edit document revised') }, [200, 201]);
        expect(sut.head('gherkin').id).not.toBe(old);
        expect(sut.head('spec').source_gherkin_version_id).toBe(old);
    });
});
// AC-WB-026; source Gherkin line 262
Given(/^工作台SQLite已有一份有效的標準生成spec\.ts及其情境對應$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(262, 'Given', async () => {
        {
            sut.db.stage("TESTS");
            await sut.page.reload();
        }
        {
            sut.before = sut.db.snapshot();
        }
    });
});
// AC-WB-026; source Gherkin line 263
Given(/^待保存的新spec\.ts通過TypeScript語法解析但其明確ID映射存在"([^"]*)"$/, async ({ sut }, arg0: string) => {
    const expect = sut.check;
    await sut.step(263, 'Given', async () => {
        sut.vars["problem"] = (arg0);
    });
});
// AC-WB-026; source Gherkin line 264
When(/^使用者要求保存該標準生成測試與映射$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(264, 'When', async () => {
        await sut.save({ "kind": "spec", "problem": sut.vars.problem });
    });
});
// AC-WB-026; source Gherkin line 265
Then(/^工作台依指定來源版本的Gherkin與明確test ID映射拒絕該次保存$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(265, 'Then', async () => {
        sut.assertDiagnostics('MAPPING_INVALID');
        expect(JSON.stringify(sut.last)).toContain(String(sut.vars.problem));
        const body = JSON.stringify(sut.last);
        expect(body).toMatch(/test-a|test-b|AC-DEMO-001|AC-MISSING-999|missing/);
    });
});
// AC-WB-026; source Gherkin line 266
Then(/^回報"([^"]*)"及相關test ID或來源案例ID$/, async ({ sut }, arg0: string) => {
    const expect = sut.check;
    await sut.step(266, 'Then', async () => {
        sut.assertDiagnostics('MAPPING_INVALID');
        expect(JSON.stringify(sut.last)).toContain(String(sut.vars.problem));
        const body = JSON.stringify(sut.last);
        expect(body).toMatch(/test-a|test-b|AC-DEMO-001|AC-MISSING-999|missing/);
    });
});
// AC-WB-026; source Gherkin line 267
Then(/^未提供的情境對應不被自動推測或補造$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(267, 'Then', async () => {
        expect(sut.db.snapshot(), 'effective original text and projections').toBe(sut.before);
    });
});
// AC-WB-026; source Gherkin line 268
Then(/^原有有效spec\.ts原文與結構化映射保持不變$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(268, 'Then', async () => {
        expect(sut.db.snapshot(), 'effective original text and projections').toBe(sut.before);
    });
});
// AC-WB-027; source Gherkin line 280
Given(/^使用者已取得語法有效且未連結需求編號或Scenario ID的自錄Playwright腳本$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(280, 'Given', async () => {
        {
            sut.repoBefore = sut.repoState();
        }
        {
            sut.vars["recording"] = (sut.vars.spec);
        }
    });
});
// AC-WB-027; source Gherkin line 281
When(/^使用者將該腳本另存到SQLite的使用者錄製腳本清單$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(281, 'When', async () => {
        await sut.saveRecording(true);
    });
});
// AC-WB-027; source Gherkin line 282
Then(/^工作台保存完整原文且需求與情境對應維持未關聯$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(282, 'Then', async () => {
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
// AC-WB-027; source Gherkin line 283
Then(/^不要求補造需求或Scenario ID以通過標準生成測試的映射檢核$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(283, 'Then', async () => {
        const params = (([sut.vars.recordingDoc])) as SQLInputValue[];
        await expect.poll(() => sut.db.all("SELECT count(*) AS n FROM test_case_mappings m JOIN test_definitions t ON t.id=m.test_definition_id JOIN document_versions v ON v.id=t.spec_version_id WHERE v.document_id=?", params)).toMatchObject(([{ "n": 0 }]) as object[]);
        sut.last = sut.db.all("SELECT count(*) AS n FROM test_case_mappings m JOIN test_definitions t ON t.id=m.test_definition_id JOIN document_versions v ON v.id=t.spec_version_id WHERE v.document_id=?", params);
    });
});
// AC-WB-027; source Gherkin line 284
Then(/^使用者可重新開啟該腳本並重播$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(284, 'Then', async () => {
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
// AC-WB-027; source Gherkin line 285
Then(/^該腳本仍獨立於標準專案CI且不會自動新增或修改target Git的CI測試$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(285, 'Then', async () => {
        expect(sut.repoState(), 'target Git and CI list unchanged').toBe(sut.repoBefore);
    });
});
// AC-WB-028; source Gherkin line 289
Given(/^專案已有Gherkin情境"AC-DEMO-001"及Examples案例"a"與"b"的spec\.ts骨架與明確測試映射$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(289, 'Given', async () => {
        sut.db.useSkeleton();
        sut.db.stage('TESTS');
        sut.selection = new SelectionProbe(sut.page, sut.db, sut.vars, sut.info, expect);
        await sut.page.reload();
    });
});
// AC-WB-028; source Gherkin line 290
Given(/^案例"a"對應測試"test-a"與"test-a-extra"且案例"b"對應測試"test-b"$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(290, 'Given', async () => {
        const rows = sut.db.all('SELECT t.test_key,c.case_key FROM test_definitions t JOIN test_case_mappings m ON m.test_definition_id=t.id JOIN source_cases c ON c.id=m.source_case_id WHERE t.spec_version_id=? ORDER BY t.test_key', [String(sut.vars.specSkeletonVersion)]);
        expect(rows).toEqual([{ test_key: 'test-a', case_key: 'a' }, { test_key: 'test-a-extra', case_key: 'a' }, { test_key: 'test-b', case_key: 'b' }]);
    });
});
// AC-WB-028; source Gherkin line 291
Given(/^這些測試目前只有尚未由LLM補齊的codegen殼$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(291, 'Given', async () => {
        expect(sut.head('spec').test_stage).toBe('SKELETON');
    });
});
// AC-WB-028; source Gherkin line 292
When(/^使用者開啟工作台的Gherkin測試清單$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(292, 'When', async () => {
        await sut.page.goto(`/projects/${sut.vars.project}/requirements/${sut.vars.requirement}/tests`);
        await expect(sut.page.getByTestId('scenario-tests')).toBeVisible();
    });
});
// AC-WB-028; source Gherkin line 293
Then(/^清單列出該情境與案例"a"及"b"及各自對應的test ID$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(293, 'Then', async () => {
        for (const [key, ids] of [['a', ['test-a', 'test-a-extra']], ['b', ['test-b']]] as const) {
            const row = sut.page.getByTestId('scenario-case-' + key);
            await expect(row).toContainText('AC-DEMO-001');
            for (const id of ids)
                await expect(row.getByTestId('case-test-ids')).toContainText(id);
        }
    });
});
// AC-WB-028; source Gherkin line 294
Then(/^只有codegen殼的測試顯示待補齊且不可標示已通過$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(294, 'Then', async () => {
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
// AC-WB-028; source Gherkin line 295
When(/^使用者在測試已由LLM補齊且測試基線與程式版本已固定後點選案例"a"並按下執行$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(295, 'When', async () => {
        // Real completion use case; no fixture DB update substitutes for its result.
        await sut.page.getByTestId('complete-tests').click();
        await expect(sut.page.getByTestId('test-readiness')).toHaveText('COMPLETED', { timeout: 60000 });
        const row = sut.db.all('SELECT v.* FROM document_heads h JOIN document_versions v ON v.id=h.version_id WHERE h.document_id=?', [String(sut.vars.specDoc)])[0];
        expect(row.test_stage).toBe('COMPLETED');
        expect(row.source_skeleton_version_id).toBe(sut.vars.specSkeletonVersion);
        expect(row.id).not.toBe(sut.vars.specSkeletonVersion);
        const ids = sut.db.all('SELECT t.test_key,c.case_key FROM test_definitions t JOIN test_case_mappings m ON m.test_definition_id=t.id JOIN source_cases c ON c.id=m.source_case_id WHERE t.spec_version_id=? ORDER BY t.test_key', [String(row.id)]);
        expect(ids).toEqual([{ test_key: 'test-a', case_key: 'a' }, { test_key: 'test-a-extra', case_key: 'a' }, { test_key: 'test-b', case_key: 'b' }]);
        await sut.page.getByTestId('start-development').click();
        if (!sut.vars.sourceRef)
            throw Error('WB_SOURCE_REF required; no invented product revision');
        await sut.page.getByTestId('source-ref').fill(String(sut.vars.sourceRef));
        await sut.page.getByTestId('pin-source').click();
        await expect(sut.page.getByTestId('pinned-source-ref')).toHaveText(String(sut.vars.sourceRef));
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
// AC-WB-028; source Gherkin line 296
Then(/^工作台建立本次run且runner只執行對應的spec\.ts測試"test-a"與"test-a-extra"$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(296, 'Then', async () => {
        await expect.poll(() => sut.db.all('SELECT t.test_key FROM run_test_selection s JOIN test_definitions t ON t.id=s.test_definition_id WHERE s.run_id=? ORDER BY t.test_key', [String(sut.vars.run)])).toEqual([{ test_key: 'test-a' }, { test_key: 'test-a-extra' }]);
        expect(sut.db.all('SELECT source_case_id FROM run_source_cases WHERE run_id=?', [String(sut.vars.run)])).toEqual([{ source_case_id: sut.vars.caseA }]);
        await expect.poll(async () => { const r = await sut.selection!.report(); return r.status; }, { timeout: 90000 }).toMatch(/^(PASSED|FAILED|INCOMPLETE)$/);
        const report = await sut.selection!.report();
        expect(report.executedTestKeys.sort()).toEqual(['test-a', 'test-a-extra']);
        await expect.poll(() => sut.selection!.starts.filter(s => s.runId === sut.vars.run).map(s => s.testKey).sort()).toEqual(['test-a', 'test-a-extra']);
    });
});
// AC-WB-028; source Gherkin line 297
Then(/^未選取的"test-b"本次不執行也不標示通過$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(297, 'Then', async () => {
        expect(sut.db.all('SELECT c.id FROM case_results c JOIN test_definitions t ON t.id=c.test_definition_id WHERE c.run_id=? AND t.test_key=?', [String(sut.vars.run), 'test-b'])).toHaveLength(0);
        const row = sut.page.getByTestId('scenario-case-b');
        await expect(row.getByTestId('case-execution-status')).toHaveText('NOT_RUN');
        await expect(row).toHaveAttribute('data-selected', 'false');
        const report = await sut.selection!.report();
        expect(report.sourceCases.find((c: any) => c.caseId === 'b')).toMatchObject({ selected: false, status: 'NOT_RUN' });
    });
});
// AC-WB-028; source Gherkin line 298
Then(/^右側內嵌瀏覽器即時呈現本次run目前測試所用的同一session與page的真實操作$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(298, 'Then', async () => {
        await expect.poll(() => sut.selection!.frames.filter(f => f.runId === sut.vars.run).map(f => f.testKey).filter((key, i, all) => all.indexOf(key) === i).sort(), { timeout: 15000 }).toEqual(['test-a', 'test-a-extra']);
        await Promise.all(sut.selection!.tasks);
        expect(sut.selection!.errors.map(String)).toEqual([]);
        for (const key of ['test-a', 'test-a-extra'])
            expect(sut.selection!.frames.some(f => f.runId === sut.vars.run && f.testKey === key), `real same-run canvas/page frame for ${key}`).toBe(true);
    });
});
// AC-WB-028; source Gherkin line 299
Then(/^各測試的實際斷言與每步截圖及成功或失敗結果均對應本次run與所選情境及案例$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(299, 'Then', async () => {
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
// AC-WB-028; source Gherkin line 300
Then(/^只有所選案例的必要測試與斷言及證據完整通過才標示該案例通過$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(300, 'Then', async () => {
        const report = await sut.selection!.report();
        expect(report.status).toBe('PASSED');
        for (const c of report.cases) {
            expect(c.status).toBe('PASSED');
            expect(c.steps.every((s: any) => s.status === 'PASSED')).toBe(true);
        }
        await expect(sut.page.getByTestId('scenario-case-a').getByTestId('case-execution-status')).toHaveText('PASSED');
    });
});
// AC-WB-028; source Gherkin line 301
Then(/^所選案例通過不代表未執行的全專案案例已通過$/, async ({ sut }) => {
    const expect = sut.check;
    await sut.step(301, 'Then', async () => {
        const report = await sut.selection!.report();
        expect(report.coverageComplete).toBe(false);
        expect(report.requiredTestCount).toBe(3);
        expect(report.executedTestKeys).toHaveLength(2);
        expect(report.unexecutedTestKeys).toEqual(['test-b']);
        expect(sut.db.all('SELECT stage FROM features WHERE id=?', [String(sut.vars.featureId)])[0].stage).toBe('VERIFICATION');
    });
});
