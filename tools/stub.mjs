/* Shared headless harness: stubbed DOM + canvas, loads the real game.js, exposes its debug API. */
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'game.js'), 'utf8');

const mkCtx = () => {
  const target = {
    canvas: { width: 0, height: 0 },
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
    measureText: () => ({ width: 10 }),
    imageSmoothingEnabled: true
  };
  return new Proxy(target, {
    get(t, p) { return p in t ? t[p] : () => undefined; },
    set(t, p, v) { t[p] = v; return true; }
  });
};
const ctxStub = mkCtx();
const mkEl = (id) => ({
  id, width: 0, height: 0, style: {}, innerHTML: '', textContent: '',
  classList: { s: new Set(), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); }, contains(c) { return this.s.has(c); } },
  addEventListener() {}, setAttribute() {}, getContext: () => ctxStub
});
const els = new Map();
const documentStub = {
  hidden: false,
  getElementById: (id) => { if (!els.has(id)) els.set(id, mkEl(id)); return els.get(id); },
  createElement: () => mkEl('offscreen'),
  addEventListener() {}
};
const handlers = {};
const windowStub = {
  innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
  addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
  AudioContext: undefined, webkitAudioContext: undefined,
  requestAnimationFrame: () => 0
};
export const store = {};
const sandbox = {
  window: windowStub,
  document: documentStub,
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
  performance: { now: () => Date.now() },
  requestAnimationFrame: () => 0,
  console
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'game.js' });

export const api = windowStub.__CHROMA__;
export const G = api.G;
export const fire = (type, ev) => (handlers[type] || []).forEach((f) => f(ev));
export const P = (o) => ({ preventDefault() {}, pointerType: 'mouse', button: 0, clientX: 0, clientY: 0, ...o });
export const K = (key) => ({ preventDefault() {}, key });
export const step = (dt) => { api.update(dt); api.render(); };
export const panelShown = (name) => els.get(name).classList.contains('show');
