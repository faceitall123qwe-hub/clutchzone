import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";

const MAX_DECALS = 160;

/** Bullet holes: one instanced mesh (a single draw call), oldest hole reused first. */
export class Decals {
  private readonly mesh: THREE.InstancedMesh;
  private next = 0;
  private readonly dummy = new THREE.Object3D();
  private readonly target = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(10,8,6,1)");
    grad.addColorStop(0.28, "rgba(25,20,15,0.95)");
    grad.addColorStop(0.45, "rgba(60,50,40,0.5)");
    grad.addColorStop(1, "rgba(60,50,40,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const mat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4 });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.11, 0.11), mat, MAX_DECALS);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false; // instances are spread over the whole map
    scene.add(this.mesh);
  }

  clear(): void {
    this.mesh.count = 0;
    this.next = 0;
  }

  add(point: THREE.Vector3, normal: THREE.Vector3): void {
    const d = this.dummy;
    d.position.copy(point).addScaledVector(normal, 0.002);
    d.lookAt(this.target.copy(point).add(normal));
    d.rotateZ(Math.random() * Math.PI);
    d.updateMatrix();
    this.mesh.setMatrixAt(this.next, d.matrix);
    this.next = (this.next + 1) % MAX_DECALS;
    this.mesh.count = Math.max(this.mesh.count, this.next === 0 ? MAX_DECALS : this.next);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

const TRACER_SPEED = 320; // m/s: slow enough to see, fast enough to read as a bullet
const STREAK = 3.5;

/** A one-segment line whose width is in screen pixels, so a tracer 40 m away is still visible. */
function segment(mat: LineMaterial): LineSegments2 {
  const l = new LineSegments2(new LineSegmentsGeometry().setPositions([0, 0, 0, 0, 0, 1]), mat);
  l.frustumCulled = false;
  l.visible = false;
  return l;
}

function place(l: LineSegments2, a: THREE.Vector3, b: THREE.Vector3): void {
  const data = (l.geometry.attributes.instanceStart as THREE.InterleavedBufferAttribute).data;
  (data.array as Float32Array).set([a.x, a.y, a.z, b.x, b.y, b.z]);
  data.needsUpdate = true;
}

/** Bullet streaks flying from the muzzle to the impact, over a faint line along the whole path that
 * shows where the shot came from; a fixed pool. */
export class Tracers {
  private readonly pool: { streak: LineSegments2; line: LineSegments2; from: THREE.Vector3; dir: THREE.Vector3; dist: number; t: number }[] = [];
  private readonly materials: LineMaterial[] = [];
  private next = 0;
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const bright = new LineMaterial({ color: 0xffe066, linewidth: 3.2, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending });
    this.materials.push(bright);
    for (let i = 0; i < 24; i++) {
      const faint = new LineMaterial({ color: 0xfff0d0, linewidth: 1.3, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending });
      this.materials.push(faint);
      const streak = segment(bright), line = segment(faint);
      scene.add(streak, line);
      this.pool.push({ streak, line, from: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, t: 0 });
    }
  }

  setResolution(w: number, h: number): void {
    for (const m of this.materials) m.resolution.set(w, h);
  }

  add(from: THREE.Vector3, to: THREE.Vector3): void {
    const s = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    s.from.copy(from);
    s.dir.subVectors(to, from);
    s.dist = s.dir.length();
    if (s.dist < 0.5) return;
    s.dir.divideScalar(s.dist);
    s.t = 0;
    s.streak.visible = s.line.visible = true;
    place(s.line, from, to);
  }

  update(dt: number): void {
    for (const s of this.pool) {
      if (!s.streak.visible && !s.line.visible) continue;
      s.t += dt;
      const fade = 1 - s.t / 0.1;
      (s.line.material as LineMaterial).opacity = 0.45 * fade;
      s.line.visible = fade > 0;
      if (!s.streak.visible) continue;
      const head = Math.min(s.dist, s.t * TRACER_SPEED);
      const tail = Math.max(0, head - STREAK);
      if (tail >= s.dist - 0.01 || s.t > 0.6) { s.streak.visible = false; continue; }
      place(s.streak, this.a.copy(s.from).addScaledVector(s.dir, tail), this.b.copy(s.from).addScaledVector(s.dir, head));
    }
  }
}

const MAX_PARTICLES = 500;

/** Dust, sparks and blood: one Points draw call, simulated on the CPU. */
export class Particles {
  private readonly geo = new THREE.BufferGeometry();
  private readonly pos = new Float32Array(MAX_PARTICLES * 3);
  private readonly col = new Float32Array(MAX_PARTICLES * 4);
  private readonly size = new Float32Array(MAX_PARTICLES);
  private readonly vel = new Float32Array(MAX_PARTICLES * 3);
  private readonly life = new Float32Array(MAX_PARTICLES);
  private readonly maxLife = new Float32Array(MAX_PARTICLES);
  private readonly grow = new Float32Array(MAX_PARTICLES);
  private readonly gravity = new Float32Array(MAX_PARTICLES);
  private readonly alpha = new Float32Array(MAX_PARTICLES);
  private next = 0;

  /** additive: for things that glow (fire), drawn brighter where they overlap. */
  constructor(scene: THREE.Scene, additive = false) {
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute("color", new THREE.BufferAttribute(this.col, 4));
    this.geo.setAttribute("size", new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { scale: { value: innerHeight / 2 } },
      vertexShader: `
        attribute vec4 color; attribute float size; varying vec4 vColor; uniform float scale;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec4 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          gl_FragColor = vec4(vColor.rgb, vColor.a * smoothstep(0.5, 0.15, d));
        }`,
    });
    this.mat = mat;
    const points = new THREE.Points(this.geo, mat);
    points.frustumCulled = false;
    scene.add(points);
  }

  private readonly mat: THREE.ShaderMaterial;

  /** Point sizes are in metres: they depend on the viewport height and the camera's field of view. */
  setView(height: number, fovDeg: number): void {
    this.mat.uniforms.scale.value = height / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  private spawn(p: THREE.Vector3, v: THREE.Vector3, rgb: [number, number, number], size: number, life: number,
                grow: number, gravity: number, alpha = 1): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX_PARTICLES;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    // colours are given as on screen; the scene is drawn in linear light and converted at the end
    this.col.set([rgb[0] ** 2.2, rgb[1] ** 2.2, rgb[2] ** 2.2, 1], i * 4);
    this.size[i] = size;
    this.life[i] = this.maxLife[i] = life;
    this.grow[i] = grow;
    this.gravity[i] = gravity;
    this.alpha[i] = alpha;
  }

  private readonly v = new THREE.Vector3();
  private readonly rnd = (k: number) => (Math.random() - 0.5) * 2 * k;

  /** Bullet hitting a wall: a puff of dust, a few chips, sparks off metal. */
  impact(p: THREE.Vector3, normal: THREE.Vector3, metal: boolean): void {
    for (let i = 0; i < 6; i++) {
      this.v.copy(normal).multiplyScalar(0.8 + Math.random()).add({ x: this.rnd(0.5), y: this.rnd(0.3) + 0.3, z: this.rnd(0.5) } as THREE.Vector3);
      const g = 0.62 + Math.random() * 0.12;
      this.spawn(p, this.v, [g, g * 0.92, g * 0.8], 0.12 + Math.random() * 0.08, 0.5 + Math.random() * 0.3, 0.35, 0.15);
    }
    for (let i = 0; i < 4; i++) {
      this.v.copy(normal).multiplyScalar(2 + Math.random() * 2).add({ x: this.rnd(2), y: this.rnd(1) + 1.5, z: this.rnd(2) } as THREE.Vector3);
      this.spawn(p, this.v, [0.25, 0.22, 0.18], 0.03, 0.6, 0, 1);
    }
    if (metal) for (let i = 0; i < 6; i++) {
      this.v.copy(normal).multiplyScalar(3 + Math.random() * 3).add({ x: this.rnd(3), y: this.rnd(3), z: this.rnd(3) } as THREE.Vector3);
      this.spawn(p, this.v, [1, 0.8, 0.4], 0.035, 0.18 + Math.random() * 0.12, 0, 0.6);
    }
  }

  /** The bomb going off, on the glowing (additive) particles: a fireball. */
  fireball(p: THREE.Vector3): void {
    for (let i = 0; i < 80; i++) {
      this.v.set(this.rnd(6), 1 + Math.random() * 7, this.rnd(6));
      const k = Math.random();
      this.spawn(p, this.v, [1, 0.45 + k * 0.35, 0.1 + k * 0.15], 1 + Math.random() * 1.5, 0.4 + Math.random() * 0.6, 2.5, -0.3, 0.7);
    }
  }

  /** The bomb going off: a column of smoke that grows and lingers, flying debris. */
  explosion(p: THREE.Vector3): void {
    for (let i = 0; i < 60; i++) {
      this.v.set(this.rnd(2), 2 + Math.random() * 5, this.rnd(2));
      const g = 0.2 + Math.random() * 0.15;
      this.spawn(p, this.v, [g, g, g * 0.95], 0.6 + Math.random() * 0.6, 3 + Math.random() * 2, 1.4, -0.03, 0.55);
    }
    for (let i = 0; i < 50; i++) {
      this.v.set(this.rnd(13), 4 + Math.random() * 9, this.rnd(13));
      this.spawn(p, this.v, [0.2, 0.17, 0.12], 0.08, 1.4, 0, 1);
    }
  }

  /** A hit on a player: a red spray along the bullet. */
  blood(p: THREE.Vector3, dir: THREE.Vector3, head: boolean): void {
    for (let i = 0; i < (head ? 16 : 9); i++) {
      this.v.copy(dir).multiplyScalar(0.8 + Math.random() * 1.5).add({ x: this.rnd(1.2), y: this.rnd(1) + 0.4, z: this.rnd(1.2) } as THREE.Vector3);
      this.spawn(p, this.v, [0.55 + Math.random() * 0.15, 0.03, 0.03], 0.07 + Math.random() * 0.08, 0.35 + Math.random() * 0.25, 0.2, 1);
    }
  }

  update(dt: number): void {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      this.vel[i * 3 + 1] -= 9.8 * this.gravity[i] * dt;
      const drag = 1 - Math.min(1, dt * 3);
      for (let a = 0; a < 3; a++) {
        if (a !== 1 || this.gravity[i] < 0.5) this.vel[i * 3 + a] *= drag;
        this.pos[i * 3 + a] += this.vel[i * 3 + a] * dt;
      }
      this.size[i] += this.grow[i] * dt;
      this.col[i * 4 + 3] = k * this.alpha[i];
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
  }
}

/** A cartoon muzzle flash: an eight-pointed star, white-yellow inside, orange at the tips. */
export function starTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const star = (r1: number, r2: number, color: string) => {
    g.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, r = i % 2 ? r2 : r1;
      g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
    }
    g.closePath();
    g.fillStyle = color;
    g.fill();
  };
  star(62, 26, "#ff8a1f");
  star(46, 20, "#ffd23f");
  star(26, 12, "#fffbe6");
  return new THREE.CanvasTexture(c);
}

/** Other players' muzzle flashes: additive sprites. */
export class Flashes {
  private readonly pool: { sprite: THREE.Sprite; life: number }[] = [];
  private next = 0;

  constructor(scene: THREE.Scene) {
    const mat = new THREE.SpriteMaterial({ map: starTexture(), depthWrite: false, transparent: true });
    for (let i = 0; i < 10; i++) {
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      scene.add(sprite);
      this.pool.push({ sprite, life: 0 });
    }
  }

  add(p: THREE.Vector3, size: number, life = 0.05): void {
    const f = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    f.sprite.position.copy(p);
    f.sprite.scale.setScalar(size);
    f.sprite.material.rotation = Math.random() * Math.PI;
    f.sprite.visible = true;
    f.life = life;
  }

  update(dt: number): void {
    for (const f of this.pool) {
      f.life -= dt;
      if (f.life <= 0) f.sprite.visible = false;
    }
  }
}
