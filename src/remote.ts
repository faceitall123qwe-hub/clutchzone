import * as THREE from "three";
import { CROUCH_HEIGHT, STAND_HEIGHT } from "../shared/constants.ts";
import type { RemotePlayer } from "../shared/protocol.ts";
import { WEAPONS } from "../shared/weapons.ts";
import { decodeLook, paintOf, type Look } from "./cosmetics";
import { armsKit, bombKit, Kit, legKit, OUTFITS, torsoKit, type Outfit } from "./models";
import { toon } from "./toon";

/** One stance (standing or crouched): torso, legs that swing from the hips, and arms + gun that tilt
 * with the view pitch around the shoulders. Sized to the hitboxes, so what you see is what you hit. */
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
  root: THREE.Group; stand: Stance; crouch: Stance; mat: THREE.MeshToonMaterial; team: number; look: string;
  weapon: number; alive: boolean; dying: number; phase: number; last: THREE.Vector3; hurt: number;
};

const DEATH_TIME = 0.7;

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
    const mat = toon({ vertexColors: true });
    const o = OUTFITS[p.team], look: Look = decodeLook(p.look);
    const v: View = { root: new THREE.Group(), stand: stance(o, false, mat, look), crouch: stance(o, true, mat, look), mat,
      team: p.team, look: p.look,
      weapon: 0, alive: p.alive, dying: 0, phase: 0, last: new THREE.Vector3(p.x, p.y, p.z), hurt: 0 };
    v.root.rotation.order = "YXZ"; // yaw first, then the death fall around the body's own axis
    v.root.add(v.stand.group, v.crouch.group);
    this.scene.add(v.root);
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
      const fall = p.alive ? 0 : 1 - (v.dying / DEATH_TIME) ** 2;
      v.root.visible = (p.alive || v.dying > 0) && p.id !== hidden;
      v.stand.bomb.visible = v.crouch.bomb.visible = p.id === carrier;
      v.root.position.set(p.x, p.y - fall * 0.15, p.z);
      v.root.rotation.set(fall * Math.PI * 0.48, p.yaw, 0);

      if (p.weapon !== v.weapon && WEAPONS[p.weapon]) {
        for (const s of [v.stand, v.crouch]) s.guns.forEach((g, i) => (g.visible = i === p.weapon));
        v.weapon = p.weapon;
      }
      v.stand.group.visible = !p.crouched;
      v.crouch.group.visible = p.crouched;
      const s = p.crouched ? v.crouch : v.stand;
      s.aim.rotation.x = p.alive ? p.pitch : 0;

      const speed = dt > 0 ? Math.hypot(p.x - v.last.x, p.z - v.last.z) / dt : 0;
      v.last.set(p.x, p.y, p.z);
      const stride = Math.floor(v.phase / Math.PI);
      v.phase += dt * speed * 1.9;
      if (p.alive && !p.crouched && speed > 3.6 && speed < 12 && Math.floor(v.phase / Math.PI) !== stride) this.onStep(v.root.position);
      const swing = Math.sin(v.phase) * Math.min(1, speed / 4) * (p.crouched ? 0.25 : 0.6);
      s.legs[0].rotation.x = swing;
      s.legs[1].rotation.x = -swing;

      v.hurt = Math.max(0, v.hurt - dt);
      v.mat.emissive.setRGB(v.hurt > 0 ? 0.5 : 0, 0, 0);
    }
    for (const [id, v] of this.views) if (!seen.has(id)) this.remove(id, v);
  }

  private remove(id: number, v: View): void {
    this.scene.remove(v.root);
    v.root.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    v.mat.dispose();
    this.views.delete(id);
  }

  /** Muzzle of the gun as drawn now, or false if we don't draw that player. */
  muzzle(id: number, out: THREE.Vector3): boolean {
    const v = this.views.get(id);
    if (!v || !v.root.visible) return false;
    const s = v.crouch.group.visible ? v.crouch : v.stand;
    s.aim.updateWorldMatrix(true, false);
    out.copy(s.muzzles[v.weapon]).applyMatrix4(s.aim.matrixWorld);
    return true;
  }

  hurt(id: number): void {
    const v = this.views.get(id);
    if (v) v.hurt = 0.1;
  }
}
