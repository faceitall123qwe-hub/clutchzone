import type { Box } from "./collision.ts";

export type Kind = "floor" | "wall" | "block" | "crate" | "metal" | "step";
export type MapBox = Box & { kind: Kind };

const box = (kind: Kind, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): MapBox => ({
  kind,
  min: [Math.min(x1, x2), Math.min(y1, y2), Math.min(z1, z2)],
  max: [Math.max(x1, x2), Math.max(y1, y2), Math.max(z1, z2)],
});

// "Outpost" blockout, 48 × 48 m. North (-Z) is the defenders' side with sites A (east) and B (west),
// south (+Z) is the attackers' spawn. Three lanes: B long (west), mid, A long (east).
const STAIRS: MapBox[] = [0.3, 0.6, 0.9, 1.2].map((h, i) =>
  box("step", 17, 0, -14.4 - i * 0.4 - 0.4, 19, h, -14.4 - i * 0.4));

export const MAP: MapBox[] = [
  box("floor", -25, -1, -25, 25, 0, 25),
  // outer walls
  box("wall", -25, 0, -25, 25, 6, -24),
  box("wall", -25, 0, 24, 25, 6, 25),
  box("wall", -25, 0, -24, -24, 6, 24),
  box("wall", 24, 0, -24, 25, 6, 24),
  // two buildings splitting the lanes, joined by the mid doors
  box("block", -14, 0, -8, -5, 5, 8),
  box("block", 5, 0, -8, 14, 5, 8),
  box("wall", -5, 0, -8, -1.2, 4, -7),
  box("wall", 1.2, 0, -8, 5, 4, -7),
  box("wall", -4, 0, -16, 4, 3, -15), // blocks the spawn-to-spawn sightline through the doors
  // mid
  box("crate", -1, 0, 2, 1, 1, 4),
  box("crate", 1.5, 0, 10, 3, 2, 11.5),
  box("wall", -4, 0, 14, 0, 1, 15),
  // A site: raised platform with stairs, crates
  box("block", 16, 0, -22, 23, 1.5, -16),
  ...STAIRS,
  box("crate", 20, 1.5, -21, 21.5, 2.5, -19.5),
  box("crate", 15, 0, -12, 16.5, 2, -10.5),
  box("wall", 16, 0, 4, 22, 3, 5),
  // B site
  box("crate", -21, 0, -20, -19, 1, -18),
  box("crate", -19, 0, -20, -17.5, 2, -18.5),
  box("crate", -16, 0, -14, -14.5, 1, -12.5),
  box("metal", -20, 0, -13, -19, 4, -12),
  box("crate", -22, 0, 2, -20.5, 1, 3.5),
  // spawns
  box("crate", -6, 0, 19, -4.5, 1, 20.5),
  box("crate", 4.5, 0, 19, 6, 1, 20.5),
  box("metal", -2, 0, -20, 2, 1, -18.5),
];

export const SPAWNS = {
  attackers: [-6, -3, 0, 3, 6].map((x) => ({ x, z: 22, yaw: 0 })),
  defenders: [-6, -3, 0, 3, 6].map((x) => ({ x, z: -22, yaw: Math.PI })),
};

/** Bomb sites on the ground plan (x, z): the bomb can be planted anywhere inside. */
export const SITES = {
  A: { min: [14, -24], max: [24, -12] },
  B: { min: [-24, -24], max: [-14, -10] },
} as const;
export type Site = keyof typeof SITES;

export function siteAt(p: { x: number; z: number }): Site | null {
  for (const k of ["A", "B"] as Site[]) {
    const s = SITES[k];
    if (p.x >= s.min[0] && p.x <= s.max[0] && p.z >= s.min[1] && p.z <= s.max[1]) return k;
  }
  return null;
}
