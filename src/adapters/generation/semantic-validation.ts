import ts from 'typescript';
import { relative } from 'node:path';

type Diagnostic = { file: string; line: number; column: number; reason: string };
type Value = { kind: 'constant'; value: unknown } | { kind: 'observed' | 'playwright'; identity: string }
  | { kind: 'function'; declaration: ts.FunctionLikeDeclaration; environment: Environment }
  | { kind: 'response' } | { kind: 'pending'; value: Value } | { kind: 'unknown' };
type Environment = Map<ts.Symbol, Value>;
type Summary = { action: boolean; assertion: boolean; last: 'action' | 'assertion' | 'unproven' | null; canSucceed: boolean; returned: boolean; value: Value };
const unknown = (): Value => ({ kind: 'unknown' });
const empty = (): Summary => ({ action: false, assertion: false, last: null, canSucceed: true, returned: false, value: unknown() });
const unwrap = (node: ts.Expression): ts.Expression => ts.isParenthesizedExpression(node) || ts.isAsExpression(node)
  || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node) ? unwrap(node.expression) : node;
const pwFile = (node?: ts.Node): boolean => !!node && /[/\\]node_modules[/\\](?:@playwright[/\\]test|playwright|playwright-core)[/\\].*\.d\.ts$/.test(node.getSourceFile().fileName);
const browserTypes = new Set(['Page', 'Locator', 'Frame', 'FrameLocator', 'Keyboard', 'Mouse', 'Touchscreen']);
const actions = new Set(['goto', 'reload', 'goBack', 'goForward', 'setContent', 'click', 'dblclick', 'fill', 'type', 'press', 'pressSequentially',
  'check', 'uncheck', 'setChecked', 'selectOption', 'setInputFiles', 'tap', 'dragTo', 'hover', 'dispatchEvent', 'insertText', 'down', 'up', 'move', 'wheel']);
const observations = new Set(['innerText', 'innerHTML', 'textContent', 'allInnerTexts', 'allTextContents', 'inputValue', 'getAttribute',
  'isVisible', 'isHidden', 'isEnabled', 'isDisabled', 'isChecked', 'isEditable', 'count', 'title', 'url', 'content', 'boundingBox']);

function sequence(left: Summary, right: Summary): Summary {
  return { ...right, action: left.action || right.action, assertion: left.assertion || right.assertion,
    last: right.last ?? left.last, canSucceed: left.canSucceed && right.canSucceed };
}
function branch(items: Summary[]): Summary {
  const successful = items.filter(item => item.canSucceed);
  if (!successful.length) return { ...empty(), canSucceed: false, returned: true };
  const values = successful.map(item => item.value);
  const sameValue = values.every(value => value.kind === 'constant' && values[0].kind === 'constant' && value.value === values[0].value);
  return { action: successful.every(item => item.action), assertion: successful.every(item => item.assertion),
    last: successful.every(item => item.last === successful[0].last) ? successful[0].last : null,
    canSucceed: true, returned: successful.every(item => item.returned), value: sameValue ? values[0]
      : values.every(value => value.kind === 'observed') ? { kind: 'observed', identity: values.map(value => (value as any).identity).join('|') } : unknown() };
}

/** Conservative source proof, never execution evidence or a general proof of business correctness. */
export function inspectAcceptance(program: ts.Program, spec: ts.SourceFile, requiredTestKeys: string[], directory: string) {
  const checker = program.getTypeChecker(), diagnostics: Diagnostic[] = [];
  const reports: { testKey: string; operation: boolean; assertion: boolean; outcomeAssertion: boolean }[] = [];
  const active = new Set<ts.Node>(); let visits = 0, unresolvedFlow = false;
  const symbolAt = (node: ts.Node) => {
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    return symbol;
  };
  const location = (node: ts.Node) => `${node.getSourceFile().fileName}:${node.pos}`;
  const consumed = (call: ts.CallExpression): boolean => {
    const signature = checker.getResolvedSignature(call);
    const type = signature && checker.getReturnTypeOfSignature(signature);
    const promises = (value: ts.Type): boolean => value.isUnionOrIntersection() ? value.types.some(promises)
      : value.getSymbol()?.name === 'Promise' || value.aliasSymbol?.name === 'Promise';
    if (!type || !promises(type)) return true;
    let parent: ts.Node = call.parent;
    while (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isNonNullExpression(parent)) parent = parent.parent;
    return ts.isAwaitExpression(parent) || ts.isReturnStatement(parent) || ts.isArrowFunction(parent) && parent.body === call;
  };
  const browserType = (type: ts.Type): boolean => {
    if (type.isUnionOrIntersection()) return type.types.some(browserType);
    const symbol = type.aliasSymbol ?? type.getSymbol();
    return !!symbol && browserTypes.has(symbol.name) && !!symbol.declarations?.some(pwFile);
  };
  const browserMethod = (call: ts.CallExpression): string | undefined => {
    const signature = checker.getResolvedSignature(call), declaration = signature?.getDeclaration();
    if (!pwFile(declaration) || !ts.isPropertyAccessExpression(call.expression)) return;
    let owner: ts.Node | undefined = declaration?.parent;
    while (owner && !ts.isInterfaceDeclaration(owner)) owner = owner.parent;
    if (!owner || !browserTypes.has(owner.name.text) && owner.name.text !== 'Response') return;
    return call.expression.name.text;
  };
  const literalProperty = (node: ts.ObjectLiteralExpression, key: string): ts.Expression | undefined => {
    const property = node.properties.find(item => ts.isPropertyAssignment(item) && (ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)) && item.name.text === key);
    return property && ts.isPropertyAssignment(property) ? property.initializer : undefined;
  };
  const idOf = (call: ts.CallExpression): string | undefined => {
    const details = call.arguments[1]; if (!details || !ts.isObjectLiteralExpression(details)) return;
    const annotations = literalProperty(details, 'annotation');
    for (const entry of annotations && ts.isArrayLiteralExpression(annotations) ? annotations.elements : annotations ? [annotations] : []) {
      if (!ts.isObjectLiteralExpression(entry)) continue;
      const type = literalProperty(entry, 'type'), description = literalProperty(entry, 'description');
      if (type && ts.isStringLiteral(type) && type.text === 'workbenchTestId' && description && ts.isStringLiteral(description)) return description.text;
    }
  };
  const assign = (name: ts.BindingName, value: Value, environment: Environment) => {
    if (ts.isIdentifier(name)) { const symbol = symbolAt(name); if (symbol) environment.set(symbol, value); }
    else for (const element of name.elements) {
      if (ts.isOmittedExpression(element)) continue;
      const type = checker.getTypeAtLocation(element.name);
      assign(element.name, browserType(type) ? { kind: 'playwright', identity: location(element) } : unknown(), environment);
    }
  };
  const knownConstant = (node: ts.Expression, environment: Environment): Value => {
    node = unwrap(node);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { kind: 'constant', value: node.text };
    if (ts.isNumericLiteral(node)) return { kind: 'constant', value: Number(node.text) };
    if (ts.isRegularExpressionLiteral(node)) return { kind: 'constant', value: node.text };
    if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return { kind: 'constant', value: node.kind === ts.SyntaxKind.TrueKeyword };
    if (node.kind === ts.SyntaxKind.NullKeyword) return { kind: 'constant', value: null };
    if (ts.isIdentifier(node)) {
      const symbol = symbolAt(node), bound = symbol && environment.get(symbol);
      if (bound) return bound;
      if (node.text === 'undefined') return { kind: 'constant', value: undefined };
      const declaration = symbol?.valueDeclaration;
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) {
        if (active.has(declaration)) return unknown();
        active.add(declaration); const result = knownConstant(declaration.initializer, environment); active.delete(declaration); return result;
      }
    }
    if (ts.isPropertyAccessExpression(node)) {
      const symbol = symbolAt(node.name), value = symbol && environment.get(symbol);
      if (value) return value;
    }
    if (ts.isPrefixUnaryExpression(node)) {
      const operand = knownConstant(node.operand, environment);
      if (operand.kind === 'constant') {
        if (node.operator === ts.SyntaxKind.ExclamationToken) return { kind: 'constant', value: !operand.value };
        if (node.operator === ts.SyntaxKind.MinusToken && typeof operand.value === 'number') return { kind: 'constant', value: -operand.value };
      }
    }
    if (ts.isBinaryExpression(node)) {
      const left = knownConstant(node.left, environment), right = knownConstant(node.right, environment);
      if (left.kind === 'observed' && right.kind === 'observed' && left.identity === right.identity) {
        if ([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken].includes(node.operatorToken.kind)) return { kind: 'constant', value: true };
        if ([ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(node.operatorToken.kind)) return { kind: 'constant', value: false };
      }
      if (left.kind === 'constant' && right.kind === 'constant') {
        switch (node.operatorToken.kind) {
          case ts.SyntaxKind.EqualsEqualsEqualsToken: return { kind: 'constant', value: left.value === right.value };
          case ts.SyntaxKind.ExclamationEqualsEqualsToken: return { kind: 'constant', value: left.value !== right.value };
          case ts.SyntaxKind.AmpersandAmpersandToken: return { kind: 'constant', value: left.value && right.value };
          case ts.SyntaxKind.BarBarToken: return { kind: 'constant', value: left.value || right.value };
          case ts.SyntaxKind.PlusToken:
            if (typeof left.value === 'number' && typeof right.value === 'number') return { kind: 'constant', value: left.value + right.value };
        }
      }
    }
    return unknown();
  };
  const functionOf = (call: ts.CallExpression, environment: Environment): Value => {
    const expression = unwrap(call.expression);
    if (ts.isIdentifier(expression)) {
      const symbol = symbolAt(expression), binding = symbol && environment.get(symbol);
      if (binding?.kind === 'function') return binding;
      const declaration = symbol?.valueDeclaration;
      if (declaration && (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration)) && declaration.body)
        return { kind: 'function', declaration, environment };
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) {
        const value = unwrap(declaration.initializer);
        if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) return { kind: 'function', declaration: value, environment };
      }
    }
    const declaration = checker.getResolvedSignature(call)?.getDeclaration();
    if (declaration && !declaration.getSourceFile().isDeclarationFile
      && (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration) || ts.isFunctionExpression(declaration) || ts.isArrowFunction(declaration)) && declaration.body)
      return { kind: 'function', declaration, environment };
    return unknown();
  };
  const invoke = (declaration: ts.FunctionLikeDeclaration, args: Value[], caller: Environment, acceptanceBoundary = false): Summary => {
    if (!declaration.body || active.has(declaration) || ++visits > 12_000) { unresolvedFlow = true; return { ...empty(), last: 'unproven' }; }
    active.add(declaration);
    const environment = new Map(caller);
    declaration.parameters.forEach((parameter, index) => assign(parameter.name, args[index] ?? unknown(), environment));
    const result = ts.isBlock(declaration.body) ? statements(declaration.body.statements, environment, acceptanceBoundary) : expression(declaration.body, environment);
    for (const [symbol, value] of environment) if (symbol.declarations?.some(ts.isPropertyDeclaration)) caller.set(symbol, value);
    active.delete(declaration); return result;
  };
  const expectation = (call: ts.CallExpression, environment: Environment): Summary | undefined => {
    const declaration = checker.getResolvedSignature(call)?.getDeclaration();
    if (!pwFile(declaration) || !ts.isPropertyAccessExpression(call.expression)) return;
    if (!consumed(call)) return { ...empty(), last: 'unproven' };
    let base: ts.Expression = call.expression.expression;
    while (ts.isPropertyAccessExpression(base) && ['not', 'resolves', 'rejects'].includes(base.name.text)) base = base.expression;
    if (!ts.isCallExpression(base) || !base.arguments.length || !pwFile(checker.getResolvedSignature(base)?.getDeclaration())) return;
    const expectSymbol = symbolAt(base.expression);
    if (expectSymbol?.name !== 'expect' || !expectSymbol.declarations?.some(pwFile)) return;
    const actual = expression(base.arguments[0], environment);
    let result = actual;
    const expected = call.arguments.map(argument => expression(argument, environment));
    for (const argument of expected) result = sequence(result, argument);
    const observable = actual.value.kind === 'observed' || actual.value.kind === 'playwright';
    const tautology = (actual.value.kind === 'observed' || actual.value.kind === 'playwright') && expected.some(argument => (argument.value.kind === 'observed' || argument.value.kind === 'playwright')
      && argument.value.identity === (actual.value as { identity: string }).identity);
    let owner: ts.Node | undefined = declaration?.parent;
    while (owner && !ts.isInterfaceDeclaration(owner)) owner = owner.parent;
    const locatorAssertion = !!owner && ['LocatorAssertions', 'PageAssertions'].includes(owner.name.text);
    const meaningful = actual.value.kind === 'playwright' ? locatorAssertion
      : expected.every(argument => argument.value.kind === 'constant');
    // Unknown/constant actuals are setup checks, never proof of an acceptance outcome.
    if (observable && meaningful && !tautology) return { ...result, assertion: true, last: 'assertion', value: unknown() };
    return { ...result, last: 'unproven', value: unknown() };
  };
  const expression = (raw: ts.Expression, environment: Environment): Summary => {
    const node = unwrap(raw), result = empty();
    const constant = knownConstant(node, environment);
    if (constant.kind !== 'unknown') return { ...result, value: constant };
    if (ts.isAwaitExpression(node)) {
      const result = expression(node.expression, environment);
      return result.value.kind === 'pending' ? { ...result, value: result.value.value } : result;
    }
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return { ...result, value: { kind: 'function', declaration: node, environment: new Map(environment) } };
    if (ts.isConditionalExpression(node)) {
      const condition = expression(node.condition, environment);
      return sequence(condition, condition.value.kind === 'constant'
        ? expression(condition.value.value ? node.whenTrue : node.whenFalse, environment)
        : branch([expression(node.whenTrue, new Map(environment)), expression(node.whenFalse, new Map(environment))]));
    }
    if (ts.isBinaryExpression(node)) {
      const right = expression(node.right, environment);
      if (node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const symbol = symbolAt(ts.isPropertyAccessExpression(node.left) ? node.left.name : node.left); if (symbol) environment.set(symbol, right.value);
        return right;
      }
      const left = expression(node.left, environment);
      if (left.value.kind === 'observed' || right.value.kind === 'observed') return { ...sequence(left, right), value: { kind: 'observed', identity: location(node) } };
      return { ...sequence(left, right), value: unknown() };
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const owner = expression(node.expression, environment);
      if (owner.value.kind === 'observed') return { ...owner, value: { kind: 'observed', identity: `${owner.value.identity}/${node.getText()}` } };
      if (browserType(checker.getTypeAtLocation(node))) return { ...owner, value: { kind: 'playwright', identity: location(node) } };
      return owner;
    }
    if (ts.isCallExpression(node)) {
      const asserted = expectation(node, environment); if (asserted) return asserted;
      let evaluated = empty();
      const args = node.arguments.map(argument => { const value = expression(argument, environment); evaluated = sequence(evaluated, value); return value.value; });
      const method = browserMethod(node);
      if (method) {
        if (method === 'waitForResponse') return { ...evaluated, value: consumed(node) ? { kind: 'response' } : { kind: 'pending', value: { kind: 'response' } } };
        if (!consumed(node)) return { ...evaluated, last: 'unproven', value: unknown() };
        const declaration = checker.getResolvedSignature(node)?.getDeclaration();
        if (declaration?.parent && ts.isInterfaceDeclaration(declaration.parent) && declaration.parent.name.text === 'Response'
          && ['json', 'text', 'body', 'status', 'ok', 'headers', 'allHeaders', 'headerValue'].includes(method))
          return { ...evaluated, value: { kind: 'observed', identity: location(node) } };
        if (actions.has(method)) return { ...evaluated, action: true, last: 'action', value: unknown() };
        if (observations.has(method)) return { ...evaluated, value: { kind: 'observed', identity: location(node) } };
        if (browserType(checker.getTypeAtLocation(node))) return { ...evaluated, value: { kind: 'playwright', identity: location(node) } };
        return evaluated;
      }
      const callable = functionOf(node, environment);
      if (callable.kind === 'function') {
        if (!consumed(node)) return { ...evaluated, last: 'unproven' };
        const called = invoke(callable.declaration, args, callable.environment);
        if (!called.action && !called.assertion && !called.last) called.last = 'unproven';
        return { ...sequence(evaluated, called), returned: false };
      }
      const declaration = checker.getResolvedSignature(node)?.getDeclaration();
      if (pwFile(declaration) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'step') {
        for (const arg of args) if (arg.kind === 'function') evaluated = sequence(evaluated, invoke(arg.declaration, [], arg.environment));
      }
      return { ...evaluated, last: evaluated.last ?? 'unproven', value: unknown() };
    }
    if (ts.isIdentifier(node) && browserType(checker.getTypeAtLocation(node))) return { ...result, value: { kind: 'playwright', identity: location(node) } };
    return result;
  };
  const statement = (node: ts.Statement, environment: Environment): Summary => {
    if (ts.isBlock(node)) return statements(node.statements, environment);
    if (ts.isVariableStatement(node)) {
      let result = empty();
      for (const declaration of node.declarationList.declarations) {
        const value = declaration.initializer ? expression(declaration.initializer, environment) : empty();
        assign(declaration.name, value.value, environment); result = sequence(result, value);
      }
      return result;
    }
    if (ts.isExpressionStatement(node)) return expression(node.expression, environment);
    if (ts.isReturnStatement(node)) return { ...(node.expression ? expression(node.expression, environment) : empty()), returned: true };
    if (ts.isThrowStatement(node)) return { ...expression(node.expression, environment), canSucceed: false, returned: true };
    if (ts.isIfStatement(node)) {
      const condition = expression(node.expression, environment);
      const outcome = condition.value.kind === 'constant'
        ? condition.value.value ? statement(node.thenStatement, environment) : node.elseStatement ? statement(node.elseStatement, environment) : empty()
        : branch([statement(node.thenStatement, new Map(environment)), node.elseStatement ? statement(node.elseStatement, new Map(environment)) : empty()]);
      return sequence(condition, outcome);
    }
    if (ts.isTryStatement(node)) {
      const attempt = statement(node.tryBlock, new Map(environment));
      const caught = node.catchClause ? statement(node.catchClause.block, new Map(environment)) : { ...empty(), canSucceed: false };
      const result = branch([attempt, caught]);
      if (!node.finallyBlock) return result;
      const final = statement(node.finallyBlock, environment);
      return { ...sequence(result, final), last: final.action || final.assertion ? final.last : result.last,
        returned: result.returned || final.returned, value: final.returned ? final.value : result.value };
    }
    // Loops and unsupported control flow never establish guaranteed acceptance coverage.
    if (ts.isIterationStatement(node, false) || ts.isSwitchStatement(node)) unresolvedFlow = true;
    return empty();
  };
  const statements = (nodes: readonly ts.Statement[], environment: Environment, acceptanceBoundary = false): Summary => {
    let result = empty();
    for (const node of nodes) {
      if (result.returned || !result.canSucceed) break;
      const next = statement(node, environment);
      if (acceptanceBoundary && !next.action && !next.assertion && !next.last && !ts.isFunctionDeclaration(node)) next.last = 'unproven';
      result = sequence(result, next);
    }
    return result;
  };
  const find = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const key = idOf(node), callback = node.arguments[node.arguments.length - 1];
      if (key && requiredTestKeys.includes(key) && callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
        visits = 0; unresolvedFlow = false;
        const result = invoke(callback, [], new Map(), true);
        const report = { testKey: key, operation: result.action, assertion: result.assertion,
          outcomeAssertion: result.canSucceed && !unresolvedFlow && result.last === 'assertion' };
        reports.push(report);
        if (!result.canSucceed || !report.operation || !report.assertion || !report.outcomeAssertion) {
          const position = spec.getLineAndCharacterOfPosition(node.getStart(spec));
          diagnostics.push({ file: relative(directory, spec.fileName), line: position.line + 1, column: position.character + 1,
            reason: `${key}: 無法證明每條成功路徑保有真實 Playwright 操作與最後的非恆真結果斷言；請補齊或提供可解析的 helper。` });
        }
      }
    }
    ts.forEachChild(node, find);
  };
  find(spec);
  for (const key of requiredTestKeys) if (!reports.some(report => report.testKey === key)) diagnostics.push({ file: relative(directory, spec.fileName), line: 1, column: 1,
    reason: `${key}: 找不到可解析的靜態 test callback；保留待補。` });
  return { passed: !diagnostics.length, diagnostics, tests: reports,
    scope: 'CONSERVATIVE_SOURCE_CHECK' as const, productE2E: 'NOT_RUN' as const };
}
