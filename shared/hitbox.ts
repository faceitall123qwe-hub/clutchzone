import { rayBox, type Box, type Vec3 } from "./collision.ts";
import * as C from "./constants.ts";

export type Part = "head" | "body" | "legs";
export const DAMAGE_SCALE: Record<Part, number> = { head: 4, body: 1, legs: 0.75 };

/** Three stacked boxes from the feet up; head is narrower than the body. */
export function hitboxes(feet: Vec3, crouched: boolean): { part: Part; box: Box }[] {
  const h = crouched ? C.CROUCH_HEIGHT : C.STAND_HEIGHT;
  const headSize = 0.28, r = C.PLAYER_RADIUS, hr = headSize / 2;
  const headBottom = feet.y + h - headSize - 0.04;
  const legsTop = feet.y + h * 0.45;
  const b = (y1: number, y2: number, rad: number): Box => ({
    min: [feet.x - rad, y1, feet.z - rad], max: [feet.x + rad, y2, feet.z + rad],
  });
  return [
    { part: "head", box: b(headBottom, headBottom + headSize, hr) },
    { part: "body", box: b(legsTop, headBottom, r * 0.9) },
    { part: "legs", box: b(feet.y, legsTop, r * 0.75) },
  ];
}

export function rayPlayer(o: Vec3, d: Vec3, feet: Vec3, crouched: boolean, maxT: number) {
  let best: { t: number; part: Part } | null = null;
  for (const { part, box } of hitboxes(feet, crouched)) {
    const hit = rayBox(o, d, box, maxT);
    if (hit && (!best || hit.t < best.t)) best = { t: hit.t, part };
  }
  return best;
}
