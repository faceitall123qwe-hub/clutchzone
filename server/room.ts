import type { Vec3 } from "../shared/collision.ts";
import { DAMAGE_SCALE } from "../shared/hitbox.ts";
import { MAP, SPAWNS } from "../shared/map.ts";
import * as P from "../shared/protocol.ts";
import { gunOf, newSim, shotSeed, simulate, traceMap, traceTargets, type Cmd, type Sim } from "../shared/sim.ts";
import { TICK } from "../shared/constants.ts";
import { WEAPONS } from "../shared/weapons.ts";
import { BOT_NAMES, BotBrain } from "./bot.ts";

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
  bot?: BotBrain;
};

const ALL_SPAWNS = [...SPAWNS.attackers, ...SPAWNS.defenders];
const BOT_FILL = 4; // a public room with one human gets three bots

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
    slot: Number.isInteger(r.slot) && WEAPONS[r.slot as number] ? r.slot as number : 0,
    aim: r.aim === true,
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
  /** Public rooms are topped up with bots so a lone visitor has someone to play against. */
  private readonly withBots: boolean;

  constructor(id: string, opts: { dev?: boolean; bots?: boolean } = {}) {
    this.id = id;
    this.dev = opts.dev ?? false;
    this.withBots = opts.bots ?? false;
  }

  get humans() {
    let n = 0;
    for (const p of this.players.values()) if (!p.bot) n++;
    return n;
  }

  /** Full counts humans only: a bot gives up its place when someone joins. */
  get full() {
    return this.humans >= P.MAX_PLAYERS;
  }

  join(name: string, send: (m: P.ServerMsg | string) => void, bot?: BotBrain): Player {
    if (!bot) this.balanceBots(1); // make room for the newcomer before they spawn
    const p: Player = {
      id: this.nextId++, name: name.slice(0, 16) || "Player", sim: newSim(), yaw: 0, pitch: 0, hp: P.MAX_HP,
      alive: true, respawnIn: 0, killedBy: null, kills: 0, deaths: 0, ping: 0, lastSeq: 0, queue: [], budget: 2, send,
      bot,
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
    if (!p.bot) this.balanceBots();
  }

  /** Keep humans + bots at BOT_FILL while any human is here; no bots in an empty room. */
  private balanceBots(incoming = 0): void {
    if (!this.withBots) return;
    const humans = this.humans + incoming;
    const want = humans === 0 ? 0 : Math.max(0, BOT_FILL - humans);
    const bots = [...this.players.values()].filter((p) => p.bot);
    for (const b of bots.slice(want)) this.leave(b.id);
    for (let i = bots.length; i < want; i++) {
      const taken = new Set([...this.players.values()].map((p) => p.name));
      const name = BOT_NAMES.find((n) => !taken.has(n)) ?? `Bot ${this.nextId}`;
      this.join(name, () => {}, new BotBrain());
    }
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
      this.events.push({ type: "shot", id: p.id, w: b.w, o: b.o,
        end: { x: b.o.x + b.d.x * t, y: b.o.y + b.d.y * t, z: b.o.z + b.d.z * t } });
      if (hit) this.damage(p, this.players.get(hit.id)!, hit.part, b.w);
    }
  }

  private damage(by: Player, target: Player, part: keyof typeof DAMAGE_SCALE, w: number): void {
    if (!target.alive) return;
    const damage = Math.round(WEAPONS[w].damage * DAMAGE_SCALE[part]);
    target.hp -= damage;
    this.events.push({ type: "hit", by: by.id, target: target.id, part, damage });
    if (target.hp <= 0) {
      target.hp = 0;
      target.alive = false;
      target.respawnIn = P.RESPAWN_TIME;
      target.killedBy = by.id;
      target.deaths++;
      by.kills++;
      this.events.push({ type: "kill", killer: by.id, victim: target.id, head: part === "head", w });
    }
  }

  step(): void {
    this.tick++;
    for (const p of this.players.values()) {
      if (p.bot) {
        const enemies = [...this.players.values()].filter((o) => o !== p && o.alive)
          .map((o) => ({ id: o.id, feet: o.sim.move.pos, crouched: o.sim.move.crouched }));
        const cmd = p.bot.think(p.sim.move, p.yaw, p.pitch, gunOf(p.sim).ammo, enemies, this.tick);
        this.runCommand(p, { ...cmd, seq: p.lastSeq + 1 }, this.tick);
      }
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

  private lastRoster = "";

  private broadcast(): void {
    // Other players are only drawn, so millimetres are plenty; your own state ("you") stays exact,
    // because prediction replays from it and must match the server bit for bit.
    const r = (v: number, k = 1000) => Math.round(v * k) / k;
    const p: P.PlayerTuple[] = [...this.players.values()].map((pl) => [
      pl.id, r(pl.sim.move.pos.x), r(pl.sim.move.pos.y), r(pl.sim.move.pos.z), r(pl.yaw, 1e4), r(pl.pitch, 1e4),
      (pl.alive ? P.ALIVE : 0) | (pl.sim.move.crouched ? P.CROUCHED : 0), pl.hp, pl.sim.slot,
    ]);
    const roster = JSON.stringify([...this.players.values()].map((pl): P.RosterEntry =>
      [pl.id, pl.name, pl.kills, pl.deaths, pl.ping]));
    // Names and scores change rarely: send them when they do, and once a second for anyone who missed it.
    const withRoster = roster !== this.lastRoster || this.tick % 60 === 0;
    this.lastRoster = roster;
    const events = this.events.map((e) => e.type === "shot"
      ? { ...e, o: { x: r(e.o.x), y: r(e.o.y), z: r(e.o.z) }, end: { x: r(e.end.x), y: r(e.end.y), z: r(e.end.z) } }
      : e);
    this.events = [];
    // The part everyone gets is serialised once per room, not once per player.
    const head = `{"type":"snap","tick":${this.tick},"p":${JSON.stringify(p)},${withRoster ? `"r":${roster},` : ""}"events":${JSON.stringify(events)},"you":`;
    for (const pl of this.players.values()) {
      const you: P.You = { lastSeq: pl.lastSeq, sim: pl.sim, hp: pl.hp, alive: pl.alive, respawnIn: pl.respawnIn,
        killedBy: pl.killedBy };
      pl.send(`${head}${JSON.stringify(you)}}`);
    }
  }

}
