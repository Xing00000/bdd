import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile, readFile, symlink, lstat } from 'node:fs/promises';
import { resolve, join, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { CoreError } from '../../domain/errors.ts';
import type {TestRunnerPort, RunnerVersion, DiscoveredTest, PreparedRun} from '../../ports/runner.ts';
export type {RunnerVersion, DiscoveredTest, PreparedRun} from '../../ports/runner.ts';
const hash = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const bad = (code: string, message: string): never => { throw new CoreError(422, code, message); };

/** JSON is Playwright's public reporter output, not a title regex or a guessed ID. */
export function discoveredTests(report: any): DiscoveredTest[] {
  const found: DiscoveredTest[] = [];
  function walk(suite: any, titles: string[], fileSuite: boolean) {
    const path = fileSuite ? titles : [...titles, suite.title];
    for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) {
      const titlePath = [...path, spec.title];
      const annotations = (test.annotations ?? []).filter((a: any) => a.type === 'workbenchTestId');
      if (annotations.length > 1) bad('DISCOVERY_AMBIGUOUS', 'Multiple workbenchTestId annotations on ' + spec.title);
      const testKey = annotations[0]?.description ?? titlePath.join(' › ');
      const project = test.projectName ?? '';
      const file = String(spec.file).replaceAll('\\', '/');
      if (![project, file, ...titlePath].every((part: string) => !/[\n\r›>]/u.test(part)))
        bad('DISCOVERY_AMBIGUOUS', 'Test list cannot precisely represent this test title: ' + testKey);
      found.push({ testKey, project, file, titlePath, expectedStatus: test.expectedStatus,
        qualified: `[${project}] › ${file} › ${titlePath.join(' › ')}` });
    }
    for (const child of suite.suites ?? []) walk(child, path, false);
  }
  for (const suite of report.suites ?? []) walk(suite, [], true);
  return found;
}

export function exactSelection(discovered: DiscoveredTest[], expectedKeys: string[]) {
  if (!expectedKeys.length || new Set(expectedKeys).size !== expectedKeys.length) bad('DISCOVERY_INVALID', 'Expected test collection is empty or duplicated');
  const result = expectedKeys.map(key => {
    const candidates = discovered.filter(test => test.testKey === key);
    if (candidates.length !== 1) bad('DISCOVERY_AMBIGUOUS', `Test ${key} resolves to ${candidates.length} runner tests`);
    if (candidates[0].expectedStatus !== 'passed') bad('TEST_NOT_RUNNABLE', `Test ${key} is skipped or marked as expected failure`);
    return candidates[0];
  });
  if (new Set(result.map(test => test.qualified)).size !== result.length) bad('DISCOVERY_AMBIGUOUS', 'Two stable test IDs resolve to the same qualified runner title');
  return result;
}

// The database raw version is preserved; only the runner copy receives the managed fixture import.
function materialize(raw: string, fixture: string) {
  const source = ts.createSourceFile('replay.spec.ts', raw, ts.ScriptTarget.Latest, true);
  const changes: {start: number; end: number; text: string}[] = [];
  for (const statement of source.statements) if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === '@playwright/test')
    changes.push({start: statement.moduleSpecifier.getStart(source), end: statement.moduleSpecifier.getEnd(), text: JSON.stringify(fixture)});
  for (const change of changes.reverse()) raw = raw.slice(0, change.start) + change.text + raw.slice(change.end);
  return {text: raw, changed: changes.length > 0};
}

export function createPlaywrightRunner(input: {root: string; artifactRoot: string; baseUrl: string}): TestRunnerPort {
  const cli = join(input.root, 'node_modules/playwright/cli.js');
  const playwright = join(input.root, 'node_modules/@playwright/test/index.mjs');
  const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
  const reporter = fileURLToPath(new URL('./reporter.' + extension, import.meta.url));
  const replayFixture = fileURLToPath(new URL('./replay-fixture.' + extension, import.meta.url));
  const children = new Set<ChildProcess>();
  let closing = false;
  async function command(args: string[], directory: string, env: NodeJS.ProcessEnv = {}, log?: string) {
    return new Promise<{code: number; stdout: string; stderr: string}>((resolveResult, reject) => {
      if (closing) return reject(new CoreError(503, 'RUNNER_CLOSED', 'Runner is closing'));
      const inherited = Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'TMPDIR', 'TMP', 'TEMP', 'SYSTEMROOT', 'PLAYWRIGHT_BROWSERS_PATH', 'WB_TARGET_PASSWORD', 'WB_TARGET_BASE_URL']
        .flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]!]]));
      const processChild = spawn(process.execPath, [cli, ...args], {cwd: directory, env: {...inherited, WB_WORKBENCH_ROOT: input.root, FORCE_COLOR: '0', ...env}, stdio: ['ignore', 'pipe', 'pipe']});
      children.add(processChild);
      let stdout = '', stderr = '', overflow = false;
      processChild.stdout.on('data', chunk => { if (stdout.length < 16_000_000) stdout += chunk; else overflow = true; });
      processChild.stderr.on('data', chunk => { if (stderr.length < 4_000_000) stderr += chunk; else overflow = true; });
      const timer = setTimeout(() => { processChild.kill('SIGTERM'); setTimeout(() => processChild.kill('SIGKILL'), 3_000).unref(); }, 180_000);
      processChild.once('error', error => { clearTimeout(timer); reject(error); });
      processChild.once('close', async code => {
        children.delete(processChild);
        clearTimeout(timer);
        if (log) await writeFile(log, JSON.stringify({code, stdout, stderr, overflow}, null, 2));
        resolveResult({code: overflow ? 2 : code ?? 2, stdout, stderr});
      });
    });
  }
  async function discover(config: string, directory: string, selection?: string) {
    const result = await command(['test', '--config', config, '--list', '--reporter=json', ...(selection ? ['--test-list', selection] : [])], directory);
    if (result.code !== 0) bad('DISCOVERY_FAILED', (result.stderr || result.stdout).slice(-12_000));
    let json: any;
    try { json = JSON.parse(result.stdout); } catch { bad('DISCOVERY_FAILED', 'Playwright did not produce a JSON discovery report: ' + result.stdout.slice(-2_000)); }
    if (json.errors?.length) bad('DISCOVERY_FAILED', JSON.stringify(json.errors));
    return discoveredTests(json);
  }
  return {
    async prepare(runId: string, versions: RunnerVersion[], expectedKeys?: string[], independent = false): Promise<PreparedRun> {
      const directory = resolve(input.artifactRoot, 'runs', runId);
      await mkdir(join(directory, 'tests'), {recursive: true});
      try { await lstat(join(directory, 'node_modules')); } catch { await symlink(join(input.root, 'node_modules'), join(directory, 'node_modules'), 'dir'); }
      await writeFile(join(directory, 'package.json'), '{"type":"module","private":true}\n');
      const materializations: PreparedRun['materializations'] = [];
      const occupied = new Map<string, string>();
      const specPaths: string[] = [];
      for (const [index, version] of versions.entries()) {
        if (hash(version.raw_text) !== version.raw_sha256) bad('DOCUMENT_HASH_MISMATCH', 'Stored raw text hash mismatch: ' + version.id);
        const manifest = version.test_manifest_json ? JSON.parse(version.test_manifest_json) : {};
        const specPath = manifest.specPath ?? `script-${index + 1}.spec.ts`;
        const files = new Map<string, string>();
        for (const member of manifest.bundleFiles ?? []) {
          if (typeof member.path !== 'string' || typeof member.rawText !== 'string' || (member.sha256 && member.sha256 !== hash(member.rawText))) bad('BUNDLE_INVALID', 'Bundle member is missing source or has an invalid hash');
          if (files.has(member.path) && files.get(member.path) !== member.rawText) bad('BUNDLE_INVALID', 'Conflicting duplicate bundle member');
          files.set(member.path, member.rawText);
        }
        if (files.has(specPath) && files.get(specPath) !== version.raw_text) bad('BUNDLE_INVALID', 'Bundle spec differs from the immutable document raw text');
        files.set(specPath, version.raw_text);
        specPaths.push(specPath);
        for (const [relative, raw] of files) {
          if (isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(part => part === '..' || part === 'node_modules') || !relative || relative === 'package.json') bad('BUNDLE_PATH_INVALID', 'Bundle paths must stay inside the test source directory');
          if (occupied.has(relative) && occupied.get(relative) !== raw) bad('BUNDLE_INVALID', 'Conflicting bundle paths across versions');
          occupied.set(relative, raw);
          const file = join(directory, 'tests', relative);
          const transformed = independent ? materialize(raw, replayFixture) : {text: raw, changed: false};
          await mkdir(dirname(file), {recursive: true});
          await writeFile(file, transformed.text);
          materializations.push({versionId: version.id, rawSha256: hash(raw), materializedSha256: hash(transformed.text), file,
            transformation: transformed.changed ? 'managed-page-fixture-import' : null});
        }
      }
      const config = join(directory, 'playwright.config.mjs');
      await writeFile(config, `import {defineConfig} from ${JSON.stringify(playwright)};\nexport default defineConfig({testDir:'./tests',testMatch:${JSON.stringify(specPaths)},outputDir:'./test-results',forbidOnly:true,fullyParallel:false,workers:1,retries:0,timeout:45000,globalTimeout:150000,reporter:[[${JSON.stringify(reporter)}],["json",{outputFile:'execution.json'}],["html",{outputFolder:'html',open:'never'}]],use:{baseURL:${JSON.stringify(input.baseUrl)},launchOptions:{chromiumSandbox:true}},projects:[{name:'workbench',dependencies:[]}]});\n`);
      const tests = await discover(config, directory);
      const selected = exactSelection(tests, expectedKeys ?? tests.map(test => test.testKey));
      const selection = join(directory, 'selected-tests.txt');
      await writeFile(selection, selected.map(test => test.qualified).join('\n') + '\n');
      const filtered = await discover(config, directory, selection);
      const keys = (values: DiscoveredTest[]) => values.map(test => test.testKey + '\0' + test.qualified).sort();
      if (JSON.stringify(keys(filtered)) !== JSON.stringify(keys(selected))) bad('DISCOVERY_SELECTION_MISMATCH', 'Filtered discovery does not exactly equal the approved execution set');
      await writeFile(join(directory, 'discovery.json'), JSON.stringify({tests, selected, materializations}, null, 2));
      return {directory, config, configSha256: hash(await readFile(config)), selection, selectionSha256: hash(await readFile(selection)), tests, selected, materializations};
    },
    async execute(runId: string, prepared: PreparedRun, token: string) {
      // Rehash runtime copies immediately before execution; never run a stale prepared script.
      for (const file of prepared.materializations) if (hash(await readFile(file.file)) !== file.materializedSha256)
        throw new CoreError(409, 'RUNTIME_ARTIFACT_CHANGED', 'Prepared runner script changed before execution');
      if (hash(await readFile(prepared.config)) !== prepared.configSha256 || hash(await readFile(prepared.selection)) !== prepared.selectionSha256)
        throw new CoreError(409, 'RUNTIME_ARTIFACT_CHANGED', 'Prepared runner configuration or exact test selection changed before execution');
      return command(['test', '--config', prepared.config, '--test-list', prepared.selection, '--project=workbench'], prepared.directory,
        {WB_BASE_URL: input.baseUrl, WB_RUN_ID: runId, WB_RUN_EVENT_TOKEN: token}, join(prepared.directory, 'process.json'));
    },
    async close() {
      closing = true;
      const waiting = [...children].map(child => new Promise<void>(resolveClose => {child.once('close', () => resolveClose()); child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 3_000); timer.unref();}));
      await Promise.all(waiting);
    },
  };
}
