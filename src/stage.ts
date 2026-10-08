import * as THREE from "three";
import { decodeLook } from "./cosmetics";
import { starTexture } from "./effects";
import { OUTFITS } from "./models";
import { stance } from "./remote";
import { toon } from "./toon";

/** A posed soldier for marketing shots: where, facing, team, cosmetics, weapon, aim pitch, stride. */
export type Pose = { x: number; y?: number; z: number; yaw: number; team: number; look: string; gun?: number; pitch?: number;
  stride?: number; crouch?: boolean; firing?: boolean };

/**
 * Dev only: soldiers frozen mid-fight, with muzzle flashes and tracers, for the store covers and the
 * first frame of the trailer. Returns a function that removes them.
 */
export function stage(scene: THREE.Scene, poses: Pose[], tracers: [THREE.Vector3, THREE.Vector3][] = []): () => void {
  const group = new THREE.Group();
  const flash = new THREE.SpriteMaterial({ map: starTexture(), depthWrite: false, transparent: true });
  for (const p of poses) {
    const s = stance(OUTFITS[p.team], !!p.crouch, toon({ vertexColors: true }), decodeLook(p.look));
    const root = new THREE.Group();
    root.add(s.group);
    root.position.set(p.x, p.y ?? 0, p.z);
    root.rotation.y = p.yaw;
    s.guns.forEach((g, i) => (g.visible = i === (p.gun ?? 0)));
    s.aim.rotation.x = p.pitch ?? 0;
    s.legs[0].rotation.x = p.stride ?? 0;
    s.legs[1].rotation.x = -(p.stride ?? 0);
    group.add(root);
    if (p.firing) {
      root.updateMatrixWorld(true);
      const star = new THREE.Sprite(flash);
      star.position.copy(s.muzzles[p.gun ?? 0]).applyMatrix4(s.aim.matrixWorld);
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
