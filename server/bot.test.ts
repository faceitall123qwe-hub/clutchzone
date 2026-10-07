import assert from "node:assert/strict";
import { test } from "node:test";
import { TICK } from "../shared/constants.ts";
import { MAP } from "../shared/map.ts";
import { rayBox } from "../shared/collision.ts";
import { Room, type Player } from "./room.ts";

const bots = (r: Room) => [...r.players.values()].filter((p) => p.bot);
// a human that sends no commands stands still, like an AFK player
const human = (r: Room, name: string) => r.join(name, () => {});
function place(p: Player, x: number, z: number, yaw = 0) {
  Object.assign(p.sim.move.pos, { x, y: 0, z });
  p.sim.move.onGround = true;
  p.yaw = yaw;
}

test("public rooms are topped up with bots while people are there", () => {
  const room = new Room("pub-x", { bots: true });
  const a = human(room, "a");
  assert.equal(bots(room).length, 3);
  const b = human(room, "b");
  assert.equal(bots(room).length, 2);
  room.leave(a.id);
  assert.equal(bots(room).length, 3);
  room.leave(b.id);
  assert.equal(room.players.size, 0, "no bots left in an empty room");
});

test("private rooms get no bots", () => {
  const room = new Room("friends", {});
  human(room, "a");
  assert.equal(bots(room).length, 0);
});

test("a bot finds and kills a player standing in the open", () => {
  const room = new Room("pub-y", { bots: true });
  const h = human(room, "target");
  for (const b of bots(room).slice(1)) room.leave(b.id); // one bot only
  const [bot] = bots(room);
  place(h, 0, -2);
  place(bot, 0, 12, 0); // looking down mid towards the target, 14 m away
  let t = 0;
  while (h.alive && t < 6) { room.step(); t += TICK; h.sim.move.pos.x = 0; h.sim.move.pos.z = -2; }
  assert.equal(h.alive, false, "killed within 6 s");
  assert.ok(t > 0.3, `not instantly: reaction time, took ${t.toFixed(2)} s`);
});

test("bots don't see or shoot through walls", () => {
  const room = new Room("pub-z", { bots: true });
  const h = human(room, "hidden");
  for (const b of bots(room).slice(1)) room.leave(b.id);
  const [bot] = bots(room);
  // the target hides behind the west building, the bot stands on the other side of it
  place(h, -9.5, 0);
  for (let i = 0; i < 6 / TICK; i++) {
    place(bot, -9.5, 10, 0); // pinned in place, facing the building
    bot.sim.move.vel = { x: 0, y: 0, z: 0 };
    room.step();
    place(h, -9.5, 0);
  }
  const eye = { x: -9.5, y: 1.62, z: 10 };
  const blocked = MAP.some((b) => { const r = rayBox(eye, { x: 0, y: 0, z: -10 }, b, 1); return r !== null && r.t < 1; });
  assert.ok(blocked, "test setup: the wall really is in between");
  assert.equal(h.hp, 100);
});

test("bots roam the map instead of getting stuck", () => {
  const room = new Room("pub-w", { bots: true });
  human(room, "watcher");
  const watcher = [...room.players.values()].find((p) => !p.bot)!;
  watcher.alive = false; // out of the way, so the bots roam rather than fight
  watcher.respawnIn = 1e9;
  const travelled = new Map(bots(room).map((b) => [b.id, 0]));
  const last = new Map(bots(room).map((b) => [b.id, { ...b.sim.move.pos }]));
  for (let i = 0; i < 20 / TICK; i++) {
    room.step();
    for (const b of bots(room)) {
      const l = last.get(b.id)!;
      travelled.set(b.id, travelled.get(b.id)! + Math.hypot(b.sim.move.pos.x - l.x, b.sim.move.pos.z - l.z));
      last.set(b.id, { ...b.sim.move.pos });
    }
  }
  for (const [id, d] of travelled) assert.ok(d > 40, `bot ${id} only travelled ${d.toFixed(1)} m in 20 s`);
});
