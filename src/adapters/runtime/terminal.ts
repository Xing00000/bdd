import { randomUUID } from 'node:crypto';
import type { IPty } from 'node-pty';
import type { TerminalRuntimePort } from '../../ports/runtime.js';
import { RuntimeAdapterError, invalid } from './errors.js';
import { existingWorkspacePath } from './paths.js';

type TerminalEvent = { type: string; data?: string; exitCode?: number };
type TerminalState = { process: IPty; listeners: Set<(event: TerminalEvent) => void>; history: TerminalEvent[]; exited: boolean };

export class PtyTerminalAdapter implements TerminalRuntimePort {
  private readonly sessions = new Map<string, TerminalState>();
  private closed = false;
  private readonly workspaceRoot: string;
  constructor(workspaceRoot: string) { this.workspaceRoot = workspaceRoot; }

  async create(input: { workspaceRef: string; cols?: number; rows?: number }): Promise<{ id: string }> {
    if (this.closed) throw new RuntimeAdapterError('RUNTIME_CLOSED', 'Terminal runtime is closed', 409);
    const cwd = await existingWorkspacePath(this.workspaceRoot, input.workspaceRef, 'directory');
    const cols = dimension(input.cols ?? 100), rows = dimension(input.rows ?? 30);
    let process: IPty;
    try {
      const pty = await import('node-pty');
      // Deliberately do not forward provider tokens, DB credentials, or the full
      // server environment. Execution inherits the existing cloud isolation.
      process = pty.spawn('/bin/bash', ['--noprofile', '--norc'], {
        cwd, cols, rows, name: 'xterm-256color',
        env: { PATH: globalThis.process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8', TERM: 'xterm-256color' },
      });
    } catch (cause) {
      throw new RuntimeAdapterError('TERMINAL_UNAVAILABLE', 'A real node-pty terminal could not be started', 503, { cause });
    }
    const id = randomUUID();
    const state: TerminalState = { process, listeners: new Set(), history: [], exited: false };
    this.sessions.set(id, state);
    const emit = (event: TerminalEvent) => {
      state.history.push(event);
      // Only a reconnect buffer; this is not a substitute for the PTY output.
      while (state.history.length > 256) state.history.shift();
      for (const listener of state.listeners) { try { listener(event); } catch { /* Subscriber owns its transport failure. */ } }
    };
    process.onData((data) => emit({ type: 'terminal.output', data }));
    process.onExit(({ exitCode }) => { state.exited = true; emit({ type: 'terminal.exited', exitCode }); });
    return { id };
  }

  private state(id: string): TerminalState {
    const state = this.sessions.get(id);
    if (!state) throw new RuntimeAdapterError('RUNTIME_NOT_FOUND', 'Terminal does not exist', 404);
    return state;
  }
  input(id: string, data: string): void {
    const state = this.state(id);
    if (state.exited) throw new RuntimeAdapterError('TERMINAL_EXITED', 'Terminal process has exited', 409);
    if (typeof data !== 'string') invalid('Terminal input must be text');
    state.process.write(data);
  }
  resize(id: string, cols: number, rows: number): void { this.state(id).process.resize(dimension(cols), dimension(rows)); }
  subscribe(id: string, listener: (event: TerminalEvent) => void): () => void {
    const state = this.state(id);
    state.listeners.add(listener);
    for (const event of state.history) listener(event);
    return () => { state.listeners.delete(listener); };
  }
  closeTerminal(id: string): void {
    const state = this.state(id);
    if (!state.exited) state.process.kill('SIGHUP');
  }
  close(): void {
    this.closed = true;
    for (const id of this.sessions.keys()) this.closeTerminal(id);
  }
}

function dimension(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 65535) invalid('PTY dimensions must be positive terminal dimensions');
  return value;
}
