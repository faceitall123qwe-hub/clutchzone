import type { Kind, MapBox, Rect, Site, Spawn } from "./map.ts";

/**
 * A map drawn as text: one character per 2 × 2 m square, north (the defenders' side) at the top.
 * Solid characters become boxes from the floor up (neighbouring squares of one character are merged
 * into as few boxes as possible); T and D are attacker and defender spawns, A and B the bomb sites;
 * anything else is open floor.
 */
export const CELL = 2;
/** houses: [lowest, highest] — split into buildings of at most 4 × 4 squares, each its own height. */
export type Solid = { kind: Kind; height: number; tint?: number; houses?: [number, number] };
export type Plan = { half: number; boxes: MapBox[]; attackers: Spawn[]; defenders: Spawn[]; sites: Record<Site, Rect> };

const HOUSE = 4;
/** 0..1, the same for a square every time. */
export const hash = (a: number, b: number) => {
  const h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return h - Math.floor(h);
};

export function plan(rows: readonly string[], solids: Record<string, Solid>): Plan {
  const n = rows.length, half = (n * CELL) / 2;
  for (const r of rows) if (r.length !== n) throw new Error(`plan rows must be ${n} wide: "${r}"`);
  const x = (c: number) => -half + c * CELL, z = (r: number) => -half + r * CELL;
  const used = rows.map((r) => [...r].map(() => false));
  const boxes: MapBox[] = [];
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const ch = rows[r][c], s = solids[ch];
      if (!s || used[r][c]) continue;
      // grow east as far as the character goes, then south while whole rows match
      const most = s.houses ? HOUSE : n;
      let w = 1;
      while (c + w < n && w < most && rows[r][c + w] === ch && !used[r][c + w]) w++;
      let h = 1;
      while (r + h < n && h < most && [...Array(w).keys()].every((i) => rows[r + h][c + i] === ch && !used[r + h][c + i])) h++;
      for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) used[r + i][c + j] = true;
      const top = s.houses ? s.houses[0] + Math.round(hash(r, c) * (s.houses[1] - s.houses[0]) * 2) / 2 : s.height;
      boxes.push({ kind: s.kind, min: [x(c), 0, z(r)], max: [x(c + w), top, z(r + h)], ...(s.tint === undefined ? {} : { tint: s.tint }) });
    }
  const cells = (ch: string) => rows.flatMap((row, r) => [...row].flatMap((v, c) => (v === ch ? [[r, c]] : [])));
  const spawns = (ch: string, yaw: number): Spawn[] => cells(ch).map(([r, c]) => ({ x: x(c) + CELL / 2, z: z(r) + CELL / 2, yaw }));
  const site = (ch: string): Rect => {
    const cs = cells(ch);
    if (!cs.length) throw new Error(`plan has no site ${ch}`);
    const rs = cs.map(([r]) => r), csx = cs.map(([, c]) => c);
    return { min: [x(Math.min(...csx)), z(Math.min(...rs))], max: [x(Math.max(...csx) + 1), z(Math.max(...rs) + 1)] };
  };
  return { half, boxes, attackers: spawns("T", 0), defenders: spawns("D", Math.PI), sites: { A: site("A"), B: site("B") } };
}
