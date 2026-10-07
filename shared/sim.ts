import { rayBox, type Box, type Vec3 } from "./collision.ts";
import * as C from "./constants.ts";
import { newGun, takeRecoil, updateGun, type GunState } from "./gun.ts";
import { rayPlayer, type Part } from "./hitbox.ts";
import { eyeHeight, newPlayer, stepPlayer, type MoveInput, type PlayerState } from "./movement.ts";
import { bulletDirection, mulberry32, RIFLE, spread } from "./weapons.ts";

/** One tick of player input. The client predicts with it and the server replays the same commands. */
export type Cmd = MoveInput & { seq: number; pitch: number; fire: boolean; reload: boolean };

export type Sim = { move: PlayerState; gun: GunState };
export type Bullet = { o: Vec3; d: Vec3 };

export const RANGE = 120;

export const newSim = (x = 0, y = 0, z = 0): Sim => ({ move: newPlayer(x, y, z), gun: newGun(RIFLE) });
export const cloneSim = (s: Sim): Sim => structuredClone(s);

/** Spread is random but must come out identical on client and server: seed it from player + command. */
export const shotSeed = (playerId: number, seq: number) => (Math.imul(playerId, 0x9e3779b1) ^ seq) >>> 0;

/** Advance one tick: move, then the gun. Returns the bullets fired this tick. */
export function simulate(s: Sim, cmd: Cmd, seed: number, boxes: readonly Box[]): Bullet[] {
  stepPlayer(s.move, cmd, C.TICK, boxes);
  const n = updateGun(s.gun, RIFLE, C.TICK, cmd.fire, cmd.reload);
  const out: Bullet[] = [];
  for (let i = 0; i < n; i++) {
    const m = s.move;
    const cone = spread(RIFLE, Math.hypot(m.vel.x, m.vel.z), m.onGround, m.crouched, s.gun.shot);
    const d = bulletDirection(cmd.yaw, cmd.pitch, takeRecoil(s.gun), cone, mulberry32(seed + i));
    out.push({ o: { x: m.pos.x, y: m.pos.y + eyeHeight(m), z: m.pos.z }, d });
  }
  return out;
}

export function traceMap(b: Bullet, boxes: readonly Box[], maxT = RANGE) {
  let t = maxT, normal: [number, number, number] = [0, 1, 0];
  for (const box of boxes) {
    const h = rayBox(b.o, b.d, box, t);
    if (h && h.t < t) { t = h.t; normal = h.normal; }
  }
  return { t, normal, hitWall: t < maxT };
}

export type Target<Id> = { id: Id; feet: Vec3; crouched: boolean };

/** Nearest player hit before the wall at maxT. */
export function traceTargets<Id>(b: Bullet, targets: Iterable<Target<Id>>, maxT: number) {
  let best: { id: Id; t: number; part: Part } | null = null;
  for (const tg of targets) {
    const h = rayPlayer(b.o, b.d, tg.feet, tg.crouched, best?.t ?? maxT);
    if (h && (!best || h.t < best.t)) best = { id: tg.id, t: h.t, part: h.part };
  }
  return best;
}
