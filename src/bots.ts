import * as THREE from "three";
import type { Vec3 } from "../shared/collision.ts";
import { hitboxes } from "../shared/hitbox.ts";

/** Practice targets: walk back and forth between two points, die, respawn. No shooting back yet. */
export class Bot {
  readonly feet: Vec3;
  hp = 100;
  respawnIn = 0;
  readonly mesh = new THREE.Group();
  private t = Math.random() * 10;
  private flash = 0;
  private readonly mats: THREE.MeshStandardMaterial[];
  private readonly a: Vec3;
  private readonly b: Vec3;
  private readonly speed: number;
  readonly crouched: boolean;

  constructor(a: Vec3, b: Vec3, crouched = false, speed = 2) {
    this.a = a;
    this.b = b;
    this.crouched = crouched;
    this.speed = speed;
    this.feet = { ...a };
    const body = new THREE.MeshStandardMaterial({ color: 0xb8433a, roughness: 0.7 });
    const head = new THREE.MeshStandardMaterial({ color: 0xe0b48a, roughness: 0.7 });
    const legs = new THREE.MeshStandardMaterial({ color: 0x3d4652, roughness: 0.8 });
    this.mats = [head, body, legs];
    // one mesh per hitbox, so what you see is exactly what you can hit
    for (const [i, { box }] of hitboxes({ x: 0, y: 0, z: 0 }, crouched).entries()) {
      const s = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
      const m = new THREE.Mesh(new THREE.BoxGeometry(s[0], s[1], s[2]), this.mats[i]);
      m.position.set(0, (box.min[1] + box.max[1]) / 2, 0);
      m.castShadow = true;
      this.mesh.add(m);
    }
  }

  get alive() {
    return this.hp > 0;
  }

  hit(damage: number): boolean {
    this.hp -= damage;
    this.flash = 0.08;
    if (this.hp <= 0) {
      this.respawnIn = 2.5;
      return true;
    }
    return false;
  }

  update(dt: number): void {
    if (!this.alive) {
      this.respawnIn -= dt;
      if (this.respawnIn <= 0) this.hp = 100;
    }
    const len = Math.hypot(this.b.x - this.a.x, this.b.z - this.a.z);
    if (len > 0) {
      this.t += (dt * this.speed) / len;
      const k = 0.5 - 0.5 * Math.cos(this.t * Math.PI); // ease in/out at both ends
      this.feet.x = this.a.x + (this.b.x - this.a.x) * k;
      this.feet.z = this.a.z + (this.b.z - this.a.z) * k;
    }
    this.flash = Math.max(0, this.flash - dt);
  }

  render(): void {
    this.mesh.visible = this.alive;
    this.mesh.position.set(this.feet.x, this.feet.y, this.feet.z);
    for (const m of this.mats) m.emissive.setRGB(this.flash > 0 ? 0.6 : 0, 0, 0);
  }
}

export function spawnBots(scene: THREE.Scene): Bot[] {
  const bots = [
    new Bot({ x: -3, y: 0, z: -12 }, { x: 3, y: 0, z: -12 }), // through the mid doors
    new Bot({ x: 18, y: 1.5, z: -21 }, { x: 22, y: 1.5, z: -17 }, false, 1.5), // on the A platform
    new Bot({ x: -18, y: 0, z: -16 }, { x: -18, y: 0, z: -16 }, true), // crouched behind B crates
    new Bot({ x: -22, y: 0, z: 10 }, { x: -16, y: 0, z: -4 }, false, 3), // running down B long
    new Bot({ x: 19, y: 0, z: 12 }, { x: 19, y: 0, z: 0 }), // A long
    new Bot({ x: 0, y: 0, z: -2 }, { x: 0, y: 0, z: -2 }), // standing in mid
  ];
  for (const b of bots) scene.add(b.mesh);
  return bots;
}
