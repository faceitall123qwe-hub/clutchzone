import * as THREE from "three";
import { MAX_SPEED, WALK_FACTOR } from "../shared/constants.ts";
import { viewRecoil } from "../shared/gun.ts";
import { DAMAGE_SCALE, type Part } from "../shared/hitbox.ts";
import { MAP, SPAWNS } from "../shared/map.ts";
import { eyeHeight } from "../shared/movement.ts";
import type { GameEvent, Snapshot } from "../shared/protocol.ts";
import {
  cloneSim, gunOf, newSim, RANGE, shotSeed, simulate, traceMap, traceTargets, weaponOf, type Bullet, type Cmd,
} from "../shared/sim.ts";
import { spread, WEAPONS } from "../shared/weapons.ts";
import { click, footstep, gunshot, hitSound, setVolume, unlockAudio } from "./audio";
import { spawnBots, type Bot } from "./bots";
import { Decals, Flashes, Particles, Tracers } from "./effects";
import { Hud } from "./hud";
import { axes, isDown, locked, takeMouse } from "./input";
import { startLoop } from "./loop";
import { Net } from "./net";
import { Remotes } from "./remote";
import { ViewModel } from "./weapon";
import { buildWorld } from "./world";

const SENSITIVITY = 0.0022; // radians per mouse pixel at sensitivity 1
const VIEW_RECOIL = 0.45; // share of the spray the camera shows; bullets land above the crosshair

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.autoClear = false;
renderer.info.autoReset = false; // count the world and the gun pass together
document.body.append(renderer.domElement);

const scene = new THREE.Scene();
buildWorld(scene);
const camera = new THREE.PerspectiveCamera(80, innerWidth / innerHeight, 0.05, 250);
camera.rotation.order = "YXZ";
const view = new ViewModel(renderer);
view.resize(innerWidth / innerHeight);
const hud = new Hud();
const decals = new Decals(scene);
const tracers = new Tracers(scene);
const particles = new Particles(scene);
const flashes = new Flashes(scene);
const remotes = new Remotes(scene);
setVolume(hud.settings.volume);
hud.onSettings = (s) => setVolume(s.volume);

type Mode = { kind: "range"; bots: Bot[] } | { kind: "online"; net: Net };
let mode: Mode | null = null;

const spawn = SPAWNS.attackers[2];
let me = newSim(spawn.x, 0, spawn.z);
let yaw = spawn.yaw, pitch = 0, seq = 0, myId = 1;
let pending: Cmd[] = []; // sent to the server, not yet acknowledged
const prev = { ...me.move.pos };
let eye = eyeHeight(me.move);
let alive = true, hp = 100, respawnIn = 0, killedBy: string | null = null;
let spawned = false; // first snapshot received
let wantSlot = 0, lastSlot = 1, scopeOn = false, stepDist = 0;
const names = new Map<number, string>();
let devFire = 0, devInput = false; // dev hooks for headless checks
let frames = 0, fps = 0, fpsSince = performance.now();

const roomParam = new URLSearchParams(location.search).get("room")?.replace(/[^a-z0-9-]/gi, "") || undefined;
hud.menu(true, { room: roomParam });

const vec = (v: { x: number; y: number; z: number }) => new THREE.Vector3(v.x, v.y, v.z);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const ndc = new THREE.Vector2(), muzzle = new THREE.Vector3(), tmp = new THREE.Vector3();

/** Dust and a bullet hole where a bullet hit the map; sparks off metal. */
function wallImpact(o: THREE.Vector3, end: THREE.Vector3): void {
  const d = tmp.subVectors(end, o).normalize();
  const hit = traceMap({ o, d }, MAP, o.distanceTo(end) + 0.05);
  if (!hit.hitWall) return;
  const n = new THREE.Vector3(...hit.normal);
  decals.add(end, n);
  particles.impact(end, n, MAP[hit.index].kind === "metal");
}

/** Where our tracer starts: on screen it must leave the muzzle of the first-person gun, which is drawn
 * with its own camera, so take the muzzle's pixel and go a little way into the world along it. */
function ourMuzzle(): THREE.Vector3 {
  if (scopeOn) return muzzle.copy(camera.position).add(tmp.set(0, -0.15, 0));
  view.muzzleNdc(ndc);
  tmp.set(ndc.x, ndc.y, 0.5).unproject(camera).sub(camera.position).normalize();
  return muzzle.copy(camera.position).addScaledVector(tmp, 0.9);
}

/** Muzzle flash, tracer and impact for one of our bullets; in the range also the damage. */
function ourShot(b: Bullet): void {
  const wall = traceMap(b, MAP);
  let t = wall.t, onPlayer = false;
  if (mode?.kind === "range") {
    const hit = traceTargets(b, mode.bots.filter((x) => x.alive).map((x) => ({ id: x, feet: x.feet, crouched: x.crouched })), wall.t);
    if (hit) {
      t = hit.t;
      onPlayer = true;
      const kill = hit.id.hit(WEAPONS[b.w].damage * DAMAGE_SCALE[hit.part]);
      hud.hit(hit.part === "head", kill);
      hitSound(hit.part === "head");
      particles.blood(vec(b.o).addScaledVector(vec(b.d), t), vec(b.d), hit.part === "head");
      if (kill) hud.feed("You", "Target", b.w, hit.part === "head", true);
    }
  } else if (mode?.kind === "online") {
    // the tracer stops at whoever we see in the way; the server decides whether it really hit
    const hit = traceTargets(b, mode.net.others().filter((x) => x.alive).map((x) => ({ id: x.id, feet: x, crouched: x.crouched })), wall.t);
    if (hit) { t = hit.t; onPlayer = true; }
  }
  const end = vec(b.o).addScaledVector(vec(b.d), t);
  if (!onPlayer && wall.hitWall) wallImpact(vec(b.o), end);
  tracers.add(ourMuzzle(), end);
  hud.shot();
  view.fired();
  gunshot(b.w);
}

/** Other players' shots wait until the moment their model is drawn shooting (~100 ms in the past),
 * so the tracer leaves the gun we see. */
type Fx = { tick: number; shot: Extract<GameEvent, { type: "shot" }>; hit: { target: number; part: Part } | null };
let fxQueue: Fx[] = [];

function playFx(f: Fx): void {
  const e = f.shot;
  const start = new THREE.Vector3();
  if (!remotes.muzzle(e.id, start)) start.copy(vec(e.o));
  const end = vec(e.end);
  tracers.add(start, end);
  flashes.add(start, e.w === 1 ? 0.35 : 0.6);
  const d = Math.hypot(e.o.x - me.move.pos.x, e.o.z - me.move.pos.z);
  gunshot(e.w, Math.min(0.8, 6 / (d + 6)));
  if (f.hit) {
    particles.blood(end, tmp.subVectors(end, vec(e.o)).normalize(), f.hit.part === "head");
    remotes.hurt(f.hit.target);
  } else {
    wallImpact(vec(e.o), end);
  }
}

function onSnap(s: Snapshot): void {
  for (const p of s.players) names.set(p.id, p.name);
  // Reconcile: take the server's state for the last command it ran, replay the ones it hasn't yet.
  const before = { ...me.move.pos };
  me = cloneSim(s.you.sim);
  pending = pending.filter((c) => c.seq > s.you.lastSeq);
  if (s.you.alive) for (const c of pending) simulate(me, c, shotSeed(myId, c.seq), MAP);
  if (Math.hypot(me.move.pos.x - before.x, me.move.pos.z - before.z) > 2) Object.assign(prev, me.move.pos); // respawn
  // on joining and after every respawn, face the middle of the map instead of the spawn wall
  if (!spawned || (!alive && s.you.alive)) {
    yaw = Math.atan2(me.move.pos.x, me.move.pos.z);
    pitch = 0;
    spawned = true;
  }
  alive = s.you.alive;
  hp = s.you.hp;
  respawnIn = s.you.respawnIn;
  killedBy = s.you.alive ? null : names.get(s.you.killedBy ?? -1) ?? "someone";

  const killed = new Set(s.events.flatMap((e) => (e.type === "kill" ? [e.victim] : [])));
  const lastShot = new Map<number, Fx | Extract<GameEvent, { type: "shot" }>>();
  for (const e of s.events) {
    if (e.type === "shot") {
      if (e.id === myId) { lastShot.set(e.id, e); continue; } // drawn when we fired
      const f: Fx = { tick: s.tick, shot: e, hit: null };
      fxQueue.push(f);
      lastShot.set(e.id, f);
    } else if (e.type === "hit") {
      const shot = lastShot.get(e.by);
      if (shot && "tick" in shot) shot.hit = { target: e.target, part: e.part };
      if (e.by === myId) {
        hud.hit(e.part === "head", killed.has(e.target));
        hitSound(e.part === "head");
        if (shot && !("tick" in shot)) {
          const end = vec(shot.end);
          particles.blood(end, tmp.subVectors(end, vec(shot.o)).normalize(), e.part === "head");
          remotes.hurt(e.target);
        }
      }
      if (e.target === myId) {
        const from = mode?.kind === "online" ? mode.net.others().find((o) => o.id === e.by) : undefined;
        hud.hurt(from ? wrap(Math.atan2(-(from.x - me.move.pos.x), -(from.z - me.move.pos.z)) - yaw) : null);
      }
    } else if (e.type === "kill") {
      hud.feed(names.get(e.killer) ?? "?", names.get(e.victim) ?? "?", e.w, e.head, e.killer === myId || e.victim === myId);
    } else if (e.type === "join" && e.id !== myId) {
      hud.notice(`${e.name} joined`);
    } else if (e.type === "leave") {
      hud.notice(`${e.name} left`);
    }
  }
}

remotes.onStep = (at) => footstep(Math.min(0.7, 3 / (at.distanceTo(camera.position) + 3)) - 0.05);

async function goOnline(room: string): Promise<void> {
  history.replaceState(null, "", `?room=${room}`);
  const net = new Net(room, hud.name);
  mode = { kind: "online", net };
  net.onSnap = onSnap;
  net.onClose = (reason) => { hud.error(reason); document.exitPointerLock(); };
  try {
    myId = await net.ready;
  } catch (e) {
    hud.error((e as Error).message);
    mode = null;
  }
}

function goRange(): void {
  mode = { kind: "range", bots: spawnBots(scene) };
  me = newSim(spawn.x, 0, spawn.z);
  Object.assign(prev, me.move.pos);
}

// after a shot the bolt is worked with the eye off the scope; it comes back once the rifle is ready
const aiming = () => scopeOn && gunOf(me).cooldown < 1e-9 && me.draw === 0;
const fov = () => (aiming() ? weaponOf(me).scope!.fov : hud.settings.fov);

startLoop(
  (dt) => {
    const [mx, my] = takeMouse();
    // scoped, the same mouse movement turns the view less, by how much the scope narrows it
    const sens = SENSITIVITY * hud.settings.sens * Math.tan(THREE.MathUtils.degToRad(fov() / 2)) /
      Math.tan(THREE.MathUtils.degToRad(hud.settings.fov / 2));
    yaw -= mx * sens;
    if (Math.abs(yaw) > Math.PI) yaw -= Math.PI * 2 * Math.round(yaw / (Math.PI * 2)); // the server wraps yaw too
    pitch = Math.max(-1.55, Math.min(1.55, pitch - my * sens));
    const idle = { forward: 0, right: 0, jump: false, crouch: false, walk: false, fire: false, reload: false,
      slot: -1, lastWeapon: false, wheel: 0, scope: false };
    const a = locked() || devInput ? axes() : idle;

    if (a.slot >= 0 && a.slot !== wantSlot) { lastSlot = wantSlot; wantSlot = a.slot; }
    if (a.lastWeapon) [wantSlot, lastSlot] = [lastSlot, wantSlot];
    if (a.wheel) { lastSlot = wantSlot; wantSlot = (wantSlot + a.wheel + WEAPONS.length) % WEAPONS.length; }
    if (a.scope && weaponOf(me).scope && alive) scopeOn = !scopeOn;
    if (wantSlot !== me.slot || gunOf(me).reloading > 0 || !alive) scopeOn = false;
    const aim = aiming();

    const cmd: Cmd = { forward: a.forward, right: a.right, jump: a.jump, crouch: a.crouch, walk: a.walk,
      fire: a.fire || devFire > 0, reload: a.reload, seq: ++seq, yaw, pitch, slot: wantSlot, aim };
    devFire = Math.max(0, devFire - 1);

    Object.assign(prev, me.move.pos);
    const wasReloading = gunOf(me).reloading > 0;
    if (mode?.kind === "online") {
      if (alive) for (const b of simulate(me, cmd, shotSeed(myId, cmd.seq), MAP)) ourShot(b);
      pending.push(cmd);
      mode.net.send({ type: "input", cmd, viewTick: mode.net.viewTick() });
    } else if (mode?.kind === "range") {
      for (const b of simulate(me, cmd, shotSeed(myId, cmd.seq), MAP)) ourShot(b);
      for (const bot of mode.bots) bot.update(dt);
    }
    if (!wasReloading && gunOf(me).reloading > 0) click();

    const speed = Math.hypot(me.move.vel.x, me.move.vel.z);
    if (alive && me.move.onGround && !me.move.crouched && speed > MAX_SPEED * WALK_FACTOR + 0.2) {
      stepDist += speed * dt;
      if (stepDist > 1.65) { stepDist = 0; footstep(0.35); }
    }

    tracers.update(dt);
    particles.update(dt);
    flashes.update(dt);
    hud.update(dt);
    const w = weaponOf(me), gun = gunOf(me);
    view.update(dt, me.slot, speed, 1 - me.draw / w.drawTime, gun.reloading > 0 ? 1 - gun.reloading / w.reloadTime : 0,
      [mx, my], aiming());
  },
  (alpha) => {
    eye += (eyeHeight(me.move) - eye) * 0.35; // smooth the crouch transition
    const w = weaponOf(me), gun = gunOf(me);
    const [rp, ry] = viewRecoil(gun, w);
    const p = me.move.pos;
    camera.position.set(prev.x + (p.x - prev.x) * alpha, prev.y + (p.y - prev.y) * alpha + eye, prev.z + (p.z - prev.z) * alpha);
    camera.rotation.set(pitch + rp * VIEW_RECOIL, yaw - ry * VIEW_RECOIL, 0);
    const aim = aiming();
    const wantFov = fov();
    if (camera.fov !== wantFov) {
      camera.fov = wantFov;
      camera.updateProjectionMatrix();
      particles.setView(innerHeight, wantFov);
    }

    let targetName = "";
    if (mode?.kind === "range") {
      for (const b of mode.bots) b.render();
    } else if (mode?.kind === "online") {
      const net = mode.net;
      const others = net.others();
      remotes.update(others);
      const now = net.viewTick();
      const due = fxQueue.filter((f) => f.tick <= now + 1);
      fxQueue = fxQueue.filter((f) => f.tick > now + 1 && f.tick < now + 120);
      for (const f of due) playFx(f);
      // name of whoever is under the crosshair
      const look = {
        o: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        d: { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) },
      };
      const hit = traceTargets(look, others.filter((x) => x.alive).map((x) => ({ id: x.name, feet: x, crouched: x.crouched })),
        traceMap(look, MAP, RANGE).t);
      if (hit) targetName = hit.id;
      hud.scoreboard(isDown("Tab"), net.latest(), myId);
    }
    hud.target(targetName);
    hud.health(hp);
    hud.dead(alive ? null : killedBy, respawnIn);
    hud.scope(aim);

    const cone = spread(w, Math.hypot(me.move.vel.x, me.move.vel.z), me.move.onGround, me.move.crouched, gun.shot, aim);
    const pxPerRad = innerHeight / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    hud.crosshair(3 + Math.min(cone * pxPerRad, 60), !w.scope);
    hud.weapon(me.slot, gun.ammo, gun.reserve, gun.reloading > 0 ? 1 - gun.reloading / w.reloadTime : 0);

    frames++;
    if (performance.now() - fpsSince >= 1000) {
      fps = frames;
      frames = 0;
      fpsSince = performance.now();
    }
    renderer.info.reset();
    renderer.clear();
    renderer.render(scene, camera);
    renderer.clearDepth();
    renderer.render(view.scene, view.camera);
  },
);

const lock = () => void renderer.domElement.requestPointerLock();
const randomRoom = () => Math.random().toString(36).slice(2, 8);
async function quickPlayRoom(): Promise<string> {
  try {
    return (await (await fetch("api/quickplay")).json()).room;
  } catch {
    return `pub-${randomRoom()}`;
  }
}
const join = (room: string) => {
  unlockAudio();
  lock(); // must happen inside the click: browsers only grant pointer lock to a user gesture
  if (!mode) void goOnline(room);
};
hud.on("online", () => {
  if (mode || roomParam) { join(roomParam ?? ""); return; }
  unlockAudio();
  lock();
  void quickPlayRoom().then((room) => { if (!mode) void goOnline(room); });
});
hud.on("private", () => join(randomRoom()));
// keep the public room list fresh while the menu is open before the game starts
async function refreshRooms(): Promise<void> {
  if (mode) return;
  try {
    hud.rooms(await (await fetch("api/rooms")).json(), join);
  } catch { /* static hosting without the game server: no list */ }
}
void refreshRooms();
setInterval(refreshRooms, 3000);
hud.on("range", () => {
  unlockAudio();
  lock();
  goRange();
});
renderer.domElement.addEventListener("click", () => { if (mode && !locked()) lock(); });
document.addEventListener("pointerlockchange", () => {
  const room = mode?.kind === "online" ? mode.net.room : roomParam;
  hud.menu(!locked(), { room, playing: mode?.kind });
});

function resize(): void {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  view.resize(camera.aspect);
  renderer.setSize(innerWidth, innerHeight);
  particles.setView(innerHeight, camera.fov);
  tracers.setResolution(innerWidth, innerHeight);
}
addEventListener("resize", resize);
resize();

if (import.meta.env.DEV) {
  // Hooks for automated checks: headless browsers have no pointer lock.
  Object.assign(window, {
    __game: {
      start: () => { if (!mode) goRange(); hud.menu(false); devInput = true; },
      join: async () => { hud.menu(false); devInput = true; await goOnline(roomParam ?? (await quickPlayRoom())); return myId; },
      look: (y: number, p: number) => { yaw = y; pitch = p; },
      fire: (ticks: number) => { devFire = ticks; },
      weapon: (slot: number) => { wantSlot = slot; },
      scope: (on: boolean) => { scopeOn = on; },
      teleport: (x: number, y: number, z: number) => {
        if (mode?.kind === "online") mode.net.send({ type: "dev", teleport: { x, y, z } });
        Object.assign(me.move.pos, { x, y, z });
        Object.assign(prev, me.move.pos);
      },
      state: () => ({
        id: myId, pos: me.move.pos, onGround: me.move.onGround, crouched: me.move.crouched, yaw, pitch,
        slot: me.slot, ammo: gunOf(me).ammo, reserve: gunOf(me).reserve, hp, alive, pending: pending.length,
        speed: Math.hypot(me.move.vel.x, me.move.vel.z) / MAX_SPEED, locked: locked(), fps,
        drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        bots: mode?.kind === "range" ? mode.bots.map((b) => ({ hp: b.hp, alive: b.alive })) : [],
        others: mode?.kind === "online" ? mode.net.others().map((o) => ({ id: o.id, name: o.name, x: o.x, z: o.z, hp: o.hp })) : [],
        rtt: mode?.kind === "online" ? Math.round(mode.net.rtt) : 0,
      }),
    },
  });
}
