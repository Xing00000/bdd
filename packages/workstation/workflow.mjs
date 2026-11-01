import { digest, identity, invariant } from '../contracts/index.mjs';
import { ensureDraft, inDraftView, sourceFiles } from './authoring.mjs';
import { scan, reviewState } from '../spec-toolkit/index.mjs';
import { workflowState, recordedWorkflow, refreshWorkflowFiles, liveWorkflowModules } from './workflow-state.mjs';

export async function workflowStatus(context, selection) {
  const repositoryId = context.repositoryId ?? context.request?.repositoryId;
  const snapshot = await ensureDraft({ ...context, repositoryId });
  const modules = await liveWorkflowModules({...context,repositoryId},snapshot);
  return inDraftView(snapshot, async root => {
    const data = await scan(root), workflows = [];
    for (const f of data.features) {
      if (selection && f.key !== selection && f.requirementId !== selection) continue;
      f.review = await reviewState(root, f.requirementId, f.id);
      const value = workflowState(f, modules, context.store.runs(repositoryId), context.store.reports(repositoryId), data.config.specRepositoryId);
      value.portableState = await recordedWorkflow(root, f, value); value.title = f.title;
      workflows.push(value);
    }
    invariant(!selection || workflows.length, 'FEATURE_NOT_FOUND', '找不到所選需求或功能。', 404);
    return { schemaVersion: 1, repositoryId, specRepositoryId: data.config.specRepositoryId,
      revision: snapshot.revision, configured: Boolean(snapshot.settings.configured),
      persistence:{storage:'sqlite',exportedRevision:context.store.projection(repositoryId)?.revision??null,synchronized:context.store.syncReceipt(repositoryId)?.sourceRevision===snapshot.revision}, workflows };
  });
}
/** Save only machine-owned status files using the same SQLite history/CAS as authoring.
 * A sync exports them with their sources. Reading a state never rewrites a checkout.
 */
export async function persistWorkflowState(context) {
  const { store, request } = context, repositoryId = request.repositoryId;
  for (let attempt = 0; attempt < 4; attempt++) {
    const snapshot = await ensureDraft({ ...context, repositoryId });
    const modules=await liveWorkflowModules({...context,repositoryId},snapshot);
    const changes = await inDraftView(snapshot, async root => {
      const paths = await refreshWorkflowFiles(root, { modules,
        runs: store.runs(repositoryId), reports: store.reports(repositoryId) });
      if (!paths.length) return [];
      return (await sourceFiles(root)).filter(f => paths.includes(f.path)).map(f => ({ ...f,
        baseHash: snapshot.files.find(x => x.target === f.target && x.path === f.path)?.baseHash ?? null }));
    });
    if (!changes.length) return;
    try {
      store.saveDraft(repositoryId, { expectedRevision: snapshot.revision, files: changes,
        operationId: `state-${identity({ id: request.operationId, revision: snapshot.revision }).slice(0,40)}`,
        request: { operation: 'workflow.state', sourceRevision: snapshot.revision, changes: changes.map(f => [f.path, digest(f.content)]) }, result: { workflowState: true } });
      return;
    } catch (error) { if (error.code !== 'DRAFT_REVISION_CHANGED' || attempt === 3) throw error; }
  }
}
