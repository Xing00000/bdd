import { createHash, randomUUID } from 'node:crypto';
import type { Browser, BrowserContext, Frame, Locator, Page } from 'playwright';
import type { BrowserAttachment, BrowserEvent, BrowserInput, BrowserRuntimePort } from '../../ports/runtime.js';
import { RuntimeAdapterError, invalid, requiredText } from './errors.js';
import { ActionRecorder, decodeDomAction, installDomRecorder, locatorRecipe, type LocatorRecipe } from './recorder.js';

type ManagedPage = { id: string; page: Page; ready: Promise<void>; lastFrame?: BrowserEvent };
type Session = {
  id: string; contextRef: string; context: BrowserContext; endpoint: string; activePageId: string;
  pages: Map<string, ManagedPage>; pageIds: WeakMap<Page, string>; listeners: Set<(event: BrowserEvent) => void>;
  frameSequence: number; lastFrame?: BrowserEvent; queuedFrame?: BrowserEvent; frameScheduled: boolean;
  inputTail: Promise<void>; recordTail: Promise<void>; recorder?: ActionRecorder; closed: boolean;
};

export class PlaywrightBrowserAdapter implements BrowserRuntimePort {
  private sessions = new Map<string, Session>();
  private launched?: Promise<{ endpoint: string; browser: Browser }>;
  private closed = false;

  private launch(): Promise<{ endpoint: string; browser: Browser }> {
    if (this.closed) return Promise.reject(new RuntimeAdapterError('RUNTIME_CLOSED', 'Browser runtime is closed', 409));
    if (!this.launched) this.launched = (async () => {
      let browser: Browser | undefined;
      try {
        const { chromium } = await import('playwright');
        // Only the official installed browser. No executable fallback, sandbox
        // override, alternate download host, or externally exposed RPC endpoint.
        browser = await chromium.launch({ headless: true, chromiumSandbox: true });
        const { endpoint } = await browser.bind('BDD workbench managed browser', { host: '127.0.0.1', port: 0 });
        return { endpoint, browser };
      } catch (cause) {
        await browser?.close().catch(() => undefined);
        this.launched = undefined;
        throw new RuntimeAdapterError('BROWSER_UNAVAILABLE', 'Official Playwright Chromium with sandbox is unavailable; no live browser was created', 503, { cause });
      }
    })();
    return this.launched;
  }

  async create(input: { projectId: string; workspaceRef?: string; targetUrl?: string }): Promise<BrowserAttachment> {
    requiredText(input.projectId, 'projectId');
    if (input.targetUrl) navigationUrl(input.targetUrl);
    const { browser, endpoint } = await this.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: false });
    const session: Session = {
      id: randomUUID(), contextRef: randomUUID(), context, endpoint, activePageId: '',
      pages: new Map(), pageIds: new WeakMap(), listeners: new Set(), frameSequence: 0, frameScheduled: false,
      inputTail: Promise.resolve(), recordTail: Promise.resolve(), closed: false,
    };
    this.sessions.set(session.id, session);
    const bindingName = '__wbCapture_' + randomUUID().replaceAll('-', '');
    try {
      await context.exposeBinding(bindingName, (source, payload: unknown) => {
        if (!session.recorder || session.closed) return;
        // Page/frame identity comes from Playwright, never from page payload.
        const recorder = session.recorder;
        const pageId = session.pageIds.get(source.page);
        if (!pageId || source.frame.isDetached()) return;
        const operation = session.recordTail.then(async () => {
          const path = await framePath(source.frame);
          const action = decodeDomAction(payload, pageId, path);
          if (action.kind === 'fill' && action.locator) {
            // Do not trust a page-provided sensitivity flag or environment key.
            const sensitive = await resolveLocator(source.frame, action.locator).evaluate(isSensitiveElement);
            if (sensitive || action.value?.kind === 'secretRef') action.value = { kind: 'secretRef', key: 'WB_SECRET_' + createHash('sha256').update(JSON.stringify([pageId, path, action.locator])).digest('hex').slice(0, 16).toUpperCase() };
          }
          recorder.append(action);
        });
        session.recordTail = operation.catch((error) => {
          recorder.append({ kind: 'unsupported', pageId, reason: 'A DOM event could not be recorded faithfully' });
          this.emit(session, 'recording.warning', { code: 'UNRECORDABLE_ACTION', message: error instanceof Error ? error.message : String(error) });
        });
        return operation.catch(() => undefined);
      });
      await context.addInitScript(installDomRecorder, { bindingName });
      context.on('page', (page) => { void this.registerPage(session, page).catch((error) => this.emit(session, 'browser.error', { message: String(error) })); });
      const page = await context.newPage();
      const managed = await this.registerPage(session, page);
      session.activePageId = managed.id;
      await managed.ready;
      if (input.targetUrl) await page.goto(input.targetUrl);
      return this.attachment(session.id);
    } catch (error) { await this.closeSession(session.id); throw error; }
  }

  private async registerPage(session: Session, page: Page): Promise<ManagedPage> {
    const previousId = session.pageIds.get(page);
    if (previousId) return session.pages.get(previousId)!;
    const id = randomUUID();
    const recorderAtCreation = session.recorder;
    const managed: ManagedPage = { id, page, ready: Promise.resolve() };
    session.pageIds.set(page, id); session.pages.set(id, managed);
    if (!session.activePageId) session.activePageId = id;
    managed.ready = (async () => {
      const binding = { sessionId: session.id, contextRef: session.contextRef, pageId: id };
      const marker = (value: typeof binding) => {
        const previous = (globalThis as typeof globalThis & { __workbenchManaged?: typeof binding }).__workbenchManaged;
        if (previous?.sessionId === value.sessionId && previous.contextRef === value.contextRef && previous.pageId === value.pageId) return;
        Object.defineProperty(globalThis, '__workbenchManaged', { value, configurable: false, writable: false });
      };
      await page.addInitScript(marker, binding);
      await page.evaluate(marker, binding);
      const opener = await page.opener();
      // Associate a page with the recording active when it was observed, not
      // whichever recording happens to be active when asynchronous setup ends.
      if (recorderAtCreation) recorderAtCreation.append(opener ? { kind: 'popup', pageId: id, openerPageId: session.pageIds.get(opener) } : { kind: 'newPage', pageId: id });
      page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) this.emit(session, 'browser.pageChanged', { url: page.url() }, id); });
      page.on('close', () => {
        session.pages.delete(id);
        this.emit(session, 'browser.pageClosed', {}, id);
        if (session.activePageId === id) { session.activePageId = session.pages.keys().next().value ?? ''; session.lastFrame = undefined; session.queuedFrame = undefined; }
      });
      await page.screencast.start({ onFrame: ({ data, timestamp, viewportWidth, viewportHeight }) => {
        if (session.closed) return;
        const event: BrowserEvent = { type: 'browser.frame', ...binding, payload: { sha256: createHash('sha256').update(data).digest('hex'), timestamp, viewportWidth, viewportHeight, frameSequence: ++session.frameSequence }, image: data };
        managed.lastFrame = event;
        if (session.activePageId !== id) return;
        session.lastFrame = event;
        session.queuedFrame = event; // Bounded latest-frame slot, no growing JPEG queue.
        if (!session.frameScheduled) {
          session.frameScheduled = true;
          setImmediate(() => {
            session.frameScheduled = false;
            const latest = session.queuedFrame; session.queuedFrame = undefined;
            if (latest && !session.closed && latest.pageId === session.activePageId) for (const listener of session.listeners) { try { listener(latest); } catch { /* Transport handles backpressure/disconnection. */ } }
          });
        }
      } });
      this.emit(session, 'browser.pageCreated', { url: page.url() }, id);
    })();
    return managed;
  }

  private session(id: string): Session {
    const session = this.sessions.get(id);
    if (!session || session.closed) throw new RuntimeAdapterError('RUNTIME_NOT_FOUND', 'Browser session does not exist', 404);
    return session;
  }
  attachment(sessionId: string): BrowserAttachment {
    const session = this.session(sessionId);
    return { id: session.id, sessionId: session.id, contextRef: session.contextRef, pageId: session.activePageId, playwrightEndpoint: session.endpoint };
  }
  private emit(session: Session, type: string, payload: Record<string, unknown>, pageId = session.activePageId): void {
    const event: BrowserEvent = { type, sessionId: session.id, contextRef: session.contextRef, pageId, payload };
    for (const listener of session.listeners) { try { listener(event); } catch { /* Transport owns its failure. */ } }
  }
  subscribe(sessionId: string, listener: (event: BrowserEvent) => void): () => void {
    const session = this.session(sessionId); session.listeners.add(listener);
    if (session.lastFrame) listener(session.lastFrame);
    return () => { session.listeners.delete(listener); };
  }
  input(sessionId: string, input: BrowserInput): Promise<void> {
    const session = this.session(sessionId);
    return this.enqueue(session, () => this.executeInput(session, input));
  }
  private enqueue<T>(session: Session, action: () => Promise<T>): Promise<T> {
    const operation = session.inputTail.then(action);
    session.inputTail = operation.then(() => undefined, () => undefined);
    return operation;
  }
  private async executeInput(session: Session, input: BrowserInput): Promise<void> {
    if (session.closed) throw new RuntimeAdapterError('RUNTIME_NOT_FOUND', 'Browser session is closed', 404);
    if (input.contextRef !== undefined && input.contextRef !== session.contextRef) invalid('Input contextRef does not match the managed session');
    const pageId = typeof input.pageId === 'string' ? input.pageId : session.activePageId;
    const managed = session.pages.get(pageId);
    if (!managed) invalid('Input pageId does not belong to this session');
    await managed.ready;
    const page = managed.page;
    if (input.type === 'activatePage') {
      session.activePageId = pageId; session.lastFrame = undefined; session.queuedFrame = undefined;
      await page.bringToFront(); this.emit(session, 'browser.pageChanged', { url: page.url() });
      if (managed.lastFrame) { session.lastFrame = managed.lastFrame; for (const listener of session.listeners) listener(managed.lastFrame); }
      return;
    }
    if (input.type === 'navigate') { const url = navigationUrl(requiredText(input.url, 'url')); await page.goto(url); session.recorder?.append({ kind: 'navigate', pageId, url }); return; }
    if (input.type === 'pointer' || ['click', 'pointerdown', 'pointerup', 'pointermove'].includes(input.type)) {
      const x = finite(input.x, 'x'), y = finite(input.y, 'y');
      const viewport = page.viewportSize();
      if (x < 0 || y < 0 || viewport && (x >= viewport.width || y >= viewport.height)) invalid('Pointer lies outside the browser CSS viewport');
      const action = input.type === 'pointer' ? input.action : input.type.replace('pointer', '');
      const button = mouseButton(input.button);
      await page.mouse.move(x, y);
      if (action === 'click') await page.mouse.click(x, y, { button });
      else if (action === 'down') await page.mouse.down({ button });
      else if (action === 'up') await page.mouse.up({ button });
      else if (action !== 'move') invalid('Invalid pointer action');
      return;
    }
    if (input.type === 'key') {
      const key = requiredText(input.key, 'key');
      if (input.action === 'down') await page.keyboard.down(key);
      else if (input.action === 'up') await page.keyboard.up(key);
      else await page.keyboard.press(key);
      return;
    }
    if (input.type === 'text') { await page.keyboard.insertText(typeof input.text === 'string' ? input.text : requiredText(input.value, 'text')); return; }
    if (input.type === 'wheel' || input.type === 'scroll') { await page.mouse.wheel(finite(input.deltaX ?? 0, 'deltaX'), finite(input.deltaY, 'deltaY')); return; }
    if (input.type === 'locator') {
      const target = resolveLocator(page, locatorRecipe(requiredText(input.locator, 'locator')));
      if (input.action === 'click') await target.click();
      else if (input.action === 'fill') { if (typeof input.value !== 'string') invalid('fill value must be text'); await target.fill(input.value); }
      else if (input.action === 'selectOption') await target.selectOption(requiredText(input.value, 'value'));
      else invalid('Invalid semantic locator action');
      return;
    }
    invalid('Unsupported browser input type');
  }
  async startRecording(sessionId: string): Promise<{ recordingId: string }> {
    const session = this.session(sessionId);
    return this.enqueue(session, async () => {
      if (session.recorder) throw new RuntimeAdapterError('RECORDING_ALREADY_STARTED', 'Recording is already active', 409);
      for (const managed of session.pages.values()) for (const frame of managed.page.frames()) await frame.evaluate(async () => { const flush = (globalThis as typeof globalThis & { __workbenchRecorderFlush?: () => Promise<unknown> }).__workbenchRecorderFlush; if (flush) await flush(); }).catch(() => undefined);
      const recorder = new ActionRecorder();
      const page = session.pages.get(session.activePageId)!.page;
      recorder.append({ kind: 'navigate', pageId: session.activePageId, url: page.url() });
      for (const managed of session.pages.values()) if (managed.id !== session.activePageId) {
        recorder.append({ kind: 'newPage', pageId: managed.id });
        recorder.append({ kind: 'navigate', pageId: managed.id, url: managed.page.url() });
      }
      session.recorder = recorder;
      this.emit(session, 'recording.started', { recordingId: recorder.id });
      return { recordingId: recorder.id };
    });
  }
  async stopRecording(sessionId: string): Promise<{ recordingId: string; rawText: string; actions: unknown[] }> {
    const session = this.session(sessionId);
    return this.enqueue(session, async () => {
      const recorder = session.recorder;
      if (!recorder) throw new RuntimeAdapterError('RECORDING_NOT_STARTED', 'No recording is active', 409);
      const pagesAtStop = [...session.pages.values()];
      // A popup is added to pages synchronously, but its marker/screencast setup
      // and popup action are asynchronous. Drain pages accepted at the stop
      // boundary before freezing the draft, including truthful setup failures.
      await Promise.all(pagesAtStop.map(async (managed) => {
        try { await managed.ready; }
        catch { recorder.append({ kind: 'unsupported', pageId: managed.id, reason: 'Managed page setup failed before the recording stop boundary' }); }
      }));
    // Flush all binding promises accepted before the stop boundary. New viewer
    // operations are serialized by inputTail, not silently added after stop.
    for (const managed of pagesAtStop) for (const frame of managed.page.frames()) {
      await frame.evaluate(async () => { const flush = (globalThis as typeof globalThis & { __workbenchRecorderFlush?: () => Promise<unknown> }).__workbenchRecorderFlush; if (flush) await flush(); }).catch(() => { recorder.append({ kind: 'unsupported', pageId: managed.id, reason: 'Recording flush was interrupted by frame navigation or closure' }); });
    }
    await session.recordTail;
    if (session.recorder !== recorder) throw new RuntimeAdapterError('RECORDING_INTERRUPTED', 'Recording was interrupted', 409);
    session.recorder = undefined;
    const result = { recordingId: recorder.id, rawText: recorder.script(), actions: recorder.actions() };
    this.emit(session, 'recording.stopped', { recordingId: recorder.id }); return result;
    });
  }
  async addAssertion(sessionId: string, input: { locator: string; assertionType: string; expected: string }): Promise<void> {
    const session = this.session(sessionId);
    return this.enqueue(session, async () => {
    await session.recordTail;
    if (!session.recorder) throw new RuntimeAdapterError('RECORDING_NOT_STARTED', 'No recording is active', 409);
    if (!['visible', 'text', 'value'].includes(input.assertionType)) invalid('Supported assertions are visible, text, and value');
    if (typeof input.expected !== 'string') invalid('Assertion expected value must be text');
    if (input.assertionType !== 'visible') {
      const sensitive = await resolveLocator(session.pages.get(session.activePageId)!.page, locatorRecipe(input.locator)).evaluate(isSensitiveElement);
      if (sensitive) throw new RuntimeAdapterError('SENSITIVE_ASSERTION', 'A literal assertion for a sensitive field must be edited to use a secret reference', 400);
    }
    session.recorder.append({ kind: 'assertion', pageId: session.activePageId, framePath: [], locator: locatorRecipe(input.locator), assertionType: input.assertionType as 'visible' | 'text' | 'value', expected: input.expected });
    });
  }
  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId); if (!session) return;
    session.closed = true;
    if (session.recorder) this.emit(session, 'recording.interrupted', { recordingId: session.recorder.id });
    session.recorder = undefined; session.queuedFrame = undefined; session.lastFrame = undefined;
    await session.context.close().catch(() => undefined);
    this.emit(session, 'browser.closed', {}); session.listeners.clear(); this.sessions.delete(sessionId);
  }
  async close(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.sessions.keys()].map((id) => this.closeSession(id)));
    if (this.launched) { const running = await this.launched.catch(() => undefined); await running?.browser.close().catch(() => undefined); }
  }
}

function navigationUrl(value: string): string {
  let url: URL; try { url = new URL(value); } catch { invalid('Invalid navigation URL'); }
  if (!['http:', 'https:'].includes(url.protocol) && value !== 'about:blank') invalid('Only HTTP(S) URLs and about:blank are supported');
  if (url.username || url.password) invalid('Credentials must not be embedded in a navigation URL');
  return value;
}
function finite(value: unknown, field: string): number { if (typeof value !== 'number' || !Number.isFinite(value)) invalid(`${field} must be a finite number`); return value; }
function mouseButton(value: unknown): 'left' | 'right' | 'middle' {
  if (value === undefined || value === 0 || value === 'left') return 'left';
  if (value === 1 || value === 'middle') return 'middle';
  if (value === 2 || value === 'right') return 'right';
  invalid('Invalid mouse button');
}
function resolveLocator(page: Page | Frame, recipe: LocatorRecipe): Locator { return recipe.kind === 'testId' ? page.getByTestId(recipe.value) : recipe.kind === 'label' ? page.getByLabel(recipe.value) : page.locator(recipe.value); }
function isSensitiveElement(element: Element): boolean { return element.matches('input[type="password"],[data-wb-secret]') || /password|secret|token|credential|api.?key|one-time-code|cc-/.test([element.getAttribute('name'), element.getAttribute('autocomplete')].join(' ').toLowerCase()); }
async function framePath(frame: Frame): Promise<string[]> {
  const path: string[] = [];
  for (let current: Frame | null = frame; current?.parentFrame(); current = current.parentFrame()) {
    const element = await current.frameElement();
    try {
      path.unshift(await element.evaluate((node) => {
        const frameNode = node as Element;
        if (frameNode.id) return '#' + CSS.escape(frameNode.id);
        const name = frameNode.getAttribute('name'); if (name) return `${frameNode.tagName.toLowerCase()}[name=${JSON.stringify(name)}]`;
        const parts: string[] = [];
        for (let element: Element | null = frameNode; element && element !== document.documentElement; element = element.parentElement) {
          const peers: Element[] = element.parentElement ? [...element.parentElement.children].filter((peer) => peer.tagName === element!.tagName) : [];
          parts.unshift(element.tagName.toLowerCase() + (peers.length > 1 ? `:nth-of-type(${peers.indexOf(element) + 1})` : ''));
        }
        return parts.join(' > ');
      }));
    } finally { await element.dispose(); }
  }
  return path;
}
