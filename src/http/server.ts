import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import staticFiles from '@fastify/static';
import path from 'node:path';
import { mkdir,readFile,stat,realpath } from 'node:fs/promises';
import { randomUUID,createHash } from 'node:crypto';
import { createCore } from '../application/core.js';
import { createExtensions } from '../application/extensions.js';
import { createRuns } from '../application/runs.js';
import { createWorkspaceAdapter } from '../adapters/workspace.js';
import { createRuntimeAdapters } from '../adapters/runtime/index.js';
import { createGenerationAdapters } from '../adapters/generation/index.js';
import { createGitAdapter } from '../adapters/git/index.js';
import { createPlaywrightRunner } from '../adapters/runner/playwright.js';
import { prepareCheckout } from '../adapters/runner/checkout.js';
import type { BrowserRuntimePort } from '../ports/runtime.js';
import type { RecordingSecretResolver } from '../adapters/runtime/secrets.js';
import { createFrameChannel } from './frame-channel.js';
import { reportHtml } from './report-html.js';
export interface ServerOptions {root:string;metadataFile:string;dataRoot:string;baseUrl:string;llm?:import('../adapters/generation/types.ts').LlmOptions;resolveRecordingSecret?:RecordingSecretResolver;logger?:boolean}
export async function createServer(options:ServerOptions) {
  const {root,dataRoot}=options;await mkdir(dataRoot,{recursive:true,mode:0o700});await mkdir(path.dirname(options.metadataFile),{recursive:true});
  const app=Fastify({logger:options.logger??false,bodyLimit:20*1024*1024});await app.register(websocket);
  const core=await createCore(options.metadataFile),runtime=createRuntimeAdapters({workspaceRoot:root}),workspace=createWorkspaceAdapter(root,dataRoot),git=createGitAdapter({workspaceRoot:root});
  const peers=new Set<{socket:any;projectId?:string;sessionId?:string}>();
  const channel=createFrameChannel(),send=channel.send;
  const frameDrain=setInterval(channel.flush,25);frameDrain.unref();
  const emit=(event:any)=>{const envelope={eventId:randomUUID(),...event};for(const peer of peers)if((!peer.projectId||peer.projectId===event.projectId)&&(!peer.sessionId||peer.sessionId===event.sessionId))send(peer.socket,envelope);
    if(event.type==='run.browserBound'){
      // A static page may not repaint after binding. Replay the last actual JPEG
      // with its original capture timestamp and the newly established identity.
      const unsubscribe=runtime.browser.subscribe(event.sessionId,frame=>{if(frame.image&&frame.contextRef===event.contextRef&&frame.pageId===event.pageId)emit({...frame,projectId:event.projectId,requirementId:event.requirementId,runId:event.runId,testKey:event.testKey,testDefinitionId:event.testDefinitionId,caseResultId:event.caseResultId,bindingSeq:event.bindingSeq});});unsubscribe();
    }
  };
  const wired=new Set<string>();
  function wireSession(sessionId:string,projectId:string){if(wired.has(sessionId))return;wired.add(sessionId);runtime.browser.subscribe(sessionId,event=>{
    void (async()=>{const bindings=await core.store.all('SELECT b.*,r.project_id,r.requirement_id,r.feature_id,r.definition_snapshot_json,c.test_definition_id,c.runtime_test_key FROM run_browser_bindings b JOIN runs r ON r.id=b.run_id JOIN case_results c ON c.id=b.case_result_id WHERE b.session_id=? AND b.context_ref=? AND b.page_id=?',[event.sessionId,event.contextRef,event.pageId]);
      const base={...event,projectId};emit(base);
      for(const b of bindings){const definition=JSON.parse(b.definition_snapshot_json).definitions.find((d:any)=>d.testKey===b.runtime_test_key);emit({...event,projectId:b.project_id,requirementId:b.requirement_id,featureId:b.feature_id,runId:b.run_id,testKey:b.runtime_test_key,testDefinitionId:b.test_definition_id??definition?.id,caseResultId:b.case_result_id,bindingSeq:b.binding_seq});}
    })().catch(error=>emit({type:'browser.error',projectId,sessionId,payload:{message:String(error.message)}}));
  });}
  const browser:BrowserRuntimePort=new Proxy(runtime.browser,{get(target,key){if(key==='create')return async(input:Parameters<BrowserRuntimePort['create']>[0])=>{const result=await target.create(input);wireSession(result.id,input.projectId);return result;};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  const generation=createGenerationAdapters({root,artifactRoot:path.join(dataRoot,'generation'),llm:options.llm});
  const artifactRoot=path.join(dataRoot,'artifacts');
  const runs=createRuns({store:core.store,browser,runner:createPlaywrightRunner({root,artifactRoot,baseUrl:options.baseUrl}),artifactRoot,root,baseUrl:options.baseUrl,emit,resolveRecordingSecret:options.resolveRecordingSecret,async resolveSource(projectId,sourceRef){const p=(await core.store.all('SELECT * FROM projects WHERE id=?',[projectId]))[0];if(!p)throw Object.assign(new Error('Project not found'),{statusCode:404,code:'NOT_FOUND'});return workspace.resolveSource(sourceRef,p.workspace_ref,projectId);},async executeCi({runId,prepared,env}){
    const rows=await core.store.all('SELECT p.workspace_ref,r.* FROM runs r JOIN projects p ON p.id=r.project_id WHERE r.id=?',[runId]);const run=rows[0];
    const connection=run.connection_id?(await core.store.all('SELECT * FROM target_connections WHERE id=?',[run.connection_id]))[0]:undefined;
    const environment:Record<string,string>=Object.fromEntries(Object.entries({...env,WB_WORKBENCH_ROOT:root,WB_TARGET_PASSWORD:process.env.WB_TARGET_PASSWORD,PLAYWRIGHT_BROWSERS_PATH:process.env.PLAYWRIGHT_BROWSERS_PATH,WB_TARGET_BASE_URL:connection?.app_base_url??process.env.WB_TARGET_BASE_URL}).filter((entry):entry is [string,string]=>typeof entry[1]==='string'));
    const versions=await core.store.all(`SELECT v.*,d.file_name FROM document_versions v JOIN documents d ON d.id=v.document_id WHERE d.kind='spec' AND v.id IN (${JSON.parse(run.definition_snapshot_json).versions.map(()=>'?').join(',')})`,JSON.parse(run.definition_snapshot_json).versions);
    const receipt=await git.runCi({repo:run.workspace_ref,commit:run.source_ref,env:environment,prepareCheckout:checkout=>prepareCheckout({checkout,prepared,versions:versions as any,root,baseUrl:options.baseUrl,artifactRoot,runId})});
    await core.store.run("UPDATE runs SET candidate_commit=?,tested_commit=?,environment_snapshot_json=json_set(environment_snapshot_json,'$.ci',json(?)) WHERE id=?",[receipt.candidateCommit,receipt.testedCommit,JSON.stringify(receipt),runId]);
    return {code:receipt.exitCode??2,stdout:receipt.stdout,stderr:receipt.stderr};
  }});
  const ext=createExtensions({core,generation,git,workspace,emit,async executeTargetCi(requirementId,body){const result=await runs.verify(requirementId,body);const report=await runs.wait(result.runId);return {...result,status:report.status,completed:true};}});
  const params=(request:any)=>request.params as Record<string,string>,body=(request:any)=>request.body??{};
  const query=(request:any)=>request.query as Record<string,string>;
  const notFound=()=>Object.assign(new Error('Resource not found'),{statusCode:404,code:'NOT_FOUND'});
  const one=async(sql:string,values:any[])=>{const row=(await core.store.all(sql,values))[0];if(!row)throw notFound();return row;};
  const targetConnection=async(id:string)=>{const row=await one('SELECT * FROM target_connections WHERE id=?',[id]);if(await realpath(row.sqlite_file_ref)===await realpath(options.metadataFile))throw Object.assign(new Error('Target DB must be separate from metadata'),{statusCode:400,code:'INVALID_TARGET_DB'});return row;};
  app.setErrorHandler((error:any,_request,reply)=>{const status=Number(error.statusCode)||500;reply.code(status>=400&&status<=599?status:500).send({code:error.code??'INTERNAL_ERROR',message:error.message,file:error.file,diagnostics:error.diagnostics});});
  app.get('/health',async()=>({status:'ok',node:process.version,sqlite:core.sqliteVersion,llm:options.llm?'configured':'unconfigured',browser:'NOT_PROBED',metadataFile:options.metadataFile}));
  app.get('/projects',()=>core.listProjects());
  app.post('/projects',async(request,reply)=>{const b=body(request);let ref=b.workspaceRef;if(!ref){ref=path.join(dataRoot,'projects',randomUUID());await mkdir(ref,{recursive:true});}await workspace.existing(ref);reply.code(201);return core.createProject({name:b.name,workspaceRef:ref});});
  app.get('/projects/:p/requirements',request=>core.listRequirements(params(request).p));
  app.post('/projects/:p/requirements',async(request,reply)=>{reply.code(201);return core.createRequirement(params(request).p,body(request));});
  app.post('/requirements/:r/features',async(request,reply)=>{reply.code(201);return core.createFeature(params(request).r,body(request));});
  app.get('/requirements/:r',request=>ext.current(params(request).r,query(request).featureId));
  app.post('/documents/:d/versions',async(request,reply)=>{const result=await core.saveVersion(params(request).d,body(request));const row=await one('SELECT project_id,requirement_id,feature_id FROM documents WHERE id=?',[params(request).d]);emit({type:'document.saved',projectId:row.project_id,requirementId:row.requirement_id,featureId:row.feature_id,documentVersionId:result.versionId,payload:{}});reply.code(201);return result;});
  app.get('/documents/:d/versions/:v',request=>core.getVersion(params(request).d,params(request).v));
  app.get('/documents/:d/versions/:v/structure',request=>core.structure(params(request).d,params(request).v));
  for(const kind of ['gherkin','sd'] as const)app.post(`/requirements/:r/confirm-${kind}`,async request=>{const b=body(request),result=await core.confirm(params(request).r,kind,{versionId:b.versionId,rawSha256:b.rawSha256??b.hash,featureId:b.featureId});emit({type:'workflow.stageChanged',projectId:result.projectId,requirementId:result.id,featureId:result.featureId,payload:{stage:result.stage}});return result;});
  app.post('/requirements/:r/return',request=>core.returnTo(params(request).r,body(request).artifactKind??body(request).kind,body(request).featureId));
  app.post('/requirements/:r/start-development',request=>ext.beginDevelopment(params(request).r,body(request).featureId));
  app.post('/requirements/:r/generate-sd',request=>ext.generateSd(params(request).r,body(request)));
  app.post('/requirements/:r/generate-tests',request=>ext.generated(params(request).r,body(request)));
  app.post('/requirements/:r/complete-tests',request=>ext.complete(params(request).r,body(request)));
  app.get('/requirements/:r/generated-tests/export',request=>ext.exportBundle(params(request).r,query(request).versionId,query(request).featureId));
  app.get('/requirements/:r/scenario-tests',request=>core.scenarioTests(params(request).r,query(request)));
  app.get('/requirements/:r/source',request=>ext.source(params(request).r,undefined,query(request).featureId));
  app.post('/requirements/:r/source',request=>ext.source(params(request).r,body(request)));
  app.post('/requirements/:r/pin-source',request=>ext.pinSource(params(request).r,body(request)));
  app.post('/requirements/:r/verify',async(request,reply)=>{const result=await runs.verify(params(request).r,body(request));reply.code(202);return result;});
  app.get('/runs/:run/report',request=>runs.report(params(request).run));
  app.get('/runs/:run/report.json',request=>runs.report(params(request).run));
  app.get('/runs/:run/report.html',async(request,reply)=>reply.type('text/html').send(reportHtml(await runs.report(params(request).run))));
  app.get('/runs/:run/artifacts/html/*',async(request,reply)=>{await runs.report(params(request).run);const base=path.resolve(artifactRoot,'runs',params(request).run,'html'),file=path.resolve(base,params(request)['*']);const relative=path.relative(base,file);if(relative.startsWith('..')||path.isAbsolute(relative))throw notFound();const ext=path.extname(file);reply.type(({'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpeg':'image/jpeg','.zip':'application/zip'} as Record<string,string>)[ext]??'application/octet-stream');return readFile(file);});
  app.get('/runs/:run/viewer-binding',request=>runs.binding(params(request).run));
  app.get('/internal/runs/:run/tests/:key/execution-context',request=>runs.executionContext(params(request).run,params(request).key));
  app.post('/internal/runs/:run/events',request=>runs.ingest(params(request).run,body(request)));
  app.get('/screenshots/:id',async(request,reply)=>{const row=await one('SELECT artifact_ref,sha256 FROM screenshots WHERE id=?',[params(request).id]);const file=await realpath(path.resolve(artifactRoot,row.artifact_ref)),relative=path.relative(await realpath(artifactRoot),file);if(relative.startsWith('..')||path.isAbsolute(relative))throw notFound();const bytes=await readFile(file);if(createHash('sha256').update(bytes).digest('hex')!==row.sha256)throw Object.assign(new Error('Screenshot artifact hash mismatch'),{statusCode:409,code:'ARTIFACT_HASH_MISMATCH'});reply.type('image/png');return bytes;});
  app.get('/projects/:p/db-connections',request=>core.store.all('SELECT id,project_id projectId,sqlite_file_ref sqliteFileRef,environment_label environmentLabel,app_base_url appBaseUrl FROM target_connections WHERE project_id=?',[params(request).p]));
  app.post('/projects/:p/db-connections',async(request,reply)=>{await ext.project(params(request).p);const b=body(request),file=await realpath(path.resolve(b.sqliteFileRef??b.file??''));if(file===await realpath(options.metadataFile))throw Object.assign(new Error('Target DB must be separate from metadata'),{statusCode:400,code:'INVALID_TARGET_DB'});await runtime.targetDb.schema(file);const id=randomUUID();await core.store.run('INSERT INTO target_connections(id,project_id,sqlite_file_ref,environment_label,app_base_url) VALUES (?,?,?,?,?)',[id,params(request).p,file,b.environmentLabel??'development',b.appBaseUrl??null]);reply.code(201);return {id,projectId:params(request).p,sqliteFileRef:file};});
  app.get('/db-connections/:id/schema',async request=>{const row=await targetConnection(params(request).id);return runtime.targetDb.schema(row.sqlite_file_ref);});
  app.post('/db-connections/:id/query',async request=>{const row=await targetConnection(params(request).id);const result=await runtime.targetDb.query(row.sqlite_file_ref,body(request).sql,body(request).params??[]);emit({type:'db.executed',projectId:row.project_id,payload:{connectionId:row.id}});return result;});
  app.post('/browser-sessions',async(request,reply)=>{const b=body(request),p=await ext.project(b.projectId);const result=await browser.create({projectId:p.id,workspaceRef:p.workspace_ref,targetUrl:b.targetUrl});reply.code(201);return result;});
  app.get('/internal/browser-sessions/:id/attachment',request=>browser.attachment(params(request).id));
  app.delete('/browser-sessions/:id',request=>browser.closeSession(params(request).id));
  app.post('/browser-sessions/:id/input',async request=>{await browser.input(params(request).id,body(request));return {accepted:true};});
  app.post('/browser-sessions/:id/assertions',request=>browser.addAssertion(params(request).id,body(request)));
  app.post('/browser-sessions/:id/recordings/start',request=>browser.startRecording(params(request).id));
  app.post('/browser-sessions/:id/recordings/stop',request=>browser.stopRecording(params(request).id));
  for(const purpose of ['recording','integration'] as const)app.post(purpose==='recording'?'/recordings':'/integration-tests',async(request,reply)=>{reply.code(201);return ext.script(body(request),purpose);});
  app.get('/projects/:p/recordings',request=>core.store.all("SELECT d.id,d.purpose,d.file_name fileName,h.version_id versionId FROM documents d JOIN document_heads h ON h.document_id=d.id WHERE d.project_id=? AND d.purpose IN ('recording','integration')",[params(request).p]));
  app.get('/recordings/:id',request=>ext.scriptHead(params(request).id));
  app.get('/recordings/:id/versions/:v',request=>core.getVersion(params(request).id,params(request).v));
  app.post('/scripts/:id/versions/:v/replay',async(request,reply)=>{reply.code(202);return runs.replay(params(request).id,params(request).v,body(request));});
  app.post('/repository-snapshots',request=>ext.snapshot(body(request)));
  app.post('/requirements/:r/save-to-target-git',request=>ext.saveGit(params(request).r,body(request).featureId));
  app.post('/requirements/:r/run-target-ci',request=>ext.runCi(params(request).r,body(request).featureId));
  app.post('/terminals',async(request,reply)=>{const b=body(request),p=await ext.project(b.projectId);const r=b.requirementId?await ext.current(b.requirementId,b.featureId):null;if(r&&r.projectId!==p.id)throw notFound();const dir=await workspace.stageDirectory(p.id,r?.stage??'IMPLEMENTATION');const result=await runtime.terminal.create({workspaceRef:dir,cols:b.cols,rows:b.rows});reply.code(201);return {...result,workspaceRef:dir};});
  app.delete('/terminals/:id',async request=>{runtime.terminal.closeTerminal(params(request).id);return {closed:true};});
  function checkOrigin(request:any){const origin=request.headers.origin;if(origin&&new URL(origin).host!==request.headers.host)throw Object.assign(new Error('WebSocket origin mismatch'),{statusCode:403,code:'INVALID_ORIGIN'});}
  app.get('/events',{websocket:true},(socket,request)=>{try{checkOrigin(request);const peer={socket,projectId:query(request).projectId};peers.add(peer);socket.on('close',()=>{peers.delete(peer);channel.forget(socket);});
    void (async()=>{const bindings=await core.store.all("SELECT b.*,r.project_id,r.requirement_id,r.feature_id,r.definition_snapshot_json,c.test_definition_id,c.runtime_test_key FROM run_browser_bindings b JOIN runs r ON r.id=b.run_id JOIN case_results c ON c.id=b.case_result_id WHERE r.status='RUNNING'"+(peer.projectId?' AND r.project_id=?':''),peer.projectId?[peer.projectId]:[]);
      for(const b of bindings){if(socket.readyState!==1)return;const definition=JSON.parse(b.definition_snapshot_json).definitions.find((d:any)=>d.testKey===b.runtime_test_key),identity={projectId:b.project_id,requirementId:b.requirement_id,featureId:b.feature_id,runId:b.run_id,testKey:b.runtime_test_key,testDefinitionId:b.test_definition_id??definition?.id,caseResultId:b.case_result_id,sessionId:b.session_id,contextRef:b.context_ref,pageId:b.page_id,bindingSeq:b.binding_seq};send(socket,{type:'run.browserBound',...identity});const unsubscribe=browser.subscribe(b.session_id,event=>{if(event.image&&event.contextRef===b.context_ref&&event.pageId===b.page_id)send(socket,{...event,...identity});});unsubscribe();}
    })().catch(error=>send(socket,{type:'browser.error',message:String(error.message)}));
  }catch(error){socket.close(1008,String((error as Error).message));}});
  app.get('/browser-sessions/:id',{websocket:true},(socket,request)=>{try{checkOrigin(request);const id=params(request).id;browser.attachment(id);const unsubscribe=browser.subscribe(id,event=>send(socket,event));socket.on('message',(data:Buffer)=>{try{void browser.input(id,JSON.parse(String(data))).catch(error=>send(socket,{type:'browser.error',message:error.message,code:error.code}));}catch(error){send(socket,{type:'browser.error',message:String((error as Error).message),code:'INVALID_INPUT'});}});socket.on('close',()=>{unsubscribe();channel.forget(socket);});}catch(error){socket.close(1008,String((error as Error).message));}});
  app.get('/terminals/:id',{websocket:true},(socket,request)=>{try{checkOrigin(request);const id=params(request).id,unsubscribe=runtime.terminal.subscribe(id,event=>send(socket,event));socket.on('message',(data:Buffer)=>{try{const value=JSON.parse(String(data));if(value.type==='input')runtime.terminal.input(id,value.data);else if(value.type==='resize')runtime.terminal.resize(id,value.cols,value.rows);else if(value.type==='close')runtime.terminal.closeTerminal(id);}catch(error){send(socket,{type:'error',message:String((error as Error).message)});}});socket.on('close',unsubscribe);}catch(error){socket.close(1008,String((error as Error).message));}});
  const publicRoot=path.join(root,'dist/public');let hasUi=false;try{hasUi=(await stat(path.join(publicRoot,'index.html'))).isFile();}catch{}
  if(hasUi){await app.register(staticFiles,{root:publicRoot,prefix:'/',wildcard:false});
    app.addHook('onRequest',async(request,reply)=>{const pathname=request.url.split('?')[0];if(request.method==='GET'&&request.headers.accept?.includes('text/html')&&(/^\/projects(?:\/[^/]+(?:\/(?:requirements|db|browser|recordings|integrations|runs)(?:\/[^/]+)?)?)?\/?$/.test(pathname)||/^\/projects\/[^/]+\/requirements\/[^/]+\/tests\/?$/.test(pathname)))return reply.sendFile('index.html');});
    app.setNotFoundHandler((request,reply)=>request.method==='GET'&&request.headers.accept?.includes('text/html')?reply.sendFile('index.html'):reply.code(404).send({code:'NOT_FOUND',message:'Resource not found'}));}
  app.addHook('onClose',async()=>{clearInterval(frameDrain);channel.clear();for(const peer of peers)peer.socket.close();await runs.close();await browser.close();runtime.terminal.close();await runtime.targetDb.close();await core.close();});
  return {app,core,runtime,browser,extensions:ext,runs};
}
