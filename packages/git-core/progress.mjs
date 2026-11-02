import { AsyncLocalStorage } from 'node:async_hooks';
import {openProgressStore} from './progress-store.mjs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const storage = new AsyncLocalStorage();
const limit = 4 * 1024 * 1024;
export function currentProgress() { return storage.getStore(); }
export function withProgress(home, operationId, callback) {
  const database=openProgressStore(home);database.importLegacy(operationId);database.ensure(operationId);
  let pending = '', osc = false, escape = false, inputInteraction=null;
  const truncated=new Set();
  const marker = '\r\n[output truncated]\r\n';
  const processes = database.read(operationId).processes;
  const saveProcesses = () => {
    database.update(operationId,'processes_json',processes);
  };
  const reserve = 4096;
  const append = (text, record = false) => {
    const data = Buffer.from(text);
    for(const target of [operationId,inputInteraction].filter(Boolean)) {
      const used=database.get(target).bytes;
      if(!record&&used+data.length>limit-reserve) {
        if(!truncated.has(target)){truncated.add(target);database.append(target,marker);}
        database.touch(target);continue;
      }
      if(used+data.length<=limit)database.append(target,data);
    }
  };
  const clean = text => text.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '[OSC removed]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/\b(token|password|passwd|secret|authorization|api[_-]?key)\s*[:=]\s*([^\s]+)/gi, '$1=[redacted]')
    .replace(/\bBearer\s+[^\s]+/gi, 'Bearer [redacted]');
  const flush = () => { if (pending) { append(clean(pending)); pending = ''; } };
  const progress = {
    home,
    routeInput(interactionId){flush();const previous=inputInteraction;inputInteraction=interactionId;database.ensure(interactionId);database.update(interactionId,'phase_json',{phase:'RUNNING',parentOperationId:operationId});database.update(interactionId,'processes_json',processes);return previous;},
    startProcess(command, role, pid) {
      const item = { commandId: randomUUID(), command: path.basename(command), role, pid, state: 'RUNNING', startedAt: new Date().toISOString() };
      processes.push(item); saveProcesses(); return item.commandId;
    },
    finishProcess(commandId, outcome) {
      const item = processes.find(p => p.commandId === commandId);
      if (!item) return;
      Object.assign(item, { state: 'EXITED', finishedAt: new Date().toISOString(), exitCode: outcome.exitCode ?? null, signal: outcome.signal ?? null, timedOut: Boolean(outcome.timedOut) });
      const completed = processes.filter(p => p.state === 'EXITED');
      const latestAgent = [...completed].reverse().find(p => p.role === 'agent');
      while (completed.length > 64) { const index = completed.findIndex(p => p !== latestAgent); if (index < 0) break; const [oldest] = completed.splice(index, 1); processes.splice(processes.indexOf(oldest), 1); }
      saveProcesses();
    },
    output(text) { let safe = ''; for (const char of text) { if (osc) { if (char === '\x07' || (escape && char === '\\')) { osc = false; escape = false; safe += '[OSC removed]'; } else escape = char === '\x1b'; } else if (escape) { if (char === ']') { osc = true; escape = false; } else { safe += '\x1b' + char; escape = false; } } else if (char === '\x1b') escape = true; else safe += char; } pending += safe; const end = Math.max(pending.lastIndexOf('\n'), pending.lastIndexOf('\r')); if (end >= 0) { append(clean(pending.slice(0, end + 1))); pending = pending.slice(end + 1); } if (pending.length > 65536) { pending = '[output redacted: unterminated line]\n'; flush(); } },
    record(text) { flush(); append(clean(text), true); },
    exit(outcome) {database.update(operationId,'exit_json',outcome);if(inputInteraction)database.update(inputInteraction,'exit_json',outcome);}, flush
  };
  return storage.run(progress, async () => { try { return await callback(); } finally { try{flush();}finally{database.close();} } });
}
