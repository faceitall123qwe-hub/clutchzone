import type { Vec3 } from "../shared/collision.ts";
import { MAX_SPEED, TICK } from "../shared/constants.ts";
import { MAP } from "../shared/map.ts";
import { eyeHeight, type PlayerState } from "../shared/movement.ts";
import { traceMap, type Cmd } from "../shared/sim.ts";
import { buildNav, findPath, nearestNode, type NavGraph } from "./nav.ts";

export const BOT_NAMES = ["Bot Ada", "Bot Bruno", "Bot Cora", "Bot Dex", "Bot Edda", "Bot Finn", "Bot Gus", "Bot Hela"];

let nav: NavGraph | null = null;
let goals: number[] = [];
/** The nav graph is built once per process (~0.5 s) the first time a bot needs it. */
function graph(): NavGraph {
  if (nav) return nav;
  nav = buildNav(MAP);
  // goals only in the biggest connected area, so bots never pick a spot they can't reach
  const seen = new Set<number>(), comps: number[][] = [];
  for (let s = 0; s < nav.nodes.length; s++) {
    if (seen.has(s)) continue;
    const comp = [s], q = [s];
    seen.add(s);
    while (q.length) for (const nb of nav.links[q.shift()!]) if (!seen.has(nb)) { seen.add(nb); comp.push(nb); q.push(nb); }
    comps.push(comp);
  }
  goals = comps.sort((a, b) => b.length - a.length)[0];
  return nav;
}

/** Walkable spots (in the part of the map every other spot can be reached from) inside a rectangle
 * on the ground plan, or within r of a point. */
export function spotsIn(min: readonly number[], max: readonly number[]): Vec3[] {
  const g = graph();
  return goals.map((i) => g.nodes[i]).filter((n) => n.x >= min[0] && n.x <= max[0] && n.z >= min[1] && n.z <= max[1]);
}
export function spotsNear(p: Vec3, r: number): Vec3[] {
  const g = graph();
  return goals.map((i) => g.nodes[i]).filter((n) => Math.hypot(n.x - p.x, n.z - p.z) <= r);
}

export type Seen = { id: number; feet: Vec3; crouched: boolean };
/** What the room wants from a bot: go to goal; once there, hold E if use, face look. */
export type Objective = { goal: Vec3 | null; use: boolean; look: Vec3 | null };
export const NO_OBJECTIVE: Objective = { goal: null, use: false, look: null };

const FOV = (75 * Math.PI) / 180;
const TURN_RATE = 6; // rad/s
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * A deathmatch bot. It only knows what a player could: enemies in its field of view without a wall
 * in between. Its aim starts off target and settles over ~0.4 s, it waits a human-like reaction
 * time before shooting, and it stops to fire short bursts, because moving shots are inaccurate.
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

  think(me: PlayerState, yaw: number, pitch: number, ammo: number, enemies: Seen[], tick: number,
        obj: Objective = NO_OBJECTIVE): Omit<Cmd, "seq"> {
    const eye = { x: me.pos.x, y: me.pos.y + eyeHeight(me), z: me.pos.z };
    if (tick % 3 === 0) this.perceive(eye, yaw, enemies);
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
      const wantYaw = Math.atan2(-dx, -dz) + this.aimError.yaw * Math.exp(-this.targetFor / 0.4);
      const wantPitch = Math.atan2(dy, Math.hypot(dx, dz)) + this.aimError.pitch * Math.exp(-this.targetFor / 0.4);
      cmd.yaw = yaw + Math.max(-turn, Math.min(turn, wrap(wantYaw - yaw)));
      cmd.pitch = pitch + Math.max(-turn, Math.min(turn, wantPitch - pitch));
      const onTarget = Math.abs(wrap(wantYaw - cmd.yaw)) < 0.02 && Math.abs(wantPitch - cmd.pitch) < 0.02;

      this.pause = Math.max(0, this.pause - TICK);
      // a moving rifle sprays everywhere: stop first, like a player counter-strafing
      const still = Math.hypot(me.vel.x, me.vel.z) < MAX_SPEED * 0.3;
      if (this.targetFor >= this.reaction && onTarget && this.pause === 0 && still) {
        cmd.fire = true;
        if (++this.burst >= 18 + Math.floor(this.rand() * 12)) { // 3-5 shots at 10 per second
          this.burst = 0;
          this.pause = 0.25 + this.rand() * 0.2;
        }
      } else if (this.pause > 0) {
        cmd.right = Math.sin(tick / 20) > 0 ? 1 : -1; // strafe between bursts
      }
      if (ammo === 0) cmd.reload = true;
      return cmd;
    }

    const g = graph();
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

  private perceive(eye: Vec3, yaw: number, enemies: Seen[]): void {
    let best: Seen | null = null, bestD = Infinity;
    for (const e of enemies) {
      const dx = e.feet.x - eye.x, dz = e.feet.z - eye.z;
      const d = Math.hypot(dx, dz);
      if (d > 55) continue;
      const angle = Math.abs(wrap(Math.atan2(-dx, -dz) - yaw));
      if (angle > FOV && d > 3) continue; // behind us, unless they're right next to us
      const chestY = e.feet.y + (e.crouched ? 0.8 : 1.2);
      const dir = { x: dx, y: chestY - eye.y, z: dz };
      if (traceMap({ o: eye, d: dir }, MAP, 1).t < 1) continue; // a wall in the way (t is in units of dir)
      if (d < bestD) { bestD = d; best = e; }
    }
    const id = best?.id ?? null;
    if (id !== this.target) {
      this.target = id;
      this.targetFor = 0;
      this.reaction = 0.3 + this.rand() * 0.15;
      this.aimError = { yaw: (this.rand() - 0.5) * 0.25, pitch: (this.rand() - 0.5) * 0.12 };
      this.head = this.rand() < 0.25;
      this.burst = 0;
    }
  }
}
