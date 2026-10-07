import * as THREE from "three";
import { hitboxes } from "../shared/hitbox.ts";
import type { RemotePlayer } from "../shared/protocol.ts";

/** A body built from the hitboxes, so what you see is exactly what you can hit. */
function body(crouched: boolean, color: THREE.Color): THREE.Group {
  const g = new THREE.Group();
  const mats = [
    new THREE.MeshStandardMaterial({ color: 0xe0b48a, roughness: 0.7 }),
    new THREE.MeshStandardMaterial({ color, roughness: 0.7 }),
    new THREE.MeshStandardMaterial({ color: 0x3d4652, roughness: 0.8 }),
  ];
  for (const [i, { box }] of hitboxes({ x: 0, y: 0, z: 0 }, crouched).entries()) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]), mats[i]);
    m.position.y = (box.min[1] + box.max[1]) / 2;
    m.castShadow = true;
    g.add(m);
  }
  const top = hitboxes({ x: 0, y: 0, z: 0 }, crouched)[1].box.max[1];
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.7), new THREE.MeshStandardMaterial({ color: 0x22252a }));
  gun.position.set(0.18, top - 0.18, -0.3);
  g.add(gun);
  return g;
}

type View = { root: THREE.Group; stand: THREE.Group; crouch: THREE.Group };

export class Remotes {
  private readonly views = new Map<number, View>();
  private readonly scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  update(players: RemotePlayer[]): void {
    const seen = new Set<number>();
    for (const p of players) {
      seen.add(p.id);
      let v = this.views.get(p.id);
      if (!v) {
        const color = new THREE.Color().setHSL(((p.id * 0.137) % 1), 0.55, 0.45);
        v = { root: new THREE.Group(), stand: body(false, color), crouch: body(true, color) };
        v.root.add(v.stand, v.crouch);
        this.scene.add(v.root);
        this.views.set(p.id, v);
      }
      v.root.visible = p.alive;
      v.stand.visible = !p.crouched;
      v.crouch.visible = p.crouched;
      v.root.position.set(p.x, p.y, p.z);
      v.root.rotation.y = p.yaw;
    }
    for (const [id, v] of this.views)
      if (!seen.has(id)) {
        this.scene.remove(v.root);
        v.root.traverse((o) => {
          if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
        });
        this.views.delete(id);
      }
  }
}
