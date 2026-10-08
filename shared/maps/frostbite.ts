import { arena, box, stairs, type MapDef } from "../map.ts";

const H = Math.PI / 2;
const LOG = 0x7a5a3a, BARK = 0x5a4030, FENCE = 0x8a6a48, PLANK = 0x9a7650;

const TREES = [[-8, 21], [9, 22], [-22, 13], [23, 12], [-10, -5], [10, -7], [-16, 1], [16, -1], [-5, 13], [6, 13],
  [24, -9], [-24, 20], [20, 20]] as const;

const CABINS = [[-18, -12, 8, 13], [12, 18, 5, 10], [-11, -6, -19, -14], [6, 11, -19, -14]] as const;

/** One small window in the middle of each wall of a cabin. */
const cabinWindows = ([x1, x2, z1, z2]: readonly number[]) => [
  [(x1 + x2) / 2, 2.2, z1 - 0.01, Math.PI], [(x1 + x2) / 2, 2.2, z2 + 0.01, 0],
  [x1 - 0.01, 2.2, (z1 + z2) / 2, -H], [x2 + 0.01, 2.2, (z1 + z2) / 2, H],
] as const;

/**
 * Snowed-in village, 52 × 52 m. The church in the middle blocks the long sightlines; cabins and pines
 * give cover in the lanes. B is the sawmill (west) with log piles, A the market square (east) with a
 * stage. Fences are 1 m: you can jump them.
 */
export const FROSTBITE: MapDef = {
  id: "frostbite",
  name: "Frostbite",
  theme: "snow",
  half: 26,
  maxFloor: 2, // the stage is 1.2 m; crates you'd need a crouch-jump for are off the bots' grid
  boxes: [
    ...arena(26),
    // the church and its tower
    box("block", -4, 0, -6, 4, 7, 4),
    box("block", -2, 7, -6, 2, 12, -2),
    // churchyard wall with a gate, between the church and the defenders
    box("wall", -10, 0, -12, -1.5, 2.2, -11.4),
    box("wall", 1.5, 0, -12, 10, 2.2, -11.4),
    // cabins
    ...CABINS.map(([x1, x2, z1, z2]) => box("block", x1, 0, z1, x2, 4, z2)),
    // fences
    box("wood", -12, 0, 17, -6, 1, 17.2, FENCE),
    box("wood", 6, 0, 16, 12, 1, 16.2, FENCE),
    box("wood", -26, 0, -2, -19, 1, -1.8, FENCE),
    box("wood", 19, 0, 0, 26, 1, 0.2, FENCE),
    // low stone walls in the lanes
    box("wall", -23, 0, 3, -21, 2.2, 8),
    box("wall", 21, 0, -7, 23, 2.2, -2),
    // B: the sawmill
    box("block", -19, 0, -26, -13, 4, -21),
    box("wood", -25, 0, -20, -21, 1.6, -17.5, LOG),
    box("wood", -24.5, 0, -14, -22, 1, -11, LOG),
    box("crate", -17, 0, -15, -15.5, 1.5, -13.5),
    box("crate", -16, 0, -19, -14.5, 1, -17.5),
    // A: the market square, a stage with stairs and a well
    box("wood", 18, 0, -26, 26, 1.2, -21, PLANK),
    ...stairs(20, 22, -19.4, 4, -1),
    box("wall", 15, 0, -15, 16.6, 1, -13.4),
    box("crate", 21, 0, -14, 22.5, 1.2, -12.5),
    box("crate", 14, 0, -22, 15.5, 2, -20.5),
    // spawns
    box("crate", -3, 0, 18, -1.5, 1, 19.5),
    box("crate", 2, 0, 18.5, 3.5, 1.5, 20),
    box("crate", -1.5, 0, -20, 1.5, 1, -18.5),
    // pine trunks; the branches are decor and don't stop bullets
    ...TREES.map(([x, z]) => box("wood", x - 0.25, 0, z - 0.25, x + 0.25, 3, z + 0.25, BARK)),
  ],
  spawns: {
    attackers: [-6, -3, 0, 3, 6].map((x) => ({ x, z: 23, yaw: 0 })),
    defenders: [-6, -3, 0, 3, 6].map((x) => ({ x, z: -23, yaw: Math.PI })),
  },
  sites: {
    A: { min: [13, -26], max: [26, -10] },
    B: { min: [-26, -26], max: [-13, -10] },
  },
  decor: {
    windows: [...CABINS.flatMap(cabinWindows), [0, 4, 4.01, 0], [-4.01, 4, -1, -H], [4.01, 4, -1, H]],
    signs: { A: [22, 3.4, -25.98, 0], B: [-16, 2.6, -20.98, 0] },
    trees: [...TREES],
  },
};
