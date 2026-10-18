import ts from 'typescript';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import {ExpressionFactory,ParameterTypeRegistry,type Expression} from '@cucumber/cucumber-expressions';
import {staticStepPattern,stepDefinitionKeywords} from './definitions.js';

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
export function inspectAcceptance(program: ts.Program, spec: ts.SourceFile, requiredTestKeys: string[], directory: string, configPath?: unknown) {
  const checker = program.getTypeChecker(), diagnostics: Diagnostic[] = [];
  const reports: { testKey: string; operation: boolean; assertion: boolean; outcomeAssertion: boolean }[] = [];
  const active = new Set<ts.Node>(); let visits = 0, unresolvedFlow = false;
  const flowScopes:{mixedReturn:boolean}[]=[];
  const joinBranches=(items:Summary[])=>{
    const successful=items.filter(item=>item.canSucceed);
    // A merged continuation must never lend later assertions to an already returned path.
    if(successful.some(item=>item.returned)&&successful.some(item=>!item.returned)&&flowScopes.length)flowScopes[flowScopes.length-1].mixedReturn=true;
    return branch(items);
  };
  const mergeEnvironments=(environment:Environment,locals:Environment[])=>{
    for(const symbol of new Set(locals.flatMap(local=>[...local.keys()]))){
      const values=locals.map(local=>local.get(symbol)),first=values[0];
      environment.set(symbol,first&&values.every(value=>value===first||value?.kind==='constant'&&first.kind==='constant'&&value.value===first.value)?first:unknown());
    }
  };
  const paths=(environment:Environment,callbacks:((local:Environment)=>Summary)[])=>{
    const locals=callbacks.map(()=>new Map(environment)),results=callbacks.map((callback,index)=>callback(locals[index]));
    mergeEnvironments(environment,locals.filter((_,index)=>results[index].canSucceed&&!results[index].returned));
    return joinBranches(results);
  };
  const symbolAt = (node: ts.Node) => {
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    return symbol;
  };
  const exceptionWrites:Set<ts.Symbol>[]=[];
  const recordMutation=(node:ts.Node)=>{
    const symbol=symbolAt(node);if(symbol)for(const writes of exceptionWrites)writes.add(symbol);
    ts.forEachChild(node,recordMutation);
  };
  const recordPossibleWrites=(node:ts.Node)=>{
    if(!exceptionWrites.length)return;
    if(ts.isBinaryExpression(node)&&node.operatorToken.kind>=ts.SyntaxKind.FirstAssignment&&node.operatorToken.kind<=ts.SyntaxKind.LastAssignment)recordMutation(node.left);
    if((ts.isPrefixUnaryExpression(node)||ts.isPostfixUnaryExpression(node))&&[ts.SyntaxKind.PlusPlusToken,ts.SyntaxKind.MinusMinusToken].includes(node.operator))recordMutation(node.operand);
    if(ts.isDeleteExpression(node))recordMutation(node.expression);
    ts.forEachChild(node,recordPossibleWrites);
  };
  const location = (node: ts.Node) => `${node.getSourceFile().fileName}:${node.pos}`;
  const bddFile=(node?:ts.Node)=>!!node&&/[/\\]node_modules[/\\]playwright-bdd[/\\].*\.d\.ts$/.test(node.getSourceFile().fileName);
  const invokerNames=new Set(['Given','When','Then','And','But']);
  const registrations:{expression:Expression;callback:ts.ArrowFunction|ts.FunctionExpression;test?:ts.Symbol}[]=[];
  const expressionFactory=new ExpressionFactory(new ParameterTypeRegistry());
  const protectedFixtures=new Set<string>();
  const staticStepOptions=(raw:ts.Expression|undefined):boolean=>{
    if(!raw)return false;
    const options=unwrap(raw);
    if(!ts.isObjectLiteralExpression(options))return false;
    const seen=new Set<string>();
    for(const property of options.properties){
      if(!ts.isPropertyAssignment(property)||!(ts.isIdentifier(property.name)||ts.isStringLiteral(property.name)))return false;
      const name=property.name.text;
      if(seen.has(name))return false;
      seen.add(name);
      const value=unwrap(property.initializer);
      if(name==='arityCheck'){
        if(value.kind!==ts.SyntaxKind.TrueKeyword&&value.kind!==ts.SyntaxKind.FalseKeyword)return false;
      }else if(name==='tags'){
        // inspectAcceptance has no scenario-tag input. Playwright-BDD filters
        // tagged registrations against the active pickle tags, so even a
        // literal expression cannot prove that this callback will run.
        return false;
      }else return false;
    }
    return true;
  };
  for(const source of program.getSourceFiles())if(bddFile(source))for(const statement of source.statements)
    if(ts.isTypeAliasDeclaration(statement)&&statement.name.text==='BddTestFixtures')for(const property of checker.getTypeFromTypeNode(statement.type).getProperties())protectedFixtures.add(property.name);
  const trustedTest=(symbol:ts.Symbol|undefined,seen=new Set<ts.Symbol>()):boolean=>{
    if(!symbol||seen.has(symbol))return false;seen.add(symbol);
    if(symbol.name==='test'&&symbol.declarations?.some(bddFile))return true;
    const declaration=symbol.valueDeclaration;
    if(!declaration||!ts.isVariableDeclaration(declaration)||!(declaration.parent.flags&ts.NodeFlags.Const)||!declaration.initializer)return false;
    const init=unwrap(declaration.initializer);
    if(ts.isIdentifier(init))return trustedTest(symbolAt(init),seen);
    if(!ts.isCallExpression(init)||!ts.isPropertyAccessExpression(init.expression)||init.expression.name.text!=='extend'
      ||!pwFile(checker.getResolvedSignature(init)?.getDeclaration())||init.arguments.length!==1||!ts.isObjectLiteralExpression(init.arguments[0]))return false;
    if(init.arguments[0].properties.some(property=>!property.name||!(ts.isIdentifier(property.name)||ts.isStringLiteral(property.name))||protectedFixtures.has(property.name.text)))return false;
    return trustedTest(symbolAt(init.expression.expression),seen);
  };
  const dataLiteral=(raw:ts.Expression):boolean=>{
    const node=unwrap(raw);
    if(ts.isStringLiteral(node)||ts.isNumericLiteral(node)||[ts.SyntaxKind.TrueKeyword,ts.SyntaxKind.FalseKeyword,ts.SyntaxKind.NullKeyword].includes(node.kind))return true;
    if(ts.isArrayLiteralExpression(node))return node.elements.every(dataLiteral);
    if(ts.isObjectLiteralExpression(node))return node.properties.every(property=>ts.isPropertyAssignment(property)&&!ts.isComputedPropertyName(property.name)&&dataLiteral(property.initializer));
    return false;
  };
  const nativeMetadata=(property:ts.PropertyAssignment,test:ts.Symbol|undefined):boolean=>{
    const name=property.name.getText().replace(/^['"]|['"]$/g,''),tuple=unwrap(property.initializer);
    if(!ts.isArrayLiteralExpression(tuple)||tuple.elements.length!==2||!dataLiteral(tuple.elements[1]))return false;
    const callback=tuple.elements[0];
    if(!(ts.isArrowFunction(callback)||ts.isFunctionExpression(callback))||callback.parameters.length!==2)return false;
    const [fixtures,use]=callback.parameters;
    if(fixtures.initializer||use.initializer||!ts.isObjectBindingPattern(fixtures.name)||fixtures.name.elements.length||!ts.isIdentifier(use.name))return false;
    let body:ts.Expression;
    if(ts.isBlock(callback.body)){
      if(callback.body.statements.length!==1)return false;
      const only=callback.body.statements[0];
      if(ts.isReturnStatement(only)&&only.expression)body=only.expression;
      else if(ts.isExpressionStatement(only)&&ts.isAwaitExpression(only.expression))body=only.expression;
      else return false;
    }else body=callback.body;
    body=unwrap(body);if(ts.isAwaitExpression(body))body=unwrap(body.expression);
    if(!ts.isCallExpression(body)||symbolAt(body.expression)!==symbolAt(use.name)||body.arguments.length!==1)return false;
    const value=unwrap(body.arguments[0]);
    if(name==='$test')return ts.isIdentifier(value)&&symbolAt(value)===test&&trustedTest(test);
    if(name==='$uri')return ts.isStringLiteral(value);
    if(name==='$bddFileData'&&ts.isIdentifier(value)){
      const declaration=symbolAt(value)?.valueDeclaration;
      return !!declaration&&ts.isVariableDeclaration(declaration)&&!!(declaration.parent.flags&ts.NodeFlags.Const)&&!!declaration.initializer&&dataLiteral(declaration.initializer);
    }
    return false;
  };
  const reachable=new Set<ts.SourceFile>();let registryUnresolved=false;
  const collect=(source:ts.SourceFile)=>{
    if(reachable.has(source)||source.isDeclarationFile)return;reachable.add(source);
    // Use TypeScript's own erasure of type-only imports/exports as the runtime
    // graph; a type reference never loads a step registration module.
    const emitted=ts.transpileModule(source.text,{fileName:source.fileName,compilerOptions:{...program.getCompilerOptions(),module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,noEmit:false,declaration:false}}).outputText;
    const runtime=ts.createSourceFile(source.fileName+'.js',emitted,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
    const runtimeModules=new Set(runtime.statements.flatMap(statement=>(ts.isImportDeclaration(statement)||ts.isExportDeclaration(statement))&&statement.moduleSpecifier&&ts.isStringLiteral(statement.moduleSpecifier)?[statement.moduleSpecifier.text]:[]));
    const checkUse=(node:ts.Node)=>{
      if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='use'&&pwFile(checker.getResolvedSignature(node)?.getDeclaration())){
        const options=node.arguments[0];
        const test=symbolAt(node.expression.expression);
        if(!options||!ts.isObjectLiteralExpression(options)||options.properties.some(property=>!property.name||!(ts.isIdentifier(property.name)||ts.isStringLiteral(property.name))
          ||protectedFixtures.has(property.name.text)&&(!ts.isPropertyAssignment(property)||!nativeMetadata(property,test))))registryUnresolved=true;
      }
      ts.forEachChild(node,checkUse);
    };
    checkUse(source);
    for(const statement of source.statements){
      if((ts.isImportDeclaration(statement)||ts.isExportDeclaration(statement))&&statement.moduleSpecifier&&ts.isStringLiteral(statement.moduleSpecifier)&&runtimeModules.has(statement.moduleSpecifier.text)){
        for(const declaration of symbolAt(statement.moduleSpecifier)?.declarations??[])if(ts.isSourceFile(declaration))collect(declaration);
      }
      if(!ts.isExpressionStatement(statement)||!ts.isCallExpression(statement.expression))continue;
      const call=statement.expression,binding=symbolAt(call.expression)?.valueDeclaration;
      if(!binding||!ts.isBindingElement(binding))continue;
      const keyword=(binding.propertyName??binding.name).getText();if(!stepDefinitionKeywords.has(keyword))continue;
      const variable=binding.parent.parent;
      if(!ts.isVariableDeclaration(variable)||!variable.initializer||!ts.isCallExpression(variable.initializer))continue;
      const factory=variable.initializer,declaration=checker.getResolvedSignature(factory)?.getDeclaration();
      if(!bddFile(declaration)||!declaration?.name||declaration.name.getText()!=='createBdd')continue;
      const callback=call.arguments.at(-1),hasStaticOptions=call.arguments.length===3&&staticStepOptions(call.arguments[1]);
      // The official API accepts a static ProvidedStepOptions argument. Dynamic
      // values and unsupported option keys cannot establish which step runs.
      if(!(variable.parent.flags&ts.NodeFlags.Const)||factory.arguments.length!==1||![2,3].includes(call.arguments.length)
        ||call.arguments.length===3&&!hasStaticOptions||!callback||!(ts.isArrowFunction(callback)||ts.isFunctionExpression(callback))){registryUnresolved=true;continue;}
      try{const pattern=staticStepPattern(call.arguments[0]);if(!pattern){registryUnresolved=true;continue;}
        registrations.push({expression:expressionFactory.createExpression(pattern.value),callback,test:symbolAt(factory.arguments[0])});
      }catch{registryUnresolved=true;}
    }
  };
  const configuredStepSources=(rawPath:unknown):ts.SourceFile[]=>{
    if(rawPath===undefined)return [];
    if(typeof rawPath!=='string'||isAbsolute(rawPath)||rawPath.includes('\\')||rawPath.split('/').some(part=>!part||part==='.'||part==='..'||part==='node_modules'||part==='.git')){
      registryUnresolved=true;return [];
    }
    const root=resolve(directory),configFilePath=resolve(root,rawPath),configRelative=relative(root,configFilePath);
    if(!configRelative||isAbsolute(configRelative)||configRelative==='..'||configRelative.startsWith(`..${sep}`)){
      registryUnresolved=true;return [];
    }
    const config=program.getSourceFile(configFilePath);
    if(!config||config.isDeclarationFile){registryUnresolved=true;return [];}
    const calls:ts.CallExpression[]=[];
    const findConfig=(node:ts.Node)=>{
      if(ts.isCallExpression(node)){
        const declaration=checker.getResolvedSignature(node)?.getDeclaration();
        if(bddFile(declaration)&&declaration?.name?.getText()==='defineBddConfig')calls.push(node);
      }
      ts.forEachChild(node,findConfig);
    };
    findConfig(config);
    const defaultExports=config.statements.filter((statement):statement is ts.ExportAssignment=>ts.isExportAssignment(statement)&&!statement.isExportEquals);
    if(defaultExports.length!==1){registryUnresolved=true;return [];}
    const exported=unwrap(defaultExports[0].expression);
    if(!ts.isCallExpression(exported)||!ts.isObjectLiteralExpression(exported.arguments[0])){registryUnresolved=true;return [];}
    const playwrightConfig=checker.getResolvedSignature(exported)?.getDeclaration();
    if(!playwrightConfig||!pwFile(playwrightConfig)||playwrightConfig.name?.getText()!=='defineConfig'){
      registryUnresolved=true;return [];
    }
    const configObject=unwrap(exported.arguments[0]);
    if(!ts.isObjectLiteralExpression(configObject)){registryUnresolved=true;return [];}
    if(configObject.properties.some(property=>!ts.isPropertyAssignment(property)
      ||!(ts.isIdentifier(property.name)||ts.isStringLiteral(property.name)))){
      // Spreads, computed names, accessors, and shorthand can hide an override
      // of testDir, so only inspect ordinary statically named assignments.
      registryUnresolved=true;return [];
    }
    const testDirProperties=configObject.properties.filter((property):property is ts.PropertyAssignment=>ts.isPropertyAssignment(property)
      &&(ts.isIdentifier(property.name)||ts.isStringLiteral(property.name))&&property.name.text==='testDir');
    if(testDirProperties.length!==1||calls.length!==1){registryUnresolved=true;return [];}
    const testDir=unwrap(testDirProperties[0].initializer);
    let selectedCall:ts.CallExpression|undefined;
    if(ts.isCallExpression(testDir))selectedCall=testDir;
    else if(ts.isIdentifier(testDir)){
      const declaration=symbolAt(testDir)?.valueDeclaration;
      if(declaration&&ts.isVariableDeclaration(declaration)&&ts.isVariableDeclarationList(declaration.parent)
        &&!!(declaration.parent.flags&ts.NodeFlags.Const)&&ts.isVariableStatement(declaration.parent.parent)
        &&declaration.parent.parent.parent===config&&declaration.initializer){
        const initializer=unwrap(declaration.initializer);
        if(ts.isCallExpression(initializer))selectedCall=initializer;
      }
    }
    if(!selectedCall||selectedCall!==calls[0]||selectedCall.arguments.length!==1||!selectedCall.arguments[0]){
      registryUnresolved=true;return [];
    }
    const options=unwrap(selectedCall.arguments[0]);
    if(!ts.isObjectLiteralExpression(options)){registryUnresolved=true;return [];}
    if(options.properties.some(property=>!ts.isPropertyAssignment(property)
      ||!(ts.isIdentifier(property.name)||ts.isStringLiteral(property.name)))){
      // A spread or computed option can replace the explicit steps list.
      registryUnresolved=true;return [];
    }
    const stepProperties=options.properties.filter((property):property is ts.PropertyAssignment=>ts.isPropertyAssignment(property)
      &&(ts.isIdentifier(property.name)||ts.isStringLiteral(property.name))&&property.name.text==='steps');
    if(stepProperties.length!==1){registryUnresolved=true;return [];}
    const patterns=(raw:ts.Expression):string[]|undefined=>{
      const value=unwrap(raw);
      if(ts.isStringLiteral(value)||ts.isNoSubstitutionTemplateLiteral(value))return [value.text];
      if(ts.isArrayLiteralExpression(value)){
        const result:string[]=[];
        for(const element of value.elements){
          if(!ts.isStringLiteral(element)&&!ts.isNoSubstitutionTemplateLiteral(element))return;
          result.push(element.text);
        }
        return result;
      }
      return;
    };
    const values=patterns(stepProperties[0].initializer);
    if(!values){registryUnresolved=true;return [];}
    const sources:ts.SourceFile[]=[];
    for(const pattern of values){
      // This verifier resolves the exact static files emitted by the canonical
      // generator. Dynamic and glob patterns cannot prove which steps run.
      if(!pattern||/[*?{}\[\]]/.test(pattern)){registryUnresolved=true;continue;}
      const filePath=resolve(dirname(configFilePath),pattern),fileRelative=relative(root,filePath);
      if(!fileRelative||isAbsolute(fileRelative)||fileRelative==='..'||fileRelative.startsWith(`..${sep}`)){
        registryUnresolved=true;continue;
      }
      const source=program.getSourceFile(filePath);
      if(!source||source.isDeclarationFile){registryUnresolved=true;continue;}
      sources.push(source);
    }
    return sources;
  };
  collect(spec);
  for(const source of configuredStepSources(configPath))collect(source);
  let currentCallback:ts.ArrowFunction|ts.FunctionExpression|undefined,currentTest:ts.Symbol|undefined;
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
    recordPossibleWrites(declaration.body);
    active.add(declaration);
    const scope={mixedReturn:false};flowScopes.push(scope);
    const environment = new Map(caller);
    declaration.parameters.forEach((parameter, index) => assign(parameter.name, args[index] ?? unknown(), environment));
    const result = ts.isBlock(declaration.body) ? statements(declaration.body.statements, environment, acceptanceBoundary) : expression(declaration.body, environment);
    for (const [symbol, value] of environment) if (symbol.declarations?.some(ts.isPropertyDeclaration)) caller.set(symbol, value);
    flowScopes.pop();active.delete(declaration);
    return scope.mixedReturn?{...result,action:false,assertion:false,last:'unproven',value:unknown()}:result;
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
        : paths(environment,[local=>expression(node.whenTrue,local),local=>expression(node.whenFalse,local)]));
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
      const binding=symbolAt(node.expression)?.valueDeclaration;
      if(binding&&ts.isBindingElement(binding)&&ts.isParameter(binding.parent.parent)&&binding.parent.parent.parent===currentCallback
        &&invokerNames.has((binding.propertyName??binding.name).getText())&&bddFile(checker.getResolvedSignature(node)?.getDeclaration())){
        if(registryUnresolved||!trustedTest(currentTest)||!consumed(node)||args.length!==1||args[0].kind!=='constant'||typeof args[0].value!=='string')return {...evaluated,last:'unproven'};
        const text=args[0].value;
        const matches=registrations.map(registration=>({registration,arguments:registration.expression.match(text)})).filter(match=>match.arguments!==null);
        if(matches.length!==1||matches[0].registration.test!==currentTest)return {...evaluated,last:'unproven'};
        const matched=matches[0],values:Value[]=matched.arguments!.map(argument=>({kind:'constant',value:argument.getValue(undefined)}));
        const called=invoke(matched.registration.callback,[unknown(),...values],environment);
        if(!called.action&&!called.assertion&&!called.last)called.last='unproven';
        return {...sequence(evaluated,called),returned:false};
      }
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
        : paths(environment,[local=>statement(node.thenStatement,local),local=>node.elseStatement?statement(node.elseStatement,local):empty()]);
      return sequence(condition, outcome);
    }
    if (ts.isTryStatement(node)) {
      const writes=new Set<ts.Symbol>();
      const result = paths(environment,[local=>{
        exceptionWrites.push(writes);
        try{recordPossibleWrites(node.tryBlock);return statement(node.tryBlock,local);}
        finally{exceptionWrites.pop();}
      },local=>{
        if(!node.catchClause)return {...empty(),canSucceed:false};
        // Catch may observe any prefix of the try's writes, including invoked
        // helpers/closures. Bind even previously unread symbols to unknown so
        // knownConstant cannot revive an old initializer. Unwritten facts stay
        // valid across unrelated screenshot/reporting failures.
        for(const symbol of writes)local.set(symbol,unknown());
        return statement(node.catchClause.block,local);
      }]);
      if (!node.finallyBlock) return result;
      const final = statement(node.finallyBlock, environment);
      return { ...sequence(result, final), last: final.action || final.assertion ? final.last : result.last,
        returned: result.returned || final.returned, value: final.returned ? final.value : result.value };
    }
    if (ts.isSwitchStatement(node)) {
      const selector=expression(node.expression,environment),clauses=node.caseBlock.clauses;
      const values=clauses.map(clause=>ts.isCaseClause(clause)?knownConstant(clause.expression,environment):undefined);
      // Case expressions with effects or unknown values cannot establish static dispatch.
      if(clauses.some((clause,index)=>ts.isCaseClause(clause)&&(!ts.isStringLiteral(clause.expression)&&!ts.isNumericLiteral(clause.expression)
        &&![ts.SyntaxKind.TrueKeyword,ts.SyntaxKind.FalseKeyword,ts.SyntaxKind.NullKeyword].includes(clause.expression.kind)||values[index]?.kind!=='constant'))){unresolvedFlow=true;return selector;}
      const defaultIndex=clauses.findIndex(ts.isDefaultClause);
      const matching=selector.value.kind==='constant'?values.findIndex(value=>value?.kind==='constant'&&value.value===(selector.value as {kind:'constant';value:unknown}).value):-1;
      const starts=selector.value.kind==='constant'?[matching<0?defaultIndex:matching]:clauses.map((_,index)=>index).concat(defaultIndex<0?[-1]:[]);
      const pathEnvironments:Environment[]=[];
      const paths=starts.map(start=>{
        const local=new Map(environment);pathEnvironments.push(local);let result=empty();
        for(let index=start;index>=0&&index<clauses.length;index++)for(const child of clauses[index].statements){
          if(ts.isBreakStatement(child)&&!child.label)return result;
          // Nested or labelled transfers need a separate control-flow model; never guess their target.
          const transfers=(item:ts.Node):boolean=>!ts.isFunctionLike(item)&&(ts.isBreakStatement(item)||ts.isContinueStatement(item)||ts.forEachChild(item,transfers)===true);
          if(transfers(child)){unresolvedFlow=true;return {...result,last:'unproven' as const};}
          result=sequence(result,statement(child,local));
          if(result.returned||!result.canSucceed)return result;
        }
        return result;
      });
      const continuing=pathEnvironments.filter((_,index)=>paths[index].canSucceed&&!paths[index].returned);
      mergeEnvironments(environment,continuing);
      return sequence(selector,joinBranches(paths));
    }
    // Loops and unsupported control flow never establish guaranteed acceptance coverage.
    if (ts.isIterationStatement(node, false)) unresolvedFlow = true;
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
        currentCallback=callback;currentTest=symbolAt(node.expression);
        const result = invoke(callback, [], new Map(), true);
        currentCallback=undefined;currentTest=undefined;
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
