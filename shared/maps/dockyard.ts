import { arena, box, stairs, type MapBox, type MapDef } from "../map.ts";

const H = Math.PI / 2;
const RED = 0xb5462f, BLUE = 0x2f6fa8, GREEN = 0x3f7d4a, ORANGE = 0xd9822b, YELLOW = 0xd8b33a;

/** A shipping container, 6 × 2.4 × 2.6 m, from its corner (x, z) along x or along z. */
const container = (x: number, z: number, along: "x" | "z", tint: number): MapBox =>
  along === "x" ? box("container", x, 0, z, x + 6, 2.6, z + 2.4, tint) : box("container", x, 0, z, x + 2.4, 2.6, z + 6, tint);

/** Windows high up along both long walls of a block, every few metres. */
const windows = (x1: number, x2: number, z1: number, z2: number, y: number, xs: number[], zs: number[]) => [
  ...zs.flatMap((z) => [[x1 - 0.01, y, z, -H], [x2 + 0.01, y, z, H]] as const),
  ...xs.flatMap((x) => [[x, y, z1 - 0.01, Math.PI], [x, y, z2 + 0.01, 0]] as const),
];

/**
 * Harbour, 56 × 56 m. Two warehouses split the map into the B lane (west), a container alley (mid)
 * and A long (east). B is inside a roofed warehouse with a south and an east door; A is an open yard
 * with a loading dock and a container stack you can climb from the crates beside it.
 */
export const DOCKYARD: MapDef = {
  id: "dockyard",
  name: "Dockyard",
  theme: "harbor",
  half: 28,
  maxFloor: 2.7, // the climbable container at A
  boxes: [
    ...arena(28),
    // the warehouses splitting the lanes
    box("block", -16, 0, -4, -5, 7, 12),
    box("block", 5, 0, -4, 16, 7, 12),
    // mid: a container alley, a container across its north end with a gap on each side
    container(-4.2, 3, "z", RED),
    container(1.6, -2, "z", BLUE),
    box("crate", -1, 0, 13, 1, 1.2, 15),
    container(-3, -10, "x", YELLOW),
    // the yard between the warehouses and the north
    container(-12, -8.6, "x", GREEN),
    container(6, -8.6, "x", ORANGE),
    // the harbour office in front of the defenders' spawn
    box("block", -7, 0, -20, 7, 4.5, -14),
    // A: loading dock with stairs, containers, a stack to climb at its south edge
    box("block", 19, 0, -28, 28, 1.2, -19),
    ...stairs(21, 23, -17.4, 4, -1),
    box("crate", 24, 1.2, -25, 25.5, 2.4, -23.5),
    container(13.6, -22, "z", GREEN),
    box("crate", 18, 0, -14, 19.5, 1, -12.5),
    box("crate", 19.5, 0, -14, 21, 1.9, -12.5),
    container(21, -14.4, "x", ORANGE),
    // A long
    container(18, 4, "z", BLUE),
    container(23, -6, "z", RED),
    box("crate", 20, 0, 16, 21.5, 1.2, 17.5),
    // B: a roofed warehouse, doors in its south and east walls
    box("wall", -28, 0, -12, -22, 5, -11),
    box("wall", -19, 0, -12, -13, 5, -11),
    box("wall", -14, 0, -28, -13, 5, -20),
    box("wall", -14, 0, -17, -13, 5, -12),
    box("block", -28, 5, -28, -13, 5.4, -11),
    container(-25, -25, "z", BLUE),
    box("crate", -19, 0, -24, -17.5, 1.2, -22.5),
    box("crate", -17.5, 0, -24, -16, 2, -22.5),
    box("metal", -21, 0, -15.5, -19.5, 2.2, -14),
    // B lane
    container(-26, 2, "z", YELLOW),
    container(-20.4, -6, "z", GREEN),
    box("crate", -22, 0, 15, -20.5, 1.2, 16.5),
    // the attackers' spawn
    container(-12, 17.6, "x", RED),
    container(6, 17.6, "x", BLUE),
  ],
  spawns: {
    attackers: [-6, -3, 0, 3, 6].map((x) => ({ x, z: 25, yaw: 0 })),
    defenders: [-6, -3, 0, 3, 6].map((x) => ({ x, z: -25, yaw: Math.PI })),
  },
  sites: {
    A: { min: [13, -28], max: [28, -11] },
    B: { min: [-28, -28], max: [-14, -12] },
  },
  decor: {
    windows: [
      ...windows(-16, -5, -4, 12, 4.6, [-13, -8], [0, 4, 8]),
      ...windows(5, 16, -4, 12, 4.6, [8, 13], [0, 4, 8]),
      ...windows(-7, 7, -20, -14, 2.7, [-4, 0, 4], []),
    ],
    signs: { A: [23.5, 3.8, -27.98, 0], B: [-20, 3, -27.98, 0] },
  },
};
