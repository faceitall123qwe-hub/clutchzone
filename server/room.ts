import type { Vec3 } from "../shared/collision.ts";
import { DAMAGE_SCALE } from "../shared/hitbox.ts";
import { MAP, SPAWNS } from "../shared/map.ts";
import * as P from "../shared/protocol.ts";
import { newSim, shotSeed, simulate, traceMap, traceTargets, type Cmd, type Sim } from "../shared/sim.ts";
import { TICK } from "../shared/constants.ts";
import { RIFLE } from "../shared/weapons.ts";

const HISTORY = 64; // ticks of positions kept for lag compensation (~1 s)
const MAX_REWIND = 30; // never rewind more than 500 ms, however high the ping
// Commands a player may bank (as CS's sv_maxusrcmdprocessticks). A client that froze for a moment
// sends the missed commands in one burst and needs the banked budget to catch up; a speedhack that
// sends more than 60 commands/s on average still can't get ahead.
const BUDGET_CAP = 16;

type Pose = { feet: Vec3; crouched: boolean; alive: boolean };

export type Player = {
  id: number;
  name: string;
  sim: Sim;
  yaw: number;
  pitch: number;
  hp: number;
  alive: boolean;
  respawnIn: number;
  killedBy: number | null;
  kills: number;
  deaths: number;
  ping: number;
  lastSeq: number;
  queue: { cmd: Cmd; viewTick: number }[];
  budget: number;
  send: (msg: P.ServerMsg | string) => void; // a string is an already serialised message
};

const ALL_SPAWNS = [...SPAWNS.attackers, ...SPAWNS.defenders];

const clamp = (v: unknown, lo: number, hi: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0;

/** Clients are untrusted: a NaN or a forward of 1000 would break the simulation or make a speedhack. */
export function sanitize(c: unknown): Cmd | null {
  if (typeof c !== "object" || c === null) return null;
  const r = c as Record<string, unknown>;
  if (!Number.isSafeInteger(r.seq)) return null;
  return {
    seq: r.seq as number,
    forward: Math.sign(clamp(r.forward, -1, 1)),
    right: Math.sign(clamp(r.right, -1, 1)),
    yaw: clamp(r.yaw, -1e6, 1e6) % (Math.PI * 2),
    pitch: clamp(r.pitch, -1.56, 1.56),
    jump: r.jump === true,
    crouch: r.crouch === true,
    walk: r.walk === true,
    fire: r.fire === true,
    reload: r.reload === true,
  };
}

export class Room {
  readonly id: string;
  tick = 0;
  readonly players = new Map<number, Player>();
  private nextId = 1;
  private events: P.GameEvent[] = [];
  private readonly history: Map<number, Pose>[] = [];
  private readonly dev: boolean;

  constructor(id: string, dev = false) {
    this.id = id;
    this.dev = dev;
  }

  get full() {
    return this.players.size >= P.MAX_PLAYERS;
  }

  join(name: string, send: (m: P.ServerMsg | string) => void): Player {
    const p: Player = {
      id: this.nextId++, name: name.slice(0, 16) || "Player", sim: newSim(), yaw: 0, pitch: 0, hp: P.MAX_HP,
      alive: true, respawnIn: 0, killedBy: null, kills: 0, deaths: 0, ping: 0, lastSeq: 0, queue: [], budget: 2, send,
    };
    this.players.set(p.id, p);
    this.respawn(p);
    this.events.push({ type: "join", id: p.id, name: p.name });
    send({ type: "welcome", id: p.id, tick: this.tick, room: this.id });
    return p;
  }

  leave(id: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.events.push({ type: "leave", id, name: p.name });
  }

  onMessage(p: Player, msg: P.ClientMsg): void {
    if (msg.type === "input") {
      const cmd = sanitize(msg.cmd);
      if (!cmd || cmd.seq <= p.lastSeq || p.queue.length > 30) return; // garbage, stale, duplicate or flooding
      const viewTick = Number.isFinite(msg.viewTick) ? msg.viewTick : this.tick;
      p.queue.push({ cmd, viewTick });
    } else if (msg.type === "ping") {
      if (Number.isFinite(msg.rtt)) p.ping = Math.round(msg.rtt!);
      p.send({ type: "pong", t: msg.t });
    } else if (msg.type === "dev" && this.dev) {
      if (msg.teleport) Object.assign(p.sim.move.pos, msg.teleport);
      if (msg.yaw !== undefined) p.yaw = msg.yaw;
    }
  }

  /** Spawn point farthest from living enemies. */
  private respawn(p: Player): void {
    const enemies = [...this.players.values()].filter((o) => o !== p && o.alive).map((o) => o.sim.move.pos);
    let best = ALL_SPAWNS[0], bestDist = -1;
    for (const s of ALL_SPAWNS) {
      const d = enemies.length ? Math.min(...enemies.map((e) => Math.hypot(e.x - s.x, e.z - s.z))) : Math.random();
      if (d > bestDist) { bestDist = d; best = s; }
    }
    const lastSeq = p.lastSeq;
    p.sim = newSim(best.x, 0, best.z);
    p.sim.move.onGround = true;
    p.yaw = best.yaw;
    p.hp = P.MAX_HP;
    p.alive = true;
    p.killedBy = null;
    p.lastSeq = lastSeq;
  }

  /** Other players as they were at a (fractional) past tick, for lag-compensated hit tests. */
  private posesAt(viewTick: number, except: number) {
    const t = Math.max(this.tick - MAX_REWIND, Math.min(this.tick, viewTick));
    const a = this.history[Math.floor(t) % HISTORY], b = this.history[Math.ceil(t) % HISTORY];
    const k = t - Math.floor(t);
    const out: { id: number; feet: Vec3; crouched: boolean }[] = [];
    for (const p of this.players.values()) {
      if (p.id === except || !p.alive) continue;
      const pa = a?.get(p.id), pb = b?.get(p.id) ?? pa;
      if (!pa || !pb || !pa.alive) {
        out.push({ id: p.id, feet: p.sim.move.pos, crouched: p.sim.move.crouched });
        continue;
      }
      out.push({
        id: p.id,
        crouched: pa.crouched,
        feet: {
          x: pa.feet.x + (pb.feet.x - pa.feet.x) * k,
          y: pa.feet.y + (pb.feet.y - pa.feet.y) * k,
          z: pa.feet.z + (pb.feet.z - pa.feet.z) * k,
        },
      });
    }
    return out;
  }

  private runCommand(p: Player, cmd: Cmd, viewTick: number): void {
    p.lastSeq = cmd.seq;
    if (!p.alive) return;
    p.yaw = cmd.yaw;
    p.pitch = cmd.pitch;
    for (const b of simulate(p.sim, cmd, shotSeed(p.id, cmd.seq), MAP)) {
      const wall = traceMap(b, MAP);
      const hit = traceTargets(b, this.posesAt(viewTick, p.id), wall.t);
      const t = hit?.t ?? wall.t;
      this.events.push({ type: "shot", id: p.id, o: b.o,
        end: { x: b.o.x + b.d.x * t, y: b.o.y + b.d.y * t, z: b.o.z + b.d.z * t } });
      if (hit) this.damage(p, this.players.get(hit.id)!, hit.part);
    }
  }

  private damage(by: Player, target: Player, part: keyof typeof DAMAGE_SCALE): void {
    if (!target.alive) return;
    const damage = Math.round(RIFLE.damage * DAMAGE_SCALE[part]);
    target.hp -= damage;
    this.events.push({ type: "hit", by: by.id, target: target.id, part, damage });
    if (target.hp <= 0) {
      target.hp = 0;
      target.alive = false;
      target.respawnIn = P.RESPAWN_TIME;
      target.killedBy = by.id;
      target.deaths++;
      by.kills++;
      this.events.push({ type: "kill", killer: by.id, victim: target.id, head: part === "head" });
    }
  }

  step(): void {
    this.tick++;
    for (const p of this.players.values()) {
      p.budget = Math.min(p.budget + 1, BUDGET_CAP);
      while (p.queue.length && p.budget >= 1) {
        const { cmd, viewTick } = p.queue.shift()!;
        p.budget--;
        this.runCommand(p, cmd, viewTick);
      }
      // A backlog left over after a long freeze would add its length to every input's latency for the
      // rest of the match. Drop it: the client replays from our state and corrects itself.
      if (p.queue.length > 4) {
        p.lastSeq = p.queue[p.queue.length - 1].cmd.seq;
        p.queue.length = 0;
      }
      if (!p.alive) {
        p.respawnIn -= TICK;
        if (p.respawnIn <= 0) this.respawn(p);
      }
    }
    const poses = new Map<number, Pose>();
    for (const p of this.players.values())
      poses.set(p.id, { feet: { ...p.sim.move.pos }, crouched: p.sim.move.crouched, alive: p.alive });
    this.history[this.tick % HISTORY] = poses;

    if (this.tick % P.SNAPSHOT_EVERY === 0) this.broadcast();
  }

  private broadcast(): void {
    // Other players are only drawn, so millimetres are plenty; your own state ("you") stays exact,
    // because prediction replays from it and must match the server bit for bit.
    const r = (v: number, k = 1000) => Math.round(v * k) / k;
    const players: P.RemotePlayer[] = [...this.players.values()].map((p) => ({
      id: p.id, name: p.name, x: r(p.sim.move.pos.x), y: r(p.sim.move.pos.y), z: r(p.sim.move.pos.z),
      yaw: r(p.yaw, 1e4), pitch: r(p.pitch, 1e4), crouched: p.sim.move.crouched, alive: p.alive, hp: p.hp,
      kills: p.kills, deaths: p.deaths, ping: p.ping,
    }));
    const events = this.events;
    this.events = [];
    // The part everyone gets is serialised once per room, not once per player.
    const head = `{"type":"snap","tick":${this.tick},"players":${JSON.stringify(players)},"events":${JSON.stringify(events)},"you":`;
    for (const p of this.players.values()) {
      const you: Extract<P.ServerMsg, { type: "snap" }>["you"] = { lastSeq: p.lastSeq, sim: p.sim, hp: p.hp,
        alive: p.alive, respawnIn: p.respawnIn, killedBy: p.killedBy };
      p.send(`${head}${JSON.stringify(you)}}`);
    }
  }
}
