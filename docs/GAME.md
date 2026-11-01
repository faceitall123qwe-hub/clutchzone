# Game design

## Concept
- Name: **Clutchzone** (domain clutchzone.pro at OVH, bought 2026-10-07).
- Genre: competitive multiplayer first-person shooter in the browser, in the spirit of Counter-Strike.
- Pitch: open a link, you're in a 5v5-style tactical shooter in seconds — no install, no account.
- References: Counter-Strike 1.6 / CS2 (movement, rounds, economy), Krunker.io (browser delivery).
- Own name, own maps and art. No Valve names, logos, models, sounds or map copies.

## Core loop
Spawn → buy → move as a team → win gunfights with aim, recoil control and positioning → win the
round (eliminate or bomb) → earn money → next round. A match is first to N rounds.

## Controls
WASD move · mouse look · LMB fire · RMB scope (sniper) · R reload · Space jump · C crouch
· Shift walk (quiet, accurate) · 1/2/3, Q, wheel weapons · E (hold) plant / defuse · Tab scoreboard · later: B buy.

## Maps
All maps: attackers spawn in the south (+Z), defenders in the north, bomb sites A (east) and B (west).
Rooms rotate Outpost → Dockyard → Frostbite after every match; private rooms pick the first map in the menu,
public rooms start on a random one. A map is data in `shared/maps/*.ts`; `server/maps.test.ts` checks
every map (spawns free, no spawn-to-spawn sightline, both sites reachable, defenders arrive first, bots plant and defuse).

| Map | Size | Theme | Character |
|---|---|---|---|
| Outpost | 48 × 48 m | desert | two buildings, three lanes; A on a raised platform, B among crates |
| Dockyard | 56 × 56 m | harbour | container alley in mid; B inside a roofed warehouse with two doors; A an open yard with a loading dock and a container stack you can climb from crates |
| Frostbite | 52 × 52 m | snow | church with a tower in the middle, cabins and pines; B the sawmill with log piles, A the market square with a stage; 1 m fences you can jump |

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
3. **Rounds** (Tim, 2026-10-07: "go" on teams + rounds first)
   - [x] Two teams, Attackers and Defenders; public rooms filled with bots to 4 v 4; no friendly fire
   - [x] Round: 4 s freeze, 1:55 to play; bomb carried by one attacker, planted on site A or B (hold E 3 s),
         explodes after 40 s; defused by holding E 7 s; dropped when the carrier dies, picked up by walking over it
   - [x] Wins: elimination, bomb exploded, bomb defused, time ran out; first to 7, then the sides swap
   - [x] Dead players watch a living teammate (click: next); late joiners (after 15 s) wait for the next round
   - [x] HUD: score and timer bar, alive counts, round result, plant/defuse progress, hints, radar, team scoreboard
   - [x] Bots play the objective: attackers take the bomb to a site and plant, pick it up when dropped;
         defenders hold both sites and defuse
   - [x] More maps: Dockyard and Frostbite, rotation after each match, map choice for private rooms
   - [ ] Economy and buy menu (money for kills and rounds, armour, grenades), pistol rounds
   - [ ] Smoke, flash and frag grenades
3.5 **Retention** (Tim, 2026-10-08: "people who watch an ad or play once should want to play more")
   - [x] Bots very easy: ~1-1.5 s to react, aim that keeps wobbling, 2-3 shot bursts, narrow sight
   - [x] Progress in the browser: XP (kill 10, headshot 15, round win 15, plant 20, defuse 30, match 50/100),
         levels (100 XP to level 2, +40 per level), 15 unlocks to level 30 (weapon paints, hats, kill effects)
         that other players see, bots wearing rare ones; 3 daily challenges, a days-in-a-row bonus
   - [x] Share card after a match (stats + a frame from one of your kills), invite links with ?ref=:
         the newcomer gets double XP for an hour, the inviter too when the friend joins their room
   - [x] CrazyGames: SDK v3 (username, invite links, rooms, instant multiplayer, mute, gameplay start/stop),
         submitted for Basic launch 2026-10-08, awaiting review
   - [x] itch.io: https://tymek8191-tech.itch.io/clutchzone — plays in the page, plus the Windows app download
   - [x] Windows app (Electron, `desktop/`), linked from the website menu
   - [ ] Short vertical clips posted (TikTok, Shorts): videos are ready in marketing/out, need Tim's accounts
   - Poki: not now (needs phones). Phones: not now (Tim, 2026-10-08)
4. **Polish & launch** — real art (CC0 low-poly), sounds, second map, matchmaking list, itch.io / CrazyGames.

## Netcode plan (phase 2)
- Server simulates at 60 Hz with the same `shared/movement.ts` as the client, sends snapshots at 30 Hz.
- Client sends input commands (seq, yaw, pitch, buttons) every tick, predicts its own movement and
  replays unacknowledged inputs when a snapshot arrives.
- Other players are rendered ~100 ms in the past, interpolated between snapshots.
- Hits are decided on the server, rewinding other players to what the shooter saw (lag compensation).

## Art style
Cartoon (Tim, 2026-10-08: "completely other graphics, not CS-like" -> chose toon over neon, Superhot and voxel):
saturated flat colours, light in three hard bands (MeshToonMaterial), crisp shadows, thick dark outlines,
puffy low-poly clouds, star-shaped muzzle flashes, chunky "Lilita One" lettering with a dark stroke in the HUD.
Outlines: the world is rendered into a target and one full-screen pass draws ink where the second
difference of 1/depth is large (silhouettes and the edges between faces; zero on any flat surface).
The first-person gun, drawn in its own pass, gets inverted-hull outlines instead.

## Decisions
| Date | Decision | Why |
|---|---|---|
| 2026-10-06 | Browser 3D on three.js + TypeScript + Vite | Playable from a link, easy to test and screenshot |
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
| 2026-10-07 | Rounds before economy: everyone keeps all three weapons, refilled each round | The round loop is the CS core; buying needs it first |
| 2026-10-07 | E plants and defuses (no bomb weapon slot); holding E freezes movement in simulate() | Simpler for browser newcomers; freezing in the shared sim keeps prediction exact |
| 2026-10-07 | Defuse 7 s (CS: 10 s, 5 s with a kit) | No defuse kits until there is a buy menu |
| 2026-10-07 | 4 v 4 in public rooms, first to 7 rounds, sides swap after a match | The 48 m map gets crowded with 5 v 5; short matches suit drop-in browser play |
| 2026-10-07 | Bots stop before firing and chase an enemy who ducks out of sight for 2.5 s | Moving rifles miss; without the chase they walked off mid-fight |
| 2026-10-07 | Lag compensation never rewinds past the newest recorded tick | Asking for the current tick read the ring buffer's 64-tick-old slot: bots shot at where players were a second ago |
| 2026-10-08 | Toon art style with outlines from depth in one full-screen pass | Tim's choice; one pass costs the same whatever is on screen, no extra draw calls per object |
| 2026-10-08 | World target without MSAA, 8-bit sRGB colour | With 4x MSAA in half float the laptop fell to 40-47 fps; now 60 again, and the outlines cover the jaggies |
| 2026-10-08 | Progress lives in localStorage, no accounts | No sign-up wall; unlocks are cosmetic, so a cheater only fools himself |
| 2026-10-08 | Bots wear random cosmetics, rare ones included | New players see what they can earn |
| 2026-10-08 | Maps are data (boxes, spawns, sites, decor, theme); the theme picks textures, sky and light | One renderer and one server for every map; new maps need no code, only boxes |
| 2026-10-08 | Bots plant at least 1 m inside a site; site areas reach the walls | A bot stopping 0.6 m from a spot at a site's edge was outside the site and never planted |
| 2026-10-08 | All shaders compiled when a map loads (hidden effects made visible for the compile) | The first tracer or flash compiling mid-fight froze the game for 100-200 ms on Windows |
| 2026-10-08 | Menu in two columns on wide screens; Quick play near the top | CrazyGames plays in frames down to 800x450 and wants gameplay within one click |
| 2026-10-08 | Portal builds play on clutchzone.pro's server (CORS *, no origin check); CrazyGames' SDK only in its build | One server for every audience; other sites never load their script |
| 2026-10-08 | Cover titles start below the top 20% | CrazyGames puts labels over the top-left 40% x 20% of a cover |
| 2026-10-09 | Windows app = Electron around the same build, served as app://game/, playing on clutchzone.pro | No second codebase; invite links point at clutchzone.pro so app and browser players meet |
| 2026-10-07 | Units in metres, CS movement constants converted (1 Hammer unit ≈ 2.54 cm) | Familiar feel |
