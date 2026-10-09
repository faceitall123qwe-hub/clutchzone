import * as THREE from "three";
import { blocked } from "../shared/collision.ts";
import { CROUCH_EYE, MAX_SPEED, PLAYER_RADIUS, STAND_EYE, STAND_HEIGHT, TICK, WALK_FACTOR } from "../shared/constants.ts";
import { viewRecoil } from "../shared/gun.ts";
import { DAMAGE_SCALE, type Part } from "../shared/hitbox.ts";
import { siteAt, type MapDef } from "../shared/map.ts";
import { mapById } from "../shared/maps.ts";
import { OUTPOST } from "../shared/maps/outpost.ts";
import { eyeHeight } from "../shared/movement.ts";
import { ATK, DEFUSE_RANGE, TEAM_NAMES, type GameEvent, type RemotePlayer, type RoundState, type Snapshot } from "../shared/protocol.ts";
import {
  cloneSim, gunOf, newSim, RANGE, shotSeed, simulate, traceMap, traceTargets, weaponOf, type Bullet, type Cmd,
} from "../shared/sim.ts";
import { spread, WEAPONS } from "../shared/weapons.ts";
import { actClick, audioTrack, click, explosion, footstep, gunshot, hitSound, levelUpSound, roundEnd, setVolume, unlockAudio } from "./audio";
import { BombView } from "./bomb";
import { api, PORTAL } from "./config";
import { crazyGames, type CrazySDK } from "./crazygames";
import { effectOf, encodeLook, paintOf } from "./cosmetics";
import { Meta } from "./locker";
import { levelOf, Progress } from "./profile";
import { drawCard } from "./share";
import { spawnBots, type Bot } from "./bots";
import { loadSoldiers, Soldier } from "./characters";
import { Decals, Flashes, Particles, Tracers } from "./effects";
import { Hud } from "./hud";
import { axes, isDown, locked, takeMouse } from "./input";
import { startLoop } from "./loop";
import { Net } from "./net";
import { Radar } from "./radar";
import { Remotes } from "./remote";
import { Outline } from "./toon";
import { ViewModel } from "./weapon";
import { buildWorld, type World } from "./world";

const SENSITIVITY = 0.0022; // radians per mouse pixel at sensitivity 1
const VIEW_RECOIL = 0.45; // share of the spray the camera shows; bullets land above the crosshair

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // crisp cartoon shadows
renderer.autoClear = false;
renderer.info.autoReset = false; // count the world and the gun pass together
document.body.append(renderer.domElement);

const scene = new THREE.Scene();
let currentMap: MapDef = OUTPOST;
let world: World = buildWorld(scene, currentMap);
const camera = new THREE.PerspectiveCamera(80, innerWidth / innerHeight, 0.05, 250);
camera.rotation.order = "YXZ";
const view = new ViewModel();
const outline = new Outline();
view.resize(innerWidth / innerHeight);
const hud = new Hud();
const decals = new Decals(scene);
const tracers = new Tracers(scene);
const particles = new Particles(scene);
const glow = new Particles(scene, true);
const flashes = new Flashes(scene);
const remotes = new Remotes(scene);
const bombView = new BombView(scene);
const radar = new Radar(document.getElementById("hud")!);
radar.setMap(currentMap);

/** Compiles every shader now, hidden pooled effects included. Otherwise the first tracer, muzzle flash or
 * dropped bomb compiles its shader mid-fight, a 100-200 ms freeze on Windows. */
function warmUp(): void {
  const hidden: THREE.Object3D[] = [];
  for (const root of [scene, view.scene])
    root.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
  renderer.setRenderTarget(outline.target);
  renderer.compile(scene, camera);
  renderer.setRenderTarget(null);
  renderer.compile(view.scene, view.camera);
  for (const o of hidden) o.visible = false;
}

// the soldiers' models: one hidden copy stays in the scene so warmUp() compiles their shader up front
void loadSoldiers().then(() => {
  view.setPaint(paintOf(progress.p.look.paint), true); // the kit's guns in first person too
  const warm = new Soldier(0);
  warm.root.visible = false;
  scene.add(warm.root);
  warmUp();
});

/** Rooms change maps between matches: rebuild what's drawn; the simulation reads currentMap.boxes. */
function setMap(map: MapDef): void {
  if (map === currentMap) return;
  world.dispose();
  currentMap = map;
  world = buildWorld(scene, map);
  radar.setMap(map);
  decals.clear();
  warmUp();
}
setVolume(hud.settings.volume);
hud.onSettings = (s) => setVolume(cg?.game.settings.muteAudio ? 0 : s.volume);

// progress: XP, levels, unlocks and daily challenges, kept in the browser
const progress = new Progress();
const meta = new Meta(progress);
// portals don't allow links that take players to another site: no invite links, no private rooms by link
if (PORTAL) document.body.classList.add("portal");
if (PORTAL === "desktop") document.body.classList.add("invites");
view.setPaint(paintOf(progress.p.look.paint));
progress.on({
  xp: (g) => hud.xpPop(g.xp, g.reason),
  level: (level, unlocked) => { hud.levelUp(level, unlocked); levelUpSound(); cg?.game.happytime(); },
  challenge: (c) => hud.toast(`Challenge done: ${c.text}`),
});
meta.onWear = (look) => {
  view.setPaint(paintOf(look.paint));
  if (mode?.kind === "online") mode.net.send({ type: "look", look: encodeLook(look) });
};
// arriving through a friend's link: double XP for the first hour
const refParam = new URLSearchParams(location.search).get("ref")?.replace(/[^a-z0-9]/g, "") || undefined;
let welcome = !!refParam && progress.isNew;
if (welcome) progress.boost(60);
/** This match so far, for the summary and the share card. */
let match = { kills: 0, deaths: 0, heads: 0 };
/** A small copy of the frame of one of our kills, for the share card; taken right after rendering. */
const highlight = document.createElement("canvas");
highlight.width = 480; highlight.height = 270;
let wantHighlight = false, highlightAt = -Infinity, haveHighlight = false;
let lastPhase = "", lastRound = 0;

type Mode = { kind: "range"; bots: Bot[] } | { kind: "online"; net: Net };
let mode: Mode | null = null;
let cg: CrazySDK | null = null;
let inGame = false;
/** Tell CrazyGames when the player is in a match rather than the menu. The mouse is often captured before
 * Quick play has a room, so this runs on both changes. */
function gameplay(): void {
  const now = locked() && mode !== null;
  if (now === inGame) return;
  inGame = now;
  if (now) cg?.game.gameplayStart(); else cg?.game.gameplayStop();
}

const spawn = OUTPOST.spawns.attackers[2];
let me = newSim(spawn.x, 0, spawn.z);
let yaw = spawn.yaw, pitch = 0, seq = 0, myId = 1;
let pending: Cmd[] = []; // sent to the server, not yet acknowledged
const prev = { ...me.move.pos };
let eye = eyeHeight(me.move);
let alive = true, hp = 100, respawnIn = 0, killedBy: string | null = null;
let spawned = false; // first snapshot received
let wantSlot = 0, lastSlot = 1, scopeOn = false, stepDist = 0;
let act = 0, actClickIn = 0, deadAt = 0, shake = 0;
let specId: number | null = null, specNext = false, firing = false; // whom we watch after dying
const names = new Map<number, string>(), teams = new Map<number, number>(), looks = new Map<number, string>();
let devFire = 0, devInput = false; // dev hooks for headless checks
let devCam: { x: number; y: number; z: number; yaw: number; pitch: number } | null = null;
let devFov: number | null = null, devNoGun = false; // marketing shots
let autoAim: { head: boolean; strafe: number } | null = null; // dev: plays itself, smoothly, for gameplay footage

/** Dev autopilot: swing the view onto the nearest enemy in sight like a player would, then fire. */
function autoPilot(dt: number): { fire: boolean; right: number } {
  if (!autoAim || mode?.kind !== "online" || !alive) return { fire: false, right: 0 };
  const team = mode.net.team(), eyeY = me.move.pos.y + eyeHeight(me.move);
  let best: RemotePlayer | null = null, bestD = Infinity;
  for (const o of mode.net.others()) {
    if (!o.alive || o.team === team) continue;
    const d = { x: o.x - me.move.pos.x, y: o.y + 1.3 - eyeY, z: o.z - me.move.pos.z };
    const dist = Math.hypot(d.x, d.z);
    if (dist < bestD && traceMap({ o: { ...me.move.pos, y: eyeY }, d }, currentMap.boxes, 1).t >= 1) { best = o; bestD = dist; }
  }
  if (!best) return { fire: false, right: autoAim.strafe };
  const aimY = best.y + (best.crouched ? 0.9 : autoAim.head ? 1.6 : 1.25);
  const dx = best.x - me.move.pos.x, dz = best.z - me.move.pos.z;
  const wantYaw = Math.atan2(-dx, -dz), wantPitch = Math.atan2(aimY - eyeY, Math.hypot(dx, dz));
  const k = 1 - Math.exp(-dt * 6);
  yaw += wrap(wantYaw - yaw) * k;
  pitch += (wantPitch - pitch) * k;
  const on = Math.abs(wrap(wantYaw - yaw)) < 0.02 && Math.abs(wantPitch - pitch) < 0.02;
  return { fire: on, right: on ? 0 : autoAim.strafe };
}
let frames = 0, fps = 0, fpsSince = performance.now(), lastFrame = performance.now(), longest = 0, longestShown = 0;

let roomParam = new URLSearchParams(location.search).get("room")?.replace(/[^a-z0-9-]/gi, "") || undefined;
hud.menu(true, { room: roomParam });

const vec = (v: { x: number; y: number; z: number }) => new THREE.Vector3(v.x, v.y, v.z);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const ndc = new THREE.Vector2(), muzzle = new THREE.Vector3(), tmp = new THREE.Vector3();

/** Dust and a bullet hole where a bullet hit the map; sparks off metal. */
function wallImpact(o: THREE.Vector3, end: THREE.Vector3): void {
  const d = tmp.subVectors(end, o).normalize();
  const hit = traceMap({ o, d }, currentMap.boxes, o.distanceTo(end) + 0.05);
  if (!hit.hitWall) return;
  const n = new THREE.Vector3(...hit.normal);
  decals.add(end, n);
  const kind = currentMap.boxes[hit.index].kind;
  particles.impact(end, n, kind === "metal" || kind === "container");
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
  const wall = traceMap(b, currentMap.boxes);
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
    const team = mode.net.team(); // bullets pass through teammates
    const hit = traceTargets(b, mode.net.others().filter((x) => x.alive && x.team !== team)
      .map((x) => ({ id: x.id, feet: x, crouched: x.crouched })), wall.t);
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
  if (s.round) setMap(mapById(s.round.map));
  for (const p of s.players) { names.set(p.id, p.name); teams.set(p.id, p.team); looks.set(p.id, p.look); }
  if (s.round) roundProgress(s.round);
  // Reconcile: take the server's state for the last command it ran, replay the ones it hasn't yet.
  const before = { ...me.move.pos };
  me = cloneSim(s.you.sim);
  pending = pending.filter((c) => c.seq > s.you.lastSeq);
  if (s.you.alive) for (const c of pending) simulate(me, c, shotSeed(myId, c.seq), currentMap.boxes);
  const moved = Math.hypot(me.move.pos.x - before.x, me.move.pos.z - before.z) > 2; // (re)spawned
  if (moved) { Object.assign(prev, me.move.pos); scopeOn = false; }
  // on joining and at every spawn, face the middle of the map instead of the spawn wall
  if (!spawned || moved || (!alive && s.you.alive)) {
    yaw = Math.atan2(me.move.pos.x, me.move.pos.z);
    pitch = 0;
  }
  if (spawned && alive && !s.you.alive) deadAt = performance.now();
  if (!alive && s.you.alive) progress.spawned();
  spawned = true;
  alive = s.you.alive;
  hp = s.you.hp;
  respawnIn = s.you.respawnIn;
  act = s.you.act;
  killedBy = s.you.alive ? null : s.you.killedBy === null ? "the bomb" : names.get(s.you.killedBy) ?? "someone";

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
      hud.feed(names.get(e.killer) ?? "?", names.get(e.victim) ?? "?", e.w, e.head, e.killer === myId || e.victim === myId,
        [teams.get(e.killer) ?? 0, teams.get(e.victim) ?? 0]);
      if (e.killer === myId && e.victim !== myId) {
        match.kills++;
        if (e.head) match.heads++;
        progress.kill(e.head, e.w);
        if (performance.now() - highlightAt > 8000) wantHighlight = true;
      }
      if (e.victim === myId) { match.deaths++; progress.died(); }
      killEffect(e.killer, e.victim);
    } else if (e.type === "planted") {
      hud.notice(`Bomb planted at ${e.site}`);
      if (e.by === myId) progress.planted();
    } else if (e.type === "defused") {
      hud.notice(`${names.get(e.by) ?? "?"} defused the bomb`);
      if (e.by === myId) progress.defused();
    } else if (e.type === "referral" && e.to === myId) {
      progress.boost(60);
      hud.toast(`${e.name} joined through your link: double XP for an hour!`);
    } else if (e.type === "exploded") {
      const at = vec(e.pos);
      particles.explosion(at);
      glow.fireball(at);
      flashes.add(at.clone().add(tmp.set(0, 1, 0)), 16, 0.25);
      const d = camera.position.distanceTo(at);
      explosion(Math.min(1, 14 / (d + 6)));
      shake = Math.max(shake, Math.min(1, 16 / (d + 4)));
    } else if (e.type === "roundEnd") {
      const won = mode?.kind === "online" && e.winner === mode.net.team();
      roundEnd(won);
      if (won) progress.roundWon();
    } else if (e.type === "join" && e.id !== myId) {
      hud.notice(`${e.name} joined`);
    } else if (e.type === "leave") {
      hud.notice(`${e.name} left`);
    }
  }
}

/** The killer's kill effect (confetti, stars, hearts) bursts where the victim stood. */
function killEffect(killer: number, victim: number): void {
  const fx = effectOf((looks.get(killer) ?? "").split(".")[2] ?? "");
  if (!fx.colors.length || mode?.kind !== "online") return;
  const v = victim === myId ? me.move.pos : mode.net.others().find((o) => o.id === victim);
  if (v) particles.confetti(new THREE.Vector3(v.x, v.y + 1.3, v.z), fx.colors);
}

/** Round and match milestones: the day's first round, a new match, the end of a match. */
function roundProgress(r: RoundState): void {
  if (r.phase === lastPhase && r.round === lastRound) return;
  if (r.phase === "live" && lastPhase !== "live") {
    const bonus = progress.playedToday();
    if (bonus) hud.toast(`Day ${progress.p.streak} in a row!`);
    if (welcome) { hud.toast("A friend invited you: double XP for an hour!"); welcome = false; }
  }
  if (r.phase === "freeze" && r.round === 1) { match = { kills: 0, deaths: 0, heads: 0 }; progress.matchXp = 0; haveHighlight = false; }
  if (r.phase === "matchover" && lastPhase && lastPhase !== "matchover" && mode?.kind === "online") {
    const won = r.winner === mode.net.team();
    progress.matchEnded(won);
    meta.setLastMatch({ ...match, map: currentMap.name, won, score: mode.net.team() === 0 ? r.score : [r.score[1], r.score[0]],
      level: levelOf(progress.p.xp).level, name: hud.name, shot: haveHighlight ? highlight : undefined });
    hud.toast(`Match over: +${progress.matchXp} XP. Share it from the menu (Esc)`);
  }
  lastPhase = r.phase;
  lastRound = r.round;
}

remotes.onStep = (at) => footstep(Math.min(0.7, 3 / (at.distanceTo(camera.position) + 3)) - 0.05);

/** map: the first map of a room we open ourselves. */
async function goOnline(room: string, map?: string): Promise<void> {
  history.replaceState(null, "", `?room=${room}`);
  meta.name = hud.name;
  const net = new Net(room, hud.name, map, { look: encodeLook(progress.p.look), pid: progress.p.id, ref: refParam });
  mode = { kind: "online", net };
  gameplay();
  net.onSnap = onSnap;
  net.onClose = (reason) => { hud.error(reason); document.exitPointerLock(); };
  try {
    myId = await net.ready;
    cg?.game.updateRoom({ roomId: room, isJoinable: true, inviteParams: { roomId: room } });
  } catch (e) {
    hud.error((e as Error).message);
    mode = null;
    gameplay();
  }
}

function goRange(): void {
  setMap(OUTPOST);
  mode = { kind: "range", bots: spawnBots(scene) };
  gameplay();
  me = newSim(spawn.x, 0, spawn.z);
  Object.assign(prev, me.move.pos);
}

// after a shot the bolt is worked with the eye off the scope; it comes back once the rifle is ready
const aiming = () => scopeOn && gunOf(me).cooldown < 1e-9 && me.draw === 0;
const fov = () => (aiming() ? weaponOf(me).scope!.fov : hud.settings.fov);

warmUp();
startLoop(
  (dt) => {
    const [mx, my] = takeMouse();
    // scoped, the same mouse movement turns the view less, by how much the scope narrows it
    const sens = SENSITIVITY * hud.settings.sens * Math.tan(THREE.MathUtils.degToRad(fov() / 2)) /
      Math.tan(THREE.MathUtils.degToRad(hud.settings.fov / 2));
    yaw -= mx * sens;
    if (Math.abs(yaw) > Math.PI) yaw -= Math.PI * 2 * Math.round(yaw / (Math.PI * 2)); // the server wraps yaw too
    pitch = Math.max(-1.55, Math.min(1.55, pitch - my * sens));
    const idle = { forward: 0, right: 0, jump: false, crouch: false, walk: false, fire: false, reload: false, use: false,
      slot: -1, lastWeapon: false, wheel: 0, scope: false };
    const a = locked() || devInput ? axes() : idle;
    if (autoAim) { const ap = autoPilot(dt); a.fire = ap.fire; a.right = ap.right; }

    if (a.slot >= 0 && a.slot !== wantSlot) { lastSlot = wantSlot; wantSlot = a.slot; }
    if (a.lastWeapon) [wantSlot, lastSlot] = [lastSlot, wantSlot];
    if (a.wheel) { lastSlot = wantSlot; wantSlot = (wantSlot + a.wheel + WEAPONS.length) % WEAPONS.length; }
    if (a.scope && weaponOf(me).scope && alive) scopeOn = !scopeOn;
    if (wantSlot !== me.slot || gunOf(me).reloading > 0 || !alive) scopeOn = false;
    const aim = aiming();

    const cmd: Cmd = { forward: a.forward, right: a.right, jump: a.jump, crouch: a.crouch, walk: a.walk,
      fire: a.fire || devFire > 0, reload: a.reload, seq: ++seq, yaw, pitch, slot: wantSlot, aim, use: a.use };
    devFire = Math.max(0, devFire - 1);
    if (!alive && a.fire && !firing) specNext = true; // dead: a click watches the next teammate
    firing = a.fire;

    Object.assign(prev, me.move.pos);
    const wasReloading = gunOf(me).reloading > 0;
    if (mode?.kind === "online") {
      if (alive) for (const b of simulate(me, cmd, shotSeed(myId, cmd.seq), currentMap.boxes)) ourShot(b);
      pending.push(cmd);
      mode.net.send({ type: "input", cmd, viewTick: mode.net.viewTick() });
    } else if (mode?.kind === "range") {
      for (const b of simulate(me, cmd, shotSeed(myId, cmd.seq), currentMap.boxes)) ourShot(b);
      for (const bot of mode.bots) bot.update(dt);
    }
    if (!wasReloading && gunOf(me).reloading > 0) click();

    const speed = Math.hypot(me.move.vel.x, me.move.vel.z);
    if (alive && me.move.onGround && !me.move.crouched && speed > MAX_SPEED * WALK_FACTOR + 0.2) {
      stepDist += speed * dt;
      if (stepDist > 1.65) { stepDist = 0; footstep(0.35); }
    }

    if (act > 0 && (actClickIn -= dt) <= 0) { actClick(); actClickIn = 0.5; }
    shake = Math.max(0, shake - dt * 1.5);
    if (mode?.kind === "online") bombView.update(dt, mode.net.round, mode.net.serverTick(), camera.position);
    world.update(dt, camera.position);
    tracers.update(dt);
    particles.update(dt);
    glow.update(dt);
    flashes.update(dt);
    hud.update(dt);
    const w = weaponOf(me), gun = gunOf(me);
    view.update(dt, me.slot, speed, 1 - me.draw / w.drawTime, gun.reloading > 0 ? 1 - gun.reloading / w.reloadTime : 0,
      [mx, my], aiming());
  },
  (alpha) => {
    eye += (eyeHeight(me.move) - eye) * 0.35; // smooth the crouch transition
    const w = weaponOf(me), gun = gunOf(me);
    const net = mode?.kind === "online" ? mode.net : null;
    const round = net?.round ?? null;
    const now = net?.serverTick() ?? 0;
    const others = net?.others() ?? [];
    const myTeam = net?.team() ?? ATK;
    const inMatch = !!round && round.phase !== "warmup";

    // dead in a round: after a moment, watch a living teammate through their eyes
    const watching = !!net && !alive && inMatch && performance.now() - deadAt > 1500;
    let spec: RemotePlayer | null = null;
    if (watching) {
      const mates = others.filter((o) => o.alive && o.team === myTeam);
      if (specNext || !mates.some((m) => m.id === specId)) {
        specId = mates[(mates.findIndex((m) => m.id === specId) + 1) % Math.max(1, mates.length)]?.id ?? null;
        specNext = false;
      }
      spec = mates.find((m) => m.id === specId) ?? null;
    }
    const aim = aiming() && !watching;
    if (spec) {
      camera.position.set(spec.x, spec.y + (spec.crouched ? CROUCH_EYE : STAND_EYE), spec.z);
      camera.rotation.set(spec.pitch, spec.yaw, 0);
    } else if (watching) { // nobody left to watch: look over the map
      camera.position.set(0, currentMap.half + 6, currentMap.half + 8);
      camera.lookAt(0, 0, -4);
    } else {
      const [rp, ry] = viewRecoil(gun, w);
      const p = me.move.pos;
      camera.position.set(prev.x + (p.x - prev.x) * alpha, prev.y + (p.y - prev.y) * alpha + eye, prev.z + (p.z - prev.z) * alpha);
      camera.rotation.set(pitch + rp * VIEW_RECOIL, yaw - ry * VIEW_RECOIL, 0);
    }
    if (devCam) {
      camera.position.set(devCam.x, devCam.y, devCam.z);
      camera.rotation.set(devCam.pitch, devCam.yaw, 0);
    }
    if (shake > 0) camera.position.add(tmp.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(shake * 0.25));
    const wantFov = devFov ?? (watching ? hud.settings.fov : fov());
    if (camera.fov !== wantFov) {
      camera.fov = wantFov;
      camera.updateProjectionMatrix();
      particles.setView(innerHeight, wantFov);
      glow.setView(innerHeight, wantFov);
    }

    let target: { name: string; enemy: boolean } | null = null;
    if (mode?.kind === "range") {
      for (const b of mode.bots) b.render();
    } else if (net) {
      remotes.update(others, round?.bomb.carrier ?? null, spec?.id ?? null);
      const drawn = net.viewTick();
      const due = fxQueue.filter((f) => f.tick <= drawn + 1);
      fxQueue = fxQueue.filter((f) => f.tick > drawn + 1 && f.tick < drawn + 120);
      for (const f of due) playFx(f);
      // name of whoever is under the crosshair
      const look = {
        o: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        d: { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) },
      };
      if (!watching) {
        const hit = traceTargets(look, others.filter((x) => x.alive).map((x) => ({ id: x, feet: x, crouched: x.crouched })),
          traceMap(look, currentMap.boxes, RANGE).t);
        if (hit) target = { name: hit.id.name, enemy: hit.id.team !== myTeam };
      }
      const latest = net.latest();
      const carrier = round?.bomb.carrier ?? null;
      hud.scoreboard(isDown("Tab"), latest, myId, inMatch ? round!.score : null, myTeam === ATK ? carrier : null);

      if (round) {
        const count = (alive: boolean) => [0, 1].map((t) => latest.filter((p) => p.team === t && (!alive || p.alive)).length) as [number, number];
        const label = { warmup: "Warmup", freeze: "Get ready", live: "", over: "Next round", matchover: "Next match" }[round.phase];
        const left = round.phase === "warmup" ? -1 : round.bomb.planted && round.phase === "live" ? null : (round.endsAt - now) * TICK;
        hud.roundBar(true, round.score, left, label, count(true), count(false));
        if (round.phase === "over" && round.winner !== null) hud.result(`${TEAM_NAMES[round.winner]} win`, round.reason, round.winner);
        else if (round.phase === "matchover" && round.winner !== null)
          hud.result(round.reason, `${round.score[0]} : ${round.score[1]}`, round.winner);
        else hud.result(null);
        const b = round.bomb;
        const live = round.phase === "live" && alive;
        hud.carrier(alive && b.carrier === myId);
        hud.progress(act > 0 ? (myTeam === ATK ? "Planting the bomb" : "Defusing the bomb") : null, act);
        const nearBomb = !!b.pos && camera.position.distanceTo(tmp.set(b.pos.x, b.pos.y + eye, b.pos.z)) <= DEFUSE_RANGE + 0.3;
        hud.hint(!live || act > 0 ? null
          : b.carrier === myId && siteAt(currentMap, me.move.pos) ? "Hold E to plant the bomb"
          : b.carrier === myId ? "Take the bomb to site A or B"
          : myTeam !== ATK && b.planted && nearBomb ? "Hold E to defuse" : null);
      }

      // radar: teammates, enemies we can see right now, the bomb if our side knows where it is
      const eyePos = camera.position;
      const seen = others.filter((o) => {
        if (!o.alive || o.team === myTeam || watching) return false;
        const d = { x: o.x - eyePos.x, y: o.y + 1.2 - eyePos.y, z: o.z - eyePos.z };
        const ahead = Math.abs(wrap(Math.atan2(-d.x, -d.z) - yaw)) < 1.2;
        return ahead && traceMap({ o: eyePos, d }, currentMap.boxes, 1).t >= 1;
      });
      const holder = latest.find((p) => p.id === carrier && p.alive);
      const bomb = round?.bomb.pos && (myTeam === ATK || round.bomb.planted)
        ? { x: round.bomb.pos.x, z: round.bomb.pos.z, planted: round.bomb.planted }
        : holder && myTeam === ATK ? { x: holder.x, z: holder.z, planted: false } : null;
      radar.draw(true, { x: camera.position.x, z: camera.position.z, yaw: camera.rotation.y, alive: !watching || !!spec }, myTeam,
        others.filter((o) => o.alive && o.team === myTeam && o.id !== spec?.id), seen, inMatch ? bomb : null);
    }
    if (!net) {
      hud.roundBar(false, [0, 0], 0, "", [0, 0], [0, 0]);
      radar.draw(!!mode, { x: camera.position.x, z: camera.position.z, yaw, alive: true }, ATK, [], [], null);
    }
    hud.target(target?.name ?? "", target?.enemy);
    hud.health(spec ? spec.hp : hp);
    hud.own(!watching);
    hud.spectating(spec ? `Watching ${spec.name} \u00b7 click for the next teammate` : watching ? "Waiting for the next round" : null);
    hud.dead(alive || watching ? null : `Killed by ${killedBy}`,
      inMatch ? "" : `Respawn in ${Math.max(0, respawnIn).toFixed(1)} s`);
    hud.scope(aim);

    const cone = spread(w, Math.hypot(me.move.vel.x, me.move.vel.z), me.move.onGround, me.move.crouched, gun.shot, aim);
    const pxPerRad = innerHeight / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    hud.crosshair(3 + Math.min(cone * pxPerRad, 60), !w.scope && !watching);
    hud.weapon(me.slot, gun.ammo, gun.reserve, gun.reloading > 0 ? 1 - gun.reloading / w.reloadTime : 0);

    frames++;
    longest = Math.max(longest, performance.now() - lastFrame);
    lastFrame = performance.now();
    if (performance.now() - fpsSince >= 1000) {
      fps = frames;
      longestShown = Math.round(longest);
      frames = longest = 0;
      fpsSince = performance.now();
    }
    renderer.info.reset();
    // the world goes into a target first, so the outline pass can read its depth
    renderer.setRenderTarget(outline.target);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    outline.composite(renderer, camera);
    renderer.clearDepth();
    if (!(mode?.kind === "online" && !alive) && !devNoGun) renderer.render(view.scene, view.camera);
    if (wantHighlight) { // the drawing buffer is only readable in the same task as the render
      highlight.getContext("2d")!.drawImage(renderer.domElement, 0, 0, highlight.width, highlight.height);
      wantHighlight = false;
      highlightAt = performance.now();
      haveHighlight = true;
    }
  },
);

const lock = () => void renderer.domElement.requestPointerLock();
const randomRoom = () => Math.random().toString(36).slice(2, 8);
async function quickPlayRoom(): Promise<string> {
  try {
    return (await (await fetch(api("quickplay"))).json()).room;
  } catch {
    return `pub-${randomRoom()}`;
  }
}
const join = (room: string, map?: string) => {
  unlockAudio();
  lock(); // must happen inside the click: browsers only grant pointer lock to a user gesture
  if (!mode) void goOnline(room, map);
};
hud.on("online", () => {
  if (mode || roomParam) { join(roomParam ?? ""); return; }
  unlockAudio();
  lock();
  void quickPlayRoom().then((room) => { if (!mode) void goOnline(room); });
});
hud.on("private", () => join(randomRoom(), hud.chosenMap));
// keep the public room list fresh while the menu is open before the game starts
async function refreshRooms(): Promise<void> {
  if (mode) return;
  try {
    hud.rooms(await (await fetch(api("rooms"))).json(), join);
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
  gameplay();
  const room = mode?.kind === "online" ? mode.net.room : roomParam;
  hud.menu(!locked(), { room, playing: mode?.kind });
  if (!locked()) meta.render();
});

/** Move to another room without reloading the page (a CrazyGames invite while already playing). */
function switchRoom(room: string): void {
  if (mode?.kind === "online") { mode.net.close(); cg?.game.leftRoom(); }
  mode = null;
  pending = [];
  spawned = false;
  roomParam = room;
  void goOnline(room);
}

// CrazyGames: their username, their invite links, joining friends, mute, gameplay start/stop
void crazyGames().then(async (sdk) => {
  if (!sdk) return;
  cg = sdk;
  if (inGame) sdk.game.gameplayStart(); // the player got into a match before the SDK was ready
  document.body.classList.add("invites");
  hud.linkFor = (room) => sdk.game.inviteLink({ roomId: room });
  const user = await sdk.user.getUser().catch(() => null);
  if (user?.username) hud.suggestName(user.username);
  setVolume(sdk.game.settings.muteAudio ? 0 : hud.settings.volume);
  sdk.game.addSettingsChangeListener((s) => setVolume(s.muteAudio ? 0 : hud.settings.volume));
  sdk.game.addJoinRoomListener((params) => { if (params.roomId) switchRoom(params.roomId.replace(/[^a-z0-9-]/gi, "")); });
  const invited = sdk.game.inviteParams?.roomId?.replace(/[^a-z0-9-]/gi, "");
  if (invited) {
    roomParam = invited;
    hud.menu(true, { room: invited });
  } else if (sdk.game.isInstantMultiplayer) {
    switchRoom(randomRoom()); // a party leader goes straight into a new private room
    hud.menu(true, { room: roomParam, playing: "online" });
  }
});

function resize(): void {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  view.resize(camera.aspect);
  renderer.setSize(innerWidth, innerHeight);
  outline.setSize(renderer);
  particles.setView(innerHeight, camera.fov);
  glow.setView(innerHeight, camera.fov);
  tracers.setResolution(innerWidth, innerHeight);
}
addEventListener("resize", resize);
resize();

if (import.meta.env.DEV) {
  // Hooks for automated checks: headless browsers have no pointer lock.
  Object.assign(window, {
    __game: {
      start: () => { if (!mode) goRange(); hud.menu(false); devInput = true; },
      join: async (map?: string) => {
        hud.menu(false);
        devInput = true;
        await goOnline(roomParam ?? (await quickPlayRoom()), map);
        return myId;
      },
      camera: (x: number, y: number, z: number, yaw: number, pitch: number) => { devCam = { x, y, z, yaw, pitch }; },
      map: (id: string) => setMap(mapById(id)),
      auto: (on: boolean, head = false, strafe = 0) => { autoAim = on ? { head, strafe } : null; },
      god: (on: boolean) => { if (mode?.kind === "online") mode.net.send({ type: "dev", god: on }); },
      /** Teleport to a spot dist m from the nearest enemy with a clear view of them (behind them if possible),
       * facing a little off to one side, so the autopilot's swing onto the target is on camera. */
      ambush: (dist: number, offset = 0.5): boolean => {
        if (mode?.kind !== "online") return false;
        const team = mode.net.team();
        const foes = mode.net.others().filter((o) => o.alive && o.team !== team)
          .sort((a, b) => Math.hypot(a.x - me.move.pos.x, a.z - me.move.pos.z) - Math.hypot(b.x - me.move.pos.x, b.z - me.move.pos.z));
        for (const f of foes)
          for (let i = 0; i < 16; i++) {
            const ang = f.yaw + Math.PI + ((i % 2 ? 1 : -1) * Math.ceil(i / 2) * Math.PI) / 8; // start right behind them
            const x = f.x - Math.sin(ang) * dist, z = f.z - Math.cos(ang) * dist;
            if (Math.abs(x) > currentMap.half - 1 || Math.abs(z) > currentMap.half - 1) continue;
            const feet = { x, y: f.y, z };
            if (blocked(feet, PLAYER_RADIUS, STAND_HEIGHT, currentMap.boxes)) continue;
            const d = { x: f.x - x, y: 0, z: f.z - z };
            if (traceMap({ o: { x, y: f.y + 1.5, z }, d }, currentMap.boxes, 1).t < 1) continue;
            mode.net.send({ type: "dev", teleport: feet });
            Object.assign(me.move.pos, feet);
            Object.assign(prev, me.move.pos);
            yaw = Math.atan2(-d.x, -d.z) + (Math.random() < 0.5 ? offset : -offset);
            pitch = 0;
            return true;
          }
        return false;
      },
      record: (fps = 30, mbps = 12) => {
        const stream = renderer.domElement.captureStream(fps);
        unlockAudio();
        const sound = audioTrack();
        if (sound) stream.addTrack(sound);
        const rec = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9,opus", videoBitsPerSecond: mbps * 1e6 });
        const chunks: Blob[] = [];
        rec.ondataavailable = (e) => chunks.push(e.data);
        rec.start(500);
        const started = performance.now();
        Object.assign(window, { __rec: { rec, chunks, started } });
        return started;
      },
      stopRecording: async (): Promise<string> => {
        const { rec, chunks } = (window as unknown as { __rec: { rec: MediaRecorder; chunks: Blob[] } }).__rec;
        await new Promise((ok) => { rec.onstop = ok; rec.stop(); });
        const buf = await new Blob(chunks, { type: "video/webm" }).arrayBuffer();
        let bin = "";
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(bin);
      },
      // store covers and trailer frames: pose soldiers, hide the interface, show only the title
      stage: async (poses: import("./stage").Pose[], beams: number[][] = []) => {
        const { stage } = await import("./stage");
        await stage(scene, poses, beams.map(([a, b, c, d, e, f]) => [new THREE.Vector3(a, b, c), new THREE.Vector3(d, e, f)]));
      },
      clean: (fovDeg: number | null) => {
        devFov = fovDeg;
        devNoGun = true;
        for (const id of ["hud", "start"]) document.getElementById(id)!.style.display = "none";
      },
      title: (sizePx: number, topPx: number) => {
        document.getElementById("covertitle")?.remove();
        document.body.insertAdjacentHTML("beforeend", `<div id="covertitle" style="position:fixed;left:0;right:0;top:${topPx}px;` +
          `text-align:center;font:400 ${sizePx}px 'Lilita One',system-ui;color:#ffd23f;paint-order:stroke fill;` +
          `-webkit-text-stroke:${Math.round(sizePx / 7)}px #14161c;text-shadow:0 ${Math.round(sizePx / 14)}px 0 #14161c;` +
          `letter-spacing:.02em;pointer-events:none">CLUTCHZONE</div>`);
      },
      look: (y: number, p: number) => { yaw = y; pitch = p; },
      fire: (ticks: number) => { devFire = ticks; },
      weapon: (slot: number) => { wantSlot = slot; },
      scope: (on: boolean) => { scopeOn = on; },
      card: async () => (await drawCard({ map: "Dockyard", kills: 23, deaths: 7, heads: 9, won: true, score: [7, 4],
        level: 12, name: "Tim", shot: haveHighlight ? highlight : undefined })).toDataURL(),
      boom: (x: number, y: number, z: number) => {
        particles.explosion(new THREE.Vector3(x, y, z));
        glow.fireball(new THREE.Vector3(x, y, z));
      },
      teleport: (x: number, y: number, z: number) => {
        if (mode?.kind === "online") mode.net.send({ type: "dev", teleport: { x, y, z } });
        Object.assign(me.move.pos, { x, y, z });
        Object.assign(prev, me.move.pos);
      },
      state: () => ({
        id: myId, pos: me.move.pos, onGround: me.move.onGround, crouched: me.move.crouched, yaw, pitch,
        slot: me.slot, ammo: gunOf(me).ammo, reserve: gunOf(me).reserve, hp, alive, pending: pending.length,
        speed: Math.hypot(me.move.vel.x, me.move.vel.z) / MAX_SPEED, locked: locked(), fps, longestFrameMs: longestShown,
        drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        bots: mode?.kind === "range" ? mode.bots.map((b) => ({ hp: b.hp, alive: b.alive })) : [],
        others: mode?.kind === "online" ? mode.net.others().map((o) => ({ id: o.id, name: o.name, team: o.team, x: o.x, z: o.z, hp: o.hp })) : [],
        rtt: mode?.kind === "online" ? Math.round(mode.net.rtt) : 0, highlight: haveHighlight,
        team: mode?.kind === "online" ? mode.net.team() : 0,
        round: mode?.kind === "online" ? mode.net.round : null,
        act,
      }),
    },
  });
}
