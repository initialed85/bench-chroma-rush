/* One minute of played time: a bot drives the real input paths, we log the play-by-play.
 * node tools/play.mjs [seconds] */
import { api, G, fire, P } from './stub.mjs';

const seconds = Number(process.argv[2] || 60);
const dt = 1 / 60;
const { w: AW, h: AH } = api.size();
const log = [];
let simT = 0;
const ev = (s) => log.push(`${simT.toFixed(1).padStart(6)}s  ${s}`);

api.startGame();
const keys = api.keys;
const p = () => G.player;

const csv = process.argv.includes('--csv');
let shockCasts = 0, dashes = 0, hitsTaken = 0, lowestHp = 100, partPeak = 0, enemyPeak = 0;
let chain5T = null, chain10T = null, weaponT = null, kills30 = 0, parts30 = 0, enemyPeak30 = 0, shocks30 = 0, hits30 = 0;
let enemySum = 0, busyFrames = 0, liveFrames = 0, bulletPeak = 0, ebPeak = 0, partSum = 0;
let multPeak = 1, comboPeak = 0, heals = 0, guns = 0, slows = 0, gems = 0, walls = 0;
let prevWave = G.wave, prevHp = 100, prevBoss = false, prevWeapon = 0, prevSlow = 0;
let updateMs = 0, renderMs = 0, frames = 0, dead = false;

/* wall-slam counter: watch for stun spikes caused by the shockwave knockback */
function bot() {
  const pl = p();
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
  const threats = G.enemies
    .map((e) => ({ e, d: Math.hypot(e.x - pl.x, e.y - pl.y) }))
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
    const before = G.shocks.length, alive = G.enemies.length;
    api.shockwave();
    if (G.shocks.length > before) {
      shockCasts++;
      ev(`SHOCKWAVE cast · ${alive} enemies on field · nearest ${Math.round(threats[0].d)}px`);
    }
  }
  if (threats.length && threats[0].d < 135 && pl.dashCd <= 0) {
    pl.moveA = Math.atan2(pl.y - threats[0].e.y, pl.x - threats[0].e.x);
    api.dash();
    dashes++;
  }
}

function watch() {
  const pl = p();
  if (G.wave !== prevWave) {
    prevWave = G.wave;
    ev(`▶ ${G.wave % 5 === 0 ? 'BOSS WAVE ' : 'WAVE '}${G.wave} · score ${G.score} · chain x${(1 + Math.max(0, G.combo - 1) * 0.22).toFixed(2)}`);
  }
  if (!!G.boss !== prevBoss) {
    prevBoss = !!G.boss;
    if (prevBoss) ev(`☠ BOSS ON FIELD · ${Math.round(G.boss.hp)} hull`);
    else ev(`✔ BOSS DOWN · score ${G.score}`);
  }
  if (pl.hp < prevHp) {
    const dmg = prevHp - pl.hp;
    if (dmg > 0.5 && pl.inv > 0.4) { hitsTaken++; ev(`✖ HIT -${dmg.toFixed(0)} hp · chain cut to ${G.combo} · hull ${Math.ceil(pl.hp)}`); }
  }
  if (pl.hp > prevHp) { heals++; ev(`+ HULL pickup → ${Math.ceil(pl.hp)}`); }
  if (pl.weapon > prevWeapon) { guns++; ev(`★ WEAPON UP → ${['PULSE', 'TWIN', 'TRIAD', 'FAN', 'PRISM'][pl.weapon]}`); }
  if (G.slowT > prevSlow) { slows++; ev(`◷ TIME DILATION ${G.slowT.toFixed(1)}s`); }
  prevHp = pl.hp; prevWeapon = pl.weapon; prevSlow = G.slowT;
  lowestHp = Math.min(lowestHp, pl.hp);
  if (G.combo >= 5 && chain5T === null) chain5T = simT;
  if (G.combo >= 12 && chain10T === null) chain10T = simT;
  if (pl.weapon > 0 && weaponT === null) weaponT = simT;
  enemySum += G.enemies.length;
  partSum += G.particles.length;
  if (G.enemies.length + G.spawners.length > 0) liveFrames++;
  if (G.enemies.length >= 6) busyFrames++;
  bulletPeak = Math.max(bulletPeak, G.bullets.length);
  ebPeak = Math.max(ebPeak, G.eBullets.length);
  if (simT <= 30) { kills30 = G.kills; parts30 = Math.max(parts30, G.particles.length); enemyPeak30 = Math.max(enemyPeak30, G.enemies.length); shocks30 = shockCasts; hits30 = hitsTaken; }
  comboPeak = Math.max(comboPeak, G.combo);
  multPeak = Math.max(multPeak, 1 + Math.max(0, G.combo - 1) * 0.22);
  partPeak = Math.max(partPeak, G.particles.length);
  enemyPeak = Math.max(enemyPeak, G.enemies.length);
  if (G.dead && !dead) { dead = true; ev('✛ PLAYER SHATTERED'); }
}

const total = Math.round(seconds * 60);
for (let i = 0; i < total; i++) {
  simT += dt;
  bot();
  const t0 = performance.now();
  api.update(dt);
  const t1 = performance.now();
  api.render();
  const t2 = performance.now();
  updateMs += t1 - t0; renderMs += t2 - t1; frames++;
  watch();
  if (G.overShown) break;
}

if (csv) {
  const f = (v) => v === null ? '-' : v.toFixed(1);
  console.log([`${(frames / 60).toFixed(0)}`, G.wave, G.kills, kills30, multPeak.toFixed(2), comboPeak,
    f(chain5T), f(chain10T), f(weaponT), enemyPeak30, enemyPeak, parts30, partPeak,
    shocks30, shockCasts, hits30, hitsTaken, Math.ceil(lowestHp), G.score,
    (enemySum / frames).toFixed(2), (busyFrames / frames * 100).toFixed(0), bulletPeak, ebPeak,
    (partSum / frames).toFixed(0), G.overShown ? 'dead' : 'alive'].join(','));
  process.exit(0);
}
console.log(`\nCHROMA RUSH · ${(frames / 60).toFixed(0)}s of played time\n`);
for (const l of log) console.log(l);
console.log([
  '',
  `score            ${G.score}`,
  `wave reached     ${G.wave}`,
  `kills            ${G.kills}`,
  `peak chain       x${multPeak.toFixed(2)} (${comboPeak} kills)`,
  `shockwaves cast  ${shockCasts}`,
  `dashes           ${dashes}`,
  `hits taken       ${hitsTaken} (lowest hull ${Math.ceil(lowestHp)})`,
  `pickups          ${heals} hull · ${guns} weapon · ${slows} slow`,
  `peak enemies     ${enemyPeak} · peak particles ${partPeak}`,
  `pressure        ${(enemySum / frames).toFixed(2)} enemies on screen on average · ${(busyFrames / frames * 100).toFixed(0)}% of the minute with 6+ alive`,
  `bullets         ${bulletPeak} player / ${ebPeak} enemy peak on screen · ${(partSum / frames).toFixed(0)} particles on average`,
  `engine cost      ${(updateMs / frames).toFixed(3)} ms update · ${(renderMs / frames).toFixed(3)} ms draw-calls (headless, no GPU paint)`,
  `outcome          ${G.overShown ? 'shattered (panel shown)' : 'alive'}`
].join('\n'));
