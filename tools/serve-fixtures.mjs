import {createServer} from '../dist/src/http/server.js';
import {createTargetApp,initializeTargetDatabase} from '../dist/src/fixtures/target-app.js';
import {allowlistedRecordingSecretResolver} from '../dist/src/adapters/runtime/secrets.js';
import {llmFromEnvironment} from '../dist/src/adapters/generation/config.js';
import {fixtureEnvironment,root} from './environment.mjs';
import path from 'node:path';
import {startDbGate} from './dbgate.mjs';
const env=await fixtureEnvironment();Object.assign(process.env,env);
const closers=[];let stopping=false;
async function close(){
 const results=await Promise.allSettled(closers.splice(0).reverse().map(close=>close()));
 const errors=results.filter(result=>result.status==='rejected').map(result=>result.reason);
 if(errors.length)throw new AggregateError(errors,'Fixture cleanup failed');
}
function checkCancellation(){if(stopping)throw Error('Fixture startup cancelled');}
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{
 stopping=true;void close().catch(error=>{console.error(error);process.exitCode=1;});
});
try{
initializeTargetDatabase(env.WB_TARGET_DB);
const dbgate=await startDbGate(env.WB_TARGET_DB);
closers.push(()=>dbgate.close());checkCancellation();
const server=await createServer({root,metadataFile:env.WB_METADATA_DB,dataRoot:path.join(root,'.workbench/e2e'),baseUrl:env.WB_BASE_URL,resolveRecordingSecret:allowlistedRecordingSecretResolver({'target-fixture-password':()=>env.WB_TARGET_PASSWORD}),llm:llmFromEnvironment(process.env),dbgate});
closers.push(()=>server.app.close());checkCancellation();
const target=await createTargetApp({file:env.WB_TARGET_DB,password:env.WB_TARGET_PASSWORD});
closers.push(()=>target.close());checkCancellation();
await target.listen({host:'127.0.0.1',port:Number(new URL(env.WB_TARGET_BASE_URL).port)});
checkCancellation();
await server.app.listen({host:'127.0.0.1',port:Number(new URL(env.WB_BASE_URL).port)});
checkCancellation();
console.log(JSON.stringify({workbench:env.WB_BASE_URL,target:env.WB_TARGET_BASE_URL,metadataFile:env.WB_METADATA_DB,dbgateUrl:dbgate.url}));
}catch(error){try{await close();}catch(cleanupError){throw new AggregateError([error,cleanupError],'Fixture startup and cleanup failed');}throw error;}
