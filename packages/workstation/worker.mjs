import { openStore } from './store.mjs';
import { executeOperation } from './operations.mjs';
import { withProgress } from '../git-core/progress.mjs';
import { llmTasks } from './interaction-types.mjs';
import { sdkWorkerShutdownGraceMs } from './agent-lifecycle.mjs';

import { stopChildProcesses } from '../git-core/index.mjs';
let cancelling = false,cancellationTimer;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  if (cancelling) return; cancelling = true; stopChildProcesses('SIGTERM');
  const operation=store.get(operationId);
  const grace=llmTasks.includes(operation.request.operation)?sdkWorkerShutdownGraceMs:500;
  cancellationTimer=setTimeout(() => { stopChildProcesses('SIGKILL'); process.exit(143); }, grace);
});

const [optionsText, operationId] = process.argv.slice(2), options = JSON.parse(optionsText);
const store = openStore(options.home);
if (!store.claim(operationId)) { store.close(); process.exit(2); }
try {
  const result = await withProgress(options.home, operationId, () => executeOperation(options, store, store.get(operationId).request));
  store.finish(operationId, 'SUCCEEDED', result);
} catch (error) {
  store.finish(operationId, 'FAILED', undefined, error); process.exitCode = 1;
} finally { clearTimeout(cancellationTimer);if(cancelling)process.exitCode=143;store.close(); if(process.connected)process.disconnect(); }
