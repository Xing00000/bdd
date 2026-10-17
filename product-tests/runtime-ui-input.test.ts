import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { viewportPoint } from '../ui/src/transport.ts';

async function inputFixture() {
  // Execute the actual component handler source against explicit DOM/WS
  // fixtures. This is a UI input contract unit test, not real IME/browser proof.
  const vue = await readFile(resolve('ui/src/BrowserViewer.vue'), 'utf8');
  const script = vue.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1];
  const parsed = ts.createSourceFile('BrowserViewer.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = ['flushPointerMove', 'releasePointerCapture', 'cancelPointer', 'releaseRemoteInput', 'pointer', 'keyboard', 'compositionStart', 'compositionEnd', 'clearInput'];
  const statements = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? '') || ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === 'inputState'));
  const source = statements.map(node => node.getText(parsed)).join('\n') + '\nglobalThis.handlers={' + names.join(',') + '};globalThis.state=inputState;';
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
  const messages: any[] = [], captured = new Set<number>(), raf = new Map<number, () => void>();
  let rafId = 0, focused = 0;
  const canvas = { value: {
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 600, height: 400 }), width: 1200, height: 600,
    setPointerCapture: (id: number) => { captured.add(id); }, hasPointerCapture: (id: number) => captured.has(id), releasePointerCapture: (id: number) => { captured.delete(id); }, focus: () => { focused++; },
  } };
  const imeInput = { value: { value: '', focus: () => { focused++; } } };
  const sandbox = { props: { interactive: true }, canvas, imeInput, lastFrame: { value: { pageId: 'page-1', contextRef: 'context-1', payload: { viewportWidth: 1200, viewportHeight: 600 } } },
    viewportPoint, send: (message: unknown) => { messages.push(structuredClone(message)); },
    requestAnimationFrame: (callback: () => void) => { raf.set(++rafId, callback); return rafId; }, cancelAnimationFrame: (id: number) => { raf.delete(id); } } as any;
  runInNewContext(output, sandbox);
  return { handlers: sandbox.handlers, state: sandbox.state, messages, captured, raf, imeInput, canvas, get focused() { return focused; } };
}

function key(key: string, extras: Record<string, unknown> = {}) {
  let prevented = false;
  return { key, code: key, keyCode: 0, isComposing: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
    preventDefault: () => { prevented = true; }, get prevented() { return prevented; }, ...extras };
}

test('IME composition commits Chinese text once and does not forward composition keystrokes or a trailing Enter keyup', async () => {
  const fixture = await inputFixture(), h = fixture.handlers;
  h.compositionStart();
  const composing = key('Process', { code: 'KeyA', keyCode: 229, isComposing: true });
  h.keyboard(composing, 'down');
  h.keyboard(key('Enter', { isComposing: true }), 'down');
  assert.equal(composing.prevented, false, 'native local composition must remain enabled');
  assert.deepEqual(fixture.messages, []);
  fixture.imeInput.value.value = '繁體中文';
  h.compositionEnd({ data: '繁體中文' });
  h.keyboard(key('Enter'), 'up');
  h.compositionEnd({ data: '繁體中文' });
  h.clearInput();
  assert.deepEqual(fixture.messages, [{ type: 'text', text: '繁體中文' }]);
  assert.equal(fixture.imeInput.value.value, '');
  h.keyboard(key('x'), 'down'); h.keyboard(key('x'), 'up');
  assert.equal(fixture.messages.filter((message: any) => message.text === 'x').length, 1);
});

test('remote modifier and printable shortcut key releases remain balanced when focus leaves the input sink', async () => {
  const fixture = await inputFixture(), h = fixture.handlers;
  h.keyboard(key('Control', { ctrlKey: true }), 'down');
  h.keyboard(key('a', { ctrlKey: true }), 'down');
  h.keyboard(key('Control'), 'up'); h.keyboard(key('a'), 'up');
  assert.deepEqual(fixture.messages.map(message => [message.key, message.action]), [['Control', 'down'], ['a', 'down'], ['Control', 'up'], ['a', 'up']]);
  h.keyboard(key('Shift', { shiftKey: true }), 'down');
  h.releaseRemoteInput();
  assert.deepEqual(fixture.messages.at(-1), { type: 'key', action: 'up', key: 'Shift' });
  assert.equal(fixture.state.pressedKeys.size, 0);
});

test('pointer capture, coalesced movement and outside release keep their original managed page binding', async () => {
  const fixture = await inputFixture(), h = fixture.handlers;
  // Focusing the sink can synchronously blur a previously focused canvas.
  fixture.imeInput.value.focus = () => h.releaseRemoteInput();
  h.pointer({ pointerId: 7, clientX: 310, clientY: 220, button: 0 }, 'down');
  assert.equal(fixture.captured.has(7), true);
  assert.deepEqual(fixture.messages[0], { type: 'pointer', action: 'down', x: 600, y: 300, button: 'left', pageId: 'page-1', contextRef: 'context-1' });
  h.pointer({ pointerId: 7, clientX: 320, clientY: 220, button: -1 }, 'move');
  h.pointer({ pointerId: 7, clientX: 330, clientY: 220, button: -1 }, 'move');
  assert.equal(fixture.raf.size, 1, 'only the latest pending pointermove is retained');
  assert.equal(fixture.messages.length, 1);
  h.pointer({ pointerId: 7, clientX: 1000, clientY: 1000, button: 0 }, 'up');
  assert.deepEqual(fixture.messages.map(message => message.action), ['down', 'move', 'up']);
  assert.equal(fixture.messages[1].x, 640);
  assert.equal(fixture.messages[2].x, 640);
  assert.ok(fixture.messages.every(message => message.pageId === 'page-1' && message.contextRef === 'context-1'));
  assert.equal(fixture.captured.size, 0);
  h.cancelPointer();
  assert.equal(fixture.messages.length, 3, 'lost capture must not send a second release');
});
