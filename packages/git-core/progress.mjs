import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFileSync, mkdirSync, statSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';

const storage = new AsyncLocalStorage();
const limit = 4 * 1024 * 1024;
export function currentProgress() { return storage.getStore(); }
export function withProgress(home, operationId, callback) {
  const directory = path.join(home, 'development', operationId);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  let bytes = 0, pending = '', osc = false, escape = false, truncated = false;
  try { bytes = statSync(path.join(directory, 'terminal.log')).size; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const marker = '\r\n[output truncated]\r\n';
  const reserve = 4096;
  const append = (text, record = false) => {
    let data = Buffer.from(text);
    if (!record && bytes + data.length > limit - reserve) {
      if (!truncated) { truncated = true; append(marker, true); }
      return;
    }
    if (bytes + data.length > limit) return;
    appendFileSync(path.join(directory, 'terminal.log'), data, { mode: 0o600 }); bytes += data.length;
  };
  const clean = text => text.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '[OSC removed]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/\b(token|password|passwd|secret|authorization|api[_-]?key)\s*[:=]\s*([^\s]+)/gi, '$1=[redacted]')
    .replace(/\bBearer\s+[^\s]+/gi, 'Bearer [redacted]');
  const flush = () => { if (pending) { append(clean(pending)); pending = ''; } };
  const progress = {
    home,
    output(text) { let safe = ''; for (const char of text) { if (osc) { if (char === '\x07' || (escape && char === '\\')) { osc = false; escape = false; safe += '[OSC removed]'; } else escape = char === '\x1b'; } else if (escape) { if (char === ']') { osc = true; escape = false; } else { safe += '\x1b' + char; escape = false; } } else if (char === '\x1b') escape = true; else safe += char; } pending += safe; const end = Math.max(pending.lastIndexOf('\n'), pending.lastIndexOf('\r')); if (end >= 0) { append(clean(pending.slice(0, end + 1))); pending = pending.slice(end + 1); } if (pending.length > 65536) { pending = '[output redacted: unterminated line]\n'; flush(); } },
    record(text) { flush(); append(clean(text), true); },
    exit(outcome) { const target=path.join(directory, 'terminal-exit.json'), temporary=target+'.tmp'; writeFileSync(temporary, JSON.stringify(outcome), { mode: 0o600 }); renameSync(temporary,target); }, flush
  };
  return storage.run(progress, async () => { try { return await callback(); } finally { flush(); } });
}
