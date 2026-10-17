import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { Browser, BrowserContext, Page, TestInfo, APIRequestContext } from '@playwright/test';

// Resolve the same installation as the child CLI, avoiding two Playwright test registries.
const require = createRequire(resolve(process.env.WB_WORKBENCH_ROOT ?? process.cwd(), 'package.json'));
const {test: base, expect: nativeExpect, chromium} = require('@playwright/test') as typeof import('@playwright/test');
type Identity = {sessionId: string; contextRef: string; pageId: string};
type Execution = {runId: string; testKey: string; testDefinitionId: string; sourceCaseId: string; app: Identity & {playwrightEndpoint: string}};
const wrapped = new WeakMap<object, object>();
let active: ReplayCapture | undefined;

class ReplayCapture {
  private index = 0;
  private proxies = new WeakMap<object, any>();
  private queue: Promise<unknown> = Promise.resolve();
  private errors: unknown[] = [];
  private unsupportedError: Error | undefined;
  constructor(readonly page: Page, readonly execution: Execution, readonly request: APIRequestContext, readonly info: TestInfo) {}
  private async event(type: string, payload: object, bindingSeq?: number) {
    const response = await this.request.post(`/internal/runs/${this.execution.runId}/events`, {data: {
      eventId: randomUUID(), type, runId: this.execution.runId, testKey: this.execution.testKey, testDefinitionId: this.execution.testDefinitionId,
      sourceCaseId: this.execution.sourceCaseId, ...this.execution.app, bindingSeq, payload,
    }});
    if (!response.ok()) throw Error(`Replay evidence rejected: ${response.status()} ${await response.text()}`);
    return response.json();
  }
  capture<T>(label: string, action: () => Promise<T> | T, assertion = false, expected?: unknown, actualValue?: () => Promise<unknown>): Promise<T> {
    const result = this.queue.then(() => this.perform(label, action, assertion, expected, actualValue));
    this.queue = result.catch(error => {this.errors.push(error);});
    return result;
  }
  unsupported(reason: string): Error {
    this.unsupportedError ??= new Error('UNSUPPORTED_MANAGED_PAGE: ' + reason);
    return this.unsupportedError;
  }
  async flush() {
    await this.queue;
    if (this.unsupportedError) throw this.unsupportedError;
    if (this.errors.length && this.info.status !== 'failed' && this.info.status !== 'timedOut') throw this.errors[0];
  }
  syncAssertion<T>(label: string, action: () => T, expected: unknown, actualValue: () => Promise<unknown>): T {
    let value: T, failed: unknown;
    try {value = action();} catch (error) {failed = error;}
    // Preserve synchronous matcher semantics while the fixture drains evidence before teardown.
    void this.capture(label, () => {if (failed) throw failed; return value;}, true, expected, actualValue).catch(() => {});
    if (failed) throw failed;
    return value!;
  }
  private async perform<T>(label: string, action: () => Promise<T> | T, assertion = false, expected?: unknown, actualValue?: () => Promise<unknown>): Promise<T> {
    const binding = await this.event('run.browserBound', {}), actionIndex = ++this.index;
    let originalError: any, actual: unknown;
    try { const result = await action(); actual = actualValue ? await actualValue() : undefined; return result; }
    catch (error) { originalError = error; actual = (error as any)?.matcherResult?.actual; expected = (error as any)?.matcherResult?.expected ?? expected; throw error; }
    finally {
      let image: Buffer | undefined, imageError: unknown;
      try { image = await this.page.screenshot(); await this.info.attach(`${actionIndex}-${originalError ? 'failure' : 'after'}-${label}`, {body: image, contentType: 'image/png'}); }
      catch (error) { imageError = error; }
      try {
        await this.event('run.stepFinished', {sourceStepId: `recording:${actionIndex}`, actionIndex, label, assertion, assertionPassed: assertion ? !originalError : null,
          expected: expected ?? null, actual: actual ?? null, status: originalError ? 'FAILED' : imageError ? 'INCOMPLETE' : 'PASSED', error: originalError ? String(originalError) : imageError ? String(imageError) : null,
          screenshot: image ? {moment: originalError ? 'failure' : assertion ? 'after_assertion' : 'after_action', sha256: createHash('sha256').update(image).digest('hex'), contentType: 'image/png', base64: image.toString('base64')} : null}, binding.bindingSeq);
      } catch (error) { if (!originalError) throw error; }
      if (imageError && !originalError) throw imageError;
    }
  }
  wrap<T extends object>(target: T): T {
    if (this.proxies.has(target)) return this.proxies.get(target);
    const locators = new Set(['locator', 'getByRole', 'getByText', 'getByLabel', 'getByTestId', 'getByPlaceholder', 'getByAltText', 'getByTitle', 'filter', 'first', 'last', 'nth', 'and', 'or']);
    const actions = new Set(['goto', 'reload', 'goBack', 'goForward', 'evaluate', 'click', 'dblclick', 'fill', 'clear', 'press', 'type', 'pressSequentially', 'check', 'uncheck', 'setChecked', 'selectOption', 'setInputFiles', 'hover', 'focus', 'blur', 'dragTo', 'tap']);
    const proxy = new Proxy(target, {get: (object: any, property: string | symbol) => {
      const value = object[property];
      if (property === 'keyboard' || property === 'mouse' || property === 'touchscreen') return this.wrap(value);
      if (typeof value !== 'function') return value;
      if (property === 'newPage' || property === 'newContext' || property === 'newCDPSession' || property === 'newBrowserCDPSession')
        return () => {throw this.unsupported('Independent replay currently supports its initial managed page and context only');};
      if (property === 'context' || property === 'browser' || property === 'page') return (...args: unknown[]) => {
        const result = value.apply(object, args); return result ? this.wrap(result) : result;
      };
      if (property === 'pages' || property === 'contexts') return (...args: unknown[]) => value.apply(object, args).map((member: object) => this.wrap(member));
      if (typeof property === 'string' && locators.has(property)) return (...args: unknown[]) => this.wrap(value.apply(object, args));
      if (typeof property === 'string' && actions.has(property)) return (...args: unknown[]) => this.capture(property, () => value.apply(object, args.map(arg => arg && typeof arg === 'object' ? wrapped.get(arg as object) ?? arg : arg)));
      return value.bind(object);
    }});
    this.proxies.set(target, proxy); wrapped.set(proxy, target); return proxy;
  }
}

async function resolvePage(browser: Browser, identity: Identity) {
  const matches: Page[] = [];
  for (const context of browser.contexts()) for (const page of context.pages()) {
    const marker = await page.evaluate(() => (globalThis as any).__workbenchManaged).catch(() => null);
    if (marker && marker.sessionId === identity.sessionId && marker.contextRef === identity.contextRef && marker.pageId === identity.pageId) matches.push(page);
  }
  if (matches.length !== 1) throw Error(`Managed page must resolve uniquely; found ${matches.length}`);
  return matches[0];
}
type Fixtures = {_workbenchReplay: {capture: ReplayCapture; browser: Browser; page: Page; context: BrowserContext}};
export const test = base.extend<Fixtures>({
  _workbenchReplay: async ({request}, use, info) => {
    const runId = process.env.WB_RUN_ID, testKey = info.annotations.find(annotation => annotation.type === 'workbenchTestId')?.description ?? info.titlePath.slice(1).join(' › ');
    if (!runId) throw Error('Replay requires a real workbench run ID');
    const response = await request.get(`/internal/runs/${runId}/tests/${encodeURIComponent(testKey)}/execution-context`);
    if (!response.ok()) throw Error(await response.text());
    const execution = await response.json() as Execution;
    const browser = await chromium.connect(execution.app.playwrightEndpoint);
    try {
      const page = await resolvePage(browser, execution.app), capture = new ReplayCapture(page, execution, request, info);
      const context = page.context();
      const onNewPage = () => {capture.unsupported('A popup or additional page was created; its identity and complete evidence are not supported by this replay adapter');};
      context.on('page', onNewPage);
      active = capture;
      try {await use({capture, browser, page, context});}
      finally {context.off('page', onNewPage); await capture.flush();}
    } finally { active = undefined; await browser.close(); }
  },
  page: async ({_workbenchReplay}, use) => { await use(_workbenchReplay.capture.wrap(_workbenchReplay.page)); },
  context: async ({_workbenchReplay}, use) => { await use(_workbenchReplay.capture.wrap(_workbenchReplay.context)); },
  browser: async ({}, _use) => {throw new Error('UNSUPPORTED_MANAGED_PAGE: Independent replay cannot request an unmanaged browser fixture');},
});

function actualFor(value: any, method: string) {
  return async () => {
    if (!value || typeof value !== 'object') return value;
    if (method.includes('Text') && typeof value.innerText === 'function') return value.innerText();
    if (method.includes('Value') && typeof value.inputValue === 'function') return value.inputValue();
    if (method === 'toBeVisible' && typeof value.isVisible === 'function') return value.isVisible();
    if (method === 'toBeEditable' && typeof value.isEditable === 'function') return value.isEditable();
    if (method === 'toBeEnabled' && typeof value.isEnabled === 'function') return value.isEnabled();
    if (method === 'toHaveURL' && typeof value.url === 'function') return value.url();
    return String(value);
  };
}
function wrapMatchers(matchers: any, value: any): any {
  return new Proxy(matchers, {get(target, property: string | symbol) {
    const member = target[property];
    if (typeof member === 'function' && typeof property === 'string') return (...args: any[]) => {
      if (!active) return member.apply(target, args);
      const synchronous = new Set(['toBe', 'toEqual', 'toStrictEqual', 'toBeTruthy', 'toBeFalsy', 'toBeNull', 'toBeUndefined', 'toBeDefined', 'toBeNaN', 'toBeGreaterThan', 'toBeGreaterThanOrEqual', 'toBeLessThan', 'toBeLessThanOrEqual', 'toContain', 'toContainEqual', 'toMatch', 'toMatchObject', 'toHaveLength', 'toHaveProperty', 'toBeInstanceOf', 'toBeCloseTo', 'toThrow']);
      if (synchronous.has(property)) return active.syncAssertion(property, () => member.apply(target, args), args[0] ?? true, actualFor(value, property));
      return active.capture(property, () => member.apply(target, args), true, args[0] ?? true, actualFor(value, property));
    };
    return member && typeof member === 'object' ? wrapMatchers(member, value) : member;
  }});
}
export const expect: typeof nativeExpect = new Proxy(nativeExpect, {apply(target, thisArgument, argumentsList) {
  const value = argumentsList[0] && typeof argumentsList[0] === 'object' ? wrapped.get(argumentsList[0]) ?? argumentsList[0] : argumentsList[0];
  return wrapMatchers(Reflect.apply(target, thisArgument, [value, ...argumentsList.slice(1)]), value);
}});
