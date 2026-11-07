#!/usr/bin/env node
import readline from 'node:readline';
import { createAgentSupervisor, supervisorRpc } from '../packages/workstation/agent-supervisor.mjs';

const home = process.argv[2] || process.env.WB_HOME;
const defaultRepositoryId = process.argv[3] || process.env.WB_REPOSITORY_ID || null;
const defaultOperationId = process.argv[4] || process.env.WB_OPERATION_ID || null;
const defaultCwd = process.argv[5] || process.env.WB_AGENT_SUPERVISOR_CWD || null;
const supervisor = await createAgentSupervisor({ home, defaultRepositoryId, defaultOperationId, defaultCwd });

try {
  for await (const line of readline.createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    let response;
    try {
      response = await supervisorRpc(supervisor, JSON.parse(line));
    } catch {
      response = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } };
    }
    if (response) process.stdout.write(JSON.stringify(response) + '\n');
  }
} finally {
  await supervisor.close();
}
