import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { clone as cloneRig } from "three/examples/jsm/utils/SkeletonUtils.js";
import { STAND_HEIGHT } from "../shared/constants.ts";
import { decodeLook, PAINTS, paintOf, type Look, type Paint } from "./cosmetics";
import { bombKit, hatKit, Kit, OUTFITS } from "./models";
import { toon } from "./toon";

/**
 * Soldiers from Quaternius' Toon Shooter Game Kit (CC0), built by scripts/models.ts. At load time each one
 * becomes a single skinned mesh coloured per vertex (body, head and pads share one draw call), plus one
 * mesh per gun in the right hand. Attackers wear the kit's red soldier, defenders the green one, both
 * repainted in the team colour.
 */
const GUNS = ["AK", "Pistol", "Sniper"]; // WEAPONS order
const FILES = ["attacker", "defender"];
const TEAM_COLOR = [0xf07c22, 0x2f7fe0];

/** Which kit material takes which colour of a weapon paint, and how much darker or lighter. */
const PAINT_SLOT: Record<string, [keyof Paint, number]> = {
  Grey: ["metal", 1], LightGrey: ["metal", 1.2], Grey2: ["dark", 1.3], DarkGrey: ["dark", 1], Black: ["dark", 0.6],
  Wood: ["wood", 1], DarkWood: ["wood", 0.65],
};

/** toView: from the gun's own space to the first-person one (metres, barrel along -Z, origin in the hand). */
type Gun = { geo: Map<string, THREE.BufferGeometry>; ranges: { material: string; color: THREE.Color; start: number; count: number }[];
  parent: string; matrix: THREE.Matrix4; muzzle: THREE.Vector3; toView: THREE.Matrix4 };
/** hat / bomb: where a hat sits on the head bone and the bomb on the torso bone, in the kit's units. */
/** scale: from the kit's units to metres, so the helmet top is at the standing height. */
type Template = { scene: THREE.Group; clips: THREE.AnimationClip[]; guns: Gun[]; hat: THREE.Matrix4; bomb: THREE.Matrix4; scale: number };
let templates: Template[] = [];

const linear = (hex: number) => new THREE.Color(hex);

/** Paints every vertex of a geometry with one colour (the kit has a flat colour per material). */
function paint(geo: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
  const n = geo.getAttribute("position").count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set([color.r, color.g, color.b], i * 3);
  geo.setAttribute("color", new THREE.BufferAttribute(c, 3));
  return geo;
}

/** Only the named attributes, each as a plain array (the kit's are interleaved, which merging can't mix). */
const keep = (geo: THREE.BufferGeometry, names: string[]) => {
  for (const name of Object.keys(geo.attributes)) {
    const a = geo.getAttribute(name);
    if (!names.includes(name)) { geo.deleteAttribute(name); continue; }
    const out = name === "skinIndex" ? new Uint16Array(a.count * a.itemSize) : new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = a.getComponent(i, c);
    geo.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
  }
  return geo;
};

function nearestBone(o: THREE.Object3D, bones: THREE.Bone[]): number {
  for (let p = o.parent; p; p = p.parent) {
    const i = bones.indexOf(p as THREE.Bone);
    if (i >= 0) return i;
  }
  return 0;
}

function build(gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] }, team: number): Template {
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const skinned: THREE.SkinnedMesh[] = [], rigid: THREE.Mesh[] = [], gunRoots: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (GUNS.includes(o.name) && !gunRoots.includes(o)) gunRoots.push(o);
  });
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if (gunRoots.some((g) => g === o || g.getObjectById(o.id))) return;
    (o instanceof THREE.SkinnedMesh ? skinned : rigid).push(o);
  });
  const body = skinned[0];
  const skeleton = body.skeleton, bones = skeleton.bones;

  // body parts as they are; rigid parts (head, pads) follow their bone with full weight
  const parts: THREE.BufferGeometry[] = [];
  const colorOf = (m: THREE.Material) => /^(Character_Main|Enemy_Red)$/.test(m.name) ? linear(TEAM_COLOR[team]) : (m as THREE.MeshStandardMaterial).color;
  for (const m of skinned) parts.push(paint(keep(m.geometry.clone(), ["position", "normal", "skinIndex", "skinWeight"]), colorOf(m.material as THREE.Material)));
  const bindInverse = body.bindMatrix.clone().invert(), t = new THREE.Matrix4();
  // the hat sits on the top of the head: its own mesh on the green soldier, part of the body on the red one
  const headPart = rigid.find((m) => bones[nearestBone(m, bones)].name === "Head");
  headPart?.geometry.computeBoundingBox();
  const headBox = headPart ? headPart.geometry.boundingBox!.clone().applyMatrix4(headPart.matrixWorld) : null;
  for (const m of rigid) {
    const b = nearestBone(m, bones);
    // world = bone · boneInverse · bindMatrix · pos  ⇒  pos = bindMatrix⁻¹ · boneInverse⁻¹ · bone⁻¹ · partWorld · v
    t.copy(bindInverse).multiply(skeleton.boneInverses[b].clone().invert()).multiply(bones[b].matrixWorld.clone().invert()).multiply(m.matrixWorld);
    const g = keep(m.geometry.clone(), ["position", "normal"]).applyMatrix4(t);
    const n = g.getAttribute("position").count;
    const idx = new Uint16Array(n * 4), w = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { idx[i * 4] = b; w[i * 4] = 1; }
    g.setAttribute("skinIndex", new THREE.BufferAttribute(idx, 4));
    g.setAttribute("skinWeight", new THREE.BufferAttribute(w, 4));
    parts.push(paint(g, colorOf(m.material as THREE.Material)));
  }
  const merged = new THREE.SkinnedMesh(mergeGeometries(parts), toon({ vertexColors: true }));
  merged.name = "soldier";
  merged.castShadow = true;
  merged.frustumCulled = false; // skinned bounds don't follow the animation
  body.parent!.add(merged);
  merged.bind(skeleton, body.bindMatrix);
  for (const m of [...skinned, ...rigid]) m.removeFromParent();
  for (const g of parts) g.dispose();

  // guns: one mesh each, hanging where the kit put it; geometry per paint, made on demand
  const forward = new THREE.Vector3(0, 0, 1), p = new THREE.Vector3();
  const guns = GUNS.map((name): Gun => {
    const root = gunRoots.find((g) => g.name === name)!;
    const ranges: Gun["ranges"] = [], geos: THREE.BufferGeometry[] = [];
    const inv = root.matrixWorld.clone().invert();
    let start = 0;
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      let g = keep(o.geometry.clone(), ["position", "normal"]).applyMatrix4(t.copy(inv).multiply(o.matrixWorld));
      if (g.index) g = g.toNonIndexed();
      const count = g.getAttribute("position").count, mat = o.material as THREE.MeshStandardMaterial;
      ranges.push({ material: mat.name, color: mat.color.clone(), start, count });
      start += count;
      geos.push(g);
    });
    const geo = paint(mergeGeometries(geos), new THREE.Color());
    // the muzzle: the vertices furthest forward, where the soldier faces at rest
    const pos = geo.getAttribute("position"), w = root.matrixWorld;
    let best = -Infinity;
    for (let i = 0; i < pos.count; i++) best = Math.max(best, p.fromBufferAttribute(pos, i).applyMatrix4(w).dot(forward));
    const tip = new THREE.Vector3(); let n = 0;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(w);
      if (p.dot(forward) > best - 0.05) { tip.add(p); n++; }
    }
    const muzzle = tip.divideScalar(n).applyMatrix4(inv);
    const toView = firstPerson(geo, muzzle, root.parent!.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv), root.matrixWorld.getMaxScaleOnAxis());
    const gun: Gun = { geo: new Map(), ranges, parent: root.parent!.name, matrix: root.matrix.clone(), muzzle, toView };
    gun.geo.set("classic", recolor(geo, gun, PAINTS[0]));
    root.removeFromParent();
    return gun;
  });
  // a hat on top of the helmet, upright at rest; the bomb strapped to the back (the kit's soldiers face +Z)
  merged.updateMatrixWorld(true);
  merged.computeBoundingBox(); // skinned: the rest pose
  const box = merged.boundingBox!.clone().applyMatrix4(merged.matrixWorld), size = box.getSize(new THREE.Vector3());
  const scale = STAND_HEIGHT / size.y, cx = (box.min.x + box.max.x) / 2;
  const at = (bone: string, x: number, y: number, z: number, rx = 0) => {
    const b = bones.find((o) => o.name === bone)!;
    return b.matrixWorld.clone().invert().multiply(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, Math.PI, 0)), new THREE.Vector3().setScalar(1 / scale)));
  };
  const torso = bones.find((o) => o.name === "Torso")!.getWorldPosition(new THREE.Vector3());
  const head = bones.find((o) => o.name === "Head")!.getWorldPosition(new THREE.Vector3());
  for (const g of guns) g.toView.premultiply(new THREE.Matrix4().makeScale(scale, scale, scale));
  return { scene, clips: gltf.animations, guns, scale,
    hat: headBox ? at("Head", (headBox.min.x + headBox.max.x) / 2, headBox.max.y - size.y * 0.01, (headBox.min.z + headBox.max.z) / 2)
      : at("Head", head.x, box.max.y - size.y * 0.01, head.z),
    bomb: at("Torso", cx, torso.y, torso.z - size.y * 0.1, Math.PI / 2) };
}

/**
 * From a gun's own space to the first-person one. At rest the arm is out to the side, so the gun's pose
 * there says nothing: its axes come from its shape. The longest side is the barrel, pointing at the
 * muzzle; of the other two the larger is the height, and down is where the grip and magazine stick out.
 */
function firstPerson(geo: THREE.BufferGeometry, muzzle: THREE.Vector3, hand: THREE.Vector3, worldScale: number): THREE.Matrix4 {
  geo.computeBoundingBox();
  const box = geo.boundingBox!, size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3());
  const [long, tall] = [0, 1, 2].sort((a, b) => size.getComponent(b) - size.getComponent(a));
  const axis = (i: number, sign: number) => new THREE.Vector3().setComponent(i, sign);
  const forward = axis(long, muzzle.getComponent(long) > mid.getComponent(long) ? 1 : -1);
  const below = muzzle.getComponent(tall) - box.min.getComponent(tall), above = box.max.getComponent(tall) - muzzle.getComponent(tall);
  const up = axis(tall, below > above ? 1 : -1), back = forward.clone().negate(), right = up.clone().cross(back);
  const rotate = new THREE.Matrix4().makeBasis(right, up, back).transpose(); // rows: the new axes
  return new THREE.Matrix4().makeScale(worldScale, worldScale, worldScale).multiply(rotate)
    .multiply(new THREE.Matrix4().makeTranslation(-hand.x, -hand.y, -hand.z));
}

function recolor(geo: THREE.BufferGeometry, gun: Gun, paint: Paint): THREE.BufferGeometry {
  const c = geo.getAttribute("color") as THREE.BufferAttribute, col = new THREE.Color();
  for (const r of gun.ranges) {
    const slot = PAINT_SLOT[r.material];
    if (slot) col.set(paint[slot[0]] as number).multiplyScalar(slot[1]);
    else col.copy(r.color);
    for (let i = r.start; i < r.start + r.count; i++) c.setXYZ(i, col.r, col.g, col.b);
  }
  c.needsUpdate = true;
  return geo;
}

function gunGeometry(gun: Gun, p: Paint): THREE.BufferGeometry {
  let g = gun.geo.get(p.id);
  if (!g) gun.geo.set(p.id, (g = recolor(gun.geo.get("classic")!.clone(), gun, p)));
  return g;
}

let loading: Promise<void> | null = null;

/** A gun for the first-person view, the defenders' one: in metres, barrel along -Z, origin where the hand holds it. */
export function viewGun(id: number, paint: Paint): { geometry: THREE.BufferGeometry; muzzle: THREE.Vector3; box: THREE.Box3 } {
  const gun = templates[1].guns[id];
  const geometry = gunGeometry(gun, paint).clone().applyMatrix4(gun.toView);
  geometry.computeBoundingBox();
  return { geometry, muzzle: gun.muzzle.clone().applyMatrix4(gun.toView), box: geometry.boundingBox! };
}

/** Loads both soldiers (once, however often it's called); no Soldier can be made before it resolves. */
export function loadSoldiers(): Promise<void> {
  return (loading ??= (async () => {
    const loader = new GLTFLoader();
    const files = await Promise.all(FILES.map((f) => loader.loadAsync(`assets/models/${f}.glb`)));
    templates = files.map((g, team) => build(g, team));
  })());
}

export const soldiersLoaded = () => templates.length > 0;

type Clip = "Idle" | "Idle_Shoot" | "Run_Gun" | "Run_Shoot" | "Walk" | "Walk_Shoot" | "Duck" | "Death" | "Jump_Idle" | "HitReact";

/** One animated soldier: feet at the origin, facing -Z. */
export class Soldier {
  readonly root = new THREE.Group();
  readonly material: THREE.MeshToonMaterial;
  readonly head: THREE.Bone;
  readonly back: THREE.Bone;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<Clip, THREE.AnimationAction>();
  private readonly guns: THREE.Mesh[];
  private readonly muzzles: THREE.Vector3[];
  private readonly spine: THREE.Bone;
  private readonly chest: THREE.Bone;
  private current: THREE.AnimationAction | null = null;
  private weapon = 0;
  private readonly model: THREE.Object3D;
  private readonly scale: number;
  private crouch = 0;
  readonly bomb: THREE.Mesh;

  /** A procedural part (hat, bomb) on a bone, built in metres. */
  private attach(bone: THREE.Bone, at: THREE.Matrix4, make: (k: Kit) => void): THREE.Mesh {
    const k = new Kit();
    make(k);
    const m = k.buildSingle(this.material);
    m.castShadow = false;
    m.matrixAutoUpdate = false;
    m.matrix.copy(at);
    bone.add(m);
    return m;
  }

  constructor(team: number, look: Look = decodeLook("")) {
    const t = templates[team] ?? templates[0];
    const model = (this.model = cloneRig(t.scene));
    this.scale = t.scale;
    model.scale.setScalar(t.scale);
    model.rotation.y = Math.PI; // the kit's soldiers face +Z
    this.root.add(model);
    const mesh = model.getObjectByName("soldier") as THREE.SkinnedMesh;
    this.material = (mesh.material as THREE.MeshToonMaterial).clone();
    mesh.material = this.material;
    const bone = (name: string) => mesh.skeleton.bones.find((b) => b.name === name)!;
    this.head = bone("Head");
    this.back = bone("Torso");
    this.spine = bone("Abdomen");
    this.chest = bone("Torso");
    const paint = paintOf(look.paint);
    this.guns = t.guns.map((g, i) => {
      const m = new THREE.Mesh(gunGeometry(g, paint), this.material);
      m.matrixAutoUpdate = false;
      m.matrix.copy(g.matrix);
      m.visible = i === 0;
      (mesh.skeleton.bones.find((b) => b.name === g.parent) ?? model.getObjectByName(g.parent)!).add(m);
      return m;
    });
    if (look.hat !== "helmet") this.attach(this.head, t.hat, (k) => hatKit(look.hat, OUTFITS[team], 0, k));
    this.bomb = this.attach(this.back, t.bomb, bombKit);
    this.bomb.visible = false;
    this.muzzles = t.guns.map((g) => g.muzzle);
    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of t.clips) this.actions.set(clip.name as Clip, this.mixer.clipAction(clip));
    const death = this.actions.get("Death")!;
    death.setLoop(THREE.LoopOnce, 1);
    death.clampWhenFinished = true;
    this.play("Idle_Shoot", 0);
  }

  private play(name: Clip, fade = 0.15): void {
    const next = this.actions.get(name)!;
    if (next === this.current) return;
    next.reset().play();
    if (this.current) next.crossFadeFrom(this.current, fade, false);
    this.current = next;
  }

  /** Dev: hold one clip, for looking at the kit's animations. */
  hold(name: string, time: number): void {
    this.play(name as Clip, 0);
    this.mixer.setTime(time);
  }

  setWeapon(i: number): void {
    if (i === this.weapon || !this.guns[i]) return;
    this.guns[this.weapon].visible = false;
    this.guns[i].visible = true;
    this.weapon = i;
  }

  /** speed in m/s on the ground; pitch: where they look, positive up. */
  update(dt: number, s: { speed: number; crouched: boolean; alive: boolean; airborne: boolean; pitch: number }): void {
    if (!s.alive) this.play("Death", 0.1);
    else if (s.crouched) this.play("Duck");
    else if (s.airborne) this.play("Jump_Idle");
    else if (s.speed > 3.4) this.play("Run_Gun");
    else if (s.speed > 0.5) this.play("Walk_Shoot");
    else this.play("Idle_Shoot");
    // the kit's duck leans 0.46 m forward and stands 1.33 m tall: shrink it to the crouched hitbox and
    // move it back so the head is over the feet, where the server puts the head
    this.crouch += ((s.crouched && s.alive ? 1 : 0) - this.crouch) * Math.min(1, dt * 12);
    this.model.position.z = this.crouch * 0.42;
    this.model.scale.setScalar(this.scale * (1 - 0.1 * this.crouch));
    const run = this.actions.get("Run_Gun")!;
    run.timeScale = Math.max(0.6, Math.min(1.4, s.speed / 5.5));
    this.mixer.update(dt);
    if (s.alive) { // lean the upper body to aim up and down
      this.spine.rotation.x -= s.pitch * 0.35;
      this.chest.rotation.x -= s.pitch * 0.35;
    }
  }

  muzzle(out: THREE.Vector3): THREE.Vector3 {
    const gun = this.guns[this.weapon];
    gun.updateWorldMatrix(true, false);
    return out.copy(this.muzzles[this.weapon]).applyMatrix4(gun.matrixWorld);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.material.dispose();
    this.root.traverse((o) => { if (o instanceof THREE.Mesh && !(o instanceof THREE.SkinnedMesh) && !this.guns.includes(o)) o.geometry.dispose(); });
  }
}
