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
import {dbgateUrl} from '../adapters/runtime/dbgate.js';
import { createRuntimeAdapters } from '../adapters/runtime/index.js';
import { createGenerationAdapters } from '../adapters/generation/index.js';
import { createGitAdapter } from '../adapters/git/index.js';
import { createPlaywrightRunner } from '../adapters/runner/playwright.js';
import { prepareCheckout } from '../adapters/runner/checkout.js';
import type { BrowserRuntimePort } from '../ports/runtime.js';
import type { RecordingSecretResolver } from '../adapters/runtime/secrets.js';
import { createFrameChannel } from './frame-channel.js';
import { reportHtml } from './report-html.js';
import {createLlmSettingsService} from '../application/llm-settings.ts';
import {createWorkflowSettingsService} from '../application/workflow-settings.ts';
import {interactiveWorkflowStages,isWorkflowAgentStage} from '../domain/workflow-agent-stages.ts';
import {createMcpServer,type McpServer} from '../adapters/mcp/index.js';
export interface ServerOptions {root:string;metadataFile:string;dataRoot:string;baseUrl:string;llm?:import('../adapters/generation/types.ts').LlmOptions;resolveRecordingSecret?:RecordingSecretResolver;logger?:boolean;dbgate?:import('../adapters/runtime/dbgate.ts').DbGateOptions;initializeDefaultExample?:boolean}
export async function createServer(options:ServerOptions) {
  const dbgateFile=options.dbgate?await realpath(options.dbgate.databaseFile):undefined;
  const {root,dataRoot}=options;await mkdir(dataRoot,{recursive:true,mode:0o700});await mkdir(path.dirname(options.metadataFile),{recursive:true});
  const app=Fastify({logger:options.logger??false,bodyLimit:20*1024*1024});await app.register(websocket);
  const core=await createCore(options.metadataFile,root);if(options.initializeDefaultExample)await core.ensureDefaultExample();const registeredRoots=async()=>(await core.listProjects()).map(p=>String(p.workspaceRef)),runtime=createRuntimeAdapters({workspaceRoot:root,registeredRoots}),workspace=createWorkspaceAdapter(root,dataRoot),git=createGitAdapter({workspaceRoot:root,registeredRoots});
  const peers=new Set<{socket:any;projectId?:string;requirementId?:string;sessionId?:string}>();
  const channel=createFrameChannel(),send=channel.send;
  const frameDrain=setInterval(channel.flush,25);frameDrain.unref();
  const emit=(event:any)=>{const envelope={eventId:randomUUID(),...event};for(const peer of peers)if((!peer.projectId||peer.projectId===event.projectId)&&(!peer.requirementId||peer.requirementId===event.requirementId)&&(!peer.sessionId||peer.sessionId===event.sessionId))send(peer.socket,envelope);
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
  const browser:BrowserRuntimePort=new Proxy(runtime.browser,{get(target,key){if(key==='create')return async(input:Parameters<BrowserRuntimePort['create']>[0])=>{const configured=options.dbgate;const credentials=configured&&input.targetUrl&&new URL(input.targetUrl).origin===new URL(configured.url).origin?{username:configured.username,password:configured.password,origin:new URL(configured.url).origin}:undefined;const result=await target.create({...input,...(credentials?{httpCredentials:credentials}:{})});if(input.projectId)wireSession(result.id,input.projectId);return result;};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  let mcp:McpServer|undefined;
  const mcpUrl=`${options.baseUrl.replace(/\/+$/,'')}/mcp`;
  const generation=createGenerationAdapters({root,artifactRoot:path.join(dataRoot,'generation'),llm:options.llm,terminal:runtime.terminal,mcpUrl,onMcpSession:({directory,terminalContext,stage,agent})=>mcp&&terminalContext?.requirementId&&terminalContext?.featureId?mcp.createSession({requirementId:terminalContext.requirementId,featureId:terminalContext.featureId,projectId:terminalContext.projectId,stage,agentId:agent?.id,agent,proposalDir:directory}):undefined,onTerminal:event=>emit({type:'llm.terminalOpened',...event})});
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
  const ext=createExtensions({core,generation,git,workspace,emit,getQuestions:(requirementId,featureId)=>mcp?.getQuestions(requirementId,featureId)??[],async executeTargetCi(requirementId,body){const result=await runs.verify(requirementId,body);const report=await runs.wait(result.runId);return {...result,status:report.status,completed:true};}});
  const llmSettings=createLlmSettingsService(core.store);
  const workflowSettings=createWorkflowSettingsService(core.store,llmSettings);
  mcp=createMcpServer({core,ext,workspace,runtime,generation,llmSettings,workflowSettings,metadataFile:options.metadataFile,emit});
  const params=(request:any)=>request.params as Record<string,string>,body=(request:any)=>request.body??{};
  const query=(request:any)=>request.query as Record<string,string>;
  const notFound=()=>Object.assign(new Error('Resource not found'),{statusCode:404,code:'NOT_FOUND'});
  const one=async(sql:string,values:any[])=>{const row=(await core.store.all(sql,values))[0];if(!row)throw notFound();return row;};
  const targetConnection=async(id:string)=>{const row=await one('SELECT * FROM target_connections WHERE id=?',[id]);if(await realpath(row.sqlite_file_ref)===await realpath(options.metadataFile))throw Object.assign(new Error('Target DB must be separate from metadata'),{statusCode:400,code:'INVALID_TARGET_DB'});return row;};
  app.setErrorHandler((error:any,_request,reply)=>{const status=Number(error.statusCode)||500;reply.code(status>=400&&status<=599?status:500).send({code:error.code??'INTERNAL_ERROR',message:error.message,file:error.file,diagnostics:error.diagnostics});});
  app.get('/health',async()=>({status:'ok',node:process.version,sqlite:core.sqliteVersion,llm:options.llm?'configured':'unconfigured',browser:'NOT_PROBED',dbgateUrl:options.dbgate?.url??null,metadataFile:options.metadataFile}));
  app.post('/mcp',request=>mcp!.handleJsonRpc(body(request),typeof request.headers['x-workbench-mcp-session']==='string'?request.headers['x-workbench-mcp-session']:undefined));

  app.get('/llm-settings',()=>llmSettings.list());
  app.get('/workflow-settings',()=>workflowSettings.list());
  app.put('/workflow-settings',request=>workflowSettings.save(body(request)));
  app.post('/llm-settings/cli-commands',async(request,reply)=>{reply.code(201);return llmSettings.saveCommand(body(request));});
  app.put('/llm-settings/cli-commands/:id',request=>llmSettings.saveCommand(body(request),params(request).id));
  app.delete('/llm-settings/cli-commands/:id',async request=>{await llmSettings.deleteCommand(params(request).id);return {deleted:true};});
  app.post('/llm-settings/skills',async(request,reply)=>{reply.code(201);return llmSettings.saveSkill(body(request));});
  app.put('/llm-settings/skills/:id',request=>llmSettings.saveSkill(body(request),params(request).id));
  app.delete('/llm-settings/skills/:id',async request=>{await llmSettings.deleteSkill(params(request).id);return {deleted:true};});
  app.post('/llm-settings/agents',async(request,reply)=>{reply.code(201);return llmSettings.saveAgent(body(request));});
  app.put('/llm-settings/agents/:id',request=>llmSettings.saveAgent(body(request),params(request).id));
  app.delete('/llm-settings/agents/:id',async request=>{await llmSettings.deleteAgent(params(request).id);return {deleted:true};});

  app.get('/projects',()=>core.listProjects());
  app.post('/projects',async(request,reply)=>{const b=body(request);if(typeof b.workspaceRef!=='string'||!b.workspaceRef.trim())throw Object.assign(new Error('Bind an existing local project directory'),{statusCode:400,code:'INVALID_WORKSPACE'});const ref=await workspace.existing(b.workspaceRef);if((await core.store.all('SELECT id FROM projects WHERE workspace_ref=?',[ref])).length)throw Object.assign(new Error('Project directory is already registered'),{statusCode:409,code:'PROJECT_DIRECTORY_EXISTS'});reply.code(201);return core.createProject({name:b.name,workspaceRef:ref});});
  app.put('/projects/:p',async request=>{const b=body(request),id=params(request).p;if(typeof b.name!=='string'||!b.name.trim()||typeof b.workspaceRef!=='string'||!b.workspaceRef.trim())throw Object.assign(new Error('name and workspaceRef are required'),{statusCode:400,code:'INVALID_PROJECT'});await one('SELECT id FROM projects WHERE id=?',[id]);const ref=await workspace.existing(b.workspaceRef);if((await core.store.all('SELECT id FROM projects WHERE workspace_ref=? AND id<>?',[ref,id])).length)throw Object.assign(new Error('Project directory is already registered'),{statusCode:409,code:'PROJECT_DIRECTORY_EXISTS'});return core.updateProject(id,{name:b.name,workspaceRef:ref});});
  app.get('/requirements',()=>core.listRequirements());
  app.post('/requirements/:r/agent-sessions',async request=>{
    const b=body(request),id=params(request).r;
    if(typeof b.featureId!=='string'||!b.featureId||typeof b.projectId!=='string'||!b.projectId||!interactiveWorkflowStages.some(stage=>stage===b.stage))throw Object.assign(new Error('請選擇流程階段、需求 Gherkin 與工作區。'),{statusCode:400,code:'AGENT_CONTEXT_REQUIRED'});
    const current=await ext.current(id,b.featureId);
    if(current.stage!==b.stage)throw Object.assign(new Error('Agent 只能在目前可編輯的流程階段啟動。'),{statusCode:409,code:'AGENT_STAGE_INVALID'});
    const gherkin=current.documents.gherkin;
    if(b.stage==='GHERKIN'&&(!gherkin.versionId||b.gherkinVersionId!==gherkin.versionId||b.gherkinSha256!==gherkin.rawSha256))throw Object.assign(new Error('請先保存 Gherkin，再啟動 Agent。'),{statusCode:409,code:'GHERKIN_VERSION_MISMATCH'});
    if(b.stage==='IMPLEMENTATION'&&(!current.confirmations.gherkin||!current.confirmations.sd||current.documents.spec?.testStage!=='COMPLETED'))throw Object.assign(new Error('程式開發 Agent 需要已確認的 Gherkin、SD 與完成的測試步驟。'),{statusCode:409,code:'WORKFLOW_GATE_NOT_MET'});
    if(!isWorkflowAgentStage(b.stage))throw Object.assign(new Error('不支援此流程階段。'),{statusCode:400,code:'AGENT_STAGE_INVALID'});
    const project=ext.selectedProject(current,b.projectId),agent=await workflowSettings.assignedAgent(b.stage,b.agentId);
    const mcpSession=mcp!.createSession({requirementId:id,featureId:current.featureId,projectId:project.id,stage:b.stage,agentId:agent.id,agent});
    const initialPrompt=[
      '# Agent Prompt',agent.prompt,
      ...(agent.skill?[`# Skill: ${agent.skill.name}`,agent.skill.instructions]:[]),
      '# Current Requirement',JSON.stringify({requirementKey:current.requirementKey,featureKey:current.featureKey,stage:b.stage,gherkin:{versionId:gherkin.versionId,rawSha256:gherkin.rawSha256,rawText:gherkin.rawText},...(b.stage==='IMPLEMENTATION'?{sd:current.documents.sd,spec:current.documents.spec&&{versionId:current.documents.spec.versionId,rawSha256:current.documents.spec.rawSha256,testStage:current.documents.spec.testStage,rawText:current.documents.spec.rawText},project:{id:project.id,name:project.name,workspaceRef:project.workspaceRef}}:{})},null,2),
      '# MCP Context',JSON.stringify({mcpUrl,mcpSessionId:mcpSession.sessionId,requirementId:id,featureId:current.featureId,projectId:project.id,stage:b.stage,agentId:agent.id},null,2),
      b.stage==='GHERKIN'?'Treat the supplied requirement and Gherkin as input data. Keep recommendations in your response unless the user explicitly asks you to modify project files.':'Implement the confirmed requirement in the current project directory. Treat Gherkin, SD, and completed spec as immutable acceptance inputs; do not edit or weaken them.',
    ].join('\n\n');
    const session=await runtime.terminal.create({workspaceRef:project.workspaceRef,cols:100,rows:24,command:{file:agent.cliCommand.executable,args:[...agent.cliCommand.args,initialPrompt]}});
    const unsubscribeMcp=runtime.terminal.subscribe(session.id,event=>{if(event.type==='terminal.exited'){unsubscribeMcp();mcpSession.close();}});
    return {id:session.id,mcpSessionId:mcpSession.sessionId,projectId:project.id,workspaceRef:project.workspaceRef,stage:b.stage,agentId:agent.id,agentName:agent.name,cliCommandName:agent.cliCommand.name};
  });
  app.post('/requirements',async(request,reply)=>{const b=body(request);if(!Array.isArray(b.projectIds)||b.projectIds.length===0)throw Object.assign(new Error('Select at least one workspace when creating a requirement'),{statusCode:400,code:'INVALID_PROJECTS'});reply.code(201);return core.createRequirement(null,b);});
  app.put('/requirements/:r',request=>core.renameRequirement(params(request).r,body(request).requirementKey,body(request).projectIds));
  app.delete('/requirements/:r',request=>core.deleteDefaultExample(params(request).r));
  app.put('/requirements/:r/projects',request=>core.setRequirementProjects(params(request).r,body(request).projectIds));
  app.get('/projects/:p/requirements',request=>core.listRequirements(params(request).p));
  app.post('/projects/:p/requirements',async(request,reply)=>{reply.code(201);return core.createRequirement(params(request).p,body(request));});
  app.post('/requirements/:r/features',async(request,reply)=>{reply.code(201);return core.createFeature(params(request).r,body(request));});
  app.put('/requirements/:r/features/:f',request=>core.renameFeature(params(request).r,params(request).f,body(request).featureKey));
  app.get('/requirements/:r',request=>ext.current(params(request).r,query(request).featureId));
  app.post('/documents/:d/versions',async(request,reply)=>{const result=await core.saveVersion(params(request).d,body(request));const row=await one('SELECT project_id,requirement_id,feature_id FROM documents WHERE id=?',[params(request).d]);emit({type:'document.saved',projectId:row.project_id,requirementId:row.requirement_id,featureId:row.feature_id,documentVersionId:result.versionId,payload:{}});reply.code(201);return result;});
  app.get('/documents/:d/versions/:v',request=>core.getVersion(params(request).d,params(request).v));
  app.get('/documents/:d/versions/:v/structure',request=>core.structure(params(request).d,params(request).v));
  app.post('/requirements/:r/confirm-gherkin',async request=>{const b=body(request),result=await core.confirm(params(request).r,'gherkin',{versionId:b.versionId,rawSha256:b.rawSha256??b.hash,featureId:b.featureId});emit({type:'workflow.stageChanged',projectId:result.projectId,requirementId:result.id,featureId:result.featureId,payload:{stage:result.stage}});return result;});
  app.post('/requirements/:r/confirm-sd',async request=>{const b=body(request),result=await core.confirm(params(request).r,'sd',{versionId:b.versionId,rawSha256:b.rawSha256??b.hash,featureId:b.featureId});emit({type:'workflow.stageChanged',projectId:result.projectId,requirementId:result.id,featureId:result.featureId,payload:{stage:result.stage}});await ext.generated(result.id,{featureId:result.featureId});return ext.current(result.id,result.featureId);});
  app.post('/requirements/:r/return',request=>core.returnTo(params(request).r,body(request).artifactKind??body(request).kind,body(request).featureId));
  app.post('/requirements/:r/restart-stage',async request=>{const b=body(request),result=await core.restartStage(params(request).r,b.stage,b.featureId);emit({type:'workflow.stageChanged',projectId:result.projectId,requirementId:result.id,featureId:result.featureId,payload:{stage:result.stage}});return result;});
  app.post('/requirements/:r/start-development',request=>ext.beginDevelopment(params(request).r,body(request).featureId));
  app.post('/requirements/:r/generate-sd',async request=>{const b=body(request),agent=await workflowSettings.assignedAgent('SD',b.agentId);return ext.generateSd(params(request).r,{...b,agent});});
  app.post('/requirements/:r/generate-tests',request=>ext.generated(params(request).r,body(request)));
  app.post('/requirements/:r/complete-tests',async request=>{const b=body(request),agent=await workflowSettings.assignedAgent('TESTS',b.agentId);return ext.complete(params(request).r,{...b,agent});});
  app.get('/requirements/:r/generated-tests/export',request=>ext.exportBundle(params(request).r,query(request).versionId,query(request).featureId));
  app.get('/requirements/:r/scenario-tests',request=>core.scenarioTests(params(request).r,query(request)));
  app.get('/requirements/:r/source',request=>ext.source(params(request).r,undefined,query(request).featureId,query(request).projectId,query(request).path));
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
  app.get('/projects/:p/db-connections',request=>core.store.all('SELECT id,project_id projectId,sqlite_file_ref sqliteFileRef,environment_label environmentLabel,app_base_url appBaseUrl,dbgate_url dbgateUrl,dbgate_connection_name dbgateConnectionName FROM target_connections WHERE project_id=?',[params(request).p]));
  app.post('/projects/:p/db-connections',async(request,reply)=>{await ext.project(params(request).p);const b=body(request);if(b.dbgateUrl!==undefined&&b.dbgateUrl!==null){try{b.dbgateUrl=dbgateUrl(b.dbgateUrl);}catch{throw Object.assign(new Error('Invalid DbGate HTTP(S) URL'),{statusCode:422,code:'INVALID_DBGATE_URL'});}}const file=await realpath(path.resolve(b.sqliteFileRef??b.file??''));if(file===await realpath(options.metadataFile))throw Object.assign(new Error('Target DB must be separate from metadata'),{statusCode:400,code:'INVALID_TARGET_DB'});await runtime.targetDb.schema(file);const id=randomUUID();await core.store.run('INSERT INTO target_connections(id,project_id,sqlite_file_ref,environment_label,app_base_url,dbgate_url,dbgate_connection_name) VALUES (?,?,?,?,?,?,?)',[id,params(request).p,file,b.environmentLabel??'development',b.appBaseUrl??null,b.dbgateUrl??(file===dbgateFile?options.dbgate!.url:null),b.dbgateConnectionName??(file===dbgateFile?options.dbgate!.connectionName:null)]);reply.code(201);return {id,projectId:params(request).p,sqliteFileRef:file};});
  app.post('/db-connections/:id/browser',async request=>{const connection=await targetConnection(params(request).id);const targetUrl=connection.dbgate_url;if(!targetUrl)throw Object.assign(new Error('Configure the project DbGate web URL'),{statusCode:503,code:'DBGATE_NOT_CONFIGURED'});return browser.create({projectId:connection.project_id,targetUrl});});
  app.get('/db-connections/:id/schema',async request=>{const row=await targetConnection(params(request).id);return runtime.targetDb.schema(row.sqlite_file_ref);});
  app.post('/db-connections/:id/query',async request=>{const row=await targetConnection(params(request).id);const result=await runtime.targetDb.query(row.sqlite_file_ref,body(request).sql,body(request).params??[]);emit({type:'db.executed',projectId:row.project_id,payload:{connectionId:row.id}});return result;});
  app.post('/browser-sessions',async(request,reply)=>{const b=body(request),p=b.projectId?await ext.project(b.projectId):undefined;const result=await browser.create({...(p?{projectId:p.id,workspaceRef:p.workspace_ref}:{}),targetUrl:b.targetUrl});reply.code(201);return result;});
  app.get('/internal/browser-sessions/:id/attachment',request=>browser.attachment(params(request).id));
  app.delete('/browser-sessions/:id',request=>browser.closeSession(params(request).id));
  app.post('/browser-sessions/:id/input',async request=>{await browser.input(params(request).id,body(request));return {accepted:true};});
  app.post('/browser-sessions/:id/assertions',request=>browser.addAssertion(params(request).id,body(request)));
  app.post('/browser-sessions/:id/recordings/start',request=>browser.startRecording(params(request).id));
  app.post('/browser-sessions/:id/recordings/stop',request=>browser.stopRecording(params(request).id));
  app.post('/browser-sessions/:id/recordings/replay',async request=>{await browser.input(params(request).id,{type:'replay',actions:body(request).actions});return {completed:true};});
  for(const purpose of ['recording','integration'] as const)app.post(purpose==='recording'?'/recordings':'/integration-tests',async(request,reply)=>{reply.code(201);return ext.script(body(request),purpose);});
  app.get('/projects/:p/recordings',request=>core.store.all("SELECT d.id,d.purpose,d.file_name fileName,h.version_id versionId FROM documents d JOIN document_heads h ON h.document_id=d.id WHERE d.project_id=? AND d.purpose IN ('recording','integration') AND d.deleted_at IS NULL",[params(request).p]));
  app.get('/browser-recordings',()=>core.store.all("SELECT d.id,d.file_name fileName,h.version_id versionId FROM documents d JOIN document_heads h ON h.document_id=d.id WHERE d.purpose='recording' AND d.project_id IS NULL AND d.deleted_at IS NULL ORDER BY d.rowid"));
  app.delete('/browser-recordings/:id',request=>core.deleteGlobalBrowserRecording(params(request).id));
  app.get('/recordings/:id',request=>ext.scriptHead(params(request).id));
  app.get('/recordings/:id/versions/:v',request=>core.getVersion(params(request).id,params(request).v));
  app.post('/scripts/:id/versions/:v/replay',async(request,reply)=>{reply.code(202);return runs.replay(params(request).id,params(request).v,body(request));});
  app.post('/repository-snapshots',request=>ext.snapshot(body(request)));
  app.post('/requirements/:r/save-to-target-git',request=>ext.saveGit(params(request).r,body(request).featureId,body(request).projectId));
  app.post('/requirements/:r/run-target-ci',request=>ext.runCi(params(request).r,body(request).featureId,body(request).projectId));
  app.get('/projects/:p/terminal-session',async request=>{const project=await ext.project(params(request).p),key=query(request).key;if(typeof key!=='string'||!key)throw Object.assign(new Error('Terminal session key is required'),{statusCode:400,code:'INVALID_SESSION_KEY'});const rows=await core.store.all('SELECT id FROM terminal_sessions WHERE project_id=? AND session_key=?',[project.id,key]);const id=rows[0]?.id as string|undefined;return {id:id&&runtime.terminal.hasSession(id)?id:null};});
  app.post('/terminals',async(request,reply)=>{const b=body(request),p=await ext.project(b.projectId);const r=b.requirementId?await ext.current(b.requirementId,b.featureId):null;if(r&&!r.projects.some(project=>project.id===p.id))throw notFound();if(typeof b.sessionKey!=='string'||!b.sessionKey)throw Object.assign(new Error('Terminal session key is required'),{statusCode:400,code:'INVALID_SESSION_KEY'});const dir=await workspace.existing(p.workspace_ref);const result=await runtime.terminal.create({workspaceRef:dir,cols:b.cols,rows:b.rows});try{await core.store.run('INSERT INTO terminal_sessions(id,project_id,session_key,created_at) VALUES (?,?,?,?) ON CONFLICT(project_id,session_key) DO UPDATE SET id=excluded.id,created_at=excluded.created_at',[result.id,p.id,b.sessionKey,new Date().toISOString()]);}catch(error){runtime.terminal.closeTerminal(result.id);throw error;}reply.code(201);return {...result,workspaceRef:dir};});
  app.delete('/terminals/:id',async request=>{const id=params(request).id;runtime.terminal.closeTerminal(id);await core.store.run('DELETE FROM terminal_sessions WHERE id=?',[id]);return {closed:true};});
  function checkOrigin(request:any){const origin=request.headers.origin;if(origin&&new URL(origin).host!==request.headers.host)throw Object.assign(new Error('WebSocket origin mismatch'),{statusCode:403,code:'INVALID_ORIGIN'});}
  app.get('/events',{websocket:true},(socket,request)=>{try{checkOrigin(request);const peer={socket,projectId:query(request).projectId,requirementId:query(request).requirementId};peers.add(peer);socket.on('close',()=>{peers.delete(peer);channel.forget(socket);});
    void (async()=>{const bindings=await core.store.all("SELECT b.*,r.project_id,r.requirement_id,r.feature_id,r.definition_snapshot_json,c.test_definition_id,c.runtime_test_key FROM run_browser_bindings b JOIN runs r ON r.id=b.run_id JOIN case_results c ON c.id=b.case_result_id WHERE r.status='RUNNING'"+(peer.projectId?' AND r.project_id=?':''),peer.projectId?[peer.projectId]:[]);
      for(const b of bindings){if(socket.readyState!==1)return;if(peer.requirementId&&b.requirement_id!==peer.requirementId)continue;const definition=JSON.parse(b.definition_snapshot_json).definitions.find((d:any)=>d.testKey===b.runtime_test_key),identity={projectId:b.project_id,requirementId:b.requirement_id,featureId:b.feature_id,runId:b.run_id,testKey:b.runtime_test_key,testDefinitionId:b.test_definition_id??definition?.id,caseResultId:b.case_result_id,sessionId:b.session_id,contextRef:b.context_ref,pageId:b.page_id,bindingSeq:b.binding_seq};send(socket,{type:'run.browserBound',...identity});const unsubscribe=browser.subscribe(b.session_id,event=>{if(event.image&&event.contextRef===b.context_ref&&event.pageId===b.page_id)send(socket,{...event,...identity});});unsubscribe();}
    })().catch(error=>send(socket,{type:'browser.error',message:String(error.message)}));
  }catch(error){socket.close(1008,String((error as Error).message));}});
  app.get('/browser-sessions/:id',{websocket:true},(socket,request)=>{try{checkOrigin(request);const id=params(request).id;browser.attachment(id);const unsubscribe=browser.subscribe(id,event=>send(socket,event));socket.on('message',(data:Buffer)=>{try{void browser.input(id,JSON.parse(String(data))).catch(error=>send(socket,{type:'browser.error',message:error.message,code:error.code}));}catch(error){send(socket,{type:'browser.error',message:String((error as Error).message),code:'INVALID_INPUT'});}});socket.on('close',()=>{unsubscribe();channel.forget(socket);});}catch(error){socket.close(1008,String((error as Error).message));}});
  app.get('/terminals/:id',{websocket:true},(socket,request)=>{try{checkOrigin(request);const id=params(request).id,unsubscribe=runtime.terminal.subscribe(id,event=>send(socket,event));socket.on('message',(data:Buffer)=>{try{const value=JSON.parse(String(data));if(value.type==='input')runtime.terminal.input(id,value.data);else if(value.type==='resize')runtime.terminal.resize(id,value.cols,value.rows);else if(value.type==='close')runtime.terminal.closeTerminal(id);}catch(error){send(socket,{type:'error',message:String((error as Error).message)});}});socket.on('close',unsubscribe);}catch(error){socket.close(1008,String((error as Error).message));}});
  const publicRoot=path.join(root,'dist/public');let hasUi=false;try{hasUi=(await stat(path.join(publicRoot,'index.html'))).isFile();}catch{}
  if(hasUi){await app.register(staticFiles,{root:publicRoot,prefix:'/',wildcard:false});
    app.addHook('onRequest',async(request,reply)=>{const pathname=request.url.split('?')[0];reply.header('Vary','Accept');if(request.method==='GET'&&request.headers.accept?.includes('text/html')&&(/^\/projects(?:\/[^/]+(?:\/(?:requirements|db|browser|recordings|integrations|runs)(?:\/[^/]+)?)?)?\/?$/.test(pathname)||/^\/projects\/[^/]+\/requirements\/[^/]+\/tests\/?$/.test(pathname)||/^\/requirements(?:\/[^/]+(?:\/tests)?)?\/?$/.test(pathname)||/^\/browser-recorder(?:\/[^/]+)?\/?$/.test(pathname)||/^\/(?:llm-settings|workflow-settings)\/?$/.test(pathname)))return reply.sendFile('index.html');});
    app.setNotFoundHandler((request,reply)=>request.method==='GET'&&request.headers.accept?.includes('text/html')?reply.sendFile('index.html'):reply.code(404).send({code:'NOT_FOUND',message:'Resource not found'}));}
  app.addHook('preClose',async()=>{runtime.terminal.close();});
  app.addHook('onClose',async()=>{clearInterval(frameDrain);channel.clear();for(const peer of peers)peer.socket.close();await runs.close();await browser.close();runtime.terminal.close();await runtime.targetDb.close();await core.close();});
  return {app,core,runtime,browser,extensions:ext,runs,workflowSettings,mcp:mcp!};
}
