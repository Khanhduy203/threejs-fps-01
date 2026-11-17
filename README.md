# SANDLINE — Depot 9

[![make.fun · threejs-fps-01](https://make.fun/badge/threejs-fps-01.svg)](https://make.fun/bounty/threejs-fps-01?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01)
[![rank](https://make.fun/badge/threejs-fps-01/Khanhduy203/threejs-fps-01/rank.svg)](https://make.fun/bounty/threejs-fps-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01)
[![reward](https://make.fun/badge/threejs-fps-01/Khanhduy203/threejs-fps-01/reward.svg)](https://make.fun/bounty/threejs-fps-01?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01)

Entry for the [make.fun threejs-fps-01 bounty](https://make.fun/bounty/threejs-fps-01) — "Make the best three.js tactical FPS", $1,000 in USDC.

A round-based tactical FPS in three.js, built for make.fun's `threejs-fps-01`
bounty. Counter-Strike-style, never a copy: an original dusk container yard,
original weapons, bots and names.

## The game

You are STRIKE, attacking Depot 9 against three WARDEN defenders, with two
AI teammates at your side. Win a round by eliminating the defence or by
planting the bomb at site A or B and guarding it until it blows. First to
5 rounds (at most 9) takes the match.

- **Gunplay:** four weapons (P9 pistol, VK-9 SMG, AR-77 rifle, LANCE-50
  sniper) with magazines, reloads, falloff and headshots worth 4×; recoil and
  bloom punish spraying, and spread grows with movement speed, so stopping
  to aim pays. Right-click aims down sights; the sniper is only accurate
  scoped. Crouch, jump, and AABB collision with the map.
- **Tactics:** a bomb to plant (hold E in a site) and defuse, money earned
  per kill and per round and spent in a buy menu (B) during the 15-second
  buy phase, a frag grenade (G) with bouncing physics and blast cover, and
  Kevlar that absorbs half of each hit. Bots follow nav-graph routes, hold
  positions and scan, investigate gunfire they hear, strafe while fighting,
  and play the objective: they plant, defuse, retake and pick up a dropped
  bomb.
- **The map:** Depot 9, a 64 × 48 m container yard with three lanes, a mid
  connector, two walled sites, stacked containers, crates, a jump-up
  platform and a watchtower, lit by a low dusk sun.
- **HUD:** health and armour, ammo, money, round/bomb timer, score, alive
  pips, teammate health, kill feed, a live minimap (teammates, spotted
  enemies, bomb), a dynamic crosshair, hit markers, damage direction, and
  plant/defuse progress. All sound is synthesized with WebAudio — no assets,
  no network.

## Play it

```
node serve.ts        # serves game/ on http://localhost:8080
```

Open it in desktop Chrome. Click Deploy, buy in the buy menu, click Deploy
again. No build step, no network request.

## Layout

- `game/index.html` — the page and the whole HUD (DOM + CSS)
- `game/src/main.js` — boot, the fixed 60 Hz loop, the round state machine
- `game/src/state.js` — the one place match state lives
- `game/src/world.js` — the map, colliders, line of sight, the nav graph
- `game/src/player.js` — movement, collision, health and armour
- `game/src/weapons.js` — the armoury, view models, spread and bloom
- `game/src/bots.js` — bot AI: routes, holds, vision, hearing, combat
- `game/src/combat.js` — shooting resolution, grenades, tracers, particles
- `game/src/bomb.js` — plant / defuse / explode
- `game/src/economy.js` — money, the shop, loadout persistence
- `game/src/hud.js` — the DOM HUD and the minimap
- `game/src/audio.js` — synthesized sound effects
- `game/src/input.js` — keyboard, mouse and pointer lock
- `game/src/palette.js`, `game/src/rng.js` — the look plan, the seeded RNG
- `main.ts` — the entry program: copies `game/` + `screenshots/` to
  `/output` and writes `dossier.json`

## Screenshots

Deterministic frames for capture: `?shot=start|play|buy|end&seed=1` stages a
frame, renders it twice and sets `window.__shotReady`. See `shots.json`.
