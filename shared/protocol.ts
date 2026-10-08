import type { Vec3 } from "./collision.ts";
import type { Part } from "./hitbox.ts";
import type { Site } from "./map.ts";
import type { Cmd, Sim } from "./sim.ts";

export const MAX_PLAYERS = 10;
export const SNAPSHOT_EVERY = 2; // ticks: 30 snapshots per second
export const INTERP_TICKS = 6; // other players are drawn 100 ms in the past
export const RESPAWN_TIME = 3; // warmup only; in a round the dead wait for the next one
export const MAX_HP = 100;

// Teams and the round rules (seconds)
export const ATK = 0, DEF = 1;
export const TEAM_NAMES = ["Attackers", "Defenders"];
export const FREEZE_TIME = 4;
export const ROUND_TIME = 115;
export const BOMB_TIME = 40;
export const PLANT_TIME = 3;
export const DEFUSE_TIME = 7;
export const ROUND_END_TIME = 5;
export const MATCH_END_TIME = 10;
export const ROUNDS_TO_WIN = 7;
export const LATE_JOIN = 15; // joining this far into a round still spawns you
export const DEFUSE_RANGE = 1.5;
export const BOMB_KILL_RADIUS = 8; // certain death inside, falls off to nothing at twice this

// client → server
export type ClientMsg =
  | { type: "input"; cmd: Cmd; viewTick: number } // viewTick: server tick the shooter was looking at
  | { type: "ping"; t: number; rtt?: number } // rtt: the client's last measured round trip, for the scoreboard
  | { type: "dev"; teleport?: Vec3; yaw?: number }; // only honoured by a server started with --dev

export type RemotePlayer = {
  id: number; name: string; team: number; x: number; y: number; z: number; yaw: number; pitch: number;
  crouched: boolean; alive: boolean; hp: number; weapon: number; kills: number; deaths: number; ping: number;
};

export type GameEvent =
  | { type: "shot"; id: number; w: number; o: Vec3; end: Vec3 } // w: weapon id
  | { type: "hit"; by: number; target: number; part: Part; damage: number }
  | { type: "kill"; killer: number; victim: number; head: boolean; w: number } // killer -1, w -1: the bomb
  | { type: "join"; id: number; name: string }
  | { type: "leave"; id: number; name: string }
  | { type: "planted"; by: number; site: Site }
  | { type: "defused"; by: number }
  | { type: "exploded"; pos: Vec3 }
  | { type: "roundEnd"; winner: number; reason: string };

/**
 * What the round is doing. Sent when it changes; times are server ticks, so every client counts down
 * the same clock. The bomb is with `carrier`, or lies at `pos` (dropped or planted).
 */
export type RoundState = {
  map: string; // MapDef id; changes after a match
  phase: "warmup" | "freeze" | "live" | "over" | "matchover";
  endsAt: number; // when this phase ends; while the bomb is planted, when it explodes
  round: number;
  score: [number, number];
  bomb: { carrier: number | null; pos: Vec3 | null; planted: boolean; site: Site | null };
  winner: number | null; // of the round just finished (or the match)
  reason: string;
};

// Snapshots dominate bandwidth (and Fly bills outbound traffic), so other players travel as compact
// tuples and the slowly changing roster (names, team, score, ping) only when it changes.
export type PlayerTuple = [id: number, x: number, y: number, z: number, yaw: number, pitch: number, flags: number, hp: number,
  weapon: number];
export type RosterEntry = [id: number, name: string, kills: number, deaths: number, ping: number, team: number];
export const ALIVE = 1, CROUCHED = 2;

/** act: progress of planting or defusing, 0..1 (0 when not doing either). */
export type You = {
  lastSeq: number; sim: Sim; hp: number; alive: boolean; respawnIn: number; killedBy: number | null; act: number;
};

// server → client
export type ServerMsg =
  | { type: "welcome"; id: number; tick: number; room: string }
  | { type: "full" }
  | { type: "pong"; t: number }
  | { type: "snap"; tick: number; you: You; p: PlayerTuple[]; r?: RosterEntry[]; g?: RoundState; events: GameEvent[] };

/** Snapshot as the game uses it, after Net has decoded the wire format. */
export type Snapshot = { tick: number; you: You; players: RemotePlayer[]; round: RoundState | null; events: GameEvent[] };

export function decodePlayers(p: PlayerTuple[], roster: Map<number, RosterEntry>): RemotePlayer[] {
  return p.map(([id, x, y, z, yaw, pitch, flags, hp, weapon]) => {
    const r = roster.get(id);
    return { id, x, y, z, yaw, pitch, hp, weapon, alive: (flags & ALIVE) !== 0, crouched: (flags & CROUCHED) !== 0,
      name: r?.[1] ?? "…", kills: r?.[2] ?? 0, deaths: r?.[3] ?? 0, ping: r?.[4] ?? 0, team: r?.[5] ?? 0 };
  });
}
