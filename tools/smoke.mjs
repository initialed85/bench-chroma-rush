/* Headless soak + control-surface test for game.js (run: node tools/smoke.mjs) */
import { api, G, fire, P, step, store, panelShown } from './stub.mjs';

const die = (msg) => { console.error('FAIL:', msg); process.exit(1); };
if (!api) die('game did not expose debug API');

api.startGame();
if (!G.running) die('game did not start');
if (panelShown('menu')) die('menu panel should be hidden after start');

fire('pointermove', P({ clientX: 900, clientY: 300 }));
api.keys.add('d');
G.player.fire = true;

let frames = 0, errors = 0, maxParts = 0, maxEnemies = 0, sawBoss = false;
const maxArrays = {};
const stepChecked = (dt) => {
  try { step(dt); } catch (e) {
    errors++;
    console.error('THROW @frame ' + frames + ':', e && e.stack);
    if (errors > 2) process.exit(1);
  }
  frames++;
  maxParts = Math.max(maxParts, G.particles.length);
  maxEnemies = Math.max(maxEnemies, G.enemies.length);
  sawBoss = sawBoss || !!G.boss;
  for (const k of ['bullets', 'eBullets', 'pickups', 'spawners', 'shocks', 'booms', 'particles'])
    maxArrays[k] = Math.max(maxArrays[k] || 0, G[k].length);
};

/* 12k frames (~3 min of play, fast-forwarded through boss waves), with input noise */
for (let i = 0; i < 12000; i++) {
  G.player.hp = G.player.maxHp;                       // god-mode soak: exercise deep waves, not death
  G.player.charge = 100;
  if (i % 40 === 0) fire('pointermove', P({ clientX: 200 + (i % 900), clientY: 120 + (i * 7) % 500 }));
  if (i % 18 === 0) api.shockwave();
  if (i % 33 === 0) api.dash();
  if (i % 700 === 0) { api.keys.delete('d'); api.keys.add('w'); }
  if (i % 900 === 0) { api.keys.clear(); api.keys.add('s'); }
  if (i % 1100 === 0) fire('resize', {});
  if (i % 1500 === 0 && i) api.startWave(G.wave + 4);
  stepChecked(1 / 60);
  if (i === 4000) stepChecked(0.4);                    // tab-switch / dt spike
  if (i === 5500) stepChecked(1 / 240);                // 240Hz refresh rate
  if (i === 6000) G.slowT = 5;                         // time dilation pickup
  if (i === 8000) G.timeScale = 0.02;                  // degenerate time scale
  if (G.overShown) break;
}
const soakWave = G.wave, soakKills = G.kills, soakScore = G.score;
if (maxParts > 2000) die('particle cap not enforced: ' + maxParts);
if (!sawBoss) die('no boss wave spawned');
if (G.score <= 0) die('no score accumulated');

/* lethal damage → death sequence → game-over panel → restart resets everything */
G.player.shield = 0; G.player.inv = 0;
api.damagePlayer(9999, 100, 100);
for (let i = 0; i < 400 && !G.overShown; i++) {
  G.player.shield = 0; G.player.inv = 0;               // strip shield/i-frames so the hit must land
  if (!G.dead) api.damagePlayer(9999, 100, 100);
  stepChecked(1 / 60);
}
if (!G.dead) die('lethal damage did not kill the player');
if (!panelShown('over')) die('game-over panel not shown');
if (!store['chroma-rush-best']) die('best score not persisted');
api.startGame();
if (G.score !== 0 || G.wave !== 1 || G.player.hp !== 100) die('restart did not reset state');
for (let i = 0; i < 600; i++) stepChecked(1 / 60);

/* touch: drag-to-fly, double-tap shockwave (fresh session, kept alive — a dead player must not cast) */
api.startGame();
G.player.fire = true;
for (let i = 0; i < 120; i++) { G.player.hp = G.player.maxHp; stepChecked(1 / 60); }
if (G.dead) die('player died during the touch warm-up');
G.player.charge = 100;
fire('pointerdown', P({ pointerType: 'touch', clientX: 300, clientY: 300 }));
fire('pointermove', P({ pointerType: 'touch', clientX: 320, clientY: 320 }));
for (let i = 0; i < 120; i++) { G.player.hp = G.player.maxHp; stepChecked(1 / 60); }
if (!G.touch) die('touch drag not registered');
const touched = G.player.x;
fire('pointerdown', P({ pointerType: 'touch', clientX: 300, clientY: 300 }));
fire('pointerdown', P({ pointerType: 'touch', clientX: 300, clientY: 300 }));
stepChecked(1 / 60); stepChecked(1 / 60);
if (G.shocks.length === 0) die('double-tap shockwave did not fire');

/* pause + mute */
fire('keydown', { key: 'p', preventDefault() {} });
if (!G.paused) die('P did not pause');
fire('keydown', { key: 'p', preventDefault() {} });
if (G.paused) die('P did not resume');
fire('keydown', { key: 'm', preventDefault() {} });
if (!G.muted) die('M did not mute');
fire('keydown', { key: 'm', preventDefault() {} });

console.log('frames        ', frames);
console.log('waves reached ', soakWave, '(soak)');
console.log('soak kills    ', soakKills, '· score', soakScore);
console.log('boss wave     ', sawBoss);
console.log('peak particles', maxParts, '(cap 1900)');
console.log('peak enemies  ', maxEnemies);
console.log('peak arrays   ', JSON.stringify(maxArrays));
console.log('persisted best', store['chroma-rush-best']);
console.log('touch drag x  ', touched.toFixed(0), '· shock rings', G.shocks.length);
console.log(errors ? 'SMOKE FAIL (' + errors + ' throws)' : 'SMOKE PASS');
process.exit(errors ? 1 : 0);
