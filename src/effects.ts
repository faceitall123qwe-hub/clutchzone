import * as THREE from "three";

const MAX_DECALS = 120;

/** Bullet holes: a fixed pool of small quads, oldest reused first. */
export class Decals {
  private readonly pool: THREE.Mesh[] = [];
  private next = 0;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.PlaneGeometry(0.07, 0.07);
    const mat = new THREE.MeshBasicMaterial({ color: 0x1a1612, transparent: true, opacity: 0.85,
      polygonOffset: true, polygonOffsetFactor: -4 });
    for (let i = 0; i < MAX_DECALS; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      scene.add(m);
      this.pool.push(m);
    }
  }

  add(point: THREE.Vector3, normal: THREE.Vector3): void {
    const m = this.pool[this.next];
    this.next = (this.next + 1) % MAX_DECALS;
    m.position.copy(point).addScaledVector(normal, 0.002);
    m.lookAt(point.clone().add(normal));
    m.rotateZ(Math.random() * Math.PI);
    m.visible = true;
  }
}

/** Short-lived tracer line from the muzzle to the impact. */
export class Tracers {
  private readonly lines: { line: THREE.Line; life: number }[] = [];
  private readonly scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  add(from: THREE.Vector3, to: THREE.Vector3): void {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.6 }));
    this.scene.add(line);
    this.lines.push({ line, life: 0.05 });
  }

  update(dt: number): void {
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const t = this.lines[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        (t.line.material as THREE.Material).dispose();
        this.lines.splice(i, 1);
      }
    }
  }
}
