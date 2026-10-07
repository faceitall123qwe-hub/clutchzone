# Game design

## Concept
- Name: **Clutchzone** (domain clutchzone.pro at OVH, bought 2026-10-07). First map: Outpost.
- Genre: competitive multiplayer first-person shooter in the browser, in the spirit of Counter-Strike.
- Pitch: open a link, you're in a 5v5-style tactical shooter in seconds — no install, no account.
- References: Counter-Strike 1.6 / CS2 (movement, rounds, economy), Krunker.io (browser delivery).
- Own name, own maps and art. No Valve names, logos, models, sounds or map copies.

## Core loop
Spawn → buy → move as a team → win gunfights with aim, recoil control and positioning → win the
round (eliminate or bomb) → earn money → next round. A match is first to N rounds.

## Controls
WASD move · mouse look · LMB fire · RMB scope (sniper) · R reload · Space jump · C crouch
· Shift walk (quiet, accurate) · 1/2/3, Q, wheel weapons · Tab scoreboard · later: B buy, E plant/defuse.

## Weapons
| Slot | Name | Damage (head ×4) | Fire | Magazine | Notes |
|---|---|---|---|---|---|
| 1 | AR-7 rifle | 36 | auto, 600 rpm | 30 / 90 | spray pattern, accurate below 34% speed |
| 2 | P-9 pistol | 28 | semi-auto, max 400 rpm | 12 / 48 | one-tap headshot, accurate on the move |
| 3 | Longbow sniper | 115 | bolt, 1.45 s | 5 / 20 | one body shot kills, legs don't; scope 22°, accurate only scoped; 85% speed, 42% scoped |

## Roadmap
1. **Offline shooting range** — FPS controller with CS-like movement (ground accel/friction, air
   strafing, jump, crouch, step-up), blockout map, rifle with fire rate, spray pattern, spread, reload,
   headshots, target bots, HUD. ✔
2. ✔ **Online deathmatch** — Node.js WebSocket server, rooms by link, server-authoritative movement with
   client prediction + reconciliation, interpolated remote players, lag-compensated hitscan.
   Playable with friends today via `npm run share` (Cloudflare quick tunnel from Tim's laptop).
   Still open: permanent hosting (needs an account: Fly.io / Hetzner VPS), so the link survives.
2.5 ✔ **Look & feel** (Tim, 2026-10-07: "tracers don't come from the gun, more guns, nicer killfeed, new graphics")
   - [x] Tracers start at the muzzle (own gun and other players' guns), visible bullet streaks
   - [x] Impacts: dust and sparks on walls, blood puff on confirmed hits, other players' muzzle flash
   - [x] Weapons: AR-7 rifle, P-9 pistol (semi-auto), Longbow sniper (scope on right mouse, one body shot,
         slows you down); switch with 1/2/3, Q, mouse wheel; draw time; all server-authoritative
   - [x] First-person models for each weapon with hands, draw and reload animations, sniper scope overlay
   - [x] HUD: killfeed with weapon and headshot icons, weapon slots, health bar, kill banner,
         damage direction indicator
   - [x] Settings: mouse sensitivity, field of view, volume (saved in the browser)
   - [x] Graphics: textured materials (sandstone, plaster, concrete, wood, metal), tone mapping, sky dome,
         contact shading at wall bottoms, site letters A/B, wall caps
   - [x] Player models: soldier with helmet, vest and the gun they hold, leg animation, death fall
   - [x] Sounds per weapon, footsteps (own and others')
3. **Rounds** — teams, round timer, bomb plant/defuse, buy menu, economy.
4. **Polish & launch** — real art (CC0 low-poly), sounds, second map, matchmaking list, itch.io / CrazyGames.

## Netcode plan (phase 2)
- Server simulates at 60 Hz with the same `shared/movement.ts` as the client, sends snapshots at 30 Hz.
- Client sends input commands (seq, yaw, pitch, buttons) every tick, predicts its own movement and
  replays unacknowledged inputs when a snapshot arrives.
- Other players are rendered ~100 ms in the past, interpolated between snapshots.
- Hits are decided on the server, rewinding other players to what the shooter saw (lag compensation).

## Art style
Phase 1: readable blockout (flat-coloured boxes). Later: CC0 low-poly (Kenney, Quaternius).

## Decisions
| Date | Decision | Why |
|---|---|---|
| 2026-10-06 | Browser 3D on three.js + TypeScript + Vite | Playable from a link; Claude can run and screenshot it |
| 2026-10-07 | Multiplayer CS-like shooter | Tim's choice |
| 2026-10-07 | Authoritative Node.js server + WebSocket, shared movement code | Cheat resistance; client and server must agree on movement |
| 2026-10-07 | Map = list of axis-aligned boxes, custom AABB collision (no physics engine) | Same code on server, cheap, precise enough for a blockout shooter |
| 2026-10-07 | Crouch on C, not Ctrl | Ctrl+W (crouch + forward) closes the browser tab and can't be blocked outside fullscreen |
| 2026-10-07 | Bunnyhop cap: speed clamped to 1.2× run speed at take-off | Uncapped air strafing reached 14.8 m/s (2.3× run) in 8 jumps; CS 1.6 caps it too |
| 2026-10-07 | Rifle is fully accurate below 34% of run speed | As in CS; makes counter-strafing (0.07 s) worth learning |
| 2026-10-07 | Mid wall on the defenders' side; a test forbids spawn-to-spawn sightlines | Playtest found 5 spawn pairs that could see each other through the mid doors |
| 2026-10-07 | Ground snap when walking off steps (≤ 0.45 m) | Descending stairs made the player airborne 22 of 53 ticks: full air spread, no jumping |
| 2026-10-07 | Hosting: Fly.io Frankfurt, shared-cpu-1x 256 MB, suspend when idle, compact snapshots | Tim asked for cheap: ~$0.50/month idle, $1.94 if always on, 87 MB per player-hour at $0.02/GB; ping from Warsaw 27-36 ms |
| 2026-10-07 | Server bots fill public rooms up to 4 while any human plays | A lone first visitor otherwise meets an empty map and leaves; bots play by the same simulate() rules, see only what a player could, react in 0.3-0.45 s |
| 2026-10-07 | Three weapons for everyone (no buy menu yet), switch costs a draw time | Variety before economy; the draw time stops quick-switch tricks |
| 2026-10-07 | Art: procedural canvas textures and box/cylinder models, no asset files | Small download, no licences to track, matches the blockout; CC0 models can replace them later |
| 2026-10-07 | Tracers are screen-space lines from the drawn muzzle; others' shots play when their model is drawn (~100 ms late) | A world-space line from the eye was cut by the near plane and sub-pixel at range; delayed effects match the gun you see |
| 2026-10-07 | Units in metres, CS movement constants converted (1 Hammer unit ≈ 2.54 cm) | Familiar feel |
