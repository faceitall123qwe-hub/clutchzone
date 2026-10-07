import { recoilOffset, type WeaponStats } from "./weapons.ts";

/** Ammo, fire rate, reload and spray position. Plain data so it can be cloned, sent and replayed. */
export type GunState = {
  ammo: number;
  reserve: number;
  shot: number; // index into the spray pattern
  cooldown: number;
  sinceShot: number;
  reloading: number; // seconds left, 0 = not reloading
  held: boolean; // trigger was down last tick: semi-automatic guns fire on the press only
};

export const newGun = (w: WeaponStats): GunState => ({
  ammo: w.magazine, reserve: w.reserve, shot: 0, cooldown: 0, sinceShot: 99, reloading: 0, held: false,
});

/** Advances one tick; returns how many bullets leave the barrel (0 or 1 at these fire rates). */
export function updateGun(g: GunState, w: WeaponStats, dt: number, trigger: boolean, reloadKey: boolean): number {
  const pressed = trigger && !g.held;
  g.held = trigger;
  g.cooldown = Math.max(0, g.cooldown - dt);
  g.sinceShot += dt;
  if (g.sinceShot > w.recoilRecovery) g.shot = 0;

  if (g.reloading > 0) {
    g.reloading -= dt;
    if (g.reloading <= 1e-9) {
      const take = Math.min(w.magazine - g.ammo, g.reserve);
      g.ammo += take;
      g.reserve -= take;
      g.reloading = 0;
    }
    return 0;
  }
  if ((reloadKey || (trigger && g.ammo === 0)) && g.ammo < w.magazine && g.reserve > 0) {
    g.reloading = w.reloadTime;
    return 0;
  }
  if (!(w.auto ? trigger : pressed) || g.cooldown > 1e-9 || g.ammo === 0) return 0;
  g.ammo--;
  g.cooldown += w.interval;
  g.sinceShot = 0;
  return 1;
}

/** Recoil for the bullet about to be fired; advances the spray. */
export function takeRecoil(g: GunState, w: WeaponStats): [number, number] {
  const r = recoilOffset(g.shot, w);
  g.shot++;
  return r;
}

/** Recoil the camera shows now: the current spray position, fading once firing stops. */
export function viewRecoil(g: GunState, w: WeaponStats): [number, number] {
  const k = Math.max(0, 1 - Math.max(0, g.sinceShot - w.interval) / w.recoilRecovery);
  const [p, y] = recoilOffset(Math.max(0, g.shot - 1), w);
  return [p * k, y * k];
}
