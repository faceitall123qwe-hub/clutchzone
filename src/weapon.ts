import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { gunKit, handsKit, Kit, viewMaterials, type GunSpec } from "./models";

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

  /** renderer: to pre-filter a studio environment, so the gun's metal has something to reflect. */
  constructor(renderer: THREE.WebGLRenderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.7;
    pmrem.dispose();
    const mats = viewMaterials();
    this.guns = REST.map((rest, id) => {
      const k = new Kit();
      const spec = gunKit(id, k);
      handsKit(spec, k);
      const group = k.build(mats);
      group.visible = id === 0;
      this.scene.add(group);
      return { group, spec, rest, kick: KICK[id], inward: INWARD[id] };
    });

    const glow = document.createElement("canvas");
    glow.width = glow.height = 64;
    const g = glow.getContext("2d")!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,240,200,1)");
    grad.addColorStop(0.3, "rgba(255,170,60,0.8)");
    grad.addColorStop(1, "rgba(255,120,20,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.22, 0.22),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(glow), transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.flash.visible = false;
    this.guns[0].group.add(this.flash, this.flashLight);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x554433, 2));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(1, 2, 1);
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
