import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Kind, MapDef, Rect, Theme } from "../shared/map.ts";

/**
 * Neon arena: dark surfaces, light only where it glows. Every surface has a dark colour texture and an
 * emissive texture (grid lines, seams, lit windows) in the map's neon colour; strips of light run along
 * the foot and the top of every wall; the outline pass draws the edges in the same colour.
 */
type Look = {
  neon: number; // edges, strips, floor grid
  second: number; // site letters and frames, crate frames
  floor: string; panel: string; seam: string;
  sky: [top: number, horizon: number];
  fog: [color: number, near: number, far: number];
};

export const LOOKS: Record<Theme, Look> = {
  synth: { neon: 0xff3df0, second: 0x3ff0ff, floor: "#100d22", panel: "#1b1734", seam: "#0b0918",
    sky: [0x05030f, 0x4a1260], fog: [0x160a26, 45, 170] },
  toxic: { neon: 0x7dff4a, second: 0xffd84a, floor: "#0b130f", panel: "#16221c", seam: "#070d0a",
    sky: [0x020604, 0x123f20], fog: [0x0a1a10, 45, 170] },
  ice: { neon: 0x36e6ff, second: 0xb98cff, floor: "#0a1220", panel: "#141f33", seam: "#070c16",
    sky: [0x02050c, 0x103e5c], fog: [0x081626, 45, 170] },
};

type Paint = (g: CanvasRenderingContext2D, s: number, rnd: () => number) => void;

function canvas(paint: Paint, size = 512): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  paint(c.getContext("2d")!, size, rnd);
  return c;
}

/** A colour texture and its emissive twin, metres: how many metres one copy covers. */
function surface(base: Paint, glow: Paint, metres: number): { map: THREE.Texture; emissiveMap: THREE.Texture } {
  const make = (p: Paint, color: boolean) => {
    const t = new THREE.CanvasTexture(canvas(p));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.repeat.set(1 / metres, 1 / metres);
    return t;
  };
  return { map: make(base, true), emissiveMap: make(glow, false) };
}

const fill = (color: string): Paint => (g, s) => { g.fillStyle = color; g.fillRect(0, 0, s, s); };
const black = fill("#000");

/** Panels n per side with dark seams between them, a little uneven. */
const panels = (look: Look, n: number): Paint => (g, s, rnd) => {
  g.fillStyle = look.seam;
  g.fillRect(0, 0, s, s);
  const w = s / n, c = new THREE.Color();
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      c.set(look.panel).multiplyScalar(0.9 + rnd() * 0.2);
      g.fillStyle = `#${c.getHexString()}`;
      g.fillRect(i * w + 3, j * w + 3, w - 6, w - 6);
    }
};

/** Thin glowing lines on the borders of n × n squares. */
const grid = (n: number, width: number): Paint => (g, s) => {
  black(g, s, Math.random);
  g.fillStyle = "#fff";
  for (let i = 0; i <= n; i++) {
    const p = (i * s) / n;
    g.fillRect(p - width / 2, 0, width, s);
    g.fillRect(0, p - width / 2, s, width);
  }
};

/** Buildings: rows of windows high up, a few lit (one copy is 6 × 6 m, the height of a block). */
const lit: Paint = (g, s, rnd) => {
  black(g, s, rnd);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 2; r++) {
      if (rnd() < 0.45) continue;
      g.fillStyle = `rgba(255,255,255,${0.35 + rnd() * 0.65})`;
      g.fillRect(c * (s / 4) + 18, 40 + r * 70, s / 4 - 36, 40);
    }
};

/** Vertical slits of light (pillars, the reactor). */
const slits: Paint = (g, s) => {
  black(g, s, Math.random);
  g.fillStyle = "#fff";
  for (let i = 0; i < 4; i++) g.fillRect(i * (s / 4) + s / 8 - 4, s * 0.15, 8, s * 0.7);
};

/** A crate face: a glowing frame around a dark panel (UVs 0..1 per face). */
const frame: Paint = (g, s) => {
  black(g, s, Math.random);
  g.strokeStyle = "#fff";
  g.lineWidth = 14;
  g.strokeRect(20, 20, s - 40, s - 40);
  g.lineWidth = 6;
  g.beginPath(); g.moveTo(40, 40); g.lineTo(s - 40, s - 40); g.stroke();
};

/** Containers: ribbed dark metal with a lit band near the top. */
const ribs = (look: Look): Paint => (g, s) => {
  for (let i = 0; i < 14; i++) {
    g.fillStyle = i % 2 ? look.seam : look.panel;
    g.fillRect((i * s) / 14, 0, s / 14 + 1, s);
  }
};
const band: Paint = (g, s) => { black(g, s, Math.random); g.fillStyle = "#fff"; g.fillRect(0, s * 0.08, s, s * 0.05); };

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

/** Strips of light along the foot and the top of every wall, block and pillar. */
function strips(map: MapDef): THREE.BufferGeometry | null {
  const out: THREE.BufferGeometry[] = [];
  for (const b of map.boxes) {
    if (b.kind === "floor" || b.kind === "crate" || b.kind === "step" || b.max[1] - b.min[1] < 2) continue;
    const sx = b.max[0] - b.min[0] + 0.04, sz = b.max[2] - b.min[2] + 0.04;
    const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
    for (const y of [b.min[1] + 0.07, b.max[1] - 0.05]) {
      const g = new THREE.BoxGeometry(sx, 0.08, sz);
      g.translate(cx, y, cz);
      out.push(g);
    }
  }
  if (!out.length) return null;
  const merged = mergeGeometries(out);
  for (const g of out) g.dispose();
  return merged;
}

/** A glowing frame on the floor around a bomb site. */
function siteFrame(r: Rect): THREE.BufferGeometry {
  const [x1, z1] = r.min, [x2, z2] = r.max, w = 0.18, y = 0.012;
  const parts = [
    [x1, z1, x2, z1 + w], [x1, z2 - w, x2, z2], [x1, z1, x1 + w, z2], [x2 - w, z1, x2, z2],
  ].map(([a, b, c, d]) => {
    const g = new THREE.PlaneGeometry(c - a, d - b);
    g.rotateX(-Math.PI / 2);
    g.translate((a + c) / 2, y, (b + d) / 2);
    return g;
  });
  const merged = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  return merged;
}

/** A hologram letter floating over a bomb site: always faces you, glows through the fog. */
function siteLetter(letter: string, color: number): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.font = "400 210px 'Lilita One', system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  const col = `#${new THREE.Color(color).getHexString()}`;
  g.shadowColor = col;
  g.shadowBlur = 30;
  g.fillStyle = col;
  g.fillText(letter, 128, 140);
  g.shadowBlur = 0;
  g.fillStyle = "rgba(255,255,255,0.85)";
  g.font = "400 150px 'Lilita One', system-ui, sans-serif";
  g.fillText(letter, 128, 140);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false,
    blending: THREE.AdditiveBlending }));
  s.scale.setScalar(3.2);
  return s;
}

function sky(look: Look): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: new THREE.Color(look.sky[0]) }, horizon: { value: new THREE.Color(look.sky[1]) } },
    vertexShader: `varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vDir; uniform vec3 top, horizon;
      void main() {
        float h = vDir.y;
        vec3 col = mix(horizon, top, smoothstep(-0.02, 0.45, h));
        col = mix(col, top * 0.5, smoothstep(0.0, -0.3, h));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), mat);
  mesh.renderOrder = -1;
  return mesh;
}

/** Stars over the upper sky. */
function stars(): THREE.Points {
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const n = 700, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, y = 0.15 + rnd() * 0.85, r = Math.sqrt(1 - y * y);
    pos.set([Math.cos(a) * r * 280, y * 280, Math.sin(a) * r * 280], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false }));
  p.frustumCulled = false;
  return p;
}

/** A city all around, far outside the walls: dark towers with lit windows. */
function city(look: Look, half: number): THREE.Mesh {
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const geos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 70; i++) {
    const a = (i / 70) * Math.PI * 2 + rnd() * 0.05, r = half + 90 + rnd() * 80;
    const w = 12 + rnd() * 16, h = 14 + rnd() * 40;
    const g = boxGeometry(w, h, w, true);
    g.rotateY(-a);
    g.translate(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r);
    geos.push(g);
  }
  const windows = canvas((g, s, rnd) => {
    g.fillStyle = "#06060c";
    g.fillRect(0, 0, s, s);
    const c = new THREE.Color(look.neon), d = new THREE.Color(look.second);
    for (let x = 0; x < 8; x++)
      for (let y = 0; y < 8; y++) {
        if (rnd() < 0.55) continue;
        const k = rnd() < 0.3 ? d : rnd() < 0.5 ? c : new THREE.Color(0xfff2d0);
        g.fillStyle = `rgba(${(k.r * 255) | 0},${(k.g * 255) | 0},${(k.b * 255) | 0},${0.15 + rnd() * 0.35})`;
        g.fillRect(x * (s / 8) + 12, y * (s / 8) + 16, s / 8 - 24, s / 8 - 30);
      }
  });
  const t = new THREE.CanvasTexture(windows);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(1 / 16, 1 / 16);
  const mesh = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshBasicMaterial({ map: t, fog: false }));
  for (const g of geos) g.dispose();
  return mesh;
}

export type World = { group: THREE.Group; neon: THREE.Color; update: (dt: number, camera: THREE.Vector3) => void; dispose: () => void };

/** Everything a map looks like: its boxes in the theme's colours, strips of light, the site markers, sky and city. */
export function buildWorld(scene: THREE.Scene, map: MapDef): World {
  const look = LOOKS[map.theme];
  const group = new THREE.Group();
  const neon = new THREE.Color(look.neon), second = new THREE.Color(look.second);
  const mat = (s: { map: THREE.Texture; emissiveMap: THREE.Texture }, glow: THREE.Color, k = 1) =>
    new THREE.MeshLambertMaterial({ ...s, vertexColors: true, emissive: glow, emissiveIntensity: k });
  const wall = surface(panels(look, 2), black, 4);
  const materials: Record<Kind, THREE.Material> = {
    floor: mat(surface(panels(look, 2), grid(2, 5), 4), neon, 0.55),
    wall: mat(wall, neon),
    block: mat(surface(panels(look, 2), lit, 6), neon, 0.5),
    crate: mat(surface(fill(look.panel), frame, 1), second, 0.9),
    metal: mat(surface(fill(look.seam), slits, 2), neon),
    step: mat(surface(panels(look, 2), grid(2, 5), 2), neon, 0.55),
    container: mat(surface(ribs(look), band, 2.6), second, 0.8),
    wood: mat(surface(fill(look.panel), frame, 1.2), second, 0.6),
  };

  // one mesh per material: the static map costs a handful of draw calls however many boxes it has
  const byKind = new Map<Kind, THREE.BufferGeometry[]>();
  for (const b of map.boxes) {
    const sx = b.max[0] - b.min[0], sy = b.max[1] - b.min[1], sz = b.max[2] - b.min[2];
    const tint = b.kind === "container" && b.tint !== undefined ? new THREE.Color(b.tint).lerp(new THREE.Color(0xffffff), 0.6).getHex() : 0xffffff;
    const g = boxGeometry(sx, sy, sz, b.kind !== "crate", tint);
    g.translate((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    byKind.set(b.kind, [...(byKind.get(b.kind) ?? []), g]);
  }
  for (const [kind, geos] of byKind) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), materials[kind]);
    for (const g of geos) g.dispose();
    group.add(mesh);
  }
  const light = strips(map);
  if (light) group.add(new THREE.Mesh(light, new THREE.MeshBasicMaterial({ color: neon })));
  const frames = mergeGeometries([siteFrame(map.sites.A), siteFrame(map.sites.B)]);
  group.add(new THREE.Mesh(frames, new THREE.MeshBasicMaterial({ color: second, transparent: true, opacity: 0.9 })));
  for (const site of ["A", "B"] as const) {
    const r = map.sites[site], letter = siteLetter(site, look.second);
    letter.position.set((r.min[0] + r.max[0]) / 2, 4.2, (r.min[1] + r.max[1]) / 2);
    group.add(letter);
  }

  group.add(sky(look), stars(), city(look, map.half));
  group.add(new THREE.HemisphereLight(new THREE.Color(look.sky[1]).lerp(new THREE.Color(0xffffff), 0.5), 0x101018, 1.4));
  const key = new THREE.DirectionalLight(0xdfe4ff, 0.9);
  key.position.set(14, 30, 10);
  group.add(key);
  scene.add(group);
  scene.fog = new THREE.Fog(...look.fog);

  return {
    group,
    neon,
    update: () => {},
    dispose: () => {
      scene.remove(group);
      group.traverse((o) => {
        if (!(o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Sprite)) return;
        o.geometry.dispose();
        for (const m of [o.material].flat()) {
          for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
          m.dispose();
        }
      });
    },
  };
}
