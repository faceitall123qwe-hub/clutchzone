import assert from "node:assert/strict";
import { test } from "node:test";
import { TICK } from "../shared/constants.ts";
import { OUTPOST } from "../shared/maps/outpost.ts";
import * as P from "../shared/protocol.ts";
import { ATK, DEF, decodePlayers, type RosterEntry, type ServerMsg } from "../shared/protocol.ts";
import { cloneSim, gunOf, shotSeed, simulate, type Cmd } from "../shared/sim.ts";
import { PISTOL, SNIPER, spread } from "../shared/weapons.ts";
import { Room, sanitize, type Player } from "./room.ts";

const base: Omit<Cmd, "seq"> = { forward: 0, right: 0, yaw: 0, pitch: 0, jump: false, crouch: false, walk: false,
  fire: false, reload: false, slot: 0, aim: false, use: false };

function setup() {
  const room = new Room("t");
  const inbox = new Map<number, ServerMsg[]>();
  const join = (name: string, team?: number) => {
    const box: ServerMsg[] = [];
    const p = room.join(name, (m) => box.push(typeof m === "string" ? JSON.parse(m) : m), undefined, team);
    inbox.set(p.id, box);
    return p;
  };
  return { room, inbox, join };
}

/** Run through the warmup and the freeze time into a live round (needs players on both teams). */
const live = (room: Room) => { while (room.round.phase !== "live") room.step(); };

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
  live(room);
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
  live(room);
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
  live(room);
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
  live(room);
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

test("in the warmup the dead respawn after 3 s; in a round they wait for the next one", () => {
  const { room, join } = setup();
  const a = join("a", ATK);
  room.step();
  assert.equal(room.round.phase, "warmup", "one team only: warmup");
  a.alive = false;
  a.respawnIn = P.RESPAWN_TIME;
  for (let i = 0; i < Math.ceil(P.RESPAWN_TIME / TICK) + 1; i++) room.step();
  assert.ok(a.alive && a.hp === 100);

  const b = join("b", DEF);
  live(room);
  place(a, 0, 10);
  place(b, 0, 0);
  room.step();
  input(room, a, { fire: true, pitch: Math.atan2(1.64 - 1.62, 10) });
  room.step();
  assert.equal(b.alive, false);
  assert.deepEqual([room.round.phase, room.round.winner, room.round.score], ["over", ATK, [1, 0]]);
  for (let i = 0; i < Math.ceil(P.ROUND_END_TIME / TICK) + 1; i++) room.step();
  assert.equal(room.round.phase, "freeze");
  assert.equal(room.round.round, 2);
  assert.ok(b.alive && b.hp === 100 && b.sim.move.pos.z < -20, "back at the defenders' spawn");
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
      slot: i < 40 ? 0 : i < 80 ? 1 : 2, aim: i > 100, use: i % 30 < 5 });
  for (const c of cmds) {
    simulate(predicted, c, shotSeed(a.id, c.seq), OUTPOST.boxes); // what the client does locally
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
  live(room);
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
  live(room);
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
  live(room);
  place(a, 0, 10);
  place(b, 0, 0);
  wait(room, a, 40, { slot: 1 });
  input(room, a, { slot: 1, fire: true, pitch: head });
  room.step(); room.step();
  const kills = inbox.get(b.id)!.flatMap((m) => m.type === "snap" ? m.events : []).filter((e) => e.type === "kill");
  assert.deepEqual(kills.map((k) => k.type === "kill" && [k.w, k.head]), [[1, true]]);
});

const secs = (room: Room, s: number, each?: () => void) => {
  for (let i = 0; i < Math.round(s / TICK); i++) { each?.(); room.step(); }
};
const events = (inbox: Map<number, ServerMsg[]>, id: number) =>
  inbox.get(id)!.flatMap((m) => (m.type === "snap" ? m.events : []));

test("the freeze time holds everyone still, then the round goes live", () => {
  const { room, join } = setup();
  const a = join("a", ATK);
  join("b", DEF);
  room.step();
  assert.equal(room.round.phase, "freeze");
  const z = a.sim.move.pos.z;
  for (let i = 0; i < 60; i++) { input(room, a, { forward: 1, fire: true }); room.step(); }
  assert.equal(a.sim.move.pos.z, z, "can't move");
  assert.equal(gunOf(a.sim).ammo, 30, "can't shoot");
  live(room);
  for (let i = 0; i < 30; i++) { input(room, a, { forward: 1 }); room.step(); }
  assert.ok(a.sim.move.pos.z < z - 1, "moves once live");
});

test("bullets pass through teammates", () => {
  const { room, join } = setup();
  const a = join("a", ATK), mate = join("mate", ATK);
  join("enemy", DEF);
  live(room);
  place(a, 0, 10);
  place(mate, 0, 0);
  input(room, a, { fire: true, pitch: Math.atan2(1.0 - 1.62, 10) });
  room.step();
  assert.equal(mate.hp, 100);
});

test("planting takes 3 s of holding E inside a site; the bomb explodes 40 s later", () => {
  const { room, inbox, join } = setup();
  const a = join("a", ATK), b = join("b", DEF);
  live(room);
  assert.equal(room.round.bomb.carrier, a.id, "the only attacker carries the bomb");
  place(b, -20, 20); // far from site A
  place(a, 19, -11); // outside the site
  secs(room, 3.2, () => input(room, a, { use: true }));
  assert.equal(room.round.bomb.planted, false, "not outside a site");
  place(a, 20, -13);
  secs(room, 2, () => input(room, a, { use: true }));
  secs(room, 0.2, () => input(room, a, {}));
  assert.equal(room.round.bomb.planted, false, "letting go starts over");
  secs(room, P.PLANT_TIME + 0.1, () => input(room, a, { use: true }));
  assert.ok(room.round.bomb.planted && room.round.bomb.site === "A");
  assert.ok(events(inbox, b.id).some((e) => e.type === "planted"));
  place(a, -20, 21);
  secs(room, P.BOMB_TIME + 0.1);
  assert.ok(events(inbox, b.id).some((e) => e.type === "exploded"));
  assert.deepEqual([room.round.winner, room.round.reason], [ATK, "The bomb exploded"]);
  assert.ok(a.alive && b.alive, "both far enough away");
});

test("the bomb kills whoever stands next to it", () => {
  const { room, join } = setup();
  const a = join("a", ATK), b = join("b", DEF);
  live(room);
  place(a, 20, -13);
  place(b, -20, 20);
  secs(room, P.PLANT_TIME + 0.1, () => input(room, a, { use: true }));
  place(b, 21, -14);
  secs(room, P.BOMB_TIME + 0.1, () => place(b, 21, -14));
  assert.equal(b.alive, false);
});

test("defusing takes 7 s of holding E next to the bomb", () => {
  const { room, join } = setup();
  const a = join("a", ATK), b = join("b", DEF);
  live(room);
  place(a, -18, -16); // site B
  place(b, 20, 20);
  secs(room, P.PLANT_TIME + 0.1, () => input(room, a, { use: true }));
  assert.equal(room.round.bomb.site, "B");
  place(a, 20, 22);
  place(b, -17, -16);
  secs(room, P.DEFUSE_TIME - 0.5, () => input(room, b, { use: true }));
  assert.equal(room.round.phase, "live");
  secs(room, 0.6, () => input(room, b, { use: true }));
  assert.deepEqual([room.round.phase, room.round.winner, room.round.reason], ["over", DEF, "Bomb defused"]);
});

test("a dead carrier drops the bomb and another attacker picks it up", () => {
  const { room, join } = setup();
  const a = join("a", ATK), c = join("c", ATK), b = join("b", DEF);
  live(room);
  const carrier = room.round.bomb.carrier === a.id ? a : c, other = carrier === a ? c : a;
  place(carrier, 0, 10);
  place(b, 0, 0);
  place(other, 10, 20);
  room.step();
  input(room, b, { fire: true, yaw: Math.PI, pitch: Math.atan2(1.64 - 1.62, 10) });
  room.step();
  assert.equal(carrier.alive, false);
  assert.deepEqual([room.round.bomb.carrier, room.round.bomb.pos?.z], [null, 10]);
  place(other, 0.3, 10);
  room.step();
  assert.equal(room.round.bomb.carrier, other.id);
});

test("when the time runs out without a plant, the defenders win", () => {
  const { room, join } = setup();
  join("a", ATK);
  join("b", DEF);
  live(room);
  secs(room, P.ROUND_TIME + 0.1);
  assert.deepEqual([room.round.winner, room.round.reason], [DEF, "Time ran out"]);
});

test("late joiners watch until the next round; first to 7 wins, then sides swap and the map changes", () => {
  const { room, join } = setup();
  const a = join("a", ATK), b = join("b", DEF);
  live(room);
  secs(room, P.LATE_JOIN + 1);
  const late = join("late", ATK);
  assert.equal(late.alive, false);
  room.round.score = [P.ROUNDS_TO_WIN - 1, 0];
  place(a, 0, 10);
  place(b, 0, 0);
  room.step();
  input(room, a, { fire: true, pitch: Math.atan2(1.64 - 1.62, 10) });
  room.step();
  secs(room, P.ROUND_END_TIME + 0.1);
  assert.deepEqual([room.round.phase, room.round.winner], ["matchover", ATK]);
  secs(room, P.MATCH_END_TIME + 0.1);
  assert.deepEqual([room.round.phase, room.round.round, room.round.score], ["freeze", 1, [0, 0]]);
  assert.deepEqual([a.team, b.team, late.team, late.alive], [DEF, ATK, DEF, true]);
  assert.deepEqual([room.map.id, room.round.map], ["dockyard", "dockyard"], "the next map in the rotation");
  assert.ok(Math.abs(a.sim.move.pos.z) > 20 && Math.abs(a.sim.move.pos.z) < 27, "spawned on the new map");
});

test("a shot judged at the present tick uses the newest positions, not ones a second old", () => {
  const { room, join } = setup();
  const a = join("a"), b = join("b");
  live(room);
  place(a, -3, 10);
  place(b, 0, 0);
  for (let i = 0; i < 70; i++) room.step(); // over a second of history with b at x = 0
  place(b, -3, 0);
  room.step();
  input(room, a, { fire: true, pitch: chest }, room.tick + 1); // as bots do: the tick the shot runs in
  room.step();
  assert.equal(b.hp, 64);
});
