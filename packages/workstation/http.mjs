import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createWorkstation } from './service.mjs';
import { invariant, id, safePath, readJson, errorResult } from '../contracts/index.mjs';
import { verifyBundle } from '../spec-toolkit/engine.mjs';

const prefix = '/repository-api/v1';
const assets = new Map([
  ['/repositories', ['index.html', 'text/html; charset=utf-8']],
  ['/repositories/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/repositories/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
const securityHeaders = {
  'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'referrer-policy': 'no-referrer'
};
export async function dispatch(service, request) {
  const url = new URL(request.url, 'http://workstation.invalid'), pathname = url.pathname.replace(/\/$/, '') || '/';
  if (request.method === 'GET' && assets.has(pathname)) {
    const [name, type] = assets.get(pathname);
    return { status: 200, headers: { ...securityHeaders, 'content-type': type }, body: await readFile(new URL(`./public/${name}`, import.meta.url)) };
  }
  if (!pathname.startsWith(prefix + '/')) return { status: 404, body: { code: 'NOT_FOUND', message: 'Unknown workstation route' } };
  const parts = pathname.slice(prefix.length + 1).split('/').map(decodeURIComponent);
  const method = request.method, input = request.body ?? {};
  if (method !== 'GET') {
    invariant(request.headers['x-workbench-request'] === '1', 'REQUEST_HEADER_REQUIRED', 'Workbench request header is required', 403);
    if (request.headers.origin) {
      const origin = new URL(request.headers.origin);
      invariant(origin.host === request.headers.host && ['http:', 'https:'].includes(origin.protocol), 'CROSS_ORIGIN_DENIED', 'Cross-origin writes are forbidden', 403);
    }
    invariant(Buffer.byteLength(JSON.stringify(input)) <= 2 * 1024 * 1024, 'REQUEST_TOO_LARGE', 'Request exceeds 2 MiB', 413);
  }
  let result, status = 200;
  if (method === 'GET' && parts.join('/') === 'capabilities') result = { schemaVersion: 1, executionEnabled: service.options.enableExecution, configFormat: 'JSON-compatible YAML', nestedSubmodules: false, authentication: 'private-loopback deployment', toolkitUpgrade: true, reportReindex: true, legacyImport: Boolean(service.options.legacyFile) };
  else if (parts[0] === 'workspaces' && parts.length === 1) {
    if (method === 'GET') result = service.list();
    else if (method === 'POST') { result = service.register(input); status = 201; }
  } else if (parts[0] === 'workspaces' && parts.length === 2 && method === 'GET') result = await service.detail(id(parts[1]));
  else if (parts[0] === 'workspaces' && parts[2] === 'git' && parts.length === 3 && method === 'GET') result = await service.inspect(id(parts[1]), url.searchParams.get('projectId') || undefined);
  else if (parts[0] === 'workspaces' && parts[2] === 'file' && parts.length === 3 && method === 'GET') result = await service.readFile(id(parts[1]), url.searchParams.get('path'));
  else if (parts[0] === 'operations' && parts.length === 1 && method === 'POST') { result = service.enqueue(input); status = 202; }
  else if (parts[0] === 'operations' && parts.length === 2 && method === 'GET') result = service.operation(id(parts[1]));
  else if (parts[0] === 'operations' && parts[2] === 'cancel' && parts.length === 3 && method === 'POST') result = service.cancel(id(parts[1]));
  else if (parts[0] === 'workspaces' && parts[2] === 'runs' && parts[4] === 'artifact' && parts.length === 5 && method === 'GET') {
    const workspaceId = id(parts[1]), runId = id(parts[3]), relative = url.searchParams.get('path');
    const evidence = await service.artifactDirectory(workspaceId, runId, url.searchParams.get('reportKey'));
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
export async function registerRepositoryRoutes(app, options) {
  const service = await createWorkstation(options);
  const handler = async (request, reply) => {
    const response = await safeDispatch(service, { method: request.method, url: request.raw.url, headers: request.headers, body: request.body });
    reply.code(response.status); for (const [key, value] of Object.entries(response.headers ?? {})) reply.header(key, value);
    return response.body;
  };
  for (const route of assets.keys()) app.get(route, handler);
  app.route({ method: ['GET', 'POST'], url: `${prefix}/*`, handler });
  app.addHook('onClose', async () => service.close());
  return service;
}
export async function createStandaloneServer(options) {
  const service = await createWorkstation(options);
  const server = createServer(async (request, response) => {
    if (request.url === '/') { response.writeHead(302, { location: '/repositories' }); response.end(); return; }
    let bytes = 0, chunks = [];
    try {
      for await (const chunk of request) { bytes += chunk.length; invariant(bytes <= 2 * 1024 * 1024, 'REQUEST_TOO_LARGE', 'Request exceeds 2 MiB', 413); chunks.push(chunk); }
      let body;
      if (chunks.length) { try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { invariant(false, 'INVALID_JSON', 'Expected a JSON request', 400); } }
      const result = await safeDispatch(service, { method: request.method, url: request.url, headers: request.headers, body });
      response.writeHead(result.status, result.headers); response.end(Buffer.isBuffer(result.body) ? result.body : JSON.stringify(result.body));
    } catch (error) { response.writeHead(error.statusCode || 500, { 'content-type': 'application/json' }); response.end(JSON.stringify(errorResult(error))); }
  });
  return { server, service, async close() { await service.close(); if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}
