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
tools/play.mjs  played-time sim: bot drives real inputs, prints a play-by-play
tools/audio.mjs audio-graph test; tools/mockaudio.mjs is a mock WebAudio implementation
```

## Engine notes (the "juice")

- **Bloom** is free: glow sprites are pre-rendered radial gradients keyed by quantised hue, blitted
  with `globalCompositeOperation = 'lighter'`, so overlapping light adds up.
- **Motion trails** come from painting the background at 30% alpha each frame instead of clearing it.
- **Impact feel**: per-kill hit-stop (up to 160 ms on bosses), screen shake, additive screen flash,
  and a hue shift. Boss death runs a 0.32× slow-motion chain of 11 secondary explosions.
- **Audio is a sequencer**: 16-step kick/hat/bass whose tempo tracks your combo, over a
  triangle-wave pad bed. The whole mix runs through a 92 Hz highpass and a soft compressor,
  because laptop speakers cannot reproduce a 55 Hz drone and everything below 90 Hz is distortion.
  (104 → 168 BPM), stereo-panned by on-screen x position.
- **Fairness**: enemy spawns are telegraphed with a collapsing ring for 0.55 s, and spawn points are
  chosen ≥ 240 px from you.
- Particles are capped at 1900 with oldest-first recycling; the loop clamps `dt` (tab-switch safe)
  and runs on any refresh rate.

## Tests

```bash
node --check game.js
node tools/smoke.mjs      # soak + control surface; exits non-zero on any throw
node tools/probe.mjs      # difficulty sanity: AFK dies fast, a crude bot climbs to ~wave 8
node tools/play.mjs 60    # a minute of played time, printed as a play-by-play
node tools/play.mjs 180   # three minutes, enough to reach and kill the wave-5 boss
```

### Numbers from simulated play

One minute (8-run mean): 149 kills, wave 3.4, 7.9 enemies on screen on average, 60% of the minute
with 6+ alive, chain x6.06 (the cap), 14 shockwaves, 3.6 hits taken, 522 particles on average.
Chain of 5 kills lands at 4.6 s — the multiplier is live inside wave 1.
Three minutes: wave 7, boss down, chain capped, PRISM weapon. AFK player dies in ~12 s.

These runs found the pacing flaw that shaped the spawn economy: the first tuning pass produced
only 5 concurrent enemies and chains under x2.4, which is a boring minute, so waves are now
waves are now `8 + 4·wave` enemies spawning every ~0.75 s under a 26-unit ceiling, and two of the
spawn archetypes are *packs*: a swarm telegraph erupts into 5-9 minis, a trio telegraph into 3
shooters. Packs buy screen pressure cheaply, because a single shockwave clears them.

The player's cannon was then raised ~2.6× (PULSE 125 ms → 50 ms, PRISM 90 ms → 34 ms, plus a
260-bullet cap) so dense waves are survivable; shot blips, recoil and screen shake were all reduced
per shot so a 20-shot-per-second cannon reads as a stream of light, not a buzz.

## Container

```bash
docker build -t chroma-rush:latest .
docker run --rm -p 127.0.0.1:8099:8080 chroma-rush:latest   # http://127.0.0.1:8099
```

`nginxinc/nginx-unprivileged:1.27-alpine`: 3 static files, listens on **8080** as UID 101
(no root, no privileged port), ships `/healthz` for the container HEALTHCHECK and for
cluster probes, gzips js/css/svg, and serves everything `no-store` — with no build step,
a cached `game.js` is the only way to play yesterday's balance.

Pushed to **Docker Hub** as `initialed85/chroma-rush:latest`. Not ghcr: the ghcr repos on
this fleet are private and home-dev has no pull secret. Deployed as an Application in
`home-ops/clusters/dev/applications/chroma-rush` (owned by the home-ops fleet repo, mirroring
the `asteroids` game app), host **chroma-rush.dev.initialed85.cc**.
