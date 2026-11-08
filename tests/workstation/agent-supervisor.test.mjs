import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Codex } from '@openai/codex-sdk';
import { fixture } from './helpers.mjs';
import { AGENT_PROFILES, createAgentSupervisor, resolveProfileConfig } from '../../packages/workstation/agent-supervisor.mjs';
import { createWorkstation } from '../../packages/workstation/service.mjs';
import { dispatch } from '../../packages/workstation/http.mjs';
import { createChatProvider } from '../../dist/src/adapters/runtime/chat-provider.js';

async function writeInteractiveAcpAgent(base) {
  const file = path.join(base, 'acp-cli-agent.mjs');
  await writeFile(file, `#!${process.execPath}
import { writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';
let activePromptId = null, activeTimer = null, turnCount = 0;
const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n');
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', line => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') {
    send({ id: msg.id, result: { protocolVersion: 1, agentCapabilities: { sessionCapabilities: { close: {} } } } });
  } else if (msg.method === 'session/new') {
    send({ id: msg.id, result: { sessionId: 'acp-remote-session-1' } });
  } else if (msg.method === 'session/close') {
    send({ id: msg.id, result: {} });
  } else if (msg.method === 'session/cancel') {
    if (activeTimer) { clearTimeout(activeTimer); activeTimer = null; }
    if (activePromptId !== null) {
      const cancelledId = activePromptId;
      activePromptId = null;
      send({ id: cancelledId, result: { stopReason: 'cancelled' } });
    }
    if (msg.id !== undefined) send({ id: msg.id, result: {} });
  } else if (msg.method === 'session/prompt') {
    const text = msg.params?.prompt?.[0]?.text ?? '';
    turnCount += 1;
    if (text.includes('CRASH_NOW')) {
      process.exit(99);
    }
    if (text.includes('TRY_GIT')) {
      const gitRes = spawnSync('git', ['status'], { encoding: 'utf8' });
      const envLeak = process.env.WB_CODEX_PROVIDER_TOKEN || process.env.TEST_SERVICE_SECRET || 'NONE';
      send({ method: 'session/update', params: { sessionId: 'acp-remote-session-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: \`GIT_EXIT=\${gitRes.status};GIT_STDERR=\${(gitRes.stderr || '').trim()};LEAK=\${envLeak}\` } } } });
      send({ id: msg.id, result: { stopReason: 'end_turn' } });
      return;
    }
    if (text.includes('SLOW_TURN')) {
      activePromptId = msg.id;
      send({ method: 'session/update', params: { sessionId: 'acp-remote-session-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'working-on-slow-turn...' } } } });
      activeTimer = setTimeout(() => {
        activePromptId = null;
        send({ method: 'session/update', params: { sessionId: 'acp-remote-session-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: \`SLOW_FINISHED[\${turnCount}]\` } } } });
        send({ id: msg.id, result: { stopReason: 'end_turn' } });
      }, 160);
      return;
    }
    const targetFile = path.join(process.cwd(), 'login-feature.txt');
    let previous = '';
    try { previous = readFileSync(targetFile, 'utf8'); } catch {}
    writeFileSync(targetFile, previous + \`turn-\${turnCount}: \${text}\\n\`, 'utf8');
    send({ method: 'session/update', params: { sessionId: 'acp-remote-session-1', update: { sessionUpdate: 'tool_call', title: 'edit_login_feature', status: 'completed' } } });
    send({ method: 'session/update', params: { sessionId: 'acp-remote-session-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: \`ACK[\${turnCount}:pid=\${process.pid}]: \${text}\` } } } });
    send({ id: msg.id, result: { stopReason: 'end_turn' } });
  }
});
`, { mode: 0o755 });
  return file;
}

async function writePtyAgentPeer(base) {
  const file = path.join(base, 'pty-cli-agent.mjs');
  await writeFile(file, `#!${process.execPath}
import { createInterface } from 'node:readline';
process.stdout.write('PTY_READY pid=' + process.pid + '\\n');
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', line => {
  if (line.includes('\\x03')) {
    process.stdout.write('PTY_INTERRUPTED\\n');
    return;
  }
  if (!line.trim()) return;
  process.stdout.write('PTY_REPLY[' + process.pid + ']: ' + line.trim() + '\\n');
});
`, { mode: 0o755 });
  return file;
}

function startMcpClient(home, cwd, extraEnv = {}) {
  const child = spawn(process.execPath, [path.resolve('scripts/mcp-agent-supervisor.mjs'), home, 'SPEC-1', 'OP-1', cwd], {
    env: { ...process.env, WB_HOME: home, WB_AGENT_SUPERVISOR_CWD: cwd, ...extraEnv },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let nextId = 0;
  const pending = new Map();
  rl.on('line', line => {
    if (!line.trim()) return;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });
  return {
    async callRaw(name, args = {}) {
      const id = ++nextId;
      const promise = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) + '\n');
      return promise;
    },
    async call(name, args = {}) {
      const result = await this.callRaw(name, args);
      assert.notEqual(result.isError, true, result.content?.[0]?.text ?? 'MCP tool error');
      return result.structuredContent;
    },
    async close() {
      rl.close();
      child.stdin.end();
      await new Promise(resolve => child.once('close', resolve));
    }
  };
}

test('Human intervention supports both non-cancelling queue priority (mode=queue) and explicit turn cancellation (mode=interrupt), plus QUEUED/DELIVERED/PROCESSED states and idempotency', async t => {
  const f = await fixture(t);
  const acpPeer = await writeInteractiveAcpAgent(f.base);
  const service = await createWorkstation({ home: f.home });
  const mcp = startMcpClient(f.home, f.base, {
    WB_AGENT_SUPERVISOR_COMMAND: process.execPath,
    WB_AGENT_SUPERVISOR_ARGS_JSON: JSON.stringify([acpPeer, '--acp', '--stdio']),
    WB_AGENT_SUPERVISOR_ALLOWED_ROOTS_JSON: JSON.stringify([f.base]),
  });
  t.after(async () => { await mcp.close(); await service.close(); });

  // 1. Codex starts persistent ACP CLI Agent session via MCP agent_start (without passing command/args)
  const started = await mcp.call('agent_start', {
    protocol: 'acp',
    title: 'Login Feature CLI Agent',
    prompt: '實作登入表單',
    wait: true,
  });
  assert.match(started.sessionId, /^AGT-/);
  assert.equal(started.messageState, 'PROCESSED');
  const initialPid = started.pid;

  // 2. Non-cancelling priority queue (default mode='queue'):
  // Codex starts a SLOW_TURN and queues a follow-up; Human sends a message with default interrupt=false (mode='queue').
  // The active SLOW_TURN must finish normally (NOT cancelled), and Human's queued message must run BEFORE Codex's queued message!
  const slowSend = await mcp.call('agent_send', { sessionId: started.sessionId, message: 'SLOW_TURN: 第一階段工作', wait: false });
  assert.ok(['QUEUED', 'DELIVERED'].includes(slowSend.messageState));
  await new Promise(r => setTimeout(r, 25));
  const codexQueued = await mcp.call('agent_send', { sessionId: started.sessionId, message: 'Codex 排隊指令 A', wait: false });
  assert.equal(codexQueued.messageState, 'QUEUED');

  const humanQueueRes = await dispatch(service, {
    method: 'POST',
    url: `/repository-api/v1/agent-sessions/${started.sessionId}/messages`,
    headers: { 'x-workbench-request': '1' },
    body: { message: '人類不中斷插隊：請先補上欄位驗證', messageId: 'MSG-human-queue-1', mode: 'queue', wait: true }
  });
  assert.equal(humanQueueRes.status, 200);
  assert.equal(humanQueueRes.body.messageState, 'PROCESSED');

  // Idempotent retry with the same messageId must deduplicate without re-running
  const dupRes = await dispatch(service, {
    method: 'POST',
    url: `/repository-api/v1/agent-sessions/${started.sessionId}/messages`,
    headers: { 'x-workbench-request': '1' },
    body: { message: '人類不中斷插隊：請先補上欄位驗證', messageId: 'MSG-human-queue-1', mode: 'queue', wait: true }
  });
  assert.equal(dupRes.status, 200);
  assert.equal(dupRes.body.deduplicated, true);

  // Conflicting content with the same messageId must fail with 409 DUPLICATE_MESSAGE_ID
  await assert.rejects(
    dispatch(service, {
      method: 'POST',
      url: `/repository-api/v1/agent-sessions/${started.sessionId}/messages`,
      headers: { 'x-workbench-request': '1' },
      body: { message: '不同內容卻用同一個 messageId', messageId: 'MSG-human-queue-1', mode: 'queue', wait: true }
    }),
    { code: 'DUPLICATE_MESSAGE_ID', statusCode: 409 }
  );

  // Wait for Codex's queued message A to finish too
  let snapshot;
  for (let i = 0; i < 40; i++) {
    snapshot = await mcp.call('agent_events', { sessionId: started.sessionId, afterSeq: 0 });
    if (snapshot.status === 'IDLE' && snapshot.messages.every(m => m.state === 'PROCESSED')) break;
    await new Promise(r => setTimeout(r, 25));
  }
  const slowMsg = snapshot.messages.find(m => m.messageId === slowSend.messageId);
  assert.equal(slowMsg.state, 'PROCESSED', 'mode=queue must NOT cancel the active turn');
  assert.match(slowMsg.reply, /SLOW_FINISHED/);

  const outputsAfterQueue = snapshot.events.filter(e => e.kind === 'output').map(e => e.content);
  const idxHumanQueue = outputsAfterQueue.findIndex(t => t.includes('人類不中斷插隊'));
  const idxCodexQueue = outputsAfterQueue.findIndex(t => t.includes('Codex 排隊指令 A'));
  assert.ok(idxHumanQueue >= 0 && idxCodexQueue > idxHumanQueue, 'Human mode=queue must execute before queued Codex message');

  // 3. Explicit interrupt mode (mode='interrupt'):
  // Codex starts another SLOW_TURN; Human sends mode='interrupt' to cancel the active turn and run immediately
  const slowInterrupt = await mcp.call('agent_send', { sessionId: started.sessionId, message: 'SLOW_TURN: 將被人類明確中斷', wait: false });
  await new Promise(r => setTimeout(r, 25));
  const humanInterruptRes = await dispatch(service, {
    method: 'POST',
    url: `/repository-api/v1/agent-sessions/${started.sessionId}/messages`,
    headers: { 'x-workbench-request': '1' },
    body: { message: '人類明確中斷：改用 OAuth 流程', mode: 'interrupt', wait: true }
  });
  assert.equal(humanInterruptRes.status, 200);
  assert.equal(humanInterruptRes.body.messageState, 'PROCESSED');

  const afterInterrupt = await mcp.call('agent_events', { sessionId: started.sessionId, afterSeq: 0 });
  const cancelledMsg = afterInterrupt.messages.find(m => m.messageId === slowInterrupt.messageId);
  assert.equal(cancelledMsg.state, 'CANCELLED', 'mode=interrupt must mark the interrupted turn as CANCELLED');
  assert.equal(afterInterrupt.pid, initialPid, 'Session must remain on the same live CLI Agent process');

  // 4. Verify agent_list and agent_stop
  const listed = await mcp.call('agent_list', {});
  assert.ok(listed.sessions.some(s => s.sessionId === started.sessionId));
  const stopped = await mcp.call('agent_stop', { sessionId: started.sessionId });
  assert.equal(stopped.status, 'STOPPED');
});

test('Tool permissions block arbitrary commands/env/cwd, strip secrets, enforce Git guard on delegated CLI Agents, and record process crash', async t => {
  const f = await fixture(t);
  const acpPeer = await writeInteractiveAcpAgent(f.base);
  const mcp = startMcpClient(f.home, f.base, {
    WB_CODEX_PROVIDER_TOKEN: 'secret-provider-token',
    TEST_SERVICE_SECRET: 'top-secret-value',
    WB_AGENT_SUPERVISOR_COMMAND: process.execPath,
    WB_AGENT_SUPERVISOR_ARGS_JSON: JSON.stringify([acpPeer, '--acp', '--stdio']),
    WB_AGENT_SUPERVISOR_ALLOWED_ROOTS_JSON: JSON.stringify([f.base]),
  });
  t.after(() => mcp.close());

  // 1. Model attempting to pass command or args via MCP is rejected
  const badCmd = await mcp.callRaw('agent_start', { protocol: 'acp', command: '/bin/sh', prompt: 'hi' });
  assert.equal(badCmd.isError, true);
  assert.equal(badCmd.structuredContent.code, 'AGENT_COMMAND_FORBIDDEN');

  // 2. Model attempting to escape allowed workspace root is rejected
  const badCwd = await mcp.callRaw('agent_start', { protocol: 'acp', cwd: path.dirname(f.base), prompt: 'hi' });
  assert.equal(badCwd.isError, true);
  assert.equal(badCwd.structuredContent.code, 'AGENT_CWD_FORBIDDEN');

  // 3. Delegated CLI Agent trying to run git or read secret env vars is blocked by Git guard and env scrubbing
  const started = await mcp.call('agent_start', { protocol: 'acp', prompt: 'TRY_GIT', wait: true });
  assert.match(started.reply, /GIT_EXIT=126/);
  assert.match(started.reply, /GIT_FORBIDDEN/);
  assert.match(started.reply, /LEAK=NONE/);

  // 4. Process crash marks active and queued messages as FAILED and session as FAILED
  await assert.rejects(mcp.call('agent_send', { sessionId: started.sessionId, message: 'CRASH_NOW', wait: true }), /異常結束/);
  const afterCrash = await mcp.call('agent_events', { sessionId: started.sessionId, afterSeq: 0 });
  assert.equal(afterCrash.status, 'FAILED');
  assert.equal(afterCrash.messages.at(-1).state, 'FAILED');

  // 5. AC-WB-051: Controlled CLI Agent Profile whitelist (copilot, kiro, codex, claude) & HTTP startAgentSession protection
  assert.deepEqual(AGENT_PROFILES, ['copilot', 'kiro', 'codex', 'claude']);
  for (const profile of AGENT_PROFILES) {
    const resolvedAcp = resolveProfileConfig(profile, 'acp', {});
    assert.ok(resolvedAcp.command.length > 0 && Array.isArray(resolvedAcp.args));
    const resolvedPty = resolveProfileConfig(profile, 'pty', {});
    assert.ok(resolvedPty.command.length > 0 && Array.isArray(resolvedPty.args));
  }
  const badProfile = await mcp.callRaw('agent_start', { agentProfile: 'bash', protocol: 'acp', prompt: 'hi' });
  assert.equal(badProfile.isError, true);
  assert.equal(badProfile.structuredContent.code, 'INVALID_AGENT_PROFILE');

  const service = await createWorkstation({ home: path.join(f.base, 'http-home') });
  t.after(() => service.close());
  await assert.rejects(
    dispatch(service, {
      method: 'POST',
      url: '/repository-api/v1/agent-sessions',
      headers: { 'x-workbench-request': '1' },
      body: { agentProfile: 'copilot', protocol: 'acp', command: '/bin/sh', prompt: 'nope' }
    }),
    { code: 'AGENT_COMMAND_FORBIDDEN', statusCode: 403 }
  );
  await assert.rejects(
    dispatch(service, {
      method: 'POST',
      url: '/repository-api/v1/agent-sessions',
      headers: { 'x-workbench-request': '1' },
      body: { agentProfile: 'unknown-cli', protocol: 'acp', prompt: 'nope' }
    }),
    { code: 'INVALID_AGENT_PROFILE', statusCode: 400 }
  );

  // Verify starting a non-Node profile (agentProfile: 'kiro') via HTTP without WB_AGENT_SUPERVISOR_COMMAND succeeds and stops cleanly
  const kiroStarted = await dispatch(service, {
    method: 'POST',
    url: '/repository-api/v1/agent-sessions',
    headers: { 'x-workbench-request': '1' },
    body: { agentProfile: 'kiro', protocol: 'acp', title: 'HTTP Kiro Profile Session', wait: false }
  });
  assert.equal(kiroStarted.status, 201);
  assert.match(kiroStarted.body.sessionId, /^AGT-/);
  const kiroStopped = await dispatch(service, {
    method: 'POST',
    url: `/repository-api/v1/agent-sessions/${kiroStarted.body.sessionId}/stop`,
    headers: { 'x-workbench-request': '1' },
    body: {}
  });
  assert.equal(kiroStopped.status, 200);
  assert.equal(kiroStopped.body.status, 'STOPPED');
});

test('PTY CLI Agent session supports interactive follow-up, cancel interrupt, and stop', async t => {
  const f = await fixture(t);
  const ptyPeer = await writePtyAgentPeer(f.base);
  const supervisor = await createAgentSupervisor({ home: f.home, allowedRoots: [f.base] });
  t.after(() => supervisor.close());

  const started = await supervisor.start({
    protocol: 'pty',
    command: process.execPath,
    args: [ptyPeer],
    cwd: f.base,
    prompt: '建立登入元件',
    settleMs: 80,
    wait: true
  });
  assert.equal(started.protocol, 'pty');
  const followUp = await supervisor.send(started.sessionId, {
    actor: 'human',
    message: '加上 ARIA label',
    wait: true
  });
  assert.ok(followUp.events.some(e => e.content.includes('PTY_REPLY[' + started.pid + ']: 加上 ARIA label')));

  const cancelled = await supervisor.cancel(started.sessionId, { actor: 'human' });
  assert.equal(cancelled.status, 'IDLE');

  const stopped = await supervisor.stop(started.sessionId, { actor: 'codex' });
  assert.equal(stopped.status, 'STOPPED');
});

test('tmux supplies a terminal and preserves the requested working directory', async t => {
  const f = await fixture(t);
  const peer = path.join(f.base, 'terminal-probe.mjs');
  await writeFile(peer, `import {createInterface} from 'node:readline';
console.log('TTY=' + process.stdin.isTTY + ' CWD=' + process.cwd());
createInterface({input:process.stdin}).on('line', line => console.log('RECEIVED=' + line));
`);
  const supervisor = await createAgentSupervisor({home: f.home, allowedRoots: [f.base]});
  t.after(() => supervisor.close());
  const started = await supervisor.start({protocol: 'pty', command: process.execPath, args: [peer], cwd: f.base});
  const reply = await supervisor.send(started.sessionId, {message: 'terminal-probe', wait: true});
  const events = supervisor.events(started.sessionId).events.map(event => event.content).join('');
  assert.match(events, /TTY=true/);
  assert.ok(events.includes('CWD=' + f.base));
  assert.ok(events.includes('RECEIVED=terminal-probe'));
  assert.equal(reply.processed, false);
  await supervisor.terminalInput(started.sessionId, 'raw-input\r');
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('terminal input was not received')), 3000);
    const poll = setInterval(() => {
      if (supervisor.events(started.sessionId).events.some(event => event.content.includes('RECEIVED=raw-input'))) {
        clearInterval(poll);clearTimeout(deadline);resolve();
      }
    }, 20);
    t.after(() => {clearInterval(poll);clearTimeout(deadline);});
  });
  assert.equal((await supervisor.stop(started.sessionId)).stopped, true);
});

async function waitForLifecycle(t,condition){
  await new Promise((resolve,reject)=>{
    const deadline=setTimeout(()=>{clearInterval(poll);reject(new Error('Agent did not reach the expected lifecycle state'));},3000);
    const poll=setInterval(()=>{if(condition()){clearTimeout(deadline);clearInterval(poll);resolve();}},20);
    t.after(()=>{clearTimeout(deadline);clearInterval(poll);});
  });
}

test('raw PTY input can be interrupted without a queued supervisor turn',async t=>{
  const f=await fixture(t),supervisor=await createAgentSupervisor({home:f.home,allowedRoots:[f.base]});
  t.after(()=>supervisor.close());
  const started=await supervisor.start({protocol:'pty',command:process.execPath,cwd:f.base,args:['-e',"process.on('SIGINT',()=>console.log('INTERRUPTED'));process.stdin.on('data',()=>{});console.log('READY')"]});
  const output=()=>supervisor.events(started.sessionId).events.map(event=>event.content).join('');
  await waitForLifecycle(t,()=>output().includes('READY'));
  await supervisor.terminalInput(started.sessionId,'raw input\r');
  assert.equal((await supervisor.cancel(started.sessionId,{actor:'human'})).cancelled,true);
  await waitForLifecycle(t,()=>output().includes('INTERRUPTED'));
  await supervisor.stop(started.sessionId);
});

for(const action of ['stop','detach','concurrent-stop'])test(`tmux ${action} reaps a pane that ignores HUP and TERM before releasing ownership`,async t=>{
  const f=await fixture(t),supervisor=await createAgentSupervisor({home:f.home,allowedRoots:[f.base]});
  t.after(()=>supervisor.close());
  const started=await supervisor.start({protocol:'pty',command:process.execPath,cwd:f.base,args:['-e',"process.on('SIGHUP',()=>{});process.on('SIGTERM',()=>{});console.log('READY');setInterval(()=>{},1000)"]});
  await waitForLifecycle(t,()=>supervisor.events(started.sessionId).events.some(event=>event.content.includes('READY')));
  if(action==='detach'){
    await supervisor.terminalInput(started.sessionId,'\x02d');
    await waitForLifecycle(t,()=>supervisor.session(started.sessionId).status==='FAILED');
  }else{
    const first=supervisor.stop(started.sessionId);
    const result=action==='concurrent-stop'?await supervisor.stop(started.sessionId):await first;
    assert.equal(result.stopped,true);
    assert.throws(()=>process.kill(started.pid,0),{code:'ESRCH'});
    await first;
  }
  assert.throws(()=>process.kill(started.pid,0),{code:'ESRCH'});
});

test('Full E2E: Codex dispatch -> CLI Agent active -> Human UI intervention -> same Session continues -> Codex reads human + Agent events -> Codex dispatches again -> normal stop & process reap', async t => {
  const f = await fixture(t);
  const acpPeer = await writeInteractiveAcpAgent(f.base);
  const service = await createWorkstation({ home: f.home });
  // Ensure primary workstation supervisor is initialized so Human UI and Codex MCP share the exact same supervisor
  await service.supervisor();

  const copilotPeer = path.join(f.base, 'e2e-copilot-peer.mjs');
  const copilotState = path.join(f.base, 'e2e-copilot-state.json');
  await writeFile(copilotPeer, `#!${process.execPath}
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const stateFile = ${JSON.stringify(copilotState)};
const load = () => { try { return JSON.parse(readFileSync(stateFile, 'utf8')); } catch { return { sessions: [], turns: 0 }; } };
const save = state => writeFileSync(stateFile, JSON.stringify(state, null, 2));
const send = msg => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\\n');
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', async line => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') {
    send({ id: msg.id, result: { protocolVersion: 1, agentCapabilities: { sessionCapabilities: { close: {} } } } });
  } else if (msg.method === 'session/new') {
    const state = load();
    state.sessions.push({ sessionId: 'cp-e2e-1', mcpServers: msg.params?.mcpServers ?? null });
    save(state);
    send({ id: msg.id, result: { sessionId: 'cp-e2e-1', configOptions: [{ id: 'model', category: 'model', type: 'select', currentValue: 'gpt-5-mini', options: [{ value: 'gpt-5-mini', name: 'gpt-5-mini' }] }] } });
  } else if (msg.method === 'session/set_config_option' || msg.method === 'session/close') {
    send({ id: msg.id, result: {} });
  } else if (msg.method === 'session/prompt') {
    const prompt = msg.params.prompt.map(p => p.text).join('');
    let payload = null;
    try {
      const idx = prompt.indexOf('\\n{');
      if (idx >= 0) payload = JSON.parse(prompt.slice(idx + 1));
    } catch {}
    const history = payload?.normalizedHistory ?? [];
    const outputs = history.filter(item => item?.role === 'tool_result');
    let userText = '';
    for (const item of history) {
      if (item?.role === 'user' && Array.isArray(item.content)) {
        userText += item.content.map(p => p.text ?? '').join('\\n');
      }
    }
    const specMatch = userText.match(/E2E_SUPERVISOR_SPEC:(\\{.+\\})/);
    const spec = specMatch ? JSON.parse(specMatch[1]) : {};
    const extractSessionId = raw => {
      const text = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.map(p => p.text ?? '').join('') : JSON.stringify(raw ?? '');
      const m = text.match(/AGT-[a-z0-9]+/i);
      return m ? m[0] : 'AGT-missing';
    };
    let reply;
    if (outputs.length === 0) {
      // Step 1: Codex starts persistent CLI Agent session
      reply = JSON.stringify({
        type: 'tool_calls',
        calls: [{
          id: 'call-1-start',
          name: 'mcp__agent_supervisor__agent_start',
          arguments: { protocol: 'acp', title: 'E2E Worker', cwd: spec.cwd, prompt: '步驟一：建立登入表單', wait: true }
        }]
      });
    } else if (outputs.length === 1) {
      // Step 2: While session is open, trigger Human intervention via Workstation HTTP API, then Codex calls agent_events
      const sid = extractSessionId(outputs[0].output);
      await fetch(spec.humanApiUrl + '/repository-api/v1/agent-sessions/' + sid + '/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-workbench-request': '1' },
        body: JSON.stringify({ message: '人類介入：請在登入失敗時顯示鎖定提示', mode: 'queue', wait: true })
      });
      reply = JSON.stringify({
        type: 'tool_calls',
        calls: [{
          id: 'call-2-events',
          name: 'mcp__agent_supervisor__agent_events',
          arguments: { sessionId: sid, afterSeq: 0 }
        }]
      });
    } else if (outputs.length === 2) {
      // Step 3: Codex reads the human message + Agent response from agent_events, then dispatches a follow-up via agent_send
      const sid = extractSessionId(outputs[0].output);
      reply = JSON.stringify({
        type: 'tool_calls',
        calls: [{
          id: 'call-3-send',
          name: 'mcp__agent_supervisor__agent_send',
          arguments: { sessionId: sid, message: '步驟三：根據人類介入補上鎖定提示測試', wait: true }
        }]
      });
    } else if (outputs.length === 3) {
      // Step 4: Codex stops the session via agent_stop
      const sid = extractSessionId(outputs[0].output);
      reply = JSON.stringify({
        type: 'tool_calls',
        calls: [{
          id: 'call-4-stop',
          name: 'mcp__agent_supervisor__agent_stop',
          arguments: { sessionId: sid }
        }]
      });
    } else {
      const sid = extractSessionId(outputs[0].output);
      reply = JSON.stringify({ type: 'message', text: 'E2E_COMPLETE:' + sid });
    }
    send({ method: 'session/update', params: { sessionId: msg.params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: reply } } } });
    send({ id: msg.id, result: { stopReason: 'end_turn' } });
  }
});
`, { mode: 0o755 });

  // Start a lightweight HTTP bridge for the Workstation service so the human intervention goes through the real HTTP route
  await service.supervisor();
  const http = await import('node:http');
  const httpServer = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : undefined;
    const out = await dispatch(service, { method: req.method, url: req.url, headers: req.headers, body });
    res.writeHead(out.status, out.headers);
    res.end(JSON.stringify(out.body));
  });
  await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  const humanApiUrl = `http://127.0.0.1:${httpServer.address().port}`;

  const provider = await createChatProvider(f.base, 'codex');
  const registration = provider.register({
    codexExecutable: '',
    copilotExecutable: process.execPath,
    copilotArgs: [copilotPeer],
    model: 'gpt-5-mini',
    timeoutMs: 15000
  });
  const controller = new AbortController();
  registration.activate(controller.signal);
  t.after(async () => {
    controller.abort();
    registration.deactivate();
    registration.close();
    await new Promise(resolve => httpServer.close(resolve));
    await provider.close();
    await service.close();
  });

  const codexHome = path.join(f.base, 'codex-home');
  await mkdir(codexHome, { recursive: true });
  const codex = new Codex({
    apiKey: 'unused',
    baseUrl: provider.url,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? f.base,
      CODEX_HOME: codexHome,
      WB_HOME: f.home,
      WB_CODEX_PROVIDER_TOKEN: registration.token,
      WB_AGENT_SUPERVISOR_COMMAND: process.execPath,
      WB_AGENT_SUPERVISOR_ARGS_JSON: JSON.stringify([acpPeer, '--acp', '--stdio']),
      WB_AGENT_SUPERVISOR_ALLOWED_ROOTS_JSON: JSON.stringify([f.base]),
    },
    config: {
      model: 'gpt-5-mini',
      model_provider: 'workstation_copilot',
      approval_policy: 'never',
      web_search: 'disabled',
      model_providers: {
        workstation_copilot: {
          name: 'Workstation Copilot Adapter',
          base_url: provider.url,
          wire_api: 'responses',
          env_key: 'WB_CODEX_PROVIDER_TOKEN'
        }
      },
      mcp_servers: {
        agent_supervisor: {
          command: process.execPath,
          args: [path.resolve('scripts/mcp-agent-supervisor.mjs'), f.home, 'SPEC-e2e', 'OP-e2e', f.base],
          env: {
            WB_HOME: f.home,
            WB_AGENT_SUPERVISOR_COMMAND: process.execPath,
            WB_AGENT_SUPERVISOR_ARGS_JSON: JSON.stringify([acpPeer, '--acp', '--stdio']),
            WB_AGENT_SUPERVISOR_ALLOWED_ROOTS_JSON: JSON.stringify([f.base]),
          },
          enabled: true,
          required: true,
          tools: {
            agent_start: { approval_mode: 'approve' },
            agent_send: { approval_mode: 'approve' },
            agent_events: { approval_mode: 'approve' },
            agent_list: { approval_mode: 'approve' },
            agent_cancel: { approval_mode: 'approve' },
            agent_stop: { approval_mode: 'approve' }
          }
        }
      }
    }
  });

  const thread = codex.startThread({ workingDirectory: f.base, skipGitRepoCheck: true, sandboxMode: 'workspace-write' });
  const turn = await thread.run(
    `E2E_SUPERVISOR_SPEC:${JSON.stringify({ cwd: f.base, humanApiUrl })}`
  );
  const match = turn.finalResponse.match(/E2E_COMPLETE:(AGT-[a-z0-9]+)/i);
  assert.ok(match, `expected E2E_COMPLETE:<sessionId>, got: ${turn.finalResponse}`);
  const sessionId = match[1];

  // Verify the single CLI Agent session recorded all 3 turns (Codex -> Human -> Codex) on the same PID and reaped the process
  const sessionDetail = service.agentSessionEvents(sessionId, { afterSeq: 0, limit: 200 });
  assert.equal(sessionDetail.status, 'STOPPED');
  assert.equal(sessionDetail.messages.length, 3);
  assert.deepEqual(sessionDetail.messages.map(m => [m.actor, m.state]), [
    ['codex', 'PROCESSED'],
    ['human', 'PROCESSED'],
    ['codex', 'PROCESSED'],
  ]);
  const writtenFile = await readFile(path.join(f.base, 'login-feature.txt'), 'utf8');
  assert.match(writtenFile, /turn-1: 步驟一：建立登入表單/);
  assert.match(writtenFile, /turn-2: 人類介入：請在登入失敗時顯示鎖定提示/);
  assert.match(writtenFile, /turn-3: 步驟三：根據人類介入補上鎖定提示測試/);

  // Verify process is reaped
  assert.throws(() => process.kill(sessionDetail.pid, 0), { code: 'ESRCH' });

  // Verify Copilot ACP had zero MCP servers across every session/new call
  const recorded = JSON.parse(await readFile(copilotState, 'utf8'));
  assert.ok(recorded.sessions.length >= 1);
  for (const session of recorded.sessions) {
    assert.deepEqual(session.mcpServers, [], 'Copilot ACP must never receive or connect to any MCP server');
  }
});

test('Real CLI E2E: installed Codex SDK + installed Zero-MCP Copilot ACP + real persistent Copilot CLI Agent session + Human HTTP intervention', async t => {
  const f = await fixture(t);
  const service = await createWorkstation({ home: f.home });
  await service.supervisor();
  const provider = await createChatProvider(f.base, 'codex');

  // Use defaultChatSettings() so both the inference adapter and the supervised CLI Agent run the real installed @github/copilot CLI
  const { defaultChatSettings } = await import('../../dist/src/adapters/runtime/chat-settings.js');
  const settings = { ...defaultChatSettings(), timeoutMs: 60000 };
  const registration = provider.register(settings);
  const controller = new AbortController();
  registration.activate(controller.signal);
  t.after(async () => {
    controller.abort();
    registration.deactivate();
    registration.close();
    await provider.close();
    await service.close();
  });

  const codexHome = path.join(f.base, 'codex-home-real');
  await mkdir(codexHome, { recursive: true });
  const codex = new Codex({
    apiKey: 'unused',
    baseUrl: provider.url,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? f.base,
      CODEX_HOME: codexHome,
      WB_HOME: f.home,
      WB_CODEX_PROVIDER_TOKEN: registration.token,
    },
    config: {
      model: 'gpt-5-mini',
      model_provider: 'workstation_copilot',
      approval_policy: 'never',
      web_search: 'disabled',
      model_providers: {
        workstation_copilot: {
          name: 'Workstation Copilot Adapter',
          base_url: provider.url,
          wire_api: 'responses',
          env_key: 'WB_CODEX_PROVIDER_TOKEN',
          request_max_retries: 0,
          stream_max_retries: 0
        }
      },
      mcp_servers: {
        agent_supervisor: {
          command: process.execPath,
          args: [path.resolve('scripts/mcp-agent-supervisor.mjs'), f.home, 'SPEC-real', 'OP-real', f.base],
          env: {
            WB_HOME: f.home,
            WB_AGENT_SUPERVISOR_ALLOWED_ROOTS_JSON: JSON.stringify([f.base]),
          },
          enabled: true,
          required: true,
          tools: {
            agent_start: { approval_mode: 'approve' },
            agent_send: { approval_mode: 'approve' },
            agent_events: { approval_mode: 'approve' },
            agent_list: { approval_mode: 'approve' },
            agent_cancel: { approval_mode: 'approve' },
            agent_stop: { approval_mode: 'approve' }
          }
        }
      }
    }
  });

  const thread = codex.startThread({ workingDirectory: f.base, skipGitRepoCheck: true, sandboxMode: 'workspace-write' });

  try {
    // Turn 1: Codex SDK calls agent_start to launch a real persistent CLI Agent session and wait for its first reply
    const turn1 = await thread.run(
      'Call mcp__agent_supervisor__agent_start with {"protocol":"acp","title":"Real CLI Worker","prompt":"Reply with the exact token REAL_AGENT_STEP_1","wait":true}. After the tool returns, reply with ONLY the sessionId (starting with AGT-).'
    );
    const sidMatch = turn1.finalResponse.match(/AGT-[a-z0-9]+/i);
    assert.ok(sidMatch, `Expected real sessionId in turn1 response, got: ${turn1.finalResponse}`);
    const sessionId = sidMatch[0];

    const afterTurn1 = service.agentSessionEvents(sessionId, { afterSeq: 0, limit: 100 });
    assert.equal(afterTurn1.status, 'IDLE');
    const realPid = afterTurn1.pid;
    assert.ok(realPid > 0);

    // Human intervenes on the SAME real CLI Agent session via Workstation HTTP API
    const humanRes = await dispatch(service, {
      method: 'POST',
      url: `/repository-api/v1/agent-sessions/${sessionId}/messages`,
      headers: { 'x-workbench-request': '1' },
      body: { message: 'Human intervention: remember code ALPHA-777 and reply HUMAN_ACK_777.', mode: 'queue', wait: true }
    });
    assert.equal(humanRes.status, 200);
    assert.equal(humanRes.body.messageState, 'PROCESSED');
    assert.match(humanRes.body.reply, /HUMAN_ACK_777|ALPHA-777/);

    // Turn 2: Codex SDK reads incremental events via agent_events to observe the human intervention
    const turn2 = await thread.run(
      `Call mcp__agent_supervisor__agent_events with {"sessionId":"${sessionId}","afterSeq":0} and reply with the code the human asked the agent to remember.`
    );
    assert.match(turn2.finalResponse, /ALPHA-777/);

    // Turn 3: Codex SDK dispatches a follow-up task to the SAME CLI Agent session via agent_send
    const turn3 = await thread.run(
      `Call mcp__agent_supervisor__agent_send with {"sessionId":"${sessionId}","message":"Reply with ALPHA-777-CONFIRMED","wait":true} and return the agent's reply.`
    );
    assert.match(turn3.finalResponse, /ALPHA-777/);

    // Turn 4: Codex SDK stops the session via agent_stop
    await thread.run(
      `Call mcp__agent_supervisor__agent_stop with {"sessionId":"${sessionId}"} and reply STOPPED.`
    );

    const finalState = service.agentSessionEvents(sessionId, { afterSeq: 0, limit: 200 });
    assert.equal(finalState.status, 'STOPPED');
    assert.equal(finalState.pid, realPid);
    assert.ok(finalState.messages.some(m => m.actor === 'codex' && m.state === 'PROCESSED'));
    assert.ok(finalState.messages.some(m => m.actor === 'human' && m.state === 'PROCESSED'));
    assert.equal(finalState.messages.filter(m => m.state === 'PROCESSED').length, 3);
    assert.ok(finalState.events.some(e => JSON.stringify(e).includes('ALPHA-777')));
    assert.throws(() => process.kill(realPid, 0), { code: 'ESRCH' });
  } catch (err) {
    console.error('TEST5_FAIL_DETAIL:', err);
    throw err;
  }
});

test('AC-WB-050 Real CLI: Kiro CLI ACP <-> Copilot ACP switching + Chat room native agent_supervisor MCP mounting', async t => {
  const f = await fixture(t);
  const acpPeer = await writeInteractiveAcpAgent(f.base);
  const service = await createWorkstation({ home: f.home });
  await service.supervisor();
  const provider = await createChatProvider(f.base, 'codex');

  const { defaultChatSettings } = await import('../../dist/src/adapters/runtime/chat-settings.js');
  const kiroSettings = {
    ...defaultChatSettings(),
    acpProvider: 'kiro',
    model: 'claude-haiku-4.5',
    timeoutMs: 60000,
  };
  const registration = provider.register(kiroSettings);
  const controller = new AbortController();
  registration.activate(controller.signal);
  t.after(async () => {
    controller.abort();
    registration.deactivate();
    registration.close();
    await provider.close();
    await service.close();
  });

  // 1) Verify real Kiro CLI ACP model catalog discovery
  const kiroModels = await provider.models(kiroSettings, controller.signal);
  assert.ok(kiroModels.some(m => m.id === 'claude-haiku-4.5'), `Expected claude-haiku-4.5 in Kiro models, got: ${JSON.stringify(kiroModels)}`);

  // 2) Verify Chat service settings persistence when switching between 'kiro' and 'copilot'
  const chat = await service.chat();
  const patchedKiro = await chat.patchSettings({ acpProvider: 'kiro', model: 'claude-haiku-4.5' });
  assert.equal(patchedKiro.acpProvider, 'kiro');
  assert.equal(patchedKiro.model, 'claude-haiku-4.5');
  const patchedCopilot = await chat.patchSettings({ acpProvider: 'copilot', model: 'auto' });
  assert.equal(patchedCopilot.acpProvider, 'copilot');
  assert.equal(patchedCopilot.model, 'auto');

  // 3) Verify real Codex SDK + real Kiro CLI ACP pure inference executes native agent_supervisor MCP tools
  const codexHome = path.join(f.base, 'codex-home-kiro');
  await mkdir(codexHome, { recursive: true });
  const codex = new Codex({
    apiKey: 'unused',
    baseUrl: provider.url,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? f.base,
      CODEX_HOME: codexHome,
      WB_HOME: f.home,
      WB_CODEX_PROVIDER_TOKEN: registration.token,
    },
    config: {
      model: 'claude-haiku-4.5',
      model_provider: 'workstation_copilot',
      approval_policy: 'never',
      web_search: 'disabled',
      model_providers: {
        workstation_copilot: {
          name: 'Workstation ACP Adapter',
          base_url: provider.url,
          wire_api: 'responses',
          env_key: 'WB_CODEX_PROVIDER_TOKEN',
          request_max_retries: 0,
          stream_max_retries: 0,
        },
      },
      mcp_servers: {
        agent_supervisor: {
          command: process.execPath,
          args: [path.resolve('scripts/mcp-agent-supervisor.mjs'), f.home, 'SPEC-kiro', 'OP-kiro', f.base],
          env: {
            WB_HOME: f.home,
            WB_AGENT_SUPERVISOR_COMMAND: process.execPath,
            WB_AGENT_SUPERVISOR_ARGS_JSON: JSON.stringify([acpPeer, '--acp', '--stdio']),
            WB_AGENT_SUPERVISOR_ALLOWED_ROOTS_JSON: JSON.stringify([f.base]),
          },
          enabled: true,
          required: true,
          tools: {
            agent_start: { approval_mode: 'approve' },
            agent_send: { approval_mode: 'approve' },
            agent_events: { approval_mode: 'approve' },
            agent_list: { approval_mode: 'approve' },
            agent_cancel: { approval_mode: 'approve' },
            agent_stop: { approval_mode: 'approve' },
          },
        },
      },
    },
  });

  const thread = codex.startThread({ workingDirectory: f.base, skipGitRepoCheck: true, sandboxMode: 'workspace-write' });
  const turn = await thread.run(
    '1) Call mcp__agent_supervisor__agent_start with {"protocol":"acp","title":"Kiro Dispatched Worker","prompt":"Kiro test step 1","wait":true}. 2) Then call mcp__agent_supervisor__agent_stop with {"sessionId":"<the sessionId returned by agent_start>"}. 3) Finally reply with KIRO_DONE_<sessionId>.'
  );
  const sidMatch = turn.finalResponse.match(/AGT-[a-z0-9]+/i);
  assert.ok(sidMatch, `Expected sessionId from Kiro ACP tool loop, got: ${turn.finalResponse}`);
  const sessionState = service.agentSessionEvents(sidMatch[0], { afterSeq: 0, limit: 50 });
  assert.equal(sessionState.status, 'STOPPED');
  assert.equal(sessionState.messages[0].state, 'PROCESSED');
});
