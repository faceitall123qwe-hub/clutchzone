# Game design

## Concept
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
   headshots, target bots, HUD. ← current
2. **Online deathmatch** — Node.js WebSocket server, rooms by link, server-authoritative movement with
   client prediction + reconciliation, interpolated remote players, lag-compensated hitscan.
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
| 2026-10-07 | Units in metres, CS movement constants converted (1 Hammer unit ≈ 2.54 cm) | Familiar feel |
