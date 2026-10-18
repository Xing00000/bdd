import { randomUUID } from 'node:crypto';
import { invalid } from './errors.js';

export type LocatorRecipe = { kind: 'testId' | 'label' | 'css'; value: string };
export type RecordedValue = { kind: 'literal'; value: string } | { kind: 'secretRef'; key: string };
export type RecordedAction = {
  kind: 'navigate' | 'click' | 'fill' | 'selectOption' | 'press' | 'assertion' | 'newPage' | 'popup' | 'unsupported';
  pageId: string; documentId?: string; framePath?: string[]; locator?: LocatorRecipe;
  url?: string; value?: RecordedValue; values?: string[]; key?: string;
  assertionType?: 'visible' | 'text' | 'value'; expected?: string; openerPageId?: string; reason?: string;
  sequence?: number;
};

export function locatorRecipe(input: string): LocatorRecipe {
  if (typeof input !== 'string' || !input.trim()) invalid('A locator is required');
  if (input.startsWith('testId=')) return { kind: 'testId', value: input.slice(7) };
  if (input.startsWith('label=')) return { kind: 'label', value: input.slice(6) };
  return { kind: 'css', value: input };
}

// Called only on the untrusted exposeBinding payload, never as an RPC dispatcher.
export function decodeDomAction(payload: unknown, pageId: string, framePath: string[]): RecordedAction {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) invalid('Invalid DOM recording event');
  const data = payload as Record<string, unknown>;
  if (!['click', 'fill', 'selectOption', 'press', 'unsupported'].includes(String(data.kind))) invalid('Unsupported DOM recording event');
  if (typeof data.documentId !== 'string' || data.documentId.length > 128) invalid('Missing recorder document identity');
  if (data.kind === 'unsupported') return { kind: 'unsupported', pageId, documentId: data.documentId, framePath, reason: 'The recorded element has no replayable locator' };
  const locator = data.locator as Record<string, unknown> | undefined;
  if (!locator || !['testId', 'label', 'css'].includes(String(locator.kind)) || typeof locator.value !== 'string' || !locator.value || locator.value.length > 8192) invalid('Invalid locator recipe');
  const action: RecordedAction = { kind: data.kind as RecordedAction['kind'], pageId, documentId: data.documentId, framePath, locator: { kind: locator.kind as LocatorRecipe['kind'], value: locator.value } };
  if (data.kind === 'fill') {
    const value = data.value as Record<string, unknown> | undefined;
    if (data.sensitive === true) {
      if (!value || value.kind !== 'secretRef' || typeof value.key !== 'string' || !/^WB_SECRET_[A-Z0-9_]{1,112}$/.test(value.key) || 'value' in value) invalid('Sensitive input must contain only a recording-scoped secret reference');
      action.value = { kind: 'secretRef', key: value.key };
    } else if (value?.kind === 'literal' && typeof value.value === 'string') action.value = { kind: 'literal', value: value.value };
    else invalid('Invalid recorded value');
  }
  if (data.kind === 'selectOption') {
    if (!Array.isArray(data.values) || !data.values.every((v) => typeof v === 'string')) invalid('Invalid select values');
    action.values = [...data.values] as string[];
  }
  if (data.kind === 'press') {
    if (typeof data.key !== 'string' || !['Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown'].includes(data.key)) invalid('Unsupported recorded key');
    action.key = data.key;
  }
  return action;
}

export class ActionRecorder {
  readonly id = randomUUID();
  private readonly list: RecordedAction[] = [];
  private sequence = 0;
  append(action: RecordedAction): void {
    const item = structuredClone({ ...action, sequence: ++this.sequence });
    const previous = this.list.at(-1);
    if (item.kind === 'fill' && previous?.kind === 'fill' && item.pageId === previous.pageId && item.documentId === previous.documentId && JSON.stringify(item.framePath) === JSON.stringify(previous.framePath) && JSON.stringify(item.locator) === JSON.stringify(previous.locator)) {
      this.list[this.list.length - 1] = item;
    } else this.list.push(item);
  }
  actions(): RecordedAction[] { return structuredClone(this.list); }
  script(): string { return emitRecording(this.list); }
}

export function emitRecording(actions: readonly RecordedAction[]): string {
  const pages = new Map<string, string>();
  if (actions[0]) pages.set(actions[0].pageId, 'page');
  const q = JSON.stringify;
  const lines = ["import { test, expect } from '@playwright/test';", '', 'function secret(key: string): string {', '  const value = process.env[key];', '  if (value === undefined) throw new Error(`Missing recording secret: ${key}`);', '  return value;', '}', '', "test('使用者錄製腳本', async ({ page, context }) => {"];
  const popupForClick = new Map<number, RecordedAction>();
  const handledPopups = new Set<number>();
  actions.forEach((action, index) => {
    if (action.kind !== 'popup') return;
    // Opener identity alone does not prove which earlier action caused a
    // popup. Only the immediate click can be paired; ambiguous sequences stay
    // an explicit incomplete draft instead of guessing across other actions.
    const i = index - 1, candidate = actions[i];
    if (candidate?.pageId === action.openerPageId && candidate.kind === 'click' && !popupForClick.has(i)) { popupForClick.set(i, action); handledPopups.add(index); }
  });
  actions.forEach((action, index) => {
    if (handledPopups.has(index)) return;
    if (action.kind === 'newPage') {
      const variable = `page${pages.size + 1}`; pages.set(action.pageId, variable);
      lines.push(`  const ${variable} = await context.newPage();`); return;
    }
    const variable = pages.get(action.pageId);
    if (!variable) { lines.push(`  throw new Error(${q('Recording needs manual completion: unresolved page ' + action.pageId)});`); return; }
    const scope = (action.framePath ?? []).reduce((expression, selector) => `${expression}.frameLocator(${q(selector)})`, variable);
    const target = action.locator ? `${scope}.${action.locator.kind === 'testId' ? 'getByTestId' : action.locator.kind === 'label' ? 'getByLabel' : 'locator'}(${q(action.locator.value)})` : undefined;
    if (action.kind === 'navigate') lines.push(`  await ${variable}.goto(${q(action.url)});`);
    else if (action.kind === 'click' && target) {
      const popup = popupForClick.get(index);
      if (popup) {
        const popupVariable = `page${pages.size + 1}`; pages.set(popup.pageId, popupVariable);
        lines.push(`  const [${popupVariable}] = await Promise.all([${variable}.waitForEvent('popup'), ${target}.click()]);`);
      } else lines.push(`  await ${target}.click();`);
    } else if (action.kind === 'fill' && target && action.value) lines.push(`  await ${target}.fill(${action.value.kind === 'secretRef' ? `secret(${q(action.value.key)})` : q(action.value.value)});`);
    else if (action.kind === 'selectOption' && target) lines.push(`  await ${target}.selectOption(${q(action.values)});`);
    else if (action.kind === 'press' && target) lines.push(`  await ${target}.press(${q(action.key)});`);
    else if (action.kind === 'assertion' && target) {
      lines.push(action.assertionType === 'visible' ? `  await expect(${target}).toBeVisible();` : `  await expect(${target}).${action.assertionType === 'value' ? 'toHaveValue' : 'toHaveText'}(${q(action.expected)});`);
    } else lines.push(`  throw new Error(${q('Recording needs manual completion: ' + (action.reason ?? action.kind))});`);
  });
  lines.push('});', '');
  return lines.join('\n');
}

// Serialized by Playwright, so all helpers must live inside this function.
export function installDomRecorder(options: { bindingName: string }): void {
  const host = globalThis as typeof globalThis & Record<string, unknown>;
  if (host.__workbenchRecorderInstalled) return;
  host.__workbenchRecorderInstalled = true;
  const documentId = crypto.randomUUID();
  host.__workbenchRecorderDocumentId = documentId;
  const pending = new Set<Promise<unknown>>();
  const secretNames = new Map<Element, string>();
  let keyboardActivation: { element: Element; form: Element | null } | undefined;
  function recipe(element: Element): LocatorRecipe | undefined {
    const testId = element.getAttribute('data-testid');
    if (testId) return { kind: 'testId', value: testId };
    const labels = (element as HTMLInputElement).labels;
    const label = labels?.[0]?.textContent?.trim();
    if (label) return { kind: 'label', value: label };
    if (element.id) return { kind: 'css', value: '#' + CSS.escape(element.id) };
    const parts: string[] = [];
    for (let current: Element | null = element; current && current !== document.documentElement; current = current.parentElement) {
      const siblings: Element[] = current.parentElement ? [...current.parentElement.children].filter((e) => e.tagName === current!.tagName) : [];
      parts.unshift(current.tagName.toLowerCase() + (siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : ''));
    }
    return parts.length ? { kind: 'css', value: parts.join(' > ') } : undefined;
  }
  function send(payload: Record<string, unknown>): void {
    const binding = host[options.bindingName]; if (typeof binding !== 'function') return;
    const promise = Promise.resolve(binding({ ...payload, documentId })).catch(() => undefined);
    pending.add(promise); void promise.finally(() => pending.delete(promise));
  }
  host.__workbenchRecorderFlush = () => Promise.all([...pending]);
  function target(event: Event): Element | undefined { return event.composedPath().find((node): node is Element => node instanceof Element); }
  document.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    const element = target(event)?.closest('button,a,input,select,textarea,[role="button"],[data-testid]') ?? target(event);
    if (!element) return;
    // Enter can dispatch a trusted, detail=0 activation click on the submit
    // button. The key press already replays that activation; a second recorded
    // click could submit twice or target a button on the next document.
    if (event.detail === 0 && keyboardActivation && (element === keyboardActivation.element || keyboardActivation.form && element.closest('form') === keyboardActivation.form)) return;
    const locator = recipe(element); send(locator ? { kind: 'click', locator } : { kind: 'unsupported' });
  }, true);
  document.addEventListener('input', (event) => {
    if (!event.isTrusted) return;
    const element = target(event); if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLElement && element.isContentEditable)) return;
    if (element instanceof HTMLInputElement && ['checkbox', 'radio', 'file', 'range', 'color'].includes(element.type)) { send({ kind: 'unsupported' }); return; }
    const locator = recipe(element); if (!locator) { send({ kind: 'unsupported' }); return; }
    const sensitive = element.matches('input[type="password"],[data-wb-secret]') || /password|secret|token|credential|api.?key|one-time-code|cc-/.test([element.getAttribute('name'), element.getAttribute('autocomplete')].join(' ').toLowerCase());
    if (sensitive) {
      if (!secretNames.has(element)) secretNames.set(element, `WB_SECRET_${documentId.replaceAll('-', '').slice(0, 8).toUpperCase()}_${secretNames.size + 1}`);
      send({ kind: 'fill', locator, sensitive: true, value: { kind: 'secretRef', key: secretNames.get(element) } });
    } else send({ kind: 'fill', locator, sensitive: false, value: { kind: 'literal', value: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : element.textContent ?? '' } });
  }, true);
  document.addEventListener('change', (event) => {
    if (!event.isTrusted) return;
    const element = target(event);
    if (element instanceof HTMLSelectElement) { const locator = recipe(element); send(locator ? { kind: 'selectOption', locator, values: [...element.selectedOptions].map((o) => o.value) } : { kind: 'unsupported' }); }
  }, true);
  document.addEventListener('keydown', (event) => {
    if (!event.isTrusted || !['Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const element = target(event); const locator = element && recipe(element);
    if (locator) {
      if (event.key === 'Enter' && element) keyboardActivation = { element, form: element.closest('form') };
      send({ kind: 'press', locator, key: event.key });
    }
  }, true);
  document.addEventListener('keyup', (event) => { if (event.key === 'Enter') keyboardActivation = undefined; }, true);
}
