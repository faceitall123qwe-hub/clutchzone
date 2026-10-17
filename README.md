# Clutchzone

A free cartoon tactical shooter that runs in the browser: 4v4, attackers plant the bomb on site A or B, defenders
hold the sites and defuse. Bots fill the teams, so there is always a match.

**Play:** https://clutchzone.pro · [itch.io](https://tymek8191-tech.itch.io/clutchzone) (browser + Windows app)

- 3 maps (Plaza, Reactor, Skyline) drawn as a colourful town, rounds to 7, sides swap
- 6 weapons: AR-7 rifle, P-9 pistol, Longbow sniper, Wasp SMG, Breacher shotgun, Blade knife
- Levels, unlockable paints, hats and kill effects, daily challenges, invite links for private rooms

## Tech
three.js + TypeScript + Vite on the client. A Node server runs authoritative 60 Hz rooms, and client and server
share one `simulate()`. The client predicts and reconciles, hits are lag-compensated, and snapshots go out at
30 Hz. It runs on a single Fly.io machine.

```bash
npm install
npm run dev          # client on http://localhost:5173
npm run server:dev   # game server on :8080 (dev commands on)
npm test             # simulation, rooms, bots, maps
npm run build:desktop  # Windows app (Electron) in desktop/out
```

Architecture, testing and deploy notes: [CLAUDE.md](CLAUDE.md) and [docs/GAME.md](docs/GAME.md).
