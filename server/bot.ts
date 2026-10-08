import type { Vec3 } from "../shared/collision.ts";
import { MAX_SPEED, TICK } from "../shared/constants.ts";
import type { MapDef, Rect } from "../shared/map.ts";
import { eyeHeight, type PlayerState } from "../shared/movement.ts";
import { traceMap, type Cmd } from "../shared/sim.ts";
import { buildNav, findPath, nearestNode, type NavGraph } from "./nav.ts";

export const BOT_NAMES = ["Bot Ada", "Bot Bruno", "Bot Cora", "Bot Dex", "Bot Edda", "Bot Finn", "Bot Gus", "Bot Hela"];

type Nav = NavGraph & { goals: number[] };
const navs = new Map<string, Nav>();
/** A map's nav graph is built once per process (~0.5 s) the first time a bot needs it. */
export function graphOf(map: MapDef): Nav {
  let nav = navs.get(map.id);
  if (nav) return nav;
  const g = buildNav(map);
  // goals only in the biggest connected area, so bots never pick a spot they can't reach
  const seen = new Set<number>(), comps: number[][] = [];
  for (let s = 0; s < g.nodes.length; s++) {
    if (seen.has(s)) continue;
    const comp = [s], q = [s];
    seen.add(s);
    while (q.length) for (const nb of g.links[q.shift()!]) if (!seen.has(nb)) { seen.add(nb); comp.push(nb); q.push(nb); }
    comps.push(comp);
  }
  nav = { ...g, goals: comps.sort((a, b) => b.length - a.length)[0] };
  navs.set(map.id, nav);
  return nav;
}

/** Walkable spots (in the part of the map every other spot can be reached from) inside a rectangle
 * on the ground plan, at least margin metres from its edges, or within r of a point. */
export function spotsIn(map: MapDef, r: Rect, margin = 0): Vec3[] {
  const g = graphOf(map);
  return g.goals.map((i) => g.nodes[i]).filter((n) => n.x >= r.min[0] + margin && n.x <= r.max[0] - margin &&
    n.z >= r.min[1] + margin && n.z <= r.max[1] - margin);
}
export function spotsNear(map: MapDef, p: Vec3, r: number): Vec3[] {
  const g = graphOf(map);
  return g.goals.map((i) => g.nodes[i]).filter((n) => Math.hypot(n.x - p.x, n.z - p.z) <= r);
}

export type Seen = { id: number; feet: Vec3; crouched: boolean };
/** What the room wants from a bot: go to goal; once there, hold E if use, face look. */
export type Objective = { goal: Vec3 | null; use: boolean; look: Vec3 | null };
export const NO_OBJECTIVE: Objective = { goal: null, use: false, look: null };

// Bots are deliberately easy (Tim: "very easy"): a newcomer should win fights and want another match.
const FOV = (55 * Math.PI) / 180; // narrow: easy to flank
const SIGHT = 35; // metres
const TURN_RATE = 6; // rad/s, walking: slower and the bot circles its waypoints instead of reaching them
const AIM_RATE = 3.5; // rad/s, swinging onto a target
const REACTION: [number, number] = [1, 1.5]; // seconds before the first shot
const SETTLE = 1; // seconds for the first aim error to fade
const WOBBLE = 0.045; // rad of aim that never settles: misses at range, hits up close
const HEAD_CHANCE = 0.05;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * A bot. It only knows what a player could: enemies in its field of view without a wall in between.
 * Its aim starts well off target, settles slowly and keeps wobbling; it waits about a second before
 * shooting and stops to fire short bursts, because moving shots are inaccurate.
 */
export class BotBrain {
  private path: number[] = [];
  private stuckFor = 0;
  private lastPos: Vec3 | null = null;
  private target: number | null = null;
  private targetFor = 0;
  private reaction = 0;
  private aimError = { yaw: 0, pitch: 0 };
  private burst = 0;
  private pause = 0;
  private lastSeen: Vec3 | null = null;
  private lastSeenTick = -1e9;
  private chasing = false;
  private jump = false;
  private head = false;
  private readonly phase = Math.random() * 10;
  private pathGoal: Vec3 | null = null;
  private readonly rand: () => number;

  constructor(rand: () => number = Math.random) {
    this.rand = rand;
  }

  /** Forget the last round: route, target, where enemies were last seen. */
  reset(): void {
    this.path = [];
    this.pathGoal = null;
    this.target = null;
    this.lastSeen = null;
    this.chasing = false;
    this.stuckFor = 0;
  }

  think(map: MapDef, me: PlayerState, yaw: number, pitch: number, ammo: number, enemies: Seen[], tick: number,
        obj: Objective = NO_OBJECTIVE): Omit<Cmd, "seq"> {
    const eye = { x: me.pos.x, y: me.pos.y + eyeHeight(me), z: me.pos.z };
    if (tick % 3 === 0) this.perceive(map, eye, yaw, enemies);
    const target = enemies.find((e) => e.id === this.target);
    const cmd: Omit<Cmd, "seq"> = { forward: 0, right: 0, yaw, pitch, jump: false, crouch: false, walk: false,
      fire: false, reload: false, slot: 0, aim: false, use: false };
    const turn = TURN_RATE * TICK;
    const face = (x: number, z: number) => {
      const want = Math.atan2(-(x - me.pos.x), -(z - me.pos.z));
      cmd.yaw = yaw + Math.max(-turn, Math.min(turn, wrap(want - yaw)));
      return Math.abs(wrap(want - cmd.yaw));
    };

    if (target) {
      this.targetFor += TICK;
      this.lastSeen = { ...target.feet };
      this.lastSeenTick = tick;
      this.chasing = false;
      const aimY = target.feet.y + (target.crouched ? 0.8 : this.head ? 1.6 : 1.2);
      const dx = target.feet.x - eye.x, dz = target.feet.z - eye.z, dy = aimY - eye.y;
      const settle = Math.exp(-this.targetFor / SETTLE), t = tick * TICK;
      const wantYaw = Math.atan2(-dx, -dz) + this.aimError.yaw * settle + WOBBLE * Math.sin(t * 2.3 + this.phase);
      const wantPitch = Math.atan2(dy, Math.hypot(dx, dz)) + this.aimError.pitch * settle + WOBBLE * 0.6 * Math.sin(t * 3.1);
      const aim = AIM_RATE * TICK;
      cmd.yaw = yaw + Math.max(-aim, Math.min(aim, wrap(wantYaw - yaw)));
      cmd.pitch = pitch + Math.max(-aim, Math.min(aim, wantPitch - pitch));
      const onTarget = Math.abs(wrap(wantYaw - cmd.yaw)) < 0.02 && Math.abs(wantPitch - cmd.pitch) < 0.02;

      this.pause = Math.max(0, this.pause - TICK);
      // a moving rifle sprays everywhere: stop first, like a player counter-strafing
      const still = Math.hypot(me.vel.x, me.vel.z) < MAX_SPEED * 0.3;
      if (this.targetFor >= this.reaction && onTarget && this.pause === 0 && still) {
        cmd.fire = true;
        if (++this.burst >= 10 + Math.floor(this.rand() * 9)) { // 2-3 shots at 10 per second
          this.burst = 0;
          this.pause = 0.8 + this.rand() * 0.5;
        }
      } else if (this.pause > 0) {
        cmd.right = Math.sin(tick / 20) > 0 ? 1 : -1; // strafe between bursts
      }
      if (ammo === 0) cmd.reload = true;
      return cmd;
    }

    const g = graphOf(map);
    const goals = g.goals;
    // an enemy just ducked out of sight: go after them for a moment before getting back to the job
    const recent = this.lastSeen !== null && tick - this.lastSeenTick < 150;
    if (recent && !this.chasing) {
      this.path = findPath(g, nearestNode(g, me.pos), nearestNode(g, this.lastSeen!)) ?? [];
      this.pathGoal = null;
      this.chasing = true;
    } else if (!recent && this.chasing) {
      this.chasing = false;
      this.path = [];
    }
    if (obj.goal && !recent) {
      const d = Math.hypot(obj.goal.x - me.pos.x, obj.goal.z - me.pos.z);
      if (d < 0.6) { // there: hold, plant or defuse
        this.path = [];
        if (obj.look) face(obj.look.x, obj.look.z);
        cmd.pitch = pitch * 0.9;
        cmd.use = obj.use;
        cmd.reload = ammo < 10;
        return cmd;
      }
      if (d < 2) { // the last stretch, straight and slowing down
        cmd.forward = face(obj.goal.x, obj.goal.z) < 1.2 ? 1 : 0;
        cmd.walk = d < 1.2;
        cmd.pitch = pitch * 0.9;
        return cmd;
      }
      if (!this.path.length || !this.pathGoal || Math.hypot(this.pathGoal.x - obj.goal.x, this.pathGoal.z - obj.goal.z) > 1.5) {
        this.path = findPath(g, nearestNode(g, me.pos), nearestNode(g, obj.goal)) ?? [];
        this.pathGoal = { ...obj.goal };
      }
    }
    // nothing to do and nobody to chase: roam
    if (!this.path.length && !obj.goal && !recent) {
      const goal = goals[Math.floor(this.rand() * goals.length)];
      this.path = findPath(g, nearestNode(g, me.pos), goal) ?? [];
    }
    while (this.path.length && Math.hypot(g.nodes[this.path[0]].x - me.pos.x, g.nodes[this.path[0]].z - me.pos.z) < 0.7)
      this.path.shift();
    const next = this.path[0];
    if (next !== undefined) {
      const n = g.nodes[next];
      cmd.pitch = pitch * 0.9;
      cmd.forward = face(n.x, n.z) < 1.2 ? 1 : 0; // turn first on sharp corners
    }
    if (ammo < 10 && !target) cmd.reload = true;

    // stuck on something: hop and pick a new route
    this.stuckFor += TICK;
    if (this.stuckFor > 1.2) {
      if (this.lastPos && Math.hypot(me.pos.x - this.lastPos.x, me.pos.z - this.lastPos.z) < 0.5) {
        this.jump = true;
        this.path = [];
      }
      this.lastPos = { ...me.pos };
      this.stuckFor = 0;
    }
    cmd.jump = this.jump;
    this.jump = false;
    return cmd;
  }

  private perceive(map: MapDef, eye: Vec3, yaw: number, enemies: Seen[]): void {
    let best: Seen | null = null, bestD = Infinity;
    for (const e of enemies) {
      const dx = e.feet.x - eye.x, dz = e.feet.z - eye.z;
      const d = Math.hypot(dx, dz);
      if (d > SIGHT) continue;
      const angle = Math.abs(wrap(Math.atan2(-dx, -dz) - yaw));
      if (angle > FOV && d > 3) continue; // behind us, unless they're right next to us
      const chestY = e.feet.y + (e.crouched ? 0.8 : 1.2);
      const dir = { x: dx, y: chestY - eye.y, z: dz };
      if (traceMap({ o: eye, d: dir }, map.boxes, 1).t < 1) continue; // a wall in the way (t is in units of dir)
      if (d < bestD) { bestD = d; best = e; }
    }
    const id = best?.id ?? null;
    if (id !== this.target) {
      this.target = id;
      this.targetFor = 0;
      this.reaction = REACTION[0] + this.rand() * (REACTION[1] - REACTION[0]);
      this.aimError = { yaw: (this.rand() - 0.5) * 0.6, pitch: (this.rand() - 0.5) * 0.24 };
      this.head = this.rand() < HEAD_CHANCE;
      this.burst = 0;
    }
  }
}
