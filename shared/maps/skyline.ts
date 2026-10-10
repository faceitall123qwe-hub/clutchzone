import { arena, type MapDef } from "../map.ts";
import { plan } from "../plan.ts";

/**
 * Skyline, 80 x 80 m. A is an atrium in the very centre of the map with a door on each side; B is the
 * north-east corner. Defenders start north of the atrium, attackers in the south-west corner: up the jogging west street
 * to A's west door, along the south street and up the bent centre lane to A's south door, or all the
 * way east and up the jogging east lane to B (or across to A's east door). Drawn as text: see shared/plan.ts.
 */
const PLAN = [
  "########################################",
  "###.............########################",
  "###.........................############",
  "###................DDDDDD...BBBBBBBBBB##",
  "###..................cc.....BBBBBBBBBB##",
  "###.........................BBBBBBBBBB##",
  "##....#######...############BBBCCBBBBB##",
  "##....#######...############BBBCCBBBBB##",
  "##....#######...############BBBBBBBBBB##",
  "##....#######...........####BBBBBBBccB##",
  "##..........#...........####BBBBBBBBBB##",
  "########....#########...####BBBBBBBBBB##",
  "########....#########...##########....##",
  "##..........#########...##########....##",
  "##...........########...##########.C..##",
  "##.............AwwAAAAAAA#########.C..##",
  "##.............AwwAAAAAAA#########....##",
  "##........#####AAAAAAAAAA#########....##",
  "##........#####AAAwwwwwAA........#....##",
  "##........#####AAAwwwwwAA........#....##",
  "##....#########AAAAAAAAAA........#....##",
  "##....#########AAAAAAAccA#####........##",
  "##....#########AAAAAAAAAA#####........##",
  "##....##########...###########........##",
  "##....##########...###########........##",
  "##........######...###############....##",
  "######....######............######....##",
  "######....######............######....##",
  "##........##############....######....##",
  "##....##################....######....##",
  "##.c..##################....######....##",
  "##.c..##################....######....##",
  "##....##################....######....##",
  "##....................................##",
  "##..........C.........c...............##",
  "##..........C.........c...............##",
  "##.TTTTTT.............................##",
  "##########################............##",
  "##########################............##",
  "########################################",
];

const P = plan(PLAN, {
  "#": { kind: "block", height: 6 },
  w: { kind: "metal", height: 4 },
  C: { kind: "container", height: 2.6, tint: 0xb5462f },
  c: { kind: "crate", height: 1.2 },
});

export const SKYLINE: MapDef = {
  id: "skyline",
  name: "Skyline",
  theme: "snow",
  half: P.half,
  maxFloor: 1.2,
  boxes: [...arena(P.half), ...P.boxes],
  spawns: { attackers: P.attackers, defenders: P.defenders },
  sites: P.sites,
  decor: { windows: [], signs: { A: [0, 2.5, -9, 0], B: [26, 2.5, -33, 0] } },
};
