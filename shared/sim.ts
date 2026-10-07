import { rayBox, type Box, type Vec3 } from "./collision.ts";
import * as C from "./constants.ts";
import { newGun, takeRecoil, updateGun, type GunState } from "./gun.ts";
import { rayPlayer, type Part } from "./hitbox.ts";
import { eyeHeight, newPlayer, stepPlayer, type MoveInput, type PlayerState } from "./movement.ts";
import { bulletDirection, mulberry32, spread, WEAPONS } from "./weapons.ts";

/** One tick of player input. The client predicts with it and the server replays the same commands.
 * slot: the weapon the player wants in hand; aim: looking through the scope; use: E, plant or defuse. */
export type Cmd = MoveInput & {
  seq: number; pitch: number; fire: boolean; reload: boolean; slot: number; aim: boolean; use: boolean;
};

/** guns[i] belongs to WEAPONS[i]; draw: seconds until the weapon just switched to can fire;
 * frozen: the freeze time at the start of a round (look around, don't move or shoot). */
export type Sim = { move: PlayerState; guns: GunState[]; slot: number; draw: number; frozen: boolean };
export type Bullet = { o: Vec3; d: Vec3; w: number };

export const RANGE = 120;

export const newSim = (x = 0, y = 0, z = 0): Sim =>
  ({ move: newPlayer(x, y, z), guns: WEAPONS.map(newGun), slot: 0, draw: 0, frozen: false });
export const cloneSim = (s: Sim): Sim => structuredClone(s);
export const gunOf = (s: Sim): GunState => s.guns[s.slot];
export const weaponOf = (s: Sim) => WEAPONS[s.slot];
export const scoped = (s: Sim, cmd: { aim: boolean }) => cmd.aim && !!WEAPONS[s.slot].scope && s.draw === 0;

/** Spread is random but must come out identical on client and server: seed it from player + command. */
export const shotSeed = (playerId: number, seq: number) => (Math.imul(playerId, 0x9e3779b1) ^ seq) >>> 0;

/** Advance one tick: switch weapons, move, then the gun. Returns the bullets fired this tick. */
export function simulate(s: Sim, cmd: Cmd, seed: number, boxes: readonly Box[]): Bullet[] {
  if (cmd.slot !== s.slot && WEAPONS[cmd.slot]) {
    gunOf(s).reloading = 0; // switching away cancels a reload, as in CS
    s.slot = cmd.slot;
    s.draw = WEAPONS[cmd.slot].drawTime;
  }
  const w = weaponOf(s), gun = gunOf(s), zoom = scoped(s, cmd);
  // holding E (planting, defusing) or the freeze time: stand still, hands busy
  const still = s.frozen || cmd.use;
  stepPlayer(s.move, still ? { ...cmd, forward: 0, right: 0, jump: false } : cmd, C.TICK, boxes,
    zoom ? w.scope!.speed : w.speed);
  const ready = s.draw === 0 && !still;
  s.draw = Math.max(0, s.draw - C.TICK);
  if (s.draw < 1e-9) s.draw = 0;
  const n = updateGun(gun, w, C.TICK, cmd.fire && ready, cmd.reload && ready);
  const out: Bullet[] = [];
  for (let i = 0; i < n; i++) {
    const m = s.move;
    const cone = spread(w, Math.hypot(m.vel.x, m.vel.z), m.onGround, m.crouched, gun.shot, zoom);
    const d = bulletDirection(cmd.yaw, cmd.pitch, takeRecoil(gun, w), cone, mulberry32(seed + i));
    out.push({ o: { x: m.pos.x, y: m.pos.y + eyeHeight(m), z: m.pos.z }, d, w: s.slot });
  }
  return out;
}

export function traceMap(b: { o: Vec3; d: Vec3 }, boxes: readonly Box[], maxT = RANGE) {
  let t = maxT, normal: [number, number, number] = [0, 1, 0], index = -1;
  for (let i = 0; i < boxes.length; i++) {
    const h = rayBox(b.o, b.d, boxes[i], t);
    if (h && h.t < t) { t = h.t; normal = h.normal; index = i; }
  }
  return { t, normal, hitWall: t < maxT, index };
}

export type Target<Id> = { id: Id; feet: Vec3; crouched: boolean };

/** Nearest player hit before the wall at maxT. */
export function traceTargets<Id>(b: { o: Vec3; d: Vec3 }, targets: Iterable<Target<Id>>, maxT: number) {
  let best: { id: Id; t: number; part: Part } | null = null;
  for (const tg of targets) {
    const h = rayPlayer(b.o, b.d, tg.feet, tg.crouched, best?.t ?? maxT);
    if (h && (!best || h.t < best.t)) best = { id: tg.id, t: h.t, part: h.part };
  }
  return best;
}
