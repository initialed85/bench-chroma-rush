/* CHROMA RUSH — neon arena survival
 * Zero dependencies, zero assets: every pixel is canvas primitives, every sound is WebAudio synthesis.
 * Controls: WASD move · mouse aim · LMB fire · SPACE shockwave · SHIFT dash · P pause · M mute
 */
(() => {
'use strict';

/* ================= math + colour ================= */
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const randi = (a, b) => Math.floor(rand(a, b));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const angLerp = (a, b, t) => { const d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI; return a + d * t; };
const hsl = (h, s, l, a = 1) => `hsla(${Math.round(((h % 360) + 360) % 360)},${s}%,${l}%,${a})`;
const COMBO_T = 2.3;
const MAX_BULLETS = 260;   /* ceiling for the player's own bullet population */

/* ================= surface ================= */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
let W = 1280, H = 720, DPR = 1;

/* Pre-rendered radial glow sprites, keyed by quantised hue: cheap additive bloom. */
const sprites = new Map();
function glowSprite(hue, sat, light) {
  const h = Math.round(hue / 10) * 10;
  const key = h + '|' + sat + '|' + light;
  let s = sprites.get(key);
  if (s) return s;
  s = document.createElement('canvas');
  s.width = s.height = 64;
  const g = s.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, hsl(h, sat * 0.35, 97, 1));
  grd.addColorStop(0.16, hsl(h, sat, Math.min(82, light + 20), 0.92));
  grd.addColorStop(0.42, hsl(h, sat, light, 0.42));
  grd.addColorStop(1, hsl(h, sat, light, 0));
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  sprites.set(key, s);
  return s;
}
function glow(x, y, r, hue, sat, light, alpha) {
  ctx.globalAlpha = alpha;
  ctx.drawImage(glowSprite(hue, sat === undefined ? 100 : sat, light === undefined ? 55 : light), x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = 1;
}
function ringStroke(x, y, r, w, hue, light, alpha) {
  ctx.strokeStyle = hsl(hue, 100, light === undefined ? 70 : light, alpha);
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.5, r), 0, TAU);
  ctx.stroke();
}
function polyPath(x, y, r, n, rot) {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + i * TAU / n;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.closePath();
}
function triPath(x, y, r, a) {
  ctx.beginPath();
  ctx.moveTo(x + Math.cos(a) * r * 1.5, y + Math.sin(a) * r * 1.5);
  ctx.lineTo(x + Math.cos(a + 2.4) * r, y + Math.sin(a + 2.4) * r);
  ctx.lineTo(x + Math.cos(a - 2.4) * r, y + Math.sin(a - 2.4) * r);
  ctx.closePath();
}
const stars = [];
function buildStars() {
  stars.length = 0;
  const n = Math.round(W * H / 8500);
  for (let i = 0; i < n; i++) stars.push({ x: rand(W), y: rand(H), z: rand(0.2, 1), s: rand(0.7, 2.4), h: rand(360) });
}
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = Math.max(320, window.innerWidth);
  H = Math.max(240, window.innerHeight);
  canvas.width = Math.floor(W * DPR);
  canvas.height = Math.floor(H * DPR);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  buildStars();
}

/* ================= audio (fully synthesised) ================= */
let AC = null, master = null, noiseBuf = null;
function initAudio() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return;
  AC = new Ctor();
  master = AC.createGain();
  master.gain.value = 0.75;
  /* master bus: highpass the sub-rumble out (laptop speakers have no response below ~90 Hz,
   * so the drone's 55 Hz fundamental was pure distortion), then a gentle limiter so a dense
   * wave + a full pad + shockwave can't all stack into a wall of noise. */
  music.hp = AC.createBiquadFilter();
  music.hp.type = 'highpass';
  music.hp.frequency.value = 92;
  music.hp.Q.value = 0.7;
  music.comp = AC.createDynamicsCompressor();
  music.comp.threshold.value = -18;
  music.comp.knee.value = 10;
  music.comp.ratio.value = 3.5;
  music.comp.attack.value = 0.006;
  music.comp.release.value = 0.22;
  master.connect(music.hp);
  music.hp.connect(music.comp);
  music.comp.connect(AC.destination);
  const len = Math.floor(AC.sampleRate * 1.2);
  noiseBuf = AC.createBuffer(1, len, AC.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  music.next = AC.currentTime + 0.1;
}
function tone(o) {
  if (!AC) return;
  const t0 = o.when || AC.currentTime;
  const dur = Math.max(0.02, o.dur || 0.15);
  const osc = AC.createOscillator(), g = AC.createGain();
  osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(Math.max(20, o.f), t0);
  if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain || 0.2), t0 + (o.attack || 0.004));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  let out = g;
  if (o.pan && AC.createStereoPanner) { const p = AC.createStereoPanner(); p.pan.value = clamp(o.pan, -1, 1); g.connect(p); out = p; }
  out.connect(o.dest || master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}
function noise(o) {
  if (!AC || !noiseBuf) return;
  const t0 = o.when || AC.currentTime;
  const dur = Math.max(0.02, o.dur || 0.2);
  const src = AC.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  src.playbackRate.value = o.rate || 1;
  const f = AC.createBiquadFilter();
  f.type = o.type || 'lowpass';
  f.frequency.setValueAtTime(o.lp || 2000, t0);
  if (o.lp2) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.lp2), t0 + dur);
  f.Q.value = o.q || 1;
  const g = AC.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain || 0.25), t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f); f.connect(g);
  let out = g;
  if (o.pan && AC.createStereoPanner) { const p = AC.createStereoPanner(); p.pan.value = clamp(o.pan, -1, 1); g.connect(p); out = p; }
  out.connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.03);
}
const semi = (n) => 440 * Math.pow(2, n / 12);
const sfx = {
  shoot(w, pan) {
    /* ~20 shots/s at the top tier: fire the blip on alternate shots and keep it quiet,
     * otherwise the shots fuse into a continuous buzz */
    tone({ f: 1000 - w * 110, f2: 140, type: 'square', dur: 0.05, gain: 0.038, pan });
    noise({ dur: 0.035, gain: 0.03, lp: 4200, lp2: 900, pan });
  },
  hit(pan) { tone({ f: 1700, f2: 800, type: 'triangle', dur: 0.045, gain: 0.05, pan }); },
  explode(r, pan, big) {
    const s = clamp(r / 26, 0.4, big ? 3 : 2);
    noise({ dur: 0.16 + s * 0.16, gain: 0.18 + s * 0.13, lp: 2400 + s * 900, lp2: 70, pan });
    tone({ f: 130, f2: 28, type: 'sine', dur: 0.22 + s * 0.3, gain: 0.22 + s * 0.15, pan });
  },
  shock(pan) {
    noise({ dur: 0.55, gain: 0.36, lp: 8000, lp2: 140, pan });
    tone({ f: 320, f2: 34, type: 'sawtooth', dur: 0.5, gain: 0.2, pan });
    tone({ f: 900, f2: 200, type: 'square', dur: 0.22, gain: 0.08, pan });
  },
  hurt() {
    noise({ dur: 0.28, gain: 0.3, lp: 1100, lp2: 180, type: 'bandpass', q: 0.7 });
    tone({ f: 200, f2: 55, type: 'sawtooth', dur: 0.3, gain: 0.24 });
  },
  dash(pan) {
    tone({ f: 260, f2: 1500, type: 'sine', dur: 0.14, gain: 0.1, pan });
    noise({ dur: 0.18, gain: 0.12, lp: 1200, lp2: 6000, type: 'highpass' });
  },
  pickup(n, pan) {
    const base = [0, 3, 7, 10, 12][clamp(n, 0, 4)];
    for (let i = 0; i < 3; i++) tone({ f: semi(base + i * 4), f2: semi(base + i * 4 + 5), type: 'triangle', dur: 0.13, gain: 0.09, when: AC ? AC.currentTime + i * 0.045 : 0, pan });
  },
  wave(n) {
    const base = [0, 5, 7, 12][n % 4];
    for (let i = 0; i < 4; i++) tone({ f: semi(base + i * 3), type: 'sine', dur: 0.9, gain: 0.07, attack: 0.12 });
    noise({ dur: 0.7, gain: 0.08, lp: 600, lp2: 3000 });
  },
  roar() {
    tone({ f: 90, f2: 26, type: 'sawtooth', dur: 1.1, gain: 0.34 });
    noise({ dur: 0.9, gain: 0.2, lp: 900, lp2: 120 });
  },
  combo(c) { tone({ f: semi(6 + Math.min(22, c)), type: 'triangle', dur: 0.07, gain: 0.05 }); },
  over() {
    [0, -2, -5, -9, -14].forEach((n, i) => tone({ f: semi(n + 12), f2: semi(n), type: 'sawtooth', dur: 0.5, gain: 0.16, when: AC ? AC.currentTime + i * 0.13 : 0 }));
    noise({ dur: 1.4, gain: 0.24, lp: 2500, lp2: 60 });
  },
  ui() { tone({ f: 700, f2: 1400, type: 'square', dur: 0.09, gain: 0.07 }); }
};

/* procedural beat: kick / hat / bass / combo arp, tempo follows the combo chain */
const music = { step: 0, next: 0, on: true, pad: null, padGain: null, padFilter: null };
function startPad() {
  if (!AC || music.pad) return;
  const o1 = AC.createOscillator(), o2 = AC.createOscillator(), o3 = AC.createOscillator();
  const g = AC.createGain(), f = AC.createBiquadFilter();
  /* triangles, not sawtooths: a sawtooth's harmonics are what made this read as a harsh buzz */
  o1.type = 'triangle'; o2.type = 'triangle'; o3.type = 'sine';
  o1.frequency.value = 110; o2.frequency.value = 110 * 1.005; o3.frequency.value = 165;
  o1.detune.value = -4; o2.detune.value = 6; o3.detune.value = 3;
  f.type = 'lowpass'; f.frequency.value = 300; f.Q.value = 0.8;
  g.gain.value = 0.0001;
  const o3g = AC.createGain(); o3g.gain.value = 0.35;
  o1.connect(f); o2.connect(f); o3.connect(o3g); o3g.connect(f);
  f.connect(g); g.connect(master);
  /* slow tremolo + filter wobble so the bed breathes instead of droning on one note */
  const lfo = AC.createOscillator(), lg = AC.createGain();
  lfo.type = 'sine'; lfo.frequency.value = 0.13; lg.gain.value = 0.009;
  lfo.connect(lg); lg.connect(g.gain); lfo.start();
  const flfo = AC.createOscillator(), flg = AC.createGain();
  flfo.type = 'sine'; flfo.frequency.value = 0.07; flg.gain.value = 90;
  flfo.connect(flg); flg.connect(f.frequency); flfo.start();
  o1.start(); o2.start(); o3.start();
  music.pad = [o1, o2, o3];
  music.padGain = g;
  music.padFilter = f;
  music.padLfo = [lfo, flfo];
  setPadWave(1);
}
/* The pad no longer ramps brighter every wave (that was the jarring part). It cycles a
 * fixed Am → F → G → Am progression and the only thing that lifts is a small, capped
 * brightness step for the last few waves, driven by wave number and capped hard. */
const PAD_ROOTS = [110, 87.31, 98, 110, 87.31, 110];
function setPadWave(n) {
  if (!music.padGain || !AC) return;
  const f = PAD_ROOTS[(n - 1) % PAD_ROOTS.length];
  const t = AC.currentTime;
  music.pad[0].frequency.setTargetAtTime(f, t, 1.6);
  music.pad[1].frequency.setTargetAtTime(f * 1.005, t, 1.6);
  music.pad[2].frequency.setTargetAtTime(f * 1.5, t, 1.6);
  music.padGain.gain.setTargetAtTime(Math.min(0.03, 0.018 + Math.min(n, 8) * 0.0014), t, 2.4);
  music.padFilter.frequency.setTargetAtTime(Math.min(420, 280 + Math.min(n, 8) * 17), t, 2.8);
}
function scheduleMusic() {
  if (!AC || !music.on) return;
  const tempo = 104 + Math.min(56, G.combo * 3) + (G.boss ? 12 : 0);
  const spb = 60 / tempo / 4;
  if (G.slowT > 0 && master) master.gain.setTargetAtTime(0.4, AC.currentTime, 0.2);
  else if (master) master.gain.setTargetAtTime(G.muted ? 0 : 0.75, AC.currentTime, 0.3);
  let guard = 0;
  while (music.next < AC.currentTime + 0.3 && guard++ < 64) {
    playStep(music.step, music.next);
    music.step = (music.step + 1) % 16;
    music.next += spb;
  }
}
const BASS = [0, -1, 0, 3, -1, 0, 5, -1, 0, -1, 3, -1, 7, 0, 5, 3];
function playStep(step, when) {
  const s = step % 16;
  const boss = G.boss;
  if (s % 4 === 0) {
    tone({ f: 130, f2: 38, type: 'sine', dur: 0.2, gain: 0.3, when, attack: 0.002 });
    G.pulse = 1;
  }
  if (s % 2 === 1) noise({ dur: 0.045, gain: boss ? 0.06 : 0.035, lp: 9000, lp2: 5000, type: 'highpass', when });
  if ((s === 4 || s === 12) && boss) noise({ dur: 0.16, gain: 0.12, lp: 2600, lp2: 900, when });
  const b = BASS[s];
  if (b >= 0) tone({ f: semi(b - 24), f2: semi(b - 24) * 0.98, type: 'sawtooth', dur: 0.16, gain: 0.11, when });
  if (G.combo >= 3 && s % 4 === 2) tone({ f: semi(G.combo % 12 + 12), type: 'square', dur: 0.1, gain: 0.045, when });
  if (G.combo >= 8 && s % 8 === 6) tone({ f: semi(G.combo % 10 + 24), type: 'triangle', dur: 0.14, gain: 0.035, when });
}

/* ================= input ================= */
const keys = new Set();
const G = {
  running: false, paused: false, dead: false, overShown: false,
  time: 0, hue: 210, hueT: 210, pulse: 0,
  score: 0, shown: 0, best: 0, kills: 0, combo: 0, bestCombo: 0, comboT: 0,
  wave: 0, queue: [], spawnT: 0, spawnInterval: 1.2, clearT: 1.8, waveBanner: 0, waveLabel: '',
  bullets: [], eBullets: [], enemies: [], pickups: [], spawners: [], shocks: [], booms: [], particles: [],
  shake: 0, flash: 0, hurt: 0, freeze: 0, timeScale: 1, slowT: 0, boss: null,
  mx: 0, my: 0, touch: false, touchX: 0, touchY: 0, lastTap: 0, fps: 0,
  player: null
};
const WEAPONS = [
  { cd: 0.050, n: 1, spread: 0, jit: 0.015, spd: 1250, dmg: 1.00, size: 3.6, hue: 190, name: 'PULSE' },
  { cd: 0.046, n: 2, spread: 0.15, jit: 0.02, spd: 1230, dmg: 1.00, size: 3.4, hue: 150, name: 'TWIN' },
  { cd: 0.042, n: 3, spread: 0.28, jit: 0.022, spd: 1200, dmg: 1.05, size: 3.4, hue: 105, name: 'TRIAD' },
  { cd: 0.038, n: 4, spread: 0.46, jit: 0.026, spd: 1180, dmg: 1.15, size: 3.8, hue: 50, name: 'FAN' },
  { cd: 0.034, n: 5, spread: 0.66, jit: 0.032, spd: 1150, dmg: 1.30, size: 4.4, hue: 320, name: 'PRISM', pierce: 1 }
];
const TYPES = {
  chaser: { hp: 3, r: 15, spd: 155, dmg: 13, hue: 348, score: 100, sides: 7 },
  mini: { hp: 3, r: 12, spd: 240, dmg: 8, hue: 20, score: 90, sides: 3 },
  shooter: { hp: 6, r: 18, spd: 100, dmg: 9, hue: 55, score: 180, sides: 6, gun: 1.8 },
  splitter: { hp: 11, r: 27, spd: 106, dmg: 12, hue: 165, score: 250, sides: 5 },
  tank: { hp: 32, r: 36, spd: 55, dmg: 20, hue: 292, score: 540, sides: 8 },
  boss: { hp: 190, r: 58, spd: 46, dmg: 26, hue: 120, score: 2600, sides: 12 },
  /* pack archetypes: one telegraph ring, many enemies. They exist for visual pressure,
   * and they die together to one shockwave, so chaos is cheap to pay off. */
  swarm: { hp: 3, r: 12, spd: 240, dmg: 8, hue: 20, score: 90, sides: 3 },
  trio: { hp: 6, r: 18, spd: 100, dmg: 9, hue: 55, score: 180, sides: 6, gun: 1.8 }
};

function newPlayer() {
  return {
    x: W / 2, y: H / 2, vx: 0, vy: 0, r: 13, angle: -Math.PI / 2,
    hp: 100, maxHp: 100, fire: false, fireCd: 0, weapon: 0, charge: 30,
    inv: 0, shield: 0, dashT: 0, dashCd: 0, dashA: 0, moveA: null, hits: 0
  };
}
function resetGame() {
  G.running = true; G.paused = false; G.dead = false; G.overShown = false;
  G.time = 0; G.pulse = 0;
  G.score = 0; G.shown = 0; G.kills = 0; G.combo = 0; G.bestCombo = 0; G.comboT = 0;
  G.bullets.length = 0; G.eBullets.length = 0; G.enemies.length = 0; G.pickups.length = 0;
  G.spawners.length = 0; G.shocks.length = 0; G.booms.length = 0; G.particles.length = 0;
  G.shake = 0; G.flash = 0; G.hurt = 0; G.freeze = 0; G.timeScale = 1; G.slowT = 0; G.boss = null;
  G.player = newPlayer();
  G.hue = 210; G.hueT = 210;
  startWave(1);
  startPad();
  setPadWave(1);
}

/* ================= waves ================= */
function chooseType(n) {
  const bag = ['chaser', 'chaser', 'swarm'];
  if (n >= 2) bag.push('shooter', 'chaser', 'swarm');
  if (n >= 3) bag.push('splitter', 'shooter', 'swarm', 'trio');
  if (n >= 4) bag.push('tank', 'splitter', 'swarm');
  if (n >= 6) bag.push('tank', 'shooter', 'swarm', 'trio');
  if (n >= 8) bag.push('mini', 'tank', 'swarm', 'trio');
  return pick(bag);
}
function startWave(n) {
  G.wave = n;
  G.waveBanner = 2.1;
  G.waveLabel = n % 5 === 0 ? 'BOSS' : 'WAVE ' + n;
  G.hueT = (n * 41 + 200) % 360;
  G.clearT = 1.2;
  const budget = 8 + Math.floor(n * 4);
  G.queue.length = 0;
  for (let i = 0; i < budget; i++) G.queue.push(chooseType(n));
  if (n % 5 === 0) G.queue.push('boss');
  G.spawnInterval = Math.max(0.14, 0.75 - n * 0.04);
  G.spawnT = 0.35;
  G.player.charge = Math.min(100, G.player.charge + 8);
  sfx.wave(n);
  setPadWave(n);
  flashRing(W / 2, H / 2, Math.max(W, H) * 0.8, G.hueT, 0.9);
}
function waves(dt) {
  if (G.dead) return;
  if (G.queue.length) {
    G.spawnT -= dt;
    /* density ceiling keeps the arena readable and the particle budget honest */
    if (G.spawnT <= 0 && G.spawners.length < 7 && G.enemies.length + G.spawners.length < 26) {
      addSpawner(G.queue.shift());
      G.spawnT = G.spawnInterval * rand(0.7, 1.35);
    }
    G.clearT = 1.2;
  } else if (!G.enemies.length && !G.spawners.length) {
    G.clearT -= dt;
    if (G.clearT <= 0) startWave(G.wave + 1);
  } else {
    G.clearT = 1.2;
  }
}
function edgePoint() {
  const p = G.player;
  for (let i = 0; i < 24; i++) {
    const side = randi(4);
    let x, y;
    if (side === 0) { x = rand(30, W - 30); y = 40; }
    else if (side === 1) { x = rand(30, W - 30); y = H - 40; }
    else if (side === 2) { x = 40; y = rand(30, H - 30); }
    else { x = W - 40; y = rand(30, H - 30); }
    if (Math.hypot(x - p.x, y - p.y) > 240) return { x, y };
  }
  return { x: rand(60, W - 60), y: rand(60, H - 60) };
}
function addSpawner(type, x, y, t) {
  const pt = (x === undefined) ? edgePoint() : { x, y };
  const base = TYPES[type];
  G.spawners.push({ x: pt.x, y: pt.y, t: t || 0.55, t0: t || 0.55, type, hue: (G.hue + base.hue) % 360 });
}

/* ================= player ================= */
function updatePlayer(dt) {
  const p = G.player;
  if (!p) return;
  p.inv = Math.max(0, p.inv - dt);
  p.dashCd = Math.max(0, p.dashCd - dt);
  p.fireCd = Math.max(0, p.fireCd - dt);
  if (p.shield > 0) p.shield = Math.max(0, p.shield - dt);
  p.moveA = null;
  let ax = 0, ay = 0;
  if (keys.has('a') || keys.has('arrowleft')) ax -= 1;
  if (keys.has('d') || keys.has('arrowright')) ax += 1;
  if (keys.has('w') || keys.has('arrowup')) ay -= 1;
  if (keys.has('s') || keys.has('arrowdown')) ay += 1;
  if (G.touch) {
    const dx = G.touchX - p.x, dy = G.touchY - p.y, d = Math.hypot(dx, dy);
    if (d > 22) { ax = dx / d; ay = dy / d; }
  }
  const m = Math.hypot(ax, ay);
  if (m > 0) { ax /= m; ay /= m; p.moveA = Math.atan2(ay, ax); }

  if (p.dashT > 0) {
    p.dashT -= dt;
    p.vx = Math.cos(p.dashA) * 2300;
    p.vy = Math.sin(p.dashA) * 2300;
    burst(p.x, p.y, 2, { hue: 190 + p.dashT * 420, spd: 90, life: 0.4, size: 6, kind: 'tri', rot: p.angle });
    if (p.dashT <= 0) { addShake(7); ringFx(p.x, p.y, 90, 200, 0.4); }
  } else {
    p.vx += ax * 3500 * dt;
    p.vy += ay * 3500 * dt;
    const dr = Math.exp(-9.5 * dt);
    p.vx *= dr; p.vy *= dr;
    const sp = Math.hypot(p.vx, p.vy), mx = 630;
    if (sp > mx) { p.vx *= mx / sp; p.vy *= mx / sp; }
  }
  p.x = clamp(p.x + p.vx * dt, p.r, W - p.r);
  p.y = clamp(p.y + p.vy * dt, p.r, H - p.r);

  const ta = Math.atan2(G.my - p.y, G.mx - p.x);
  p.angle = angLerp(p.angle, ta, 1 - Math.exp(-30 * dt));

  if (!G.dead) {
    if (p.fire && p.fireCd <= 0) fire();
    if (Math.random() < dt * 26) burst(p.x - p.vx * 0.02, p.y - p.vy * 0.02, 1, { hue: 195 + p.weapon * 22, spd: 40, life: 0.5, size: 3, kind: 'dot' });
  }
}
function fire() {
  const p = G.player, w = WEAPONS[p.weapon];
  p.fireCd = w.cd;
  for (let i = 0; i < w.n; i++) {
    const t = w.n === 1 ? 0 : i / (w.n - 1) - 0.5;
    const a = p.angle + t * w.spread + rand(-w.jit, w.jit);
    const spd = w.spd * rand(0.94, 1.06);
    const bx = p.x + Math.cos(a) * (p.r + 6), by = p.y + Math.sin(a) * (p.r + 6);
    G.bullets.push({ x: bx, y: by, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, dmg: w.dmg, size: w.size, hue: w.hue + rand(-14, 14), life: 1.6, pierce: w.pierce || 0 });
    burst(bx, by, w.n > 1 ? 1 : 2, { hue: w.hue, spd: 130, life: 0.22, size: 3, kind: 'spark', ang: a, spread: 0.5 });
  }
  /* a 20 shots/s cannon has to bound its own population, or the bullet list grows without limit */
  if (G.bullets.length > MAX_BULLETS) G.bullets.splice(0, G.bullets.length - MAX_BULLETS);
  p.vx -= Math.cos(p.angle) * 24;
  p.vy -= Math.sin(p.angle) * 24;
  addShake(0.9);
  /* alternating shots share one blip so the shot rate reads as a stream, not a stutter */
  p.shotSeq = (p.shotSeq | 0) + 1;
  if (p.weapon === 0 || (p.shotSeq & 1) === 0) sfx.shoot(p.weapon, pan(p.x));
}
function dash() {
  const p = G.player;
  if (!p || G.dead || p.dashT > 0 || p.dashCd > 0) return;
  p.dashA = p.moveA === null ? p.angle : p.moveA;
  p.dashT = 0.16;
  p.dashCd = 1.0;
  p.inv = Math.max(p.inv, 0.34);
  for (let k = 0; k < 12; k++) {
    G.particles.push({ x: p.x - p.vx * 0.004 * k, y: p.y - p.vy * 0.004 * k, vx: 0, vy: 0, life: 0.12 + k * 0.022, maxLife: 0.4, size: p.r * (1 - k * 0.05), hue: 195 + k * 14, kind: 'tri', rot: p.angle, drag: 0 });
  }
  addShake(8);
  burst(p.x, p.y, 26, { hue: 200, spd: 320, life: 0.5, size: 4, kind: 'spark', spread: TAU });
  sfx.dash(pan(p.x));
}
function shockwave() {
  const p = G.player;
  if (!p || G.dead || p.charge < 50) return;
  p.charge -= 50;
  const R = 380;
  G.shocks.push({ x: p.x, y: p.y, r: 8, max: R, t: 0, hue: 300 });
  addShake(28);
  G.flash = Math.max(G.flash, 0.55);
  G.freeze = Math.max(G.freeze, 0.05);
  sfx.shock(pan(p.x));
  for (let i = G.eBullets.length - 1; i >= 0; i--) {
    const b = G.eBullets[i];
    if (Math.hypot(b.x - p.x, b.y - p.y) < R) {
      burst(b.x, b.y, 7, { hue: 180, spd: 240, life: 0.45, size: 3, kind: 'spark', spread: TAU });
      G.eBullets.splice(i, 1);
      G.score += Math.round(8 * comboMult());
    }
  }
  for (let i = G.enemies.length - 1; i >= 0; i--) {
    const e = G.enemies[i];
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < R) {
      const f = 1 - d / R;
      const a = Math.atan2(e.y - p.y, e.x - p.x);
      e.stun = Math.max(e.stun, 0.5 * f);
      e.vx += Math.cos(a) * (e.boss ? 90 : 620) * f;
      e.vy += Math.sin(a) * (e.boss ? 90 : 620) * f;
      damageEnemy(e, (e.boss ? 20 : 12) * f * f + 2, a, p.x, p.y);
    }
  }
}

/* ================= enemies ================= */
function spawnEnemy(type, x, y, vel) {
  const t = TYPES[type], wn = G.wave;
  const hpS = 1 + wn * 0.18, spS = Math.min(1.9, 1 + wn * 0.038);
  const e = {
    type, x, y, vx: (vel && vel.x) || 0, vy: (vel && vel.y) || 0,
    r: t.r, hp: t.hp * hpS, maxHp: t.hp * hpS, spd: t.spd * spS, dmg: t.dmg * (1 + wn * 0.045),
    hue: (G.hue + t.hue) % 360, score: t.score, sides: t.sides,
    rot: rand(TAU), spin: rand(-1.7, 1.7), hit: 0, gun: t.gun ? t.gun * Math.max(0.6, 1 - wn * 0.02) : 0, gunT: rand(0.7, 2),
    stun: 0, boss: type === 'boss', ph: '', phT: 0, spiralA: rand(TAU), fireT: 0.2,
    orb: Math.random() < 0.5 ? -1 : 1, chargeA: 0
  };
  G.enemies.push(e);
  if (e.boss) { G.boss = e; setPhase(e, 'spiral'); sfx.roar(); addShake(22); G.flash = Math.max(G.flash, 0.6); }
  ringFx(x, y, e.r * 2.4, e.hue, 0.5);
  return e;
}
function setPhase(e, ph) {
  e.ph = ph;
  if (ph === 'spiral') { e.phT = rand(3.4, 4.4); e.fireT = 0.25; }
  else if (ph === 'summon') { e.phT = 1.9; e.summoned = false; }
  else { e.phT = 1.25; e.chargeA = Math.atan2(G.player.y - e.y, G.player.x - e.x); sfx.roar(); addShake(11); }
}
function updateBoss(e, dt, ux, uy) {
  e.phT -= dt;
  if (e.ph === 'spiral') {
    e.spiralA += dt * 3.6;
    e.vx += Math.cos(e.spiralA * 0.6) * e.spd * 2 * dt;
    e.vy += Math.sin(e.spiralA * 0.6) * e.spd * 2 * dt;
    e.fireT -= dt;
    if (e.fireT <= 0) {
      e.fireT = 0.14;
      for (let k = 0; k < 3; k++) addEBullet(e.x + Math.cos(e.spiralA + k * TAU / 3) * e.r, e.y + Math.sin(e.spiralA + k * TAU / 3) * e.r, e.spiralA + k * TAU / 3, 215, e.dmg * 0.5, e.hue + 40);
    }
    if (e.phT <= 0) setPhase(e, 'summon');
  } else if (e.ph === 'summon') {
    e.vx *= 0.96; e.vy *= 0.96;
    if (!e.summoned) {
      e.summoned = true;
      for (let k = 0; k < 4; k++) {
        const a = rand(TAU);
        addSpawner('mini', clamp(e.x + Math.cos(a) * e.r * 1.6, 30, W - 30), clamp(e.y + Math.sin(a) * e.r * 1.6, 30, H - 30), 0.45);
      }
      ringFx(e.x, e.y, 260, e.hue, 0.7);
    }
    if (e.phT <= 0) setPhase(e, 'charge');
  } else {
    e.vx += Math.cos(e.chargeA) * e.spd * 8 * dt;
    e.vy += Math.sin(e.chargeA) * e.spd * 8 * dt;
    burst(e.x, e.y, 2, { hue: e.hue, spd: 80, life: 0.5, size: 7, kind: 'dot' });
    if (e.phT <= 0) setPhase(e, 'spiral');
  }
  if (Math.random() < dt * 3) ringFx(e.x, e.y, e.r * 1.8, e.hue, 0.22);
}
function updateEnemies(dt) {
  const p = G.player;
  for (let i = G.enemies.length - 1; i >= 0; i--) {
    const e = G.enemies[i];
    e.rot += e.spin * dt;
    e.hit = Math.max(0, e.hit - dt * 5.5);
    if (e.stun > 0) e.stun -= dt;
    const dx = p.x - e.x, dy = p.y - e.y, dd = Math.hypot(dx, dy) || 1;
    const ux = dx / dd, uy = dy / dd;
    if (e.stun <= 0) {
      if (e.type === 'chaser' || e.type === 'splitter' || e.type === 'mini') {
        const wob = e.type === 'mini' ? Math.sin(G.time * 8 + e.rot) * 0.9 : 0;
        const a = Math.atan2(uy, ux) + wob;
        e.vx += Math.cos(a) * e.spd * 4.4 * dt;
        e.vy += Math.sin(a) * e.spd * 4.4 * dt;
      } else if (e.type === 'shooter') {
        const err = (dd - 320) / 320;
        e.vx += ux * err * e.spd * 3.4 * dt;
        e.vy += uy * err * e.spd * 3.4 * dt;
        e.vx += -uy * e.spd * 1.7 * dt * e.orb;
        e.vy += ux * e.spd * 1.7 * dt * e.orb;
      } else if (e.type === 'tank') {
        e.vx += ux * e.spd * 2.4 * dt;
        e.vy += uy * e.spd * 2.4 * dt;
      } else if (e.boss) {
        updateBoss(e, dt, ux, uy);
      }
    }
    const dr = Math.exp(-2.5 * dt);
    e.vx *= dr; e.vy *= dr;
    const sp = Math.hypot(e.vx, e.vy);
    const mx = e.spd * (e.type === 'mini' ? 1.6 : e.boss ? 3 : 1.3);
    if (sp > mx) { e.vx *= mx / sp; e.vy *= mx / sp; }
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    wallsEnemy(e);
    separation(e, i);
    if (e.gun) {
      e.gunT -= dt;
      if (e.gunT <= 0) { e.gunT = e.gun * rand(0.85, 1.2); if (dd < 700 && e.stun <= 0) enemyShoot(e, ux, uy); }
    }
    if (dd < e.r + p.r) touchPlayer(e);
  }
}
function separation(e, idx) {
  for (let j = idx - 1; j >= 0; j--) {
    const o = G.enemies[j];
    const dx = e.x - o.x, dy = e.y - o.y;
    const d = Math.hypot(dx, dy), min = (e.r + o.r) * 0.95;
    if (d > 0 && d < min) {
      const push = (min - d) * 9;
      const nx = dx / d, ny = dy / d;
      e.vx += nx * push; e.vy += ny * push;
      o.vx -= nx * push * 0.5; o.vy -= ny * push * 0.5;
    }
  }
}
function wallsEnemy(e) {
  let hit = false, hx = 0, hy = 0;
  if (e.x < e.r) { e.x = e.r; if (e.vx < 0) { hit = true; hx = 1; } e.vx = Math.abs(e.vx) * 0.5; }
  if (e.x > W - e.r) { e.x = W - e.r; if (e.vx > 0) { hit = true; hx = -1; } e.vx = -Math.abs(e.vx) * 0.5; }
  if (e.y < e.r) { e.y = e.r; if (e.vy < 0) { hit = true; hy = 1; } e.vy = Math.abs(e.vy) * 0.5; }
  if (e.y > H - e.r) { e.y = H - e.r; if (e.vy > 0) { hit = true; hy = -1; } e.vy = -Math.abs(e.vy) * 0.5; }
  if (hit) {
    const sp = Math.hypot(e.vx, e.vy);
    if (sp > 210) {
      burst(e.x, e.y, 12, { hue: e.hue, spd: 260, life: 0.4, size: 4, kind: 'spark', ang: Math.atan2(-hy, -hx), spread: 1.4 });
      addShake(Math.min(10, sp * 0.02));
      ringFx(e.x, e.y, 60, e.hue, 0.35);
      damageEnemy(e, 4 + sp * 0.03, Math.atan2(-hy, -hx), e.x, e.y);
    }
  }
}
function enemyShoot(e, ux, uy) {
  const p = G.player;
  const a = Math.atan2(p.y + p.vy * 0.3 - e.y, p.x + p.vx * 0.3 - e.x);
  addEBullet(e.x + ux * e.r, e.y + uy * e.r, a, 330, e.dmg * 0.75, e.hue);
  tone({ f: 620, f2: 220, type: 'square', dur: 0.09, gain: 0.05, pan: pan(e.x) });
  burst(e.x + ux * e.r, e.y + uy * e.r, 4, { hue: e.hue, spd: 150, life: 0.25, size: 3, kind: 'spark', ang: a, spread: 0.5 });
}
function addEBullet(x, y, a, spd, dmg, hue) {
  G.eBullets.push({ x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, dmg, size: 6, hue, life: 4 });
}
function touchPlayer(e) {
  const p = G.player;
  if (p.inv > 0 || G.dead) {
    const a = Math.atan2(e.y - p.y, e.x - p.x);
    e.vx += Math.cos(a) * 420; e.vy += Math.sin(a) * 420;
    return;
  }
  damagePlayer(e.dmg, e.x, e.y);
  killEnemy(e, true);
}

/* ================= damage, kills, scoring ================= */
const COMBO_CAP = 24;const comboMult = () => 1 + Math.max(0, Math.min(G.combo, COMBO_CAP) - 1) * 0.22;
const pan = (x) => clamp(x / W * 2 - 1, -1, 1);
const addShake = (m) => { G.shake = Math.min(46, G.shake + m); };

function damageEnemy(e, dmg, ang, fromX, fromY) {
  if (e.hp <= 0) return;
  e.hp -= dmg;
  e.hit = 1;
  const kx = Math.cos(ang), ky = Math.sin(ang);
  const kb = e.boss ? 22 : e.type === 'tank' ? 60 : 130;
  e.vx += kx * kb; e.vy += ky * kb;
  const px = fromX === undefined ? e.x - kx * e.r : fromX, py = fromY === undefined ? e.y - ky * e.r : fromY;
  burst(px, py, 6, { hue: e.hue + 30, spd: 300, life: 0.32, size: 3.4, kind: 'spark', ang, spread: 1.1 });
  sfx.hit(pan(px));
  if (e.hp <= 0) killEnemy(e, false);
}
function killEnemy(e, noDrop) {
  const idx = G.enemies.indexOf(e);
  if (idx < 0) return;
  G.enemies.splice(idx, 1);
  if (e.boss && G.boss === e) G.boss = null;
  G.kills++;
  G.combo = Math.min(COMBO_CAP, G.combo + 1);
  if (G.combo > G.bestCombo) G.bestCombo = G.combo;
  G.comboT = COMBO_T;
  const pts = Math.round(e.score * comboMult());
  G.score += pts;
  text(e.x, e.y - e.r, '+' + pts, e.hue);
  if (G.combo > 2) sfx.combo(G.combo);
  const p = G.player;
  p.charge = Math.min(100, p.charge + 1.2 + e.r * 0.1);
  explode(e.x, e.y, e.hue, e.r, e.boss ? 2.8 : 1);
  addShake(e.boss ? 40 : Math.min(19, 4 + e.r * 0.35));
  G.freeze = Math.max(G.freeze, e.boss ? 0.16 : Math.min(0.055, 0.014 + e.r * 0.0013));
  G.flash = Math.max(G.flash, e.boss ? 0.85 : 0.1);
  sfx.explode(e.r, pan(e.x), e.boss);
  if (e.type === 'splitter') {
    for (let k = 0; k < 3; k++) {
      const a = rand(TAU);
      spawnEnemy('mini', e.x + Math.cos(a) * e.r, e.y + Math.sin(a) * e.r, { x: Math.cos(a) * 300, y: Math.sin(a) * 300 });
    }
    ringFx(e.x, e.y, 180, e.hue, 0.7);
  }
  if (e.type === 'tank') G.booms.push({ x: e.x, y: e.y, r: 60, d: 0.18, hue: e.hue + 40 });
  if (e.boss) {
    for (let k = 0; k < 11; k++) {
      G.booms.push({ x: e.x + rand(-e.r, e.r), y: e.y + rand(-e.r, e.r), r: rand(24, 70), d: 0.06 + k * 0.11, hue: e.hue + rand(-50, 50) });
    }
    G.slowT = Math.max(G.slowT, 1.3);
    G.shocks.push({ x: e.x, y: e.y, r: 10, max: 900, t: 0, hue: e.hue });
    addShake(46);
  }
  if (!noDrop) drop(e);
}
function explode(x, y, hue, r, scale) {
  const n = Math.round(clamp(r * 1.5 * scale, 10, 90));
  burst(x, y, n, { hue: hue, spd: 220 * scale, life: 0.7, size: 4.5, kind: 'spark', spread: TAU, drag: 2.4 });
  burst(x, y, Math.round(n * 0.4), { hue: hue + 40, spd: 120 * scale, life: 0.9, size: 7, kind: 'dot', spread: TAU, drag: 1.8 });
  burst(x, y, Math.round(clamp(3 * scale, 3, 12)), { hue: hue + 20, spd: 190, life: 0.8, size: 9 * scale, kind: 'poly', spread: TAU, drag: 1.4 });
  burst(x, y, Math.round(clamp(4 * scale, 4, 16)), { hue: hue - 30, spd: 90, life: 1.1, size: 12 * scale, kind: 'smoke', spread: TAU, drag: 2.6 });
  ringFx(x, y, r * 5 * scale, hue, Math.min(1, 0.45 * scale));
  flashRing(x, y, r * 9 * scale, hue + 25, Math.min(1, 0.5 * scale));
}
function damagePlayer(dmg, sx, sy) {
  const p = G.player;
  if (p.inv > 0 || G.dead) return;
  if (p.shield > 0) {
    p.shield = Math.max(0, p.shield - 1.1);
    p.inv = 0.3;
    ringFx(p.x, p.y, 150, 55, 0.8);
    burst(p.x, p.y, 20, { hue: 55, spd: 320, life: 0.4, size: 4, kind: 'spark', spread: TAU });
    tone({ f: 900, f2: 300, type: 'triangle', dur: 0.2, gain: 0.14 });
    addShake(9);
    return;
  }
  p.hp -= dmg;
  p.hits++;
  p.inv = 0.6;
  G.hurt = 1;
  addShake(24);
  G.freeze = Math.max(G.freeze, 0.055);
  G.combo = Math.floor(G.combo / 2);
  const a = Math.atan2(p.y - sy, p.x - sx);
  p.vx += Math.cos(a) * 260; p.vy += Math.sin(a) * 260;
  burst(p.x, p.y, 26, { hue: 0, spd: 340, life: 0.55, size: 4, kind: 'spark', ang: a, spread: 1.6 });
  ringFx(p.x, p.y, 130, 0, 0.7);
  text(p.x, p.y - 26, '-' + Math.round(dmg), 0);
  sfx.hurt();
  if (p.hp <= 0) gameOver();
}
function gameOver() {
  const p = G.player;
  p.hp = 0;
  G.dead = true;
  G.deadT = 1.5;
  G.slowT = 1.6;
  G.freeze = 0.12;
  addShake(46);
  G.flash = 1;
  explode(p.x, p.y, 200, 40, 2.4);
  G.shocks.push({ x: p.x, y: p.y, r: 10, max: Math.max(W, H), t: 0, hue: 200 });
  for (let k = 0; k < 8; k++) G.booms.push({ x: p.x + rand(-60, 60), y: p.y + rand(-60, 60), r: rand(20, 50), d: 0.1 + k * 0.12, hue: rand(360) });
  sfx.over();
  try { G.best = Math.max(G.best, G.score); localStorage.setItem('chroma-rush-best', String(G.best)); } catch (e) {}
}

/* ================= bullets & pickups ================= */
function updateBullets(dt) {
  for (let i = G.bullets.length - 1; i >= 0; i--) {
    const b = G.bullets[i];
    b.x += b.vx * dt; b.y += b.vy * dt;
    b.life -= dt;
    if (Math.random() < dt * 40) burst(b.x, b.y, 1, { hue: b.hue, spd: 30, life: 0.25, size: b.size * 0.8, kind: 'dot' });
    if (b.life <= 0 || b.x < -30 || b.y < -30 || b.x > W + 30 || b.y > H + 30) {
      if (b.x < 0 || b.y < 0 || b.x > W || b.y > H) burst(clamp(b.x, 2, W - 2), clamp(b.y, 2, H - 2), 5, { hue: b.hue, spd: 200, life: 0.25, size: 3, kind: 'spark', spread: 2 });
      G.bullets.splice(i, 1);
    }
  }
  for (let i = G.eBullets.length - 1; i >= 0; i--) {
    const b = G.eBullets[i];
    b.x += b.vx * dt; b.y += b.vy * dt;
    b.life -= dt;
    if (Math.random() < dt * 25) burst(b.x, b.y, 1, { hue: b.hue, spd: 25, life: 0.3, size: b.size * 0.7, kind: 'dot' });
    if (b.life <= 0 || b.x < -40 || b.y < -40 || b.x > W + 40 || b.y > H + 40) { G.eBullets.splice(i, 1); continue; }
    const p = G.player;
    if (!G.dead && Math.hypot(b.x - p.x, b.y - p.y) < p.r + b.size * 0.5) {
      damagePlayer(b.dmg, b.x, b.y);
      burst(b.x, b.y, 10, { hue: b.hue, spd: 250, life: 0.35, size: 3, kind: 'spark', spread: TAU });
      G.eBullets.splice(i, 1);
    }
  }
}
function collide() {
  for (let i = G.bullets.length - 1; i >= 0; i--) {
    const b = G.bullets[i];
    let hitE = null;
    for (let j = G.enemies.length - 1; j >= 0; j--) {
      const e = G.enemies[j];
      const dx = e.x - b.x, dy = e.y - b.y, rr = e.r + b.size;
      if (dx * dx + dy * dy < rr * rr) { hitE = e; break; }
    }
    if (hitE) {
      damageEnemy(hitE, b.dmg, Math.atan2(b.vy, b.vx), b.x, b.y);
      if (b.pierce > 0) { b.pierce--; b.dmg *= 0.75; } else G.bullets.splice(i, 1);
    }
  }
}
const PICKS = {
  gem: { hue: 45, label: '◆' },
  heal: { hue: 140, label: '+' },
  gun: { hue: 200, label: '★' },
  slow: { hue: 265, label: '◷' }
};
function drop(e) {
  const r = Math.random();
  if (e.boss) {
    addPickup(e.x, e.y, 'heal'); addPickup(e.x + 46, e.y, 'gun'); addPickup(e.x - 46, e.y, 'slow');
    addPickup(e.x, e.y + 46, 'gem'); addPickup(e.x, e.y - 46, 'gem');
    return;
  }
  if (e.type === 'tank') { addPickup(e.x, e.y, r < 0.55 ? 'gun' : 'heal'); addPickup(e.x + 30, e.y + 20, 'gem'); return; }
  if (r < 0.06) addPickup(e.x, e.y, 'heal');
  else if (r < 0.1) addPickup(e.x, e.y, 'gun');
  else if (r < 0.135) addPickup(e.x, e.y, 'slow');
  else addPickup(e.x, e.y, 'gem');
}
function addPickup(x, y, type) {
  G.pickups.push({ x: clamp(x, 20, W - 20), y: clamp(y, 20, H - 20), vx: rand(-70, 70), vy: rand(-70, 70), type, t: 0, life: 14, hue: PICKS[type].hue });
}
function updatePickups(dt) {
  const p = G.player;
  for (let i = G.pickups.length - 1; i >= 0; i--) {
    const k = G.pickups[i];
    k.t += dt; k.life -= dt;
    const dx = p.x - k.x, dy = p.y - k.y, d = Math.hypot(dx, dy) || 1;
    if (d < 210) { const pull = (1 - d / 210) * 2600; k.vx += dx / d * pull * dt; k.vy += dy / d * pull * dt; }
    const dr = Math.exp(-2.2 * dt); k.vx *= dr; k.vy *= dr;
    k.x += k.vx * dt; k.y += k.vy * dt;
    if (Math.random() < dt * 12) burst(k.x, k.y, 1, { hue: k.hue, spd: 40, life: 0.5, size: 3, kind: 'dot' });
    if (!G.dead && d < p.r + 16) { collect(k); G.pickups.splice(i, 1); continue; }
    if (k.life <= 0) { burst(k.x, k.y, 6, { hue: k.hue, spd: 90, life: 0.4, size: 3, kind: 'spark', spread: TAU }); G.pickups.splice(i, 1); }
  }
}
function collect(k) {
  const p = G.player;
  sfx.pickup(p.weapon, pan(k.x));
  if (k.type === 'gem') {
    const pts = Math.round(60 * comboMult());
    G.score += pts;
    p.charge = Math.min(100, p.charge + 5);
    text(k.x, k.y, '+' + pts, 45);
  } else if (k.type === 'heal') {
    p.hp = Math.min(p.maxHp, p.hp + 20);
    text(k.x, k.y, '+24 HP', 140);
  } else if (k.type === 'gun') {
    if (p.weapon < WEAPONS.length - 1) {
      p.weapon++;
      text(k.x, k.y, WEAPONS[p.weapon].name, 200);
      p.shield = Math.max(p.shield, 2.4);
    } else {
      p.charge = Math.min(100, p.charge + 40);
      G.score += 400;
      text(k.x, k.y, '+400', 200);
    }
    ringFx(k.x, k.y, 220, 200, 0.9);
    addShake(8);
  } else {
    G.slowT = Math.max(G.slowT, 4.2);
    p.charge = Math.min(100, p.charge + 15);
    text(k.x, k.y, 'SLOW', 265);
    ringFx(k.x, k.y, 320, 265, 0.9);
  }
  burst(k.x, k.y, 18, { hue: k.hue, spd: 260, life: 0.5, size: 4, kind: 'spark', spread: TAU });
}

/* ================= particles ================= */
function cap() { if (G.particles.length > 1900) G.particles.splice(0, G.particles.length - 1900); }
function burst(x, y, n, o) {
  o = o || {};
  const ang = o.ang === undefined ? 0 : o.ang;
  const spread = o.spread === undefined ? 0.6 : o.spread;
  for (let i = 0; i < n; i++) {
    const a = ang + rand(-spread / 2, spread / 2) + (spread >= TAU ? rand(TAU) : 0);
    const sp = (o.spd || 200) * rand(0.35, 1.25);
    const life = (o.life || 0.5) * rand(0.65, 1.35);
    G.particles.push({
      x: x + rand(-2, 2), y: y + rand(-2, 2),
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life, maxLife: life, size: (o.size || 4) * rand(0.7, 1.4),
      hue: (o.hue || 0) + rand(-22, 22), kind: o.kind || 'spark',
      rot: rand(TAU), spin: rand(-7, 7), drag: o.drag === undefined ? 2.2 : o.drag
    });
  }
  cap();
}
function ringFx(x, y, r, hue, alpha) {
  G.particles.push({ x, y, vx: 0, vy: 0, life: 0.42, maxLife: 0.42, size: r, hue, kind: 'ring', rot: 0, spin: 0, drag: 0, alpha });
  cap();
}
function flashRing(x, y, r, hue, alpha) {
  G.particles.push({ x, y, vx: 0, vy: 0, life: 0.7, maxLife: 0.7, size: r, hue, kind: 'flashring', rot: 0, spin: 0, drag: 0, alpha });
  cap();
}
function text(x, y, str, hue) {
  G.particles.push({ x, y, vx: rand(-30, 30), vy: -95, life: 1.1, maxLife: 1.1, size: 20, hue, kind: 'text', str, rot: 0, spin: 0, drag: 1.6 });
  cap();
}
function updateParticles(dt) {
  for (let i = G.particles.length - 1; i >= 0; i--) {
    const q = G.particles[i];
    q.life -= dt;
    if (q.life <= 0) { G.particles.splice(i, 1); continue; }
    const dr = Math.exp(-(q.drag || 0) * dt);
    q.vx *= dr; q.vy *= dr;
    q.x += q.vx * dt; q.y += q.vy * dt;
    q.rot += q.spin * dt;
  }
}
function updateShocks(dt) {
  for (let i = G.shocks.length - 1; i >= 0; i--) {
    const s = G.shocks[i];
    s.t += dt;
    const k = s.t / 0.55;
    s.r = 8 + (s.max - 8) * (1 - Math.pow(1 - Math.min(1, k), 2.4));
    if (k >= 1) G.shocks.splice(i, 1);
  }
}
function updateBooms(dt) {
  for (let i = G.booms.length - 1; i >= 0; i--) {
    const b = G.booms[i];
    b.d -= dt;
    if (b.d <= 0) {
      explode(b.x, b.y, b.hue, b.r, 1.1);
      addShake(12);
      G.freeze = Math.max(G.freeze, 0.03);
      sfx.explode(b.r, pan(b.x), true);
      G.booms.splice(i, 1);
    }
  }
}
function releaseSpawner(s) {
  if (s.type === 'swarm') {
    const n = randi(5, 9);
    for (let k = 0; k < n; k++) {
      const a = k * TAU / n + rand(-0.3, 0.3);
      const sp = rand(170, 330);
      spawnEnemy('mini', s.x + Math.cos(a) * 14, s.y + Math.sin(a) * 14, { x: Math.cos(a) * sp, y: Math.sin(a) * sp });
    }
    ringFx(s.x, s.y, 190, s.hue, 0.85);
    flashRing(s.x, s.y, 120, s.hue + 30, 0.7);
    addShake(6);
    tone({ f: 240, f2: 900, type: 'square', dur: 0.22, gain: 0.09, pan: pan(s.x) });
  } else if (s.type === 'trio') {
    for (let k = 0; k < 3; k++) {
      const a = rand(TAU);
      spawnEnemy('shooter', s.x + Math.cos(a) * 26, s.y + Math.sin(a) * 26, { x: Math.cos(a) * 140, y: Math.sin(a) * 140 });
    }
    ringFx(s.x, s.y, 150, s.hue, 0.75);
    addShake(5);
  } else {
    spawnEnemy(s.type, s.x, s.y);
  }
}
function updateSpawners(dt) {
  for (let i = G.spawners.length - 1; i >= 0; i--) {
    const s = G.spawners[i];
    s.t -= dt;
    if (Math.random() < dt * 30) {
      const a = rand(TAU);
      G.particles.push({ x: s.x + Math.cos(a) * 46 * (s.t / s.t0), y: s.y + Math.sin(a) * 46 * (s.t / s.t0), vx: -Math.cos(a) * 90, vy: -Math.sin(a) * 90, life: 0.4, maxLife: 0.4, size: 3, hue: s.hue, kind: 'spark', rot: 0, spin: 0, drag: 3 });
    }
    if (s.t <= 0) {
      releaseSpawner(s);
      G.spawners.splice(i, 1);
    }
  }
  cap();
}

/* ================= main update ================= */
function update(raw) {
  const wall = Math.min(raw, 0.05);
  G.time += raw;
  let dt = wall;
  if (G.freeze > 0) { G.freeze -= raw; dt = wall * 0.07; }
  G.timeScale = lerp(G.timeScale, G.slowT > 0 ? 0.32 : 1, 1 - Math.exp(-6 * raw));
  if (G.slowT > 0) G.slowT -= raw;
  dt *= G.timeScale;

  G.hue = G.hue + ((G.hueT - G.hue) * (1 - Math.exp(-1.6 * raw)));
  G.shake = Math.max(0, G.shake - 30 * raw);
  G.flash = Math.max(0, G.flash - 3.2 * raw);
  G.hurt = Math.max(0, G.hurt - 2 * raw);
  G.pulse = Math.max(0, G.pulse - raw * 3.5);
  G.waveBanner = Math.max(0, G.waveBanner - raw);
  G.shown = lerp(G.shown, G.score, 1 - Math.exp(-14 * raw));

  if (!G.dead) {
    if (G.comboT > 0) { G.comboT -= raw; if (G.comboT <= 0 && G.combo > 0) G.combo = 0; }   /* window is 2.3s: chains demand aggression */
  }
  updatePlayer(dt);
  updateBullets(dt);
  updateEnemies(dt);
  collide();
  updatePickups(dt);
  updateSpawners(dt);
  updateShocks(dt);
  updateBooms(dt);
  updateParticles(wall * (G.slowT > 0 ? 0.55 : 1));
  waves(raw);
  if (G.dead) {
    G.deadT -= raw;
    G.timeScale = lerp(G.timeScale, 0.35, 1 - Math.exp(-2 * raw));
    if (G.deadT <= 0 && !G.overShown) showOver();
  }
}

/* ================= render ================= */
function drawBackground(t) {
  const h = G.hue;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = hsl(h, 55, 6, 0.3);
  ctx.fillRect(-60, -60, W + 120, H + 120);

  const px = G.player ? G.player.x - W / 2 : 0, py = G.player ? G.player.y - H / 2 : 0;
  for (const s of stars) {
    let x = ((s.x - px * s.z * 0.06) % W + W) % W;
    let y = ((s.y - py * s.z * 0.06) % H + H) % H;
    ctx.fillStyle = hsl(h + s.h, 70, 72, 0.13 + 0.3 * s.z);
    const sz = s.s * (1 + G.pulse * 0.4);
    ctx.fillRect(x, y, sz, sz);
  }

  const step = 96;
  ctx.strokeStyle = hsl(h + 34, 90, 58, 0.045 + 0.05 * G.pulse);
  ctx.lineWidth = 1;
  ctx.beginPath();
  const gx = ((-px * 0.035) % step + step) % step;
  const gy = ((-py * 0.035) % step + step) % step;
  for (let x = gx; x < W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = gy; y < H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();

  ctx.globalCompositeOperation = 'lighter';
  glow(W / 2, H / 2, Math.max(W, H) * 0.75, h + 190, 90, 40, 0.05 + 0.03 * G.pulse);
  glow(W / 2, H / 2, Math.min(W, H) * 0.5, h + 40, 90, 50, 0.04 * G.pulse);
}
function drawSpawners() {
  for (const s of G.spawners) {
    const k = 1 - s.t / s.t0;
    ringStroke(s.x, s.y, 10 + (1 - k) * 44, 2, s.hue, 72, 0.2 + 0.6 * k);
    ringStroke(s.x, s.y, Math.max(1, 46 - 46 * k), 1.5, s.hue + 30, 85, 0.25 + 0.5 * k);
    glow(s.x, s.y, 26 * k, s.hue, 100, 60, 0.35 * k);
  }
}
function drawShocks() {
  for (const s of G.shocks) {
    const k = 1 - Math.min(1, s.t / 0.55);
    ringStroke(s.x, s.y, s.r, 3 + 12 * k, s.hue, 80, 0.55 * k);
    ringStroke(s.x, s.y, s.r * 0.82, 2, s.hue + 40, 92, 0.35 * k);
    glow(s.x, s.y, s.r * 0.5, s.hue, 100, 70, 0.22 * k);
  }
}
function drawBullets() {
  ctx.lineCap = 'round';
  for (const b of G.bullets) {
    const a = Math.atan2(b.vy, b.vx);
    const tx = b.x - Math.cos(a) * b.size * 5, ty = b.y - Math.sin(a) * b.size * 5;
    ctx.strokeStyle = hsl(b.hue, 100, 78, 0.95);
    ctx.lineWidth = b.size;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(b.x, b.y); ctx.stroke();
    glow(b.x, b.y, b.size * 3.4, b.hue, 100, 62, 0.6);
  }
}
function drawEBullets(t) {
  for (const b of G.eBullets) {
    const a = Math.atan2(b.vy, b.vx);
    const pulse = 1 + 0.25 * Math.sin(t * 22);
    ctx.strokeStyle = hsl(b.hue, 100, 72, 0.9);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(b.x - Math.cos(a) * b.size * 1.6, b.y - Math.sin(a) * b.size * 1.6);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    glow(b.x, b.y, b.size * 2.4 * pulse, b.hue, 100, 58, 0.75);
    ringStroke(b.x, b.y, b.size * 0.9, 1.5, b.hue + 20, 95, 0.7);
  }
}
function drawEnemy(e) {
  const h = e.hue, hit = e.hit;
  glow(e.x, e.y, e.r * 2.2, h, 100, 55, 0.3 + hit * 0.5);
  ctx.lineWidth = 2 + e.r * 0.07;
  ctx.strokeStyle = hsl(h, 100, 72, 0.95);
  ctx.fillStyle = hsl(h, 100, 42, 0.3);
  polyPath(e.x, e.y, e.r, e.sides, e.rot);
  ctx.fill(); ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = hsl(h + 26, 100, 86, 0.75);
  polyPath(e.x, e.y, e.r * 0.55, e.sides, -e.rot * 1.7);
  ctx.stroke();
  if (e.type === 'splitter') {
    for (let k = 0; k < 3; k++) {
      const a = e.rot * 2 + k * TAU / 3;
      glow(e.x + Math.cos(a) * e.r * 0.42, e.y + Math.sin(a) * e.r * 0.42, 6, h + 15, 100, 70, 0.9);
    }
  }
  if (e.gun && e.gunT < 0.5 && !G.dead) {
    const k = (0.5 - e.gunT) * 2;
    ctx.strokeStyle = hsl(28, 100, 62, 0.22 * k);
    ctx.lineWidth = 1 + 3 * k;
    ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(G.player.x, G.player.y); ctx.stroke();
    glow(e.x, e.y, e.r * (1 + k), 28, 100, 60, 0.4 * k);
  }
  if (e.hp < e.maxHp && !e.boss) {
    const f = clamp(e.hp / e.maxHp, 0, 1);
    ringStroke(e.x, e.y, e.r * 1.35, 2.5, 120 - 110 * (1 - f), 65, 0.85);
    ctx.strokeStyle = hsl(0, 0, 100, 0.12);
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 1.35, 0, TAU); ctx.stroke();
  }
  if (hit > 0) {
    ctx.fillStyle = 'rgba(255,255,255,' + (hit * 0.75).toFixed(3) + ')';
    polyPath(e.x, e.y, e.r, e.sides, e.rot);
    ctx.fill();
  }
  if (e.boss) drawBoss(e);
}
function drawBoss(e) {
  const t = G.time;
  glow(e.x, e.y, e.r * 4.2, e.hue, 100, 50, 0.35 + 0.1 * Math.sin(t * 4));
  ringStroke(e.x, e.y, e.r * (1.5 + 0.12 * Math.sin(t * 3)), 3, e.hue + 60, 85, 0.55);
  ringStroke(e.x, e.y, e.r * 2.1, 1.5, e.hue - 40, 90, 0.35);
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(e.spiralA * 0.4);
  ctx.strokeStyle = hsl(e.hue + 30, 100, 88, 0.5);
  ctx.lineWidth = 2;
  for (let k = 0; k < 5; k++) {
    ctx.beginPath();
    ctx.arc(0, 0, e.r * 1.1, k * TAU / 5, k * TAU / 5 + 0.8);
    ctx.stroke();
  }
  ctx.restore();
  const f = clamp(e.hp / e.maxHp, 0, 1);
  const bw = Math.min(W * 0.72, 720), bx = (W - bw) / 2;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(0,0,0,.55)';
  ctx.fillRect(bx - 3, 27, bw + 6, 16);
  ctx.fillStyle = hsl(e.hue + (1 - f) * 120, 100, 60, 0.95);
  ctx.fillRect(bx, 30, bw * f, 10);
  ctx.strokeStyle = hsl(e.hue, 100, 85, 0.5);
  ctx.lineWidth = 1;
  ctx.strokeRect(bx - 3, 27, bw + 6, 16);
  ctx.font = '700 13px ui-monospace,monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.fillText('ARENA BOSS · ' + e.ph.toUpperCase(), W / 2, 62);
  ctx.globalCompositeOperation = 'lighter';
}
function drawPlayer(t) {
  const p = G.player;
  if (G.dead || !p) return;
  const hue = 188 + p.weapon * 22;
  glow(p.x, p.y, p.r * 3.6, hue, 100, 60, 0.42);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);
  ctx.beginPath();
  ctx.moveTo(p.r * 1.7, 0);
  ctx.lineTo(-p.r * 0.95, p.r);
  ctx.lineTo(-p.r * 0.35, 0);
  ctx.lineTo(-p.r * 0.95, -p.r);
  ctx.closePath();
  ctx.fillStyle = hsl(hue, 100, 70, 0.95);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  const hf = clamp(p.hp / p.maxHp, 0, 1);
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r * 1.75, -Math.PI / 2, -Math.PI / 2 + TAU * hf);
  ctx.strokeStyle = hsl(130 - 130 * (1 - hf), 100, 66, 0.85);
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r * 2.35, -Math.PI / 2, -Math.PI / 2 + TAU * (p.charge / 100));
  ctx.strokeStyle = hsl(320, 100, 72, p.charge >= 50 ? 1 : 0.45);
  ctx.lineWidth = 2;
  ctx.stroke();
  if (p.charge >= 50) glow(p.x, p.y, p.r * 3 * (1 + 0.15 * Math.sin(t * 12)), 320, 100, 70, 0.35);
  if (p.shield > 0) ringStroke(p.x, p.y, p.r * 3 + 2 * Math.sin(t * 17), 3, 55, 78, 0.55 + 0.35 * Math.sin(t * 13));
  if (p.inv > 0) ringStroke(p.x, p.y, p.r * 2.7, 2, 200, 92, Math.min(1, p.inv * 2));
  if (p.dashCd > 0 && p.dashT <= 0) ringStroke(p.x, p.y, p.r * 2.9, 1.5, 210, 70, 0.3 * (1 - p.dashCd));
}
function drawParticles(t) {
  for (const q of G.particles) {
    const life = q.life / q.maxLife;
    if (life <= 0) continue;
    if (q.kind === 'text') continue;
    if (q.kind === 'ring') {
      const k = 1 - life;
      ringStroke(q.x, q.y, q.size * (0.15 + k * 0.95), 2 + 6 * life, q.hue, 85, (q.alpha || 0.6) * life);
    } else if (q.kind === 'flashring') {
      const k = 1 - life;
      ringStroke(q.x, q.y, q.size * (0.05 + k * 1.1), 14 * life, q.hue, 95, (q.alpha || 0.4) * life * 0.5);
    } else if (q.kind === 'smoke') {
      ctx.globalCompositeOperation = 'source-over';
      glow(q.x, q.y, q.size * (1.5 - life * 0.4), q.hue, 55, 22, 0.32 * life);
      ctx.globalCompositeOperation = 'lighter';
    } else if (q.kind === 'spark') {
      const a = Math.atan2(q.vy, q.vx);
      const len = 3 + 12 * life;
      ctx.strokeStyle = hsl(q.hue, 100, 76, 0.9 * life);
      ctx.lineWidth = Math.max(0.8, q.size * life);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(q.x - Math.cos(a) * len, q.y - Math.sin(a) * len);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    } else if (q.kind === 'poly') {
      ctx.strokeStyle = hsl(q.hue, 100, 78, 0.85 * life);
      ctx.lineWidth = 2;
      polyPath(q.x, q.y, q.size * (0.4 + life * 0.8), 3 + (Math.round(q.size) % 3), q.rot);
      ctx.stroke();
    } else if (q.kind === 'tri') {
      ctx.fillStyle = hsl(q.hue, 100, 72, 0.5 * life);
      triPath(q.x, q.y, q.size * life, q.rot);
      ctx.fill();
    } else {
      glow(q.x, q.y, q.size * (0.6 + life), q.hue, 100, 68, 0.85 * life);
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.textAlign = 'center';
  ctx.font = '800 20px ui-monospace,monospace';
  for (const q of G.particles) {
    if (q.kind !== 'text') continue;
    const life = q.life / q.maxLife;
    ctx.globalAlpha = Math.min(1, life * 1.6);
    ctx.fillStyle = hsl(q.hue, 100, 78, 1);
    ctx.fillText(q.str, q.x, q.y);
    ctx.globalAlpha = 1;
  }
  ctx.globalCompositeOperation = 'lighter';
}

/* ================= HUD + overlays ================= */
const FONT = 'ui-monospace,monospace';
function drawHud(t) {
  const p = G.player;
  ctx.globalCompositeOperation = 'source-over';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.font = '800 34px ' + FONT;
  ctx.fillStyle = '#fff';
  ctx.shadowColor = hsl(190, 100, 60, 0.9);
  ctx.shadowBlur = 18;
  ctx.fillText(String(Math.round(G.shown)).padStart(6, '0'), 22, 42);
  ctx.shadowBlur = 0;
  ctx.font = '700 12px ' + FONT;
  ctx.fillStyle = hsl(200, 60, 75, 0.75);
  ctx.fillText('BEST ' + String(G.best).padStart(6, '0'), 22, 60);

  ctx.textAlign = 'right';
  ctx.font = '800 15px ' + FONT;
  ctx.fillStyle = hsl(G.hue, 100, 80, 0.95);
  ctx.fillText((G.wave % 5 === 0 ? 'BOSS WAVE ' : 'WAVE ') + G.wave, W - 22, 38);
  ctx.font = '700 11px ' + FONT;
  ctx.fillStyle = hsl(0, 0, 100, 0.42);
  ctx.fillText(WEAPONS[p.weapon].name + ' · KILLS ' + G.kills, W - 22, 56);
  if (G.fps) { ctx.fillStyle = hsl(60, 80, 70, 0.35); ctx.fillText(Math.round(G.fps) + ' FPS', W - 22, 74); }

  /* combo meter — the heart of the juice */
  const cw = Math.min(300, W * 0.34);
  const cx = 22, cy = H - 62;
  ctx.textAlign = 'left';
  if (G.combo > 1) {
    const k = clamp(G.comboT / COMBO_T, 0, 1);
    const mult = comboMult();
    ctx.font = '800 28px ' + FONT;
    ctx.fillStyle = '#fff';
    ctx.shadowColor = hsl(G.combo * 12, 100, 60, 1);
    ctx.shadowBlur = 22;
    ctx.fillText('x' + mult.toFixed(2), cx, cy);
    ctx.shadowBlur = 0;
    ctx.fillStyle = hsl(0, 0, 100, 0.22);
    ctx.fillRect(cx, cy + 8, cw, 6);
    ctx.fillStyle = hsl(G.combo * 12, 100, 62, 0.95);
    ctx.fillRect(cx, cy + 8, cw * k, 6);
    ctx.font = '700 11px ' + FONT;
    ctx.fillStyle = hsl(G.combo * 12, 100, 80, 0.8);
    ctx.fillText('CHAIN ' + G.combo, cx + cw + 12, cy + 15);
  }

  /* hp + charge bars */
  const bw = Math.min(320, W * 0.4), bx = (W - bw) / 2, by = H - 34;
  const hf = clamp(p.hp / p.maxHp, 0, 1);
  ctx.fillStyle = 'rgba(255,255,255,.13)';
  ctx.fillRect(bx, by, bw, 9);
  ctx.fillStyle = hsl(130 - 130 * (1 - hf), 100, 58, 0.95);
  ctx.fillRect(bx, by, bw * hf, 9);
  ctx.fillStyle = hsl(320, 100, 62, 0.95);
  ctx.fillRect(bx, by + 13, bw * (p.charge / 100), 4);
  ctx.font = '700 11px ' + FONT;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,.6)';
  ctx.fillText('HULL ' + Math.max(0, Math.ceil(p.hp)) + '   SHOCK ' + Math.round(p.charge) + '%', W / 2, by - 7);
  if (p.charge >= 50 && !G.dead) {
    ctx.fillStyle = hsl(320, 100, 82, 0.55 + 0.45 * Math.sin(t * 9));
    ctx.font = '800 13px ' + FONT;
    ctx.fillText('SPACE ▸ SHOCKWAVE', W / 2, by + 34);
  }
  if (p.shield > 0) { ctx.fillStyle = hsl(55, 100, 80, 0.8); ctx.fillText('SHIELD ' + p.shield.toFixed(1) + 's', W / 2, by - 22); }
  if (G.slowT > 0) { ctx.fillStyle = hsl(265, 100, 85, 0.8); ctx.fillText('TIME DILATION ' + G.slowT.toFixed(1) + 's', W / 2, by - 22); }

  /* wave banner */
  if (G.waveBanner > 0) {
    const k = clamp(G.waveBanner / 2.1, 0, 1);
    ctx.textAlign = 'center';
    ctx.globalAlpha = Math.min(1, k * 2.2);
    ctx.font = '800 ' + Math.round(30 + 46 * (1 - k)) + 'px ' + FONT;
    ctx.fillStyle = '#fff';
    ctx.shadowColor = hsl(G.hue + (G.wave % 5 === 0 ? 140 : 0), 100, 60, 1);
    ctx.shadowBlur = 40;
    ctx.fillText(G.waveLabel, W / 2, H * 0.42);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
}
function drawOverlays(t) {
  ctx.globalCompositeOperation = 'source-over';
  if (G.flash > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (G.flash * 0.5).toFixed(3) + ')'; ctx.fillRect(-60, -60, W + 120, H + 120); }
  if (G.hurt > 0) {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.28, W / 2, H / 2, Math.max(W, H) * 0.62);
    g.addColorStop(0, 'rgba(255,40,60,0)');
    g.addColorStop(1, 'rgba(255,40,60,' + (0.55 * G.hurt).toFixed(3) + ')');
    ctx.fillStyle = g;
    ctx.fillRect(-60, -60, W + 120, H + 120);
  }
  if (G.slowT > 0) {
    ctx.fillStyle = 'rgba(90,140,255,' + (0.1 * clamp(G.slowT / 4, 0.2, 1)).toFixed(3) + ')';
    ctx.fillRect(-60, -60, W + 120, H + 120);
  }
  const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.34, W / 2, H / 2, Math.max(W, H) * 0.72);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,.55)');
  ctx.fillStyle = v;
  ctx.fillRect(-60, -60, W + 120, H + 120);
}
function render() {
  const t = G.time;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  if (G.shake > 0) ctx.translate(rand(-G.shake, G.shake), rand(-G.shake, G.shake));
  drawBackground(t);
  ctx.globalCompositeOperation = 'lighter';
  drawSpawners();
  drawShocks();
  drawPickups(t);
  drawEBullets(t);
  drawBullets();
  for (const e of G.enemies) drawEnemy(e);
  drawParticles(t);
  drawPlayer(t);
  drawHud(t);
  drawOverlays(t);
}
function drawPickups(t) {
  for (const k of G.pickups) {
    const pulse = 1 + 0.16 * Math.sin(t * 8 + k.x);
    const fade = k.life < 3 ? 0.35 + 0.65 * Math.abs(Math.sin(t * 12)) : 1;
    glow(k.x, k.y, 26 * pulse, k.hue, 100, 62, 0.6 * fade);
    ctx.save();
    ctx.translate(k.x, k.y);
    ctx.rotate(t * 1.6);
    ctx.strokeStyle = hsl(k.hue, 100, 85, 0.95 * fade);
    ctx.lineWidth = 2;
    polyPath(0, 0, 11 * pulse, 4, 0);
    ctx.stroke();
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = '800 15px ' + FONT;
    ctx.textAlign = 'center';
    ctx.fillStyle = hsl(k.hue, 100, 92, fade);
    ctx.fillText(PICKS[k.type].label, k.x, k.y + 5);
    ctx.globalCompositeOperation = 'lighter';
  }
}

/* ================= DOM glue ================= */
const el = {};
['menu', 'pause', 'over', 'stats', 'btn-start', 'btn-restart'].forEach((id) => { el[id] = document.getElementById(id); });
function showPanel(node) {
  ['menu', 'pause', 'over'].forEach((k) => { if (el[k]) el[k].classList.remove('show'); });
  if (node && el[node]) el[node].classList.add('show');
}
function showOver() {
  G.overShown = true;
  G.running = false;
  const mins = Math.floor(G.time / 60), secs = Math.floor(G.time % 60);
  const rows = [
    ['SCORE', String(G.score).padStart(6, '0'), G.score >= G.best],
    ['BEST', String(G.best).padStart(6, '0')],
    ['WAVE', G.wave],
    ['KILLS', G.kills],
    ['LONGEST CHAIN', 'x' + (1 + Math.max(0, G.bestCombo - 1) * 0.22).toFixed(2) + '  (' + G.bestCombo + ')'],
    ['SURVIVED', mins + ':' + String(secs).padStart(2, '0')]
  ];
  if (el.stats) el.stats.innerHTML = rows.map((r) => '<div class="' + (r[2] ? 'hi' : '') + '"><i>' + r[0] + '</i><b>' + r[1] + '</b></div>').join('');
  showPanel('over');
}
function startGame() {
  initAudio();
  resetGame();
  showPanel(null);
  sfx.ui();
}
function togglePause(force) {
  if (G.dead || !G.running) return;
  G.paused = force === undefined ? !G.paused : force;
  showPanel(G.paused ? 'pause' : null);
}
function keynorm(e) { return e.key === ' ' ? 'space' : String(e.key).toLowerCase(); }
window.addEventListener('keydown', (e) => {
  const k = keynorm(e);
  if (k === 'space' || k.startsWith('arrow')) e.preventDefault();
  keys.add(k);
  if (k === 'space' && G.running && !G.paused) shockwave();
  if (k === 'shift' && G.running && !G.paused) dash();
  if (k === 'p') togglePause();
  if (k === 'm') {
    G.muted = !G.muted;
    music.on = !G.muted;
    if (master && AC) master.gain.setTargetAtTime(G.muted ? 0 : 0.75, AC.currentTime, 0.05);
    if (el.stats) el.stats.setAttribute('data-mute', G.muted ? 'on' : 'off');
  }
  if (k === 'enter' && (!G.running || G.overShown)) startGame();
  if (k === 'r' && (G.overShown || !G.running)) startGame();
});
window.addEventListener('keyup', (e) => { keys.delete(keynorm(e)); });
window.addEventListener('pointermove', (e) => {
  G.mx = e.clientX; G.my = e.clientY;
  if (e.pointerType === 'touch' && G.touch) { G.touchX = e.clientX; G.touchY = e.clientY; }
});
window.addEventListener('pointerdown', (e) => {
  G.mx = e.clientX; G.my = e.clientY;
  if (!G.running || G.paused) return;
  if (e.pointerType === 'touch') {
    const now = performance.now();
    if (now - G.lastTap < 280) shockwave();
    G.lastTap = now;
    G.touch = true;
    G.touchX = e.clientX; G.touchY = e.clientY;
    if (G.player) G.player.fire = true;
  } else if (e.button === 2) {
    shockwave();
  } else {
    if (G.player) G.player.fire = true;
  }
});
window.addEventListener('pointerup', (e) => {
  if (e.pointerType === 'touch') { G.touch = false; G.lastTap = performance.now(); }
  if (G.player) G.player.fire = false;
});
window.addEventListener('blur', () => { keys.clear(); if (G.player) G.player.fire = false; togglePause(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden) togglePause(true); });
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('resize', resize);
if (el['btn-start']) el['btn-start'].addEventListener('click', startGame);
if (el['btn-restart']) el['btn-restart'].addEventListener('click', startGame);
G.mx = W / 2; G.my = H / 2 - 100;

/* ================= boot ================= */
try { G.best = Number(localStorage.getItem('chroma-rush-best') || 0) || 0; } catch (e) { G.best = 0; }
G.player = newPlayer();
resize();
let last = performance.now(), acc = 0, frames = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (!(dt > 0)) dt = 1 / 60;
  frames++; acc += dt;
  if (acc >= 0.5) { G.fps = frames / acc; frames = 0; acc = 0; }
  if (G.running && !G.paused) update(dt);
  else updateParticles(Math.min(dt, 0.05) * 0.35);
  render();
  scheduleMusic();
}
requestAnimationFrame(frame);
window.__CHROMA__ = {
  G, update, render, startGame, shockwave, dash, fire, spawnEnemy, startWave, damagePlayer, killEnemy, keys,
  size: () => ({ w: W, h: H, dpr: DPR })
};
})();
