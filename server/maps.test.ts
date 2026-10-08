import assert from "node:assert/strict";
import { test } from "node:test";
import { rayBox, type Vec3 } from "../shared/collision.ts";
import * as C from "../shared/constants.ts";
import { siteAt, type Site } from "../shared/map.ts";
import { MAPS } from "../shared/maps.ts";
import { newPlayer, stepPlayer } from "../shared/movement.ts";
import { ATK, DEF } from "../shared/protocol.ts";
import { findPath, nearestNode } from "./nav.ts";
import { graphOf, spotsIn } from "./bot.ts";
import { Room, type Player } from "./room.ts";

const idle = { forward: 0, right: 0, yaw: 0, jump: false, crouch: false, walk: false };
const hide = (p: Player) => { p.sim.move.pos = { x: 0, y: -50, z: 0 }; p.sim.move.vel = { x: 0, y: 0, z: 0 }; };
const live = (room: Room) => { while (room.round.phase !== "live") room.step(); };

for (const map of MAPS) {
  const spawns = [...map.spawns.attackers, ...map.spawns.defenders];

  test(`${map.name}: every box is inside the walls`, () => {
    for (const b of map.boxes) {
      assert.ok(b.min[0] >= -map.half - 1 && b.max[0] <= map.half + 1 && b.min[2] >= -map.half - 1 && b.max[2] <= map.half + 1,
        `box ${JSON.stringify(b)}`);
    }
  });

  test(`${map.name}: every spawn is free and lands on the floor, outside the sites`, () => {
    for (const sp of spawns) {
      const s = newPlayer(sp.x, 0.5, sp.z);
      for (let i = 0; i < 60; i++) stepPlayer(s, idle, C.TICK, map.boxes);
      assert.equal(s.pos.y, 0, `spawn ${sp.x},${sp.z}`);
      assert.equal(siteAt(map, sp), null);
    }
  });

  test(`${map.name}: no sightline from any attacker spawn to any defender spawn`, () => {
    const seen: string[] = [];
    for (const a of map.spawns.attackers)
      for (const d of map.spawns.defenders) {
        const o = { x: a.x, y: C.STAND_EYE, z: a.z }, dir = { x: d.x - a.x, y: 0, z: d.z - a.z };
        if (!map.boxes.some((b) => { const h = rayBox(o, dir, b, 1); return h !== null && h.t < 1; }))
          seen.push(`(${a.x},${a.z})->(${d.x},${d.z})`);
      }
    assert.deepEqual(seen, []);
  });

  test(`${map.name}: both sites can be walked to from both spawns, and the defenders get there first`, () => {
    const g = graphOf(map);
    const reachable = new Set(g.goals);
    const length = (from: Vec3, to: Vec3) => {
      const path = findPath(g, nearestNode(g, from), nearestNode(g, to));
      assert.ok(path, `no way from ${from.x},${from.z} to ${to.x},${to.z}`);
      let d = 0;
      for (let i = 1; i < path.length; i++) d += Math.hypot(g.nodes[path[i]].x - g.nodes[path[i - 1]].x, g.nodes[path[i]].z - g.nodes[path[i - 1]].z);
      return d;
    };
    for (const sp of spawns) assert.ok(reachable.has(nearestNode(g, { ...sp, y: 0 })), `spawn ${sp.x},${sp.z} is cut off`);
    for (const site of ["A", "B"] as Site[]) {
      const spots = spotsIn(map, map.sites[site]);
      assert.ok(spots.length > 10, `site ${site} has ${spots.length} spots`);
      const centre = spots[Math.floor(spots.length / 2)];
      const atk = length({ ...map.spawns.attackers[2], y: 0 }, centre);
      const def = length({ ...map.spawns.defenders[2], y: 0 }, centre);
      assert.ok(def < atk, `${site}: defenders ${def.toFixed(0)} m, attackers ${atk.toFixed(0)} m`);
    }
  });

  test(`${map.name}: attacking bots plant the bomb, defending bots defuse it`, () => {
    const room = new Room(`pub-${map.id}`, { bots: true, map: map.id });
    const h = room.join("defender", () => {}, undefined, DEF);
    for (const b of [...room.players.values()].filter((p) => p.bot && p.team === DEF)) room.leave(b.id);
    live(room);
    let t = 0;
    while (!room.round.bomb.planted && t < 60) { hide(h); room.step(); t += C.TICK; }
    assert.ok(room.round.bomb.planted, `the attackers didn't plant within 60 s`);

    const room2 = new Room(`pub-${map.id}2`, { bots: true, map: map.id });
    const a = room2.join("attacker", () => {}, undefined, ATK);
    for (const b of [...room2.players.values()].filter((p) => p.bot && p.team === ATK)) room2.leave(b.id);
    live(room2);
    for (const site of ["A", "B"] as Site[]) {
      const spot = spotsIn(map, map.sites[site])[0];
      room2.round.bomb = { carrier: null, pos: { ...spot }, planted: true, site };
      room2.round.endsAt = room2.tick + 40 / C.TICK;
      t = 0;
      while (room2.round.phase === "live" && t < 40) { hide(a); room2.step(); t += C.TICK; }
      assert.deepEqual([room2.round.reason, site], ["Bomb defused", site], `after ${t.toFixed(1)} s`);
      while (room2.round.phase !== "live") { hide(a); room2.step(); }
    }
  });
}
