import type { Box, Vec3 } from "../shared/collision.ts";
import { blocked, moveAxis } from "../shared/collision.ts";
import * as C from "../shared/constants.ts";
import type { MapDef } from "../shared/map.ts";
import { newPlayer, stepPlayer, type MoveInput } from "../shared/movement.ts";

/** Walkable points on a grid and the links a player can actually walk, for bots to path along. */
export type NavGraph = { nodes: Vec3[]; links: number[][] };

const SPACING = 1.5;

/** Where a player dropped from above (x, z) comes to rest — on stairs that's the step edge it
 * lands on — or null if there's no room to stand. maxFloor: the highest place a player can climb to. */
function groundAt(x: number, z: number, boxes: readonly Box[], maxFloor: number): number | null {
  const p = { x, y: maxFloor + 0.1, z };
  if (blocked(p, C.PLAYER_RADIUS, C.STAND_HEIGHT, boxes)) return null; // inside a wall or under a low roof
  return moveAxis(p, 1, -(maxFloor + 1), C.PLAYER_RADIUS, C.STAND_HEIGHT, boxes) ? p.y : null;
}

/** Walk from a towards b with real movement physics; true if it arrives (handles stairs and steps). */
function walkable(a: Vec3, b: Vec3, boxes: readonly Box[]): boolean {
  const p = newPlayer(a.x, a.y, a.z);
  p.onGround = true;
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  for (let i = 0; i < Math.ceil((dist / C.MAX_SPEED + 0.6) / C.TICK); i++) {
    const cmd: MoveInput = { forward: 1, right: 0, yaw: Math.atan2(-(b.x - p.pos.x), -(b.z - p.pos.z)),
      jump: false, crouch: false, walk: false };
    stepPlayer(p, cmd, C.TICK, boxes);
    // on stairs you can be next to the node while still one step below it
    if (Math.hypot(b.x - p.pos.x, b.z - p.pos.z) < 0.35) return Math.abs(p.pos.y - b.y) <= C.STEP_HEIGHT + 1e-6;
    if (p.pos.y < Math.min(a.y, b.y) - 0.5) return false; // fell off something
  }
  return false;
}

export function buildNav(map: MapDef): NavGraph {
  const boxes = map.boxes;
  const nodes: Vec3[] = [];
  const index = new Map<string, number>();
  const n = Math.floor((map.half - 0.5) / SPACING);
  for (let i = -n; i <= n; i++)
    for (let j = -n; j <= n; j++) {
      const x = i * SPACING, z = j * SPACING;
      const y = groundAt(x, z, boxes, map.maxFloor);
      if (y === null) continue;
      index.set(`${i},${j}`, nodes.length);
      nodes.push({ x, y, z });
    }
  const links: number[][] = nodes.map(() => []);
  for (const [key, a] of index) {
    const [i, j] = key.split(",").map(Number);
    for (const [di, dj] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const b = index.get(`${i + di},${j + dj}`);
      if (b === undefined) continue;
      // walk both ways separately: a ledge can be dropped from but not climbed
      if (walkable(nodes[a], nodes[b], boxes)) links[a].push(b);
      if (walkable(nodes[b], nodes[a], boxes)) links[b].push(a);
    }
  }
  return { nodes, links };
}

export function nearestNode(g: NavGraph, p: Vec3): number {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < g.nodes.length; i++) {
    const q = g.nodes[i];
    const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2 + 4 * (q.y - p.y) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** A* over the grid; returns node indices from start to goal (inclusive) or null. */
export function findPath(g: NavGraph, start: number, goal: number): number[] | null {
  const h = (i: number) => Math.hypot(g.nodes[i].x - g.nodes[goal].x, g.nodes[i].z - g.nodes[goal].z);
  const cost = new Map<number, number>([[start, 0]]);
  const from = new Map<number, number>();
  const open = new Set([start]);
  while (open.size) {
    let cur = -1, best = Infinity;
    for (const i of open) {
      const f = cost.get(i)! + h(i);
      if (f < best) { best = f; cur = i; }
    }
    if (cur === goal) {
      const path = [cur];
      while (from.has(path[0])) path.unshift(from.get(path[0])!);
      return path;
    }
    open.delete(cur);
    for (const nb of g.links[cur]) {
      const c = cost.get(cur)! + Math.hypot(g.nodes[nb].x - g.nodes[cur].x, g.nodes[nb].z - g.nodes[cur].z);
      if (c < (cost.get(nb) ?? Infinity)) {
        cost.set(nb, c);
        from.set(nb, cur);
        open.add(nb);
      }
    }
  }
  return null;
}
