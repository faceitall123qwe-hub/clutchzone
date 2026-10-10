/**
 * How a map plays out in time: seconds from the end of the freeze until each team can reach each site,
 * and the earliest moment an attacker and a defender running from their spawns could see each other.
 *
 *   node scripts/pacing.ts [map id]
 */
import { traceMap } from "../shared/sim.ts";
import * as C from "../shared/constants.ts";
import type { MapDef, Site } from "../shared/map.ts";
import { MAPS } from "../shared/maps.ts";
import { buildNav, nearestNode, type NavGraph } from "../server/nav.ts";

/** Walking distance from the start nodes to every node (Dijkstra; links are short, so lengths are real). */
function distances(g: NavGraph, starts: number[]): Float64Array {
  const d = new Float64Array(g.nodes.length).fill(Infinity);
  const queue: number[] = [];
  for (const s of starts) { d[s] = 0; queue.push(s); }
  while (queue.length) {
    let bi = 0;
    for (let i = 1; i < queue.length; i++) if (d[queue[i]] < d[queue[bi]]) bi = i;
    const u = queue.splice(bi, 1)[0];
    for (const v of g.links[u]) {
      const a = g.nodes[u], b = g.nodes[v];
      const nd = d[u] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      if (nd < d[v]) { if (d[v] === Infinity) queue.push(v); d[v] = nd; }
    }
  }
  return d;
}

function pacing(map: MapDef): void {
  const g = buildNav(map);
  const from = (spawns: { x: number; z: number }[]) => distances(g, spawns.map((s) => nearestNode(g, { x: s.x, y: 0, z: s.z })));
  const atk = from(map.spawns.attackers), def = from(map.spawns.defenders);
  const sec = (m: number) => (m / C.MAX_SPEED).toFixed(1);
  const siteTime = (d: Float64Array, site: Site) => {
    const r = map.sites[site];
    let best = Infinity;
    g.nodes.forEach((n, i) => { if (n.x >= r.min[0] && n.x <= r.max[0] && n.z >= r.min[1] && n.z <= r.max[1]) best = Math.min(best, d[i]); });
    return sec(best);
  };
  // the earliest both could be at a pair of places that see each other, eye to eye
  let first = Infinity, where = "";
  const order = g.nodes.map((_, i) => i).filter((i) => atk[i] < Infinity).sort((a, b) => atk[a] - atk[b]);
  const dorder = g.nodes.map((_, i) => i).filter((i) => def[i] < Infinity).sort((a, b) => def[a] - def[b]);
  for (const a of order) {
    if (atk[a] >= first) break;
    for (const d of dorder) {
      const t = Math.max(atk[a], def[d]);
      if (t >= first) break;
      const p = g.nodes[a], q = g.nodes[d];
      const o = { x: p.x, y: p.y + C.STAND_EYE, z: p.z }, dir = { x: q.x - p.x, y: q.y - p.y, z: q.z - p.z };
      if (Math.hypot(dir.x, dir.z) > 60) continue;
      if (traceMap({ o, d: dir }, map.boxes, 1).t >= 1) {
        first = t;
        where = `attacker at (${p.x.toFixed(0)}, ${p.z.toFixed(0)}) sees defender at (${q.x.toFixed(0)}, ${q.z.toFixed(0)})`;
      }
    }
  }
  console.log(`${map.name}: attackers reach A in ${siteTime(atk, "A")} s, B in ${siteTime(atk, "B")} s; defenders A ${siteTime(def, "A")} s, B ${siteTime(def, "B")} s; first contact ${sec(first)} s (${where}); ${g.nodes.length} nodes`);
}

for (const m of MAPS) if (!process.argv[2] || m.id === process.argv[2]) pacing(m);
