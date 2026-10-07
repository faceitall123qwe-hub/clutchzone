export type Vec3 = { x: number; y: number; z: number };
export type Box = { min: [number, number, number]; max: [number, number, number] };

const EPS = 1e-6;

/** Does a player-sized box (feet at p, given radius and height) overlap a static box? */
export function overlaps(p: Vec3, radius: number, height: number, b: Box): boolean {
  return (
    p.x + radius > b.min[0] + EPS && p.x - radius < b.max[0] - EPS &&
    p.y + height > b.min[1] + EPS && p.y < b.max[1] - EPS &&
    p.z + radius > b.min[2] + EPS && p.z - radius < b.max[2] - EPS
  );
}

export function blocked(p: Vec3, radius: number, height: number, boxes: readonly Box[]): boolean {
  for (const b of boxes) if (overlaps(p, radius, height, b)) return true;
  return false;
}

const AXES = ["x", "y", "z"] as const;

/**
 * Moves p along one axis and pushes it back out of anything it ends up inside.
 * Returns true when it hit something. Per-tick movement is far smaller than any wall, so a
 * single step can't tunnel through geometry.
 */
export function moveAxis(p: Vec3, axis: 0 | 1 | 2, delta: number, radius: number, height: number,
                         boxes: readonly Box[]): boolean {
  if (delta === 0) return false;
  const k = AXES[axis];
  p[k] += delta;
  let hit = false;
  for (const b of boxes) {
    if (!overlaps(p, radius, height, b)) continue;
    hit = true;
    if (axis === 1) p.y = delta > 0 ? b.min[1] - height : b.max[1];
    else p[k] = delta > 0 ? b.min[axis] - radius : b.max[axis] + radius;
  }
  return hit;
}

export type RayHit = { t: number; normal: [number, number, number] };

/** Slab test. dir need not be normalised; t is in units of dir. */
export function rayBox(o: Vec3, d: Vec3, b: Box, maxT = Infinity): RayHit | null {
  let tmin = 0, tmax = maxT, axisHit = -1, sign = 0;
  const os = [o.x, o.y, o.z], ds = [d.x, d.y, d.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ds[i]) < 1e-12) {
      if (os[i] < b.min[i] || os[i] > b.max[i]) return null;
      continue;
    }
    const inv = 1 / ds[i];
    let t1 = (b.min[i] - os[i]) * inv, t2 = (b.max[i] - os[i]) * inv;
    let s = -1;
    if (t1 > t2) { [t1, t2] = [t2, t1]; s = 1; }
    if (t1 > tmin) { tmin = t1; axisHit = i; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (axisHit < 0) return null; // ray starts inside the box
  const normal: [number, number, number] = [0, 0, 0];
  normal[axisHit] = sign;
  return { t: tmin, normal };
}
