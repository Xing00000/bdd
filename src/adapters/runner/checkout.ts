import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile, writeFile, lstat, realpath} from 'node:fs/promises';
import {resolve, join, relative, isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {CoreError} from '../../domain/errors.ts';
import type {PreparedRun, RunnerVersion, DiscoveredTest} from '../../ports/runner.ts';
import {discoveredTests, exactSelection} from './playwright.ts';

const execute = promisify(execFile);
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
function reject(code: string, message: string): never {throw new CoreError(422, code, message);}
type Input = {checkout: string; prepared: PreparedRun; versions: RunnerVersion[]; root: string; baseUrl: string; artifactRoot: string; runId: string};
export interface CheckoutPreparation {
  [key: string]: unknown;
  config: string; selection: string; configSha256: string; selectionSha256: string;
  env: {WB_CI_CONFIG: string; WB_CI_TEST_LIST: string; WB_CI_PROJECT: 'workbench'};
  files: {path: string; sha256: string}[]; discoveredTestKeys: string[]; selectedTestKeys: string[];
}
function safeRelative(value: unknown): string {
  if (typeof value !== 'string' || !value || isAbsolute(value) || value.includes('\\') || value.includes('\0') || value.split('/').some(part => ['', '.', '..', '.git', 'node_modules'].includes(part)))
    reject('CHECKOUT_PATH_INVALID', 'Checkout bundle files must have safe repository-relative paths');
  return value;
}
async function regularFile(root: string, path: string) {
  let current = root;
  for (const part of path.split('/')) {
    current = join(current, part);
    const info = await lstat(current).catch(() => reject('CHECKOUT_FILE_MISSING', 'Fixed commit does not contain ' + path));
    if (info.isSymbolicLink()) reject('CHECKOUT_SYMLINK_REJECTED', 'Fixed commit bundle path traverses a symbolic link: ' + path);
  }
  if (!(await lstat(current)).isFile()) reject('CHECKOUT_FILE_INVALID', 'Bundle member is not a regular file: ' + path);
  return readFile(current);
}

/** Read the candidate checkout, never replace its files with SQLite copies. */
export async function prepareCheckout(input: Input): Promise<CheckoutPreparation> {
  const checkout = await realpath(input.checkout), directory = await realpath(input.prepared.directory);
  const expectedDirectory = resolve(input.artifactRoot, 'runs', input.runId);
  if (directory !== await realpath(expectedDirectory)) reject('CHECKOUT_ARTIFACT_DIRECTORY_INVALID', 'Trusted configuration must remain in this run artifact directory');
  if (checkout === directory || relative(checkout, directory) === '' || (!relative(checkout, directory).startsWith('..') && !isAbsolute(relative(checkout, directory))))
    reject('CHECKOUT_ARTIFACT_DIRECTORY_INVALID', 'Run evidence must remain outside the disposable checkout');
  const trustedSource = await readFile(input.prepared.config, 'utf8');
  if (sha(trustedSource) !== input.prepared.configSha256 || sha(await readFile(input.prepared.selection)) !== input.prepared.selectionSha256)
    reject('RUNTIME_ARTIFACT_CHANGED', 'Prepared trusted config or selected test list changed');
  if (!input.versions.length) reject('CHECKOUT_BUNDLE_EMPTY', 'Fixed test versions cannot be empty');
  const expected = new Map<string, string>(), paths = new Map<string, string>(), specPaths: string[] = [];
  for (const [index, version] of input.versions.entries()) {
    if (sha(version.raw_text) !== version.raw_sha256) reject('DOCUMENT_HASH_MISMATCH', 'Fixed version raw text hash mismatch');
    let manifest: any = {};
    try {if (version.test_manifest_json) manifest = JSON.parse(version.test_manifest_json);} catch {reject('CHECKOUT_BUNDLE_INVALID', 'Fixed manifest is invalid JSON');}
    if (manifest.specSha256 && manifest.specSha256 !== version.raw_sha256) reject('DOCUMENT_HASH_MISMATCH', 'Fixed manifest spec hash mismatch');
    const preparedPath = safeRelative(manifest.specPath ?? `script-${index + 1}.spec.ts`);
    const specPath = safeRelative(manifest.specPath ?? version.file_name ?? preparedPath);
    paths.set(preparedPath, specPath); specPaths.push(specPath);
    const members = new Map<string, string>();
    for (const member of manifest.bundleFiles ?? []) {
      const path = safeRelative(member?.path);
      if (typeof member.rawText !== 'string' || (member.sha256 && member.sha256 !== sha(member.rawText))) reject('CHECKOUT_BUNDLE_INVALID', 'Bundle member source/hash mismatch');
      if (members.has(path) && members.get(path) !== member.rawText) reject('CHECKOUT_BUNDLE_INVALID', 'Conflicting fixed bundle member');
      members.set(path, member.rawText);
    }
    if (members.has(specPath) && members.get(specPath) !== version.raw_text) reject('CHECKOUT_BUNDLE_INVALID', 'Bundle spec differs from its immutable document raw text');
    members.set(specPath, version.raw_text);
    for (const [path, rawText] of members) {
      const originalPath = path === specPath ? preparedPath : path;
      const preparedFile = input.prepared.materializations.find(file => file.versionId === version.id && relative(join(directory, 'tests'), file.file).replaceAll('\\', '/') === originalPath);
      if (!preparedFile || preparedFile.rawSha256 !== sha(rawText) || preparedFile.transformation !== null)
        reject('CHECKOUT_BASELINE_MISMATCH', 'Candidate version differs from the original prepared standard test bundle: ' + path);
      if (expected.has(path) && expected.get(path) !== sha(rawText)) reject('CHECKOUT_BUNDLE_INVALID', 'Two fixed versions conflict at ' + path);
      expected.set(path, sha(rawText));
    }
  }
  for (const [path, digest] of expected) if (sha(await regularFile(checkout, path)) !== digest)
    reject('CHECKOUT_CONTENT_MISMATCH', 'Fixed commit bytes differ from the approved test version: ' + path);

  // Patch only filesystem locations in the previously hashed, adapter-owned config.
  const source = ts.createSourceFile('trusted.config.mjs', trustedSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const exported = source.statements.find(ts.isExportAssignment);
  if (!exported || !ts.isCallExpression(exported.expression) || !exported.expression.arguments[0] || !ts.isObjectLiteralExpression(exported.expression.arguments[0]))
    reject('TRUSTED_CONFIG_INVALID', 'Prepared config must export one trusted defineConfig object');
  const configObject = exported.expression.arguments[0];
  const changes: {start: number; end: number; value: string}[] = [];
  function property(object: ts.ObjectLiteralExpression, name: string) {
    return object.properties.find((item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && ((ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)) && item.name.text === name));
  }
  function replace(object: ts.ObjectLiteralExpression, name: string, value: unknown) {
    const item = property(object, name); if (!item) reject('TRUSTED_CONFIG_INVALID', 'Prepared config is missing ' + name);
    changes.push({start: item.initializer.getStart(source), end: item.initializer.getEnd(), value: JSON.stringify(value)});
  }
  replace(configObject, 'testDir', checkout); replace(configObject, 'testMatch', specPaths);
  replace(configObject, 'outputDir', join(directory, 'test-results'));
  const use = property(configObject, 'use')?.initializer;
  if (!use || !ts.isObjectLiteralExpression(use)) reject('TRUSTED_CONFIG_INVALID', 'Prepared config has no trusted use object');
  replace(use, 'baseURL', input.baseUrl);
  const reporters = property(configObject, 'reporter')?.initializer;
  if (!reporters || !ts.isArrayLiteralExpression(reporters)) reject('TRUSTED_CONFIG_INVALID', 'Prepared config has no trusted reporters');
  let json = false, html = false;
  for (const entry of reporters.elements) if (ts.isArrayLiteralExpression(entry) && entry.elements[0] && ts.isStringLiteral(entry.elements[0]) && entry.elements[1] && ts.isObjectLiteralExpression(entry.elements[1])) {
    if (entry.elements[0].text === 'json') {replace(entry.elements[1], 'outputFile', join(directory, 'execution.json')); json = true;}
    if (entry.elements[0].text === 'html') {replace(entry.elements[1], 'outputFolder', join(directory, 'html')); html = true;}
  }
  if (!json || !html) reject('TRUSTED_CONFIG_INVALID', 'Required execution JSON and HTML evidence reporters are missing');
  let configured = trustedSource;
  for (const change of changes.sort((a, b) => b.start - a.start)) configured = configured.slice(0, change.start) + change.value + configured.slice(change.end);
  const config = join(directory, 'checkout.config.mjs'), selection = join(directory, 'checkout-selected-tests.txt');
  await writeFile(config, configured);
  const inherited = Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'TMPDIR', 'TMP', 'TEMP'].flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]!]]));
  async function discover(filtered = false) {
    let output: string;
    try {output = (await execute(process.execPath, [join(input.root, 'node_modules/playwright/cli.js'), 'test', '--config', config, '--list', '--reporter=json', ...(filtered ? ['--test-list', selection] : [])],
      {cwd: checkout, env: {...inherited, FORCE_COLOR: '0', WB_WORKBENCH_ROOT: input.root}, timeout: 45_000, maxBuffer: 16 * 1024 * 1024})).stdout;}
    catch (error: any) {reject('CHECKOUT_DISCOVERY_FAILED', String(error.stderr || error.stdout || error.message).slice(-12_000));}
    let report: any;
    try {report = JSON.parse(output);} catch {reject('CHECKOUT_DISCOVERY_FAILED', 'Checkout did not produce a JSON discovery report');}
    if (report.errors?.length) reject('CHECKOUT_DISCOVERY_FAILED', JSON.stringify(report.errors));
    return discoveredTests(report);
  }
  const discovered = await discover();
  const remap = (test: DiscoveredTest) => ({...test, file: paths.get(test.file) ?? test.file});
  const identity = (tests: DiscoveredTest[]) => tests.map(test => JSON.stringify({testKey: test.testKey, project: test.project, file: test.file, titlePath: test.titlePath, expectedStatus: test.expectedStatus})).sort();
  if (JSON.stringify(identity(discovered)) !== JSON.stringify(identity(input.prepared.tests.map(remap))))
    reject('CHECKOUT_DISCOVERY_MISMATCH', 'Fixed commit discovery differs from the full prepared test metadata');
  const selected = exactSelection(discovered, input.prepared.selected.map(test => test.testKey));
  const selectionText = selected.map(test => test.qualified).join('\n') + '\n';
  await writeFile(selection, selectionText);
  const filtered = await discover(true);
  if (JSON.stringify(identity(filtered)) !== JSON.stringify(identity(selected))) reject('CHECKOUT_SELECTION_MISMATCH', 'Checkout filtered discovery differs from the exact selected test set');
  // Discovery imports are executable code: recheck the original checkout files afterwards.
  for (const [path, digest] of expected) if (sha(await regularFile(checkout, path)) !== digest) reject('CHECKOUT_CONTENT_MISMATCH', 'Fixed commit test files changed during discovery: ' + path);
  if (sha(await readFile(config)) !== sha(configured) || sha(await readFile(selection)) !== sha(selectionText))
    reject('RUNTIME_ARTIFACT_CHANGED', 'Trusted checkout configuration or exact selection changed during discovery');
  const receipt: CheckoutPreparation = {config, selection, configSha256: sha(configured), selectionSha256: sha(await readFile(selection)),
    env: {WB_CI_CONFIG: config, WB_CI_TEST_LIST: selection, WB_CI_PROJECT: 'workbench'}, files: [...expected].map(([path, sha256]) => ({path, sha256})),
    discoveredTestKeys: discovered.map(test => test.testKey), selectedTestKeys: selected.map(test => test.testKey)};
  await writeFile(join(directory, 'checkout-preparation.json'), JSON.stringify(receipt, null, 2));
  return receipt;
}
