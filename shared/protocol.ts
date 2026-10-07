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
  crouched: boolean; alive: boolean; hp: number; kills: number; deaths: number; ping: number;
};

export type GameEvent =
  | { type: "shot"; id: number; o: Vec3; end: Vec3 }
  | { type: "hit"; by: number; target: number; part: Part; damage: number }
  | { type: "kill"; killer: number; victim: number; head: boolean }
  | { type: "join"; id: number; name: string }
  | { type: "leave"; id: number; name: string };

// server → client
export type ServerMsg =
  | { type: "welcome"; id: number; tick: number; room: string }
  | { type: "full" }
  | { type: "pong"; t: number }
  | {
      type: "snap";
      tick: number;
      you: { lastSeq: number; sim: Sim; hp: number; alive: boolean; respawnIn: number; killedBy: number | null };
      players: RemotePlayer[];
      events: GameEvent[];
    };
