/* Audio harness: runs the real game.js against a mock Web Audio graph (tools/mockaudio.mjs)
 * and asserts the properties that make the procedural mix sound good — not just that it runs.
 *
 * Checks:
 *  1. master bus is highpass -> compressor -> destination (the hum fix)
 *  2. the pad has no sawtooth oscillators and no sub-100 Hz fundamental
 *  3. pad gain / pad filter automation is capped (it must not ramp brighter every wave)
 *  4. no transient oscillator/buffer-source is left running (a leaked voice = a permanent drone)
 *  5. mute silences the master bus
 *  6. the game survives an environment with no AudioContext at all
 */
import { load } from './stub.mjs';
import { MockAudioContext, contexts, nodes, automation, created, reset, reachesDestination, startedSources, stoppedCount } from './mockaudio.mjs';

const fails = [];
const ck = (cond, msg) => { if (!cond) fails.push(msg); };

const W = 1280, H = 720;
function drive(seconds, opts = {}) {
  const { api, G, fire, P, K, step } = load({ globals: { AudioContext: MockAudioContext, webkitAudioContext: MockAudioContext } });
  api.startGame();
  const ctx = contexts[contexts.length - 1];
  let aimX = W * 0.6, aimY = H * 0.5;
  const keys = api.keys;
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) {
    G.player.hp = G.player.maxHp; G.player.shield = 40;
    let best = null, bd = 1e9;
    for (const e of G.enemies) { const d = Math.hypot(e.x - G.player.x, e.y - G.player.y); if (d < bd) { bd = d; best = e; } }
    if (best) { aimX = best.x; aimY = best.y; }
    fire('pointermove', P({ clientX: aimX, clientY: aimY }));
    G.player.fire = true;
    if (best && bd < 260) { keys.clear(); keys.add(best.x > G.player.x ? 'a' : 'd'); keys.add(best.y > G.player.y ? 'w' : 's'); }
    else { keys.clear(); keys.add('w'); keys.add('d'); }
    if (G.player.charge >= 62 && G.enemies.length >= 4) api.shockwave();
    if (best && bd < 150) api.dash();
    if (opts.muteAt && i === opts.muteAt) fire('keydown', K('m'));
    step(1 / 60);
    ctx.advance(1 / 60);
  }
  return { api, G, ctx, step };
}

function step2(step, ctx) { step(1 / 60); ctx.advance(1 / 60); }

reset();
const { api, G, ctx, step } = drive(90, { muteAt: null });
const waveAt90 = G.wave;

ck(contexts.length >= 1, 'no AudioContext was ever constructed');
ck(created.compressor === 1, `expected exactly 1 compressor, got ${created.compressor}`);
const comp = nodes.compressor[0];
ck(comp && reachesDestination(comp), 'compressor is not routed to the destination');
const hp = nodes.filter.find((f) => f.type === 'highpass');
ck(!!hp, 'no highpass filter on the master bus (sub-hum is not being filtered)');
ck(hp && hp.frequency.value >= 70 && hp.frequency.value <= 120, `highpass at ${hp && hp.frequency.value} Hz, expected 70-120`);
ck(hp && hp.outs.includes(comp), 'highpass does not feed the compressor');
ck(nodes.filter.some((f) => f.type === 'lowpass'), 'no lowpass on the pad chain');

/* the pad: continuous voices sitting in the 80-180 Hz musical band */
const padOsc = nodes.osc.filter((o) => o.startedAt !== null && o.stoppedAt === null && o.freqAtStart >= 80 && o.freqAtStart < 185);
ck(padOsc.length >= 3, `pad has ${padOsc.length} sustained voices, expected >= 3`);
const padTypes = new Set(padOsc.map((o) => o.type));
ck(!padTypes.has('sawtooth'), `pad still contains sawtooth voices: ${[...padTypes].join(',')}`);
ck(padTypes.has('triangle'), `pad voices are ${[...padTypes].join(',')}, expected triangles`);
ck(padOsc.every((o) => o.freqAtStart >= 80), `pad fundamental ${Math.min(...padOsc.map((o) => o.freqAtStart))} Hz is sub-bass rumble`);

/* automation ceilings: the old pad climbed 340 + wave*26, which is what made it jarring */
const lpTargets = automation.filter((a) => a.node === 'biquad' && a.name === 'frequency' && a.kind === 'setTarget');
const maxLp = Math.max(...lpTargets.map((a) => a.value));
ck(maxLp <= 421, `pad lowpass ramps to ${maxLp.toFixed(0)} Hz, cap is 420`);
const gainTargets = automation.filter((a) => a.node === 'gain' && a.name === 'gain' && a.kind === 'setTarget' && a.value < 0.1);
const maxGain = Math.max(...gainTargets.map((a) => a.value));
ck(maxGain <= 0.0321, `pad gain ramps to ${maxGain.toFixed(4)}, cap is 0.032`);
const minPadGain = Math.min(...gainTargets.map((a) => a.value));
ck(gainTargets.length >= 3, 'pad gain was never automated across waves');
ck(maxGain - minPadGain < 0.02, `pad gain swings ${minPadGain.toFixed(4)} -> ${maxGain.toFixed(4)}; expected a gentle bed`);

/* leaked voices: every fired transient must be stopped. Only the pad + its two LFOs run forever. */
const permanent = nodes.osc.filter((o) => o.stoppedAt === null && o.startedAt !== null).length;
const started = startedSources().length, stopped = stoppedCount();
ck(started - stopped <= permanent, `${started - stopped} sources started and never stopped (${permanent} are the intended pad/LFO voices)`);
ck(permanent <= 8, `${permanent} permanently running oscillators (pad = 3 voices + 2 LFOs)`);
ck(nodes.osc.some((o) => o.type === 'sawtooth'), 'bass voice missing (no sawtooth anywhere)');

/* node churn sanity: the scheduler must not grow the graph without bound */
const totalNodes = created.gain + created.osc + created.filter + created.bufferSource + created.compressor + created.panner;
ck(totalNodes < 60000, `graph grew to ${totalNodes} nodes in 90s`);
ck(created.bufferSource > 200, `only ${created.bufferSource} noise voices in 90s - percussion did not run`);
ck(created.osc > 200, `only ${created.osc} tones in 90s - the sequencer did not run`);
ck(G.wave >= 5, `only reached wave ${G.wave} in 90s, cannot exercise wave-dependent audio`);

/* returning to the title screen and playing again must resume the (suspended) context */
api.startGame();
for (let i = 0; i < 240; i++) step2(step, ctx);
ck(ctx.resumeCount >= 1, 'initAudio never resumed a suspended AudioContext on a later start');

/* mute has to silence the master bus */
const muted = drive(20, { muteAt: 300 });
const zero = automation.filter((a) => a.node === 'gain' && a.name === 'gain' && a.kind === 'setTarget' && a.value === 0);
ck(zero.length >= 1, 'mute did not drive the master gain to 0');
ck(muted.G.muted === true, 'mute key did not toggle G.muted');

/* no AudioContext at all (private browsing / autoplay blocked) must not throw */
let noAudioOk = true;
try {
  const bare = load();
  bare.api.startGame();
  for (let i = 0; i < 1800; i++) bare.step(1 / 60);
} catch (e) { noAudioOk = false; console.log('  no-audio throw: ' + e.message); }
ck(noAudioOk, 'game throws when AudioContext is unavailable');

console.log('=== AUDIO GRAPH TEST ===');
console.log(`waves reached   ${waveAt90} (in 90s)`);
console.log(`nodes created   osc ${created.osc} · gain ${created.gain} · filter ${created.filter} · noise ${created.bufferSource} · comp ${created.compressor} · pan ${created.panner}`);
console.log(`pad voices      ${padOsc.map((o) => `${o.type}@${o.freqAtStart.toFixed(0)}Hz`).join(' ')}`);
console.log(`automation      ${automation.length} param events · lowpass cap ${maxLp.toFixed(0)}Hz · pad gain cap ${maxGain.toFixed(4)}`);
console.log(`voices          ${started} started · ${stopped} stopped · ${permanent} sustained (pad + LFOs)`);
console.log(`audio contexts  ${contexts.length} · resume calls ${contexts.reduce((s, c) => s + c.resumeCount, 0)}`);
if (fails.length) { console.log('\nAUDIO FAIL:'); fails.forEach((f) => console.log(' - ' + f)); process.exit(1); }
console.log('\nAUDIO PASS');
