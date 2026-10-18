import { randomUUID } from 'node:crypto';
import type { Reporter, TestCase, TestResult, FullResult } from '@playwright/test/reporter';

/** Events come from the runner's real reporter hooks; HTTP failures fail the run. */
export default class WorkbenchReporter implements Reporter {
  private queue: Promise<void> = Promise.resolve();
  private errors: string[] = [];
  private send(type: string, test?: TestCase, result?: TestResult, extra: Record<string, unknown> = {}) {
    const testKey = test?.annotations.find(annotation => annotation.type === 'workbenchTestId')?.description ?? test?.titlePath().slice(3).join(' › ');
    const payload = {eventId: randomUUID(), type, runId: process.env.WB_RUN_ID, testKey,
      payload: {runnerStatus: result?.status, expectedStatus: test?.expectedStatus, errors: result?.errors.map(error => error.message ?? error.value), ...extra}};
    this.queue = this.queue.then(async () => {
      const response = await fetch(new URL(`/internal/runs/${process.env.WB_RUN_ID}/events`, process.env.WB_BASE_URL), {
        method: 'POST', headers: {'content-type': 'application/json', 'x-workbench-run-token': process.env.WB_RUN_EVENT_TOKEN ?? ''}, body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw Error(`Runner event ${type}: ${response.status} ${await response.text()}`);
    }).catch(error => { this.errors.push(String(error)); });
  }
  onTestBegin(test: TestCase) { this.send('run.testStarted', test); }
  onTestEnd(test: TestCase, result: TestResult) { this.send('run.testFinished', test, result); }
  onError(error: {message?: string; value?: string}) { this.errors.push(error.message ?? error.value ?? 'Unknown runner error'); }
  async onEnd(result: FullResult) {
    await this.queue;
    this.send('run.completed', undefined, undefined, {runnerStatus: result.status, errors: [...this.errors]});
    await this.queue;
    return this.errors.length ? {status: 'failed' as const} : undefined;
  }
}
