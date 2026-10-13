import type { Vec3 } from "../shared/collision.ts";
import { TICK } from "../shared/constants.ts";
import { DAMAGE_SCALE, type Part } from "../shared/hitbox.ts";
import { siteAt, type MapDef, type Site } from "../shared/map.ts";
import { mapById, nextMap } from "../shared/maps.ts";
import * as P from "../shared/protocol.ts";
import { ATK, DEF } from "../shared/protocol.ts";
import { gunOf, newSim, rangeOf, shotSeed, simulate, traceMap, traceTargets, type Cmd, type Sim } from "../shared/sim.ts";
import { WEAPONS } from "../shared/weapons.ts";
import { BOT_NAMES, BotBrain, NO_OBJECTIVE, spotsIn, spotsNear, type Objective } from "./bot.ts";

const HISTORY = 64; // ticks of positions kept for lag compensation (~1 s)
const MAX_REWIND = 30; // never rewind more than 500 ms, however high the ping
// Commands a player may bank (as CS's sv_maxusrcmdprocessticks). A client that froze for a moment
// sends the missed commands in one burst and needs the banked budget to catch up; a speedhack that
// sends more than 60 commands/s on average still can't get ahead.
const BUDGET_CAP = 16;
const TEAM_SIZE = 4; // public rooms are topped up with bots to 4 v 4 while people play
const PICKUP_RANGE = 1;
const ticks = (s: number) => Math.round(s / TICK);

type Pose = { feet: Vec3; crouched: boolean; alive: boolean };

export type Player = {
  id: number;
  name: string;
  team: number;
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
  look: string; // cosmetics, "paint.hat.effect"
  pid: string; // the player's profile id, for invite links
  use: boolean; // holding E in the last command
  act: number; // seconds spent planting or defusing so far
  god?: boolean; // dev: takes no damage (filming)
  bot?: BotBrain;
  spot?: Vec3; // bot: where to go or hold this round
};

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
    use: r.use === true,
  };
}

const pick = <T>(list: T[]): T | undefined => list[Math.floor(Math.random() * list.length)];
const flat = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);
const MID: Vec3 = { x: 0, y: 1.5, z: 4 }; // defenders holding a site watch towards the middle

/** What a joining player tells us about themselves; all of it is checked, none of it trusted. */
export type JoinMeta = { look?: string; pid?: string; ref?: string };
const LOOK = /^[a-z]{1,10}\.[a-z]{1,10}\.[a-z]{1,10}$/, PID = /^[a-z0-9]{4,12}$/;
// bots show off what can be unlocked, the rare things included
const BOT_LOOKS = ["gold.crown.stars", "neon.viking.confetti", "ice.cowboy.none", "forest.cap.none", "desert.beanie.hearts",
  "classic.tophat.none", "galaxy.helmet.stars", "classic.helmet.none"];

/**
 * One match on the map: two teams, rounds with a bomb. Before both teams have a player it's a warmup
 * where the dead respawn. Pure logic, driven by step() at 60 Hz; tested without sockets.
 */
export class Room {
  readonly id: string;
  tick = 0;
  readonly players = new Map<number, Player>();
  map: MapDef;
  readonly round: P.RoundState = {
    map: "", phase: "warmup", endsAt: 0, round: 0, score: [0, 0],
    bomb: { carrier: null, pos: null, planted: false, site: null }, winner: null, reason: "",
  };
  private nextId = 1;
  private events: P.GameEvent[] = [];
  private readonly history: Map<number, Pose>[] = [];
  private readonly dev: boolean;
  /** Public rooms are topped up with bots so a lone visitor has a match to play. */
  private readonly withBots: boolean;
  private liveSince = 0;
  private attackSite: Site = "A"; // where the attacking bots go this round

  constructor(id: string, opts: { dev?: boolean; bots?: boolean; map?: string } = {}) {
    this.id = id;
    this.dev = opts.dev ?? false;
    this.withBots = opts.bots ?? false;
    this.map = mapById(opts.map);
    this.round.map = this.map.id;
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

  private teamOf(team: number, alive = false) {
    return [...this.players.values()].filter((p) => p.team === team && (!alive || p.alive));
  }

  /** The team with fewer people; bots don't count, they make way. */
  private pickTeam(): number {
    const h = [0, 0];
    for (const p of this.players.values()) if (!p.bot) h[p.team]++;
    return h[ATK] === h[DEF] ? (Math.random() < 0.5 ? ATK : DEF) : h[ATK] < h[DEF] ? ATK : DEF;
  }

  join(name: string, send: (m: P.ServerMsg | string) => void, bot?: BotBrain, team = this.pickTeam(), meta: JoinMeta = {}): Player {
    if (!bot) this.balanceBots(team); // make room for the newcomer before they spawn
    const p: Player = {
      id: this.nextId++, name: name.slice(0, 16) || "Player", team, sim: newSim(), yaw: 0, pitch: 0, hp: P.MAX_HP,
      alive: false, respawnIn: 0, killedBy: null, kills: 0, deaths: 0, ping: 0, lastSeq: 0, queue: [], budget: 2, send,
      use: false, act: 0, bot,
      look: bot ? pick(BOT_LOOKS)! : LOOK.test(meta.look ?? "") ? meta.look! : "classic.helmet.none",
      pid: PID.test(meta.pid ?? "") ? meta.pid! : "",
    };
    const host = meta.ref && meta.ref !== p.pid ? [...this.players.values()].find((o) => o.pid === meta.ref) : undefined;
    if (host) this.events.push({ type: "referral", to: host.id, name: p.name });
    this.players.set(p.id, p);
    // you play straight away in the warmup, the freeze time or the first seconds of a round;
    // otherwise you watch your team until the next round
    const r = this.round;
    if (r.phase === "warmup" || r.phase === "freeze" ||
        (r.phase === "live" && !r.bomb.planted && this.tick - this.liveSince < ticks(P.LATE_JOIN))) this.spawn(p);
    this.events.push({ type: "join", id: p.id, name: p.name });
    send({ type: "welcome", id: p.id, tick: this.tick, room: this.id, v: P.VERSION });
    return p;
  }

  leave(id: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.dropBomb(p);
    this.players.delete(id);
    this.events.push({ type: "leave", id, name: p.name });
    if (!p.bot) this.balanceBots();
  }

  /** Each team is filled up to TEAM_SIZE with bots while any human is here; none in an empty room. */
  private balanceBots(incoming?: number): void {
    if (!this.withBots) return;
    const h = [0, 0];
    for (const p of this.players.values()) if (!p.bot) h[p.team]++;
    if (incoming !== undefined) h[incoming]++;
    for (const team of [ATK, DEF]) {
      const want = h[ATK] + h[DEF] === 0 ? 0 : Math.max(0, TEAM_SIZE - h[team]);
      const bots = this.teamOf(team).filter((p) => p.bot).sort((a, b) => Number(b.alive) - Number(a.alive));
      for (const b of bots.slice(want)) this.leave(b.id); // the dead ones go first
      for (let i = bots.length; i < want; i++) {
        const taken = new Set([...this.players.values()].map((p) => p.name));
        const name = BOT_NAMES.find((n) => !taken.has(n)) ?? `Bot ${this.nextId}`;
        this.join(name, () => {}, new BotBrain(), team);
      }
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
    } else if (msg.type === "look" && typeof msg.look === "string" && LOOK.test(msg.look)) {
      p.look = msg.look;
    } else if (msg.type === "dev" && this.dev) {
      if (msg.teleport) Object.assign(p.sim.move.pos, msg.teleport);
      if (msg.yaw !== undefined) p.yaw = msg.yaw;
      if (msg.god !== undefined) p.god = msg.god;
    }
  }

  /** On the team's side of the map, on a spawn point no living teammate is standing on. */
  private spawn(p: Player): void {
    const spots = p.team === ATK ? this.map.spawns.attackers : this.map.spawns.defenders;
    const mates = this.teamOf(p.team, true).filter((o) => o !== p).map((o) => o.sim.move.pos);
    const s = spots.find((s) => mates.every((m) => Math.hypot(m.x - s.x, m.z - s.z) > 0.8)) ?? pick(spots)!;
    const lastSeq = p.lastSeq;
    p.sim = newSim(s.x, 0, s.z);
    p.sim.move.onGround = true;
    p.sim.frozen = this.round.phase === "freeze";
    p.yaw = s.yaw;
    p.hp = P.MAX_HP;
    p.alive = true;
    p.killedBy = null;
    p.lastSeq = lastSeq;
    p.act = 0;
    p.use = false;
    p.bot?.reset();
  }

  private startRound(newMatch: boolean): void {
    const r = this.round;
    if (newMatch) { r.score = [0, 0]; r.round = 0; }
    r.round++;
    r.phase = "freeze";
    r.endsAt = this.tick + ticks(P.FREEZE_TIME);
    r.winner = null;
    r.reason = "";
    for (const p of this.players.values()) p.alive = false; // so spawn() hands out the points afresh
    for (const p of this.players.values()) this.spawn(p);
    const attackers = this.teamOf(ATK);
    r.bomb = { carrier: pick(attackers)?.id ?? null, pos: null, planted: false, site: null };
    // bots: the attackers pick a site together, the defenders split between both
    this.attackSite = Math.random() < 0.5 ? "A" : "B";
    // a metre inside the site, so a bot that stops near its spot is still in the site
    const spots = { A: spotsIn(this.map, this.map.sites.A, 1), B: spotsIn(this.map, this.map.sites.B, 1) };
    let i = 0;
    for (const p of this.players.values()) {
      if (!p.bot) continue;
      p.spot = pick(spots[p.team === ATK ? this.attackSite : i++ % 2 ? "A" : "B"]);
    }
  }

  private endRound(winner: number, reason: string): void {
    const r = this.round;
    r.phase = "over";
    r.endsAt = this.tick + ticks(P.ROUND_END_TIME);
    r.score[winner]++;
    r.winner = winner;
    r.reason = reason;
    for (const p of this.players.values()) p.act = 0;
    this.events.push({ type: "roundEnd", winner, reason });
  }

  private updateRound(): void {
    const r = this.round;
    const alive = [this.teamOf(ATK, true).length, this.teamOf(DEF, true).length];
    const both = this.teamOf(ATK).length > 0 && this.teamOf(DEF).length > 0;
    if (!both && r.phase !== "warmup") {
      r.phase = "warmup";
      r.bomb = { carrier: null, pos: null, planted: false, site: null };
      for (const p of this.players.values()) { p.sim.frozen = false; if (!p.alive) p.respawnIn = 0; }
    }
    switch (r.phase) {
      case "warmup":
        if (both) this.startRound(true);
        break;
      case "freeze":
        if (this.tick >= r.endsAt) {
          r.phase = "live";
          r.endsAt = this.tick + ticks(P.ROUND_TIME);
          this.liveSince = this.tick;
          for (const p of this.players.values()) p.sim.frozen = false;
        }
        break;
      case "live":
        if (r.bomb.planted) {
          if (this.tick >= r.endsAt) { this.explode(); this.endRound(ATK, "The bomb exploded"); }
          else if (alive[DEF] === 0) this.endRound(ATK, "Defenders eliminated");
        } else if (alive[ATK] === 0) this.endRound(DEF, "Attackers eliminated");
        else if (alive[DEF] === 0) this.endRound(ATK, "Defenders eliminated");
        else if (this.tick >= r.endsAt) this.endRound(DEF, "Time ran out");
        break;
      case "over":
        if (this.tick < r.endsAt) break;
        if (Math.max(...r.score) >= P.ROUNDS_TO_WIN) {
          r.phase = "matchover";
          r.endsAt = this.tick + ticks(P.MATCH_END_TIME);
          r.winner = r.score[ATK] > r.score[DEF] ? ATK : DEF;
          r.reason = `${P.TEAM_NAMES[r.winner]} win the match`;
        } else this.startRound(false);
        break;
      case "matchover":
        if (this.tick < r.endsAt) break;
        for (const p of this.players.values()) { p.team = 1 - p.team; p.kills = p.deaths = 0; } // swap sides
        this.map = nextMap(this.map);
        r.map = this.map.id;
        this.startRound(true);
        break;
    }
  }

  private dropBomb(p: Player): void {
    const b = this.round.bomb;
    if (b.carrier !== p.id) return;
    b.carrier = null;
    b.pos = { ...p.sim.move.pos };
  }

  /** Bomb pickup, planting and defusing; E has to be held the whole time. */
  private updateBomb(): void {
    const r = this.round, b = r.bomb;
    if (!b.planted && b.carrier === null && b.pos) {
      const taker = this.teamOf(ATK, true).find((p) =>
        flat(p.sim.move.pos, b.pos!) < PICKUP_RANGE && Math.abs(p.sim.move.pos.y - b.pos!.y) < 1.6);
      if (taker) { b.carrier = taker.id; b.pos = null; }
    }
    for (const p of this.players.values()) {
      if (!p.alive || !p.use || r.phase !== "live") { p.act = 0; continue; }
      const site = siteAt(this.map, p.sim.move.pos);
      if (p.team === ATK && b.carrier === p.id && site && p.sim.move.onGround) {
        p.act += TICK;
        if (p.act >= P.PLANT_TIME - 1e-9) {
          p.act = 0;
          r.bomb = { carrier: null, pos: { ...p.sim.move.pos }, planted: true, site };
          r.endsAt = this.tick + ticks(P.BOMB_TIME);
          this.events.push({ type: "planted", by: p.id, site });
          const guard = spotsNear(this.map, p.sim.move.pos, 8);
          for (const o of this.teamOf(ATK)) if (o.bot) o.spot = pick(guard);
        }
      } else if (p.team === DEF && b.planted && b.pos && Math.hypot(p.sim.move.pos.x - b.pos.x,
        p.sim.move.pos.y - b.pos.y, p.sim.move.pos.z - b.pos.z) <= P.DEFUSE_RANGE) {
        p.act += TICK;
        if (p.act >= P.DEFUSE_TIME - 1e-9) {
          p.act = 0;
          this.events.push({ type: "defused", by: p.id });
          this.endRound(DEF, "Bomb defused");
        }
      } else p.act = 0;
    }
  }

  private explode(): void {
    const pos = this.round.bomb.pos!;
    this.events.push({ type: "exploded", pos });
    const R = P.BOMB_KILL_RADIUS;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const d = Math.hypot(p.sim.move.pos.x - pos.x, p.sim.move.pos.y + 1 - pos.y, p.sim.move.pos.z - pos.z);
      const damage = d < R ? 200 : Math.max(0, 200 * (2 * R - d) / R);
      if (damage <= 0) continue;
      p.hp -= Math.round(damage);
      if (p.hp <= 0) this.kill(p, null, false, -1);
    }
  }

  /** Other players as they were at a (fractional) past tick, for lag-compensated hit tests. */
  private posesAt(viewTick: number, shooter: Player) {
    // the newest poses in the history are from the end of the last tick; this one isn't recorded yet
    const t = Math.max(this.tick - MAX_REWIND, Math.min(this.tick - 1, viewTick));
    const a = this.history[Math.floor(t) % HISTORY], b = this.history[Math.ceil(t) % HISTORY];
    const k = t - Math.floor(t);
    const out: { id: number; feet: Vec3; crouched: boolean }[] = [];
    for (const p of this.players.values()) {
      if (p === shooter || !p.alive || p.team === shooter.team) continue; // bullets pass teammates
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
    p.use = cmd.use;
    for (const b of simulate(p.sim, cmd, shotSeed(p.id, cmd.seq), this.map.boxes)) {
      const wall = traceMap(b, this.map.boxes, rangeOf(b.w));
      const hit = traceTargets(b, this.posesAt(viewTick, p), wall.t);
      const t = hit?.t ?? wall.t;
      this.events.push({ type: "shot", id: p.id, w: b.w, o: b.o,
        end: { x: b.o.x + b.d.x * t, y: b.o.y + b.d.y * t, z: b.o.z + b.d.z * t }, ...(b.p ? { p: b.p } : {}) });
      if (hit) this.damage(p, this.players.get(hit.id)!, hit.part, b.w);
    }
  }

  private damage(by: Player, target: Player, part: Part, w: number): void {
    if (!target.alive || target.god) return;
    const damage = Math.round(WEAPONS[w].damage * DAMAGE_SCALE[part]);
    target.hp -= damage;
    this.events.push({ type: "hit", by: by.id, target: target.id, part, damage });
    if (target.hp <= 0) this.kill(target, by, part === "head", w);
  }

  /** by null: the bomb. */
  private kill(target: Player, by: Player | null, head: boolean, w: number): void {
    target.hp = 0;
    target.alive = false;
    target.act = 0;
    target.respawnIn = P.RESPAWN_TIME;
    target.killedBy = by?.id ?? null;
    target.deaths++;
    if (by && by.team !== target.team) by.kills++;
    this.dropBomb(target);
    this.events.push({ type: "kill", killer: by?.id ?? -1, victim: target.id, head, w });
  }

  /** What a bot should be doing for its team right now. */
  private objective(p: Player): Objective {
    const r = this.round, b = r.bomb;
    if (r.phase !== "live" || !p.spot) return NO_OBJECTIVE;
    if (p.team === DEF) {
      return b.planted && b.pos ? { goal: b.pos, use: true, look: null } : { goal: p.spot, use: false, look: MID };
    }
    if (b.carrier === p.id) return { goal: p.spot, use: true, look: null }; // a spot inside the site
    if (!b.planted && b.carrier === null && b.pos) {
      const bombPos = b.pos;
      const fetcher = this.teamOf(ATK, true).filter((o) => o.bot)
        .sort((x, y) => flat(x.sim.move.pos, bombPos) - flat(y.sim.move.pos, bombPos))[0];
      if (fetcher === p) return { goal: bombPos, use: false, look: null };
    }
    return { goal: p.spot, use: false, look: null };
  }

  step(): void {
    this.tick++;
    for (const p of this.players.values()) {
      if (p.bot) {
        const enemies = [...this.players.values()].filter((o) => o.team !== p.team && o.alive)
          .map((o) => ({ id: o.id, feet: o.sim.move.pos, crouched: o.sim.move.crouched }));
        const cmd = p.bot.think(this.map, p.sim.move, p.yaw, p.pitch, gunOf(p.sim).ammo, enemies, this.tick,
          this.objective(p));
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
      if (!p.alive && this.round.phase === "warmup") {
        p.respawnIn -= TICK;
        if (p.respawnIn <= 0) this.spawn(p);
      }
    }
    this.updateBomb();
    this.updateRound();

    const poses = new Map<number, Pose>();
    for (const p of this.players.values())
      poses.set(p.id, { feet: { ...p.sim.move.pos }, crouched: p.sim.move.crouched, alive: p.alive });
    this.history[this.tick % HISTORY] = poses;

    if (this.tick % P.SNAPSHOT_EVERY === 0) this.broadcast();
  }

  private lastRoster = "";
  private lastRound = "";

  private broadcast(): void {
    // Other players are only drawn, so millimetres are plenty; your own state ("you") stays exact,
    // because prediction replays from it and must match the server bit for bit.
    const r = (v: number, k = 1000) => Math.round(v * k) / k;
    const p: P.PlayerTuple[] = [...this.players.values()].map((pl) => [
      pl.id, r(pl.sim.move.pos.x), r(pl.sim.move.pos.y), r(pl.sim.move.pos.z), r(pl.yaw, 1e4), r(pl.pitch, 1e4),
      (pl.alive ? P.ALIVE : 0) | (pl.sim.move.crouched ? P.CROUCHED : 0), pl.hp, pl.sim.slot,
    ]);
    const roster = JSON.stringify([...this.players.values()].map((pl): P.RosterEntry =>
      [pl.id, pl.name, pl.kills, pl.deaths, pl.ping, pl.team, pl.look]));
    const round = JSON.stringify(this.round);
    // Names, scores and the round change rarely: send them when they do, and once a second for anyone who missed it.
    const resend = this.tick % 60 === 0;
    const withRoster = roster !== this.lastRoster || resend, withRound = round !== this.lastRound || resend;
    this.lastRoster = roster;
    this.lastRound = round;
    const events = this.events.map((e) => e.type === "shot"
      ? { ...e, o: { x: r(e.o.x), y: r(e.o.y), z: r(e.o.z) }, end: { x: r(e.end.x), y: r(e.end.y), z: r(e.end.z) } }
      : e);
    this.events = [];
    // The part everyone gets is serialised once per room, not once per player.
    const head = `{"type":"snap","tick":${this.tick},"p":${JSON.stringify(p)},${withRoster ? `"r":${roster},` : ""}` +
      `${withRound ? `"g":${round},` : ""}"events":${JSON.stringify(events)},"you":`;
    for (const pl of this.players.values()) {
      const you: P.You = { lastSeq: pl.lastSeq, sim: pl.sim, hp: pl.hp, alive: pl.alive, respawnIn: pl.respawnIn,
        killedBy: pl.killedBy, act: pl.act / (pl.team === ATK ? P.PLANT_TIME : P.DEFUSE_TIME) };
      pl.send(`${head}${JSON.stringify(you)}}`);
    }
  }
}
