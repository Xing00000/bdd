/** Preferences belong to this report document, never to the workstation origin. */
function installReportStorage() {
  function storage() {
    const values = new Map();
    const api = {
      get length() { return values.size; },
      key(index) { return [...values.keys()][Number(index) >>> 0] ?? null; },
      getItem(key) { return values.get(String(key)) ?? null; },
      setItem(key, value) { values.set(String(key), String(value)); },
      removeItem(key) { values.delete(String(key)); },
      clear() { values.clear(); },
    };
    // Playwright uses named properties as well as the Storage methods.
    return new Proxy(Object.create(null), {
      get: (_, key) => Object.hasOwn(api, key) ? api[key] : values.get(key),
      set: (_, key, value) => { values.set(String(key), String(value)); return true; },
      deleteProperty: (_, key) => { values.delete(key); return true; },
      has: (_, key) => Object.hasOwn(api, key) || values.has(key),
      ownKeys: () => [...values.keys()],
      getOwnPropertyDescriptor: (_, key) => values.has(key)
        ? { value: values.get(key), writable: true, enumerable: true, configurable: true } : undefined,
    });
  }
  for (const name of ['localStorage', 'sessionStorage'])
    Object.defineProperty(window, name, { value: storage() });
}

/** Transform only the presentation response after the sealed bytes were verified. */
export function renderNativeReport(bytes) {
  const bootstrap = `<script>(${installReportStorage.toString()})();</script>`;
  return Buffer.from(bytes.toString('utf8').replace(/<script\b/i, () => `${bootstrap}<script`));
}
