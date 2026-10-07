import * as THREE from "three";
import { rayBox } from "../shared/collision.ts";
import { MAX_SPEED } from "../shared/constants.ts";
import { DAMAGE_SCALE, rayPlayer } from "../shared/hitbox.ts";
import { MAP, SPAWNS } from "../shared/map.ts";
import { eyeHeight, newPlayer, stepPlayer } from "../shared/movement.ts";
import { bulletDirection, mulberry32, RIFLE, spread } from "../shared/weapons.ts";
import { click, gunshot, hitSound, unlockAudio } from "./audio";
import { spawnBots } from "./bots";
import { Decals, Tracers } from "./effects";
import { Hud } from "./hud";
import { axes, locked, takeMouse } from "./input";
import { startLoop } from "./loop";
import { Gun, ViewModel } from "./weapon";
import { buildWorld } from "./world";

const SENSITIVITY = 0.0022; // radians per mouse pixel
const VIEW_RECOIL = 0.45; // share of the spray the camera shows; bullets land above the crosshair
const RANGE = 120;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.autoClear = false;
document.body.append(renderer.domElement);

const scene = new THREE.Scene();
buildWorld(scene);
const camera = new THREE.PerspectiveCamera(80, innerWidth / innerHeight, 0.05, 200);
camera.rotation.order = "YXZ";
const view = new ViewModel();
view.resize(innerWidth / innerHeight);
const hud = new Hud();
const decals = new Decals(scene);
const tracers = new Tracers(scene);
const bots = spawnBots(scene);

const spawn = SPAWNS.attackers[2];
const me = newPlayer(spawn.x, 0, spawn.z);
let yaw = spawn.yaw, pitch = 0;
const gun = new Gun(RIFLE);
const rand = mulberry32(Date.now());
let devFire = 0; // dev hook: ticks of forced trigger
let devInput = false; // dev hook: read keys without pointer lock (headless browsers have none)
const prev = { ...me.pos };
let eye = eyeHeight(me);

function shoot(): void {
  const speed = Math.hypot(me.vel.x, me.vel.z);
  const cone = spread(RIFLE, speed, me.onGround, me.crouched, gun.shot);
  const d = bulletDirection(yaw, pitch, gun.nextRecoil(), cone, rand);
  const o = { x: me.pos.x, y: me.pos.y + eyeHeight(me), z: me.pos.z };

  let wallT = RANGE, normal: [number, number, number] = [0, 1, 0];
  for (const b of MAP) {
    const h = rayBox(o, d, b, wallT);
    if (h && h.t < wallT) { wallT = h.t; normal = h.normal; }
  }
  let target: { bot: (typeof bots)[number]; t: number; part: keyof typeof DAMAGE_SCALE } | null = null;
  for (const bot of bots) {
    if (!bot.alive) continue;
    const h = rayPlayer(o, d, bot.feet, bot.crouched, wallT);
    if (h && (!target || h.t < target.t)) target = { bot, t: h.t, part: h.part };
  }

  hud.shot();
  const end = new THREE.Vector3(o.x + d.x * (target?.t ?? wallT), o.y + d.y * (target?.t ?? wallT), o.z + d.z * (target?.t ?? wallT));
  if (target) {
    const kill = target.bot.hit(RIFLE.damage * DAMAGE_SCALE[target.part]);
    hud.hit(target.part === "head", kill);
    hitSound(target.part === "head");
  } else if (wallT < RANGE) {
    decals.add(end, new THREE.Vector3(...normal));
  }
  // tracer starts a little below and right of the eye, roughly at the muzzle
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  tracers.add(new THREE.Vector3(o.x, o.y - 0.12, o.z).addScaledVector(right, 0.15), end);
  view.fired();
  gunshot();
}

startLoop(
  (dt) => {
    const [mx, my] = takeMouse();
    yaw -= mx * SENSITIVITY;
    pitch = Math.max(-1.55, Math.min(1.55, pitch - my * SENSITIVITY));
    const a = locked() || devInput ? axes() : { forward: 0, right: 0, jump: false, crouch: false, walk: false, fire: false, reload: false };

    Object.assign(prev, me.pos);
    stepPlayer(me, { forward: a.forward, right: a.right, yaw, jump: a.jump, crouch: a.crouch, walk: a.walk }, dt, MAP);

    const wasReloading = gun.reloading > 0;
    const shots = gun.update(dt, a.fire || devFire > 0, a.reload);
    devFire = Math.max(0, devFire - 1);
    for (let i = 0; i < shots; i++) shoot();
    if (!wasReloading && gun.reloading > 0) click();

    for (const b of bots) b.update(dt);
    tracers.update(dt);
    hud.update(dt);
    view.update(dt, Math.hypot(me.vel.x, me.vel.z), gun.reloading, RIFLE.reloadTime);
  },
  (alpha) => {
    eye += (eyeHeight(me) - eye) * 0.35; // smooth the crouch transition
    const [rp, ry] = gun.viewRecoil();
    camera.position.set(
      prev.x + (me.pos.x - prev.x) * alpha,
      prev.y + (me.pos.y - prev.y) * alpha + eye,
      prev.z + (me.pos.z - prev.z) * alpha,
    );
    camera.rotation.set(pitch + rp * VIEW_RECOIL, yaw - ry * VIEW_RECOIL, 0);
    for (const b of bots) b.render();

    const speed = Math.hypot(me.vel.x, me.vel.z);
    const cone = spread(RIFLE, speed, me.onGround, me.crouched, gun.shot);
    const pxPerRad = innerHeight / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    hud.crosshair(3 + Math.min(cone * pxPerRad, 60));
    hud.ammo(gun.ammo, gun.reserve, gun.reloading > 0 ? 1 - gun.reloading / RIFLE.reloadTime : 0);

    renderer.clear();
    renderer.render(scene, camera);
    renderer.clearDepth();
    renderer.render(view.scene, view.camera);
  },
);

hud.onPlay(() => {
  unlockAudio();
  void renderer.domElement.requestPointerLock();
});
renderer.domElement.addEventListener("click", () => { if (!locked()) void renderer.domElement.requestPointerLock(); });
document.addEventListener("pointerlockchange", () => hud.showStart(!locked()));

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  view.resize(camera.aspect);
  renderer.setSize(innerWidth, innerHeight);
});

if (import.meta.env.DEV) {
  // Hooks for headless checks (scripts/shot.py): pointer lock isn't available there.
  Object.assign(window, {
    __game: {
      look: (y: number, p: number) => { yaw = y; pitch = p; },
      fire: (ticks: number) => { devFire = ticks; },
      start: () => { hud.showStart(false); devInput = true; },
      teleport: (x: number, y: number, z: number) => { Object.assign(me.pos, { x, y, z }); Object.assign(prev, me.pos); },
      state: () => ({
        pos: me.pos, onGround: me.onGround, yaw, pitch, ammo: gun.ammo, reserve: gun.reserve,
        speed: Math.hypot(me.vel.x, me.vel.z) / MAX_SPEED,
        bots: bots.map((b) => ({ hp: b.hp, alive: b.alive })),
      }),
    },
  });
}
