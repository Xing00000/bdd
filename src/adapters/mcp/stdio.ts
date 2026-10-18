import readline from 'node:readline';

const mcpUrl = process.env.WB_MCP_URL ?? 'http://127.0.0.1:4173/mcp';
const sessionId = process.env.WB_MCP_SESSION ?? '';

async function forwardMessage(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return;
  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      }) + '\n',
    );
    return;
  }
  try {
    const response = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(sessionId ? { 'x-workbench-mcp-session': sessionId } : {}),
      },
      body: JSON.stringify(parsed),
    });
    const body = await response.json();
    if (parsed.id !== undefined) {
      process.stdout.write(JSON.stringify(body) + '\n');
    }
  } catch (error) {
    if (parsed.id !== undefined) {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: parsed.id ?? null,
          error: { code: -32603, message: String((error as Error).message) },
        }) + '\n',
      );
    }
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
let queue: Promise<void> = Promise.resolve();
rl.on('line', line => {
  queue = queue.then(() => forwardMessage(line));
});
