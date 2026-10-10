import * as C from "./constants.ts";

export type WeaponStats = {
  name: string;
  damage: number;
  interval: number; // seconds between shots
  magazine: number;
  reserve: number;
  reloadTime: number;
  drawTime: number; // after switching to it, before it can fire
  auto: boolean; // keeps firing while the trigger is held; otherwise one shot per click
  speed: number; // share of run speed while holding it
  baseSpread: number; // radians, standing still
  moveSpread: number; // added at full running speed
  airSpread: number;
  crouchFactor: number;
  shotSpread: number; // extra per bullet into a spray, capped by maxShotSpread
  maxShotSpread: number;
  recoil: number; // scale of the spray pattern
  recoilRecovery: number; // seconds of not shooting before the spray resets
  scope?: { fov: number; spread: number; speed: number }; // fov in degrees; spread replaces baseSpread
  pellets?: number; // bullets per shot (a shotgun), each with its own spread
  range?: number; // metres a bullet reaches, if less than RANGE
  melee?: boolean; // a blade: no ammo, no reload, no tracer
};

export const RIFLE: WeaponStats = {
  name: "AR-7",
  damage: 36,
  interval: 0.1,
  magazine: 30,
  reserve: 90,
  reloadTime: 2.4,
  drawTime: 0.6,
  auto: true,
  speed: 1,
  baseSpread: 0.0035,
  moveSpread: 0.07,
  airSpread: 0.14,
  crouchFactor: 0.7,
  shotSpread: 0.0012,
  maxShotSpread: 0.018,
  recoil: 1,
  recoilRecovery: 0.35,
};

export const PISTOL: WeaponStats = {
  name: "P-9",
  damage: 28, // four to the body, one to the head
  interval: 0.15,
  magazine: 12,
  reserve: 48,
  reloadTime: 2.1,
  drawTime: 0.35,
  auto: false,
  speed: 1,
  baseSpread: 0.005,
  moveSpread: 0.035,
  airSpread: 0.1,
  crouchFactor: 0.8,
  shotSpread: 0.004,
  maxShotSpread: 0.03,
  recoil: 0.45,
  recoilRecovery: 0.3,
};

export const SNIPER: WeaponStats = {
  name: "Longbow",
  damage: 115, // one body shot kills, a leg shot doesn't
  interval: 1.45, // bolt action
  magazine: 5,
  reserve: 20,
  reloadTime: 3.4,
  drawTime: 0.9,
  auto: false,
  speed: 0.85,
  baseSpread: 0.05, // without the scope it's a gamble
  moveSpread: 0.12,
  airSpread: 0.25,
  crouchFactor: 0.8,
  shotSpread: 0,
  maxShotSpread: 0,
  recoil: 0,
  recoilRecovery: 0.35,
  scope: { fov: 22, spread: 0.0006, speed: 0.42 },
};

export const SMG: WeaponStats = {
  name: "Wasp",
  damage: 24, // a headshot doesn't quite kill
  interval: 0.075,
  magazine: 30,
  reserve: 120,
  reloadTime: 2.2,
  drawTime: 0.45,
  auto: true,
  speed: 1.05,
  baseSpread: 0.007,
  moveSpread: 0.035, // forgiving on the run, unlike the rifle
  airSpread: 0.12,
  crouchFactor: 0.8,
  shotSpread: 0.0016,
  maxShotSpread: 0.024,
  recoil: 0.65,
  recoilRecovery: 0.3,
};

export const SHOTGUN: WeaponStats = {
  name: "Breacher",
  damage: 15, // per pellet: all eight up close kill, a few at ten metres don't
  interval: 0.9, // pump action
  magazine: 6,
  reserve: 24,
  reloadTime: 2.8,
  drawTime: 0.6,
  auto: false,
  speed: 0.95,
  baseSpread: 0.055, // the cone the pellets spread in
  moveSpread: 0.02,
  airSpread: 0.05,
  crouchFactor: 0.9,
  shotSpread: 0,
  maxShotSpread: 0,
  recoil: 0,
  recoilRecovery: 0.35,
  pellets: 8,
  range: 28,
};

export const KNIFE: WeaponStats = {
  name: "Blade",
  damage: 55, // two slashes to the body, one to the head
  interval: 0.5,
  magazine: 0,
  reserve: 0,
  reloadTime: 0,
  drawTime: 0.3,
  auto: true,
  speed: 1.12, // run with the knife out
  baseSpread: 0,
  moveSpread: 0,
  airSpread: 0,
  crouchFactor: 1,
  shotSpread: 0,
  maxShotSpread: 0,
  recoil: 0,
  recoilRecovery: 0.3,
  range: 2.2,
  melee: true,
};

/** Index = weapon id = slot (keys 1-6). */
export const WEAPONS: readonly WeaponStats[] = [RIFLE, PISTOL, SNIPER, SMG, SHOTGUN, KNIFE];

const deg = Math.PI / 180;

/**
 * Where bullet n of a spray goes relative to the crosshair, as [pitch up, yaw right] in radians:
 * straight up for the first ~9 shots, then a slow left-right sway. Learnable, like a real pattern.
 */
export function recoilOffset(shot: number, w: WeaponStats): [number, number] {
  const pitch = Math.min(6.2, 6.4 * (1 - Math.exp(-shot / 6))) * deg;
  const yaw = shot < 9 ? 0.15 * shot * deg : 1.6 * Math.sin((shot - 9) / 3.2) * deg;
  return [pitch * w.recoil, yaw * w.recoil];
}

/** Below this share of run speed a rifle counts as standing still, as in CS: it's what makes
 * counter-strafing (tapping the opposite key to stop) worth learning. */
export const ACCURATE_SPEED = 0.34;

export function spread(w: WeaponStats, speed: number, onGround: boolean, crouched: boolean, shot: number,
                       scoped = false): number {
  const moving = Math.max(0, Math.min(speed / (C.MAX_SPEED * w.speed), 1) - ACCURATE_SPEED) / (1 - ACCURATE_SPEED);
  let s = (scoped && w.scope ? w.scope.spread : w.baseSpread) + w.moveSpread * moving ** 1.5;
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
