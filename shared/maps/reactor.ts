import { arena, type MapDef } from "../map.ts";
import { plan } from "../plan.ts";

/**
 * Reactor, 80 x 80 m. A is the reactor hall in the north centre (the reactor stands in the middle of it),
 * B a yard in the west half. Attackers start in the south-east: up the jogging east lane to A's east door,
 * through the centre lane to the crossroads south of A (and on to either site), or along the south
 * street to B's south door. Drawn as text: see shared/plan.ts.
 */
const PLAN = [
  "########################################",
  "##..........############################",
  "##..............########################",
  "##..DDDDD.......AAAAAAAAAA##############",
  "##..............AAAAAAAccA##############",
  "##..........####AAAAAAAAAA........######",
  "##....##########AAAwwwAAAA........######",
  "##....##########AAAwwwAAAA........######",
  "##....##########AAAAAAAAAA####....######",
  "##....##########AccAAAAAAA####....######",
  "##....##########AAAAAAAAAA####ww..######",
  "##....##########AAAAAAAAAA####ww..######",
  "##....################...#####ww..######",
  "##....################...#####....######",
  "##....################...#####....######",
  "##....################...#####....######",
  "##....########...........#####........##",
  "##....#####..............#########....##",
  "##BBBBBBBBB.......www....#########....##",
  "##BBBBBBBBB###....www....#########....##",
  "##BBBBCCBBB###....www....#########....##",
  "##BBBBCCBBB###...........#########....##",
  "##BBBBBBBBB###...........#########....##",
  "##BBcBBBBBB###...#################....##",
  "##BBcBBBBBB###...#################....##",
  "##BBBBBBBBB###...#############........##",
  "##........####........########........##",
  "######....####........########........##",
  "######....####........########........##",
  "##........########....############....##",
  "##....############....############....##",
  "##..cc############....############....##",
  "##....############....############....##",
  "##....############....############....##",
  "##....................................##",
  "##..........C.........C...............##",
  "##..........C.........C......TTTTTT...##",
  "##....................................##",
  "##########################...........###",
  "########################################",
];

const P = plan(PLAN, {
  "#": { kind: "block", height: 6 },
  w: { kind: "metal", height: 4 },
  C: { kind: "container", height: 2.6, tint: 0x3f7d4a },
  c: { kind: "crate", height: 1.2 },
});

export const REACTOR: MapDef = {
  id: "reactor",
  name: "Reactor",
  theme: "toxic",
  half: P.half,
  maxFloor: 1.2,
  boxes: [...arena(P.half), ...P.boxes],
  spawns: { attackers: P.attackers, defenders: P.defenders },
  sites: P.sites,
};
