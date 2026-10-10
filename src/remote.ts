import * as THREE from "three";
import type { RemotePlayer } from "../shared/protocol.ts";
import { WEAPONS } from "../shared/weapons.ts";
import { Soldier } from "./characters";
import { decodeLook } from "./cosmetics";

type View = {
  soldier: Soldier; team: number; look: string; alive: boolean; dying: number; phase: number; last: THREE.Vector3; hurt: number;
};

const DEATH_TIME = 1.6; // falling over, lights going out, then the body disappears

/** Other players: troopers from characters.ts, following the snapshots. */
export class Remotes {
  private readonly views = new Map<number, View>();
  private readonly scene: THREE.Scene;
  private lastTime = performance.now();
  /** A running player's foot hit the ground (walking and crouching are silent, as in CS). */
  onStep: (at: THREE.Vector3) => void = () => {};

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  private create(p: RemotePlayer): View {
    const v: View = { soldier: new Soldier(p.team, decodeLook(p.look)), team: p.team, look: p.look,
      alive: p.alive, dying: 0, phase: 0, last: new THREE.Vector3(p.x, p.y, p.z), hurt: 0 };
    this.scene.add(v.soldier.root);
    this.views.set(p.id, v);
    return v;
  }

  /** carrier: who has the bomb on their back; hidden: the player we're watching through their eyes. */
  update(players: RemotePlayer[], carrier: number | null = null, hidden: number | null = null): void {
    const now = performance.now(), dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    const seen = new Set<number>();
    for (const p of players) {
      let v = this.views.get(p.id);
      // sides swapped after a match, or the roster brought their cosmetics: build them again
      if (v && (v.team !== p.team || v.look !== p.look)) { this.remove(p.id, v); v = undefined; }
      v ??= this.create(p);
      seen.add(p.id);
      if (v.alive && !p.alive) v.dying = DEATH_TIME;
      v.alive = p.alive;
      v.dying = Math.max(0, v.dying - dt);
      const s = v.soldier;
      s.root.visible = (p.alive || v.dying > 0) && p.id !== hidden;
      s.bomb.visible = p.id === carrier;
      s.root.position.set(p.x, p.y, p.z);
      s.root.rotation.y = p.yaw;
      if (WEAPONS[p.weapon]) s.setWeapon(p.weapon);

      const vx = dt > 0 ? (p.x - v.last.x) / dt : 0, vz = dt > 0 ? (p.z - v.last.z) / dt : 0, speed = Math.hypot(vx, vz);
      const airborne = dt > 0 && Math.abs(p.y - v.last.y) / dt > 0.8;
      v.last.set(p.x, p.y, p.z);
      // how the movement splits between where they face (-Z turned by yaw) and their right
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), forward = speed > 0 ? (vx * fx + vz * fz) / speed : 1;
      const right = speed > 0 ? (vx * -fz + vz * fx) / speed : 0;
      const stride = Math.floor(v.phase / Math.PI);
      v.phase += dt * speed * 1.9;
      if (p.alive && !p.crouched && speed > 3.6 && speed < 12 && Math.floor(v.phase / Math.PI) !== stride) this.onStep(s.root.position);
      if (s.root.visible) s.update(dt, { speed, forward, right, crouched: p.crouched, alive: p.alive, airborne, pitch: p.pitch });

      v.hurt = Math.max(0, v.hurt - dt);
      s.material.emissive.setRGB(v.hurt > 0 ? 0.5 : 0, 0, 0);
    }
    for (const [id, v] of this.views) if (!seen.has(id)) this.remove(id, v);
  }

  private remove(id: number, v: View): void {
    this.scene.remove(v.soldier.root);
    v.soldier.dispose();
    this.views.delete(id);
  }

  /** Muzzle of the gun as drawn now, or false if we don't draw that player. */
  muzzle(id: number, out: THREE.Vector3): boolean {
    const v = this.views.get(id);
    if (!v || !v.soldier.root.visible) return false;
    v.soldier.muzzle(out);
    v.soldier.kick(); // asked for at every shot they fire
    return true;
  }

  hurt(id: number): void {
    const v = this.views.get(id);
    if (v) { v.hurt = 0.1; v.soldier.flinch(); }
  }
}
