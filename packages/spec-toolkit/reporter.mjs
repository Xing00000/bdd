import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';

// This reporter runs inside the test process, not inside the workstation API.
// Its receipt is evidence input; the publisher independently validates files/hashes.
export default class EvidenceReporter {
  constructor() {
    this.output = process.env.WB_TASK_OUTPUT;
    this.discovery = process.env.WB_DISCOVERY === '1';
    this.errors = []; this.cases = []; this.definitions = [];
    if (!this.output || !path.isAbsolute(this.output)) throw new Error('WB_TASK_OUTPUT must be an absolute, per-run scratch directory');
    mkdirSync(this.output, { recursive: true });
  }
  printsToStdio() { return false; }
  key(test) {
    const examples = [...test.title.matchAll(/\[case:([A-Za-z0-9][A-Za-z0-9_-]{0,79})\]/g)].map(x => x[1]);
    const tags = (test.tags ?? []).filter(x => x.startsWith('@case:')).map(x => x.slice(6));
    const ids = [...new Set(examples.length ? examples : tags)];
    if (ids.length !== 1) throw new Error(`Exactly one stable case ID is required: ${test.title}`);
    const profile = test.parent.project()?.name ?? '';
    if (![ids[0], profile].every(value => /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value))) throw new Error('Invalid case/profile identifier');
    return { caseId: ids[0], profile, testId: test.id, title: test.title };
  }
  event(value) { appendFileSync(path.join(this.output, 'events.ndjson'), JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n'); }
  guarded(fn) { try { return fn(); } catch (error) { this.errors.push(String(error.message ?? error)); } }
  onBegin(_config, suite) {
    this.guarded(() => { this.definitions = suite.allTests().map(test => this.key(test)); this.event({ type: 'discovery', tests: this.definitions }); });
  }
  onTestBegin(test, result) { this.guarded(() => this.event({ type: 'test.begin', ...this.key(test), retry: result.retry })); }
  onStepEnd(test, result, step) { this.guarded(() => this.event({ type: 'step.end', ...this.key(test), retry: result.retry, title: step.title, category: step.category, failed: Boolean(step.error) })); }
  onError(error) { this.errors.push(error.message ?? String(error)); }
  onTestEnd(test, result) {
    this.guarded(() => {
      const key = this.key(test), caseKey = `${key.caseId}/${key.profile}`;
      const flatten = steps => steps.flatMap(step => [{ title: step.title, category: step.category, failed: Boolean(step.error) }, ...flatten(step.steps ?? [])]);
      const steps = flatten(result.steps ?? []), attachments = [];
      for (const [ordinal, attachment] of (result.attachments ?? []).entries()) {
        const image = attachment.contentType === 'image/png' || attachment.contentType === 'image/jpeg';
        const trace = attachment.name === 'trace' && attachment.contentType === 'application/zip';
        if (!image && !trace) continue;
        const extension = trace ? 'zip' : attachment.contentType === 'image/png' ? 'png' : 'jpg';
        const relative = `${trace ? 'traces' : 'screenshots'}/${caseKey}/attempt-${result.retry}/${String(ordinal).padStart(3, '0')}.${extension}`;
        const destination = path.join(this.output, relative);
        mkdirSync(path.dirname(destination), { recursive: true });
        writeFileSync(destination, attachment.body ?? readFileSync(attachment.path));
        attachments.push({ path: relative, contentType: attachment.contentType, name: attachment.name });
      }
      this.cases.push({ ...key, retry: result.retry, status: result.status, expectedStatus: test.expectedStatus, duration: result.duration,
        assertions: steps.filter(x => x.category === 'expect' && !x.failed).length, steps, attachments,
        errors: (result.errors ?? []).map(x => x.message ?? String(x)) });
      this.event({ type: 'test.end', ...key, retry: result.retry, status: result.status });
    });
  }
  onEnd(result) {
    const receipt = { schemaVersion: 1, mode: this.discovery ? 'DISCOVERY' : 'EXECUTION',
      requirementId: process.env.WB_REQUIREMENT_ID, featureId: process.env.WB_FEATURE_ID,
      definitions: this.definitions, cases: this.cases, errors: this.errors, status: result.status };
    try { writeFileSync(path.join(this.output, this.discovery ? 'discovery.json' : 'execution.json'), JSON.stringify(receipt, null, 2) + '\n'); }
    catch (error) { process.stderr.write(`Evidence reporter failed: ${error.message}\n`); return { status: 'failed' }; }
    if (this.errors.length) return { status: 'failed' };
  }
}
