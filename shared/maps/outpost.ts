import { arena, box, stairs, type MapDef } from "../map.ts";

/** The shooting range (and the tests' map), 48 × 48 m. Three lanes: B long (west), mid, A long (east); sites in the north corners. */
export const OUTPOST: MapDef = {
  id: "outpost",
  name: "Outpost",
  theme: "synth",
  half: 24,
  maxFloor: 2.6, // the crate on the A platform
  boxes: [
    ...arena(24),
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
    ...stairs(17, 19, -14.4, 4, -1),
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
  ],
  spawns: {
    attackers: [-6, -3, 0, 3, 6].map((x) => ({ x, z: 22, yaw: 0 })),
    defenders: [-6, -3, 0, 3, 6].map((x) => ({ x, z: -22, yaw: Math.PI })),
  },
  sites: {
    A: { min: [14, -24], max: [24, -12] },
    B: { min: [-24, -24], max: [-14, -10] },
  },
};
