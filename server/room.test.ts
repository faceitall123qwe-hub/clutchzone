import assert from "node:assert/strict";
import { test } from "node:test";
import { TICK } from "../shared/constants.ts";
import { MAP } from "../shared/map.ts";
import { decodePlayers, type RosterEntry, type ServerMsg } from "../shared/protocol.ts";
import { cloneSim, shotSeed, simulate, type Cmd } from "../shared/sim.ts";
import { Room, sanitize, type Player } from "./room.ts";

const base: Omit<Cmd, "seq"> = { forward: 0, right: 0, yaw: 0, pitch: 0, jump: false, crouch: false, walk: false,
  fire: false, reload: false };

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
      yaw: Math.sin(i / 10), pitch: 0.1, jump: i % 50 === 0, crouch: i > 90, fire: i % 3 === 0 });
  for (const c of cmds) {
    simulate(predicted, c, shotSeed(a.id, c.seq), MAP); // what the client does locally
    room.onMessage(a, { type: "input", cmd: c, viewTick: room.tick });
    room.step();
  }
  assert.deepEqual(predicted, a.sim);
});
