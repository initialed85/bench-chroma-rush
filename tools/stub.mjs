/* Shared headless harness: stubbed DOM + canvas, loads the real game.js, exposes its debug API.
 * load(opts) builds a fresh sandbox, so tests can inject globals (e.g. a mock AudioContext)
 * and run isolated sessions without sharing state. */
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SRC = fs.readFileSync(path.join(here, '..', 'game.js'), 'utf8');

export function load(opts = {}) {
  const ctxStub = new Proxy({
    canvas: { width: 0, height: 0 },
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
    measureText: () => ({ width: 10 }),
    imageSmoothingEnabled: true
  }, {
    get: (t, p) => (p in t ? t[p] : () => undefined),
    set: (t, p, v) => { t[p] = v; return true; }
  });

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
    addEventListener() {},
    ...(opts.documentStub || {})
  };

  const handlers = {};
  const windowStub = {
    innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
    addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
    AudioContext: undefined, webkitAudioContext: undefined,
    requestAnimationFrame: () => 0,
    ...(opts.globals || {})
  };

  const store = {};
  const sandbox = {
    window: windowStub,
    document: documentStub,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    performance: { now: () => Date.now() },
    requestAnimationFrame: () => 0,
    console,
    ...(opts.sandbox || {})
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'game.js' });

  const api = windowStub.__CHROMA__;
  return {
    api, G: api.G, sandbox, windowStub, documentStub, handlers, ctxStub, els, store,
    fire: (type, ev) => (handlers[type] || []).forEach((f) => f(ev)),
    P: (o) => ({ preventDefault() {}, pointerType: 'mouse', button: 0, clientX: 0, clientY: 0, ...o }),
    K: (key) => ({ preventDefault() {}, key }),
    step: (dt) => { api.update(dt); api.render(); },
    panelShown: (name) => els.get(name).classList.contains('show')
  };
}

/* default shared instance (used by smoke/probe/play) */
const def = load();
export const api = def.api;
export const G = def.G;
export const sandbox = def.sandbox;
export const windowStub = def.windowStub;
export const documentStub = def.documentStub;
export const handlers = def.handlers;
export const ctxStub = def.ctxStub;
export const els = def.els;
export const store = def.store;
export const fire = def.fire;
export const P = def.P;
export const K = def.K;
export const step = def.step;
export const panelShown = def.panelShown;
