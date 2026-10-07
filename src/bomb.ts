import * as THREE from "three";
import { TICK } from "../shared/constants.ts";
import { BOMB_TIME, type RoundState } from "../shared/protocol.ts";
import { beep } from "./audio";
import { bombKit, Kit, viewMaterials } from "./models";

/** The bomb lying in the world, dropped or planted; once planted it blinks and beeps faster and faster. */
export class BombView {
  private readonly group = new THREE.Group();
  private readonly led: THREE.Mesh;
  private sinceBeep = 0;

  constructor(scene: THREE.Scene) {
    const k = new Kit();
    bombKit(k);
    this.group.add(k.build(viewMaterials()));
    this.led = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
    this.led.position.set(0.12, 0.115, -0.06);
    this.group.add(this.led);
    this.group.visible = false;
    scene.add(this.group);
  }

  /** listener: the camera, for how loud the beeps are. */
  update(dt: number, round: RoundState | null, serverTick: number, listener: THREE.Vector3): void {
    const b = round?.bomb;
    const lying = !!b?.pos && round!.phase !== "warmup" && !(round!.phase === "over" && round!.reason === "The bomb exploded");
    this.group.visible = lying;
    if (!lying || !b?.pos) return;
    this.group.position.set(b.pos.x, b.pos.y, b.pos.z);
    const ticking = b.planted && round!.phase === "live";
    const left = Math.max(0, (round!.endsAt - serverTick) * TICK);
    const every = 0.12 + 0.88 * Math.min(1, left / BOMB_TIME);
    this.sinceBeep += dt;
    if (ticking && this.sinceBeep >= every) {
      this.sinceBeep = 0;
      beep(Math.min(1, 4 / (listener.distanceTo(this.group.position) + 4)));
    }
    this.led.visible = ticking && this.sinceBeep < 0.08;
  }
}
