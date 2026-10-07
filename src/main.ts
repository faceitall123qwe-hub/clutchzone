import * as THREE from "three";
import { MAX_SPEED } from "../shared/constants.ts";
import { viewRecoil } from "../shared/gun.ts";
import { DAMAGE_SCALE } from "../shared/hitbox.ts";
import { MAP, SPAWNS } from "../shared/map.ts";
import { eyeHeight } from "../shared/movement.ts";
import type { ServerMsg } from "../shared/protocol.ts";
import { cloneSim, newSim, RANGE, shotSeed, simulate, traceMap, traceTargets, type Bullet, type Cmd } from "../shared/sim.ts";
import { RIFLE, spread } from "../shared/weapons.ts";
import { click, gunshot, hitSound, unlockAudio } from "./audio";
import { spawnBots, type Bot } from "./bots";
import { Decals, Tracers } from "./effects";
import { Hud } from "./hud";
import { axes, isDown, locked, takeMouse } from "./input";
import { startLoop } from "./loop";
import { Net } from "./net";
import { Remotes } from "./remote";
import { ViewModel } from "./weapon";
import { buildWorld } from "./world";

const SENSITIVITY = 0.0022; // radians per mouse pixel
const VIEW_RECOIL = 0.45; // share of the spray the camera shows; bullets land above the crosshair

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.autoClear = false;
renderer.info.autoReset = false; // count the world and the gun pass together
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
const remotes = new Remotes(scene);

type Mode = { kind: "range"; bots: Bot[] } | { kind: "online"; net: Net };
let mode: Mode | null = null;

const spawn = SPAWNS.attackers[2];
let me = newSim(spawn.x, 0, spawn.z);
let yaw = spawn.yaw, pitch = 0, seq = 0, myId = 1;
let pending: Cmd[] = []; // sent to the server, not yet acknowledged
const prev = { ...me.move.pos };
let eye = eyeHeight(me.move);
let alive = true, hp = 100, respawnIn = 0, killedBy: string | null = null;
const names = new Map<number, string>();
let devFire = 0, devInput = false; // dev hooks for headless checks
let frames = 0, fps = 0, fpsSince = performance.now();

const roomParam = new URLSearchParams(location.search).get("room")?.replace(/[^a-z0-9-]/gi, "") || undefined;
hud.menu(true, { room: roomParam });

const vec = (v: { x: number; y: number; z: number }) => new THREE.Vector3(v.x, v.y, v.z);

/** Muzzle flash, tracer and bullet hole for one of our bullets; in the range also the damage. */
function ourShot(b: Bullet): void {
  const wall = traceMap(b, MAP);
  let t = wall.t;
  if (mode?.kind === "range") {
    const hit = traceTargets(b, mode.bots.filter((x) => x.alive).map((x) => ({ id: x, feet: x.feet, crouched: x.crouched })), wall.t);
    if (hit) {
      t = hit.t;
      const kill = hit.id.hit(RIFLE.damage * DAMAGE_SCALE[hit.part]);
      hud.hit(hit.part === "head", kill);
      hitSound(hit.part === "head");
      if (kill) hud.feed(`You ${hit.part === "head" ? "⌖" : "→"} Target`, true);
    }
  }
  const end = vec(b.o).addScaledVector(vec(b.d), t);
  if (t === wall.t && wall.hitWall) decals.add(end, new THREE.Vector3(...wall.normal));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  tracers.add(vec(b.o).add(new THREE.Vector3(0, -0.12, 0)).addScaledVector(right, 0.15), end);
  hud.shot();
  view.fired();
  gunshot();
}

function onSnap(s: Extract<ServerMsg, { type: "snap" }>): void {
  for (const p of s.players) names.set(p.id, p.name);
  // Reconcile: take the server's state for the last command it ran, replay the ones it hasn't yet.
  const before = { ...me.move.pos };
  me = cloneSim(s.you.sim);
  pending = pending.filter((c) => c.seq > s.you.lastSeq);
  if (s.you.alive) for (const c of pending) simulate(me, c, shotSeed(myId, c.seq), MAP);
  if (Math.hypot(me.move.pos.x - before.x, me.move.pos.z - before.z) > 2) Object.assign(prev, me.move.pos); // respawn
  if (!alive && s.you.alive) yaw = Math.atan2(me.move.pos.x, me.move.pos.z); // face the middle of the map
  alive = s.you.alive;
  hp = s.you.hp;
  respawnIn = s.you.respawnIn;
  killedBy = s.you.alive ? null : names.get(s.you.killedBy ?? -1) ?? "someone";

  const killed = new Set(s.events.flatMap((e) => (e.type === "kill" ? [e.victim] : [])));
  for (const e of s.events) {
    if (e.type === "shot" && e.id !== myId) {
      tracers.add(vec(e.o), vec(e.end));
      const d = Math.hypot(e.o.x - me.move.pos.x, e.o.z - me.move.pos.z);
      gunshot(Math.min(0.8, 6 / (d + 6)));
    } else if (e.type === "hit" && e.by === myId) {
      hud.hit(e.part === "head", killed.has(e.target));
      hitSound(e.part === "head");
    } else if (e.type === "hit" && e.target === myId) {
      hud.hurt();
    } else if (e.type === "kill") {
      hud.feed(`${names.get(e.killer) ?? "?"} ${e.head ? "⌖" : "→"} ${names.get(e.victim) ?? "?"}`,
        e.killer === myId || e.victim === myId);
    } else if (e.type === "join" && e.id !== myId) {
      hud.feed(`${e.name} joined`);
    } else if (e.type === "leave") {
      hud.feed(`${e.name} left`);
    }
  }
}

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

startLoop(
  (dt) => {
    const [mx, my] = takeMouse();
    yaw -= mx * SENSITIVITY;
    if (Math.abs(yaw) > Math.PI) yaw -= Math.PI * 2 * Math.round(yaw / (Math.PI * 2)); // the server wraps yaw too
    pitch = Math.max(-1.55, Math.min(1.55, pitch - my * SENSITIVITY));
    const a = locked() || devInput ? axes() : { forward: 0, right: 0, jump: false, crouch: false, walk: false, fire: false, reload: false };
    const cmd: Cmd = { ...a, fire: a.fire || devFire > 0, seq: ++seq, yaw, pitch };
    devFire = Math.max(0, devFire - 1);

    Object.assign(prev, me.move.pos);
    const wasReloading = me.gun.reloading > 0;
    if (mode?.kind === "online") {
      if (alive) for (const b of simulate(me, cmd, shotSeed(myId, cmd.seq), MAP)) ourShot(b);
      pending.push(cmd);
      mode.net.send({ type: "input", cmd, viewTick: mode.net.viewTick() });
    } else if (mode?.kind === "range") {
      for (const b of simulate(me, cmd, shotSeed(myId, cmd.seq), MAP)) ourShot(b);
      for (const bot of mode.bots) bot.update(dt);
    }
    if (!wasReloading && me.gun.reloading > 0) click();

    tracers.update(dt);
    hud.update(dt);
    view.update(dt, Math.hypot(me.move.vel.x, me.move.vel.z), me.gun.reloading, RIFLE.reloadTime);
  },
  (alpha) => {
    eye += (eyeHeight(me.move) - eye) * 0.35; // smooth the crouch transition
    const [rp, ry] = viewRecoil(me.gun, RIFLE);
    const p = me.move.pos;
    camera.position.set(prev.x + (p.x - prev.x) * alpha, prev.y + (p.y - prev.y) * alpha + eye, prev.z + (p.z - prev.z) * alpha);
    camera.rotation.set(pitch + rp * VIEW_RECOIL, yaw - ry * VIEW_RECOIL, 0);

    let targetName = "";
    if (mode?.kind === "range") {
      for (const b of mode.bots) b.render();
    } else if (mode?.kind === "online") {
      const others = mode.net.others();
      remotes.update(others);
      // name of whoever is under the crosshair
      const look = {
        o: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        d: { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) },
      };
      const hit = traceTargets(look, others.filter((x) => x.alive).map((x) => ({ id: x.name, feet: x, crouched: x.crouched })),
        traceMap(look, MAP, RANGE).t);
      if (hit) targetName = hit.id;
      hud.scoreboard(isDown("Tab"), mode.net.latest(), myId);
    }
    hud.target(targetName);
    hud.health(hp);
    hud.dead(alive ? null : killedBy, respawnIn);

    const cone = spread(RIFLE, Math.hypot(me.move.vel.x, me.move.vel.z), me.move.onGround, me.move.crouched, me.gun.shot);
    const pxPerRad = innerHeight / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    hud.crosshair(3 + Math.min(cone * pxPerRad, 60));
    hud.ammo(me.gun.ammo, me.gun.reserve, me.gun.reloading > 0 ? 1 - me.gun.reloading / RIFLE.reloadTime : 0);

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

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  view.resize(camera.aspect);
  renderer.setSize(innerWidth, innerHeight);
});

if (import.meta.env.DEV) {
  // Hooks for automated checks: headless browsers have no pointer lock.
  Object.assign(window, {
    __game: {
      start: () => { if (!mode) goRange(); hud.menu(false); devInput = true; },
      join: async () => { hud.menu(false); devInput = true; await goOnline(roomParam ?? (await quickPlayRoom())); return myId; },
      look: (y: number, p: number) => { yaw = y; pitch = p; },
      fire: (ticks: number) => { devFire = ticks; },
      teleport: (x: number, y: number, z: number) => {
        if (mode?.kind === "online") mode.net.send({ type: "dev", teleport: { x, y, z } });
        Object.assign(me.move.pos, { x, y, z });
        Object.assign(prev, me.move.pos);
      },
      state: () => ({
        id: myId, pos: me.move.pos, onGround: me.move.onGround, crouched: me.move.crouched, yaw, pitch,
        ammo: me.gun.ammo, reserve: me.gun.reserve, hp, alive, pending: pending.length,
        speed: Math.hypot(me.move.vel.x, me.move.vel.z) / MAX_SPEED, locked: locked(), fps,
        drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        bots: mode?.kind === "range" ? mode.bots.map((b) => ({ hp: b.hp, alive: b.alive })) : [],
        others: mode?.kind === "online" ? mode.net.others().map((o) => ({ id: o.id, name: o.name, x: o.x, z: o.z, hp: o.hp })) : [],
        rtt: mode?.kind === "online" ? Math.round(mode.net.rtt) : 0,
      }),
    },
  });
}
