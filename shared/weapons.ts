import * as C from "./constants.ts";

export type WeaponStats = {
  name: string;
  damage: number;
  interval: number; // seconds between shots
  magazine: number;
  reserve: number;
  reloadTime: number;
  baseSpread: number; // radians, standing still
  moveSpread: number; // added at full running speed
  airSpread: number;
  crouchFactor: number;
  shotSpread: number; // extra per bullet into a spray, capped by maxShotSpread
  maxShotSpread: number;
  recoilRecovery: number; // seconds of not shooting before the spray resets
};

export const RIFLE: WeaponStats = {
  name: "AR-7",
  damage: 36,
  interval: 0.1,
  magazine: 30,
  reserve: 90,
  reloadTime: 2.4,
  baseSpread: 0.0035,
  moveSpread: 0.07,
  airSpread: 0.14,
  crouchFactor: 0.7,
  shotSpread: 0.0012,
  maxShotSpread: 0.018,
  recoilRecovery: 0.35,
};

const deg = Math.PI / 180;

/**
 * Where bullet n of a spray goes relative to the crosshair, as [pitch up, yaw right] in radians:
 * straight up for the first ~9 shots, then a slow left-right sway. Learnable, like a real pattern.
 */
export function recoilOffset(shot: number): [number, number] {
  const pitch = Math.min(6.2, 6.4 * (1 - Math.exp(-shot / 6))) * deg;
  const yaw = shot < 9 ? 0.15 * shot * deg : 1.6 * Math.sin((shot - 9) / 3.2) * deg;
  return [pitch, yaw];
}

/** Below this share of run speed a rifle counts as standing still, as in CS: it's what makes
 * counter-strafing (tapping the opposite key to stop) worth learning. */
export const ACCURATE_SPEED = 0.34;

export function spread(w: WeaponStats, speed: number, onGround: boolean, crouched: boolean, shot: number): number {
  const moving = Math.max(0, Math.min(speed / C.MAX_SPEED, 1) - ACCURATE_SPEED) / (1 - ACCURATE_SPEED);
  let s = w.baseSpread + w.moveSpread * moving ** 1.5;
  if (!onGround) s += w.airSpread;
  if (crouched && onGround) s *= w.crouchFactor;
  return s + Math.min(shot * w.shotSpread, w.maxShotSpread);
}

/** Deterministic PRNG, so client and server can derive the same spread from a shared seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bullet direction for view angles plus recoil and a random point inside the spread cone. */
export function bulletDirection(yaw: number, pitch: number, recoil: [number, number], spreadRad: number,
                                rand: () => number): { x: number; y: number; z: number } {
  const r = spreadRad * Math.sqrt(rand());
  const a = rand() * Math.PI * 2;
  const p = pitch + recoil[0] + r * Math.sin(a);
  const y = yaw - recoil[1] + r * Math.cos(a);
  return { x: -Math.sin(y) * Math.cos(p), y: Math.sin(p), z: -Math.cos(y) * Math.cos(p) };
}
