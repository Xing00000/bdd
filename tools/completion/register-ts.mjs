import { registerHooks } from 'node:module';
import fs from 'node:fs';
import ts from 'typescript';
// Tool-unit loader only; test callbacks still execute in Playwright's own transform.
registerHooks({load(url,context,nextLoad){
 if(url.startsWith(new URL('../../tests/completion/',import.meta.url).href)&&url.endsWith('.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(fs.readFileSync(new URL(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext}}).outputText};
 return nextLoad(url,context);
}});
