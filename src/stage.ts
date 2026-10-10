import * as THREE from "three";
import { hitboxes } from "../shared/hitbox.ts";
import { Soldier } from "./characters";
import { decodeLook } from "./cosmetics";
import { starTexture } from "./effects";

/** A posed soldier for marketing shots: where, facing, team, cosmetics, weapon, aim pitch, running or not. */
export type Pose = { x: number; y?: number; z: number; yaw: number; team: number; look: string; gun?: number; pitch?: number;
  stride?: number; speed?: number; crouch?: boolean; firing?: boolean; time?: number; boxes?: boolean };

/**
 * Dev only: soldiers frozen mid-fight, with muzzle flashes and tracers, for the store covers and the
 * first frame of the trailer. A non-zero stride means running; time picks the moment of the stride.
 */
export function stage(scene: THREE.Scene, poses: Pose[], tracers: [THREE.Vector3, THREE.Vector3][] = []): () => void {
  const group = new THREE.Group();
  const flash = new THREE.SpriteMaterial({ map: starTexture(), depthWrite: false, transparent: true });
  for (const p of poses) {
    const s = new Soldier(p.team, decodeLook(p.look));
    s.root.position.set(p.x, p.y ?? 0, p.z);
    s.root.rotation.y = p.yaw;
    s.setWeapon(p.gun ?? 0);
    const state = { speed: p.speed ?? (p.stride ? 6 : 0), forward: 1, right: 0, crouched: !!p.crouch, alive: true, airborne: false, pitch: p.pitch ?? 0 };
    for (let t = 0; t < (p.time ?? 0.6); t += 1 / 60) s.update(1 / 60, state); // settle into the pose
    group.add(s.root);
    if (p.boxes) // what the server shoots at, to line the model up with
      for (const { part, box } of hitboxes({ x: p.x, y: p.y ?? 0, z: p.z }, !!p.crouch))
        group.add(new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(...box.min), new THREE.Vector3(...box.max)),
          part === "head" ? 0xff2020 : part === "body" ? 0x20ff40 : 0x2080ff));
    if (p.firing) {
      s.root.updateMatrixWorld(true);
      const star = new THREE.Sprite(flash);
      s.muzzle(star.position);
      star.scale.setScalar(0.9);
      group.add(star);
    }
  }
  const beam = new THREE.MeshBasicMaterial({ color: 0xffe066 });
  for (const [a, b] of tracers) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, a.distanceTo(b), 6), beam);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.lookAt(b);
    m.rotateX(Math.PI / 2);
    group.add(m);
  }
  scene.add(group);
  return () => scene.remove(group);
}
