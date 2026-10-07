import type { Vec3 } from "./collision.ts";
import type { Part } from "./hitbox.ts";
import type { Cmd, Sim } from "./sim.ts";

export const MAX_PLAYERS = 10;
export const SNAPSHOT_EVERY = 2; // ticks: 30 snapshots per second
export const INTERP_TICKS = 6; // other players are drawn 100 ms in the past
export const RESPAWN_TIME = 3;
export const MAX_HP = 100;

// client → server
export type ClientMsg =
  | { type: "input"; cmd: Cmd; viewTick: number } // viewTick: server tick the shooter was looking at
  | { type: "ping"; t: number; rtt?: number } // rtt: the client's last measured round trip, for the scoreboard
  | { type: "dev"; teleport?: Vec3; yaw?: number }; // only honoured by a server started with --dev

export type RemotePlayer = {
  id: number; name: string; x: number; y: number; z: number; yaw: number; pitch: number;
  crouched: boolean; alive: boolean; hp: number; weapon: number; kills: number; deaths: number; ping: number;
};

export type GameEvent =
  | { type: "shot"; id: number; w: number; o: Vec3; end: Vec3 } // w: weapon id
  | { type: "hit"; by: number; target: number; part: Part; damage: number }
  | { type: "kill"; killer: number; victim: number; head: boolean; w: number }
  | { type: "join"; id: number; name: string }
  | { type: "leave"; id: number; name: string };

// Snapshots dominate bandwidth (and Fly bills outbound traffic), so other players travel as compact
// tuples and the slowly changing roster (names, score, ping) only when it changes.
export type PlayerTuple = [id: number, x: number, y: number, z: number, yaw: number, pitch: number, flags: number, hp: number,
  weapon: number];
export type RosterEntry = [id: number, name: string, kills: number, deaths: number, ping: number];
export const ALIVE = 1, CROUCHED = 2;

export type You = { lastSeq: number; sim: Sim; hp: number; alive: boolean; respawnIn: number; killedBy: number | null };

// server → client
export type ServerMsg =
  | { type: "welcome"; id: number; tick: number; room: string }
  | { type: "full" }
  | { type: "pong"; t: number }
  | { type: "snap"; tick: number; you: You; p: PlayerTuple[]; r?: RosterEntry[]; events: GameEvent[] };

/** Snapshot as the game uses it, after Net has decoded the wire format. */
export type Snapshot = { tick: number; you: You; players: RemotePlayer[]; events: GameEvent[] };

export function decodePlayers(p: PlayerTuple[], roster: Map<number, RosterEntry>): RemotePlayer[] {
  return p.map(([id, x, y, z, yaw, pitch, flags, hp, weapon]) => {
    const r = roster.get(id);
    return { id, x, y, z, yaw, pitch, hp, weapon, alive: (flags & ALIVE) !== 0, crouched: (flags & CROUCHED) !== 0,
      name: r?.[1] ?? "…", kills: r?.[2] ?? 0, deaths: r?.[3] ?? 0, ping: r?.[4] ?? 0 };
  });
}
