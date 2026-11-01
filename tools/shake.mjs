/* Screen-shake measurement: how big is the applied camera jitter, really?
 *
 *   node tools/shake.mjs [seconds]
 *
 * G.shake is the raw accumulator (addShake() sums into it, capped at 46, decaying 30/s);
 * SHAKE_SCALE in game.js scales it at the one draw site that moves the camera:
 *
 *   if (G.shake > 0) ctx.translate(rand(-G.shake * SHAKE_SCALE, G.shake * SHAKE_SCALE), ...)
 *
 * So the observable is the translate() offset, not G.shake. This tool spies ctx.translate on the
 * stub context and reports the distribution of the applied offset — a change to SHAKE_SCALE moves
 * these numbers, and a change to addShake() moves them too, so the tool measures the game as
 * played, not the constant as written.
 *
 * Drive: the same chase-and-shoot bot as tools/play.mjs (fire at nearest, shockwave at 50 charge,
 * dash out of tight spots), so the shake profile is real gameplay, not a synthetic spike list.
 */
import { api, G, ctxStub } from './stub.mjs';

const seconds = Number(process.argv[2] || 60);
const dt = 1 / 60;
const { w: AW, h: AH } = api.size();

/* ---- spy the camera offset --------------------------------------------- */
let samples = 0, frames = 0, shakeFrames = 0;
let offPeak = 0, offSum = 0;
const off = [];               // applied |offset| per translate() call, px
const rawAt = [];             // [raw G.shake, applied] pairs at the moment of translate
let armed = false;   // the shake translate is the FIRST camera move of render(); everything after it
                     // is an object transform (a bullet at x=1400 is not "screen shake")
ctxStub.translate = (dx, dy) => {
  if (!armed || G.shake <= 0) return;   // ignore object transforms; only the shake camera move counts
  armed = false;
  const m = Math.max(Math.abs(dx), Math.abs(dy));
  samples++; offSum += m; off.push(m); rawAt.push([G.shake, m]);
  if (m > offPeak) offPeak = m;
};

/* ---- the bot ------------------------------------------------------------ */
api.startGame();
const keys = api.keys;
let shockCasts = 0, dashes = 0;
function bot() {
  const pl = G.player;
  let target = null, td = 1e9;
  for (const e of G.enemies) {
    const d = Math.hypot(e.x - pl.x, e.y - pl.y) * (e.boss ? 0.7 : 1);
    if (d < td) { td = d; target = e; }
  }
  let pk = null, pd = 1e9;
  for (const k of G.pickups) { const d = Math.hypot(k.x - pl.x, k.y - pl.y); if (d < pd) { pd = d; pk = k; } }
  if (pk && pd < 230 && (!target || pd < td * 0.6)) { G.mx = pk.x; G.my = pk.y; }
  else if (target) { G.mx = target.x; G.my = target.y; }

  let ax = 0, ay = 0;
  const threats = G.enemies.map((e) => ({ e, d: Math.hypot(e.x - pl.x, e.y - pl.y) }))
    .sort((a, b) => a.d - b.d).slice(0, 4);
  for (const { e, d } of threats) {
    const w = (1 / (d + 40)) * (e.type === 'shooter' ? 2.2 : e.boss ? 1.4 : 1);
    ax += (pl.x - e.x) * w; ay += (pl.y - e.y) * w;
  }
  if (pk && pd < 340) { ax += (pk.x - pl.x) / (pd + 40) * 1.4; ay += (pk.y - pl.y) / (pd + 40) * 1.4; }
  const m = Math.hypot(ax, ay) || 1; ax /= m; ay /= m;
  const edge = 95;
  if (pl.x < edge) ax += (edge - pl.x) / edge * 1.8;
  if (pl.x > AW - edge) ax -= (pl.x - (AW - edge)) / edge * 1.8;
  if (pl.y < edge) ay += (edge - pl.y) / edge * 1.8;
  if (pl.y > AH - edge) ay -= (pl.y - (AH - edge)) / edge * 1.8;

  keys.clear();
  if (ax > 0.25) keys.add('d');
  if (ax < -0.25) keys.add('a');
  if (ay > 0.25) keys.add('s');
  if (ay < -0.25) keys.add('w');
  pl.fire = true;
  if (pl.charge >= 50 && threats.length && threats[0].d < 330) {
    const before = G.shocks.length; api.shockwave();
    if (G.shocks.length > before) shockCasts++;
  }
  if (threats.length && threats[0].d < 135 && pl.dashCd <= 0) {
    pl.moveA = Math.atan2(pl.y - threats[0].e.y, pl.x - threats[0].e.x);
    api.dash(); dashes++;
  }
}

const total = Math.round(seconds * 60);
let rawPeak = 0, shakeSum = 0;
for (let i = 0; i < total; i++) {
  bot();
  api.update(dt);
  armed = true;
  api.render();
  frames++;
  rawPeak = Math.max(rawPeak, G.shake);
  shakeSum += G.shake;
  if (G.shake > 0) shakeFrames++;
  if (G.overShown) break;
}

const pct = (q) => {
  if (!off.length) return 0;
  const s = [...off].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const alive = !G.overShown;

console.log(`\nCHROMA RUSH · screen shake over ${(frames / 60).toFixed(0)}s of played time (${alive ? 'bot alive' : 'bot died'}, wave ${G.wave}, ${G.kills} kills, ${shockCasts} shockwaves, ${dashes} dashes)`);
console.log('');
console.log(`frames with shake    ${(shakeFrames / frames * 100).toFixed(1)}%  (${shakeFrames}/${frames})`);
console.log(`raw G.shake          peak ${rawPeak.toFixed(1)} · mean ${(shakeSum / frames).toFixed(2)} (accumulator, cap 46)`);
console.log(`shake translate()    ${samples} frames · peak |offset| ${offPeak.toFixed(2)} px · mean ${(offSum / (samples || 1)).toFixed(2)} px`);
console.log(`applied offset       p50 ${pct(0.5).toFixed(2)} · p90 ${pct(0.9).toFixed(2)} · p99 ${pct(0.99).toFixed(2)} px`);
const biggest = rawAt.length ? rawAt.reduce((a, b) => (b[1] > a[1] ? b : a)) : [0, 0];
console.log(`biggest single frame raw G.shake ${biggest[0].toFixed(1)} -> camera moved ${biggest[1].toFixed(2)} px`);
console.log(`shake energy vs canvas  peak offset is ${(offPeak / AH * 100).toFixed(2)}% of the ${AH}px canvas height`);
