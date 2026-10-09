import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { PAINTS, type Paint } from "./cosmetics";
import { toon } from "./toon";

/** Procedural low-poly models. Parts are coloured per vertex and merged per surface type, so a
 * whole gun or soldier costs one or two draw calls. */
type Surface = "metal" | "matte" | "glass";
type V3 = [number, number, number];

export class Kit {
  readonly parts: { geo: THREE.BufferGeometry; surface: Surface }[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly dummy = new THREE.Object3D();

  private add(geo: THREE.BufferGeometry, color: number, surface: Surface): void {
    const c = new THREE.Color(color);
    const n = geo.getAttribute("position").count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    if (geo.index) geo = geo.toNonIndexed();
    this.parts.push({ geo, surface });
  }

  box(color: number, size: V3, pos: V3, rot: V3 = [0, 0, 0], surface: Surface = "matte"): this {
    const g = new THREE.BoxGeometry(...size);
    g.applyMatrix4(this.m.compose(new THREE.Vector3(...pos), this.q.setFromEuler(this.e.set(...rot)), new THREE.Vector3(1, 1, 1)));
    this.add(g, color, surface);
    return this;
  }

  /** Cylinder along Z (a barrel) unless rot says otherwise. */
  cyl(color: number, r: number, len: number, pos: V3, rot: V3 = [Math.PI / 2, 0, 0], surface: Surface = "metal", sides = 10): this {
    const g = new THREE.CylinderGeometry(r, r, len, sides);
    g.applyMatrix4(this.m.compose(new THREE.Vector3(...pos), this.q.setFromEuler(this.e.set(...rot)), new THREE.Vector3(1, 1, 1)));
    this.add(g, color, surface);
    return this;
  }

  /** A box stretched from a to b (limbs). */
  beam(color: number, w: number, h: number, a: V3, b: V3, surface: Surface = "matte"): this {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b);
    const g = new THREE.BoxGeometry(w, h, from.distanceTo(to));
    this.dummy.position.copy(from).add(to).multiplyScalar(0.5);
    this.dummy.lookAt(to);
    this.dummy.updateMatrix();
    g.applyMatrix4(this.dummy.matrix);
    this.add(g, color, surface);
    return this;
  }

  /** A round limb from a to b. */
  limb(color: number, r: number, a: V3, b: V3, surface: Surface = "matte"): this {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b);
    const g = new THREE.CylinderGeometry(r, r * 1.1, from.distanceTo(to), 8);
    g.rotateX(Math.PI / 2);
    this.dummy.position.copy(from).add(to).multiplyScalar(0.5);
    this.dummy.lookAt(to);
    this.dummy.updateMatrix();
    g.applyMatrix4(this.dummy.matrix);
    this.add(g, color, surface);
    return this;
  }

  sphere(color: number, r: number, pos: V3, surface: Surface = "metal"): this {
    const g = new THREE.SphereGeometry(r, 8, 6);
    g.translate(...pos);
    this.add(g, color, surface);
    return this;
  }

  /** One mesh per surface type. */
  build(materials: Record<Surface, THREE.Material>): THREE.Group {
    const group = new THREE.Group();
    for (const surface of ["metal", "matte", "glass"] as Surface[]) {
      const geos = this.parts.filter((p) => p.surface === surface).map((p) => p.geo);
      if (!geos.length) continue;
      const mesh = new THREE.Mesh(mergeGeometries(geos), materials[surface]);
      mesh.castShadow = true;
      group.add(mesh);
    }
    for (const p of this.parts) p.geo.dispose();
    return group;
  }

  /** Everything in one mesh with one material (third-person models). */
  buildSingle(material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(mergeGeometries(this.parts.map((p) => p.geo)), material);
    for (const p of this.parts) p.geo.dispose();
    mesh.castShadow = true;
    return mesh;
  }
}

export const viewMaterials = (): Record<Surface, THREE.Material> => ({
  metal: toon({ vertexColors: true }),
  matte: toon({ vertexColors: true }),
  glass: toon({ vertexColors: true, emissive: 0x3a88c8 }),
});

/** Where the hands hold a gun, relative to its origin (the middle of the receiver). */
export type GunSpec = { muzzle: THREE.Vector3; rightHand: V3; leftHand: V3 };

/** paint: the colours of the metal, the dark parts, the wood and the sniper's body. */
export function gunKit(id: number, k = new Kit(), c: Paint = PAINTS[0]): GunSpec {
  if (id === 1) {
    // P-9 pistol
    k.box(c.metal, [0.032, 0.04, 0.2], [0, 0, 0], undefined, "metal"); // slide
    for (let i = 0; i < 4; i++) k.box(c.dark, [0.034, 0.028, 0.004], [0, 0.002, 0.055 + i * 0.011]);
    k.cyl(c.dark, 0.008, 0.02, [0, 0.002, -0.105]);
    k.box(c.dark, [0.03, 0.03, 0.17], [0, -0.033, -0.01]); // frame
    k.box(c.dark, [0.03, 0.12, 0.05], [0, -0.1, 0.065], [-0.25, 0, 0]); // grip
    k.box(c.dark, [0.008, 0.008, 0.05], [0, -0.066, 0.0]);
    k.box(c.dark, [0.008, 0.03, 0.008], [0, -0.055, -0.026]);
    k.box(c.dark, [0.025, 0.012, 0.01], [0, 0.026, 0.09]);
    k.box(0xd8d8d0, [0.006, 0.01, 0.008], [0, 0.025, -0.09]);
    k.box(c.metal, [0.032, 0.012, 0.055], [0, -0.16, 0.08], [-0.25, 0, 0], "metal");
    return { muzzle: new THREE.Vector3(0, 0.002, -0.118), rightHand: [0, -0.1, 0.065], leftHand: [-0.02, -0.12, 0.055] };
  }
  if (id === 2) {
    // Longbow bolt-action sniper rifle
    k.cyl(c.metal, 0.022, 0.24, [0, 0, 0]); // receiver
    k.cyl(c.metal, 0.011, 0.62, [0, 0, -0.43], undefined, "metal", 8); // barrel
    k.box(c.dark, [0.036, 0.03, 0.07], [0, 0, -0.77], undefined, "metal"); // muzzle brake
    k.box(c.accent, [0.06, 0.055, 0.34], [0, -0.035, -0.28]); // forend
    k.box(c.accent, [0.056, 0.07, 0.2], [0, -0.04, 0]);
    k.box(c.accent, [0.05, 0.1, 0.3], [0, -0.045, 0.3]); // stock
    k.box(c.accent, [0.04, 0.03, 0.16], [0, 0.02, 0.32]); // cheek rest
    k.box(c.dark, [0.052, 0.13, 0.025], [0, -0.05, 0.46]); // butt pad
    k.box(c.accent, [0.035, 0.1, 0.045], [0, -0.11, 0.13], [-0.3, 0, 0]); // grip
    k.box(c.dark, [0.04, 0.07, 0.08], [0, -0.1, -0.02], undefined, "metal"); // magazine
    k.cyl(c.metal, 0.005, 0.06, [0.045, 0, 0.07], [0, 0, Math.PI / 2]); // bolt handle
    k.sphere(c.dark, 0.012, [0.077, -0.004, 0.07]);
    k.cyl(c.dark, 0.019, 0.3, [0, 0.075, 0], undefined, "metal", 12); // scope tube
    k.cyl(c.dark, 0.028, 0.07, [0, 0.075, -0.17], undefined, "metal", 12);
    k.cyl(c.dark, 0.024, 0.05, [0, 0.075, 0.16], undefined, "metal", 12);
    k.cyl(c.dark, 0.012, 0.03, [0, 0.1, 0], [0, 0, 0]); // turret
    k.cyl(c.dark, 0.012, 0.03, [0.025, 0.075, 0], [0, 0, Math.PI / 2]);
    k.box(c.dark, [0.03, 0.05, 0.02], [0, 0.045, -0.08], undefined, "metal");
    k.box(c.dark, [0.03, 0.05, 0.02], [0, 0.045, 0.08], undefined, "metal");
    k.cyl(0x3a6a8a, 0.024, 0.003, [0, 0.075, -0.206], undefined, "glass", 12);
    return { muzzle: new THREE.Vector3(0, 0, -0.81), rightHand: [0, -0.11, 0.13], leftHand: [0, -0.07, -0.3] };
  }
  // AR-7 assault rifle
  k.box(c.metal, [0.06, 0.08, 0.4], [0, 0, 0], undefined, "metal"); // receiver
  k.cyl(c.metal, 0.03, 0.36, [0, 0.035, 0.01], undefined, "metal", 12); // dust cover
  k.box(c.dark, [0.03, 0.025, 0.05], [0, 0.07, -0.14], undefined, "metal"); // rear sight
  k.box(c.wood, [0.066, 0.06, 0.2], [0, -0.005, -0.31]); // handguard
  k.box(c.wood, [0.05, 0.036, 0.18], [0, 0.045, -0.3]);
  k.cyl(c.metal, 0.012, 0.34, [0, 0.01, -0.56], undefined, "metal", 8); // barrel
  k.cyl(c.metal, 0.018, 0.04, [0, 0.01, -0.66]);
  k.box(c.dark, [0.012, 0.06, 0.015], [0, 0.045, -0.66], undefined, "metal"); // front sight
  k.cyl(c.dark, 0.017, 0.07, [0, 0.01, -0.75]); // muzzle brake
  k.box(c.dark, [0.045, 0.08, 0.075], [0, -0.08, -0.07], [0.1, 0, 0], "metal"); // curved magazine
  k.box(c.dark, [0.045, 0.08, 0.075], [0, -0.15, -0.095], [0.3, 0, 0], "metal");
  k.box(c.dark, [0.045, 0.08, 0.075], [0, -0.215, -0.14], [0.5, 0, 0], "metal");
  k.box(c.dark, [0.01, 0.01, 0.07], [0, -0.075, 0.04], undefined, "metal"); // trigger guard
  k.box(c.wood, [0.04, 0.11, 0.05], [0, -0.085, 0.1], [-0.3, 0, 0]); // grip
  k.box(c.wood, [0.046, 0.075, 0.26], [0, -0.03, 0.33], [0.08, 0, 0]); // stock
  k.box(c.dark, [0.05, 0.12, 0.02], [0, -0.05, 0.46], undefined, "metal");
  return { muzzle: new THREE.Vector3(0, 0.01, -0.79), rightHand: [0, -0.1, 0.1], leftHand: [0, -0.04, -0.32] };
}

const GLOVE = 0x2b2d36, SLEEVE = 0xd9a95c;

/** First-person hands and forearms reaching the gun from outside the screen. */
export function handsKit(spec: GunSpec, k: Kit): void {
  const [rx, ry, rz] = spec.rightHand, [lx, ly, lz] = spec.leftHand;
  k.box(GLOVE, [0.07, 0.085, 0.09], [rx + 0.02, ry - 0.01, rz + 0.005]);
  k.limb(GLOVE, 0.036, [rx + 0.03, ry - 0.03, rz + 0.04], [rx + 0.06, ry - 0.07, rz + 0.1]);
  k.limb(SLEEVE, 0.045, [rx + 0.06, ry - 0.07, rz + 0.1], [rx + 0.17, ry - 0.24, rz + 0.42]);
  k.box(GLOVE, [0.075, 0.06, 0.1], [lx - 0.015, ly - 0.035, lz]);
  k.limb(GLOVE, 0.036, [lx - 0.03, ly - 0.06, lz + 0.03], [lx - 0.06, ly - 0.1, lz + 0.08]);
  k.limb(SLEEVE, 0.045, [lx - 0.06, ly - 0.1, lz + 0.08], [lx - 0.2, ly - 0.32, lz + 0.35]);
}

export type Outfit = { uniform: number; vest: number; pants: number; helmet: number; skin: number };
export const OUTFITS: Outfit[] = [
  { uniform: 0xf2a33a, vest: 0xb4561e, pants: 0x6b4428, helmet: 0xf07c22, skin: 0xffc79a },
  { uniform: 0x4d9cf0, vest: 0x1f4f9a, pants: 0x283a5c, helmet: 0x2f7fe0, skin: 0xe8b088 },
];

/** Shooting-range targets: hard to miss. */
export const TARGET_OUTFIT: Outfit = { uniform: 0xf0483c, vest: 0x9c1f1a, pants: 0x3a4152, helmet: 0xc8241c, skin: 0xffc79a };

/** Soldier without legs, fitted to the hitboxes (feet at 0, facing -Z). h: standing or crouched height.
 * Returns the shoulder height, where the arms and gun pivot with the view pitch. */
export function torsoKit(o: Outfit, h: number, k: Kit, hat = "helmet"): number {
  const legsTop = h * 0.45, headBottom = h - 0.28;
  k.box(o.pants, [0.42, 0.16, 0.24], [0, legsTop + 0.06, 0]);
  const chest = headBottom - legsTop - 0.12;
  k.box(o.uniform, [0.46, chest, 0.26], [0, legsTop + 0.12 + chest / 2, 0]);
  k.box(o.vest, [0.5, chest * 0.7, 0.3], [0, legsTop + 0.14 + chest * 0.4, 0]);
  k.box(o.vest, [0.12, 0.08, 0.04], [-0.12, legsTop + 0.12 + chest * 0.3, -0.16]); // pouches
  k.box(o.vest, [0.12, 0.08, 0.04], [0.12, legsTop + 0.12 + chest * 0.3, -0.16]);
  k.box(o.skin, [0.1, 0.06, 0.1], [0, headBottom + 0.01, 0]); // neck
  k.box(o.skin, [0.21, 0.22, 0.22], [0, headBottom + 0.13, 0]); // head
  k.box(0x1d1d1d, [0.17, 0.04, 0.02], [0, headBottom + 0.16, -0.112]); // goggles band
  hatKit(hat, o, headBottom + 0.24, k);
  return headBottom - 0.06;
}

/** What's on the head; y: the top of the head. Purely cosmetic: the head hitbox doesn't change. */
export function hatKit(hat: string, o: Outfit, y: number, k: Kit): void {
  if (hat === "beanie") {
    k.box(0xe2433a, [0.24, 0.1, 0.25], [0, y + 0.03, 0.005]);
    k.box(0xf4f4f4, [0.25, 0.04, 0.26], [0, y - 0.03, 0.005]);
    k.sphere(0xf4f4f4, 0.045, [0, y + 0.1, 0.005], "matte");
  } else if (hat === "cap") {
    k.box(o.helmet, [0.23, 0.08, 0.24], [0, y + 0.02, 0.01]);
    k.box(o.helmet, [0.21, 0.02, 0.14], [0, y - 0.01, -0.16]);
  } else if (hat === "cowboy") {
    k.box(0x8a5a2b, [0.2, 0.13, 0.2], [0, y + 0.07, 0]);
    k.box(0x5a3a1b, [0.21, 0.03, 0.21], [0, y + 0.02, 0]);
    k.box(0x8a5a2b, [0.46, 0.025, 0.44], [0, y - 0.01, 0]);
  } else if (hat === "viking") {
    k.box(0x9aa4b0, [0.25, 0.09, 0.26], [0, y, 0.005], undefined, "metal");
    k.box(0x9aa4b0, [0.27, 0.03, 0.29], [0, y - 0.04, 0.01], undefined, "metal");
    k.beam(0xf2e6c8, 0.05, 0.05, [0.12, y + 0.02, 0], [0.24, y + 0.16, -0.02]);
    k.beam(0xf2e6c8, 0.05, 0.05, [-0.12, y + 0.02, 0], [-0.24, y + 0.16, -0.02]);
  } else if (hat === "tophat") {
    k.box(0x1c1c22, [0.18, 0.24, 0.18], [0, y + 0.12, 0]);
    k.box(0xd23a3a, [0.185, 0.04, 0.185], [0, y + 0.03, 0]);
    k.box(0x1c1c22, [0.3, 0.02, 0.3], [0, y - 0.01, 0]);
  } else if (hat === "crown") {
    k.box(0xffcc33, [0.24, 0.07, 0.24], [0, y + 0.01, 0], undefined, "metal");
    for (const [x, z] of [[-0.1, -0.1], [0.1, -0.1], [-0.1, 0.1], [0.1, 0.1], [0, -0.1], [0, 0.1]])
      k.box(0xffcc33, [0.045, 0.08, 0.045], [x, y + 0.08, z], undefined, "metal");
    k.box(0xe2233a, [0.05, 0.04, 0.02], [0, y + 0.02, -0.125], undefined, "glass");
  } else {
    k.box(o.helmet, [0.25, 0.09, 0.26], [0, y, 0.005]);
    k.box(o.helmet, [0.27, 0.03, 0.29], [0, y - 0.04, 0.01]);
  }
}

/** Arms and gun, around the shoulder pivot (pitch rotates them together). */
export function armsKit(o: Outfit, gun: number, k: Kit, paint: Paint = PAINTS[0]): GunSpec {
  const before = k.parts.length;
  const spec = gunKit(gun, k, paint);
  const g = new THREE.Vector3(0.12, -0.08, -0.32); // gun origin relative to the shoulders
  for (const p of k.parts.slice(before)) p.geo.translate(g.x, g.y, g.z);
  const [rx, ry, rz] = spec.rightHand, [lx, ly, lz] = spec.leftHand;
  k.beam(o.uniform, 0.1, 0.1, [0.24, 0, 0.02], [g.x + rx + 0.06, g.y + ry - 0.02, g.z + rz + 0.08]);
  k.box(GLOVE, [0.07, 0.09, 0.09], [g.x + rx + 0.02, g.y + ry, g.z + rz]);
  k.beam(o.uniform, 0.1, 0.1, [-0.24, 0, 0.02], [g.x + lx - 0.04, g.y + ly - 0.05, g.z + lz + 0.05]);
  k.box(GLOVE, [0.07, 0.07, 0.1], [g.x + lx - 0.01, g.y + ly - 0.03, g.z + lz]);
  return { ...spec, muzzle: spec.muzzle.clone().add(g) };
}

/** One leg hanging from the hip at the origin. Crouched legs kneel: thigh forward, shin down. */
export function legKit(o: Outfit, h: number, crouched: boolean, k: Kit): void {
  const legsTop = h * 0.45;
  if (crouched) {
    k.box(o.pants, [0.17, 0.17, 0.4], [0, 0, -0.14]);
    k.box(o.pants, [0.16, legsTop - 0.08, 0.17], [0, -(legsTop - 0.08) / 2, -0.3]);
    k.box(0x2b2722, [0.17, 0.1, 0.26], [0, -legsTop + 0.05, -0.33]);
    return;
  }
  k.box(o.pants, [0.17, legsTop - 0.1, 0.19], [0, -(legsTop - 0.1) / 2, 0]);
  k.box(0x2b2722, [0.18, 0.12, 0.27], [0, -legsTop + 0.06, -0.03]);
}

/** The bomb: a charge with a keypad and a light, about the size of a shoebox. Origin at its bottom centre. */
export function bombKit(k: Kit): void {
  k.box(0x3b3f2e, [0.3, 0.1, 0.2], [0, 0.05, 0]);
  k.box(0x2a2a26, [0.32, 0.03, 0.05], [0, 0.03, -0.07]); // straps
  k.box(0x2a2a26, [0.32, 0.03, 0.05], [0, 0.03, 0.07]);
  k.box(0x161616, [0.14, 0.012, 0.11], [0.05, 0.106, 0], undefined, "metal"); // keypad
  k.box(0x2f6a3a, [0.08, 0.006, 0.04], [-0.07, 0.103, -0.03], undefined, "glass"); // display
  k.box(0xb02a20, [0.012, 0.012, 0.18], [-0.1, 0.11, 0.02]); // wires
  k.box(0x2050b0, [0.012, 0.012, 0.18], [-0.12, 0.11, 0.02]);
}
