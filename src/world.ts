import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Kind, MapDef, Theme } from "../shared/map.ts";

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
    g.fillStyle = `rgb(${Math.round(120 * k)},${Math.round(146 * k)},${Math.round(150 * k)})`;
    g.fillRect(x, 0, 4, s);
  }
  blotches(g, s, rnd, 8, "rgba(140,80,40,0.3)", s / 10);
  g.strokeStyle = "rgba(220,230,230,0.25)";
  for (let i = 0; i < 25; i++) {
    const x = rnd() * s, y = rnd() * s;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 60, y + (rnd() - 0.5) * 20); g.stroke();
  }
};

/** Grey concrete slabs, 3 m, with oil stains and yellow lane markings. */
const concrete: Paint = (g, s, rnd) => {
  g.fillStyle = "#8d8f8e";
  g.fillRect(0, 0, s, s);
  const n = 2, w = s / n;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const v = (rnd() - 0.5) * 14;
      g.fillStyle = `rgb(${140 + v},${142 + v},${140 + v})`;
      g.fillRect(i * w + 2, j * w + 2, w - 4, w - 4);
    }
  blotches(g, s, rnd, 10, "rgba(40,40,40,0.18)", s / 7);
  blotches(g, s, rnd, 12, "rgba(200,200,195,0.12)", s / 8);
  g.fillStyle = "rgba(225,180,40,0.75)";
  g.fillRect(s * 0.47, 0, s * 0.06, s * 0.4);
  g.fillRect(s * 0.47, s * 0.6, s * 0.06, s * 0.4);
  g.strokeStyle = "rgba(40,40,40,0.5)";
  g.lineWidth = 3;
  for (let i = 0; i <= n; i++) {
    g.beginPath(); g.moveTo(i * w, 0); g.lineTo(i * w, s); g.stroke();
    g.beginPath(); g.moveTo(0, i * w); g.lineTo(s, i * w); g.stroke();
  }
};

/** Red brick with light mortar, 2 m per tile. */
const redBrick: Paint = (g, s, rnd) => {
  g.fillStyle = "#b9b2a6";
  g.fillRect(0, 0, s, s);
  const cols = 8, rows = 28, bw = s / cols, bh = s / rows;
  for (let r = 0; r < rows; r++)
    for (let c = -1; c < cols; c++) {
      const x = c * bw + (r % 2 ? bw / 2 : 0), v = (rnd() - 0.5) * 30;
      g.fillStyle = `rgb(${150 + v},${68 + v * 0.5},${52 + v * 0.4})`;
      g.fillRect(x + 2, r * bh + 2, bw - 4, bh - 3);
    }
  blotches(g, s, rnd, 8, "rgba(30,25,25,0.12)", s / 5);
};

/** Corrugated wall cladding, light grey-blue, with rust streaks below the seams. */
const cladding: Paint = (g, s, rnd) => {
  for (let x = 0; x < s; x += 4) {
    const k = 0.82 + 0.18 * Math.sin((x / s) * Math.PI * 24);
    g.fillStyle = `rgb(${Math.round(170 * k)},${Math.round(180 * k)},${Math.round(186 * k)})`;
    g.fillRect(x, 0, 4, s);
  }
  for (let i = 0; i < 18; i++) {
    const x = rnd() * s, len = 40 + rnd() * 160;
    const grad = g.createLinearGradient(0, 0, 0, len);
    grad.addColorStop(0, "rgba(130,70,30,0.35)");
    grad.addColorStop(1, "rgba(130,70,30,0)");
    g.fillStyle = grad;
    g.fillRect(x, 0, 3 + rnd() * 5, len);
  }
  g.fillStyle = "rgba(60,64,68,0.6)";
  g.fillRect(0, 0, s, 4);
};

/** Shipping container side: white-ish ribs, tinted per container by the vertex colour. */
const containerSide: Paint = (g, s, rnd) => {
  for (let x = 0; x < s; x += 2) {
    const k = 0.78 + 0.22 * Math.sign(Math.sin((x / s) * Math.PI * 16));
    g.fillStyle = `rgb(${Math.round(235 * k)},${Math.round(235 * k)},${Math.round(232 * k)})`;
    g.fillRect(x, 0, 2, s);
  }
  blotches(g, s, rnd, 10, "rgba(90,60,40,0.18)", s / 9);
  g.fillStyle = "rgba(40,40,40,0.45)";
  g.fillRect(0, 0, s, 6);
  g.fillRect(0, s - 6, s, 6);
};

/** Packed snow: soft blue-grey drifts and footprints. */
const snow: Paint = (g, s, rnd) => {
  g.fillStyle = "#dfe5ec";
  g.fillRect(0, 0, s, s);
  blotches(g, s, rnd, 30, "rgba(170,185,205,0.22)", s / 5);
  blotches(g, s, rnd, 20, "rgba(255,255,255,0.35)", s / 6);
  g.fillStyle = "rgba(150,165,185,0.35)";
  for (let i = 0; i < 14; i++) {
    const x = rnd() * s, y = rnd() * s;
    g.beginPath(); g.ellipse(x, y, 7, 12, rnd() * Math.PI, 0, Math.PI * 2); g.fill();
  }
};

/** Grey fieldstone in uneven courses. */
const stone: Paint = (g, s, rnd) => {
  g.fillStyle = "#5d6166";
  g.fillRect(0, 0, s, s);
  const rows = 6, bh = s / rows;
  for (let r = 0; r < rows; r++) {
    let x = -rnd() * 60;
    while (x < s) {
      const w = 60 + rnd() * 70, v = (rnd() - 0.5) * 30;
      g.fillStyle = `rgb(${128 + v},${132 + v},${136 + v})`;
      g.beginPath();
      g.roundRect(x + 3, r * bh + 3, w - 6, bh - 6, 10);
      g.fill();
      x += w;
    }
  }
  blotches(g, s, rnd, 12, "rgba(255,255,255,0.12)", s / 6);
};

/** Log cabin wall: stacked round logs with dark gaps. */
const logs: Paint = (g, s, rnd) => {
  const rows = 8, h = s / rows;
  for (let r = 0; r < rows; r++) {
    const v = (rnd() - 0.5) * 20;
    const grad = g.createLinearGradient(0, r * h, 0, (r + 1) * h);
    grad.addColorStop(0, `rgb(${90 + v},${60 + v},${36 + v})`);
    grad.addColorStop(0.35, `rgb(${140 + v},${98 + v},${60 + v})`);
    grad.addColorStop(1, `rgb(${70 + v},${46 + v},${28 + v})`);
    g.fillStyle = grad;
    g.fillRect(0, r * h, s, h);
    g.strokeStyle = "rgba(50,30,15,0.3)";
    for (let k = 0; k < 4; k++) {
      const y = r * h + rnd() * h;
      g.beginPath(); g.moveTo(0, y); g.lineTo(s, y + (rnd() - 0.5) * 6); g.stroke();
    }
  }
};

/** Plain boards for steps, fences, stages and logs (tinted per box). */
const planks: Paint = (g, s, rnd) => {
  const n = 6, h = s / n;
  for (let i = 0; i < n; i++) {
    const v = (rnd() - 0.5) * 26;
    g.fillStyle = `rgb(${205 + v},${190 + v},${170 + v})`;
    g.fillRect(0, i * h + 2, s, h - 4);
    g.strokeStyle = "rgba(90,60,30,0.25)";
    for (let k = 0; k < 5; k++) {
      const y = i * h + rnd() * h;
      g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(s / 3, y + 3, (2 * s) / 3, y - 3, s, y); g.stroke();
    }
  }
};

/** Box geometry whose UVs are in metres, so textures keep their scale on every face, coloured by tint. */
function boxGeometry(sx: number, sy: number, sz: number, metres: boolean, tint = 0xffffff): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  if (metres) {
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    // BoxGeometry faces in order: +x, -x, +y, -y, +z, -z; 4 vertices each
    const dims: [number, number][] = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
    for (let f = 0; f < 6; f++)
      for (let v = 0; v < 4; v++) {
        const i = f * 4 + v;
        uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]);
      }
  }
  const c = new THREE.Color(tint);
  const n = g.getAttribute("position").count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
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
        diffuseColor.rgb *= mix(1.0, mix(0.5, 1.0, smoothstep(0.0, 0.7, vWorldPos.y)), side);`);
  };
}

type Rgb = [number, number, number];
type Look = {
  floor: [Paint, number]; wall: [Paint, number]; block: [Paint, number]; step: [Paint, number];
  cap: number; capPaint: [Paint, number]; window: (g: CanvasRenderingContext2D) => void;
  sky: { horizon: Rgb; zenith: Rgb; ground: Rgb; sun: number };
  fog: [color: number, near: number, far: number];
  hemi: [sky: number, ground: number, intensity: number];
  sun: [color: number, intensity: number, dir: Rgb];
};

const LOOKS: Record<Theme, Look> = {
  desert: {
    floor: [floor, 4], wall: [bricks, 2.4], block: [plaster, 4], step: [floor, 4],
    cap: 0x9a8a72, capPaint: [bricks, 2.4],
    window: (g) => {
      g.fillStyle = "#6e5a40"; g.fillRect(0, 0, 128, 160);
      g.fillStyle = "#2b2622"; g.fillRect(10, 10, 108, 140);
      g.fillStyle = "#4a6470";
      for (let i = 0; i < 6; i++) g.fillRect(16, 18 + i * 22, 96, 14);
      g.fillStyle = "#5c4a34"; g.fillRect(0, 150, 128, 10);
    },
    sky: { horizon: [0.93, 0.87, 0.76], zenith: [0.36, 0.58, 0.85], ground: [0.75, 0.68, 0.58], sun: 1 },
    fog: [0xe2d6c0, 50, 190],
    hemi: [0xcfe0ff, 0x8a7254, 1.1],
    sun: [0xffe6c4, 3.2, [18, 30, 10]],
  },
  harbor: {
    floor: [concrete, 6], wall: [redBrick, 2], block: [cladding, 3], step: [concrete, 6],
    cap: 0x55585c, capPaint: [concrete, 6],
    window: (g) => {
      g.fillStyle = "#3a3f44"; g.fillRect(0, 0, 128, 160);
      for (let r = 0; r < 4; r++)
        for (let c = 0; c < 3; c++) {
          g.fillStyle = (r + c) % 3 ? "#6f8ea3" : "#93b4c8";
          g.fillRect(8 + c * 39, 8 + r * 37, 34, 32);
        }
    },
    sky: { horizon: [0.85, 0.88, 0.9], zenith: [0.3, 0.52, 0.8], ground: [0.55, 0.58, 0.6], sun: 1 },
    fog: [0xcfd8e0, 45, 170],
    hemi: [0xd5e4ff, 0x6d6a66, 1.2],
    sun: [0xfff0dc, 3, [-14, 30, 16]],
  },
  snow: {
    floor: [snow, 4], wall: [stone, 3], block: [logs, 2.4], step: [planks, 1.2],
    cap: 0xf2f6fa, capPaint: [snow, 4],
    window: (g) => { // a lit window: warm light inside a cold village
      g.fillStyle = "#4a3422"; g.fillRect(0, 0, 128, 160);
      const grad = g.createRadialGradient(64, 80, 10, 64, 80, 80);
      grad.addColorStop(0, "#ffd890");
      grad.addColorStop(1, "#c98a3a");
      g.fillStyle = grad;
      g.fillRect(12, 12, 104, 136);
      g.fillStyle = "#4a3422";
      g.fillRect(60, 12, 8, 136);
      g.fillRect(12, 76, 104, 8);
      g.fillStyle = "#f4f7fb";
      g.fillRect(0, 0, 128, 10);
    },
    sky: { horizon: [0.86, 0.89, 0.93], zenith: [0.58, 0.67, 0.78], ground: [0.8, 0.83, 0.87], sun: 0.35 },
    fog: [0xd6dde6, 25, 130],
    hemi: [0xe2ebf7, 0x9aa4b0, 1.5],
    sun: [0xe8eef8, 1.9, [12, 30, -14]],
  },
};

function sky(look: Look): THREE.Mesh {
  const v = (c: Rgb) => new THREE.Vector3(...c);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      sun: { value: v(look.sun[2]).normalize() }, horizon: { value: v(look.sky.horizon) }, zenith: { value: v(look.sky.zenith) },
      ground: { value: v(look.sky.ground) }, sunAmount: { value: look.sky.sun },
    },
    vertexShader: `varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vDir; uniform vec3 sun, horizon, zenith, ground; uniform float sunAmount;
      void main() {
        float h = max(vDir.y, 0.0);
        vec3 col = mix(horizon, zenith, pow(h, 0.55));
        col = mix(col, ground, smoothstep(0.0, -0.2, vDir.y));
        float s = max(dot(vDir, sun), 0.0);
        col += vec3(1.0, 0.85, 0.6) * (pow(s, 600.0) * 3.0 + pow(s, 12.0) * 0.25) * sunAmount;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(200, 32, 16), mat);
  mesh.renderOrder = -1;
  return mesh;
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

/** Windows on the buildings: visual only, the walls stay solid. */
function windows(map: MapDef, look: Look): THREE.Mesh | null {
  if (!map.decor.windows.length) return null;
  const c = document.createElement("canvas");
  c.width = 128; c.height = 160;
  look.window(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const geos = map.decor.windows.map(([x, y, z, ry]) => {
    const p = new THREE.PlaneGeometry(1.1, 1.4);
    p.rotateY(ry);
    p.translate(x, y, z);
    return p;
  });
  const lit = map.theme === "snow";
  return new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ map: t, roughness: 0.8,
    emissive: lit ? 0xffffff : 0x000000, emissiveMap: lit ? t : null, emissiveIntensity: lit ? 0.6 : 0 }));
}

/** Pines: three stacked cones, green going white at the tips. The trunk is a map box. */
function trees(map: MapDef): THREE.Mesh | null {
  if (!map.decor.trees?.length) return null;
  const green = new THREE.Color(0x2c4a36), white = new THREE.Color(0xe6edf3), c = new THREE.Color();
  const geos: THREE.BufferGeometry[] = [];
  for (const [x, z] of map.decor.trees)
    for (const [r, h, y] of [[1.7, 2.4, 3.1], [1.3, 2.1, 4.5], [0.9, 1.8, 5.7]]) {
      const g = new THREE.ConeGeometry(r, h, 8).toNonIndexed();
      const pos = g.getAttribute("position");
      const colors = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        c.copy(green).lerp(white, Math.max(0, pos.getY(i) / h + 0.15));
        colors.set([c.r, c.g, c.b], i * 3);
      }
      g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      g.deleteAttribute("uv");
      g.translate(x, y, z);
      geos.push(g);
    }
  const mesh = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }));
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

/** Caps along the top of walls and buildings, only where nobody can stand on them. */
function caps(map: MapDef): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (const b of map.boxes) {
    if ((b.kind !== "wall" && b.kind !== "block") || b.max[1] < 4) continue;
    const sx = b.max[0] - b.min[0] + 0.12, sz = b.max[2] - b.min[2] + 0.12;
    const g = boxGeometry(sx, 0.12, sz, true);
    g.translate((b.min[0] + b.max[0]) / 2, b.max[1] + 0.06, (b.min[2] + b.max[2]) / 2);
    out.push(g);
  }
  return out;
}

const FLAKES = 1500, SNOW_BOX = 36;

/** Snow falling around the camera, wrapped inside a box that follows it. */
function snowfall(): { points: THREE.Points; update: (dt: number, at: THREE.Vector3) => void } {
  const pos = new Float32Array(FLAKES * 3);
  for (let i = 0; i < pos.length; i++) pos[i] = (Math.random() - 0.5) * SNOW_BOX;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.06, transparent: true, opacity: 0.85, depthWrite: false }));
  points.frustumCulled = false;
  let t = 0;
  return {
    points,
    update: (dt, at) => {
      t += dt;
      for (let i = 0; i < FLAKES; i++) {
        pos[i * 3 + 1] -= dt * (0.8 + (i % 7) * 0.08);
        pos[i * 3] += Math.sin(t + i) * dt * 0.2;
        if (pos[i * 3 + 1] < -SNOW_BOX / 2) pos[i * 3 + 1] += SNOW_BOX;
      }
      points.position.set(Math.floor(at.x / SNOW_BOX) * SNOW_BOX, at.y, Math.floor(at.z / SNOW_BOX) * SNOW_BOX);
      geo.attributes.position.needsUpdate = true;
    },
  };
}

export type World = { group: THREE.Group; update: (dt: number, camera: THREE.Vector3) => void; dispose: () => void };

/** Everything a map looks like: its boxes with the theme's textures, decor, sky, fog and light. */
export function buildWorld(scene: THREE.Scene, map: MapDef): World {
  const look = LOOKS[map.theme];
  const group = new THREE.Group();
  const tex = (p: [Paint, number]) => texture(p[0], p[1]);
  const mat = (map: THREE.Texture, roughness = 0.9, metalness = 0, shade = true) => {
    const m = new THREE.MeshStandardMaterial({ map, roughness, metalness, vertexColors: true });
    if (shade) contactShade(m);
    return m;
  };
  const materials: Record<Kind, THREE.MeshStandardMaterial> = {
    floor: mat(tex(look.floor), 0.95, 0, false),
    wall: mat(tex(look.wall)),
    block: mat(tex(look.block)),
    crate: mat(texture(crate, 1), 0.85),
    metal: mat(texture(metal, 2), 0.6, 0.1),
    step: mat(tex(look.step)),
    container: mat(texture(containerSide, 2.4), 0.6, 0.15),
    wood: mat(texture(planks, 1.2), 0.85),
  };

  // One mesh per material: the static map costs a handful of draw calls however many boxes it has.
  const byKind = new Map<Kind, THREE.BufferGeometry[]>();
  for (const b of map.boxes) {
    const sx = b.max[0] - b.min[0], sy = b.max[1] - b.min[1], sz = b.max[2] - b.min[2];
    const g = boxGeometry(sx, sy, sz, b.kind !== "crate", b.tint);
    g.translate((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    byKind.set(b.kind, [...(byKind.get(b.kind) ?? []), g]);
  }
  for (const [kind, geos] of byKind) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), materials[kind]);
    for (const g of geos) g.dispose();
    mesh.castShadow = kind !== "floor";
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const capGeos = caps(map);
  if (capGeos.length) {
    const capMesh = new THREE.Mesh(mergeGeometries(capGeos),
      new THREE.MeshStandardMaterial({ map: tex(look.capPaint), color: look.cap, roughness: 0.9, vertexColors: true }));
    capMesh.castShadow = capMesh.receiveShadow = true;
    group.add(capMesh);
  }
  for (const extra of [windows(map, look), trees(map)]) if (extra) group.add(extra);
  for (const site of ["A", "B"] as const) {
    const [x, y, z, ry] = map.decor.signs[site];
    const sign = siteSign(site);
    sign.position.set(x, y, z);
    sign.rotation.y = ry;
    group.add(sign);
  }

  group.add(sky(look));
  group.add(new THREE.HemisphereLight(look.hemi[0], look.hemi[1], look.hemi[2]));
  const sun = new THREE.DirectionalLight(look.sun[0], look.sun[1]);
  sun.position.set(...look.sun[2]);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const r = map.half + 6;
  Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, far: 100 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  group.add(sun);
  const snowing = map.theme === "snow" ? snowfall() : null;
  if (snowing) group.add(snowing.points);
  scene.add(group);
  scene.fog = new THREE.Fog(...look.fog);

  return {
    group,
    update: (dt, camera) => snowing?.update(dt, camera),
    dispose: () => {
      scene.remove(group);
      group.traverse((o) => {
        if (!(o instanceof THREE.Mesh || o instanceof THREE.Points)) return;
        o.geometry.dispose();
        for (const m of [o.material].flat()) {
          for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
          m.dispose();
        }
      });
      sun.shadow.map?.dispose();
    },
  };
}
