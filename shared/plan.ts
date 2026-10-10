import type { Kind, MapBox, Rect, Site, Spawn } from "./map.ts";

/**
 * A map drawn as text: one character per 2 × 2 m square, north (the defenders' side) at the top.
 * Solid characters become boxes from the floor up (neighbouring squares of one character are merged
 * into as few boxes as possible); T and D are attacker and defender spawns, A and B the bomb sites;
 * anything else is open floor.
 */
export const CELL = 2;
export type Solid = { kind: Kind; height: number; tint?: number };
export type Plan = { half: number; boxes: MapBox[]; attackers: Spawn[]; defenders: Spawn[]; sites: Record<Site, Rect> };

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
      let w = 1;
      while (c + w < n && rows[r][c + w] === ch && !used[r][c + w]) w++;
      let h = 1;
      while (r + h < n && [...Array(w).keys()].every((i) => rows[r + h][c + i] === ch && !used[r + h][c + i])) h++;
      for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) used[r + i][c + j] = true;
      boxes.push({ kind: s.kind, min: [x(c), 0, z(r)], max: [x(c + w), s.height, z(r + h)], ...(s.tint === undefined ? {} : { tint: s.tint }) });
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
