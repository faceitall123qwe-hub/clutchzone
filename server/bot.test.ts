import assert from "node:assert/strict";
import { test } from "node:test";
import { rayBox } from "../shared/collision.ts";
import { TICK } from "../shared/constants.ts";
import { OUTPOST } from "../shared/maps/outpost.ts";
import { ATK, DEF } from "../shared/protocol.ts";
import { mulberry32 } from "../shared/weapons.ts";
import { Room, type Player } from "./room.ts";

const bots = (r: Room) => [...r.players.values()].filter((p) => p.bot);
// a human that sends no commands stands still, like an AFK player
const human = (r: Room, name: string, team?: number) => r.join(name, () => {}, undefined, team);
const live = (room: Room) => { while (room.round.phase !== "live") room.step(); };
function place(p: Player, x: number, z: number, yaw = 0) {
  Object.assign(p.sim.move.pos, { x, y: 0, z });
  p.sim.move.onGround = true;
  p.yaw = yaw;
}
/** Under the floor: alive, but no bot can see or reach them. */
const hide = (p: Player) => { p.sim.move.pos = { x: 0, y: -50, z: 0 }; p.sim.move.vel = { x: 0, y: 0, z: 0 }; };

test("public rooms are topped up with bots to 4 v 4 while people are there", () => {
  const room = new Room("pub-x", { bots: true });
  const a = human(room, "a");
  assert.equal(bots(room).length, 7);
  const b = human(room, "b");
  assert.notEqual(b.team, a.team, "the second person joins the other team");
  assert.equal(bots(room).length, 6);
  for (const team of [ATK, DEF]) assert.equal([...room.players.values()].filter((p) => p.team === team).length, 4);
  room.leave(a.id);
  assert.equal(bots(room).length, 7);
  room.leave(b.id);
  assert.equal(room.players.size, 0, "no bots left in an empty room");
});

test("private rooms get no bots", () => {
  const room = new Room("friends", {});
  human(room, "a");
  assert.equal(bots(room).length, 0);
});

test("a bot finds and kills a player standing in the open", (ctx) => {
  // easy bots miss most shots, so the time to kill has a long tail: a fixed seed keeps the test repeatable
  ctx.mock.method(Math, "random", mulberry32(1));
  const room = new Room("pub-y", { bots: true });
  const h = human(room, "target", DEF);
  for (const b of bots(room).filter((b) => b.team === DEF || b !== bots(room).find((x) => x.team === ATK))) room.leave(b.id);
  const [bot] = bots(room);
  live(room);
  place(h, 0, -2);
  place(bot, 0, 12, 0); // looking down mid towards the target, 14 m away
  let t = 0;
  while (h.alive && t < 20) { room.step(); t += TICK; h.sim.move.pos.x = 0; h.sim.move.pos.z = -2; }
  assert.equal(h.alive, false, "killed within 20 s");
  assert.ok(t > 1.5, `easy bots take their time: ${t.toFixed(2)} s`);
});

test("bots don't see or shoot through walls", () => {
  const room = new Room("pub-z", { bots: true });
  const h = human(room, "hidden", DEF);
  for (const b of bots(room).filter((b) => b.team === DEF || b !== bots(room).find((x) => x.team === ATK))) room.leave(b.id);
  const [bot] = bots(room);
  live(room);
  // the target hides behind the west building, the bot stands on the other side of it
  place(h, -9.5, 0);
  for (let i = 0; i < 6 / TICK; i++) {
    place(bot, -9.5, 10, 0); // pinned in place, facing the building
    bot.sim.move.vel = { x: 0, y: 0, z: 0 };
    room.step();
    place(h, -9.5, 0);
  }
  const eye = { x: -9.5, y: 1.62, z: 10 };
  const blocked = OUTPOST.boxes.some((b) => { const r = rayBox(eye, { x: 0, y: 0, z: -10 }, b, 1); return r !== null && r.t < 1; });
  assert.ok(blocked, "test setup: the wall really is in between");
  assert.equal(h.hp, 100);
});

test("attacking bots take the bomb to a site and plant it", () => {
  const room = new Room("pub-a", { bots: true });
  const h = human(room, "defender", DEF);
  for (const b of bots(room).filter((b) => b.team === DEF)) room.leave(b.id);
  live(room);
  let t = 0;
  while (!room.round.bomb.planted && t < 60) { hide(h); room.step(); t += TICK; }
  assert.ok(room.round.bomb.planted, `planted on ${room.round.bomb.site} after ${t.toFixed(1)} s`);
  while (room.round.phase === "live" && t < 120) { hide(h); room.step(); t += TICK; }
  assert.deepEqual([room.round.winner, room.round.reason], [ATK, "The bomb exploded"]);
});

test("defending bots go to a planted bomb and defuse it", () => {
  const room = new Room("pub-d", { bots: true });
  const h = human(room, "attacker", ATK);
  for (const b of bots(room).filter((b) => b.team === ATK)) room.leave(b.id);
  live(room);
  room.round.bomb = { carrier: null, pos: { x: -18, y: 0, z: -16 }, planted: true, site: "B" };
  room.round.endsAt = room.tick + 40 / TICK;
  let t = 0;
  while (room.round.phase === "live" && t < 40) { hide(h); room.step(); t += TICK; }
  assert.deepEqual([room.round.winner, room.round.reason], [DEF, "Bomb defused"], `after ${t.toFixed(1)} s`);
});
