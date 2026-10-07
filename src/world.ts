import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MAP, type Kind } from "../shared/map.ts";

type Paint = (g: CanvasRenderingContext2D, s: number, rnd: () => number) => void;

/** Canvas texture; metres: how many metres one copy of it covers. */
function texture(paint: Paint, metres: number, size = 512): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  paint(g, size, rnd);
  // fine grain over everything
  const img = g.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 22;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.repeat.set(1 / metres, 1 / metres);
  return t;
}

const blotches = (g: CanvasRenderingContext2D, s: number, rnd: () => number, n: number, color: string, r: number) => {
  for (let i = 0; i < n; i++) {
    const x = rnd() * s, y = rnd() * s, rad = r * (0.4 + rnd());
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, color);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
};

/** Large sandy concrete slabs, 2 m each. */
const floor: Paint = (g, s, rnd) => {
  g.fillStyle = "#b9a783";
  g.fillRect(0, 0, s, s);
  const n = 2, w = s / n;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const v = (rnd() - 0.5) * 18;
      g.fillStyle = `rgb(${185 + v},${167 + v},${131 + v})`;
      g.fillRect(i * w + 2, j * w + 2, w - 4, w - 4);
    }
  blotches(g, s, rnd, 14, "rgba(120,100,70,0.18)", s / 6);
  blotches(g, s, rnd, 10, "rgba(230,215,180,0.15)", s / 8);
  g.strokeStyle = "rgba(60,48,32,0.55)";
  g.lineWidth = 3;
  for (let i = 0; i <= n; i++) {
    g.beginPath(); g.moveTo(i * w, 0); g.lineTo(i * w, s); g.stroke();
    g.beginPath(); g.moveTo(0, i * w); g.lineTo(s, i * w); g.stroke();
  }
};

/** Sandstone blocks, 0.6 × 0.3 m, staggered. */
const bricks: Paint = (g, s, rnd) => {
  g.fillStyle = "#8f7a5a";
  g.fillRect(0, 0, s, s);
  const cols = 4, rows = 8, bw = s / cols, bh = s / rows;
  for (let r = 0; r < rows; r++)
    for (let c = -1; c < cols; c++) {
      const x = c * bw + (r % 2 ? bw / 2 : 0), v = (rnd() - 0.5) * 26;
      g.fillStyle = `rgb(${212 + v},${190 + v},${150 + v * 0.8})`;
      g.fillRect(x + 3, r * bh + 3, bw - 6, bh - 6);
      g.fillStyle = "rgba(255,245,220,0.12)";
      g.fillRect(x + 3, r * bh + 3, bw - 6, 4);
    }
  blotches(g, s, rnd, 10, "rgba(110,85,55,0.07)", s / 5);
};

/** Stucco: warm plaster with patches where it has fallen off. */
const plaster: Paint = (g, s, rnd) => {
  g.fillStyle = "#d8c6a2";
  g.fillRect(0, 0, s, s);
  blotches(g, s, rnd, 30, "rgba(160,135,95,0.14)", s / 6);
  blotches(g, s, rnd, 20, "rgba(250,240,215,0.2)", s / 7);
  for (let i = 0; i < 4; i++) {
    const x = rnd() * s, y = rnd() * s, w = 30 + rnd() * 50, h = 16 + rnd() * 24;
    g.fillStyle = "#9b7f5c";
    g.fillRect(x, y, w, h);
    g.strokeStyle = "rgba(80,60,40,0.5)";
    g.lineWidth = 2;
    for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(x, y + (k + 1) * h / 4); g.lineTo(x + w, y + (k + 1) * h / 4); g.stroke(); }
  }
};

/** A wooden crate face: frame, planks and a diagonal brace (UVs 0..1 per face). */
const crate: Paint = (g, s, rnd) => {
  g.fillStyle = "#8a5e34";
  g.fillRect(0, 0, s, s);
  const planks = 5;
  for (let i = 0; i < planks; i++) {
    const v = (rnd() - 0.5) * 24;
    g.fillStyle = `rgb(${150 + v},${103 + v},${58 + v * 0.6})`;
    g.fillRect(0, (i * s) / planks + 2, s, s / planks - 4);
    g.strokeStyle = "rgba(70,40,15,0.25)";
    for (let k = 0; k < 6; k++) {
      const y = (i * s) / planks + rnd() * (s / planks);
      g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(s / 3, y + 4, (2 * s) / 3, y - 4, s, y); g.stroke();
    }
  }
  const f = s * 0.11;
  g.fillStyle = "#6d4523";
  g.fillRect(0, 0, s, f); g.fillRect(0, s - f, s, f); g.fillRect(0, 0, f, s); g.fillRect(s - f, 0, f, s);
  g.save();
  g.translate(s / 2, s / 2);
  g.rotate(Math.PI / 4);
  g.fillRect(-s * 0.7, -f / 2, s * 1.4, f);
  g.restore();
  g.fillStyle = "#3a3a3a";
  for (const [x, y] of [[f / 2, f / 2], [s - f / 2, f / 2], [f / 2, s - f / 2], [s - f / 2, s - f / 2]]) {
    g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill();
  }
};

/** Painted corrugated steel with scratches and rust. */
const metal: Paint = (g, s, rnd) => {
  for (let x = 0; x < s; x += 4) {
    const k = 0.75 + 0.25 * Math.sin((x / s) * Math.PI * 16);
    g.fillStyle = `rgb(${Math.round(92 * k)},${Math.round(116 * k)},${Math.round(122 * k)})`;
    g.fillRect(x, 0, 4, s);
  }
  blotches(g, s, rnd, 8, "rgba(140,80,40,0.3)", s / 10);
  g.strokeStyle = "rgba(220,230,230,0.25)";
  for (let i = 0; i < 25; i++) {
    const x = rnd() * s, y = rnd() * s;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 60, y + (rnd() - 0.5) * 20); g.stroke();
  }
};

/** Box geometry whose UVs are in metres, so textures keep their scale on every face. */
function boxGeometry(sx: number, sy: number, sz: number, metres: boolean): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  if (!metres) return g;
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

/** Darkens the bottom of walls where they meet the ground: cheap stand-in for ambient occlusion. */
function contactShade(mat: THREE.MeshStandardMaterial): void {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorldPos;\nvarying vec3 vWorldNormal;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWorldNormal = normalize(mat3(modelMatrix) * objectNormal);");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorldPos;\nvarying vec3 vWorldNormal;")
      .replace("#include <map_fragment>", `#include <map_fragment>
        float side = 1.0 - abs(vWorldNormal.y);
        diffuseColor.rgb *= mix(1.0, mix(0.35, 1.0, smoothstep(0.0, 1.4, vWorldPos.y)), side);`);
  };
}

function sky(scene: THREE.Scene, sunDir: THREE.Vector3): void {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { sun: { value: sunDir.clone().normalize() } },
    vertexShader: `varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vDir; uniform vec3 sun;
      void main() {
        float h = max(vDir.y, 0.0);
        vec3 col = mix(vec3(0.93, 0.87, 0.76), vec3(0.36, 0.58, 0.85), pow(h, 0.55));
        col = mix(col, vec3(0.75, 0.68, 0.58), smoothstep(0.0, -0.2, vDir.y));
        float s = max(dot(vDir, sun), 0.0);
        col += vec3(1.0, 0.85, 0.6) * (pow(s, 600.0) * 3.0 + pow(s, 12.0) * 0.25);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(200, 32, 16), mat);
  mesh.renderOrder = -1;
  scene.add(mesh);
}

/** A painted letter for a bomb site, faded like old spray paint. */
function siteSign(letter: string): THREE.Mesh {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.font = "900 220px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "rgba(170,30,25,0.85)";
  g.fillText(letter, 128, 140);
  g.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.6})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 3 + Math.random() * 6, 2 + Math.random() * 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4),
    new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 }));
}

/** Dark shuttered windows on the buildings: visual only, the walls stay solid. */
function windows(scene: THREE.Scene): void {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 160;
  const g = c.getContext("2d")!;
  g.fillStyle = "#6e5a40"; g.fillRect(0, 0, 128, 160);
  g.fillStyle = "#2b2622"; g.fillRect(10, 10, 108, 140);
  g.fillStyle = "#4a6470";
  for (let i = 0; i < 6; i++) g.fillRect(16, 18 + i * 22, 96, 14);
  g.fillStyle = "#5c4a34"; g.fillRect(0, 150, 128, 10);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const geos: THREE.BufferGeometry[] = [];
  const add = (x: number, z: number, ry: number) => {
    const p = new THREE.PlaneGeometry(1.1, 1.4);
    p.rotateY(ry);
    p.translate(x, 3.1, z);
    geos.push(p);
  };
  for (const z of [-5, 0, 5]) {
    add(-14.01, z, -Math.PI / 2); add(-4.99, z, Math.PI / 2);
    add(4.99, z, -Math.PI / 2); add(14.01, z, Math.PI / 2);
  }
  for (const x of [-11.5, -7.5, 7.5, 11.5]) { add(x, -8.01, Math.PI); add(x, 8.01, 0); }
  scene.add(new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 })));
}

/** Darker stone caps along the top of walls and buildings, only where nobody can stand on them. */
function caps(): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (const b of MAP) {
    if ((b.kind !== "wall" && b.kind !== "block") || b.max[1] < 4) continue;
    const sx = b.max[0] - b.min[0] + 0.12, sz = b.max[2] - b.min[2] + 0.12;
    const g = boxGeometry(sx, 0.12, sz, true);
    g.translate((b.min[0] + b.max[0]) / 2, b.max[1] + 0.06, (b.min[2] + b.max[2]) / 2);
    out.push(g);
  }
  return out;
}

export function buildWorld(scene: THREE.Scene): void {
  const tex = {
    floor: texture(floor, 4), bricks: texture(bricks, 2.4), plaster: texture(plaster, 4),
    crate: texture(crate, 1), metal: texture(metal, 2),
  };
  const mat = (map: THREE.Texture, roughness = 0.9, metalness = 0) => {
    const m = new THREE.MeshStandardMaterial({ map, roughness, metalness });
    contactShade(m);
    return m;
  };
  const materials: Record<Kind, THREE.MeshStandardMaterial> = {
    floor: new THREE.MeshStandardMaterial({ map: tex.floor, roughness: 0.95 }),
    wall: mat(tex.bricks),
    block: mat(tex.plaster),
    crate: mat(tex.crate, 0.85),
    metal: mat(tex.metal, 0.6, 0.1),
    step: mat(tex.floor),
  };

  // One mesh per material: the static map costs a handful of draw calls however many boxes it has.
  const byKind = new Map<Kind, THREE.BufferGeometry[]>();
  for (const b of MAP) {
    const sx = b.max[0] - b.min[0], sy = b.max[1] - b.min[1], sz = b.max[2] - b.min[2];
    const g = boxGeometry(sx, sy, sz, b.kind !== "crate");
    g.translate((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    byKind.set(b.kind, [...(byKind.get(b.kind) ?? []), g]);
  }
  for (const [kind, geos] of byKind) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), materials[kind]);
    for (const g of geos) g.dispose();
    mesh.castShadow = kind !== "floor";
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  const capMesh = new THREE.Mesh(mergeGeometries(caps()),
    new THREE.MeshStandardMaterial({ map: tex.bricks, color: 0x9a8a72, roughness: 0.9 }));
  capMesh.castShadow = capMesh.receiveShadow = true;
  scene.add(capMesh);
  windows(scene);
  const a = siteSign("A");
  a.position.set(19.5, 3.6, -23.98);
  const b = siteSign("B");
  b.position.set(-18.5, 3, -23.98);
  scene.add(a, b);

  const sunDir = new THREE.Vector3(18, 30, 10);
  sky(scene, sunDir);
  scene.fog = new THREE.Fog(0xe2d6c0, 50, 190);
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x8a7254, 1.1));
  const sun = new THREE.DirectionalLight(0xffe6c4, 3.2);
  sun.position.copy(sunDir);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, far: 80 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
}
