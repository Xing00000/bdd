import os from 'node:os';
import { workflowMain, workflowHelp } from './workflow-cli.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createWorkstation } from './service.mjs';
import { createStandaloneServer } from './http.mjs';
import { invariant, errorResult } from '../contracts/index.mjs';

export function environmentOptions() {
  return {
    home: path.resolve(process.env.WB_HOME ?? path.join(os.homedir(), '.bdd-workstation')),
    browserRoot: process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.resolve(process.env.WB_HOME ?? path.join(os.homedir(), '.bdd-workstation'), 'browsers'),
    toolkitRoot: fileURLToPath(new URL('../../', import.meta.url)),
    allowLocal: process.env.WB_ALLOW_LOCAL_GIT === '1',
    legacyFile: process.env.WB_LEGACY_DB ? path.resolve(process.env.WB_LEGACY_DB) : undefined,
    legacyArtifactsRoot: process.env.WB_LEGACY_ARTIFACTS ? path.resolve(process.env.WB_LEGACY_ARTIFACTS) : undefined,
    // The loopback workstation can confirm and execute tests out of the box.
    // Explicit opt-out remains available for read-only or untrusted hosts.
    enableExecution: !['0', 'false', 'off'].includes((process.env.WB_ENABLE_TRUSTED_EXECUTION ?? '').trim().toLowerCase()),
    hosts: (process.env.WB_GIT_HOSTS ?? 'github.com').split(',').map(x => x.trim()).filter(Boolean)
  };
}
async function stdinJson() {
  let text = '';
  for await (const chunk of process.stdin) { text += chunk.toString(); invariant(Buffer.byteLength(text) <= 2 * 1024 * 1024, 'REQUEST_TOO_LARGE', 'stdin exceeds 2 MiB'); }
  return text.trim() ? JSON.parse(text) : {};
}
export async function main(command = process.argv[2]) {
  let service;
  try {
    if(command==='workflow')return await workflowMain(process.argv.slice(3),environmentOptions());
    if (!command || command === 'help') {
      process.stdout.write(workflowHelp+'\nLegacy JSON commands:\n');
      process.stdout.write('BDD workstation CLI\n  repository.setup | repository.save | repository.sync | repository.location\n  workflow.create | workflow.review | workflow.verify\n  serve | register | list | detail | inspect | wait | cancel\n  repository.clone | repository.initialize | repository.validate\n  spec.feature.create | spec.file.save | spec.review.confirm\n  git.fetch | git.branch | git.commit | git.push\n  submodule.add | submodule.restore | submodule.pin | submodule.remove\n  run.prepare | run.execute | run.publish\n  repository.upgrade.preview | repository.upgrade.apply | repository.transaction.resume\n  legacy.preview | legacy.import | reports.reindex\nRead JSON from stdin. WB_HOME selects persistent state. Mutations require inspected expected.head.\n'); return;
    }
    const options = environmentOptions();
    if (command === 'serve') {
      const port = Number(process.env.WB_PORT ?? process.env.WB_REPOSITORY_PORT ?? 4173);
      invariant(Number.isInteger(port) && port >= 1 && port <= 65535, 'INVALID_PORT', 'Invalid listen port');
      const app = await createStandaloneServer(options);
      await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(port, '127.0.0.1', resolve); });
      process.stderr.write(`BDD workstation: http://127.0.0.1:${port}/\n`);
      let closing = false;
      for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { if (!closing) { closing = true; void app.close().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; }); } });
      return;
    }
    const input = await stdinJson(); service = await createWorkstation(options);
    let result;
    if (command === 'register') { result=service.register(input); if(result.connection?.operationId){await service.wait(result.connection.operationId,1800000);result.connection=(await service.detail(result.id)).connection;} }
    else if (command === 'list') result = service.list();
    else if (command === 'detail') result = await service.detail(input.repositoryId);
    else if (command === 'inspect') result = await service.inspect(input.repositoryId, input.projectId);
    else if (command === 'wait') result = await service.wait(input.operationId, 1800000);
    else if (command === 'cancel') result = service.cancel(input.operationId);
    else {
      const request = { schemaVersion: 1, operationId: input.operationId ?? `OP-${randomUUID()}`, ...input, operation: command };
      request.input ??= {};
      service.enqueue(request); result = await service.wait(request.operationId, 1800000);
      if (result.status !== 'SUCCEEDED') process.exitCode = 1;
    }
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) { process.stdout.write(JSON.stringify({ status: 'FAILED', error: errorResult(error) }) + '\n'); process.exitCode = 1; }
  finally { if (service) await service.close(); }
}
