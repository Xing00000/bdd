import { generateMessages, dialects } from '@cucumber/gherkin';
import { IdGenerator, SourceMediaType } from '@cucumber/messages';
import ts from 'typescript';
import { invalid, type Diagnostic } from './errors.ts';

export type Position = { line: number; column: number };
export type ParsedStep = Position & { keyword: string; text: string; argument: unknown };
export type ParsedCase = Position & { caseKey: string; rowOrdinal: number; values: string[] };
export type ParsedExamples = { title: string; columns: string[]; rows: ParsedCase[] };
export type ParsedScenario = Position & { scenarioKey: string; title: string; kind: 'scenario' | 'outline'; examples: ParsedExamples[] };
export type ParsedGroup = { ownerKey: string; scope: 'feature_background' | 'rule_background' | 'scenario'; scenarioKey: string | null; steps: ParsedStep[] };
export type ParsedGherkin = { scenarios: ParsedScenario[]; groups: ParsedGroup[]; pickles: unknown[] };

export function parseGherkin(raw: string, file: string): ParsedGherkin {
  const messages = generateMessages(raw, file, SourceMediaType.TEXT_X_CUCUMBER_GHERKIN_PLAIN, {
    newId: IdGenerator.uuid(), includeGherkinDocument: true, includePickles: true, includeSource: false,
  });
  const errors = messages.flatMap(message => message.parseError ? [{
    line: message.parseError.source.location?.line ?? 1,
    column: message.parseError.source.location?.column ?? 1,
    reason: message.parseError.message,
  }] : []);
  if (errors.length) invalid(file, 'SYNTAX_INVALID', errors);
  const feature = messages.find(message => message.gherkinDocument)?.gherkinDocument?.feature;
  if (!feature) invalid(file, 'SYNTAX_INVALID', [{ line: 1, column: 1, reason: 'A Feature is required' }]);
  const scenarios: ParsedScenario[] = [], groups: ParsedGroup[] = [];
  const diagnostics: Omit<Diagnostic, 'code'>[] = [], keys = new Set<string>();
  const steps = (source: any[]): ParsedStep[] => source.map(step => ({
    keyword: step.keyword, text: step.text, line: step.location.line, column: step.location.column ?? 1,
    argument: step.docString ? { docString: step.docString } : step.dataTable ? { dataTable: step.dataTable } : null,
  }));
  const visit = (children: readonly any[], parent: string, scope: 'feature_background' | 'rule_background') => {
    children.forEach((child, index) => {
      const path = `${parent}:${index + 1}`;
      if (child.background) groups.push({ ownerKey: `${path}:background`, scope, scenarioKey: null, steps: steps(child.background.steps) });
      if (child.rule) visit(child.rule.children, `${path}:rule`, 'rule_background');
      if (!child.scenario) return;
      const scenario = child.scenario, location = { line: scenario.location.line, column: scenario.location.column ?? 1 };
      const ids = scenario.tags.map((tag: any) => tag.name).filter((name: string) => /^@AC-[\w-]+$/.test(name));
      if (ids.length !== 1) diagnostics.push({ ...location, reason: 'Scenario must declare exactly one stable @AC-* ID tag' });
      const scenarioKey = String(ids[0] ?? `invalid-${index}`).slice(1);
      if (keys.has(scenarioKey)) diagnostics.push({ ...location, reason: `Duplicate Scenario ID ${scenarioKey}` });
      keys.add(scenarioKey);
      const outline = dialects[feature!.language]?.scenarioOutline.includes(scenario.keyword) || scenario.examples.length > 0;
      const caseKeys = new Set<string>();
      const examples: ParsedExamples[] = scenario.examples.map((example: any) => {
        const columns: string[] = example.tableHeader?.cells.map((cell: any) => cell.value) ?? [];
        const caseIndex = columns.indexOf('case_id');
        if (caseIndex < 0 || columns.length !== new Set(columns).size)
          diagnostics.push({ line: example.location.line, column: example.location.column ?? 1, reason: 'Examples must have distinct columns including case_id' });
        const rows = example.tableBody.map((row: any, rowIndex: number): ParsedCase => {
          const values: string[] = row.cells.map((cell: any) => cell.value);
          const caseKey = values[caseIndex] ?? '';
          const rowLocation = { line: row.location.line, column: row.location.column ?? 1 };
          if (values.length !== columns.length || !caseKey.trim() || caseKeys.has(caseKey))
            diagnostics.push({ ...rowLocation, reason: `Invalid or duplicate Examples case_id ${JSON.stringify(caseKey)}` });
          caseKeys.add(caseKey);
          return { ...rowLocation, caseKey, rowOrdinal: rowIndex + 1, values };
        });
        if (!rows.length) diagnostics.push({ ...location, reason: 'Scenario Outline must contain at least one Examples row' });
        return { title: example.name, columns, rows };
      });
      if (outline && !examples.length) diagnostics.push({ ...location, reason: 'Scenario Outline requires Examples with explicit case_id' });
      scenarios.push({ ...location, scenarioKey, title: scenario.name, kind: outline ? 'outline' : 'scenario', examples });
      groups.push({ ownerKey: `${path}:scenario`, scope: 'scenario', scenarioKey, steps: steps(scenario.steps) });
    });
  };
  visit(feature!.children, 'feature', 'feature_background');
  if (!scenarios.length) diagnostics.push({ line: feature!.location.line, column: 1, reason: 'At least one Scenario is required' });
  if (diagnostics.length) invalid(file, 'MAPPING_INVALID', diagnostics);
  return { scenarios, groups, pickles: messages.flatMap(message => message.pickle ? [message.pickle] : []) };
}

export type ParsedTest = Position & { testKey: string; title: string; hasExplicitId: boolean; disabled: boolean };
export type ParsedTypeScript = { tests: ParsedTest[]; pending: boolean };
export function parseTypeScript(raw: string, file: string, standard: boolean): ParsedTypeScript {
  const source = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const options: ts.CompilerOptions = { noEmit: true, noResolve: true, target: ts.ScriptTarget.Latest };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = name => name === file ? source : undefined;
  host.fileExists = name => name === file;
  host.readFile = name => name === file ? raw : undefined;
  host.writeFile = () => { throw Error('Parser must never emit input'); };
  const program = ts.createProgram([file], options, host);
  const errors = program.getSyntacticDiagnostics(source).map(diagnostic => {
    const position = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    return { line: position.line + 1, column: position.character + 1, reason: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n') };
  });
  if (errors.length) invalid(file, 'SYNTAX_INVALID', errors);
  const tests: ParsedTest[] = [], diagnostics: Omit<Diagnostic, 'code'>[] = [];
  let pending = false;
  const position = (node: ts.Node) => { const p = source.getLineAndCharacterOfPosition(node.getStart(source)); return { line: p.line + 1, column: p.character + 1 }; };
  const literal = (node?: ts.Node): string | undefined => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
  const property = (node: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined => {
    const prop = node.properties.find(p => ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === name);
    return prop && ts.isPropertyAssignment(prop) ? prop.initializer : undefined;
  };
  const testKey = (options?: ts.Expression): string | undefined => {
    if (!options || !ts.isObjectLiteralExpression(options)) return;
    const annotation = property(options, 'annotation');
    const entries: readonly ts.Expression[] = annotation && ts.isArrayLiteralExpression(annotation) ? annotation.elements : annotation ? [annotation] : [];
    const matches = entries.filter((entry): entry is ts.ObjectLiteralExpression => ts.isObjectLiteralExpression(entry)).filter(item => literal(property(item, 'type')) === 'workbenchTestId');
    if (matches.length !== 1) return;
    return literal(property(matches[0], 'description'));
  };
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) && /UnimplementedStepError|PENDING_COMPLETION/.test(node.text)) pending = true;
    if (ts.isIdentifier(node) && node.text === 'UnimplementedStepError') pending = true;
    if (ts.isCallExpression(node)) {
      if (standard) {
        const members: string[] = [];
        let root: ts.Expression = node.expression;
        while (ts.isPropertyAccessExpression(root)) { members.unshift(root.name.text); root = root.expression; }
        if (ts.isIdentifier(root) && root.text === 'test' && members.some(member => ['skip', 'fixme', 'only'].includes(member)))
          diagnostics.push({ ...position(node), reason: 'Standard test snapshots cannot contain skipped/focused tests or suites' });
      }
      const bareTest = ts.isIdentifier(node.expression) && node.expression.text === 'test';
      const modifiedTest = ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === 'test' && ['skip', 'fixme', 'only', 'fail'].includes(node.expression.name.text);
      if (bareTest || modifiedTest) {
        const title = literal(node.arguments[0]), key = testKey(node.arguments[1]);
        let dynamic = false;
        for (let ancestor: ts.Node | undefined = node.parent; ancestor; ancestor = ancestor.parent)
          if (ts.isIterationStatement(ancestor, false) || ts.isIfStatement(ancestor) || ts.isConditionalExpression(ancestor)) dynamic = true;
        if (standard && (!title || !key || dynamic || modifiedTest))
          diagnostics.push({ ...position(node), testKey: key, reason: 'Standard tests require a static test(title, {annotation:{type:"workbenchTestId",description:testKey}}, callback) declaration without dynamic/disabled modifiers' });
        if (title) tests.push({ ...position(node), title, testKey: key ?? title, hasExplicitId: !!key, disabled: modifiedTest });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const seen = new Set<string>();
  for (const test of tests) {
    if (!test.testKey || seen.has(test.testKey)) diagnostics.push({ ...test, reason: `Duplicate or empty test ID ${test.testKey}` });
    seen.add(test.testKey);
  }
  if (standard && !tests.length) diagnostics.push({ line: 1, column: 1, reason: 'Standard spec must contain explicit test declarations' });
  if (diagnostics.length) invalid(file, 'MAPPING_INVALID', diagnostics);
  return { tests, pending };
}
