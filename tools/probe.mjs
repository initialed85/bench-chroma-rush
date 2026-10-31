/* Difficulty probe: AFK player vs a crude bot player. Run: node tools/probe.mjs */
import { api, G, step } from './stub.mjs';

function run(label, active, maxFrames) {
  api.startGame();
  let f = 0;
  for (; f < maxFrames; f++) {
    if (active) {
      const p = G.player;
      let best = null, bd = 1e9;
      for (const e of G.enemies) { const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < bd) { bd = d; best = e; } }
      api.keys.clear();
      if (best) {
        G.mx = best.x; G.my = best.y;
        const away = Math.atan2(p.y - best.y, p.x - best.x);
        api.keys.add(Math.cos(away) > 0 ? 'd' : 'a');
        api.keys.add(Math.sin(away) > 0 ? 's' : 'w');
        if (bd < 150 && p.dashCd <= 0) api.dash();
      }
      if (p.charge >= 60) api.shockwave();
      p.fire = true;
    }
    step(1 / 60);
    if (G.overShown) break;
  }
  console.log(label.padEnd(7), 'died on wave', String(G.wave).padStart(2),
    '· survived', (f / 60).toFixed(1).padStart(6), 's',
    '· kills', String(G.kills).padStart(4), '· score', String(G.score).padStart(7));
  return { wave: G.wave, secs: f / 60, kills: G.kills, score: G.score };
}
const afk = run('AFK', false, 60 * 180);
const act = run('ACTIVE', true, 60 * 400);
console.log('verdict       ', afk.secs < 45 && act.wave >= 6 ? 'OK · lethal when idle, climbable when played' : 'CHECK BALANCE');
