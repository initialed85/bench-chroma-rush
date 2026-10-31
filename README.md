# CHROMA RUSH

Neon arena survival in a browser. No build step, no dependencies, no assets — every pixel is a
canvas primitive, every sound is synthesised with WebAudio at runtime.

![waves](https://img.shields.io/badge/waves-procedural-brightgreen)
![size](https://img.shields.io/badge/assets-0-blue)
![deps](https://img.shields.io/badge/npm%20deps-0-blue)

## Run it

```bash
python3 -m http.server 8765      # then open http://127.0.0.1:8765
```

You can also just open `index.html` from disk — it works, audio needs a user gesture (the START button).

## Play

| input | action |
|---|---|
| `WASD` / arrows | fly |
| mouse | aim (the ship snaps to your cursor) |
| left mouse (hold) | fire |
| `SPACE` / right mouse | shockwave — costs 50 charge, clears bullets, hurls enemies into walls |
| `SHIFT` | dash, brief i-frames, rainbow afterimages |
| `P` / `M` / `R` | pause · mute · restart |
| touch | drag to fly + auto-fire, double-tap for shockwave |

### The loop you are chasing

- **Chain kills** → the combo multiplier raises your score, raises the music tempo, and makes the
  whole screen shift hue. Take a hit and the chain halves.
- **Charge** builds from kills; spend 50 on a shockwave. Casting it near a wall is a free kill
  (wall slam = bonus damage + stun).
- **Pickups**: `◆` gem (score + charge) · `+` hull · `★` weapon tier (PULSE → TWIN → TRIAD → FAN →
  PRISM, plus a shield pop) · `◷` time dilation.
- Every **5th wave is a boss** (spiral → summon → charge).

## Files

```
index.html      shell + menu/pause/game-over panels
style.css       neon panels, no images
game.js         engine: waves, enemies, particles, bloom, synth, beat  (~1.4k lines)
tools/stub.mjs  headless DOM+canvas stub
tools/smoke.mjs soak test: 12k frames, boss waves, death, restart, touch, pause, mute
tools/probe.mjs difficulty probe (AFK vs bot)
```

## Engine notes (the "juice")

- **Bloom** is free: glow sprites are pre-rendered radial gradients keyed by quantised hue, blitted
  with `globalCompositeOperation = 'lighter'`, so overlapping light adds up.
- **Motion trails** come from painting the background at 30% alpha each frame instead of clearing it.
- **Impact feel**: per-kill hit-stop (up to 160 ms on bosses), screen shake, additive screen flash,
  and a hue shift. Boss death runs a 0.32× slow-motion chain of 11 secondary explosions.
- **Audio is a sequencer**: 16-step kick/hat/bass pad whose tempo tracks your combo
  (104 → 168 BPM), stereo-panned by on-screen x position.
- **Fairness**: enemy spawns are telegraphed with a collapsing ring for 0.55 s, and spawn points are
  chosen ≥ 240 px from you.
- Particles are capped at 1900 with oldest-first recycling; the loop clamps `dt` (tab-switch safe)
  and runs on any refresh rate.

## Tests

```bash
node --check game.js
node tools/smoke.mjs     # soak + control surface; exits non-zero on any throw
node tools/probe.mjs     # difficulty sanity: AFK dies ~wave 2, a crude bot reaches ~wave 10
```
