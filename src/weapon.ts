import * as THREE from "three";
import { starTexture } from "./effects";
import { gunKit, handsKit, Kit, viewMaterials, type GunSpec } from "./models";
import { addHull } from "./toon";

type ViewGun = { group: THREE.Group; spec: GunSpec; rest: THREE.Vector3; kick: { up: number; back: number }; inward: number };

const REST = [new THREE.Vector3(0.2, -0.23, -0.62), new THREE.Vector3(0.12, -0.115, -0.4), new THREE.Vector3(0.2, -0.215, -0.6)];
const KICK = [{ up: 0.06, back: 0.05 }, { up: 0.3, back: 0.04 }, { up: 0.22, back: 0.12 }];
const INWARD = [0.06, 0.12, 0.06]; // yaw towards the crosshair

/** First-person gun and hands, drawn in their own pass so they never clip into walls. */
export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.01, 10);
  private readonly guns: ViewGun[];
  private readonly flash: THREE.Mesh;
  private readonly flashLight = new THREE.PointLight(0xffc070, 0, 3);
  private slot = 0;
  private kick = 0;
  private flashTime = 0;
  private bob = 0;
  private sway = new THREE.Vector2();
  private readonly v = new THREE.Vector3();

  constructor() {
    const mats = viewMaterials();
    this.guns = REST.map((rest, id) => {
      const k = new Kit();
      const spec = gunKit(id, k);
      handsKit(spec, k);
      const group = k.build(mats);
      for (const part of group.children) addHull(part as THREE.Mesh, 0.0022); // the world gets its outlines in a pass
      group.visible = id === 0;
      this.scene.add(group);
      return { group, spec, rest, kick: KICK[id], inward: INWARD[id] };
    });

    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.26, 0.26),
      new THREE.MeshBasicMaterial({ map: starTexture(), transparent: true, depthWrite: false }),
    );
    this.flash.visible = false;
    this.guns[0].group.add(this.flash, this.flashLight);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a6a, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(1, 2, 1.5);
    this.scene.add(key);
  }

  fired(): void {
    this.kick = 1;
    this.flashTime = 0.06;
    this.flash.rotation.z = Math.random() * Math.PI;
  }

  /**
   * draw: 0 just switched … 1 ready; reload: 0 … 1 through the reload, 0 when not reloading.
   * look: mouse movement this tick, the gun lags behind it a little.
   */
  update(dt: number, slot: number, speed: number, draw: number, reload: number, look: [number, number], scoped: boolean): void {
    if (slot !== this.slot) {
      this.guns[this.slot].group.visible = false;
      this.slot = slot;
      this.guns[slot].group.add(this.flash, this.flashLight);
      this.kick = 0;
    }
    const gun = this.guns[slot];
    gun.group.visible = !scoped;
    this.flash.position.copy(gun.spec.muzzle);
    this.flashLight.position.copy(gun.spec.muzzle);
    this.flash.scale.setScalar(slot === 1 ? 0.6 : 1);

    this.kick = Math.max(0, this.kick - dt * (slot === 2 ? 4 : 12));
    this.flashTime -= dt;
    this.flash.visible = this.flashTime > 0;
    this.flashLight.intensity = this.flashTime > 0 ? 4 : 0;
    this.bob += dt * (2 + speed * 1.4);
    const move = Math.min(speed / 6, 1);
    this.sway.x += (Math.max(-1, Math.min(1, -look[0] / 40)) - this.sway.x) * Math.min(1, dt * 10);
    this.sway.y += (Math.max(-1, Math.min(1, look[1] / 40)) - this.sway.y) * Math.min(1, dt * 10);

    const r = reload > 0 ? Math.sin(Math.PI * reload) : 0; // dip and roll, then back
    const d = 1 - (1 - draw) ** 3; // bring it up from below
    const k = this.kick;
    gun.group.position.set(
      gun.rest.x + Math.sin(this.bob) * 0.012 * move + this.sway.x * 0.012,
      gun.rest.y + Math.abs(Math.cos(this.bob)) * 0.01 * move - r * 0.12 - (1 - d) * 0.3 + this.sway.y * 0.01,
      gun.rest.z + k * gun.kick.back,
    );
    gun.group.rotation.set(k * gun.kick.up - r * 0.5 - (1 - d) * 1.1, gun.inward + this.sway.x * 0.03, r * 0.6);
  }

  /** Where the muzzle is on screen, in normalised device coordinates. */
  muzzleNdc(out: THREE.Vector2): THREE.Vector2 {
    const gun = this.guns[this.slot];
    gun.group.updateMatrixWorld();
    this.camera.updateMatrixWorld();
    this.v.copy(gun.spec.muzzle).applyMatrix4(gun.group.matrixWorld).project(this.camera);
    return out.set(this.v.x, this.v.y);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
