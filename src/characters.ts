import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { WEAPONS } from "../shared/weapons.ts";
import { decodeLook, paintOf, type Look } from "./cosmetics";
import { armsKit, bombKit, hatKit, Kit, OUTFITS } from "./models";
import { TEAM_MARK } from "./toon";

/**
 * The cyber troopers: dark armour, team-coloured lights (visor, chest, knees, backpack) and a rim of
 * team colour around the silhouette, so a player stands out on any neon map. The body is one skinned
 * mesh built in code (each part follows one bone), the arms and the gun in hand another mesh that turns
 * with the aim. Every pose is computed here, not played from clips: the stride follows the distance
 * actually covered, so the feet don't slide.
 */
export const TEAM_GLOW = [0xff6a1f, 0x46a6ff];
const TEAM_ARMOR = [0x5a3f36, 0x3d5590]; // armour plates leaning towards the team colour
const SUIT = 0x1d2130, DARK = 0x11131b;

/** Lights in the vertex attribute `glow` shine by themselves; a fresnel rim in the team colour outlines
 * the whole soldier. glowScale dims both when they die. The alpha left in the outline target marks the team. */
export function glowMaterial(team: number): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  const uniforms = { rim: { value: new THREE.Color(TEAM_GLOW[team]) }, glowScale: { value: 1 }, mark: { value: TEAM_MARK[team] } };
  m.userData.uniforms = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float glow;\nvarying float vGlow;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGlow = glow;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vGlow;\nuniform vec3 rim;\nuniform float glowScale, mark;")
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * vGlow * 2.0 * glowScale;
        float fres = 1.0 - abs(dot(normalize(vViewPosition), normal));
        totalEmissiveRadiance += rim * pow(fres, 2.0) * 1.1 * glowScale;`)
      .replace("#include <opaque_fragment>", "#include <opaque_fragment>\ngl_FragColor.a = mark;");
  };
  m.customProgramCacheKey = () => "glow";
  return m;
}

// the skeleton at rest, standing, facing -Z: [name, parent, x, y, z] (position relative to the parent)
const BONES: [string, number, number, number, number][] = [
  ["root", -1, 0, 0, 0],
  ["hips", 0, 0, 0.94, 0],
  ["thighR", 1, 0.11, -0.02, 0], ["shinR", 2, 0, -0.43, 0], ["footR", 3, 0, -0.41, 0],
  ["thighL", 1, -0.11, -0.02, 0], ["shinL", 5, 0, -0.43, 0], ["footL", 6, 0, -0.41, 0],
  ["spine", 1, 0, 0.08, 0], ["chest", 8, 0, 0.3, 0], ["head", 9, 0, 0.2, 0], ["aim", 9, 0, 0.1, 0],
];
const B = Object.fromEntries(BONES.map(([n], i) => [n, i])) as Record<string, number>;

/** The body in the rest pose, each part bound to one bone; one per team (the lights' colour). */
const bodies = new Map<number, THREE.BufferGeometry>();
function body(team: number): THREE.BufferGeometry {
  let g = bodies.get(team);
  if (g) return g;
  const glow = TEAM_GLOW[team], ARMOR = TEAM_ARMOR[team];
  const parts: { k: Kit; bone: number }[] = [];
  const part = (bone: string, build: (k: Kit) => void) => { const k = new Kit(); build(k); parts.push({ k, bone: B[bone] }); };
  for (const [s, side] of [[1, "R"], [-1, "L"]] as const) {
    const x = 0.11 * s;
    part(`foot${side}`, (k) => k.box(DARK, [0.13, 0.1, 0.27], [x, 0.05, -0.03]).box(ARMOR, [0.135, 0.04, 0.12], [x, 0.11, -0.1]));
    part(`shin${side}`, (k) => k.box(SUIT, [0.12, 0.36, 0.14], [x, 0.29, 0]).box(ARMOR, [0.13, 0.26, 0.05], [x, 0.3, -0.08])
      .box(ARMOR, [0.13, 0.1, 0.06], [x, 0.47, -0.08]).box(glow, [0.08, 0.025, 0.01], [x, 0.46, -0.112], undefined, "glass"));
    part(`thigh${side}`, (k) => k.box(SUIT, [0.16, 0.4, 0.18], [x, 0.71, 0]).box(ARMOR, [0.13, 0.2, 0.04], [x, 0.74, -0.1])
      .box(ARMOR, [0.05, 0.22, 0.12], [x + 0.07 * s, 0.72, 0]));
  }
  part("hips", (k) => k.box(SUIT, [0.36, 0.16, 0.22], [0, 0.94, 0]).box(DARK, [0.38, 0.05, 0.24], [0, 1.0, 0])
    .box(ARMOR, [0.08, 0.08, 0.05], [0.12, 0.96, -0.13]).box(ARMOR, [0.08, 0.08, 0.05], [-0.12, 0.96, -0.13]));
  part("spine", (k) => k.box(SUIT, [0.32, 0.22, 0.2], [0, 1.12, 0]).box(ARMOR, [0.26, 0.12, 0.04], [0, 1.12, -0.11]));
  part("chest", (k) => {
    k.box(ARMOR, [0.44, 0.34, 0.27], [0, 1.34, 0]).box(SUIT, [0.3, 0.07, 0.22], [0, 1.5, 0]);
    k.box(glow, [0.05, 0.22, 0.012], [0, 1.33, -0.14], undefined, "glass");
    k.box(glow, [0.14, 0.025, 0.012], [-0.12, 1.42, -0.14], [0, 0, 0.35], "glass");
    k.box(glow, [0.14, 0.025, 0.012], [0.12, 1.42, -0.14], [0, 0, -0.35], "glass");
    k.box(DARK, [0.3, 0.32, 0.13], [0, 1.33, 0.19]); // backpack
    k.box(glow, [0.2, 0.025, 0.01], [0, 1.4, 0.258], undefined, "glass").box(glow, [0.2, 0.025, 0.01], [0, 1.3, 0.258], undefined, "glass");
    for (const s of [1, -1]) k.box(ARMOR, [0.16, 0.1, 0.24], [0.27 * s, 1.47, 0]).box(glow, [0.02, 0.03, 0.2], [0.355 * s, 1.47, 0], undefined, "glass");
  });
  part("head", (k) => {
    k.box(SUIT, [0.11, 0.08, 0.11], [0, 1.52, 0]);
    k.box(ARMOR, [0.25, 0.24, 0.27], [0, 1.645, 0.005]).box(ARMOR, [0.07, 0.04, 0.22], [0, 1.775, 0.01]);
    k.box(DARK, [0.23, 0.09, 0.03], [0, 1.645, -0.128]);
    k.box(glow, [0.21, 0.045, 0.012], [0, 1.65, -0.144], undefined, "glass");
    for (const s of [1, -1]) k.box(glow, [0.015, 0.06, 0.07], [0.128 * s, 1.63, 0], undefined, "glass");
  });
  const geos = parts.flatMap(({ k, bone }) => k.parts.map((p) => {
    const geo = p.geo, n = geo.getAttribute("position").count;
    geo.deleteAttribute("uv");
    geo.setAttribute("glow", new THREE.BufferAttribute(new Float32Array(n).fill(p.surface === "glass" ? 1 : 0), 1));
    const idx = new Uint16Array(n * 4), w = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { idx[i * 4] = bone; w[i * 4] = 1; }
    geo.setAttribute("skinIndex", new THREE.BufferAttribute(idx, 4));
    geo.setAttribute("skinWeight", new THREE.BufferAttribute(w, 4));
    return geo;
  }));
  g = mergeGeometries(geos);
  for (const x of geos) x.dispose();
  bodies.set(team, g);
  return g;
}

/** Arms and gun for a weapon in a paint: they hang from the aim bone, origin at the shoulders. */
const armsCache = new Map<string, { geo: THREE.BufferGeometry; muzzle: THREE.Vector3 }>();
function arms(team: number, weapon: number, paint: string) {
  const key = `${team}.${weapon}.${paint}`;
  let a = armsCache.get(key);
  if (!a) {
    const k = new Kit();
    const muzzle = armsKit({ ...OUTFITS[team], uniform: SUIT }, weapon, k, paintOf(paint)).muzzle;
    a = { geo: k.buildSingle(new THREE.MeshBasicMaterial()).geometry, muzzle };
    armsCache.set(key, a);
  }
  return a;
}

/** speed: m/s on the ground; forward / right: the share of it along their facing and to their right. */
export type Pose = { speed: number; forward: number; right: number; crouched: boolean; alive: boolean; airborne: boolean; pitch: number };

/** One trooper: feet at the origin, facing -Z. */
export class Soldier {
  readonly root = new THREE.Group();
  readonly material: THREE.MeshLambertMaterial;
  readonly bomb: THREE.Mesh;
  private readonly bones: THREE.Bone[];
  private readonly guns: THREE.Mesh[];
  private readonly muzzles: THREE.Vector3[];
  private readonly model = new THREE.Group();
  private weapon = 0;
  private phase = 0;
  private crouch = 0;
  private air = 0;
  private dead = 0;
  private kickT = 0;
  private flinchT = 0;
  private stride = 0;
  private t = Math.random() * 10;

  constructor(team: number, look: Look = decodeLook("")) {
    this.material = glowMaterial(team);
    this.bones = BONES.map(([name, , x, y, z]) => {
      const b = new THREE.Bone();
      b.name = name;
      b.position.set(x, y, z);
      return b;
    });
    BONES.forEach(([, parent], i) => { if (parent >= 0) this.bones[parent].add(this.bones[i]); });
    const mesh = new THREE.SkinnedMesh(body(team), this.material);
    mesh.frustumCulled = false; // the bounds don't follow the pose
    mesh.add(this.bones[0]);
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(this.bones));
    this.model.add(mesh);
    this.root.add(this.model);

    const aim = this.bones[B.aim];
    this.guns = WEAPONS.map((_, w) => {
      const m = new THREE.Mesh(arms(team, w, look.paint).geo, this.material);
      m.visible = w === 0;
      aim.add(m);
      return m;
    });
    this.muzzles = WEAPONS.map((_, w) => arms(team, w, look.paint).muzzle);
    if (look.hat !== "helmet") this.attach(B.head, 0, 0.265, 0, (k) => hatKit(look.hat, OUTFITS[team], 0, k));
    this.bomb = this.attach(B.chest, 0, 0.02, 0.27, bombKit);
    this.bomb.rotation.x = Math.PI / 2;
    this.bomb.visible = false;
  }

  /** A procedural part (hat, bomb) on a bone, offset from it. */
  private attach(bone: number, x: number, y: number, z: number, make: (k: Kit) => void): THREE.Mesh {
    const k = new Kit();
    make(k);
    const m = k.buildSingle(this.material);
    m.position.set(x, y, z);
    this.bones[bone].add(m);
    return m;
  }

  setWeapon(i: number): void {
    if (i === this.weapon || !this.guns[i]) return;
    this.guns[this.weapon].visible = false;
    this.guns[i].visible = true;
    this.weapon = i;
  }

  /** The gun kicks back (another player fired). */
  kick(): void { this.kickT = 1; }

  /** Hit: a short jolt. */
  flinch(): void { this.flinchT = 1; }

  update(dt: number, s: Pose): void {
    this.t += dt;
    const k = (rate: number) => Math.min(1, dt * rate);
    this.crouch += ((s.crouched && s.alive ? 1 : 0) - this.crouch) * k(12);
    this.air += ((s.airborne && s.alive ? 1 : 0) - this.air) * k(10);
    this.dead = s.alive ? 0 : Math.min(1, this.dead + dt / 0.55);
    this.kickT = Math.max(0, this.kickT - dt * 9);
    this.flinchT = Math.max(0, this.flinchT - dt * 6);

    // the stride: a step every 0.55-0.9 m depending on speed; both legs swing opposite ways
    const run = Math.min(1, s.speed / 6), moving = Math.min(1, s.speed / 1.2) * (1 - this.air);
    this.stride += (moving - this.stride) * k(8);
    this.phase += ((s.speed * dt) / (0.55 + 0.35 * run)) * Math.PI;
    const amp = this.stride * (0.32 + 0.38 * run) * (1 - 0.6 * this.crouch);
    const fwd = s.speed > 0.3 ? s.forward : 1, side = s.speed > 0.3 ? s.right : 0;
    const b = this.bones;
    for (const [leg, off] of [[0, 0], [3, Math.PI]] as const) {
      const p = this.phase + off, swing = Math.sin(p);
      // a forward swing is a negative angle about X; the knee bends while the leg comes forward
      const lift = Math.max(0, Math.cos(p)) * this.stride * (0.5 + 0.7 * run);
      b[B.thighR + leg].rotation.set(-swing * amp * fwd - this.crouch * 1.15 - this.air * 0.7, 0, swing * amp * side * 0.6);
      b[B.shinR + leg].rotation.set(lift + this.crouch * 2.3 + this.air * 1.2, 0, 0);
      b[B.footR + leg].rotation.set(-lift * 0.4 - this.crouch * 1.15 - this.air * 0.4, 0, 0);
    }
    // hips go down when crouching (to the crouched hitbox height) and bob with the steps
    const bob = Math.abs(Math.sin(this.phase)) * 0.035 * this.stride * run;
    b[B.hips].position.y = 0.94 - this.crouch * 0.5 + bob - this.air * 0.08;
    b[B.hips].rotation.y = Math.sin(this.phase) * 0.06 * this.stride;
    // upper body: lean into a run, look up and down, breathe, jolt when hit
    const look = s.alive ? s.pitch : 0, breathe = Math.sin(this.t * 2.1) * 0.012;
    b[B.spine].rotation.set(-0.12 * run * this.stride - this.crouch * 0.42 - look * 0.25 + this.flinchT * 0.25, -b[B.hips].rotation.y, 0);
    b[B.chest].rotation.set(-look * 0.2 + breathe, 0, 0);
    b[B.head].rotation.set(-look * 0.25 + this.crouch * 0.3, 0, 0);
    b[B.aim].rotation.set(look * 0.55 + this.crouch * 0.12 + run * this.stride * 0.1 + this.kickT * 0.08, 0, 0);
    b[B.aim].position.set(0, 0.1, this.kickT * 0.05);

    // dying: the knees give, the body tips over backwards and the lights go out
    const d = this.dead * this.dead;
    this.model.rotation.x = d * 1.45;
    this.model.position.y = -d * 0.15;
    if (this.dead > 0) {
      b[B.thighR].rotation.x -= this.dead * 0.5;
      b[B.thighL].rotation.x -= this.dead * 0.3;
      b[B.shinR].rotation.x += this.dead * 0.9;
    }
    (this.material.userData.uniforms as { glowScale: { value: number } }).glowScale.value = 1 - this.dead * 0.85;
  }

  muzzle(out: THREE.Vector3): THREE.Vector3 {
    const gun = this.guns[this.weapon];
    gun.updateWorldMatrix(true, false);
    return out.copy(this.muzzles[this.weapon]).applyMatrix4(gun.matrixWorld);
  }

  dispose(): void {
    this.material.dispose();
    for (const b of this.bones)
      for (const o of b.children) if (o instanceof THREE.Mesh && !this.guns.includes(o)) o.geometry.dispose();
  }
}
