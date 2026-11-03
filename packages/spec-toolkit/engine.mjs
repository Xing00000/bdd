import { spawn } from 'node:child_process';
import { mkdir, readFile, copyFile, rename, lstat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { caseSelection } from './tags.mjs';
import { materializeDependencies, reuseForExecution } from './dependencies.mjs';
import { WorkstationError, invariant, id, version, exists, safePath, walk, writeJson, readJson, atomicWrite, digest, identity, escapeHtml, errorResult } from '../contracts/index.mjs';
import { execute, processEnvironment, trackChild, startProgressPty, gitSourceFiles } from '../git-core/index.mjs';
import { currentProgress } from '../git-core/progress.mjs';
import { validate, reviewState, configuration, featureKey } from './index.mjs';

import { validateContract } from '../contracts/schemas.mjs';

function commandArray(value) {
  invariant(Array.isArray(value) && value.length > 0 && value.length <= 80 && value.every(v => typeof v === 'string' && v.length <= 4000 && !v.includes('\0')), 'INVALID_EXECUTION_COMMAND', 'Execution commands must be non-empty executable/argument arrays');
  return value;
}
export async function inputSnapshot(root, git) {
  const snapshots = [];
  for (const [prefix, repository] of [['', root], ...(await git.modules(root)).map(x => [x.path + '/', path.join(root, x.path)])]) {
    const entries = (await git.command(repository, ['ls-files', '--stage', '-z'])).stdout.split('\0').filter(Boolean);
    for (const entry of entries) {
      const split = entry.indexOf('\t'), metadata = entry.slice(0, split), relative = entry.slice(split + 1);
      if (!prefix && (relative.startsWith('reports/') || metadata.startsWith('160000 '))) continue;
      invariant(!metadata.startsWith('120000 '), 'SYMLINK_FORBIDDEN', `Tracked input symlink: ${prefix}${relative}`);
      const file = await safePath(repository, relative, { missing: false });
      snapshots.push([prefix + relative, metadata.split(' ')[0], digest(await readFile(file))]);
    }
  }
  return identity(snapshots.sort((a, b) => a[0].localeCompare(b[0])));
}
export async function prepareRun({ root, home, repositoryId, input, git }) {
  const state = await git.expect(root, input.expected, { clean: true });
  invariant(state.head, 'EMPTY_REPOSITORY', 'Commit the specification first');
  const verified = await validate(root, git, { pinned: true });
  const key = featureKey(input.requirementId, input.featureId), feature = verified.features.find(x => x.key === key);
  invariant(feature, 'FEATURE_NOT_FOUND', key, 404);
  invariant(!feature.authoringOnly, 'TEST_RUNNER_NOT_CONFIGURED', '此規格尚未接線工作台測試執行器。', 409);
  const review = await reviewState(root, input.requirementId, input.featureId);
  invariant(Object.values(review.confirmed).every(Boolean), 'REVIEWS_REQUIRED', 'Confirm current Gherkin, SD and tests before a formal run', 409);
  invariant(await exists(await safePath(root, 'package-lock.json')), 'LOCKFILE_REQUIRED', 'Install dependencies, review and commit package-lock.json');
  const selection = input.caseIds === undefined ? null : input.caseIds;
  invariant(selection === null || Array.isArray(selection) && selection.length > 0 && new Set(selection).size === selection.length && selection.every(x => feature.caseIds.includes(x)), 'INVALID_SELECTION', 'Select existing case IDs');
  const runId = id(input.runId ?? `RUN-${randomUUID()}`), directory = await safePath(home, `executions/${runId}`);
  invariant(!await exists(directory), 'RUN_EXISTS', 'Run IDs are immutable and cannot be reused', 409);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const repository = path.join(directory, 'repo');
  await git.cloneCandidate(root, repository, state.head);
  for (const project of verified.modules) {
    const source = await safePath(root, project.path, { missing: false });
    const destination = await safePath(repository, project.path);
    // The local source is a registered product checkout, not caller-provided input.
    // Git creates empty gitlink directories when checking out the parent.
    if (await exists(destination)) { const { readdir } = await import('node:fs/promises'); invariant((await readdir(destination)).length === 0, 'CANDIDATE_DIRECTORY_NOT_EMPTY', project.path); const { rmdir } = await import('node:fs/promises'); await rmdir(destination); }
    await git.cloneCandidate(source, destination, project.commit);
    await git.command(destination, ['remote', 'set-url', 'origin', project.url]);
  }
  await validate(repository, git, { pinned: true });
  const pinnedReview = await reviewState(repository, input.requirementId, input.featureId);
  invariant(Object.values(pinnedReview.confirmed).every(Boolean) && identity(pinnedReview.hashes) === identity(review.hashes), 'REVIEW_BASELINE_MISMATCH', 'Committed review differs from working tree');
  if(await reuseForExecution(root,verified.config.execution.install))await materializeDependencies(root,repository);
  const plan = { schemaVersion: 1, specRepositoryId: verified.config.specRepositoryId, runId, repositoryId, requirementId: input.requirementId, featureId: input.featureId,
    testedSpecCommit: state.head, projects: verified.modules.map(x => ({ id: x.id, path: x.path, commit: x.commit })),
    caseIds: selection ?? feature.caseIds, allCaseIds: feature.caseIds, profiles: feature.profiles, requiredProjectIds: feature.projectIds,
    scope: selection ? 'SELECTED_CASES' : 'ALL_CASES', baseline: review.hashes.tests,
    inputDigest: await inputSnapshot(repository, git), createdAt: new Date().toISOString(), state: 'PREPARED' };
  await writeJson(path.join(directory, 'plan.json'), plan);
  return plan;
}
function expectedKeys(plan, selected = true) { return (selected ? plan.caseIds : plan.allCaseIds).flatMap(c => plan.profiles.map(p => `${c}/${p}`)).sort(); }
function definitionKeys(receipt) { return receipt.definitions.map(x => `${x.caseId}/${x.profile}`).sort(); }
function checkReceipt(receipt, plan) {
  version(receipt);
  invariant(receipt.requirementId === plan.requirementId && receipt.featureId === plan.featureId, 'RECEIPT_ID_MISMATCH', 'Reporter identity differs from run');
  invariant(Array.isArray(receipt.definitions) && Array.isArray(receipt.cases) && Array.isArray(receipt.errors), 'INVALID_RECEIPT', 'Missing reporter events');
}
export function assessEvidence(plan, discovery, receipt, processResult, inputsUnchanged, deployment) {
  checkReceipt(discovery, plan); checkReceipt(receipt, plan);
  const completeDiscovery = identity(definitionKeys(discovery)) === identity(expectedKeys(plan, false));
  const selectedDiscovery = identity(definitionKeys(receipt)) === identity(expectedKeys(plan));
  const actual = receipt.cases.map(x => `${x.caseId}/${x.profile}`).sort();
  const exactExecution = identity(actual) === identity(expectedKeys(plan));
  const testPassed = processResult.exitCode === 0 && !processResult.timedOut && !processResult.overflow
    && receipt.status === 'passed' && receipt.errors.length === 0 && receipt.cases.length > 0
    && receipt.cases.every(x => x.status === 'passed' && x.expectedStatus === 'passed' && x.retry === 0);
  const evidenceIssues=[];
  for(const x of receipt.cases) {
    const keyword = /^(Given|When|Then|And|But|假如|假設|假定|當|那麼|那么|而且|並且|并且|但是)\s+/;
    const steps=(x.steps??[]).filter(s=>s.category==='test.step'&&keyword.test(s.title)),used=new Set();
    const issue=details=>evidenceIssues.push({caseId:x.caseId,profile:x.profile,...details});
    if(!(x.assertions>0))issue({code:'MISSING_ASSERTIONS'});
    if(!steps.length)issue({code:'MISSING_GHERKIN_STEPS'});
    steps.forEach((step,index)=>{
      const titles=[step.title,step.title.replace(keyword,'')],names=new Set(titles.map(title=>`step-${title}`));
      // AfterStep may prefix its per-scenario ordinal. Both ordinal and title must match.
      const image=(x.attachments??[]).find(a=>{
        if(!a.path.startsWith('screenshots/')||used.has(a.path))return false;
        if(names.has(a.name))return true;
        const numbered=/^step-(\d+)-([\s\S]+)$/.exec(a.name);
        return numbered&&Number(numbered[1])===index+1&&names.has(`step-${numbered[2]}`);
      });
      if(image)used.add(image.path);
      else issue({code:'MISSING_STEP_IMAGE',step:step.title,ordinal:index+1,expectedNames:[...names,...titles.map(title=>`step-${String(index+1).padStart(3,'0')}-${title}`)],availableImages:(x.attachments??[]).filter(a=>a.path.startsWith('screenshots/')).map(a=>({name:a.name,path:a.path}))});
    });
  }
  const evidenceComplete=evidenceIssues.length===0;
  const deploymentMatches = deployment?.verified && (plan.requiredProjectIds ?? []).every(projectId => deployment.projectId === projectId && deployment.commit === plan.projects?.find(p => p.id === projectId)?.commit);
  const reasons = [];
  if (!completeDiscovery || !selectedDiscovery || !exactExecution) reasons.push('CASE_SET_MISMATCH');
  if (!evidenceComplete) reasons.push('EVIDENCE_INCOMPLETE');
  if (!inputsUnchanged) reasons.push('INPUTS_CHANGED');
  if (!deploymentMatches) reasons.push('DEPLOYMENT_UNPROVEN');
  if (plan.scope !== 'ALL_CASES') reasons.push('PARTIAL_COVERAGE');
  if (!testPassed) reasons.push('TESTS_NOT_PASSED');
  return { testOutcome: testPassed ? 'PASSED' : 'FAILED', verification: reasons.length ? 'NOT_VERIFIED' : 'VERIFIED',
    coverageComplete: completeDiscovery && exactExecution && plan.scope === 'ALL_CASES', evidenceComplete, evidenceIssues, reasons };
}
export async function runBddCommand(root, mode, requirementId, featureId, options = {}) {
  featureKey(requirementId, featureId);
  const metadata = await readJson(await safePath(root, `spec/${requirementId}/${featureId}/feature.yaml`, { missing: false }));
  invariant(!metadata.deletedAt,'FEATURE_DELETED','需求已刪除，不能再執行其測試。',409);
  invariant(!metadata.authoringOnly, 'TEST_RUNNER_NOT_CONFIGURED', '此規格尚未接線工作台測試執行器。', 409);
  invariant(['generate', 'list', 'test'].includes(mode), 'INVALID_BDD_COMMAND', mode);
  const output = options.output ?? path.resolve(root, '.runtime', `preview-${randomUUID()}`);
  await mkdir(output, { recursive: true });
  const env = { ...processEnvironment(), HOME: path.join(output, 'home'), ...options.environment,
    WB_REQUIREMENT_ID: requirementId, WB_FEATURE_ID: featureId, WB_TASK_OUTPUT: output,
    WB_DISCOVERY: mode === 'list' ? '1' : '0' };
  const executable = path.join(root, 'node_modules', '.bin', mode === 'generate' ? 'bddgen' : 'playwright');
  invariant(await exists(executable), 'DEPENDENCIES_NOT_INSTALLED', 'Install the pinned dependencies first');
  const args = mode === 'generate' ? ['--config', 'bdd.config.ts'] : ['test', '--config', 'playwright.config.ts', ...(mode === 'list' ? ['--list'] : [])];
  if (mode === 'test' && options.globalTimeoutMs !== undefined) args.push('--global-timeout', String(options.globalTimeoutMs));
  if (mode === 'test' && options.caseIds) {
    args.push('--grep', caseSelection(options.caseIds));
  }
  return execute(executable, args, { cwd: root, env, timeoutMs: options.timeoutMs ?? 180000 });
}

/** Discovery alone accepts empty handlers; a test plan must contain actual implementations. */
export async function validateTestImplementation(root, requirementId, featureId) {
  const key = featureKey(requirementId, featureId), directory = await safePath(root, `tests/${key}`, {missing:false});
  const files = (await gitSourceFiles(root,[`tests/${key}`])).filter(file => file.endsWith('.ts')).map(file=>file.slice(`tests/${key}/`.length));
  const required = [`${featureId}.steps.ts`, `${featureId}.hooks.ts`];
  invariant(required.every(file => files.includes(file)), 'TEST_PLAN_REQUIRED', '測試計劃必須包含 steps.ts 與 hooks.ts。');
  const ts = createRequire(path.join(root, 'package.json'))('typescript');
  const handlers = new Set(['Given','When','Then','Before','After','BeforeStep','AfterStep']);
  const incompleteHandlers=[];
  for (const relative of files) {
    const file = await safePath(directory, relative), text = await readFile(file, 'utf8');
    if(required.includes(relative))invariant(text.trim(), 'TEST_PLAN_REQUIRED', `${relative} 尚無測試實作。`);
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    invariant(!source.parseDiagnostics.length, 'TEST_PLAN_INVALID', `${relative} 語法錯誤。`);
    const aliases = new Set(handlers);
    for(const statement of source.statements)if(ts.isImportDeclaration(statement)) {
      const bindings=statement.importClause?.namedBindings;
      if(bindings&&ts.isNamedImports(bindings))for(const item of bindings.elements)if(handlers.has(item.propertyName?.text??item.name.text))aliases.add(item.name.text);
    }
    const visit = node => {
      if(ts.isCallExpression(node)) {
        const expression=node.expression;
        invariant(!(ts.isPropertyAccessExpression(expression)&&['skip','fixme','only'].includes(expression.name.text)), 'TEST_PLAN_INCOMPLETE', `${relative} 不可跳過或限定測試。`);
        if(ts.isIdentifier(expression)&&aliases.has(expression.text)) {
          const callback=node.arguments.find(arg=>ts.isArrowFunction(arg)||ts.isFunctionExpression(arg));
          if(callback) {
            const body=callback.body;
            if(!(body&&(!ts.isBlock(body)||body.statements.some(statement=>!ts.isEmptyStatement(statement)&&!ts.isThrowStatement(statement))))) {
              const position=source.getLineAndCharacterOfPosition(node.getStart(source)),step=node.arguments[0];
              incompleteHandlers.push({path:`tests/${key}/${relative}`,line:position.line+1,column:position.character+1,handler:expression.text,step:step&&ts.isStringLiteralLike(step)?step.text:expression.text});
            }
          }
        }
      }
      ts.forEachChild(node,visit);
    };
    visit(source);
  }
  if(incompleteHandlers.length)throw new WorkstationError('TEST_PLAN_INCOMPLETE',`測試計劃仍有 ${incompleteHandlers.length} 個空白或尚未實作的 handler：\n${incompleteHandlers.map(item=>`${item.path}:${item.line}:${item.column} ${item.handler} ${item.step}`).join('\n')}`,422,{incompleteHandlers});
  const shared=(await gitSourceFiles(root,['tests/_shared',`tests/${requirementId}/_shared`])).filter(file=>file.endsWith('.ts'));
  const result=await execute(path.join(root,'node_modules/.bin/tsc'), ['--noEmit','--strict','--allowJs','--target','ES2023','--module','ESNext','--moduleResolution','Bundler','--esModuleInterop',...shared,...files.map(file=>`tests/${key}/${file}`)], {cwd:root,env:processEnvironment()});
  invariant(result.exitCode===0&&!result.timedOut&&!result.overflow,'TEST_PLAN_TYPECHECK_FAILED',(result.stderr+result.stdout).slice(-12000));
  return {files:files.length,typecheck:'PASSED'};
}
async function startManagedService(repo, config, plan, environment) {
  const service = config.execution.service;
  if (!service) return { receipt: { verified: false, reason: 'No managed deployment receipt' }, stop: async () => {} };
  const project = plan.projects.find(x => x.id === service.projectId);
  invariant(project, 'SERVICE_PROJECT_UNKNOWN', 'Managed service must belong to a pinned project');
  const url = new URL(service.healthUrl);
  invariant(url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) && !url.username && !url.password, 'SERVICE_URL_NOT_LOCAL', 'Managed health URL must be loopback HTTP');
  // A pre-existing listener is not proof that our candidate was deployed.
  let existing = false;
  try { await fetch(url, { signal: AbortSignal.timeout(750), redirect: 'error' }); existing = true; } catch {}
  invariant(!existing, 'SERVICE_PORT_IN_USE', 'The health URL already responds; use a dedicated test port');
  invariant(environment.WB_TARGET_BASE_URL && new URL(environment.WB_TARGET_BASE_URL).origin === url.origin, 'TARGET_ORIGIN_MISMATCH', 'Tests must target the managed service origin');
  const command = commandArray(service.command), cwd = await safePath(repo, project.path);
  if (currentProgress()) {
    let exited = false, errorText = '';
    const child = startProgressPty(command[0], command.slice(1), { cwd, env: { ...environment, WB_SOURCE_COMMIT: project.commit }, role: 'service', onData: (_kind, data) => { errorText = (errorText + data.toString()).slice(-65536); } });
    child.done.then(() => { exited = true; });
    const stop = async () => { if (exited) return; child.stop(); let timer; await Promise.race([child.done, new Promise(resolve => { timer = setTimeout(resolve, 1500); })]); clearTimeout(timer); if (!exited) { child.stop('SIGKILL'); await child.done; } };
    try {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        invariant(!exited, 'SERVICE_EXITED', errorText || 'Managed service exited before readiness');
        try { const response = await fetch(url, { signal: AbortSignal.timeout(1000), redirect: 'error' }); const health = await response.json(); if (response.ok && health.commit === project.commit) return { stop, receipt: { verified: true, projectId: project.id, commit: project.commit, healthUrl: url.href, pid: child.pid, reportedCommit: health.commit } }; } catch {}
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('Managed health endpoint did not report the pinned project commit');
    } catch (error) { await stop(); throw error; }
  }
  const child = trackChild(spawn(command[0], command.slice(1), { cwd, env: { ...environment, WB_SOURCE_COMMIT: project.commit }, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'pipe'] }));
  let errorText = '', startupError;
  child.stderr.on('data', chunk => { errorText = (errorText + chunk.toString()).slice(-65536); });
  child.on('error', error => { startupError = error; });
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode) return;
    const signal = value => { try { if (process.platform !== 'win32') process.kill(-child.pid, value); else child.kill(value); } catch {} };
    signal('SIGTERM');
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 1500))]);
    if (child.exitCode === null && !child.signalCode) signal('SIGKILL');
  };
  try {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (startupError) throw startupError;
      invariant(child.exitCode === null && !child.signalCode, 'SERVICE_EXITED', errorText || 'Managed service exited before readiness');
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(1000), redirect: 'error' });
        const health = await response.json();
        if (response.ok && health.commit === project.commit) return { stop, receipt: { verified: true, projectId: project.id, commit: project.commit, healthUrl: url.href, pid: child.pid, reportedCommit: health.commit } };
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Managed health endpoint did not report the pinned project commit');
  } catch (error) { await stop(); throw error; }
}
async function copyArtifacts(source, destination) {
  const entries = [], files = []; let total = 0;
  // Runtime HOME/TMPDIR may contain Git repositories or symlinks. They are not
  // evidence: enumerate only approved roots before applying the strict walker.
  for (const prefix of ['screenshots', 'traces', 'native', 'logs']) {
    const directory = await safePath(source, prefix);
    if (await exists(directory)) for (const relative of await walk(directory)) files.push(`${prefix}/${relative}`);
  }
  for (const relative of ['events.ndjson', 'execution.json', 'discovery.json'])
    if (await exists(await safePath(source, relative))) files.push(relative);
  for (const relative of files.sort()) {
    const file = await safePath(source, relative), stat = await lstat(file); total += stat.size;
    invariant(stat.size <= 32 * 1024 * 1024 && total <= 256 * 1024 * 1024, 'ARTIFACT_SIZE_LIMIT', 'Evidence bundle exceeds configured v1 limits');
    const target = await safePath(destination, relative); await mkdir(path.dirname(target), { recursive: true }); await copyFile(file, target);
    entries.push({ path: relative, size: stat.size, sha256: digest(await readFile(target)) });
  }
  return entries;
}
export async function verifyBundle(directory) {
  const manifest = version(await readJson(await safePath(directory, 'manifest.json', { missing: false })));
  validateContract('manifest', manifest);
  const seal = version(await readJson(await safePath(directory, 'seal.json', { missing: false })));
  invariant(seal.manifestSha256 === digest(await readFile(path.join(directory, 'manifest.json'))), 'EVIDENCE_HASH_MISMATCH', 'Manifest was changed');
  invariant(Array.isArray(manifest.artifacts), 'INVALID_MANIFEST', 'Missing artifacts');
  const actual = (await walk(directory)).sort();
  invariant(identity(actual) === identity([...manifest.artifacts.map(x => x.path), 'manifest.json', 'seal.json'].sort()), 'EVIDENCE_FILE_SET_MISMATCH', 'Unexpected or missing evidence files');
  for (const item of manifest.artifacts) {
    const bytes = await readFile(await safePath(directory, item.path, { missing: false }));
    invariant(bytes.length === item.size && digest(bytes) === item.sha256, 'EVIDENCE_HASH_MISMATCH', item.path);
  }
  return manifest;
}
export function testProcessTimeout(timeoutMs, globalTimeoutMs) {
  return globalTimeoutMs === undefined ? timeoutMs : Math.max(timeoutMs, globalTimeoutMs + 5000);
}
export async function executeRun({ home, runId, repositoryId, git, enabled = false }) {
  invariant(enabled, 'EXECUTION_DISABLED', 'Test execution is disabled by this workstation configuration', 403);
  const directory = await safePath(home, `executions/${id(runId)}`), plan = version(await readJson(path.join(directory, 'plan.json')));
  invariant((plan.repositoryId ?? plan.workspaceId) === repositoryId, 'RUN_REPOSITORY_MISMATCH', 'Run belongs to another workspace', 403);
  const evidence = path.join(directory, 'evidence');
  if (await exists(evidence)) return verifyBundle(evidence);
  invariant(plan.state === 'PREPARED', 'RUN_ALREADY_STARTED', 'Interrupted or failed execution needs a new run ID, not silent reuse', 409);
  const repo = path.join(directory, 'repo'), config = await configuration(repo), scratch = path.join(directory, 'scratch');
  invariant(await git.resolve(repo) === plan.testedSpecCommit && await inputSnapshot(repo, git) === plan.inputDigest, 'CANDIDATE_CHANGED', 'Prepared candidate was changed', 409);
  const envConfig = config.execution.environment ?? {};
  invariant(Object.keys(envConfig).every(k => ['WB_TARGET_BASE_URL', 'NODE_ENV', 'TZ'].includes(k)) && Object.values(envConfig).every(v => typeof v === 'string'), 'ENVIRONMENT_NOT_ALLOWED', 'Only public target URL, NODE_ENV and TZ may be configured');
  const environment = { ...processEnvironment(), HOME: path.join(scratch, 'home'), TMPDIR: path.join(scratch, 'tmp'), ...envConfig };
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) environment.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH;
  await mkdir(environment.HOME, { recursive: true }); await mkdir(environment.TMPDIR, { recursive: true }); await mkdir(path.join(scratch, 'logs'), { recursive: true });
  plan.state = 'RUNNING'; plan.startedAt = new Date().toISOString(); await writeJson(path.join(directory, 'plan.json'), plan);
  const timeoutMs = Math.max(1000, Math.min(Number(config.execution.timeoutMs) || 180000, 600000));
  let step = 0, failure = null, discovery, receipt, result, managed = { receipt: { verified: false }, stop: async () => {} }, cleanupFailure = null;
  const invoke = async command => {
    const argv = commandArray(command);
    const output = await execute(argv[0], argv.slice(1), { cwd: repo, env: environment, timeoutMs });
    await writeJson(path.join(scratch, 'logs', `${++step}.json`), { command: argv, ...output });
    invariant(output.exitCode === 0 && !output.timedOut && !output.overflow, 'EXECUTION_COMMAND_FAILED', `Execution phase ${step} failed`);
    return output;
  };
  try {
    const dependencies=await reuseForExecution(repo,config.execution.install);
    if(dependencies) {
      currentProgress()?.record('\r\n[dependencies] Reusing installed Spec Repo tools\r\n');
      await writeJson(path.join(scratch,'logs',`${++step}-dependencies.json`),{kind:'DEPENDENCIES_REUSED',key:dependencies.key});
    } else if (config.execution.install) await invoke(config.execution.install);
    for (const command of config.execution.prepare ?? []) await invoke(command);
    managed = await startManagedService(repo, config, plan, environment);
    for (const mode of ['generate', 'list', 'test']) {
      result = await runBddCommand(repo, mode, plan.requirementId, plan.featureId, { output: scratch, environment, timeoutMs: mode === 'test' ? testProcessTimeout(timeoutMs, config.execution.globalTimeoutMs) : timeoutMs, ...(mode === 'test' && config.execution.globalTimeoutMs !== undefined ? { globalTimeoutMs: config.execution.globalTimeoutMs } : {}), ...(mode === 'test' && plan.scope !== 'ALL_CASES' ? { caseIds: plan.caseIds } : {}) });
      await writeJson(path.join(scratch, 'logs', `${++step}-${mode}.json`), result);
      if (mode !== 'test') invariant(result.exitCode === 0 && !result.timedOut && !result.overflow, 'BDD_TOOLING_FAILED', `${mode} failed`);
      if (mode === 'list') {
        discovery = await readJson(path.join(scratch, 'discovery.json')); checkReceipt(discovery, plan);
        invariant(identity(definitionKeys(discovery)) === identity(expectedKeys(plan, false)), 'DISCOVERY_MISMATCH', 'Discovered cases/profiles differ from feature metadata');
      }
    }
    receipt = await readJson(path.join(scratch, 'execution.json'));
  } catch (error) { failure = errorResult(error); }
  finally {
    try { await managed.stop(); for (const command of config.execution.teardown ?? []) await invoke(command); }
    catch (error) { cleanupFailure = errorResult(error); }
  }
  let unchanged = false;
  try {
    const modules = await git.modules(repo);
    unchanged = await git.resolve(repo) === plan.testedSpecCommit && await inputSnapshot(repo, git) === plan.inputDigest
      && modules.length === plan.projects.length && modules.every(p => !p.dirty && plan.projects.some(x => x.id === p.id && x.commit === p.actual && p.commit === (plan.mode === 'REGRESSION' ? x.recordedCommit : x.commit)));
  } catch {}
  let assessment = { testOutcome: 'NOT_RUN', verification: 'NOT_VERIFIED', coverageComplete: false, evidenceComplete: false, reasons: ['EXECUTION_INCOMPLETE'] };
  if (!failure && discovery && receipt) {
    try { assessment = assessEvidence(plan, discovery, receipt, result, unchanged, managed.receipt); }
    catch (error) { failure = errorResult(error); }
  }
  if (cleanupFailure) { assessment.verification = 'NOT_VERIFIED'; assessment.reasons.push('CLEANUP_FAILED'); }
  const staging = path.join(directory, `evidence-pending-${randomUUID()}`); await mkdir(staging);
  const artifacts = await copyArtifacts(scratch, staging);
  if (receipt) for (const c of receipt.cases ?? []) for (const a of c.attachments ?? [])
    if (!artifacts.some(x => x.path === a.path)) { assessment.verification = 'NOT_VERIFIED'; assessment.evidenceComplete = false; assessment.reasons.push('MISSING_ATTACHMENT'); }
  if (plan.mode === 'REGRESSION' && !plan.approvalConfirmed) { assessment.verification = 'NOT_VERIFIED'; assessment.reasons.push('HUMAN_APPROVAL_NOT_RECORDED'); }
  const report = { schemaVersion: 1, mode: plan.mode ?? 'VERIFICATION', ...(plan.batchId ? { batchId: plan.batchId, selectedRefs: plan.selectedRefs, approvalConfirmed: plan.approvalConfirmed } : {}), specRepositoryId: plan.specRepositoryId, runId, requirementId: plan.requirementId, featureId: plan.featureId, ...assessment,
    testedSpecCommit: plan.testedSpecCommit, projects: plan.projects, scope: plan.scope, deployment: managed.receipt,
    startedAt: plan.startedAt, finishedAt: new Date().toISOString(), failure, cleanupFailure, cases: receipt?.cases ?? [] };
  await writeJson(path.join(staging, 'report.json'), report);
  await atomicWrite(path.join(staging, 'report.html'), `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>BDD ${escapeHtml(runId)}</title><h1>${escapeHtml(plan.requirementId + '/' + plan.featureId)}</h1><pre>${escapeHtml(JSON.stringify(report, null, 2))}</pre></html>\n`);
  for (const relative of ['report.json', 'report.html']) { const bytes = await readFile(path.join(staging, relative)); artifacts.push({ path: relative, size: bytes.length, sha256: digest(bytes) }); }
  const manifest = { ...report, baseline: plan.baseline, inputDigest: plan.inputDigest, inputsUnchanged: unchanged, artifacts };
  await writeJson(path.join(staging, 'manifest.json'), manifest);
  await writeJson(path.join(staging, 'seal.json'), { schemaVersion: 1, manifestSha256: digest(await readFile(path.join(staging, 'manifest.json'))) });
  await verifyBundle(staging); await rename(staging, evidence);
  plan.state = 'SEALED'; await writeJson(path.join(directory, 'plan.json'), plan);
  return manifest;
}
export async function publishRun({ root, home, repositoryId, runId, git, push = false }) {
  const directory = await safePath(home, `executions/${id(runId)}`), plan = version(await readJson(path.join(directory, 'plan.json')));
  invariant((plan.repositoryId ?? plan.workspaceId) === repositoryId, 'RUN_REPOSITORY_MISMATCH', 'Run belongs to another workspace', 403);
  const evidence = path.join(directory, 'evidence'), manifest = await verifyBundle(evidence);
  invariant(manifest.testedSpecCommit === plan.testedSpecCommit && manifest.runId === plan.runId, 'RUN_ID_MISMATCH', 'Sealed evidence belongs to another run');
  const publicationFile = path.join(directory, 'publication.json'), defaultPath = `publishers/${runId}/repo`;
  let publication, publisher;
  if (await exists(publicationFile)) {
    publication = await readJson(publicationFile);
    const publisherPath = Object.hasOwn(publication, 'publisherPath') ? publication.publisherPath : defaultPath;
    const parts = typeof publisherPath === 'string' ? publisherPath.split('/') : [];
    invariant(publisherPath === defaultPath || (parts.length === 4 && parts[0] === 'publishers' && parts[1] === runId && /^attempt-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(parts[2]) && parts[3] === 'repo'), 'INVALID_PUBLISHER_PATH', 'Publisher path must belong to this run', 403);
    publisher = await safePath(home, publisherPath, { missing: false });
    invariant(await git.resolve(publisher) === publication.reportCommit, 'PUBLICATION_CHANGED', 'Publisher branch was changed', 409);
  } else {
    const defaultPublisher = await safePath(home, defaultPath);
    const preservedPublisherPath = await exists(defaultPublisher) ? defaultPath : undefined;
    const publisherPath = preservedPublisherPath ? `publishers/${runId}/attempt-${randomUUID()}/repo` : defaultPath;
    publisher = await safePath(home, publisherPath);
    await git.cloneCandidate(root, publisher, plan.testedSpecCommit);
    const branch = `evidence/${runId}`;
    await git.branch(publisher, { name: branch, create: true }, { head: plan.testedSpecCommit });
    const prefix = `reports/${featureKey(plan.requirementId, plan.featureId)}/${runId}`, selected = [];
    for (const file of await walk(evidence)) {
      const relative = `${prefix}/${file}`, destination = await safePath(publisher, relative);
      invariant(!await exists(destination), 'REPORT_EXISTS', 'Never overwrite an existing run', 409);
      await mkdir(path.dirname(destination), { recursive: true }); await copyFile(path.join(evidence, file), destination); selected.push(relative);
    }
    const summaryPath = `reports/_runs/${runId}/summary.json`;
    await writeJson(await safePath(publisher, summaryPath), { schemaVersion: 1, runId, testedSpecCommit: plan.testedSpecCommit, features: [{ requirementId: plan.requirementId, featureId: plan.featureId, path: prefix }] }); selected.push(summaryPath);
    const commit = await git.commitSelected(publisher, { paths: selected, message: `Record BDD evidence ${runId} (tested ${plan.testedSpecCommit})` }, { head: plan.testedSpecCommit, branch });
    publication = { schemaVersion: 1, runId, testedSpecCommit: plan.testedSpecCommit, reportCommit: commit.commit, branch, status: 'LOCAL_COMMIT', path: prefix, publisherPath, ...(preservedPublisherPath && { preservedPublisherPath }) };
    await writeJson(publicationFile, publication);
  }
  if (push && publication.status !== 'PUBLISHED') {
    const url = (await git.command(root, ['remote', 'get-url', 'origin'])).stdout.trim();
    await git.command(publisher, ['remote', 'set-url', 'origin', url]);
    const result = await git.push(publisher, { branch: publication.branch }, { head: publication.reportCommit, branch: publication.branch });
    publication = { ...publication, status: 'PUBLISHED', remoteCommit: result.remoteCommit, publishedAt: new Date().toISOString() }; await writeJson(publicationFile, publication);
  }
  return publication;
}
