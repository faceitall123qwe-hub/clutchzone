import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MAP, type Kind } from "../shared/map.ts";

const COLORS: Record<Kind, number> = {
  floor: 0xb9a27a,
  wall: 0xd8c9a8,
  block: 0xc9b48f,
  crate: 0x8a6239,
  metal: 0x6f7e8c,
  step: 0xa89470,
};

/** Grid texture so distances and movement read clearly on flat blockout surfaces. */
function gridTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = "rgba(0,0,0,0.13)";
  g.lineWidth = 2;
  g.strokeRect(1, 1, 126, 126);
  g.strokeStyle = "rgba(0,0,0,0.05)";
  g.beginPath();
  g.moveTo(64, 0); g.lineTo(64, 128); g.moveTo(0, 64); g.lineTo(128, 64);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Box geometry whose UVs are in metres, so the 1 m grid stays square on every face. */
function boxGeometry(sx: number, sy: number, sz: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  // BoxGeometry faces in order: +x, -x, +y, -y, +z, -z; 4 vertices each
  const dims: [number, number][] = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++)
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]);
    }
  return g;
}

export function buildWorld(scene: THREE.Scene): void {
  const grid = gridTexture();
  const materials = new Map<Kind, THREE.MeshStandardMaterial>();
  for (const [kind, color] of Object.entries(COLORS) as [Kind, number][])
    materials.set(kind, new THREE.MeshStandardMaterial({ color, map: grid, roughness: 0.9 }));

  // One mesh per material: the static map costs a handful of draw calls however many boxes it has.
  const byKind = new Map<Kind, THREE.BufferGeometry[]>();
  for (const b of MAP) {
    const sx = b.max[0] - b.min[0], sy = b.max[1] - b.min[1], sz = b.max[2] - b.min[2];
    const g = boxGeometry(sx, sy, sz);
    g.translate((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    byKind.set(b.kind, [...(byKind.get(b.kind) ?? []), g]);
  }
  for (const [kind, geos] of byKind) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), materials.get(kind));
    for (const g of geos) g.dispose();
    mesh.castShadow = kind !== "floor";
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  scene.background = new THREE.Color(0x9fc3e0);
  scene.fog = new THREE.Fog(0x9fc3e0, 40, 110);
  scene.add(new THREE.HemisphereLight(0xdfeeff, 0x8a7558, 1.4));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
  sun.position.set(18, 30, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, far: 80 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);
}
