# CHROMA RUSH

Neon arena survival in a browser. No build step, no dependencies, no assets — every pixel is a
canvas primitive, every sound is synthesised with WebAudio at runtime.

![waves](https://img.shields.io/badge/waves-procedural-brightgreen)
![size](https://img.shields.io/badge/assets-0-blue)
![deps](https://img.shields.io/badge/npm%20deps-0-blue)

**Live: https://chroma-rush.dev.initialed85.cc** — nginx static host, one pod in `home-dev`
(Argo CD app `chroma-rush`, manifests in `home-ops/clusters/dev/applications/chroma-rush`),
serving image digest `sha256:d14e051e…`. **Public by design**: no auth, no cookies, no backend,
no secrets — the point is you can open it on your phone away from the LAN.

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
- **Screen shake has one knob**: `SHAKE_SCALE` scales the single camera `translate()` in `drawWorld`,
  so it retunes all 17 `addShake()` sources at once (hits, deaths, shockwaves, boss phases, dashes).
  It shipped at 1, which `tools/shake.mjs` measured as p50 24 px / p90 40 px / peak 46 px of jitter
  with **91% of frames carrying some shake** — a constant rattle that made aiming hard. It is now
  **0.5**: p50 11.5 px / p90 19 px / peak 23 px, i.e. 3.2% of the canvas height at the peak, and the
  spikes still read as spikes. `node tools/shake.mjs 60` prints these numbers; it spies `translate()`
  and only counts the camera move, because a bullet drawn at x=1400 is not screen shake.
- **Audio is a sequencer**: 16-step kick/hat/bass whose tempo tracks your combo, over a
  triangle-wave pad bed. The whole mix runs through a 92 Hz highpass and a soft compressor,
  because laptop speakers cannot reproduce a 55 Hz drone and everything below 90 Hz is distortion.
  Tempo walks 104 → 168 BPM, and voices are stereo-panned by on-screen x position.
- **Fairness**: enemy spawns are telegraphed with a collapsing ring for 0.55 s, and spawn points are
  chosen ≥ 240 px from you.
- Particles are capped at 1900 with oldest-first recycling; the loop clamps `dt` (tab-switch safe)
  and runs on any refresh rate.

## Prompts

Verbatim from the session log, in order — this is what the game was actually asked for:

```
can you build me a simple yet extremely fun browser game, lots of colour and particles and stuff
```

---

```
couple of notes: there's a constant background hum noise- seems to increase as the waves continue

i don't mind the increasing thing, the sound itself is a bit jarring though; maybe needs to be "less" somehow

also, we need to probably look to get it into a docker image e.g. docker.io/chroma-rush:latest and
deploy it to chroma-rush.dev.initialed85.cc
```

---

```
i reckon my earlier feedback was wrong btw- i don't think it's too easy; we either need to dial back
how hard it is, or i reckon we can keep going, but we need to increase the rate of fire from the
cannon, maybe 2 or 3x, to give teh player a chance
```

---

```
yeah it feels good to go, you've done well
```

Three asks that drove the middle of the build — make the enemies come faster and in greater
numbers, simulate a minute of play, and rebuild-and-push — arrived inside a context window pi
compacted, so their exact wording is not in the session log and is not quoted above. Their effect
is in the commits: spawn economy `8 + 4·wave` with 26 units alive and pack spawns, the ~2.6×
cannon (`tools/play.mjs 60` is the simulation), and image digest `sha256:d14e051e…`.

## Tests

```bash
node --check game.js
node tools/smoke.mjs      # soak + control surface; exits non-zero on any throw
node tools/probe.mjs      # difficulty sanity: AFK dies fast, a crude bot climbs to ~wave 8
node tools/play.mjs 60    # a minute of played time, printed as a play-by-play
node tools/play.mjs 180   # three minutes, enough to reach and kill the wave-5 boss
node tools/shake.mjs 60   # camera jitter distribution (the number behind SHAKE_SCALE)
```

### Numbers from simulated play

One minute (8-run mean): 149 kills, wave 3.4, 7.9 enemies on screen on average, 60% of the minute
with 6+ alive, chain x6.06 (the cap), 14 shockwaves, 3.6 hits taken, 522 particles on average.
Chain of 5 kills lands at 4.6 s — the multiplier is live inside wave 1.
Three minutes: wave 7, boss down, chain capped, PRISM weapon. AFK player dies in ~12 s.

These runs found the pacing flaw that shaped the spawn economy: the first tuning pass produced
only 5 concurrent enemies and chains under x2.4, which is a boring minute, so waves are now
`8 + 4·wave` enemies spawning every ~0.75 s under a 26-unit ceiling, and two of the
spawn archetypes are *packs*: a swarm telegraph erupts into 5-9 minis, a trio telegraph into 3
shooters. Packs buy screen pressure cheaply, because a single shockwave clears them.

The player's cannon was then raised ~2.6× (PULSE 125 ms → 50 ms, PRISM 90 ms → 34 ms, plus a
260-bullet cap) so dense waves are survivable; shot blips, recoil and screen shake were all reduced
per shot so a 20-shot-per-second cannon reads as a stream of light, not a buzz.

## Ship it

```bash
docker build -t chroma-rush:latest .
docker run --rm -p 127.0.0.1:8099:8080 chroma-rush:latest   # http://127.0.0.1:8099
docker push initialed85/chroma-rush:latest
```

The image is `nginxinc/nginx-unprivileged:1.27-alpine` carrying 3 static files: it listens on
**8080** as UID 101 (no root, no privileged port), ships `/healthz` for the container HEALTHCHECK
and for cluster probes, gzips js/css/svg, and serves everything `no-store` — with no build step, a
cached `game.js` is the only way to play yesterday's balance.

Registry is **Docker Hub** (`initialed85/chroma-rush`), not ghcr: the ghcr repos on this fleet are
private and home-dev has no pull secret.

Success, measured against the live host:

```bash
curl -s https://chroma-rush.dev.initialed85.cc/ | grep -c "CHROMA RUSH"        # 1
curl -s -o /dev/null -w "%{http_code}\n" https://chroma-rush.dev.initialed85.cc/healthz   # 200 (body: ok)
curl -s https://chroma-rush.dev.initialed85.cc/game.js | sha256sum            # == sha256sum game.js
kubectl --context home-dev -n chroma-rush get pod -o jsonpath='{.items[0].status.containerStatuses[0].imageID}'
```

The last line is the point of the trap below: the running pod must report the digest you shipped.

### Release contract (a `:latest` push is not a deploy)

The manifest pins the **immutable digest** (`imagePullPolicy: IfNotPresent`), so pushing a new
`:latest` changes nothing in the cluster. The deploy is the digest bump in
`clusters/dev/applications/chroma-rush/deployment.yaml`. Verified live: `spec.strategy.type =
RollingUpdate`, `maxUnavailable=0`, `maxSurge=1`, site 200, `/healthz` 200, pod imageID
`sha256:d14e051e…`. Procedure, agreed with the app owner:

1. `docker build -t chroma-rush:latest . && docker push ...` (locally: `docker run --rm -p 127.0.0.1:8099:8080 …`)
2. Send the owner: **new digest**, commit sha, change summary.
3. They bump the digest; Argo rolls the pod. Rollback = revert the commit.

The manifest now uses `strategy: RollingUpdate` with `maxUnavailable: 0, maxSurge: 1` (home-ops
`39dae7f`). It used to be `Recreate`, which deletes the old pod before the new one is ready — that
is where the **~30 s 503 window** measured on the 2026-10-31 rollout came from, and it was inherent,
not incidental. `Recreate` earns its place on apps with a single-writer volume or socket; a 3-file
static host has neither, so rolling is strictly better.

Two facts that keep this honest:

- **A strategy change alone does not roll pods** — the pod template was unchanged, so the live pod
  kept running and Argo reported Synced at `39dae7f`. The 220 × `/healthz` curls at 1 s spacing over
  that window returned **zero non-200**, which proves the site was healthy, *not* that rolling is
  gap-free.
- **Gap-free is expected, not yet measured on a real digest bump.** The owner curls through the first
  bump and reports the count. Until that lands, keep cutting releases **when nobody is playing**;
  after it, any time.

Hardening already in the manifest, for reference when changing the image: `runAsNonRoot: true`,
`allowPrivilegeEscalation: false`, `capabilities.drop: ["ALL"]`. `runAsNonRoot` is what makes
kubelet refuse an image that quietly came back as root — keep it if the base image changes.

## CI: `.woodpecker/build.yaml`

One job, on push to `master`: build, tag `:latest` and `:$CI_COMMIT_SHA`, push both to Docker Hub,
print the digest. It replaces the `docker build && docker push` you used to run by hand on a laptop;
`home-ops` still deploys by pinning an immutable digest, so the release contract is untouched — the
job produces the image, a digest bump deploys it.

Where the daemon is, because it is not inside the job: the step sets
`DOCKER_HOST=tcp://docker-beefcake-ci-1:2375`, which is that CI VM's own `dockerd`, published on its
LAN address by `home-ops` (`clusters/dev/_deployed/deployed.yaml`, spec
`expose-docker-api-for-woodpecker`) and named by a Service in the `woodpecker` namespace. Woodpecker
runs steps as pods, and the Kubernetes backend it uses cannot mount `/var/run/docker.sock` into a
pod — the daemon is reached over the network instead.

Why that is the right shape: the build cache is the daemon's `/var/lib/docker` on the node, so it
survives between runs. Pinning one repo to one node (`docker-beefcake-ci-1`, not a Service that
spreads connections over all four CI nodes) keeps that store warm: the base image is pulled once per
node, not once per pipeline, and this repo's layers are reused. Docker Hub credentials arrive as
native Kubernetes secrets mapped to step env vars, from a Secret in the `woodpecker` namespace.
