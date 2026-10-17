import Fastify, { type FastifyRequest } from 'fastify';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, lstatSync } from 'node:fs';

export const targetFixtureDdl = `
CREATE TABLE IF NOT EXISTS test_accounts(username TEXT PRIMARY KEY NOT NULL,role_code TEXT NOT NULL,state TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS test_documents(document_key TEXT PRIMARY KEY NOT NULL,content TEXT NOT NULL);
INSERT INTO test_accounts(username,role_code,state) VALUES ('scenario_user','A','active') ON CONFLICT(username) DO NOTHING;
INSERT INTO test_documents(document_key,content) VALUES ('scenario_document','initial') ON CONFLICT(document_key) DO NOTHING;
`;
export function initializeTargetDatabase(file: string) {
  if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw new Error('Dedicated target fixture database cannot be a symbolic link');
  const db = new DatabaseSync(file);
  // Host website and Docker DbGate cannot share SQLite's WAL-index memory.
  // Use rollback journaling for the fixture file mounted across that boundary.
  try { db.exec('PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON;'); db.exec(targetFixtureDdl); }
  finally { db.close(); }
}
const escape = (value: unknown) => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
type Session = { username: string; role: string; expiresAt: number };
type Account = { username: string; role_code: string; state: string };

/** A real, separate target website. Workbench metadata and APIs are not emulated here. */
export function createTargetApp({ file, password }: { file: string; password: string }) {
  if (!password) throw new Error('WB_TARGET_PASSWORD is required for the target fixture application');
  if (!existsSync(file)) throw new Error('Initialize the dedicated target fixture database before starting the website');
  if (lstatSync(file).isSymbolicLink()) throw new Error('Dedicated target fixture database cannot be a symbolic link');
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
  const sessions = new Map<string, Session>(), salt = randomBytes(16), digest = scryptSync(password, salt, 32);
  const cookieName = 'wb_target_session';
  function session(request: FastifyRequest) {
    for (const [key, value] of sessions) if (value.expiresAt < Date.now()) sessions.delete(key);
    const token = request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    const current = token ? sessions.get(token) : undefined;
    if (!current) return undefined;
    const account = db.prepare('SELECT username,role_code,state FROM test_accounts WHERE username=?').get(current.username) as Account | undefined;
    if (account?.state !== 'active') { if (token) sessions.delete(token); return undefined; }
    return { ...current, token: token!, account };
  }
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.origin) {
      let origin: URL;
      try { origin = new URL(request.headers.origin); } catch { return reply.code(403).send({ code: 'ORIGIN_DENIED' }); }
      if (origin.host !== request.headers.host) return reply.code(403).send({ code: 'ORIGIN_DENIED' });
    }
  });
  function page(content: string, script = '') {
    const nonce = randomBytes(12).toString('base64');
    return { nonce, html: `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>獨立測試文件網站</title><style nonce="${nonce}">body{font:16px system-ui;background:#eef2f7;color:#17304c;max-width:760px;margin:50px auto;padding:28px}main{background:white;border:1px solid #cbd5e1;padding:28px;border-radius:12px}label{display:block;margin:12px 0}input,textarea,button{font:inherit;padding:10px;border:1px solid #94a3b8;border-radius:6px}textarea{display:block;width:94%;min-height:160px}button{cursor:pointer;background:#183b66;color:white;margin-top:12px}a{color:#1d4ed8}header{display:flex;justify-content:space-between;align-items:center} [hidden]{display:none!important}</style></head><body><main>${content}</main>${script ? `<script nonce="${nonce}">${script}</script>` : ''}</body></html>` };
  }
  function sendPage(reply: { header: (name: string, value: string) => any; type: (value: string) => any }, body: ReturnType<typeof page>) {
    reply.header('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${body.nonce}'; style-src 'nonce-${body.nonce}'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`);
    return reply.type('text/html; charset=utf-8').send(body.html);
  }
  app.get('/health', async () => ({ status: 'ok', database: 'target-fixture' }));
  app.get('/', async (request, reply) => {
    const current = session(request);
    if (!current) return sendPage(reply, page(`<h1>文件網站登入</h1><form id="login"><label>帳號 <input data-testid="login-username" name="username" autocomplete="username" required></label><label>密碼 <input data-testid="login-password" type="password" name="password" autocomplete="current-password" required></label><button data-testid="login-submit">登入</button><p id="error" role="alert"></p></form>`, `document.querySelector('#login').addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.target);const response=await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.fromEntries(form))});if(response.ok)location.href='/';else document.querySelector('#error').textContent='帳號、密碼或狀態不符';});`));
    const document = db.prepare('SELECT content FROM test_documents WHERE document_key=?').get('scenario_document') as { content: string } | undefined;
    const canEdit = current.role === 'B' && current.account.role_code === 'B';
    return sendPage(reply, page(`<header><h1>測試文件</h1><button type="button" data-testid="logout">登出</button></header><p>帳號 ${escape(current.username)}，角色 <strong data-testid="account-role">${escape(current.role)}</strong></p><label>scenario_document<textarea data-testid="document-content" ${canEdit ? '' : 'readonly'}>${escape(document?.content ?? '')}</textarea></label><button data-testid="document-save" ${canEdit ? '' : 'disabled'}>保存文件</button><p data-testid="document-saved" hidden>已保存</p><p id="error" role="alert"></p><p><a href="/manage-accounts" data-testid="manage-accounts-link">管理帳號</a></p>`, `document.querySelector('[data-testid="logout"]').addEventListener('click',async()=>{await fetch('/api/logout',{method:'POST'});location.href='/';});document.querySelector('[data-testid="document-save"]').addEventListener('click',async()=>{document.querySelector('[data-testid="document-saved"]').hidden=true;const response=await fetch('/api/document',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({content:document.querySelector('[data-testid="document-content"]').value})});if(response.ok)document.querySelector('[data-testid="document-saved"]').hidden=false;else document.querySelector('#error').textContent='拒絕保存';});`));
  });
  app.post<{ Body: { username?: string; password?: string } }>('/api/login', async (request, reply) => {
    const username = request.body?.username, provided = request.body?.password;
    if (typeof username !== 'string' || typeof provided !== 'string') return reply.code(400).send({ code: 'LOGIN_INPUT_INVALID' });
    const account = db.prepare('SELECT username,role_code,state FROM test_accounts WHERE username=?').get(username) as Account | undefined;
    if (!timingSafeEqual(digest, scryptSync(provided, salt, 32)) || account?.state !== 'active' || !['A', 'B'].includes(account.role_code))
      return reply.code(401).send({ code: 'LOGIN_DENIED' });
    const token = randomBytes(32).toString('base64url');
    sessions.set(token, { username, role: account.role_code, expiresAt: Date.now() + 8 * 60 * 60 * 1000 });
    reply.header('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${request.protocol === 'https' ? '; Secure' : ''}`);
    return { username, role: account.role_code };
  });
  app.post('/api/logout', async (request, reply) => {
    const current = session(request); if (current) sessions.delete(current.token);
    reply.header('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    return { loggedOut: true };
  });
  app.get('/api/session', async (request, reply) => {
    const current = session(request);
    return current ? { username: current.username, role: current.role } : reply.code(401).send({ code: 'LOGIN_REQUIRED' });
  });
  app.get('/api/document', async (request, reply) => {
    if (!session(request)) return reply.code(401).send({ code: 'LOGIN_REQUIRED' });
    return db.prepare('SELECT document_key,content FROM test_documents WHERE document_key=?').get('scenario_document');
  });
  app.post<{ Body: { content?: string } }>('/api/document', async (request, reply) => {
    const current = session(request);
    if (!current) return reply.code(401).send({ code: 'LOGIN_REQUIRED' });
    if (current.role !== 'B' || current.account.role_code !== 'B') return reply.code(403).send({ code: 'EDIT_DENIED' });
    if (typeof request.body?.content !== 'string') return reply.code(400).send({ code: 'DOCUMENT_INPUT_INVALID' });
    const result = db.prepare('UPDATE test_documents SET content=? WHERE document_key=?').run(request.body.content, 'scenario_document');
    if (result.changes !== 1) return reply.code(404).send({ code: 'DOCUMENT_NOT_FOUND' });
    return { documentKey: 'scenario_document', content: request.body.content, saved: true };
  });
  app.get('/manage-accounts', async (request, reply) => {
    if (!session(request)) return reply.redirect('/');
    reply.code(403);
    return sendPage(reply, page('<h1 data-testid="access-denied">拒絕存取：此角色不能管理帳號</h1><a href="/">返回文件</a>'));
  });
  app.post('/api/manage-accounts', async (_request, reply) => reply.code(403).send({ code: 'MANAGEMENT_DENIED' }));
  app.addHook('onClose', async () => { sessions.clear(); digest.fill(0); db.close(); });
  return app;
}
