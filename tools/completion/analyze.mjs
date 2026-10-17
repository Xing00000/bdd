import fs from 'node:fs';
import ts from 'typescript';
import {hash,sourceCases} from '../generate.mjs';
export const stepsPath='tests/completion/steps/workbench.steps.ts';
const helperPath='tests/completion/support/workbench.ts';
const walk=(node,fn)=>{fn(node);ts.forEachChild(node,c=>walk(c,fn));};
function assertions(node,file,ast){const found=[];walk(node,n=>{if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&/^to[A-Z]/.test(n.expression.name.text)&&/\b(?:expect|this\.check)\b/.test(n.expression.expression.getText(ast))){found.push({file,line:ast.getLineAndCharacterOfPosition(n.getStart(ast)).line+1,expression:n.getText(ast)});}});return found;}
export function analyze(source=fs.readFileSync(stepsPath,'utf8')){
 const ast=ts.createSourceFile(stepsPath,source,99,true),helperText=fs.readFileSync(helperPath,'utf8'),helperAst=ts.createSourceFile(helperPath,helperText,99,true),cls=helperAst.statements.find(ts.isClassDeclaration);
 const methods=new Map(cls.members.filter(ts.isMethodDeclaration).map(m=>[m.name.getText(helperAst),m]));
 const helperAssertions=(name,seen=new Set())=>{if(seen.has(name)||!methods.has(name))return [];seen.add(name);const m=methods.get(name),result=assertions(m,helperPath,helperAst);walk(m,n=>{if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.expression.kind===ts.SyntaxKind.ThisKeyword)result.push(...helperAssertions(n.expression.name.text,seen));});return result;};
 const entries=[],problems=[];
 if(ast.parseDiagnostics.length)problems.push('TS syntax diagnostics');
 for(const statement of ast.statements){if(!ts.isExpressionStatement(statement)||!ts.isCallExpression(statement.expression))continue;const call=statement.expression;if(!ts.isIdentifier(call.expression)||!['Given','When','Then'].includes(call.expression.text))continue;
  const [pattern,callback]=call.arguments;if(!pattern||!ts.isRegularExpressionLiteral(pattern)||!callback||!ts.isArrowFunction(callback)){problems.push('Nonstatic or nonstandard step declaration');continue;}
  const last=pattern.text.lastIndexOf('/'),regex=pattern.text.slice(1,last),flags=pattern.text.slice(last+1);let step;
  walk(callback,n=>{if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.expression.getText(ast)==='sut'&&n.expression.name.text==='step')step=n;});
  if(!step||!ts.isNumericLiteral(step.arguments[0])||!ts.isArrowFunction(step.arguments[2])){problems.push('Missing source-bound implementation');continue;}
  const body=step.arguments[2].body,helperCalls=[];walk(body,n=>{if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.expression.getText(ast)==='sut'&&n.expression.name.text!=='step')helperCalls.push(n.expression.name.text);});
  const sites=[...assertions(body,stepsPath,ast),...helperCalls.flatMap(name=>helperAssertions(name))];
  walk(body,n=>{if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&/^to[A-Z]/.test(n.expression.name.text)&&ts.isCallExpression(n.expression.expression)&&n.expression.expression.expression.getText(ast)==='expect'&&n.expression.expression.arguments.length&&[ts.SyntaxKind.TrueKeyword,ts.SyntaxKind.FalseKeyword,ts.SyntaxKind.NumericLiteral,ts.SyntaxKind.StringLiteral].includes(n.expression.expression.arguments[0].kind))problems.push('Literal actual value assertion L'+Number(step.arguments[0].text));});
  const pending=/\b(?:TODO|FIXME|PENDING_IMPLEMENTATION|pendingStep|test\.skip|test\.fixme|test\.only)\b/.test(body.getText(ast));
  const opaque=/\b(?:perform|execute)\s*\(|definitions\.json/.test(body.getText(ast));
  const entry={keyword:call.expression.text,pattern:regex,flags,sourceLine:Number(step.arguments[0].text),implementationFile:stepsPath,implementationLine:ast.getLineAndCharacterOfPosition(call.getStart(ast)).line+1,bodyStart:body.getStart(ast),bodyEnd:body.end,bodySha256:hash(body.getText(ast)),assertions:sites,helperCalls:[...new Set(helperCalls)],pending};entries.push(entry);
  if(!body.statements?.length||pending||opaque)problems.push('Unimplemented or opaque step L'+entry.sourceLine);
  if(entry.keyword==='Then'&&!sites.length)problems.push('Outcome has no traced assertion L'+entry.sourceLine);
 }
 const registry=JSON.parse(fs.readFileSync('tests/skeleton/registry.json'));if(entries.length!==registry.length)problems.push('Step count differs from approved source');
 for(const r of registry){const matches=entries.filter(e=>e.sourceLine===r.line);if(matches.length!==1||matches[0].keyword!==r.keyword||matches[0].pattern!==r.pattern.replaceAll('/','\\/'))problems.push('Source registration differs L'+r.line);}
 for(const c of sourceCases())for(const text of c.expandedSteps)if(entries.filter(e=>new RegExp(e.pattern,e.flags).test(text)).length!==1)problems.push('Missing/ambiguous expanded source '+c.testKey+': '+text);
 if(ast.statements.some(s=>ts.isImportDeclaration(s)&&s.moduleSpecifier.text?.endsWith('.json'))||/switch\s*\(|\b(?:perform|execute)\s*\(/.test(source))problems.push('Step runtime contains JSON import or opcode interpreter');
 return {entries,problems,pendingSlots:entries.filter(e=>e.pending).length,sourceSha256:hash(source),helperSha256:hash(helperText)};
}
