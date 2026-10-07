# Game design

## Concept
- Name: **Clutchzone** (domain clutchzone.pl, chosen 2026-10-07). First map: Outpost.
- Genre: competitive multiplayer first-person shooter in the browser, in the spirit of Counter-Strike.
- Pitch: open a link, you're in a 5v5-style tactical shooter in seconds — no install, no account.
- References: Counter-Strike 1.6 / CS2 (movement, rounds, economy), Krunker.io (browser delivery).
- Own name, own maps and art. No Valve names, logos, models, sounds or map copies.

## Core loop
Spawn → buy → move as a team → win gunfights with aim, recoil control and positioning → win the
round (eliminate or bomb) → earn money → next round. A match is first to N rounds.

## Controls
WASD move · mouse look · LMB fire · R reload · Space jump · C crouch · Shift walk (quiet, accurate)
· later: B buy, E plant/defuse, Tab scoreboard, 1-3 weapons.

## Roadmap
1. **Offline shooting range** — FPS controller with CS-like movement (ground accel/friction, air
   strafing, jump, crouch, step-up), blockout map, rifle with fire rate, spray pattern, spread, reload,
   headshots, target bots, HUD. ✔
2. ✔ **Online deathmatch** — Node.js WebSocket server, rooms by link, server-authoritative movement with
   client prediction + reconciliation, interpolated remote players, lag-compensated hitscan.
   Playable with friends today via `npm run share` (Cloudflare quick tunnel from Tim's laptop).
   Still open: permanent hosting (needs an account: Fly.io / Hetzner VPS), so the link survives.
3. **Rounds** — teams, round timer, bomb plant/defuse, buy menu, economy, pistol + rifle + AWP-like sniper.
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
| 2026-10-07 | Units in metres, CS movement constants converted (1 Hammer unit ≈ 2.54 cm) | Familiar feel |
