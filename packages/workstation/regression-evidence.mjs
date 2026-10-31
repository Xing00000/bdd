import path from 'node:path';
import { mkdir, copyFile } from 'node:fs/promises';
import { exists, safePath, readJson, writeJson, walk, invariant, digest } from '../contracts/index.mjs';
import { verifyBundle } from '../spec-toolkit/engine.mjs';
import { readFile } from 'node:fs/promises';

/** One evidence branch contains the suite summary and every available child bundle. */
export async function publishRegression({ root, home, repositoryId, batch, git, push = false }) {
  invariant(batch.repositoryId === repositoryId, 'RUN_REPOSITORY_MISMATCH', '回歸不屬於這個規格庫。', 403);
  const directory = await safePath(home, `regressions/${batch.batchId}`), file = path.join(directory, 'publication.json');
  const publisher = path.join(directory, 'publisher');
  let receipt;
  if (await exists(file)) {
    receipt = await readJson(file);
    invariant(await git.resolve(publisher) === receipt.reportCommit, 'PUBLICATION_CHANGED', '報告發布目錄已改變，沒有覆寫。', 409);
  } else {
    invariant(!await exists(publisher), 'PUBLICATION_RECOVERY_REQUIRED', '報告發布曾中斷，現有證據保留，需先檢查未完成目錄。', 409);
    await git.cloneCandidate(root, publisher, batch.testedSpecCommit);
    const branch = `evidence/${batch.batchId}`;
    await git.branch(publisher, { name: branch, create: true }, await git.inspect(publisher));
    const files = [], children = [];
    for (const result of batch.results) {
      if (!result.runId) continue;
      const source = await safePath(home, `executions/${result.runId}/evidence`);
      if (!await exists(source)) continue;
      const manifest = await verifyBundle(source);
      invariant(manifest.batchId === batch.batchId && manifest.testedSpecCommit === batch.testedSpecCommit, 'BATCH_EVIDENCE_MISMATCH', result.key);
      const prefix = `reports/${result.key}/${result.runId}`;
      for (const name of await walk(source)) {
        const relative = `${prefix}/${name}`, target = await safePath(publisher, relative);
        invariant(!await exists(target), 'REPORT_EXISTS', '同一執行報告已存在，不會覆寫。', 409);
        await mkdir(path.dirname(target), { recursive: true });
        await copyFile(path.join(source, name), target); files.push(relative);
      }
      children.push({ key: result.key, runId: result.runId, path: prefix, manifestHash: digest(await readFile(path.join(source, 'manifest.json'))) });
    }
    const relative = `reports/_runs/${batch.batchId}/summary.json`;
    const { publication, publicationError, ...summary } = batch;
    await writeJson(await safePath(publisher, relative), { ...summary, mode: 'REGRESSION', children }); files.push(relative);
    const committed = await git.commitSelected(publisher, { paths: files, message: `Record complete regression ${batch.batchId}` }, await git.inspect(publisher));
    receipt = { batchId: batch.batchId, testedSpecCommit: batch.testedSpecCommit, reportCommit: committed.commit, branch, status: 'LOCAL_COMMIT' };
    await writeJson(file, receipt);
  }
  if (push && receipt.status !== 'PUBLISHED') {
    const url = (await git.command(root, ['remote', 'get-url', 'origin'])).stdout.trim();
    await git.command(publisher, ['remote', 'set-url', 'origin', url]);
    await git.push(publisher, { branch: receipt.branch }, await git.inspect(publisher));
    receipt = { ...receipt, status: 'PUBLISHED' }; await writeJson(file, receipt);
  }
  return receipt;
}
