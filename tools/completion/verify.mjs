import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { sourceCases,hash,convert } from '../generate.mjs';
import { frozen,manifestPath } from './generate.mjs';
export function verify(){
 const frozenFiles=frozen();const cases=sourceCases(),m=JSON.parse(fs.readFileSync(manifestPath));assert.equal(m.artifactStage,'COMPLETED');assert.equal(m.pendingSlots,0);assert.deepEqual(m.questions,[]);
 const {completionBundleSha256,...payload}=m;assert.equal(hash(JSON.stringify(payload)),completionBundleSha256);
 for(const [file,sha] of Object.entries(m.implementationHashes))assert.equal(hash(fs.readFileSync(file)),sha,file);
 assert.equal(hash(fs.readFileSync(m.sourceSkeleton.specPath)),m.sourceSkeleton.specSha256);assert.equal(hash(fs.readFileSync(m.sourceSkeleton.manifestPath)),m.sourceSkeleton.manifestSha256);
 const raw=fs.readFileSync(m.rawPath,'utf8'),spec=fs.readFileSync(m.specPath,'utf8');assert.equal(hash(raw),m.rawSha256);assert.equal(hash(spec),m.specSha256);assert.equal(convert(raw,cases).output,spec);
 assert.deepEqual(new Set(m.cases.map(c=>c.testKey)),new Set(cases.map(c=>c.testKey)));assert.equal(m.cases.length,44);
 const defs=JSON.parse(fs.readFileSync('tests/completion/steps/definitions.json'));const registry=JSON.parse(fs.readFileSync('tests/skeleton/registry.json'));assert.equal(defs.length,174);
 for(const d of defs){assert.deepEqual(Object.fromEntries(Object.entries(d).filter(([k])=>k!=='plan')),registry.find(r=>r.line===d.line));assert(d.plan?.length>0);}
 let stepMatches=0;for(const c of cases)for(const step of c.expandedSteps){assert.equal(defs.filter(d=>new RegExp(d.pattern).test(step)).length,1,step);stepMatches++;}
 const world=fs.readFileSync('tests/completion/support/world.ts','utf8');const operations=new Set([...world.matchAll(/case '([^']+)':/g)].map(x=>x[1]));for(const d of defs)for(const p of d.plan)assert(operations.has(p.op),p.op);
 for(const file of Object.keys(m.implementationHashes).filter(f=>f.endsWith('.ts')&&!f.includes('/content.ts'))){const text=fs.readFileSync(file,'utf8');assert(!/test\.(skip|fixme|only)\s*\(|PENDING_IMPLEMENTATION|pendingStep\(/.test(text),file);}
 const ast=ts.createSourceFile(m.specPath,spec,ts.ScriptTarget.Latest,true);let count=0;const walk=n=>{if(ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&n.expression.text==='test')count++;ts.forEachChild(n,walk);};walk(ast);assert.equal(count,44);
 const result={scope:'COMPLETION_TOOLING_ONLY',frozenFiles:frozenFiles.length,scenarios:28,cases:44,stepPatterns:174,expandedStepMatches:stepMatches,missing:0,ambiguous:0,pendingSlots:0,productE2E:'NOT_RUN'};console.log(JSON.stringify(result));return result;
}
if(process.argv[1]?.endsWith('/verify.mjs'))verify();
