import { mkdir, mkdtemp, writeFile, readFile, readdir, symlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ts from 'typescript';
import { generateMessages } from '@cucumber/gherkin';
import { IdGenerator, SourceMediaType } from '@cucumber/messages';
import { GenerationError } from './errors.js';
import { definitions, sha, syntax } from './definitions.js';
import type { GenerationInput, GenerationOptions, GenerationResult } from './types.js';

const execute = promisify(execFile);
type Case = { scenarioId: string; caseId: string; testKey: string; sourceCaseId?: string; scenarioLine: number; pickleLine: number; expandedSteps: string[] };
function parseCases(input: GenerationInput): Case[] {
  const envelopes = generateMessages(input.feature, 'features/workbench.feature', SourceMediaType.TEXT_X_CUCUMBER_GHERKIN_PLAIN, {
    newId: IdGenerator.incrementing(), includeGherkinDocument: true, includePickles: true, includeSource: false,
  });
  const errors = envelopes.flatMap(e => e.parseError ? [{ file: 'workbench.feature', line: e.parseError.source.location?.line ?? 1,
    column: e.parseError.source.location?.column ?? 1, reason: e.parseError.message }] : []);
  if (errors.length) throw new GenerationError(422, 'SYNTAX_INVALID', 'Gherkin 語法錯誤', errors);
  const feature = envelopes.find(e => e.gherkinDocument)?.gherkinDocument?.feature;
  if (!feature) throw new GenerationError(422, 'SYNTAX_INVALID', 'Feature is required');
  const scenarios = new Map<string, any>(), rows = new Map<string, { line: number; caseId: string }>();
  const walk = (children: readonly any[]) => { for (const child of children) {
    if (child.rule) walk(child.rule.children);
    if (!child.scenario) continue;
    const scenario = child.scenario; scenarios.set(scenario.id, scenario);
    for (const example of scenario.examples) {
      const index = example.tableHeader?.cells.findIndex((cell: any) => cell.value === 'case_id') ?? -1;
      if (index < 0) throw new GenerationError(422, 'MAPPING_INVALID', `Examples at line ${example.location.line} requires case_id`);
      for (const row of example.tableBody) rows.set(row.id, { line: row.location.line, caseId: row.cells[index]?.value });
    }
  } };
  walk(feature.children);
  const result = envelopes.flatMap(({ pickle }) => {
    if (!pickle) return [];
    const scenario = scenarios.get(pickle.astNodeIds[0]);
    if (!scenario) throw new GenerationError(422, 'MAPPING_INVALID', 'Unknown Pickle source Scenario');
    const ids = scenario.tags.filter((tag: any) => /^@AC-[\w-]+$/.test(tag.name));
    if (ids.length !== 1) throw new GenerationError(422, 'MAPPING_INVALID', `Scenario at line ${scenario.location.line} requires exactly one @AC-* ID`);
    const scenarioId = ids[0].name.slice(1), row = rows.get(pickle.astNodeIds[1]), caseId = row?.caseId ?? 'default';
    if (!caseId) throw new GenerationError(422, 'MAPPING_INVALID', 'Empty Examples case_id');
    const matches = input.sourceCases.filter(c => (c.scenarioId ?? c.scenarioKey ?? c.scenario_key) === scenarioId
      && (c.caseId ?? c.caseKey ?? c.case_key) === caseId);
    if (input.sourceCases.length && matches.length !== 1)
      throw new GenerationError(422, 'MAPPING_INVALID', `Source-case projection missing or ambiguous: ${scenarioId}/${caseId}`);
    const source = matches[0], prefix = source?.requirementKey ? `${source.requirementKey}/` : '';
    return [{ scenarioId, caseId, testKey: source?.testKey ?? `${prefix}${scenarioId}/${caseId}`,
      sourceCaseId: source?.sourceCaseId ?? source?.id, scenarioLine: scenario.location.line,
      pickleLine: row?.line ?? scenario.location.line, expandedSteps: pickle.steps.map(step => step.text) }];
  });
  if (!result.length || new Set(result.map(c => `${c.scenarioId}/${c.caseId}`)).size !== result.length
    || new Set(result.map(c => c.testKey)).size !== result.length)
    throw new GenerationError(422, 'MAPPING_INVALID', 'Source cases and test IDs must be nonempty and unique');
  if (input.sourceCases.length && result.length !== input.sourceCases.length)
    throw new GenerationError(422, 'MAPPING_INVALID', 'Source-case projection contains cases outside this Gherkin version');
  return result;
}

function adapt(raw: string, cases: Case[]) {
  const section = raw.split('// bdd-data-start\n')[1]?.split(']; // bdd-data-end')[0];
  if (!section) throw new GenerationError(500, 'GENERATOR_FORMAT_CHANGED', 'Pinned bddgen metadata format changed');
  const metadata = section.trim().split('\n').map(line => JSON.parse(line.trim().replace(/,$/, '')));
  if (metadata.length !== cases.length) throw new GenerationError(422, 'MAPPING_INVALID', 'Generated case count differs from approved source');
  const source = ts.createSourceFile('native.spec.js', raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const calls = new Map<number, ts.CallExpression>();
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'test')
      calls.set(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  const edits: { position: number; text: string }[] = [];
  const mapped = metadata.map(item => {
    const ids = item.tags.filter((tag: string) => /^@AC-[\w-]+$/.test(tag));
    const match = cases.filter(c => ids.length === 1 && c.scenarioId === ids[0].slice(1) && c.pickleLine === item.pickleLine);
    if (match.length !== 1) throw new GenerationError(422, 'MAPPING_INVALID', 'Native source metadata is missing or ambiguous');
    const entry = match[0], call = calls.get(item.pwTestLine);
    if (!call || call.arguments.length !== 3 || !ts.isObjectLiteralExpression(call.arguments[1]))
      throw new GenerationError(500, 'GENERATOR_FORMAT_CHANGED', 'Pinned bddgen declaration format changed');
    edits.push({ position: call.arguments[1].getEnd() - 1,
      text: `, annotation: [{type:'workbenchTestId',description:${JSON.stringify(entry.testKey)}}]` });
    return { ...entry, generatedLine: item.pwTestLine, steps: item.steps.map((step: any) => ({ sourceLine: step.gherkinStepLine,
      generatedLine: step.pwStepLine, keywordType: step.keywordType, expandedText: step.textWithKeyword, background: step.isBg ?? false })) };
  });
  if (new Set(mapped.map(c => c.testKey)).size !== cases.length)
    throw new GenerationError(422, 'MAPPING_INVALID', 'Duplicate or omitted generated source mapping');
  let output = raw;
  for (const edit of edits.sort((a, b) => b.position - a.position)) output = output.slice(0, edit.position) + edit.text + output.slice(edit.position);
  const marker = 'use(bddFileData)';
  if (output.split(marker).length !== 2) throw new GenerationError(500, 'GENERATOR_FORMAT_CHANGED', 'Pinned fixture metadata format changed');
  output = output.replace(marker, "use(bddFileData as import('playwright-bdd').BddTestFixtures['$bddFileData'])");
  let erased = output;
  for (const edit of edits) erased = erased.replace(edit.text, '');
  const emit = (rawText: string) => ts.transpileModule(rawText, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText;
  if (emit(erased) !== emit(raw) || output.split('\n').length !== raw.split('\n').length)
    throw new GenerationError(500, 'ADAPTER_BEHAVIOR_CHANGED', 'TS adapter changed native behavior or source line offsets');
  syntax(output, 'generated/workbench.feature.spec.ts');
  return { output, cases: mapped };
}

export function createGenerator(options: GenerationOptions) {
  return {
    async generate(input: GenerationInput): Promise<GenerationResult> {
      const sourceCases = parseCases(input), registry = definitions(input.stepDefinitions);
      await mkdir(options.artifactRoot, { recursive: true });
      const directory = await mkdtemp(join(resolve(options.artifactRoot), 'generation-'));
      let require = createRequire(join(resolve(options.root), 'product/package.json'));
      let packagePath: string;
      try { packagePath = require.resolve('playwright-bdd/package.json'); }
      catch { require = createRequire(join(resolve(options.root), 'package.json')); packagePath = require.resolve('playwright-bdd/package.json'); }
      await symlink(dirname(dirname(packagePath)), join(directory, 'node_modules'), 'dir');
      await mkdir(join(directory, 'features')); await mkdir(join(directory, 'steps')); await mkdir(join(directory, 'generated'));
      await writeFile(join(directory, 'package.json'), '{"type":"module"}\n');
      await writeFile(join(directory, 'features/workbench.feature'), input.feature);
      await writeFile(join(directory, 'steps/pending.steps.ts'), registry.rawText);
      await writeFile(join(directory, 'playwright.config.ts'), `import {defineConfig} from '@playwright/test';\nimport {defineBddConfig} from 'playwright-bdd';\nexport default defineConfig({testDir:defineBddConfig({features:'features/workbench.feature',featuresRoot:'features',steps:['steps/pending.steps.ts'],outputDir:'native',missingSteps:'fail-on-gen',examplesTitleFormat:'<case_id>'}),workers:1,retries:0,forbidOnly:true});\n`);
      let stdout = '', stderr = '';
      try {
        const result = await execute(process.execPath, [join(dirname(packagePath), 'dist/cli/index.js'), 'test', '--config', join(directory, 'playwright.config.ts')],
          { cwd: directory, encoding: 'utf8', timeout: 45_000, maxBuffer: 4 * 1024 * 1024 });
        stdout = result.stdout; stderr = result.stderr;
      } catch (cause: any) {
        stdout = String(cause.stdout ?? ''); stderr = String(cause.stderr ?? '');
        await writeFile(join(directory, 'generation.log'), stdout + stderr);
        const reason = (stdout + stderr).trim().slice(-24_000) || String(cause.message);
        throw new GenerationError(422, /Ambiguous|Multiple definitions matched/i.test(reason) ? 'AMBIGUOUS_STEPS' : 'UNDEFINED_OR_INVALID_STEPS', reason,
          [{ file: 'workbench.feature', line: 1, column: 1, reason }]);
      }
      const natives = (await readdir(join(directory, 'native'))).filter(file => file.endsWith('.spec.js'));
      if (natives.length !== 1) throw new GenerationError(500, 'GENERATOR_FORMAT_CHANGED', 'Expected exactly one generated native spec');
      const native = await readFile(join(directory, 'native', natives[0]), 'utf8'), converted = adapt(native, sourceCases);
      const specPath = 'generated/workbench.feature.spec.ts';
      const files = [{ path: specPath, rawText: converted.output }, { path: 'steps/pending.steps.ts', rawText: registry.rawText },
        { path: 'features/workbench.feature', rawText: input.feature },
        { path: 'workbench.config.ts', rawText: `import {defineConfig} from '@playwright/test';\nimport {defineBddConfig} from 'playwright-bdd';\nexport default defineConfig({testDir:defineBddConfig({features:'features/workbench.feature',featuresRoot:'features',steps:['steps/pending.steps.ts'],outputDir:'generated',missingSteps:'fail-on-gen',examplesTitleFormat:'<case_id>'}),testMatch:'**/*.spec.ts',workers:1,retries:0,forbidOnly:true});\n` }];
      await writeFile(join(directory, specPath), converted.output);
      await writeFile(join(directory, 'generation.log'), stdout + stderr);
      const manifest: Record<string, any> = {
        schemaVersion: 1, artifactStage: 'SKELETON', completionStatus: 'PENDING', productE2E: 'NOT_RUN',
        generator: { name: 'playwright-bdd', version: JSON.parse(await readFile(packagePath, 'utf8')).version,
          adapter: 'workbench-ts-metadata-v1', exitCode: 0 },
        runtimeBehaviorPreserved: true, featureSha256: sha(input.feature), specSha256: sha(converted.output),
        nativeSha256: sha(native), specPath, scenarioCount: new Set(sourceCases.map(c => c.scenarioId)).size,
        caseCount: sourceCases.length, cases: converted.cases,
        mappings: converted.cases.map(c => ({ testKey: c.testKey, scenarioId: c.scenarioId, caseId: c.caseId, sourceCaseId: c.sourceCaseId })),
        pendingSlots: registry.entries, uploadedDefinitionHashes: registry.uploadedHashes,
        fileHashes: Object.fromEntries(files.map(file => [file.path, sha(file.rawText)])),
        bundleFiles: files,
      };
      manifest.manifestSha256 = sha(JSON.stringify(manifest));
      await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
      return { rawText: converted.output, manifest, files, specPath };
    },
  };
}
