import * as THREE from "three";
import { CROUCH_HEIGHT, STAND_HEIGHT } from "../shared/constants.ts";
import type { RemotePlayer } from "../shared/protocol.ts";
import { WEAPONS } from "../shared/weapons.ts";
import { Soldier, soldiersLoaded } from "./characters";
import { decodeLook, paintOf } from "./cosmetics";
import { armsKit, bombKit, Kit, legKit, torsoKit, type Outfit } from "./models";

/** The procedural soldier, now only the shooting range's targets: one stance (standing or crouched),
 * legs that swing from the hips, arms + gun that tilt with the pitch. Sized to the old hitboxes. */
type Stance = { group: THREE.Group; aim: THREE.Group; guns: THREE.Mesh[]; muzzles: THREE.Vector3[]; legs: THREE.Group[];
  bomb: THREE.Mesh };

export function stance(o: Outfit, crouched: boolean, mat: THREE.Material, look = decodeLook("")): Stance {
  const h = crouched ? CROUCH_HEIGHT : STAND_HEIGHT;
  const group = new THREE.Group();
  const k = new Kit();
  const shoulder = torsoKit(o, h, k, look.hat);
  group.add(k.buildSingle(mat));
  const aim = new THREE.Group();
  aim.position.set(0, shoulder, 0);
  group.add(aim);
  const guns: THREE.Mesh[] = [], muzzles: THREE.Vector3[] = [];
  for (let w = 0; w < WEAPONS.length; w++) {
    const gk = new Kit();
    muzzles.push(armsKit(o, w, gk, paintOf(look.paint)).muzzle);
    const mesh = gk.buildSingle(mat);
    mesh.castShadow = false; // the torso's shadow is enough; every shadow caster is another draw call
    mesh.visible = w === 0;
    aim.add(mesh);
    guns.push(mesh);
  }
  const legs = [-0.11, 0.11].map((x) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, h * 0.45, 0);
    const lk = new Kit();
    legKit(o, h, crouched, lk);
    const leg = lk.buildSingle(mat);
    leg.castShadow = false;
    pivot.add(leg);
    group.add(pivot);
    return pivot;
  });
  const bk = new Kit();
  bombKit(bk);
  const bomb = bk.buildSingle(mat);
  bomb.position.set(0, h * 0.62, 0.16); // strapped to the back
  bomb.rotation.x = Math.PI / 2;
  bomb.visible = false;
  group.add(bomb);
  return { group, aim, guns, muzzles, legs, bomb };
}

type View = {
  soldier: Soldier; team: number; look: string; alive: boolean; dying: number; phase: number; last: THREE.Vector3; hurt: number;
};

const DEATH_TIME = 1.6; // the death animation, then the body disappears

/** Other players: animated soldiers from characters.ts, following the snapshots. */
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
    if (!soldiersLoaded()) return; // still downloading the models: nobody is drawn for that moment
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

      const speed = dt > 0 ? Math.hypot(p.x - v.last.x, p.z - v.last.z) / dt : 0;
      const airborne = dt > 0 && Math.abs(p.y - v.last.y) / dt > 0.8;
      v.last.set(p.x, p.y, p.z);
      const stride = Math.floor(v.phase / Math.PI);
      v.phase += dt * speed * 1.9;
      if (p.alive && !p.crouched && speed > 3.6 && speed < 12 && Math.floor(v.phase / Math.PI) !== stride) this.onStep(s.root.position);
      if (s.root.visible) s.update(dt, { speed, crouched: p.crouched, alive: p.alive, airborne, pitch: p.pitch });

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
    return true;
  }

  hurt(id: number): void {
    const v = this.views.get(id);
    if (v) v.hurt = 0.1;
  }
}
