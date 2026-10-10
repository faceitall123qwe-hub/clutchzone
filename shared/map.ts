import type { Box } from "./collision.ts";

/** What a box is made of: decides its texture and how bullets look when they hit it. */
export type Kind = "floor" | "wall" | "block" | "crate" | "metal" | "step" | "container" | "wood";
/** tint: multiplies the texture colour (containers in different paints). */
export type MapBox = Box & { kind: Kind; tint?: number };
export type Spawn = { x: number; z: number; yaw: number };
export type Rect = { min: readonly [number, number]; max: readonly [number, number] }; // ground plan x, z
export type Site = "A" | "B";
/** Sets the textures of floor, walls and buildings, the sky and the light. */
export type Theme = "desert" | "harbor" | "snow";
type Placed = readonly [x: number, y: number, z: number, rotY: number];

/**
 * A map is plain data: the server collides and shoots against `boxes`, the client draws them.
 * North (-Z) is the defenders' side, south (+Z) the attackers'. Walls stand at ±half.
 */
export type MapDef = {
  id: string;
  name: string;
  theme: Theme;
  half: number;
  maxFloor: number; // the highest place a player can climb to, for the bots' walking grid
  boxes: MapBox[];
  spawns: { attackers: Spawn[]; defenders: Spawn[] };
  sites: Record<Site, Rect>;
  decor: {
    windows: Placed[]; // visual only, on building walls
    signs: Record<Site, Placed>; // the painted site letters
    trees?: (readonly [x: number, z: number])[]; // foliage only: give each trunk a box of its own
  };
};

export const box = (kind: Kind, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number,
                    tint?: number): MapBox => ({
  kind,
  min: [Math.min(x1, x2), Math.min(y1, y2), Math.min(z1, z2)],
  max: [Math.max(x1, x2), Math.max(y1, y2), Math.max(z1, z2)],
  ...(tint === undefined ? {} : { tint }),
});

/** Floor plus four outer walls, 6 m high, enclosing ±half. */
export const arena = (half: number): MapBox[] => [
  box("floor", -half - 1, -1, -half - 1, half + 1, 0, half + 1),
  box("wall", -half - 1, 0, -half - 1, half + 1, 6, -half),
  box("wall", -half - 1, 0, half, half + 1, 6, half + 1),
  box("wall", -half - 1, 0, -half, -half, 6, half),
  box("wall", half, 0, -half, half + 1, 6, half),
];

/** Stairs of n steps of 0.3 m from (x1..x2) at z going towards -z (dir -1) or +z (dir 1). */
export const stairs = (x1: number, x2: number, z: number, n: number, dir: -1 | 1, y0 = 0): MapBox[] =>
  Array.from({ length: n }, (_, i) => box("step", x1, y0, z + dir * i * 0.4, x2, y0 + 0.3 * (i + 1), z + dir * (i + 1) * 0.4));

export function siteAt(map: MapDef, p: { x: number; z: number }): Site | null {
  for (const k of ["A", "B"] as Site[]) {
    const s = map.sites[k];
    if (p.x >= s.min[0] && p.x <= s.max[0] && p.z >= s.min[1] && p.z <= s.max[1]) return k;
  }
  return null;
}
