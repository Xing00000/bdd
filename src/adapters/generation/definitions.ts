import ts from 'typescript';
import { createHash } from 'node:crypto';
import { GenerationError } from './errors.js';
import type { GenerationInput } from './types.js';

export type Definition = { keyword: string; pattern: string; slotId: string; file: string; line: number; column: number };
export const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const stepDefinitionKeywords=new Set(['Given','When','Then','Step']);
/** Static patterns shared by generation and source proof; never evaluates uploaded code. */
export function staticStepPattern(node?:ts.Expression):{text:string;value:string|RegExp}|undefined{
  if(!node)return;
  if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))return {text:JSON.stringify(node.text),value:node.text};
  if(ts.isRegularExpressionLiteral(node)){const end=node.text.lastIndexOf('/');return {text:node.text,value:new RegExp(node.text.slice(1,end),node.text.slice(end+1))};}
  if(ts.isNewExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='RegExp'&&node.arguments?.length&&node.arguments.length<=2
    &&node.arguments.every(arg=>ts.isStringLiteral(arg)||ts.isNoSubstitutionTemplateLiteral(arg))){
    const values=node.arguments.map(arg=>(arg as ts.StringLiteral).text);
    return {text:`new RegExp(${values.map(value=>JSON.stringify(value)).join(',')})`,value:new RegExp(values[0],values[1])};
  }
}
export function syntax(raw: string, file: string): ts.SourceFile {
  const source = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const options: ts.CompilerOptions = { noEmit: true, noResolve: true, target: ts.ScriptTarget.Latest };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = name => name === file ? source : undefined;
  host.fileExists = name => name === file; host.readFile = name => name === file ? raw : undefined;
  const diagnostics = ts.createProgram([file], options, host).getSyntacticDiagnostics(source);
  if (diagnostics.length) throw new GenerationError(422, 'SYNTAX_INVALID', 'TypeScript 語法錯誤', diagnostics.map(d => {
    const point = source.getLineAndCharacterOfPosition(d.start ?? 0);
    return { file, line: point.line + 1, column: point.character + 1, reason: ts.flattenDiagnosticMessageText(d.messageText, '\n') };
  }));
  return source;
}
export function definitions(input: GenerationInput['stepDefinitions']) {
  const files = typeof input === 'string' ? [{ path: 'uploaded.steps.ts', rawText: input }]
    : Array.isArray(input) ? input : input && typeof input === 'object' ? [input] : [];
  const entries: Definition[] = [], parameters: string[] = [];
  for (const [index, file] of files.entries()) {
    if (!file || typeof file.rawText !== 'string') throw new GenerationError(422, 'STEP_DEFINITIONS_INVALID', 'stepDefinitions 必須包含 rawText');
    const path = file.path ?? `uploaded-${index + 1}.steps.ts`, source = syntax(file.rawText, path);
    const fail = (node: ts.Node, reason: string): never => {
      const point = source.getLineAndCharacterOfPosition(node.getStart(source));
      throw new GenerationError(422, 'STEP_DEFINITIONS_INVALID', reason, [{ file: path, line: point.line + 1, column: point.character + 1, reason }]);
    };
    const literal = (node?: ts.Expression): string | undefined => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
    const patternText = (node?: ts.Expression): string | undefined => {
      return staticStepPattern(node)?.text;
    };
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const keyword = node.expression.text;
        if (stepDefinitionKeywords.has(keyword)) {
          const pattern = patternText(node.arguments[0]);
          if (!pattern) fail(node, '步驟 pattern 必須是靜態字串、RegExp literal 或靜態 new RegExp；不執行上傳程式推算 pattern');
          const point = source.getLineAndCharacterOfPosition(node.getStart(source));
          entries.push({ keyword, pattern: pattern!, file: path, line: point.line + 1, column: point.character + 1,
            slotId: `slot-${sha(`${path}:${point.line + 1}:${keyword}:${pattern}`).slice(0, 24)}` });
        }
        if (keyword === 'defineParameterType') {
          const object = node.arguments[0];
          if (!object || !ts.isObjectLiteralExpression(object)) fail(node, '自訂參數宣告必須是靜態 object literal');
          const property = (name: string): ts.Expression | undefined => {
            const prop = (object as ts.ObjectLiteralExpression).properties.find(p => ts.isPropertyAssignment(p)
              && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === name);
            return prop && ts.isPropertyAssignment(prop) ? prop.initializer : undefined;
          };
          const name = literal(property('name')), regexp = patternText(property('regexp'));
          if (!name || !regexp) fail(node, '自訂參數需要靜態 name 與 regexp；上傳 transformer 不會執行');
          parameters.push(`defineParameterType({name:${JSON.stringify(name)},regexp:${regexp},transformer:(...values:string[])=>values[0]});`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  const pending = `import {test as base,createBdd,defineParameterType} from 'playwright-bdd';\nexport const test=base;\nconst {Given,When,Then,Step}=createBdd(test);\nclass UnimplementedStepError extends Error { constructor(slot:string){super('PENDING_COMPLETION: '+slot);this.name='UnimplementedStepError';} }\n${parameters.join('\n')}\n` + entries.map(entry =>
    `${entry.keyword}(${entry.pattern},{arityCheck:false},async ({},..._args:unknown[])=>{throw new UnimplementedStepError(${JSON.stringify(entry.slotId)});});`).join('\n') + '\n';
  return { entries, rawText: pending, uploadedHashes: files.map((file, index) => ({ path: file.path ?? `uploaded-${index + 1}.steps.ts`, sha256: sha(file.rawText) })) };
}
