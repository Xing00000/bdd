import { mkdir, mkdtemp, writeFile, readFile, symlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ts from 'typescript';
import { sha, syntax } from './definitions.js';
import { declaredIds } from './llm.js';
import type { GenerationOptions } from './types.js';

const execute = promisify(execFile);
type Input = { rawText: string; files?: { path: string; rawText: string }[]; manifest: Record<string, any> };
type Diagnostic = { file: string; line: number; column: number; reason: string };
export type CompletionReceipt = {
  passed: boolean; checks: Record<string, boolean>; diagnostics: Diagnostic[]; discoveredTestKeys: string[];
  scope: 'IMPLEMENTATION_CHECKS_ONLY'; productE2E: 'NOT_RUN'; specSha256: string;
  fileHashes: Record<string, string>; isolation: 'CLOUD_CHILD_PROCESS';
};
export function createCompletionValidator(options: GenerationOptions) {
  return {
    async validateCompletion(input: Input): Promise<CompletionReceipt> {
      const receipt: CompletionReceipt = { passed: false, checks: { syntax: false, pendingAndDisabled: false, mapping: false, typecheck: false, discovery: false },
        diagnostics: [], discoveredTestKeys: [], scope: 'IMPLEMENTATION_CHECKS_ONLY', productE2E: 'NOT_RUN',
        specSha256: sha(input.rawText), fileHashes: {}, isolation: 'CLOUD_CHILD_PROCESS' };
      const diagnostic = (file: string, reason: string, line = 1, column = 1) => receipt.diagnostics.push({ file, line, column, reason });
      const specPath = input.manifest.specPath ?? 'generated/workbench.feature.spec.ts';
      const supplied = input.files ?? input.manifest.bundleFiles ?? [];
      const files = new Map<string, string>();
      for (const file of supplied) {
        if (!file || typeof file.path !== 'string' || typeof file.rawText !== 'string') {
          diagnostic('bundle', 'Bundle files require path and rawText'); continue;
        }
        if (isAbsolute(file.path) || file.path.includes('\\') || file.path.split('/').some((segment: string) => ['..', 'node_modules', '.git'].includes(segment))
          || ['package.json', 'validation.config.ts'].includes(file.path) || !/\.(?:[cm]?[jt]s|json|feature)$/.test(file.path)) {
          diagnostic(file.path, 'Bundle path is outside the permitted relative source-file namespace'); continue;
        }
        if (files.has(file.path) && files.get(file.path) !== file.rawText) diagnostic(file.path, 'Conflicting duplicate bundle path');
        files.set(file.path, file.rawText);
      }
      if (typeof specPath !== 'string' || isAbsolute(specPath) || specPath.includes('\\') || specPath.split('/').includes('..') || !specPath.endsWith('.spec.ts'))
        diagnostic('manifest', 'specPath must be a relative .spec.ts file');
      if (receipt.diagnostics.length) return receipt;
      files.set(specPath, input.rawText);
      const sources: ts.SourceFile[] = [];
      try {
        for (const [file, raw] of files) if (/\.[cm]?[jt]s$/.test(file)) sources.push(syntax(raw, file));
        receipt.checks.syntax = true;
      } catch (cause: any) { receipt.diagnostics.push(...(cause.diagnostics ?? [{ file: specPath, line: 1, column: 1, reason: cause.message }])); return receipt; }
      for (const source of sources) {
        const fail = (node: ts.Node, reason: string) => {
          const p = source.getLineAndCharacterOfPosition(node.getStart(source)); diagnostic(source.fileName, reason, p.line + 1, p.character + 1);
        };
        const visit = (node: ts.Node) => {
          if (ts.isStringLiteral(node) && /PENDING_COMPLETION|UnimplementedStepError|\bTODO\b|not implemented/i.test(node.text))
            fail(node, 'Unresolved completion slot or implementation stub');
          if (ts.isIdentifier(node) && node.text === 'UnimplementedStepError') fail(node, 'UnimplementedStepError remains in completed bundle');
          if (ts.isCallExpression(node)) {
            if (ts.isPropertyAccessExpression(node.expression) && ['skip', 'fixme', 'only', 'fail', 'todo'].includes(node.expression.name.text)
              && (node.expression.expression.getText(source) === 'test' || node.expression.expression.getText(source).startsWith('test.describe')))
              fail(node, 'Disabled, focused, or expected-failing tests cannot establish a completed baseline');
            if (ts.isIdentifier(node.expression) && ['Given', 'When', 'Then', 'Step', 'test'].includes(node.expression.text)) {
              const callback = node.arguments[node.arguments.length - 1];
              if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
                && ts.isBlock(callback.body) && !callback.body.statements.length) fail(callback, 'Empty test or step implementation');
            }
            if (ts.isIdentifier(node.expression) && node.expression.text === 'expect' && node.arguments.length === 1
              && [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(node.arguments[0].kind))
              fail(node, 'A literal boolean assertion cannot replace an acceptance assertion');
          }
          ts.forEachChild(node, visit);
        };
        visit(source);
      }
      if (receipt.diagnostics.length) return receipt;
      receipt.checks.pendingAndDisabled = true;
      const required = (input.manifest.mappings ?? input.manifest.cases ?? []).map((mapping: any) => mapping.testKey);
      const declared = declaredIds(sources.find(source => source.fileName === specPath)!);
      if (!required.length || required.some((key: unknown) => typeof key !== 'string' || !declared.includes(key))
        || new Set(declared).size !== declared.length || declared.some(key => !required.includes(key))) {
        diagnostic(specPath, 'Every declared test ID must match exactly one baseline mapping; no original test may be removed'); return receipt;
      }
      receipt.checks.mapping = true;
      await mkdir(options.artifactRoot, { recursive: true });
      const directory = await mkdtemp(join(resolve(options.artifactRoot), 'completion-check-'));
      let require = createRequire(join(resolve(options.root), 'product/package.json'));
      let packagePath: string;
      try { packagePath = require.resolve('@playwright/test/package.json'); }
      catch { require = createRequire(join(resolve(options.root), 'package.json')); packagePath = require.resolve('@playwright/test/package.json'); }
      const moduleRoot = dirname(dirname(dirname(packagePath)));
      await symlink(moduleRoot, join(directory, 'node_modules'), 'dir');
      await writeFile(join(directory, 'package.json'), '{"type":"module"}\n');
      for (const [path, raw] of files) {
        const destination = resolve(directory, path), rel = relative(directory, destination);
        if (rel.startsWith('..') || !rel) { diagnostic(path, 'Path escapes validation directory'); return receipt; }
        await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, raw); receipt.fileHashes[path] = sha(raw);
      }
      const program = ts.createProgram([...files.keys()].filter(path => /\.[cm]?[jt]s$/.test(path)).map(path => join(directory, path)), {
        noEmit: true, target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
        strict: true, skipLibCheck: true, allowImportingTsExtensions: true, resolveJsonModule: true, esModuleInterop: true,
        types: ['node'], typeRoots: [join(directory, 'node_modules/@types')],
      });
      for (const item of ts.getPreEmitDiagnostics(program)) {
        const point = item.file?.getLineAndCharacterOfPosition(item.start ?? 0);
        diagnostic(item.file ? relative(directory, item.file.fileName) : specPath,
          ts.flattenDiagnosticMessageText(item.messageText, '\n'), (point?.line ?? 0) + 1, (point?.character ?? 0) + 1);
      }
      if (receipt.diagnostics.length) { await writeFile(join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2)); return receipt; }
      receipt.checks.typecheck = true;
      await writeFile(join(directory, 'validation.config.ts'), `export default {testDir:'.',testMatch:${JSON.stringify(specPath)},workers:1,retries:0,forbidOnly:true,reporter:'json',outputDir:'./results'};\n`);
      try {
        const result = await execute(process.execPath, ['--max-old-space-size=256', join(dirname(packagePath), 'cli.js'), 'test', '--config',
          join(directory, 'validation.config.ts'), '--list', '--reporter=json'], { cwd: directory, timeout: 45_000, maxBuffer: 4 * 1024 * 1024,
          env: { PATH: process.env.PATH, TMPDIR: directory, FORCE_COLOR: '0', CI: '1' } });
        await writeFile(join(directory, 'discovery.log'), result.stdout + result.stderr);
        const report = JSON.parse(result.stdout), discovered: string[] = [];
        const visit = (suite: any) => {
          for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) {
            const annotations = test.annotations ?? spec.annotations ?? [];
            const identifiers = annotations.filter((annotation: any) => annotation.type === 'workbenchTestId');
            if (identifiers.length !== 1) throw Error(`Discovered test ${spec.title} lacks a unique workbenchTestId`);
            discovered.push(identifiers[0].description);
          }
          for (const child of suite.suites ?? []) visit(child);
        };
        for (const suite of report.suites ?? []) visit(suite);
        receipt.discoveredTestKeys = discovered;
        if (discovered.length !== required.length || new Set(discovered).size !== discovered.length || required.some((id: string) => !discovered.includes(id)))
          throw Error('Discovery differs from the exact required test set');
        receipt.checks.discovery = true;
      } catch (cause: any) {
        diagnostic(specPath, String(cause.stderr || cause.stdout || cause.message).slice(-16_000));
      }
      receipt.passed = Object.values(receipt.checks).every(Boolean) && !receipt.diagnostics.length;
      await writeFile(join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
      return receipt;
    },
  };
}
