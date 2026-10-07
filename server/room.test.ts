import assert from "node:assert/strict";
import { test } from "node:test";
import { TICK } from "../shared/constants.ts";
import { MAP } from "../shared/map.ts";
import { decodePlayers, type RosterEntry, type ServerMsg } from "../shared/protocol.ts";
import { cloneSim, gunOf, shotSeed, simulate, type Cmd } from "../shared/sim.ts";
import { PISTOL, SNIPER, spread } from "../shared/weapons.ts";
import { Room, sanitize, type Player } from "./room.ts";

const base: Omit<Cmd, "seq"> = { forward: 0, right: 0, yaw: 0, pitch: 0, jump: false, crouch: false, walk: false,
  fire: false, reload: false, slot: 0, aim: false };

function setup() {
  const room = new Room("t");
  const inbox = new Map<number, ServerMsg[]>();
  const join = (name: string) => {
    const box: ServerMsg[] = [];
    const p = room.join(name, (m) => box.push(typeof m === "string" ? JSON.parse(m) : m));
    inbox.set(p.id, box);
    return p;
  };
  return { room, inbox, join };
}

function place(p: Player, x: number, z: number) {
  Object.assign(p.sim.move.pos, { x, y: 0, z });
  p.sim.move.onGround = true;
}

let seq = 0;
const input = (room: Room, p: Player, cmd: Partial<Cmd>, viewTick = room.tick) =>
  room.onMessage(p, { type: "input", cmd: { ...base, ...cmd, seq: ++seq + p.lastSeq }, viewTick });

test("inputs move the player and snapshots acknowledge them", () => {
  const { room, inbox, join } = setup();
  const a = join("a");
  place(a, 0, 10);
  for (let i = 0; i < 30; i++) { input(room, a, { forward: 1 }); room.step(); }
  assert.ok(a.sim.move.pos.z < 9, `moved forward, z ${a.sim.move.pos.z}`);
  const snaps = inbox.get(a.id)!.filter((m) => m.type === "snap");
  assert.equal(snaps.length, 15, "30 ticks -> 15 snapshots");
  const last = snaps.at(-1)!;
  assert.ok(last.type === "snap" && last.you.lastSeq === a.lastSeq);
});

test("a shot at the head kills, a body shot does 36", () => {
  const { room, join } = setup();
  const a = join("a"), b = join("b");
  place(a, 0, 10);
  place(b, 0, 0);
  room.step();
  input(room, a, { fire: true, pitch: Math.atan2(1.0 - 1.62, 10) }); // aim at the chest
  room.step();
  assert.equal(b.hp, 64);
  for (let i = 0; i < 30; i++) { input(room, a, {}); room.step(); } // the gun's clock runs on commands
  input(room, a, { fire: true, pitch: Math.atan2(1.64 - 1.62, 10) }); // aim at the head
  room.step();
  assert.equal(b.alive, false);
  assert.equal(a.kills, 1);
  assert.equal(b.deaths, 1);
});

test("lag compensation: you hit where the target was on your screen", () => {
  const { room, join } = setup();
  const a = join("a"), b = join("b");
  place(a, 0, 10);
  place(b, 0, 0);
  for (let i = 0; i < 5; i++) room.step();
  const seenTick = room.tick; // the shooter's screen shows b at x = 0
  for (let i = 0; i < 12; i++) { input(room, b, { right: 1 }); room.step(); } // b strafes away (~0.6 m)
  assert.ok(b.sim.move.pos.x > 0.5, `b moved to x ${b.sim.move.pos.x}`);

  const aim = Math.atan2(1.0 - 1.62, 10);
  input(room, a, { fire: true, pitch: aim }, seenTick);
  room.step();
  assert.equal(b.hp, 64, "hit at the rewound position");

  for (let i = 0; i < 30; i++) { input(room, a, {}); room.step(); }
  input(room, a, { fire: true, pitch: aim }, room.tick); // no rewind: b is no longer there
  room.step();
  assert.equal(b.hp, 64, "miss without rewind");
});

test("rewind is capped at 500 ms", () => {
  const { room, join } = setup();
  const a = join("a"), b = join("b");
  place(a, 0, 10);
  place(b, 0, 0);
  for (let i = 0; i < 3; i++) room.step();
  const ancient = room.tick;
  for (let i = 0; i < 90; i++) { input(room, b, { right: 1 }); room.step(); }
  input(room, a, { fire: true, pitch: Math.atan2(1.0 - 1.62, 10) }, ancient);
  room.step();
  assert.equal(b.hp, 100);
});

test("a speedhacker sending 120 commands/s runs no faster than an honest player", () => {
  const { room, join } = setup();
  const honest = join("honest"), cheat = join("cheat");
  place(honest, -10, 20);
  place(cheat, 10, 20);
  for (let i = 0; i < 120; i++) { // 2 seconds
    input(room, honest, { forward: 1 });
    input(room, cheat, { forward: 1 });
    input(room, cheat, { forward: 1 }); // twice per tick
    room.step();
  }
  const ran = (p: Player) => 20 - p.sim.move.pos.z;
  assert.ok(ran(cheat) <= ran(honest) * 1.05, `cheat ${ran(cheat).toFixed(2)} m vs honest ${ran(honest).toFixed(2)} m`);
});

test("a client that froze for 200 ms catches up within one tick", () => {
  const { room, join } = setup();
  const a = join("a");
  place(a, 0, 10);
  for (let i = 0; i < 12; i++) room.step(); // nothing arrives while the client is frozen
  for (let i = 0; i < 12; i++) input(room, a, { forward: 1 }); // then the missed commands arrive at once
  room.step();
  assert.equal(a.queue.length, 0);
  assert.ok(a.sim.move.pos.z < 10, "all of them ran");
});

test("snapshots carry the roster only when it changes, and decode back to named players", () => {
  const { room, inbox, join } = setup();
  const a = join("alice");
  room.step(); room.step();
  const b = join("bob");
  for (let i = 0; i < 10; i++) room.step();
  const snaps = inbox.get(b.id)!.filter((m): m is Extract<ServerMsg, { type: "snap" }> => m.type === "snap");
  assert.ok(snaps[0].r, "a new player gets names in the first snapshot");
  assert.ok(snaps.slice(1).every((s) => !s.r), "unchanged roster isn't resent every snapshot");
  const roster = new Map<number, RosterEntry>(snaps[0].r!.map((e) => [e[0], e]));
  const players = decodePlayers(snaps.at(-1)!.p, roster);
  assert.deepEqual(players.map((p) => p.name).sort(), ["alice", "bob"]);
  assert.ok(players.every((p) => p.alive && p.hp === 100));
  assert.ok(a.id !== b.id);
});

test("garbage commands are rejected or clamped", () => {
  assert.equal(sanitize(null), null);
  assert.equal(sanitize({ seq: "x" }), null);
  const c = sanitize({ seq: 1, forward: 1000, right: NaN, yaw: 50, pitch: 9, fire: "yes" })!;
  assert.deepEqual([c.forward, c.right, c.pitch, c.fire], [1, 0, 1.56, false]);
  assert.ok(Math.abs(c.yaw) < Math.PI * 2);
});

test("dead players respawn after 3 s with full health", () => {
  const { room, join } = setup();
  const a = join("a"), b = join("b");
  place(a, 0, 10);
  place(b, 0, 0);
  room.step();
  input(room, a, { fire: true, pitch: Math.atan2(1.64 - 1.62, 10) });
  room.step();
  assert.equal(b.alive, false);
  for (let i = 0; i < Math.ceil(3 / TICK) + 1; i++) room.step();
  assert.ok(b.alive && b.hp === 100);
});

test("client prediction replays to exactly the server's state", () => {
  const { room, join } = setup();
  const a = join("a");
  place(a, 0, 10);
  const predicted = cloneSim(a.sim);
  const cmds: Cmd[] = [];
  for (let i = 0; i < 120; i++)
    cmds.push({ ...base, seq: a.lastSeq + i + 1, forward: i % 40 < 30 ? 1 : 0, right: i % 25 < 10 ? 1 : -1,
      yaw: Math.sin(i / 10), pitch: 0.1, jump: i % 50 === 0, crouch: i > 90, fire: i % 3 === 0,
      slot: i < 40 ? 0 : i < 80 ? 1 : 2, aim: i > 100 });
  for (const c of cmds) {
    simulate(predicted, c, shotSeed(a.id, c.seq), MAP); // what the client does locally
    room.onMessage(a, { type: "input", cmd: c, viewTick: room.tick });
    room.step();
  }
  assert.deepEqual(predicted, a.sim);
});

const chest = Math.atan2(1.0 - 1.62, 10), head = Math.atan2(1.64 - 1.62, 10);
const wait = (room: Room, p: Player, ticks: number, cmd: Partial<Cmd> = {}) => {
  for (let i = 0; i < ticks; i++) { input(room, p, cmd); room.step(); }
};

test("switching weapons takes the draw time before the new one fires", () => {
  const { room, join } = setup();
  const a = join("a"), b = join("b");
  place(a, 0, 10);
  place(b, 0, 0);
  room.step();
  input(room, a, { slot: 1, fire: true, pitch: chest });
  room.step();
  assert.equal(a.sim.slot, 1);
  assert.equal(b.hp, 100, "no shot while drawing");
  wait(room, a, Math.ceil(PISTOL.drawTime * 60), { slot: 1 });
  input(room, a, { slot: 1, fire: true, pitch: chest });
  room.step();
  assert.equal(b.hp, 100 - PISTOL.damage);
});

test("the pistol fires once per click, the rifle keeps firing", () => {
  const { room, join } = setup();
  const a = join("a");
  place(a, 0, 10);
  wait(room, a, 40, { slot: 1 });
  const before = gunOf(a.sim).ammo;
  wait(room, a, 60, { slot: 1, fire: true }); // trigger held for a second
  assert.equal(gunOf(a.sim).ammo, before - 1);
  wait(room, a, 5, { slot: 1 });
  for (let i = 0; i < 5; i++) { wait(room, a, 5, { slot: 1, fire: true }); wait(room, a, 5, { slot: 1 }); }
  assert.equal(gunOf(a.sim).ammo, before - 6, "five more clicks, five more shots");
  wait(room, a, 40, { slot: 0 });
  wait(room, a, 30, { slot: 0, fire: true });
  assert.equal(gunOf(a.sim).ammo, 30 - 5, "half a second of rifle fire");
});

test("the sniper rifle kills with one body shot and slows its holder down", () => {
  const { room, join } = setup();
  const a = join("a"), b = join("b"), c = join("c");
  place(a, 0, 10);
  place(b, 0, 0);
  place(c, 10, 20);
  wait(room, a, 60, { slot: 2, aim: true });
  input(room, a, { slot: 2, aim: true, fire: true, pitch: chest });
  room.step();
  assert.equal(b.alive, false);
  assert.equal(a.kills, 1);

  wait(room, c, 60, { slot: 2, forward: 1 });
  const v = Math.hypot(c.sim.move.vel.x, c.sim.move.vel.z);
  assert.ok(Math.abs(v - 6.35 * SNIPER.speed) < 0.05, `runs at ${v.toFixed(2)} m/s`);
  wait(room, c, 60, { slot: 2, forward: 1, aim: true });
  const scopedV = Math.hypot(c.sim.move.vel.x, c.sim.move.vel.z);
  assert.ok(Math.abs(scopedV - 6.35 * SNIPER.scope!.speed) < 0.05, `scoped ${scopedV.toFixed(2)} m/s`);
});

test("the scope is what makes the sniper rifle accurate", () => {
  assert.ok(spread(SNIPER, 0, true, false, 0, true) < 0.001);
  assert.ok(spread(SNIPER, 0, true, false, 0, false) > 0.04);
});

test("kill events name the weapon", () => {
  const { room, inbox, join } = setup();
  const a = join("a"), b = join("b");
  place(a, 0, 10);
  place(b, 0, 0);
  wait(room, a, 40, { slot: 1 });
  input(room, a, { slot: 1, fire: true, pitch: head });
  room.step(); room.step();
  const kills = inbox.get(b.id)!.flatMap((m) => m.type === "snap" ? m.events : []).filter((e) => e.type === "kill");
  assert.deepEqual(kills.map((k) => k.type === "kill" && [k.w, k.head]), [[1, true]]);
});
