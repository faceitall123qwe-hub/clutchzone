import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { box, type Kind, type MapBox, type MapDef, type Theme } from "../shared/map.ts";
import { hash } from "../shared/plan.ts";
import { Kit } from "./models";
import { gradient, toon } from "./toon";

type Paint = (g: CanvasRenderingContext2D, s: number, rnd: () => number) => void;

/** Canvas texture; metres: how many metres one copy of it covers. Clean flat colour: the cartoon look
 * comes from the banded light and the outlines, not from texture detail. */
function texture(paint: Paint, metres: number, size = 512): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  paint(g, size, rnd);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.repeat.set(1 / metres, 1 / metres);
  return t;
}

const vary = (hex: string, rnd: () => number, k = 0.06) => {
  const c = new THREE.Color(hex);
  const f = 1 + (rnd() - 0.5) * 2 * k;
  return `#${c.setRGB(Math.min(1, c.r * f), Math.min(1, c.g * f), Math.min(1, c.b * f)).getHexString()}`;
};

/** Square tiles with a grout line, n per side. */
const tiles = (base: string, grout: string, n: number, line = 6): Paint => (g, s, rnd) => {
  g.fillStyle = grout;
  g.fillRect(0, 0, s, s);
  const w = s / n;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      g.fillStyle = vary(base, rnd, 0.04);
      g.fillRect(i * w + line / 2, j * w + line / 2, w - line, w - line);
    }
};

/** Staggered bricks: cols × rows per tile. */
const brickWall = (brick: string, mortar: string, cols: number, rows: number, gap = 6): Paint => (g, s, rnd) => {
  g.fillStyle = mortar;
  g.fillRect(0, 0, s, s);
  const bw = s / cols, bh = s / rows;
  for (let r = 0; r < rows; r++)
    for (let c = -1; c < cols; c++) {
      g.fillStyle = vary(brick, rnd);
      g.fillRect(c * bw + (r % 2 ? bw / 2 : 0) + gap / 2, r * bh + gap / 2, bw - gap, bh - gap);
    }
};

/** A wooden crate face: frame, planks and a diagonal brace (UVs 0..1 per face). */
const crate: Paint = (g, s, rnd) => {
  g.fillStyle = "#8a4d1f";
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 5; i++) {
    g.fillStyle = vary("#e08a3c", rnd, 0.05);
    g.fillRect(0, (i * s) / 5 + 4, s, s / 5 - 8);
  }
  const f = s * 0.12;
  g.fillStyle = "#a85a22";
  g.fillRect(0, 0, s, f); g.fillRect(0, s - f, s, f); g.fillRect(0, 0, f, s); g.fillRect(s - f, 0, f, s);
  g.save();
  g.translate(s / 2, s / 2);
  g.rotate(Math.PI / 4);
  g.fillRect(-s * 0.7, -f / 2, s * 1.4, f);
  g.restore();
};

/** Corrugated sheet: alternating light and dark ribs. */
const ribs = (light: string, dark: string, n: number, band = ""): Paint => (g, s) => {
  for (let i = 0; i < n; i++) {
    g.fillStyle = i % 2 ? dark : light;
    g.fillRect((i * s) / n, 0, s / n + 1, s);
  }
  if (band) { g.fillStyle = band; g.fillRect(0, 0, s, 10); g.fillRect(0, s - 10, s, 10); }
};

/** Concrete slabs with a yellow lane marking. */
const concrete: Paint = (g, s, rnd) => {
  tiles("#d4dbe2", "#9aa6b2", 2, 8)(g, s, rnd);
  g.fillStyle = "#ffcf33";
  g.fillRect(s * 0.47, 0, s * 0.06, s * 0.4);
  g.fillRect(s * 0.47, s * 0.6, s * 0.06, s * 0.4);
};

const snow: Paint = (g, s, rnd) => {
  g.fillStyle = "#f4f8ff";
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 12; i++) { // soft blue drifts
    const x = rnd() * s, y = rnd() * s;
    g.fillStyle = "#dfeaff";
    g.beginPath(); g.ellipse(x, y, 60 + rnd() * 60, 20 + rnd() * 20, rnd() * Math.PI, 0, Math.PI * 2); g.fill();
  }
};

/** Rounded fieldstones in uneven courses. */
const stone: Paint = (g, s, rnd) => {
  g.fillStyle = "#5b6577";
  g.fillRect(0, 0, s, s);
  const rows = 6, bh = s / rows;
  for (let r = 0; r < rows; r++) {
    let x = -rnd() * 60;
    while (x < s) {
      const w = 60 + rnd() * 70;
      g.fillStyle = vary("#a3afc2", rnd, 0.08);
      g.beginPath(); g.roundRect(x + 4, r * bh + 4, w - 8, bh - 8, 14); g.fill();
      x += w;
    }
  }
};

/** Log cabin wall: round logs, lighter in the middle. */
const logs: Paint = (g, s, rnd) => {
  const rows = 8, h = s / rows;
  for (let r = 0; r < rows; r++) {
    g.fillStyle = "#6e3b1c";
    g.fillRect(0, r * h, s, h);
    g.fillStyle = vary("#c7783e", rnd);
    g.beginPath(); g.roundRect(0, r * h + 5, s, h - 10, h / 2); g.fill();
    g.fillStyle = "rgba(255,230,190,0.25)";
    g.fillRect(0, r * h + h * 0.3, s, h * 0.15);
  }
};

const planks: Paint = (g, s, rnd) => {
  g.fillStyle = "#8a6440";
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 6; i++) {
    g.fillStyle = vary("#f2e2c8", rnd, 0.05);
    g.fillRect(0, (i * s) / 6 + 3, s, s / 6 - 6);
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
function contactShade(mat: THREE.Material): void {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorldPos;\nvarying vec3 vWorldNormal;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWorldNormal = normalize(mat3(modelMatrix) * objectNormal);");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorldPos;\nvarying vec3 vWorldNormal;")
      .replace("#include <map_fragment>", `#include <map_fragment>
        float side = 1.0 - abs(vWorldNormal.y);
        diffuseColor.rgb *= mix(1.0, mix(0.7, 1.0, smoothstep(0.0, 0.5, vWorldPos.y)), side);`);
  };
}

type Look = {
  floor: [Paint, number]; wall: [Paint, number]; step: [Paint, number];
  metal: Paint; cap: number; window: (g: CanvasRenderingContext2D) => void;
  sky: { horizon: number; zenith: number; ground: number; sun: number };
  fog: [color: number, near: number, far: number];
  hemi: [sky: number, ground: number, intensity: number];
  sun: [color: number, intensity: number, dir: [number, number, number]];
  /** The houses: plaster tints, the other facade and its share and colour, roof colours, shutters. */
  town: { tints: number[]; alt: [Paint, number]; altShare: number; altColor: number; roofs: number[]; shutters: string;
    trees: "palm" | "pine" };
  ground: number; // outside the arena, under the town
  sea: number | null;
};

const LOOKS: Record<Theme, Look> = {
  desert: {
    floor: [tiles("#f4c98c", "#d9a066", 2), 4], wall: [brickWall("#e8875a", "#f7d3ac", 4, 8), 2.4],
    step: [tiles("#f4c98c", "#d9a066", 2), 4],
    metal: ribs("#4cc7c0", "#2f9f9a", 16), cap: 0xc8603a,
    window: (g) => {
      g.fillStyle = "#2a6fa8"; g.fillRect(0, 0, 128, 160);
      g.fillStyle = "#123a5c"; g.fillRect(12, 12, 104, 136);
      g.fillStyle = "#3f8fd0";
      for (let i = 0; i < 6; i++) g.fillRect(18, 20 + i * 22, 92, 12);
    },
    sky: { horizon: 0xc8f0ff, zenith: 0x2f8ff0, ground: 0x3fb3ea, sun: 1 },
    fog: [0xd9eef5, 70, 230],
    hemi: [0xbfe3ff, 0xf3c48a, 1.5],
    sun: [0xfff3e0, 2.2, [18, 30, 10]],
    town: {
      tints: [0xffd45c, 0xff9a76, 0x8fd0ff, 0xfff0d2, 0xb5e48c, 0xffb8c8], alt: [brickWall("#e8875a", "#f7d3ac", 4, 8), 2.4],
      altShare: 0.22, altColor: 0xe8875a, roofs: [0xd9572b, 0xc8452f, 0x3b7dd8, 0x2e9e6a], shutters: "#2f7fd0", trees: "palm",
    },
    ground: 0xf0cf98,
    sea: 0x3fb3ea,
  },
  harbor: {
    floor: [concrete, 6], wall: [brickWall("#e04a3a", "#f3e2d4", 8, 28, 5), 2],
    step: [concrete, 6], metal: ribs("#4cc7c0", "#2f9f9a", 16), cap: 0x5b6577,
    window: (g) => {
      g.fillStyle = "#33404f"; g.fillRect(0, 0, 128, 160);
      for (let r = 0; r < 4; r++)
        for (let c = 0; c < 3; c++) {
          g.fillStyle = (r + c) % 3 ? "#7cc3ff" : "#b8e2ff";
          g.fillRect(8 + c * 39, 8 + r * 37, 34, 32);
        }
    },
    sky: { horizon: 0xd2f2ff, zenith: 0x3d9cff, ground: 0x3fa6e0, sun: 1 },
    fog: [0xd8eaf5, 70, 230],
    hemi: [0xc6e6ff, 0xb9b4a8, 1.5],
    sun: [0xfff6e8, 2.2, [-14, 30, 16]],
    town: {
      tints: [0x5aa0ff, 0xffd45c, 0xf4f4f4, 0x4cc9b0, 0xff7b6b, 0xffa94d], alt: [brickWall("#e04a3a", "#f3e2d4", 8, 28, 5), 2],
      altShare: 0.25, altColor: 0xe04a3a, roofs: [0x3d4a5c, 0xd9572b, 0x2f6fa8], shutters: "#2e9e6a", trees: "palm",
    },
    ground: 0xc9d3dc,
    sea: 0x3fa6e0,
  },
  snow: {
    floor: [snow, 5], wall: [stone, 3], step: [planks, 1.2],
    metal: ribs("#7fb6e8", "#5a90c4", 16), cap: 0xf4f8ff,
    window: (g) => { // a lit window: warm light inside a cold village
      g.fillStyle = "#5a3418"; g.fillRect(0, 0, 128, 160);
      g.fillStyle = "#ffd86b"; g.fillRect(14, 14, 100, 132);
      g.fillStyle = "#5a3418"; g.fillRect(60, 14, 8, 132); g.fillRect(14, 76, 100, 8);
      g.fillStyle = "#ffffff"; g.fillRect(0, 0, 128, 12);
    },
    sky: { horizon: 0xf2f7ff, zenith: 0x7fb4ec, ground: 0xe6eef8, sun: 0.5 },
    fog: [0xe4ecf6, 35, 150],
    hemi: [0xdfeaff, 0xc9d3e2, 1.7],
    sun: [0xf2f6ff, 1.8, [12, 30, -14]],
    town: {
      tints: [0xf5efe2, 0xdfe9f5, 0xf3d2b8, 0xcfe6d2, 0xf7d9d9], alt: [logs, 2.4], altShare: 0.4, altColor: 0xc7783e,
      roofs: [0xf4f8ff, 0xeaf1fb], shutters: "#b5462f", trees: "pine",
    },
    ground: 0xf4f8ff,
    sea: null,
  },
};

function sky(look: Look): THREE.Mesh {
  const c = (hex: number) => new THREE.Color(hex);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      sun: { value: new THREE.Vector3(...look.sun[2]).normalize() }, horizon: { value: c(look.sky.horizon) },
      zenith: { value: c(look.sky.zenith) }, ground: { value: c(look.sky.ground) }, sunAmount: { value: look.sky.sun },
    },
    vertexShader: `varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vDir; uniform vec3 sun, horizon, zenith, ground; uniform float sunAmount;
      void main() {
        float h = max(vDir.y, 0.0);
        vec3 col = mix(horizon, zenith, smoothstep(0.0, 0.6, h));
        col = mix(col, ground, smoothstep(0.0, -0.15, vDir.y));
        float s = dot(vDir, sun);
        col = mix(col, vec3(1.0, 0.97, 0.85), step(0.9985, s) * sunAmount); // a flat cartoon sun disc
        col += vec3(1.0, 0.8, 0.5) * pow(max(s, 0.0), 24.0) * 0.25 * sunAmount;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(200, 32, 16), mat);
  mesh.renderOrder = -1;
  return mesh;
}

/** Puffy low-poly clouds in a ring around the map; the outline pass draws their edges. */
function clouds(): THREE.Mesh {
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const geos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rnd() * 0.4, r = 120 + rnd() * 40, y = 38 + rnd() * 25;
    for (let j = 0; j < 4; j++) {
      const g = new THREE.IcosahedronGeometry(6 + rnd() * 5, 1);
      g.scale(1.4, 0.8, 1);
      g.translate(Math.cos(a) * r + (j - 1.5) * 8, y + rnd() * 3, Math.sin(a) * r + rnd() * 5);
      geos.push(g);
    }
  }
  const mesh = new THREE.Mesh(mergeGeometries(geos), toon({ color: 0xffffff, fog: false }));
  for (const g of geos) g.dispose();
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
  g.lineWidth = 14;
  g.strokeStyle = "#14161c";
  g.strokeText(letter, 128, 140);
  g.fillStyle = "#ff3b2f";
  g.fillText(letter, 128, 140);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4),
    new THREE.MeshBasicMaterial({ map: t, transparent: true, polygonOffset: true, polygonOffsetFactor: -2 }));
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
  return new THREE.Mesh(mergeGeometries(geos), lit ? new THREE.MeshBasicMaterial({ map: t }) : toon({ map: t }));
}

/** Pines: three stacked cones, green going white at the tips; inside the map the trunk is a map box.
 * scale: the ones outside the arena are taller, to show above its wall. */
function trees(spots: readonly (readonly [number, number])[], scale = 1): THREE.Mesh | null {
  if (!spots.length) return null;
  const green = new THREE.Color(0x2f9a5a), white = new THREE.Color(0xf4f8ff), c = new THREE.Color();
  const geos: THREE.BufferGeometry[] = [];
  for (const [x, z] of spots)
    for (const [r, h, y] of [[1.7, 2.4, 3.1], [1.3, 2.1, 4.5], [0.9, 1.8, 5.7]].map((v) => v.map((n) => n * scale))) {
      const g = new THREE.ConeGeometry(r, h, 8).toNonIndexed();
      const pos = g.getAttribute("position");
      const colors = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        c.copy(green).lerp(white, pos.getY(i) / h > 0.2 ? 1 : 0); // snow caps, not a gradient
        colors.set([c.r, c.g, c.b], i * 3);
      }
      g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      g.deleteAttribute("uv");
      g.translate(x, y, z);
      geos.push(g);
    }
  const mesh = new THREE.Mesh(mergeGeometries(geos), toon({ vertexColors: true }));
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

/** Caps along the top of walls and flat-roofed houses (a shade darker than the house), only where
 * nobody can stand on them. */
function caps(boxes: MapBox[], houses: Map<MapBox, House>, look: Look): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (const b of boxes) {
    if ((b.kind !== "wall" && b.kind !== "block") || b.max[1] < 4) continue;
    const h = houses.get(b);
    if (h && h.roof !== null) continue;
    const color = h && !h.alt ? new THREE.Color(h.tint).multiplyScalar(0.78).getHex() : look.cap;
    const sx = b.max[0] - b.min[0] + 0.2, sz = b.max[2] - b.min[2] + 0.2;
    const g = boxGeometry(sx, 0.18, sz, true, color);
    g.translate((b.min[0] + b.max[0]) / 2, b.max[1] + 0.09, (b.min[2] + b.max[2]) / 2);
    out.push(g);
  }
  return out;
}

/** House plaster: near white, so each house's tint gives it its colour. */
const whitePlaster: Paint = (g, s, rnd) => {
  g.fillStyle = "#f7f2e8";
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 6; i++) { // a few chips showing the bricks underneath
    const x = rnd() * s, y = rnd() * s;
    g.fillStyle = "#e6d8c6";
    g.beginPath(); g.roundRect(x, y, 30 + rnd() * 40, 16 + rnd() * 12, 6); g.fill();
  }
};

/** One building: plaster in a colour from the theme or the theme's other facade, maybe a pitched roof. */
type House = { box: MapBox; alt: boolean; tint: number; wall: THREE.Color; roof: number | null };

function house(b: MapBox, look: Look): House {
  const t = look.town;
  const alt = hash(b.min[0], b.min[2]) < t.altShare;
  const tint = alt ? 0xffffff : t.tints[Math.floor(hash(b.min[2] + 7, b.min[0] - 3) * t.tints.length)];
  const roof = hash(b.max[0], b.max[2]) < 0.55 ? t.roofs[Math.floor(hash(b.max[2], b.min[0]) * t.roofs.length)] : null;
  return { box: b, alt, tint, wall: new THREE.Color(alt ? t.altColor : tint), roof };
}

/** Window with shutters (left half) and a door (right half), drawn once for every house. */
function facadeTexture(look: Look, lit: boolean): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 160;
  const g = c.getContext("2d")!;
  g.fillStyle = look.town.shutters;
  g.fillRect(0, 8, 30, 144); g.fillRect(98, 8, 30, 144);
  g.fillStyle = "rgba(0,0,0,0.2)";
  for (let y = 20; y < 144; y += 15) { g.fillRect(5, y, 20, 5); g.fillRect(103, y, 20, 5); }
  g.fillStyle = "#f4f1ea"; g.fillRect(30, 2, 68, 156);
  g.fillStyle = lit ? "#ffd86b" : "#5fb0e6"; g.fillRect(38, 10, 52, 136);
  g.fillStyle = lit ? "#ffeaa8" : "#a8dcff";
  g.beginPath(); g.moveTo(38, 66); g.lineTo(70, 10); g.lineTo(84, 10); g.lineTo(38, 92); g.fill();
  g.fillStyle = "#f4f1ea"; g.fillRect(61, 10, 6, 136); g.fillRect(38, 72, 52, 6);
  g.fillStyle = "#f4f1ea"; g.fillRect(128, 0, 128, 160);
  g.fillStyle = "#7a4424"; g.fillRect(138, 8, 108, 152);
  g.fillStyle = "#9c5a32";
  for (const [x, y, h] of [[148, 20, 54], [198, 20, 54], [148, 84, 66], [198, 84, 66]]) g.fillRect(x, y, 40, h);
  g.fillStyle = "#ffd24a"; g.beginPath(); g.arc(236, 92, 6, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Windows on every wall of every house, rows every 2.7 m, and a door on most houses. Ones that end up
 * inside a neighbouring house are hidden by it. */
function facades(houses: House[], look: Look, lit: boolean): THREE.Mesh | null {
  const geos: THREE.BufferGeometry[] = [];
  const add = (door: boolean, x: number, y: number, z: number, ry: number) => {
    const p = door ? new THREE.PlaneGeometry(1.3, 2.2) : new THREE.PlaneGeometry(1.25, 1.55);
    const uv = p.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.5 + (door ? 0.5 : 0));
    p.rotateY(ry);
    p.translate(x, y, z);
    geos.push(p);
  };
  for (const { box: b } of houses) {
    const H = b.max[1];
    if (H < 3.5) continue;
    const rows = [2.4, 5.1, 7.8, 10.5, 13.2].filter((y) => y + 1 < H);
    const doorFace = hash(b.min[0] + 3, b.max[2]) < 0.75 ? Math.floor(hash(b.max[0], b.min[2] + 5) * 4) : -1;
    // [along x?, the wall's coordinate, from, to, rotation]
    const faces: [boolean, number, number, number, number][] = [
      [true, b.min[2] - 0.03, b.min[0], b.max[0], Math.PI], [true, b.max[2] + 0.03, b.min[0], b.max[0], 0],
      [false, b.min[0] - 0.03, b.min[2], b.max[2], -Math.PI / 2], [false, b.max[0] + 0.03, b.min[2], b.max[2], Math.PI / 2],
    ];
    faces.forEach(([alongX, at, from, to, ry], f) => {
      const n = Math.max(1, Math.floor((to - from) / 3.4)), step = (to - from) / n;
      for (let i = 0; i < n; i++) {
        const t = from + (i + 0.5) * step;
        rows.forEach((y, r) => {
          const door = r === 0 && f === doorFace && i === Math.floor(n / 2);
          const yy = door ? 1.1 : y;
          if (alongX) add(door, t, yy, at, ry);
          else add(door, at, yy, t, ry);
        });
      }
    });
  }
  if (!geos.length) return null;
  const t = facadeTexture(look, lit);
  const params = { map: t, polygonOffset: true, polygonOffsetFactor: -1 };
  const mesh = new THREE.Mesh(mergeGeometries(geos), lit ? new THREE.MeshBasicMaterial(params) : toon(params));
  for (const g of geos) g.dispose();
  return mesh;
}

/** Pitched roofs: the ridge along the longer side, the gable ends in the wall's colour. */
function roofs(houses: House[]): THREE.Mesh | null {
  const geos: THREE.BufferGeometry[] = [];
  const c = new THREE.Color();
  for (const { box: b, wall, roof } of houses) {
    if (roof === null) continue;
    const sx = b.max[0] - b.min[0], sz = b.max[2] - b.min[2], alongX = sx >= sz;
    const span = (alongX ? sz : sx) / 2 + 0.35, len = (alongX ? sx : sz) + 0.3;
    const rise = Math.min(2.6, span * 0.7);
    const shape = new THREE.Shape([new THREE.Vector2(-span, 0), new THREE.Vector2(span, 0), new THREE.Vector2(0, rise)]);
    let g: THREE.BufferGeometry = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false });
    if (g.index) g = g.toNonIndexed();
    const colors = new Float32Array(g.getAttribute("position").count * 3);
    for (const grp of g.groups) {
      c.set(grp.materialIndex === 0 ? wall : roof);
      for (let i = grp.start; i < grp.start + grp.count; i++) colors.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    g.clearGroups();
    g.translate(0, 0, -len / 2);
    if (alongX) g.rotateY(Math.PI / 2);
    g.translate((b.min[0] + b.max[0]) / 2, b.max[1], (b.min[2] + b.max[2]) / 2);
    geos.push(g);
  }
  if (!geos.length) return null;
  const mesh = new THREE.Mesh(mergeGeometries(geos), toon({ vertexColors: true }));
  for (const g of geos) g.dispose();
  mesh.castShadow = true;
  return mesh;
}

/** Two rows of houses around the outside of the arena: the town the map is part of. Drawn only. */
function townRing(map: MapDef): MapBox[] {
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const h = map.half + 1, out: MapBox[] = [];
  for (let side = 0; side < 4; side++)
    for (let row = 0; row < 2; row++) {
      let t = -h - 2 + rnd() * 3;
      while (t < h + 2) {
        const w = 5 + rnd() * 6, d = 5 + rnd() * 4, set = h + 5 + row * 11 + rnd() * 3;
        const top = row ? 10 + rnd() * 9 : 7.5 + rnd() * 5;
        const a = t, b = Math.min(t + w, h + 4);
        const [x1, z1, x2, z2] = side === 0 ? [a, -set - d, b, -set] : side === 1 ? [a, set, b, set + d]
          : side === 2 ? [-set - d, a, -set, b] : [set, a, set + d, b];
        out.push(box("block", x1, 0, z1, x2, top, z2));
        t = b + 0.5 + rnd() * 2.5;
      }
    }
  return out;
}

/** Palms along the outside of the arena wall (their crowns show above it) and in the corners. */
function palms(map: MapDef): THREE.Mesh {
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const h = map.half + 2.6, spots: [number, number][] = [];
  for (let t = -h + 2; t < h; t += 7 + rnd() * 6)
    spots.push([t, -h], [t + 3, h], [-h, t + 1.5], [h, t - 1.5]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) spots.push([sx * (h + 3), sz * (h + 3)]);
  const k = new Kit();
  for (const [x, z] of spots) {
    const height = 7.5 + rnd() * 3, lean = rnd() * Math.PI * 2, segs = 6;
    let px = x, pz = z;
    for (let i = 0; i < segs; i++) { // a trunk of stacked rings that curves a little
      const y0 = (i * height) / segs, y1 = ((i + 1) * height) / segs;
      const bend = 0.06 * i;
      const nx = px + Math.cos(lean) * bend, nz = pz + Math.sin(lean) * bend;
      k.beam(i % 2 ? 0x8c5f36 : 0xa8774a, 0.42 - i * 0.03, 0.42 - i * 0.03, [px, y0, pz], [nx, y1, nz]);
      px = nx; pz = nz;
    }
    for (let i = 0; i < 7; i++) { // leaves: out and up, then drooping
      const a = (i / 7) * Math.PI * 2 + rnd() * 0.3, cx = Math.cos(a), cz = Math.sin(a);
      const mid: [number, number, number] = [px + cx * 1.5, height + 0.5, pz + cz * 1.5];
      const end: [number, number, number] = [px + cx * 3.1, height - 0.9, pz + cz * 3.1];
      const green = i % 2 ? 0x3fae4a : 0x2f9440;
      k.beam(green, 0.9, 0.08, [px, height, pz], mid);
      k.beam(green, 0.7, 0.08, mid, end);
    }
    for (let i = 0; i < 3; i++) k.box(0x6b4424, [0.28, 0.28, 0.28], [px + Math.cos(i * 2.1) * 0.25, height - 0.25, pz + Math.sin(i * 2.1) * 0.25]);
  }
  const mesh = k.buildSingle(toon({ vertexColors: true }));
  mesh.castShadow = false;
  return mesh;
}

/** Blue drums about 1 m across, in rows on a barrel box (which is what players collide with). */
function barrels(boxes: MapBox[]): THREE.Mesh | null {
  if (!boxes.length) return null;
  const k = new Kit(), up: [number, number, number] = [0, 0, 0];
  for (const b of boxes) {
    const h = b.max[1] - b.min[1];
    for (let x = b.min[0] + 0.5; x < b.max[0]; x += 1)
      for (let z = b.min[2] + 0.5; z < b.max[2]; z += 1) {
        k.cyl(0x2f7fd0, 0.47, h, [x, b.min[1] + h / 2, z], up, "matte", 14);
        for (const f of [0.3, 0.7]) k.cyl(0x1f5aa0, 0.49, 0.06, [x, b.min[1] + h * f, z], up, "matte", 14);
        k.cyl(0x6aa8e8, 0.38, 0.02, [x, b.max[1] + 0.01, z], up, "matte", 14); // lid
      }
  }
  const mesh = k.buildSingle(toon({ vertexColors: true }));
  mesh.castShadow = true;
  return mesh;
}

/** A red and white lighthouse on rocks out at sea. */
function lighthouse(x: number, z: number): THREE.Mesh {
  const k = new Kit(), up: [number, number, number] = [0, 0, 0];
  for (const [dx, dz, s] of [[0, 0, 7], [3, 2, 4], [-3, 1, 5], [1, -3, 4]]) k.box(0x8a929e, [s, 2.5, s], [x + dx, 0.6, z + dz]);
  for (let i = 0; i < 6; i++) k.cyl(i % 2 ? 0xe8453c : 0xf7f4ee, 2.4 - i * 0.15, 4, [x, 3.5 + i * 4, z], up, "matte", 16);
  k.cyl(0x2d3340, 2.4, 0.4, [x, 27.6, z], up, "matte", 16); // gallery
  k.cyl(0xffe27a, 1.2, 2.2, [x, 28.9, z], up, "glass", 12); // the lamp room
  k.cyl(0xe8453c, 1.5, 0.6, [x, 30.3, z], up, "matte", 12);
  k.sphere(0x2d3340, 0.5, [x, 30.9, z], "matte");
  return k.buildSingle(toon({ vertexColors: true }));
}

const FLAKES = 1500, SNOW_BOX = 36;

/** Snow falling around the camera, wrapped inside a box that follows it. */
function snowfall(): { points: THREE.Points; update: (dt: number, at: THREE.Vector3) => void } {
  const pos = new Float32Array(FLAKES * 3);
  for (let i = 0; i < pos.length; i++) pos[i] = (Math.random() - 0.5) * SNOW_BOX;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.07, transparent: true, opacity: 0.9, depthWrite: false }));
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
  const mat = (map: THREE.Texture, shade = true) => {
    const m = toon({ map, vertexColors: true });
    if (shade) contactShade(m);
    return m;
  };
  const materials: Record<Exclude<Kind, "barrel">, THREE.Material> = {
    floor: mat(tex(look.floor), false),
    wall: mat(tex(look.wall)),
    block: mat(texture(whitePlaster, 4)),
    crate: mat(texture(crate, 1)),
    metal: mat(texture(look.metal, 2)),
    step: mat(tex(look.step)),
    container: mat(texture(ribs("#ffffff", "#d6d6d6", 14, "#555b66"), 2.4)),
    wood: mat(texture(planks, 1.2)),
  };

  // Buildings are houses, each in its own colour; the town around the arena is drawn the same way.
  const ring = townRing(map), all = [...map.boxes, ...ring];
  const houses = new Map(all.filter((b) => b.kind === "block" && b.max[1] >= 3.5).map((b) => [b, house(b, look)]));
  const altMaterial = mat(tex(look.town.alt));

  // One mesh per material: the static map costs a handful of draw calls however many boxes it has.
  const byKind = new Map<Exclude<Kind, "barrel"> | "alt", THREE.BufferGeometry[]>();
  for (const b of all) {
    if (b.kind === "barrel") continue;
    const sx = b.max[0] - b.min[0], sy = b.max[1] - b.min[1], sz = b.max[2] - b.min[2];
    const h = houses.get(b), key = h?.alt ? "alt" : b.kind;
    const g = boxGeometry(sx, sy, sz, b.kind !== "crate", h ? h.tint : b.tint);
    g.translate((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    byKind.set(key, [...(byKind.get(key) ?? []), g]);
  }
  for (const [kind, geos] of byKind) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), kind === "alt" ? altMaterial : materials[kind]);
    for (const g of geos) g.dispose();
    mesh.castShadow = kind !== "floor";
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const capGeos = caps(all, houses, look);
  if (capGeos.length) {
    const capMesh = new THREE.Mesh(mergeGeometries(capGeos), toon({ vertexColors: true }));
    capMesh.castShadow = capMesh.receiveShadow = true;
    group.add(capMesh);
  }
  // hand-placed windows (the range) or windows and doors on every house
  const fronts = [...houses.values()].filter((h) => !map.decor.windows.length || ring.includes(h.box));
  const outside = map.half + 30, ground = new THREE.Mesh(new THREE.PlaneGeometry(outside * 2, outside * 2), toon({ color: look.ground }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  const ringTrees = look.town.trees === "palm" ? palms(map)
    : trees(townRing(map).map((b) => [b.min[0] - 2, b.min[2] - 2] as const), 1.7);
  for (const extra of [windows(map, look), trees(map.decor.trees ?? []), facades(fronts, look, map.theme === "snow"),
    roofs([...houses.values()]), ringTrees, ground, barrels(map.boxes.filter((b) => b.kind === "barrel"))]) if (extra) group.add(extra);
  if (look.sea !== null) {
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), toon({ color: look.sea }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -0.4;
    group.add(sea, lighthouse(map.half + 46, -(map.half + 36)));
  }
  for (const site of ["A", "B"] as const) {
    const [x, y, z, ry] = map.decor.signs[site];
    const sign = siteSign(site);
    sign.position.set(x, y, z);
    sign.rotation.y = ry;
    group.add(sign);
  }

  group.add(sky(look), clouds());
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
          for (const v of Object.values(m)) if (v instanceof THREE.Texture && v !== gradient) v.dispose();
          m.dispose();
        }
      });
      sun.shadow.map?.dispose();
    },
  };
}
