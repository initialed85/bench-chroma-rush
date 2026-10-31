/* Minimal Web Audio graph implementation for headless tests.
 * It models nodes, connections, automation and start/stop bookkeeping so game.js's
 * procedural audio is genuinely exercised, not stubbed out. */
export const created = { gain: 0, osc: 0, filter: 0, bufferSource: 0, compressor: 0, panner: 0, buffer: 0 };
export const nodes = { osc: [], gain: [], filter: [], bufferSource: [], compressor: [], panner: [] };
export const automation = [];
export const contexts = [];
export function reset() {
  for (const k of Object.keys(created)) created[k] = 0;
  for (const k of Object.keys(nodes)) nodes[k] = [];
  automation.length = 0;
}

class Param {
  constructor(ctx, owner, name, value) {
    this.ctx = ctx; this.owner = owner; this.name = name;
    this.value = value; this.targets = [];
  }
  _record(kind, value, time) {
    const rec = { kind, value, time, name: this.name, node: this.owner.kind, label: this.owner.label };
    this.targets.push(rec);
    automation.push(rec);
    this.value = value;
    return this;
  }
  setValueAtTime(v, t) { return this._record('setValueAtTime', v, t); }
  linearRampToValueAtTime(v, t) { return this._record('linearRamp', v, t); }
  exponentialRampToValueAtTime(v, t) { return this._record('expRamp', Math.max(v, 1e-7), t); }
  setTargetAtTime(v, t) { return this._record('setTarget', v, t); }
  cancelScheduledValues() { return this; }
}

class Node {
  constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; this.outs = []; this.label = kind; }
  connect(dst) { this.outs.push(dst); return dst; }
  disconnect() { this.outs.length = 0; }
}

class GainNode extends Node {
  constructor(ctx) { super(ctx, 'gain'); created.gain++; nodes.gain.push(this); this.gain = new Param(ctx, this, 'gain', 1); }
}
class OscillatorNode extends Node {
  constructor(ctx) {
    super(ctx, 'oscillator'); created.osc++; nodes.osc.push(this);
    this.type = 'sine'; this.frequency = new Param(ctx, this, 'frequency', 440); this.detune = new Param(ctx, this, 'detune', 0);
    this.startedAt = null; this.stoppedAt = null;
  }
  start(t) { this.startedAt = t ?? this.ctx.currentTime; this.freqAtStart = this.frequency.value; }
  stop(t) { this.stoppedAt = t ?? this.ctx.currentTime; }
}
class BiquadFilterNode extends Node {
  constructor(ctx) {
    super(ctx, 'biquad'); created.filter++; nodes.filter.push(this);
    this.type = 'lowpass';
    this.frequency = new Param(ctx, this, 'frequency', 350); this.Q = new Param(ctx, this, 'Q', 1);
    this.gain = new Param(ctx, this, 'gain', 0); this.detune = new Param(ctx, this, 'detune', 0);
  }
}
class BufferSourceNode extends Node {
  constructor(ctx) {
    super(ctx, 'bufferSource'); created.bufferSource++; nodes.bufferSource.push(this);
    this.buffer = null; this.loop = false; this.playbackRate = new Param(ctx, this, 'playbackRate', 1);
    this.startedAt = null; this.stoppedAt = null;
  }
  start(t) { this.startedAt = t ?? this.ctx.currentTime; this.rateAtStart = this.playbackRate.value; }
  stop(t) { this.stoppedAt = t ?? this.ctx.currentTime; }
}
class DynamicsCompressorNode extends Node {
  constructor(ctx) {
    super(ctx, 'compressor'); created.compressor++; nodes.compressor.push(this);
    this.threshold = new Param(ctx, this, 'threshold', -24); this.knee = new Param(ctx, this, 'knee', 30);
    this.ratio = new Param(ctx, this, 'ratio', 12); this.attack = new Param(ctx, this, 'attack', 0.003);
    this.release = new Param(ctx, this, 'release', 0.25); this.reduction = 0;
  }
}
class StereoPannerNode extends Node {
  constructor(ctx) { super(ctx, 'panner'); created.panner++; nodes.panner.push(this); this.pan = new Param(ctx, this, 'pan', 0); }
}

export class MockAudioContext {
  constructor() {
    this._t = 0;
    this.sampleRate = 48000;
    this.state = 'suspended';
    contexts.push(this);
    this.destination = new Node(this, 'destination');
    this.resumeCount = 0;
  }
  get currentTime() { return this._t; }
  advance(dt) { this._t += dt; }
  resume() { this.resumeCount++; this.state = 'running'; return Promise.resolve(); }
  createGain() { const n = new GainNode(this); n.label = `gain#${created.gain}`; return n; }
  createOscillator() { const n = new OscillatorNode(this); n.label = `osc#${created.osc}`; return n; }
  createBiquadFilter() { const n = new BiquadFilterNode(this); n.label = `filter#${created.filter}`; return n; }
  createBufferSource() { const n = new BufferSourceNode(this); n.label = `src#${created.bufferSource}`; return n; }
  createDynamicsCompressor() { const n = new DynamicsCompressorNode(this); n.label = `comp#${created.compressor}`; return n; }
  createStereoPanner() { const n = new StereoPannerNode(this); n.label = `pan#${created.panner}`; return n; }
  createBuffer(chs, len) {
    created.buffer++;
    const data = new Float32Array(len);
    return { length: len, sampleRate: this.sampleRate, getChannelData: () => data };
  }
}

/* --- helpers for assertions --- */
export const reachesDestination = (node, seen = new Set()) => {
  if (node.kind === 'destination') return true;
  if (seen.has(node)) return false;
  seen.add(node);
  return node.outs.some((o) => reachesDestination(o, seen));
};
export const startedSources = () => [...nodes.osc, ...nodes.bufferSource].filter((n) => n.startedAt !== null);
export const stoppedCount = () => [...nodes.osc, ...nodes.bufferSource].filter((n) => n.stoppedAt !== null).length;
