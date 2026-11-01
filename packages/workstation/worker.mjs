import { openStore } from './store.mjs';
import { executeOperation } from './operations.mjs';

import { stopChildProcesses } from '../git-core/index.mjs';
let cancelling = false;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  if (cancelling) return; cancelling = true; stopChildProcesses('SIGTERM');
  setTimeout(() => { stopChildProcesses('SIGKILL'); process.exit(143); }, 500);
});

const [optionsText, operationId] = process.argv.slice(2), options = JSON.parse(optionsText);
const store = openStore(options.home);
if (!store.claim(operationId)) { store.close(); process.exit(2); }
try {
  const result = await executeOperation(options, store, store.get(operationId).request);
  store.finish(operationId, 'SUCCEEDED', result);
} catch (error) {
  store.finish(operationId, 'FAILED', undefined, error); process.exitCode = 1;
} finally { store.close(); if(process.connected)process.disconnect(); }
