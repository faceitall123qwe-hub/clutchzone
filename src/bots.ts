import * as THREE from "three";
import type { Vec3 } from "../shared/collision.ts";
import { Soldier, soldiersLoaded } from "./characters";
import { TARGET_OUTFIT } from "./models";
import { stance } from "./remote";
import { toon } from "./toon";

/** Practice targets: walk back and forth between two points, die, respawn. No shooting back yet. */
export class Bot {
  readonly feet: Vec3;
  hp = 100;
  respawnIn = 0;
  readonly mesh = new THREE.Group();
  private t = Math.random() * 10;
  private flash = 0;
  private readonly mat = toon({ vertexColors: true });
  private readonly a: Vec3;
  private readonly b: Vec3;
  private readonly speed: number;
  readonly crouched: boolean;
  private soldier: Soldier | null = null;
  private moved = 0;

  constructor(a: Vec3, b: Vec3, crouched = false, speed = 2) {
    this.a = a;
    this.b = b;
    this.crouched = crouched;
    this.speed = speed;
    this.feet = { ...a };
    // the old blocky soldier until the animated models have loaded; facing the attackers' spawn
    this.mesh.add(stance(TARGET_OUTFIT, crouched, this.mat).group);
    this.mesh.rotation.y = Math.PI;
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
    const x = this.feet.x, z = this.feet.z;
    if (len > 0) {
      this.t += (dt * this.speed) / len;
      const k = 0.5 - 0.5 * Math.cos(this.t * Math.PI); // ease in/out at both ends
      this.feet.x = this.a.x + (this.b.x - this.a.x) * k;
      this.feet.z = this.a.z + (this.b.z - this.a.z) * k;
    }
    this.moved = dt > 0 ? Math.hypot(this.feet.x - x, this.feet.z - z) / dt : 0;
    this.flash = Math.max(0, this.flash - dt);
    if (!this.soldier && soldiersLoaded()) {
      this.mesh.clear();
      this.soldier = new Soldier(0);
      this.mesh.add(this.soldier.root);
    }
    this.soldier?.update(dt, { speed: this.moved, crouched: this.crouched, alive: true, airborne: false, pitch: 0 });
  }

  render(): void {
    this.mesh.visible = this.alive;
    this.mesh.position.set(this.feet.x, this.feet.y, this.feet.z);
    (this.soldier?.material ?? this.mat).emissive.setRGB(this.flash > 0 ? 0.6 : 0, 0, 0);
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
