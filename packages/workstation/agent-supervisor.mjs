/**
 * Persistent Agent Supervisor: owns long-lived interactive CLI Agent sessions
 * (ACP protocol first, PTY interactive fallback) shared by Codex SDK native MCP
 * and human workstation interventions, backed by SQLite in WB_HOME.
 */
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import {registeredAgentWorkspaces} from './agent-workspaces.mjs';
import {publishAgentSession,subscribeLocalAgentSession,subscribeRemoteAgentSession,agentSessionEnded,endedAgentSessionStatuses,agentStreamBufferBytes} from './agent-session-stream.mjs';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { invariant, id, errorResult } from '../contracts/index.mjs';
import { appendExecutionLog, installProgressSchema } from '../git-core/progress-store.mjs';
import { negotiateProtocolVersion } from './mcp-protocol.mjs';

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const localControlUrls=new Set();
const defaultCopilotLoader = () => path.join(path.dirname(require.resolve('@github/copilot/package.json')), 'npm-loader.js');
export const AGENT_PROFILES = Object.freeze(['copilot', 'kiro', 'codex', 'claude']);

export function resolveProfileConfig(agentProfile, protocol, { effectiveDefaultCommand, effectiveDefaultArgs } = {}) {
  const resolvedProfile = agentProfile ?? 'copilot';
  invariant(
    AGENT_PROFILES.includes(resolvedProfile),
    'INVALID_AGENT_PROFILE',
    `不支援的 CLI Agent Profile：${String(resolvedProfile)}（僅支援 ${AGENT_PROFILES.join('、')}）`,
    400
  );
  if (Array.isArray(effectiveDefaultArgs)) {
    return {
      agentProfile: resolvedProfile,
      command: effectiveDefaultCommand,
      args: effectiveDefaultArgs.map(String),
    };
  }
  if (resolvedProfile === 'kiro') {
    const localKiro = path.join(os.homedir(), '.local', 'bin', 'kiro-cli');
    const kiroBin = existsSync(localKiro) ? localKiro : 'kiro-cli';
    return {
      agentProfile: 'kiro',
      command: kiroBin,
      args: protocol === 'acp' ? ['acp', '--trust-tools='] : ['chat', '--legacy-ui'],
    };
  }
  if (resolvedProfile === 'codex') {
    try {
      const codexBin = path.join(path.dirname(require.resolve('@openai/codex/package.json')), 'bin', 'codex.js');
      return { agentProfile: 'codex', command: process.execPath, args: [codexBin] };
    } catch {
      return { agentProfile: 'codex', command: 'codex', args: [] };
    }
  }
  if (resolvedProfile === 'claude') {
    const localClaude = path.join(os.homedir(), '.local', 'bin', 'claude');
    const claudeBin = existsSync(localClaude) ? localClaude : 'claude';
    return { agentProfile: 'claude', command: claudeBin, args: [] };
  }
  return {
    agentProfile: 'copilot',
    command: process.execPath,
    args: protocol === 'acp'
      ? [defaultCopilotLoader(), '--acp', '--stdio', '--no-auto-update', '--disable-builtin-mcps', '--no-custom-instructions', '--no-ask-user', '--no-bash-env', '--sync-session=off']
      : [defaultCopilotLoader(), '--no-auto-update', '--disable-builtin-mcps', '--no-custom-instructions', '--no-bash-env'],
  };
}

const SAFE_ENV_KEYS = ['HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TMPDIR', 'TEMP', 'TMP', 'SYSTEMROOT', 'COMSPEC'];
const FORBIDDEN_ENV_PATTERN = /(?:TOKEN|SECRET|KEY|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE)/i;

export function installAgentSupervisorSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_supervisor_host (
      id INTEGER PRIMARY KEY CHECK(id=1),
      pid INTEGER NOT NULL,
      control_url TEXT NOT NULL,
      control_token TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_sessions (
      session_id TEXT PRIMARY KEY,
      repository_id TEXT,
      operation_id TEXT,
      protocol TEXT NOT NULL CHECK(protocol IN ('acp','pty')),
      status TEXT NOT NULL CHECK(status IN ('IDLE','BUSY','STOPPED','FAILED')),
      agent_name TEXT NOT NULL,
      command TEXT NOT NULL,
      args_json TEXT NOT NULL,
      cwd TEXT NOT NULL,
      pid INTEGER,
      acp_session_id TEXT,
      control_url TEXT,
      control_token TEXT,
      error_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT
    );
    CREATE TABLE IF NOT EXISTS agent_session_messages (
      message_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES agent_sessions(session_id),
      actor TEXT NOT NULL CHECK(actor IN ('codex','human')),
      mode TEXT NOT NULL CHECK(mode IN ('queue','interrupt')),
      state TEXT NOT NULL CHECK(state IN ('QUEUED','DELIVERED','PROCESSED','CANCELLED','FAILED')),
      content TEXT NOT NULL,
      reply TEXT,
      stop_reason TEXT,
      error_json TEXT,
      queued_at TEXT NOT NULL,
      delivered_at TEXT,
      processed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS agent_session_messages_by_session ON agent_session_messages(session_id, queued_at);
    CREATE TABLE IF NOT EXISTS agent_session_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES agent_sessions(session_id),
      actor TEXT NOT NULL CHECK(actor IN ('codex','human','agent','system')),
      kind TEXT NOT NULL CHECK(kind IN ('message','output','progress','status','error')),
      content TEXT NOT NULL,
      meta_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS agent_session_events_by_session ON agent_session_events(session_id, seq);
  `);
}

function withDb(home, fn) {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(home, 'metadata.sqlite'));
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
  try {
    installProgressSchema(db);
    installAgentSupervisorSchema(db);
    return fn(db);
  } finally {
    db.close();
  }
}

function ensureGitGuardDir(home) {
  const guardDir = path.join(home, 'runtime', 'git-guard');
  mkdirSync(guardDir, { recursive: true, mode: 0o700 });
  const gitBin = path.join(guardDir, process.platform === 'win32' ? 'git.cmd' : 'git');
  const script = process.platform === 'win32'
    ? '@echo off\r\necho ERROR [GIT_FORBIDDEN]: Delegated CLI Agent is forbidden from running git commands directly.>&2\r\nexit /b 126\r\n'
    : '#!/bin/sh\necho "ERROR [GIT_FORBIDDEN]: Delegated CLI Agent is forbidden from running git commands outside workstation lifecycle boundaries." >&2\nexit 126\n';
  writeFileSync(gitBin, script, { mode: 0o755 });
  return guardDir;
}

function buildSanitizedAgentEnv(home, extraEnv = {}) {
  invariant(extraEnv && typeof extraEnv === 'object' && !Array.isArray(extraEnv), 'INVALID_AGENT_ENV', 'CLI Agent 環境變數格式無效');
  for (const [key, val] of Object.entries(extraEnv)) {
    invariant(typeof key === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof val === 'string', 'INVALID_AGENT_ENV', `環境變數 ${key} 格式無效`);
    invariant(!FORBIDDEN_ENV_PATTERN.test(key), 'AGENT_ENV_FORBIDDEN', `禁止傳遞敏感環境變數 ${key} 給 CLI Agent`, 403);
  }
  const env = {};
  for (const key of SAFE_ENV_KEYS) {
    if (typeof process.env[key] === 'string') env[key] = process.env[key];
  }
  const guardDir = ensureGitGuardDir(home);
  const basePath = process.env.PATH ?? '';
  env.PATH = basePath ? `${guardDir}${path.delimiter}${basePath}` : guardDir;
  env.GIT_TERMINAL_PROMPT = '0';
  env.GIT_ASKPASS = '/usr/bin/false';
  Object.assign(env, extraEnv);
  return env;
}

function validateAllowedCwd(cwd, allowedRoots) {
  invariant(typeof cwd === 'string' && path.isAbsolute(cwd), 'INVALID_AGENT_CWD', 'CLI Agent 工作目錄必須是絕對路徑');
  let resolvedCwd;
  try { resolvedCwd = realpathSync(cwd); } catch { invariant(false, 'INVALID_AGENT_CWD', `CLI Agent 工作目錄不存在：${cwd}`, 400); }
  if (!Array.isArray(allowedRoots) || !allowedRoots.length) return resolvedCwd;
  const resolvedRoots = allowedRoots.map(root => {
    try { return realpathSync(root); } catch { return path.resolve(root); }
  });
  const allowed = resolvedRoots.some(root => resolvedCwd === root || resolvedCwd.startsWith(root + path.sep));
  invariant(allowed, 'AGENT_CWD_FORBIDDEN', `CLI Agent 工作目錄超出允許範圍：${cwd}`, 403);
  return resolvedCwd;
}

function decodeSession(row) {
  if (!row) return null;
  return {
    sessionId: row.session_id,
    repositoryId: row.repository_id ?? null,
    operationId: row.operation_id ?? null,
    protocol: row.protocol,
    status: row.status,
    agentName: row.agent_name,
    command: row.command,
    args: JSON.parse(row.args_json),
    cwd: row.cwd,
    pid: row.pid ?? null,
    acpSessionId: row.acp_session_id ?? null,
    error: row.error_json ? JSON.parse(row.error_json) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at ?? null,
  };
}

function decodeMessage(row) {
  if (!row) return null;
  return {
    messageId: row.message_id,
    sessionId: row.session_id,
    actor: row.actor,
    mode: row.mode,
    state: row.state,
    content: row.content,
    reply: row.reply ?? null,
    stopReason: row.stop_reason ?? null,
    error: row.error_json ? JSON.parse(row.error_json) : null,
    queuedAt: row.queued_at,
    deliveredAt: row.delivered_at ?? null,
    processedAt: row.processed_at ?? null,
  };
}

function decodeEvent(row) {
  return {
    seq: Number(row.seq),
    sessionId: row.session_id,
    actor: row.actor,
    kind: row.kind,
    content: row.content,
    meta: row.meta_json ? JSON.parse(row.meta_json) : null,
    createdAt: row.created_at,
  };
}

function recordSessionEvent(home, sessionId, { actor, kind, content, meta, operationId }) {
  const event=withDb(home, db => {
    const now = new Date().toISOString();
    const result = db.prepare(
      'INSERT INTO agent_session_events(session_id,actor,kind,content,meta_json,created_at) VALUES(?,?,?,?,?,?)'
    ).run(sessionId, actor, kind, String(content ?? ''), meta === undefined ? null : JSON.stringify(meta), now);
    db.prepare('UPDATE agent_sessions SET updated_at=? WHERE session_id=?').run(now, sessionId);
    const parentOpId = operationId ?? db.prepare('SELECT operation_id FROM agent_sessions WHERE session_id=?').get(sessionId)?.operation_id;
    if (parentOpId && content) {
      const prefix = actor === 'human' ? `[AGENT ${sessionId} HUMAN] ` : actor === 'codex' ? `[AGENT ${sessionId} CODEX] ` : actor === 'system' ? `[AGENT ${sessionId} SYSTEM] ` : '';
      const line = prefix ? `${prefix}${content}${String(content).endsWith('\n') ? '' : '\n'}` : String(content);
      try { appendExecutionLog(db, parentOpId, line); } catch {}
    }
    return decodeEvent(db.prepare('SELECT * FROM agent_session_events WHERE seq=?').get(Number(result.lastInsertRowid)));
  });
  publishAgentSession(home,sessionId,{type:'event',event});
  return event.seq;
}

function updateSessionState(home, sessionId, fields) {
  const session=withDb(home, db => {
    const now = new Date().toISOString();
    const sets = ['updated_at=?'], values = [now];
    for (const [column, value] of Object.entries(fields)) {
      sets.push(`${column}=?`);
      values.push(value);
    }
    values.push(sessionId);
    db.prepare(`UPDATE agent_sessions SET ${sets.join(',')} WHERE session_id=?`).run(...values);
    return decodeSession(db.prepare('SELECT * FROM agent_sessions WHERE session_id=?').get(sessionId));
  });
  if(agentSessionEnded(fields.status))publishAgentSession(home,sessionId,{type:'closed',status:fields.status});
  return session;
}

function updateMessageState(home, messageId, fields) {
  return withDb(home, db => {
    const sets = [], values = [];
    for (const [column, value] of Object.entries(fields)) {
      sets.push(`${column}=?`);
      values.push(value);
    }
    values.push(messageId);
    db.prepare(`UPDATE agent_session_messages SET ${sets.join(',')} WHERE message_id=?`).run(...values);
    return decodeMessage(db.prepare('SELECT * FROM agent_session_messages WHERE message_id=?').get(messageId));
  });
}

export function readAgentSession(home, sessionId) {
  id(sessionId);
  return withDb(home, db => {
    const row = db.prepare('SELECT * FROM agent_sessions WHERE session_id=?').get(sessionId);
    invariant(row, 'AGENT_SESSION_NOT_FOUND', `找不到 CLI Agent 工作階段 ${sessionId}`, 404);
    const messages = db.prepare('SELECT * FROM agent_session_messages WHERE session_id=? ORDER BY queued_at ASC, rowid ASC').all(sessionId).map(decodeMessage);
    return { ...decodeSession(row), messages };
  });
}

export function listAgentSessions(home, { repositoryId, operationId, activeOnly=false } = {}) {
  invariant(typeof activeOnly==='boolean','INVALID_AGENT_QUERY','activeOnly must be a boolean');
  return withDb(home, db => {
    const clauses = [], params = [];
    if (repositoryId) { clauses.push('repository_id=?'); params.push(repositoryId); }
    if (operationId) { clauses.push('operation_id=?'); params.push(operationId); }
    if (activeOnly) {
      clauses.push(`status NOT IN (${endedAgentSessionStatuses.map(()=>'?').join(',')})`);
      params.push(...endedAgentSessionStatuses);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return db.prepare(`SELECT * FROM agent_sessions ${where} ORDER BY created_at DESC, rowid DESC LIMIT 100`).all(...params).map(decodeSession);
  });
}

export function readAgentSessionEvents(home, sessionId, { afterSeq = 0, limit = 200 } = {}) {
  id(sessionId);
  invariant(Number.isInteger(afterSeq) && afterSeq >= 0, 'INVALID_EVENT_SEQ', '事件游標必須是非負整數');
  invariant(Number.isInteger(limit) && limit >= 1 && limit <= 1000, 'INVALID_EVENT_LIMIT', '事件數量上限無效');
  return withDb(home, db => {
    const row = db.prepare('SELECT * FROM agent_sessions WHERE session_id=?').get(sessionId);
    invariant(row, 'AGENT_SESSION_NOT_FOUND', `找不到 CLI Agent 工作階段 ${sessionId}`, 404);
    const session = decodeSession(row);
    const events = db.prepare('SELECT * FROM agent_session_events WHERE session_id=? AND seq>? ORDER BY seq ASC LIMIT ?').all(sessionId, afterSeq, limit).map(decodeEvent);
    const messages = db.prepare('SELECT * FROM agent_session_messages WHERE session_id=? ORDER BY queued_at ASC, rowid ASC').all(sessionId).map(decodeMessage);
    const lastSeqRow = db.prepare('SELECT COALESCE(MAX(seq),0) lastSeq FROM agent_session_events WHERE session_id=?').get(sessionId);
    const lastSeq = Number(lastSeqRow?.lastSeq ?? 0);
    return {
      sessionId: session.sessionId,
      status: session.status,
      protocol: session.protocol,
      agentName: session.agentName,
      pid: session.pid,
      session,
      messages,
      events,
      lastSeq,
      nextSeq: lastSeq,
    };
  });
}

function groupExists(pid) {
  if (!pid) return false;
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (error?.code === 'EPERM') return true;
    return false;
  }
}

function terminateProcessGroup(child, graceMs = 500) {
  return new Promise(resolve => {
    if (!child) { resolve(); return; }
    const pid = child.pid;
    let settled = false, escalation = null, poll = null;
    const destroyStreams = () => {
      try { child.stdin?.destroy(); } catch {}
      try { child.stdout?.destroy(); } catch {}
      try { child.stderr?.destroy(); } catch {}
    };
    const done = () => {
      if (!settled) {
        settled = true;
        clearTimeout(escalation);
        clearTimeout(poll);
        destroyStreams();
        resolve();
      }
    };
    const signalGroup = sig => {
      if (!pid) return;
      try {
        if (process.platform !== 'win32') process.kill(-pid, sig);
        else child.kill(sig);
      } catch {}
    };
    const waitForGroup = deadline => {
      if (!groupExists(pid) || Date.now() >= deadline) { done(); return; }
      poll = setTimeout(() => waitForGroup(deadline), 25);
    };
    child.once?.('close', () => {
      if (!groupExists(pid)) done();
    });
    if (!groupExists(pid) && (child.exitCode !== null || child.signalCode !== null)) {
      done();
      return;
    }
    signalGroup('SIGTERM');
    escalation = setTimeout(() => {
      signalGroup('SIGKILL');
      destroyStreams();
      waitForGroup(Date.now() + graceMs);
    }, graceMs);
  });
}

async function createAcpDriver({ home, sessionId, operationId, command, args, cwd, env, startupTimeoutMs = 15000, onUnexpectedClose }) {
  const child = spawn(command, args, {
    cwd,
    env: { ...env, COPILOT_ALLOW_ALL: 'false', COPILOT_ASSISTED_APPROVAL: 'false' },
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buffer = Buffer.alloc(0), nextId = 0, closed = false, acpSessionId = null, activeTurn = null;
  const pending = new Map();

  const failPending = error => {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    pending.clear();
    if (activeTurn) { activeTurn.reject(error); activeTurn = null; }
  };

  child.on('error', error => {
    if (closed) return;
    closed = true;
    recordSessionEvent(home, sessionId, { actor: 'system', kind: 'error', content: error.message, operationId });
    updateSessionState(home, sessionId, { status: 'FAILED', error_json: JSON.stringify(errorResult(error)), finished_at: new Date().toISOString(), control_url: null, control_token: null });
    failPending(error);
    onUnexpectedClose?.(error);
  });
  child.once('close', (code, signal) => {
    if (!closed) {
      closed = true;
      const err = new Error(`CLI Agent ACP 程序異常結束（exit ${code ?? signal}）`);
      err.code = 'AGENT_PROCESS_EXITED';
      recordSessionEvent(home, sessionId, { actor: 'system', kind: 'error', content: err.message, operationId });
      updateSessionState(home, sessionId, { status: 'FAILED', error_json: JSON.stringify(errorResult(err)), finished_at: new Date().toISOString(), control_url: null, control_token: null });
      failPending(err);
      onUnexpectedClose?.(err);
    }
  });
  child.stderr.on('data', chunk => {
    const text = String(chunk);
    if (text.trim()) recordSessionEvent(home, sessionId, { actor: 'agent', kind: 'progress', content: text, operationId });
  });
  child.stdout.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const idx = buffer.indexOf('\n');
      if (idx < 0) return;
      const line = buffer.subarray(0, idx).toString('utf8');
      buffer = buffer.subarray(idx + 1);
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.method === 'session/update') {
        const update = msg.params?.update;
        if (update?.sessionUpdate === 'agent_message_chunk' && typeof update.content?.text === 'string') {
          if (activeTurn) activeTurn.chunks.push(update.content.text);
          recordSessionEvent(home, sessionId, { actor: 'agent', kind: 'output', content: update.content.text, operationId });
        } else if (update?.sessionUpdate === 'tool_call' || update?.sessionUpdate === 'tool_call_update') {
          const summary = `${update.sessionUpdate}: ${update.title ?? update.toolCallId ?? ''} (${update.status ?? 'running'})`;
          recordSessionEvent(home, sessionId, { actor: 'agent', kind: 'progress', content: summary, meta: update, operationId });
        }
        continue;
      }
      if (msg.method && msg.id !== undefined) {
        if (msg.method === 'session/request_permission') {
          const option = msg.params?.options?.find(o => o.kind?.startsWith('allow')) ?? msg.params?.options?.[0];
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { outcome: option ? { outcome: 'selected', optionId: option.optionId } : { outcome: 'cancelled' } } }) + '\n');
        } else {
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Unsupported client method' } }) + '\n');
        }
        continue;
      }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const entry = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(entry.timer);
        if (msg.error) entry.reject(new Error(msg.error.message ?? 'ACP RPC error'));
        else entry.resolve(msg.result);
      }
    }
  });

  const rpc = (method, params = {}, timeoutMs = 60000) => new Promise((resolve, reject) => {
    if (closed) { reject(new Error('CLI Agent 工作階段已關閉')); return; }
    const reqId = ++nextId;
    const timer = setTimeout(() => { pending.delete(reqId); reject(new Error(`ACP ${method} 逾時`)); }, timeoutMs);
    pending.set(reqId, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: reqId, method, params }) + '\n');
  });
  const notify = (method, params = {}) => {
    if (!closed) child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  };

  const initResult = await rpc('initialize', {
    protocolVersion: 1,
    clientInfo: { name: 'bdd-agent-supervisor', version: '1.0.0' },
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
  }, startupTimeoutMs);
  const created = await rpc('session/new', { cwd, mcpServers: [] }, startupTimeoutMs);
  acpSessionId = created.sessionId;

  return {
    pid: child.pid,
    acpSessionId,
    capabilities: initResult?.agentCapabilities ?? {},
    async sendTurn(message, timeoutMs = 60000) {
      const turn = { chunks: [], reject: null };
      activeTurn = turn;
      try {
        const response = await new Promise((resolve, reject) => {
          turn.reject = reject;
          rpc('session/prompt', { sessionId: acpSessionId, prompt: [{ type: 'text', text: message }] }, timeoutMs).then(resolve, reject);
        });
        return { reply: turn.chunks.join(''), stopReason: response?.stopReason ?? 'end_turn' };
      } finally {
        if (activeTurn === turn) activeTurn = null;
      }
    },
    async cancelTurn() {
      if (acpSessionId) notify('session/cancel', { sessionId: acpSessionId });
    },
    async stop() {
      if (closed) return;
      closed = true;
      try {
        if (acpSessionId && initResult?.agentCapabilities?.sessionCapabilities?.close) {
          await rpc('session/close', { sessionId: acpSessionId }, 1500).catch(() => {});
        }
      } finally {
        await terminateProcessGroup(child);
      }
    },
  };
}

async function createPtyDriver({ home, sessionId, operationId, command, args, cwd, env, settleMs = 120, onUnexpectedClose }) {
  const socket = `bdd-${randomUUID()}`;
  const tmux = (...arguments_) => execFileAsync('tmux', ['-L', socket, ...arguments_], { env });
  // A separate tmux server gives this session its own lifetime and socket.
  await tmux('new-session', '-d', '-s', sessionId, '-c', cwd, '--', command, ...args);
  let child;
  try {
    const {stdout} = await tmux('display-message', '-p', '-t', sessionId, '#{pane_pid}');
    const pid = Number(stdout.trim());
    invariant(Number.isSafeInteger(pid) && pid > 0, 'AGENT_START_FAILED', 'tmux did not provide a valid pane process ID', 500);
    child = require('node-pty').spawn('tmux', ['-L', socket, 'attach-session', '-t', sessionId], {
      cwd, env: { ...env, TERM: 'xterm-256color' }, name: 'xterm-256color', cols: 120, rows: 40,
    });
    child.agentPid = pid;
  } catch (error) {
    await tmux('kill-session', '-t', sessionId).catch(() => {});
    throw error;
  }
  let closed = false, activeCollector = null, disposal = null;
  const attachmentExit=new Promise(resolve=>child.onExit(resolve));
  const reapPane = async () => {
    await terminateProcessGroup({pid: child.agentPid});
    invariant(!groupExists(child.agentPid), 'AGENT_STOP_FAILED', 'CLI Agent process group is still running', 500);
    // The pane group is gone before tmux is released. A natural pane exit
    // already shuts down the per-session server; no kill is needed then.
    try { await tmux('has-session', '-t', sessionId); }
    catch (error) { if(error.code===1)return;throw error; }
    await tmux('kill-session', '-t', sessionId);
  };
  const outputSubscription=child.onData(text => {
    if (closed||!text) return;
    recordSessionEvent(home, sessionId, { actor: 'agent', kind: 'output', content: text, operationId });
    if (activeCollector) activeCollector.onChunk(text);
  });
  child.onExit(({exitCode}) => {
    outputSubscription.dispose();
    if (!closed) {
      closed = true;
      disposal=(async()=>{
      const err = new Error(`CLI Agent tmux 工作階段已結束（exit ${exitCode}）`);
      err.code = 'AGENT_PROCESS_EXITED';
      if (activeCollector) activeCollector.reject(err);
      try {
        await reapPane();
        updateSessionState(home, sessionId, { status: 'FAILED', error_json: JSON.stringify(errorResult(err)), finished_at: new Date().toISOString(), control_url: null, control_token: null });
        onUnexpectedClose?.(err);
      } catch (error) {
        // Keep the owner/control channel so a failed cleanup remains retryable.
        closed=false;
        updateSessionState(home, sessionId, {status:'FAILED',error_json:JSON.stringify(errorResult(error))});
        onUnexpectedClose?.(error,false);
      }
      })();
    }
  });

  return {
    pid: child.agentPid,
    acpSessionId: null,
    writeInput(data) {
      invariant(!closed, 'AGENT_SESSION_CLOSED', 'CLI Agent 工作階段已結束', 409);
      child.write(data);
    },
    async sendTurn(message, timeoutMs = 10000) {
      if (closed) throw new Error('CLI Agent PTY 工作階段已關閉');
      return new Promise((resolve, reject) => {
        const chunks = [];
        let quietTimer = null;
        const maxTimer = setTimeout(() => finish('timeout'), timeoutMs);
        function finish(stopReason) {
          clearTimeout(quietTimer);
          clearTimeout(maxTimer);
          if (activeCollector === collector) activeCollector = null;
          resolve({ reply: chunks.join(''), stopReason });
        }
        const collector = {
          onChunk(text) {
            chunks.push(text);
            clearTimeout(quietTimer);
            quietTimer = setTimeout(() => finish('end_turn'), settleMs);
          },
          finish,
          reject(err) {
            clearTimeout(quietTimer);
            clearTimeout(maxTimer);
            if (activeCollector === collector) activeCollector = null;
            reject(err);
          },
        };
        activeCollector = collector;
        child.write(message.endsWith('\n') ? message : message + '\n');
      });
    },
    async cancelTurn() {
      if (closed) return;
      child.write('\x03');
      if (activeCollector) activeCollector.finish('cancelled');
    },
    async stop() {
      if(disposal)await disposal;
      if (closed) return;
      closed = true;
      outputSubscription.dispose();
      if (activeCollector) activeCollector.finish('stopped');
      disposal=(async()=>{
        try { await reapPane();child.kill();await attachmentExit; }
        catch(error){closed=false;disposal=null;throw error;}
      })();
      await disposal;
    },
  };
}

async function forwardControlRequest(url, token, action, payload) {
  const response = await fetch(`${url}/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!response.ok) {
    const err = new Error(body?.message ?? `Agent Supervisor control error (${response.status})`);
    err.code = body?.code ?? 'AGENT_SUPERVISOR_ERROR';
    err.statusCode = response.status;
    throw err;
  }
  return body;
}

async function probeHostSupervisor(row) {
  if (!row?.control_url || !row?.control_token || row.pid === process.pid) return false;
  try {
    const res = await fetch(`${row.control_url}/health`, {
      method: 'GET',
      headers: { authorization: `Bearer ${row.control_token}` },
      signal: AbortSignal.timeout(300),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function createAgentSupervisor({
  home,
  defaultRepositoryId = null,
  defaultOperationId = null,
  defaultCwd = null,
  allowedRoots = null,
  defaultCommand = null,
  defaultArgs = null,
} = {}) {
  invariant(typeof home === 'string' && path.isAbsolute(home), 'INVALID_SUPERVISOR_HOME', 'Agent Supervisor 需要絕對 WB_HOME 路徑');
  withDb(home, () => {});

  const envAllowedRoots = process.env.WB_AGENT_SUPERVISOR_ALLOWED_ROOTS_JSON
    ? JSON.parse(process.env.WB_AGENT_SUPERVISOR_ALLOWED_ROOTS_JSON)
    : null;
  const effectiveAllowedRoots = allowedRoots ?? envAllowedRoots ?? (defaultCwd ? [defaultCwd] : null);
  const effectiveDefaultCwd = defaultCwd ?? process.env.WB_AGENT_SUPERVISOR_CWD ?? effectiveAllowedRoots?.[0] ?? process.cwd();
  const effectiveDefaultCommand = defaultCommand ?? process.env.WB_AGENT_SUPERVISOR_COMMAND ?? process.execPath;
  const effectiveDefaultArgs = defaultArgs ?? (process.env.WB_AGENT_SUPERVISOR_ARGS_JSON ? JSON.parse(process.env.WB_AGENT_SUPERVISOR_ARGS_JSON) : null);

  const liveSessions = new Map();
  const explicitWorkspacePolicy=allowedRoots!==null||envAllowedRoots!==null;
  async function resolveWorkspace(input){
    if(explicitWorkspacePolicy)return {cwd:validateAllowedCwd(input.cwd??effectiveDefaultCwd,effectiveAllowedRoots)};
    const catalog=await registeredAgentWorkspaces(home);
    if(!catalog.projectCount){
      invariant(input.projectId===undefined,'AGENT_PROJECT_NOT_FOUND','沒有已登錄的產品專案',404);
      return {cwd:validateAllowedCwd(input.cwd??effectiveDefaultCwd,effectiveAllowedRoots)};
    }
    if(input.repositoryId!==undefined)id(input.repositoryId);
    if(input.projectId!==undefined)id(input.projectId);
    const candidates=catalog.workspaces.filter(item=>(input.repositoryId===undefined||item.repositoryId===input.repositoryId)&&(input.projectId===undefined||item.projectId===input.projectId));
    invariant(candidates.length,'AGENT_PROJECT_NOT_FOUND','找不到已初始化的已登錄產品專案',404);
    invariant(input.cwd!==undefined||candidates.length===1,'AGENT_PROJECT_REQUIRED','請以 agent_workspaces 查詢並指定產品專案或工作目錄',400);
    const cwd=validateAllowedCwd(input.cwd??candidates[0].cwd,candidates.map(item=>item.cwd));
    return {...candidates.find(item=>cwd===item.cwd||cwd.startsWith(item.cwd+path.sep)),cwd};
  }
  const controlToken = randomUUID();

  const failQueuedMessages = (entry, error) => {
    const now = new Date().toISOString();
    for (const item of entry.queue.splice(0)) {
      updateMessageState(home, item.messageId, {
        state: 'FAILED',
        error_json: JSON.stringify(errorResult(error)),
        processed_at: now,
      });
      item.reject(error);
    }
  };

  const executeLocalSend = async (entry, { message, messageId, actor = 'codex', interrupt = false, mode, wait = true, timeoutMs = 60000 }) => {
    invariant(typeof message === 'string' && message.trim(), 'INVALID_AGENT_MESSAGE', 'CLI Agent 指令不可為空');
    invariant(['codex', 'human'].includes(actor), 'INVALID_AGENT_ACTOR', '參與者身分必須是 codex 或 human');
    const resolvedMode = mode ?? (interrupt === true ? 'interrupt' : 'queue');
    invariant(['queue', 'interrupt'].includes(resolvedMode), 'INVALID_AGENT_INTERRUPT_MODE', '中斷模式僅支援 queue 或 interrupt');
    const resolvedMessageId = messageId ? id(messageId) : `MSG-${randomUUID().replaceAll('-', '').slice(0, 12)}`;

    // Idempotency check for reconnect / retry with the same messageId
    const existing = withDb(home, db => db.prepare('SELECT * FROM agent_session_messages WHERE message_id=?').get(resolvedMessageId));
    if (existing) {
      invariant(existing.session_id === entry.sessionId && existing.actor === actor && existing.content === message, 'DUPLICATE_MESSAGE_ID', `訊息識別 ${resolvedMessageId} 已存在且內容不一致`, 409);
      const snapshot = readAgentSessionEvents(home, entry.sessionId, { afterSeq: 0 });
      return {
        sessionId: entry.sessionId,
        messageId: resolvedMessageId,
        status: entry.status,
        messageState: existing.state,
        delivered: existing.state === 'DELIVERED' || existing.state === 'PROCESSED',
        processed: existing.state === 'PROCESSED',
        deduplicated: true,
        actor,
        reply: existing.reply ?? undefined,
        stopReason: existing.stop_reason ?? undefined,
        events: snapshot.events,
        lastSeq: snapshot.lastSeq,
      };
    }

    invariant(entry.status !== 'STOPPED' && entry.status !== 'FAILED', 'AGENT_SESSION_CLOSED', `CLI Agent 工作階段 ${entry.sessionId} 已結束`, 409);

    const now = new Date().toISOString();
    withDb(home, db => {
      db.prepare(
        `INSERT INTO agent_session_messages(
          message_id,session_id,actor,mode,state,content,reply,stop_reason,error_json,queued_at,delivered_at,processed_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(resolvedMessageId, entry.sessionId, actor, resolvedMode, 'QUEUED', message, null, null, null, now, null, null);
    });

    const messageSeq = recordSessionEvent(home, entry.sessionId, {
      actor,
      kind: 'message',
      content: message,
      meta: { messageId: resolvedMessageId, mode: resolvedMode, state: 'QUEUED' },
      operationId: entry.operationId,
    });

    let resolveTurn, rejectTurn;
    const completion = new Promise((resolve, reject) => { resolveTurn = resolve; rejectTurn = reject; });
    completion.catch(() => {});
    const item = { messageId: resolvedMessageId, message, actor, mode: resolvedMode, timeoutMs, messageSeq, resolve: resolveTurn, reject: rejectTurn };

    // Human messages always queue ahead of pending Codex messages; active turn is cancelled ONLY when mode === 'interrupt'.
    if (actor === 'human') {
      const firstCodexIdx = entry.queue.findIndex(q => q.actor !== 'human');
      if (firstCodexIdx >= 0) entry.queue.splice(firstCodexIdx, 0, item);
      else entry.queue.push(item);
      if (entry.busy && resolvedMode === 'interrupt') {
        recordSessionEvent(home, entry.sessionId, {
          actor: 'system',
          kind: 'status',
          content: 'Human intervention requested active turn cancellation (mode=interrupt)',
          meta: { messageId: resolvedMessageId, mode: 'interrupt' },
          operationId: entry.operationId,
        });
        await entry.driver.cancelTurn();
      }
    } else {
      entry.queue.push(item);
    }

    const pump = async () => {
      if (entry.pumping) return;
      entry.pumping = true;
      try {
        while (entry.queue.length && entry.status !== 'STOPPED' && entry.status !== 'FAILED') {
          const current = entry.queue.shift();
          entry.busy = true;
          entry.status = 'BUSY';
          updateSessionState(home, entry.sessionId, { status: 'BUSY' });
          updateMessageState(home, current.messageId, { state: 'DELIVERED', delivered_at: new Date().toISOString() });
          recordSessionEvent(home, entry.sessionId, {
            actor: 'system',
            kind: 'status',
            content: `Message ${current.messageId} delivered to CLI Agent`,
            meta: { messageId: current.messageId, state: 'DELIVERED', actor: current.actor },
            operationId: entry.operationId,
          });
          try {
            const outcome = await entry.driver.sendTurn(current.message, current.timeoutMs);
            entry.busy = false;
            if (entry.status !== 'STOPPED' && entry.status !== 'FAILED') {
              entry.status = 'IDLE';
              updateSessionState(home, entry.sessionId, { status: 'IDLE' });
            }
            const finalState = outcome.stopReason === 'cancelled' ? 'CANCELLED' : entry.protocol === 'pty' ? 'DELIVERED' : 'PROCESSED';
            updateMessageState(home, current.messageId, {
              state: finalState,
              reply: outcome.reply,
              stop_reason: outcome.stopReason,
              processed_at: finalState === 'DELIVERED' ? null : new Date().toISOString(),
            });
            recordSessionEvent(home, entry.sessionId, {
              actor: 'system',
              kind: 'status',
              content: `Turn completed (${outcome.stopReason})`,
              meta: { messageId: current.messageId, state: finalState, stopReason: outcome.stopReason, actor: current.actor },
              operationId: entry.operationId,
            });
            const snapshot = readAgentSessionEvents(home, entry.sessionId, { afterSeq: current.messageSeq });
            current.resolve({
              sessionId: entry.sessionId,
              messageId: current.messageId,
              status: entry.status,
              messageState: finalState,
              delivered: true,
              processed: finalState === 'PROCESSED',
              actor: current.actor,
              reply: outcome.reply,
              stopReason: outcome.stopReason,
              events: snapshot.events,
              lastSeq: snapshot.lastSeq,
            });
          } catch (error) {
            entry.busy = false;
            updateMessageState(home, current.messageId, {
              state: 'FAILED',
              error_json: JSON.stringify(errorResult(error)),
              processed_at: new Date().toISOString(),
            });
            if (entry.status !== 'STOPPED' && entry.status !== 'FAILED') {
              entry.status = 'IDLE';
              updateSessionState(home, entry.sessionId, { status: 'IDLE' });
            }
            current.reject(error);
          }
        }
      } finally {
        entry.pumping = false;
      }
    };

    void pump();
    if (wait === false) {
      const msgRow = withDb(home, db => db.prepare('SELECT * FROM agent_session_messages WHERE message_id=?').get(resolvedMessageId));
      const snapshot = readAgentSessionEvents(home, entry.sessionId, { afterSeq: messageSeq - 1 });
      return {
        sessionId: entry.sessionId,
        messageId: resolvedMessageId,
        status: entry.status,
        messageState: msgRow?.state ?? 'QUEUED',
        queued: true,
        delivered: msgRow?.state === 'DELIVERED' || msgRow?.state === 'PROCESSED',
        processed: msgRow?.state === 'PROCESSED',
        actor,
        events: snapshot.events,
        lastSeq: snapshot.lastSeq,
      };
    }
    return completion;
  };

  const executeLocalCancel = async (entry, { actor = 'codex' } = {}) => {
    if (entry.protocol==='pty'||entry.busy) await entry.driver.cancelTurn();
    if (entry.status !== 'STOPPED' && entry.status !== 'FAILED') {
      entry.status = 'IDLE';
      updateSessionState(home, entry.sessionId, { status: 'IDLE' });
    }
    const seq = recordSessionEvent(home, entry.sessionId, {
      actor: actor === 'human' ? 'human' : 'system',
      kind: 'status',
      content: `Turn cancelled by ${actor}; session remains open`,
      operationId: entry.operationId,
    });
    return { sessionId: entry.sessionId, status: entry.status, cancelled: true, lastSeq: seq };
  };

  const executeTerminalInput = (entry, data) => {
    invariant(entry.protocol === 'pty', 'AGENT_TERMINAL_UNAVAILABLE', '只有 PTY 工作階段支援終端輸入', 409);
    invariant(entry.status !== 'STOPPED' && entry.status !== 'FAILED', 'AGENT_SESSION_CLOSED', 'CLI Agent 工作階段已結束', 409);
    invariant(typeof data === 'string' && data.length > 0 && Buffer.byteLength(data) <= 65536, 'INVALID_TERMINAL_INPUT', '終端輸入無效', 400);
    entry.driver.writeInput(data);
    return {sessionId: entry.sessionId, accepted: true};
  };

  const executeLocalStop = async (entry, { actor = 'codex' } = {}) => {
    const stopErr = new Error(`CLI Agent 工作階段 ${entry.sessionId} 已停止`);
    stopErr.code = 'AGENT_SESSION_STOPPED';
    await entry.driver.stop();
    entry.status = 'STOPPED';
    failQueuedMessages(entry, stopErr);
    liveSessions.delete(entry.sessionId);
    const seq = recordSessionEvent(home, entry.sessionId, {
      actor: actor === 'human' ? 'human' : 'system',
      kind: 'status',
      content: `Session stopped by ${actor}`,
      operationId: entry.operationId,
    });
    updateSessionState(home, entry.sessionId, {
      status: 'STOPPED',
      finished_at: new Date().toISOString(),
      control_url: null,
      control_token: null,
    });
    return { sessionId: entry.sessionId, status: 'STOPPED', stopped: true, lastSeq: seq };
  };

  const startLocalSession = async ({
    protocol = 'acp',
    agentProfile,
    agentName,
    title,
    command,
    args,
    cwd,
    env = {},
    task,
    prompt,
    wait = false,
    timeoutMs = 60000,
    settleMs = 120,
    repositoryId = defaultRepositoryId,
    operationId = defaultOperationId,
    fromMcp = false,
  } = {}) => {
    invariant(['acp', 'pty'].includes(protocol), 'INVALID_AGENT_PROTOCOL', 'CLI Agent 協定僅支援 acp 或 pty');
    if (fromMcp) {
      invariant(command === undefined && args === undefined && (!env || Object.keys(env).length === 0), 'AGENT_COMMAND_FORBIDDEN', 'MCP 工具不得直接指定任意執行檔、參數或環境變數', 403);
    }
    const profileConfig = resolveProfileConfig(agentProfile, protocol, { effectiveDefaultCommand, effectiveDefaultArgs });
    // Public starts validate project scope first. Authenticated proxies may
    // also forward a worktree already validated by their task capability.
    const resolvedCwd = validateAllowedCwd(cwd ?? effectiveDefaultCwd, explicitWorkspacePolicy?effectiveAllowedRoots:null);
    const sanitizedEnv = buildSanitizedAgentEnv(home, env);
    const resolvedAgentName = agentName || title || `${profileConfig.agentProfile}-agent`;
    const initialMessage = typeof task === 'string' && task.trim() ? task : typeof prompt === 'string' && prompt.trim() ? prompt : undefined;
    const resolvedCommand = command ?? profileConfig.command;
    invariant(
      resolvedCommand === process.execPath || resolvedCommand === effectiveDefaultCommand || resolvedCommand === profileConfig.command,
      'AGENT_COMMAND_FORBIDDEN',
      `不允許啟動未授權的 CLI Agent 執行檔：${String(resolvedCommand)}`,
      403
    );
    const resolvedArgs = Array.isArray(args)
      ? args.map(String)
      : profileConfig.args;
    const sessionId = `AGT-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const now = new Date().toISOString();

    withDb(home, db => {
      db.prepare(
        `INSERT INTO agent_sessions(
          session_id,repository_id,operation_id,protocol,status,agent_name,command,args_json,cwd,
          pid,acp_session_id,control_url,control_token,error_json,created_at,updated_at,finished_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        sessionId, repositoryId ?? null, operationId ?? null, protocol, 'IDLE', resolvedAgentName,
        resolvedCommand, JSON.stringify(resolvedArgs), resolvedCwd, null, null, controlUrl, controlToken, null, now, now, null
      );
    });

    const entry = { sessionId, repositoryId, operationId, protocol, agentName: resolvedAgentName, driver: null, status: 'IDLE', busy: false, pumping: false, queue: [] };
    const onUnexpectedClose = (err,reaped=true) => {
      entry.status = 'FAILED';
      entry.busy = false;
      failQueuedMessages(entry, err);
      if(reaped)liveSessions.delete(sessionId);
    };

    let driver;
    try {
      driver = protocol === 'acp'
        ? await createAcpDriver({ home, sessionId, operationId, command: resolvedCommand, args: resolvedArgs, cwd: resolvedCwd, env: sanitizedEnv, onUnexpectedClose })
        : await createPtyDriver({ home, sessionId, operationId, command: resolvedCommand, args: resolvedArgs, cwd: resolvedCwd, env: sanitizedEnv, settleMs, onUnexpectedClose });
    } catch (error) {
      updateSessionState(home, sessionId, {
        status: 'FAILED',
        error_json: JSON.stringify(errorResult(error)),
        finished_at: new Date().toISOString(),
        control_url: null,
        control_token: null,
      });
      throw error;
    }

    entry.driver = driver;
    liveSessions.set(sessionId, entry);
    updateSessionState(home, sessionId, { pid: driver.pid ?? null, acp_session_id: driver.acpSessionId ?? null });
    const seq = recordSessionEvent(home, sessionId, {
      actor: 'system',
      kind: 'status',
      content: `Started ${protocol.toUpperCase()} CLI Agent session (${resolvedAgentName})`,
      operationId,
    });

    if (initialMessage) {
      const sent = await executeLocalSend(entry, { message: initialMessage, actor: 'codex', wait, timeoutMs });
      return {
        sessionId,
        protocol,
        agentProfile: profileConfig.agentProfile,
        agentName: resolvedAgentName,
        cwd: resolvedCwd,
        pid: driver.pid ?? null,
        ...sent,
      };
    }

    return {
      sessionId,
      status: 'IDLE',
      protocol,
      agentProfile: profileConfig.agentProfile,
      agentName: resolvedAgentName,
      cwd: resolvedCwd,
      pid: driver.pid ?? null,
      events: readAgentSessionEvents(home, sessionId, { afterSeq: 0 }).events,
      lastSeq: seq,
    };
  };

  const server = http.createServer(async (req, res) => {
    try {
      if (req.headers.authorization !== `Bearer ${controlToken}`) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code: 'UNAUTHORIZED', message: 'Invalid supervisor control token' }));
        return;
      }
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, pid: process.pid }));
        return;
      }
      const url=new URL(req.url,'http://supervisor.invalid');
      if(req.method==='GET'&&url.pathname==='/events'){
        const sessionId=id(url.searchParams.get('sessionId')),afterSeq=Number(url.searchParams.get('afterSeq')??0);
        invariant(Number.isSafeInteger(afterSeq)&&afterSeq>=0,'INVALID_EVENT_SEQ','Invalid event cursor');
        readAgentSession(home,sessionId);
        res.writeHead(200,{'content-type':'application/x-ndjson','cache-control':'no-store'});
        let dispose,ended=false;
        res.once('close',()=>{ended=true;dispose?.();});
        dispose=subscribeLocalAgentSession(home,sessionId,afterSeq,cursor=>readAgentSessionEvents(home,sessionId,{afterSeq:cursor,limit:200}),message=>{
          if(ended)return;
          invariant(res.writableLength<=agentStreamBufferBytes,'AGENT_STREAM_OVERFLOW','CLI Agent stream client is too slow');
          res.write(JSON.stringify(message)+'\n');
          if(message.type==='closed')res.end();
        },error=>res.destroy(error));
        if(ended)dispose();
        res.flushHeaders();return;
      }
      let raw = '';
      for await (const chunk of req) raw += String(chunk);
      const body = raw ? JSON.parse(raw) : {};
      let result;
      if (req.url === '/start') {
        result = await startLocalSession(body);
      } else {
        const entry = liveSessions.get(body.sessionId);
        invariant(entry, 'AGENT_SESSION_NOT_LIVE', `CLI Agent 工作階段 ${body.sessionId} 不在此程序執行中`, 404);
        if (req.url === '/send') result = await executeLocalSend(entry, body);
        else if (req.url === '/terminal-input') result = executeTerminalInput(entry, body.data);
        else if (req.url === '/cancel') result = await executeLocalCancel(entry, body);
        else if (req.url === '/stop') result = await executeLocalStop(entry, body);
        else invariant(false, 'NOT_FOUND', 'Unknown supervisor control action', 404);
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (error) {
      if(res.headersSent){res.destroy(error);return;}
      res.writeHead(Number(error.statusCode) || 500, { 'content-type': 'application/json' });
      res.end(JSON.stringify(errorResult(error)));
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  server.unref();
  const address = server.address();
  const controlUrl = `http://127.0.0.1:${address.port}`;
  localControlUrls.add(controlUrl);

  // Register as the primary host supervisor in WB_HOME if none is active
  const existingHost = withDb(home, db => db.prepare('SELECT * FROM agent_supervisor_host WHERE id=1').get());
  if (!(await probeHostSupervisor(existingHost))) {
    withDb(home, db => {
      db.prepare('INSERT OR REPLACE INTO agent_supervisor_host(id,pid,control_url,control_token,updated_at) VALUES(1,?,?,?,?)')
        .run(process.pid, controlUrl, controlToken, new Date().toISOString());
    });
  }

  return {
    controlUrl,
    async start(options = {}) {
      const protocol = options.protocol ?? 'acp';
      invariant(['acp', 'pty'].includes(protocol), 'INVALID_AGENT_PROTOCOL', 'CLI Agent 協定僅支援 acp 或 pty');
      if (options.fromMcp) {
        invariant(options.command === undefined && options.args === undefined && (!options.env || Object.keys(options.env).length === 0), 'AGENT_COMMAND_FORBIDDEN', 'MCP 工具不得直接指定任意執行檔、參數或環境變數', 403);
      }
      const profileConfig = resolveProfileConfig(options.agentProfile, protocol, { effectiveDefaultCommand, effectiveDefaultArgs });
      const workspace=await resolveWorkspace(options),resolvedCwd=workspace.cwd;
      const resolvedCommand = options.command ?? profileConfig.command;
      invariant(
        resolvedCommand === process.execPath || resolvedCommand === effectiveDefaultCommand || resolvedCommand === profileConfig.command,
        'AGENT_COMMAND_FORBIDDEN',
        `不允許啟動未授權的 CLI Agent 執行檔：${String(resolvedCommand)}`,
        403
      );
      const resolvedArgs = Array.isArray(options.args)
        ? options.args.map(String)
        : profileConfig.args;
      const hostRow = withDb(home, db => db.prepare('SELECT * FROM agent_supervisor_host WHERE id=1').get());
      if (hostRow && hostRow.pid !== process.pid && await probeHostSupervisor(hostRow)) {
        return forwardControlRequest(hostRow.control_url, hostRow.control_token, 'start', {
          ...options,
          agentProfile: profileConfig.agentProfile,
          fromMcp: false,
          command: resolvedCommand,
          args: resolvedArgs,
          cwd: resolvedCwd,
          repositoryId: options.repositoryId ?? workspace.repositoryId ?? defaultRepositoryId,
          operationId: options.operationId ?? defaultOperationId,
        });
      }
      return startLocalSession({
        ...options,
        agentProfile: profileConfig.agentProfile,
        fromMcp: false,
        command: resolvedCommand,
        args: resolvedArgs,
        cwd: resolvedCwd,
        repositoryId: options.repositoryId ?? workspace.repositoryId ?? defaultRepositoryId,
        operationId: options.operationId ?? defaultOperationId,
      });
    },

    async workspaces(){
      const catalog=await registeredAgentWorkspaces(home);
      return catalog.workspaces.filter(item=>{try{validateAllowedCwd(item.cwd,explicitWorkspacePolicy?effectiveAllowedRoots:null);return true;}catch(error){if(error.code==='AGENT_CWD_FORBIDDEN')return false;throw error;}});
    },

    async subscribe(sessionId,{afterSeq=0,onMessage,onError,signal}){
      signal?.throwIfAborted();
      id(sessionId);invariant(Number.isSafeInteger(afterSeq)&&afterSeq>=0,'INVALID_EVENT_SEQ','Invalid event cursor');
      const row=withDb(home,db=>db.prepare('SELECT * FROM agent_sessions WHERE session_id=?').get(sessionId));
      invariant(row,'AGENT_SESSION_NOT_FOUND','CLI Agent session not found',404);
      if(agentSessionEnded(row.status)||localControlUrls.has(row.control_url))return subscribeLocalAgentSession(home,sessionId,afterSeq,cursor=>readAgentSessionEvents(home,sessionId,{afterSeq:cursor,limit:200}),onMessage,onError);
      invariant(row.control_url&&row.control_token,'AGENT_STREAM_UNAVAILABLE','CLI Agent control channel is unavailable',409);
      return subscribeRemoteAgentSession(row,sessionId,afterSeq,onMessage,onError,signal);
    },

    async terminalInput(sessionId, data) {
      id(sessionId);
      const local = liveSessions.get(sessionId);
      if (local) return executeTerminalInput(local, data);
      const row = withDb(home, db => db.prepare('SELECT * FROM agent_sessions WHERE session_id=?').get(sessionId));
      invariant(row, 'AGENT_SESSION_NOT_FOUND', `找不到 CLI Agent 工作階段 ${sessionId}`, 404);
      invariant(row.control_url && row.control_token && row.status !== 'STOPPED' && row.status !== 'FAILED', 'AGENT_SESSION_CLOSED', `CLI Agent 工作階段 ${sessionId} 已結束`, 409);
      return forwardControlRequest(row.control_url, row.control_token, 'terminal-input', {sessionId, data});
    },

    async send(sessionId, { message, messageId, actor = 'codex', interrupt = false, mode, wait = true, timeoutMs = 60000 } = {}) {
      id(sessionId);
      const local = liveSessions.get(sessionId);
      if (local) return executeLocalSend(local, { message, messageId, actor, interrupt, mode, wait, timeoutMs });
      const row = withDb(home, db => db.prepare('SELECT * FROM agent_sessions WHERE session_id=?').get(sessionId));
      invariant(row, 'AGENT_SESSION_NOT_FOUND', `找不到 CLI Agent 工作階段 ${sessionId}`, 404);
      if (messageId) {
        const existing = withDb(home, db => db.prepare('SELECT * FROM agent_session_messages WHERE message_id=?').get(id(messageId)));
        if (existing) {
          invariant(existing.session_id === sessionId && existing.actor === actor && existing.content === message, 'DUPLICATE_MESSAGE_ID', `訊息識別 ${messageId} 已存在且內容不一致`, 409);
          const snapshot = readAgentSessionEvents(home, sessionId, { afterSeq: 0 });
          return {
            sessionId,
            messageId,
            status: row.status,
            messageState: existing.state,
            delivered: existing.state === 'DELIVERED' || existing.state === 'PROCESSED',
            processed: existing.state === 'PROCESSED',
            deduplicated: true,
            actor,
            reply: existing.reply ?? undefined,
            stopReason: existing.stop_reason ?? undefined,
            events: snapshot.events,
            lastSeq: snapshot.lastSeq,
          };
        }
      }
      invariant(row.control_url && row.control_token && row.status !== 'STOPPED' && row.status !== 'FAILED', 'AGENT_SESSION_CLOSED', `CLI Agent 工作階段 ${sessionId} 已結束`, 409);
      return forwardControlRequest(row.control_url, row.control_token, 'send', { sessionId, message, messageId, actor, interrupt, mode, wait, timeoutMs });
    },

    events(sessionId, options = {}) {
      return readAgentSessionEvents(home, sessionId, options);
    },

    session(sessionId) {
      return readAgentSession(home, sessionId);
    },

    list(options = {}) {
      return listAgentSessions(home, {
        repositoryId: options.repositoryId ?? defaultRepositoryId,
        operationId: options.operationId ?? defaultOperationId,
      });
    },

    async cancel(sessionId, { actor = 'codex' } = {}) {
      id(sessionId);
      const local = liveSessions.get(sessionId);
      if (local) return executeLocalCancel(local, { actor });
      const row = withDb(home, db => db.prepare('SELECT * FROM agent_sessions WHERE session_id=?').get(sessionId));
      invariant(row, 'AGENT_SESSION_NOT_FOUND', `找不到 CLI Agent 工作階段 ${sessionId}`, 404);
      invariant(row.control_url && row.control_token && row.status !== 'STOPPED' && row.status !== 'FAILED', 'AGENT_SESSION_CLOSED', `CLI Agent 工作階段 ${sessionId} 已結束`, 409);
      return forwardControlRequest(row.control_url, row.control_token, 'cancel', { sessionId, actor });
    },

    async stop(sessionId, { actor = 'codex' } = {}) {
      id(sessionId);
      const local = liveSessions.get(sessionId);
      if (local) return executeLocalStop(local, { actor });
      const row = withDb(home, db => db.prepare('SELECT * FROM agent_sessions WHERE session_id=?').get(sessionId));
      invariant(row, 'AGENT_SESSION_NOT_FOUND', `找不到 CLI Agent 工作階段 ${sessionId}`, 404);
      if (row.status === 'STOPPED') {
        const snapshot = readAgentSessionEvents(home, sessionId);
        return { sessionId, status: 'STOPPED', stopped: true, lastSeq: snapshot.lastSeq };
      }
      invariant(row.control_url && row.control_token, 'AGENT_SESSION_CLOSED', `CLI Agent 工作階段 ${sessionId} 控制通道已關閉`, 409);
      return forwardControlRequest(row.control_url, row.control_token, 'stop', { sessionId, actor });
    },

    async close() {
      for (const entry of [...liveSessions.values()]) {
        try { await executeLocalStop(entry, { actor: 'system' }); } catch {}
      }
      try {
        if (existsSync(home)) {
          withDb(home, db => {
            db.prepare('DELETE FROM agent_supervisor_host WHERE id=1 AND pid=?').run(process.pid);
          });
        }
      } catch {}
      server.closeAllConnections();
      await new Promise(resolve => server.close(() => resolve()));
      localControlUrls.delete(controlUrl);
    },
  };
}

export const agentSupervisorToolDefinitions = Object.freeze([
  {
    name: 'agent_start',
    description: '啟動受監管的獨立、長駐互動式 CLI Agent 工作階段（支援 acp 與 pty 模式），立即回傳 sessionId 供後續多輪互動。',
    inputSchema: {
      type: 'object',
      properties: {
        agentProfile: { type: 'string', enum: ['copilot', 'kiro', 'codex', 'claude'], description: '受控 CLI Agent Profile 白名單（預設 copilot）' },
        protocol: { type: 'string', enum: ['acp', 'pty'], description: '互動協定（預設 acp）' },
        agentName: { type: 'string', description: 'CLI Agent 識別名稱' },
        title: { type: 'string', description: 'CLI Agent 標題別名（選填）' },
        cwd: { type: 'string', description: '允許工作區內的工作目錄絕對路徑（選填）' },
        repositoryId:{type:'string',description:'規格庫 ID，可先用 agent_workspaces 查詢'},
        projectId:{type:'string',description:'已登錄產品專案 ID，可省略 cwd'},
        task: { type: 'string', description: '初始派工指令（選填）' },
        prompt: { type: 'string', description: '初始派工指令別名（選填）' },
        wait: { type: 'boolean', description: '是否等待初始回合完成（預設 false 立即回傳 sessionId）' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name:'agent_workspaces',
    description:'列出已綁定規格庫的已初始化產品專案及實際工作目錄，以 repositoryId/projectId 或 cwd 派工。',
    inputSchema:{type:'object',properties:{},additionalProperties:false},
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
  },
  {
    name: 'agent_send',
    description: '對既有長駐 CLI Agent 工作階段（sessionId）發送後續補充或修正指令，支援 messageId 冪等重送與明確 queue/interrupt 策略。',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '目標 CLI Agent 工作階段 ID' },
        message: { type: 'string', description: '要送入工作階段的指令內容' },
        messageId: { type: 'string', description: '選填冪等訊息 ID（重連重送時避免重複執行）' },
        mode: { type: 'string', enum: ['queue', 'interrupt'], description: '排隊或中斷目前回合（預設 queue）' },
        wait: { type: 'boolean', description: '是否等待本輪回覆（預設 true）' },
      },
      required: ['sessionId', 'message'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'agent_events',
    description: '依游標（afterSeq）讀取 CLI Agent 工作階段的增量輸出、工具進度、人類介入訊息與訊息狀態（QUEUED/DELIVERED/PROCESSED）。',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '目標 CLI Agent 工作階段 ID' },
        afterSeq: { type: 'integer', minimum: 0, description: '上次讀取的最後事件序號（預設 0）' },
      },
      required: ['sessionId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'agent_list',
    description: '列出目前工作站或任務關聯的長駐 CLI Agent 工作階段清單與狀態。',
    inputSchema: {
      type: 'object',
      properties: {
        repositoryId: { type: 'string', description: '選填規格庫 ID 篩選' },
        operationId: { type: 'string', description: '選填作業 ID 篩選' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'agent_cancel',
    description: '取消 CLI Agent 工作階段目前執行中的回合（如 ACP session/cancel 或 PTY 中斷），但保留工作階段存活（IDLE）。',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '目標 CLI Agent 工作階段 ID' },
      },
      required: ['sessionId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'agent_stop',
    description: '結束長駐 CLI Agent 工作階段並回收其程序群組（STOPPED）。',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '目標 CLI Agent 工作階段 ID' },
      },
      required: ['sessionId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
]);

export async function supervisorRpc(supervisor, request) {
  const reply = (result, error) => ({ jsonrpc: '2.0', id: request?.id ?? null, ...(error ? { error } : { result }) });
  if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string' || (request.id !== undefined && typeof request.id !== 'string' && typeof request.id !== 'number')) {
    return reply(null, { code: -32600, message: 'Invalid Request' });
  }
  if (request.id === undefined) return null;
  if (request.method === 'initialize') {
    if (typeof request.params?.protocolVersion !== 'string' || !request.params.protocolVersion.trim()) {
      return reply(null, { code: -32602, message: 'Protocol version is required' });
    }
    return reply({
      protocolVersion: negotiateProtocolVersion(request.params.protocolVersion),
      capabilities: { tools: {} },
      serverInfo: { name: 'agent-supervisor', version: '1.0.0' },
    });
  }
  if (request.method === 'ping') return reply({});
  if (request.method === 'tools/list') return reply({ tools: agentSupervisorToolDefinitions });
  if (request.method !== 'tools/call') return reply(null, { code: -32601, message: 'Method not found' });
  const name = request.params?.name, args = request.params?.arguments ?? {};
  if (!args || typeof args !== 'object' || Array.isArray(args)) return reply(null, { code: -32602, message: 'Invalid arguments' });
  try {
    let value;
    if (name === 'agent_start') value = await supervisor.start({ ...args, fromMcp: true });
    else if(name==='agent_workspaces')value={workspaces:await supervisor.workspaces()};
    else if (name === 'agent_send') value = await supervisor.send(args.sessionId, { message: args.message, messageId: args.messageId, mode: args.mode, actor: 'codex', wait: args.wait ?? true });
    else if (name === 'agent_events') value = supervisor.events(args.sessionId, { afterSeq: args.afterSeq ?? 0 });
    else if (name === 'agent_list') value = { sessions: supervisor.list(args) };
    else if (name === 'agent_cancel') value = await supervisor.cancel(args.sessionId, { actor: 'codex' });
    else if (name === 'agent_stop') value = await supervisor.stop(args.sessionId, { actor: 'codex' });
    else return reply(null, { code: -32602, message: `Unknown agent-supervisor tool: ${String(name)}` });
    return reply({ structuredContent: value, content: [{ type: 'text', text: JSON.stringify(value) }] });
  } catch (error) {
    return reply({
      isError: true,
      structuredContent: errorResult(error),
      content: [{ type: 'text', text: error.message ?? String(error) }],
    });
  }
}
