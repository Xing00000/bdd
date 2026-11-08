import {dispatchSessionManagement,sessionManagementPages} from './session-management/http.mjs';
import {createRequire} from 'node:module';
import { terminalVendor } from './development.mjs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import {agentStreamBufferBytes} from './agent-session-stream.mjs';
import { workspaceEntries, entriesDigest, workingCommit } from '../spec-toolkit/workspace.mjs';
import { createWorkstation } from './service.mjs';
import { invariant, id, safePath, errorResult } from '../contracts/index.mjs';
import { verifyBundle } from '../spec-toolkit/engine.mjs';
import { renderNativeReport } from './native-report.mjs';

const prefix = '/repository-api/v1';
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/repositories', ['index.html', 'text/html; charset=utf-8']],
  ['/repositories/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/repositories/development.js', ['development.js', 'text/javascript; charset=utf-8']],
  ['/repositories/operation-terminal.js', ['operation-terminal.js', 'text/javascript; charset=utf-8']],
  ['/repositories/interaction-history.js', ['interaction-history.js', 'text/javascript; charset=utf-8']],
  ['/repositories/chat.js', ['chat.js', 'text/javascript; charset=utf-8']],
  ['/repositories/design-decisions.js', ['../../spec-toolkit/design-decisions.mjs', 'text/javascript; charset=utf-8']],
  ['/repositories/design-view.js', ['design-view.js', 'text/javascript; charset=utf-8']],
  ['/repositories/agent-catalog.js', ['agent-catalog.js', 'text/javascript; charset=utf-8']],
  ['/repositories/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
const securityHeaders = {
  'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'referrer-policy': 'no-referrer'
};
export async function dispatch(service, request) {
  const sessionResponse = await dispatchSessionManagement(service, request);
  if (sessionResponse) return sessionResponse;
  const url = new URL(request.url, 'http://workstation.invalid'), pathname = url.pathname.replace(/\/$/, '') || '/';
  if(request.method==='GET'&&pathname==='/health') {
    let source = {};
    if (process.env.WB_SOURCE_DIGEST) {
      const contentDigest = entriesDigest(await workspaceEntries(service.options.toolkitRoot));
      invariant(contentDigest === process.env.WB_SOURCE_DIGEST, 'SOURCE_VERSION_MISMATCH', '啟動來源與測試快照不符。', 409);
      source = { sourceKind: 'WORKSPACE', sourceDigest: contentDigest, sourceVersion: `sha256:${contentDigest}` };
    } else if (process.env.WB_SOURCE_COMMIT) {
      const commit = await workingCommit(service.options.toolkitRoot);
      invariant(commit === process.env.WB_SOURCE_COMMIT, 'SOURCE_VERSION_MISMATCH', '啟動版本與測試來源不符。', 409); source = { commit };
    }
    return {status:200,headers:{...securityHeaders,'content-type':'application/json; charset=utf-8'},body:{status:'ok',...source}};
  }
  if(request.method==='GET'&&['/repositories/xterm.js','/repositories/xterm.css','/repositories/xterm-addon-fit.js'].includes(pathname))return {status:200,headers:{...securityHeaders,'content-type':pathname.endsWith('.js')?'text/javascript':'text/css'},body:await readFile(terminalVendor(service.options.home,pathname.split('/').at(-1)))};
  if(request.method==='GET'&&pathname==='/repositories/markdown-it.js')return {status:200,headers:{...securityHeaders,'content-type':'text/javascript; charset=utf-8'},body:await readFile(createRequire(import.meta.url).resolve('markdown-it/browser'))};
  if (request.method === 'GET' && assets.has(pathname)) {
    const [name, type] = assets.get(pathname);
    return { status: 200, headers: { ...securityHeaders, 'content-type': type }, body: await readFile(new URL(`./public/${name}`, import.meta.url)) };
  }
  if (!pathname.startsWith(prefix + '/')) return { status: 404, body: { code: 'NOT_FOUND', message: 'Unknown workstation route' } };
  const parts = pathname.slice(prefix.length + 1).split('/').map(decodeURIComponent);
  const method = request.method, input = request.body ?? {};
  if (parts.join('/') === 'mcp/progress') {
    invariant(Buffer.byteLength(JSON.stringify(input)) <= 2 * 1024 * 1024, 'REQUEST_TOO_LARGE', 'Request exceeds 2 MiB', 413);
    const result = await service.mcpProgress(request);
    return { ...result, headers: { ...securityHeaders, 'content-type': 'application/json; charset=utf-8', ...result.headers } };
  }
  if (method !== 'GET') {
    invariant(request.headers['x-workbench-request'] === '1', 'REQUEST_HEADER_REQUIRED', 'Workbench request header is required', 403);
    if (request.headers.origin) {
      const origin = new URL(request.headers.origin);
      invariant(origin.host === request.headers.host && ['http:', 'https:'].includes(origin.protocol), 'CROSS_ORIGIN_DENIED', 'Cross-origin writes are forbidden', 403);
    }
    invariant(Buffer.byteLength(JSON.stringify(input)) <= 2 * 1024 * 1024, 'REQUEST_TOO_LARGE', 'Request exceeds 2 MiB', 413);
  }
  let result, status = 200;
  if(parts[0]==='agent-catalog'){
    let body;
    if(parts.length===1&&method==='GET')body=service.catalog();
    else if(parts.length===2&&parts[1]==='agents'&&method==='POST')body=service.saveAgent(input);
    else if(parts.length===2&&parts[1]==='prompts'&&method==='POST')body=service.savePrompt(input);
    else if(parts.length===2&&parts[1]==='skills'&&method==='POST')body=service.saveSkill(input);
    invariant(body!==undefined,'NOT_FOUND','Unknown catalog route',404);return {status:200,headers:{...securityHeaders,'content-type':'application/json; charset=utf-8'},body};
  }
  if(parts[0]==='spec-repositories'&&parts[2]==='agent-defaults'&&parts.length===3){
    const body=method==='GET'?await service.catalogDefaults(id(parts[1])):method==='PUT'?await service.saveCatalogDefault(id(parts[1]),input):undefined;
    invariant(body!==undefined,'NOT_FOUND','Unknown defaults route',404);return {status:200,headers:{...securityHeaders,'content-type':'application/json; charset=utf-8'},body};
  }
  if(parts[0]==='agent-sessions'){
    if(parts.length===1&&method==='GET'){
      const activeOnly=url.searchParams.get('activeOnly');
      invariant(activeOnly===null||activeOnly==='true'||activeOnly==='false','INVALID_AGENT_QUERY','activeOnly must be true or false');
      result={sessions:service.agentSessions({repositoryId:url.searchParams.get('repositoryId')||undefined,operationId:url.searchParams.get('operationId')||undefined,activeOnly:activeOnly==='true'})};
    }
    else if(parts.length===1&&method==='POST'){result=await service.startAgentSession(input);status=201;}
    else if(parts.length===2&&parts[1]==='workspaces'&&method==='GET')result=await service.agentWorkspaces();
    else if(parts.length===2&&method==='GET')result=service.agentSession(id(parts[1]));
    else if(parts.length===3&&parts[2]==='events'&&method==='GET')result=service.agentSessionEvents(id(parts[1]),{afterSeq:url.searchParams.has('afterSeq')?Number(url.searchParams.get('afterSeq')):0,limit:url.searchParams.has('limit')?Number(url.searchParams.get('limit')):200});
    else if(parts.length===3&&parts[2]==='messages'&&method==='POST')result=await service.sendAgentSessionMessage(id(parts[1]),input);
    else if(parts.length===3&&parts[2]==='terminal-input'&&method==='POST')result=await service.sendAgentTerminalInput(id(parts[1]),input);
    else if(parts.length===3&&parts[2]==='cancel'&&method==='POST')result=await service.cancelAgentSessionTurn(id(parts[1]),input);
    else if(parts.length===3&&parts[2]==='stop'&&method==='POST')result=await service.stopAgentSession(id(parts[1]),input);
    invariant(result!==undefined,'NOT_FOUND','Unknown agent session route',404);
    return {status,headers:{...securityHeaders,'content-type':'application/json; charset=utf-8'},body:result};
  }
  if(parts[0]==='chat-rooms'||parts[0]==='chat-settings'||parts[0]==='chat-models') {
    const chat=await service.chat();
    if(parts[0]==='chat-models'&&parts.length===1&&method==='GET')result=await chat.models();
    if(parts[0]==='chat-settings'&&parts.length===1){if(method==='GET')result=await chat.settings();else if(method==='PUT')result=await chat.saveSettings(input);else if(method==='PATCH')result=await chat.patchSettings(input);}
    if(parts[0]==='chat-rooms'){
      if(parts.length===1&&method==='GET')result=await chat.list();
      else if(parts.length===1&&method==='POST'){result=await chat.create(input);status=201;}
      else if(parts.length===2&&method==='GET')result=await chat.detail(parts[1]);
      else if(parts.length===3&&parts[2]==='messages'&&method==='POST'){result=await chat.send(parts[1],input);status=202;}
      else if(parts.length===3&&parts[2]==='compact'&&method==='POST')result=await chat.compact(parts[1]);
    }
    invariant(result!==undefined,'NOT_FOUND','Unknown chat route',404);
    return {status,headers:{...securityHeaders,'content-type':'application/json; charset=utf-8'},body:result};
  }
  if (method === 'GET' && parts.join('/') === 'workbench') result = { id: 'local', title: 'BDD 工作台', model: 'workbench/spec-repositories/projects', repositories: service.list().length };
  else if (method === 'GET' && parts.join('/') === 'capabilities') result = { schemaVersion: 1, executionEnabled: service.options.enableExecution, configFormat: 'JSON-compatible YAML', nestedSubmodules: false, authentication: 'private-loopback deployment', toolkitUpgrade: true, reportReindex: true, legacyImport: Boolean(service.options.legacyFile) };
  else if (parts[0] === 'spec-repositories' && parts.length === 1) {
    if (method === 'GET') result = service.list();
    else if (method === 'POST') { result = service.register(input); status = 201; }
  } else if (parts[0] === 'spec-repositories' && parts.length === 2 && method === 'GET') result = await service.detail(id(parts[1]));
  else if (parts[0] === 'spec-repositories' && parts[2] === 'interactions' && parts.length === 3 && method === 'GET') result = service.interactions(id(parts[1]),{before:url.searchParams.has('before')?Number(url.searchParams.get('before')):undefined,limit:url.searchParams.has('limit')?Number(url.searchParams.get('limit')):20,type:url.searchParams.get('type')??undefined,key:url.searchParams.get('key')??undefined});
  else if (parts[0] === 'spec-repositories' && parts[2] === 'agent-preview' && parts.length === 3 && method === 'POST') result = await service.agentPreview(id(parts[1]),input);
  else if (parts[0] === 'spec-repositories' && parts[2] === 'requirement' && parts.length === 3 && method === 'GET') result = await service.requirement(id(parts[1]), id(url.searchParams.get('requirementId')), id(url.searchParams.get('featureId')));
  else if (parts[0] === 'spec-repositories' && parts[2] === 'requirement' && parts[3] === 'generate' && parts.length === 4 && method === 'POST') result = service.generateRequirement(id(parts[1]), input);
  else if (parts[0] === 'spec-repositories' && parts[2] === 'requirement' && parts[3] === 'import' && parts.length === 4 && method === 'POST') result = service.importRequirementDocument(id(parts[1]), input);
  else if (parts[0] === 'spec-repositories' && parts[2] === 'requirement' && parts[3] === 'proposals' && parts.length === 4 && method === 'GET') result = service.requirementProposals(id(parts[1]), url.searchParams.get('editorKey'));
  else if (parts[0] === 'spec-repositories' && parts[2] === 'git' && parts.length === 3 && method === 'GET') result = await service.inspect(id(parts[1]), url.searchParams.get('projectId') || undefined);
  else if (parts[0] === 'spec-repositories' && parts[2] === 'file' && parts.length === 3 && method === 'GET') result = await service.readFile(id(parts[1]), url.searchParams.get('path'));
  else if (parts[0] === 'spec-repositories' && parts[2] === 'projects' && parts.length === 5 && method === 'GET') {
    if (parts[4] === 'files') result = await service.projectFiles(id(parts[1]), id(parts[3]));
    else if (parts[4] === 'file') result = await service.readProjectFile(id(parts[1]), id(parts[3]), url.searchParams.get('path'));
  }
  else if (parts[0] === 'spec-repositories' && parts.length===3 && parts[2]==='versions' && method==='GET') result=await service.versions(id(parts[1]),url.searchParams.get('ref'));
  else if (parts[0] === 'spec-repositories' && parts.length===3 && parts[2]==='version-file' && method==='GET') result=await service.versionFile(id(parts[1]),url.searchParams.get('ref'),url.searchParams.get('path'));
  else if (parts[0] === 'spec-repositories' && parts[2] === 'workflow' && parts.length === 3 && method === 'GET') result = await service.workflow(id(parts[1]),url.searchParams.get('feature')||undefined);
  else if(parts[0]==='operations'&&parts.length===3&&parts[2]==='interaction'&&method==='GET')result=service.interaction(id(parts[1]));
  else if(parts[0]==='operations'&&parts.length===3&&parts[2]==='terminal'&&method==='GET')result=await service.terminal(id(parts[1]),Number(url.searchParams.get('offset')??0));
  else if(parts[0]==='operations'&&parts.length===3&&parts[2]==='input'&&method==='POST')result=service.terminalInput(id(parts[1]),input);
  else if (parts[0] === 'operations' && parts.length === 1 && method === 'POST') { result = service.enqueue(await service.prepareAgentRequest(input)); status = 202; }
  else if (parts[0] === 'operations' && parts.length === 2 && method === 'GET') result = service.operation(id(parts[1]));
  else if (parts[0] === 'operations' && parts[2] === 'cancel' && parts.length === 3 && method === 'POST') result = service.cancel(id(parts[1]));
  else if(parts[0]==='spec-repositories'&&parts[2]==='runs'&&parts[4]==='report'&&parts.length>=7&&method==='GET') {
    const keyed=parts[5]==='by-key',directory=await service.artifactDirectory(id(parts[1]),id(parts[3]),keyed?parts[6]:undefined);
    const manifest=await verifyBundle(directory),relative=parts.slice(keyed?7:5).join('/');
    invariant(relative.startsWith('native/')&&manifest.artifacts.some(a=>a.path===relative),'ARTIFACT_NOT_FOUND','Unknown report artifact',404);
    const types={html:'text/html; charset=utf-8',js:'text/javascript',css:'text/css',png:'image/png',jpg:'image/jpeg',json:'application/json'};
    const type=types[relative.split('.').at(-1)]??'application/octet-stream';
    const bytes=await readFile(await safePath(directory,relative,{missing:false}));
    return {status:200,headers:{...securityHeaders,'content-type':type,'content-security-policy':"sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: blob:; font-src data:; connect-src 'self' data: blob:; worker-src blob:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'"},body:type.startsWith('text/html')?renderNativeReport(bytes):bytes};
  }
  else if (parts[0] === 'spec-repositories' && parts[2] === 'runs' && parts[4] === 'artifact' && parts.length === 5 && method === 'GET') {
    const repositoryId = id(parts[1]), runId = id(parts[3]), relative = url.searchParams.get('path');
    const evidence = await service.artifactDirectory(repositoryId, runId, url.searchParams.get('reportKey'));
    const manifest = await verifyBundle(evidence);
    invariant(['manifest.json', 'seal.json'].includes(relative) || manifest.artifacts.some(x => x.path === relative), 'ARTIFACT_NOT_FOUND', 'Unknown artifact', 404);
    const body = await readFile(await safePath(evidence, relative, { missing: false }));
    let type = 'application/octet-stream';
    if (relative.endsWith('.json')) type = 'application/json';
    else if (relative.endsWith('.png') && body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) type = 'image/png';
    else if (/\.jpe?g$/.test(relative) && body[0] === 255 && body[1] === 216) type = 'image/jpeg';
    return { status: 200, headers: { ...securityHeaders, 'content-type': type, ...(type.startsWith('image/') || type === 'application/json' ? {} : { 'content-disposition': 'attachment' }) }, body };
  }
  invariant(result !== undefined, 'NOT_FOUND', 'Unknown workstation route', 404);
  return { status, headers: { ...securityHeaders, 'content-type': 'application/json; charset=utf-8' }, body: result };
}
async function safeDispatch(service, request) {
  try { return await dispatch(service, request); }
  catch (error) { return { status: Number(error.statusCode) || (error.code === 'ENOENT' ? 404 : 500), headers: securityHeaders, body: errorResult(error) }; }
}
async function chatEvents(service,request,response){
  const url=new URL(request.url,'http://workstation.invalid');
  if(request.method!=='GET'||url.pathname!==prefix+'/chat-events')return false;
  if(request.headers.origin){const origin=new URL(request.headers.origin);invariant(origin.host===request.headers.host&&['http:','https:'].includes(origin.protocol),'CROSS_ORIGIN_DENIED','Cross-origin streams are forbidden',403);}
  const {openChatStream}=await import('../../src/http/chat-stream.ts');
  await openChatStream(await service.chat(),response,url.searchParams.get('roomId')??undefined);return true;
}
function installAgentTerminalSockets(server,service){
  const sockets=new WebSocketServer({noServer:true,maxPayload:65536});
  const upgrade=(request,socket,head)=>{
    const url=new URL(request.url,'http://workstation.invalid');
    const match=url.pathname.match(/^\/repository-api\/v1\/agent-sessions\/([^/]+)\/terminal$/);
    if(!match)return;
    try{
      const origin=new URL(request.headers.origin);
      invariant(origin.host===request.headers.host&&['http:','https:'].includes(origin.protocol),'CROSS_ORIGIN_DENIED','Cross-origin terminal forbidden',403);
      const sessionId=id(decodeURIComponent(match[1]));
      const cursor=Number(url.searchParams.get('afterSeq')??0);
      invariant(Number.isSafeInteger(cursor)&&cursor>=0,'INVALID_EVENT_SEQ','Invalid event cursor');
      service.agentSessionEvents(sessionId,{afterSeq:cursor,limit:1});
      sockets.handleUpgrade(request,socket,head,ws=>{
        const streamAbort=new AbortController();
        let dispose,closed=false,queue=Promise.resolve();
        ws.on('error',()=>{});
        ws.on('close',()=>{closed=true;streamAbort.abort();dispose?.();});
        ws.on('message',(data,isBinary)=>{
          queue=queue.then(async()=>{
            invariant(!isBinary,'INVALID_TERMINAL_INPUT','Binary input is not supported',400);
            const message=JSON.parse(data.toString());
            invariant(message&&message.type==='input'&&typeof message.data==='string','INVALID_TERMINAL_INPUT','Invalid terminal input',400);
            await service.sendAgentTerminalInput(sessionId,{data:message.data});
          }).catch(error=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'error',message:error.message}));});
        });
        void service.subscribeAgentSession(sessionId,{afterSeq:cursor,signal:streamAbort.signal,onMessage:message=>{
          if(ws.readyState!==WebSocket.OPEN)return;
          if(ws.bufferedAmount>agentStreamBufferBytes){ws.close(1013,'Terminal client too slow');return;}
          ws.send(JSON.stringify(message));
          if(message.type==='closed')ws.close();
        },onError:()=>ws.close(1011,'Terminal stream failed')}).then(unsubscribe=>{dispose=unsubscribe;if(closed)dispose();}).catch(()=>ws.close(1011,'Terminal stream failed'));
      });
    }catch{socket.destroy();}
  };
  server.on('upgrade',upgrade);
  return ()=>{server.off('upgrade',upgrade);for(const ws of sockets.clients)ws.terminate();sockets.close();};
}
export async function registerRepositoryRoutes(app, options) {
  const service = await createWorkstation(options);
  const closeTerminalSockets=installAgentTerminalSockets(app.server,service);
  const handler = async (request, reply) => {
    if(await chatEvents(service,request.raw,reply.raw)){reply.hijack();return;}
    const response = await safeDispatch(service, { method: request.method, url: request.raw.url, headers: request.headers, body: request.body });
    reply.code(response.status); for (const [key, value] of Object.entries(response.headers ?? {})) reply.header(key, value);
    return response.body;
  };
  for (const route of [...sessionManagementPages,...assets.keys(),'/repositories/markdown-it.js','/repositories/xterm.js','/repositories/xterm.css','/repositories/xterm-addon-fit.js']) app.get(route, handler);
  app.route({ method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], url: `${prefix}/mcp/progress`, handler });
  app.route({ method: ['GET', 'POST', 'PUT', 'PATCH'], url: `${prefix}/*`, handler });
  app.addHook('onClose', async () => {closeTerminalSockets();await service.close();});
  return service;
}
export async function createStandaloneServer(options) {
  const service = await createWorkstation(options);
  const server = createServer(async (request, response) => {

    let bytes = 0, chunks = [];
    try {
      if(await chatEvents(service,request,response))return;
      for await (const chunk of request) { bytes += chunk.length; invariant(bytes <= 2 * 1024 * 1024, 'REQUEST_TOO_LARGE', 'Request exceeds 2 MiB', 413); chunks.push(chunk); }
      let body;
      if (chunks.length) { try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { invariant(false, 'INVALID_JSON', 'Expected a JSON request', 400); } }
      const result = await safeDispatch(service, { method: request.method, url: request.url, headers: request.headers, body });
    response.writeHead(result.status, result.headers); response.end(result.body === '' ? '' : Buffer.isBuffer(result.body) ? result.body : JSON.stringify(result.body));
    } catch (error) { response.writeHead(error.statusCode || 500, { 'content-type': 'application/json' }); response.end(JSON.stringify(errorResult(error))); }
  });
  const closeTerminalSockets=installAgentTerminalSockets(server,service);
  return { server, service, async close() { closeTerminalSockets();await service.close(); if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}
