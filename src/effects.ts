import * as THREE from "three";

const MAX_DECALS = 160;

/** Bullet holes: one instanced mesh (a single draw call), oldest hole reused first. */
export class Decals {
  private readonly mesh: THREE.InstancedMesh;
  private next = 0;
  private readonly dummy = new THREE.Object3D();
  private readonly target = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x1a1612, transparent: true, opacity: 0.85,
      polygonOffset: true, polygonOffsetFactor: -4 });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.07, 0.07), mat, MAX_DECALS);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false; // instances are spread over the whole map
    scene.add(this.mesh);
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
