import * as THREE from "three";
import { recoilOffset, type WeaponStats } from "../shared/weapons.ts";

/** Ammo, fire rate, reload and spray state. Pure game logic, advanced in fixed ticks. */
export class Gun {
  ammo: number;
  reserve: number;
  shot = 0; // index into the spray pattern
  private cooldown = 0;
  private sinceShot = 99;
  reloading = 0; // seconds left, 0 = not reloading
  readonly stats: WeaponStats;

  constructor(stats: WeaponStats) {
    this.stats = stats;
    this.ammo = stats.magazine;
    this.reserve = stats.reserve;
  }

  /** Returns how many bullets to fire this tick (0 or 1 at these rates). */
  update(dt: number, trigger: boolean, reloadKey: boolean): number {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.sinceShot += dt;
    if (this.sinceShot > this.stats.recoilRecovery) this.shot = 0;

    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const take = Math.min(this.stats.magazine - this.ammo, this.reserve);
        this.ammo += take;
        this.reserve -= take;
        this.reloading = 0;
      }
      return 0;
    }
    if ((reloadKey || (trigger && this.ammo === 0)) && this.ammo < this.stats.magazine && this.reserve > 0) {
      this.reloading = this.stats.reloadTime;
      return 0;
    }
    if (!trigger || this.cooldown > 0 || this.ammo === 0) return 0;
    this.ammo--;
    this.cooldown += this.stats.interval;
    this.sinceShot = 0;
    return 1;
  }

  /** Recoil applied to the bullet about to be fired, then advance the spray. */
  nextRecoil(): [number, number] {
    const r = recoilOffset(this.shot);
    this.shot++;
    return r;
  }

  /** Recoil the view should show now: the current spray position, decaying once firing stops. */
  viewRecoil(): [number, number] {
    const k = Math.max(0, 1 - Math.max(0, this.sinceShot - this.stats.interval) / this.stats.recoilRecovery);
    const [p, y] = recoilOffset(Math.max(0, this.shot - 1));
    return [p * k, y * k];
  }
}

/** First-person gun model drawn in its own pass so it never clips into walls. */
export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.01, 10);
  private readonly gun = new THREE.Group();
  private readonly flash: THREE.Mesh;
  private readonly flashLight = new THREE.PointLight(0xffc070, 0, 3);
  private kick = 0;
  private flashTime = 0;
  private bob = 0;

  constructor() {
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.6, metalness: 0.4 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4426, roughness: 0.8 });
    const part = (m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      this.gun.add(mesh);
    };
    part(dark, 0.07, 0.09, 0.42, 0, 0, 0); // receiver
    part(dark, 0.03, 0.03, 0.36, 0, 0.02, -0.38); // barrel
    part(wood, 0.06, 0.06, 0.2, 0, 0.0, -0.26); // handguard
    part(dark, 0.05, 0.16, 0.07, 0, -0.11, -0.06); // magazine
    part(wood, 0.05, 0.12, 0.05, 0, -0.08, 0.12); // grip
    part(wood, 0.06, 0.09, 0.24, 0, -0.02, 0.32); // stock
    part(dark, 0.02, 0.04, 0.03, 0, 0.065, -0.05); // rear sight

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
    this.flash.position.set(0, 0.02, -0.6);
    this.flash.visible = false;
    this.gun.add(this.flash);
    this.flashLight.position.set(0, 0.02, -0.6);
    this.gun.add(this.flashLight);

    this.scene.add(this.gun);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x554433, 2));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(1, 2, 1);
    this.scene.add(key);
  }

  fired(): void {
    this.kick = 1;
    this.flashTime = 0.05;
    this.flash.rotation.z = Math.random() * Math.PI;
  }

  update(dt: number, speed: number, reloading: number, reloadTime: number): void {
    this.kick = Math.max(0, this.kick - dt * 12);
    this.flashTime -= dt;
    this.flash.visible = this.flashTime > 0;
    this.flashLight.intensity = this.flashTime > 0 ? 4 : 0;
    this.bob += dt * (2 + speed * 1.4);
    const sway = Math.min(speed / 6, 1);
    // reload: dip the gun down and roll it, then bring it back
    const r = reloading > 0 ? Math.sin(Math.PI * (1 - reloading / reloadTime)) : 0;
    this.gun.position.set(
      0.2 + Math.sin(this.bob) * 0.012 * sway,
      -0.23 + Math.abs(Math.cos(this.bob)) * 0.01 * sway - r * 0.12,
      -0.62 + this.kick * 0.05,
    );
    // slight inward yaw so the barrel points towards the crosshair
    this.gun.rotation.set(this.kick * 0.06 - r * 0.5, 0.06, r * 0.6);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
