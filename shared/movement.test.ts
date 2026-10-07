import assert from "node:assert/strict";
import { test } from "node:test";
import type { Box } from "./collision.ts";
import { rayBox } from "./collision.ts";
import * as C from "./constants.ts";
import { MAP, SPAWNS } from "./map.ts";
import { newPlayer, stepPlayer, type MoveInput, type PlayerState } from "./movement.ts";

const FLOOR: Box = { min: [-50, -1, -50], max: [50, 0, 50] };
const idle: MoveInput = { forward: 0, right: 0, yaw: 0, jump: false, crouch: false, walk: false };

function run(s: PlayerState, cmd: Partial<MoveInput>, seconds: number, boxes: Box[]) {
  for (let i = 0; i < Math.round(seconds / C.TICK); i++) stepPlayer(s, { ...idle, ...cmd }, C.TICK, boxes);
}

test("stands still on the floor", () => {
  const s = newPlayer(0, 0, 0);
  run(s, {}, 2, [FLOOR]);
  assert.equal(s.pos.y, 0);
  assert.ok(s.onGround);
});

test("falls and lands", () => {
  const s = newPlayer(0, 3, 0);
  run(s, {}, 1.5, [FLOOR]);
  assert.equal(s.pos.y, 0);
  assert.ok(s.onGround);
});

test("ground speed reaches about 250 u/s and no more", () => {
  const s = newPlayer();
  run(s, {}, 0.1, [FLOOR]);
  run(s, { forward: 1 }, 2, [FLOOR]);
  const speed = Math.hypot(s.vel.x, s.vel.z);
  assert.ok(speed > C.MAX_SPEED * 0.97 && speed <= C.MAX_SPEED + 1e-6, `speed ${speed}`);
  assert.ok(s.pos.z < -10, "yaw 0 moves towards -Z");
});

test("friction stops the player", () => {
  const s = newPlayer();
  run(s, { forward: 1 }, 1, [FLOOR]);
  run(s, {}, 0.6, [FLOOR]);
  assert.equal(Math.hypot(s.vel.x, s.vel.z), 0);
});

test("a wall stops the player at its face", () => {
  const wall: Box = { min: [-5, 0, -3], max: [5, 4, -2] };
  const s = newPlayer();
  run(s, { forward: 1 }, 2, [FLOOR, wall]);
  assert.ok(Math.abs(s.pos.z - (-2 + C.PLAYER_RADIUS)) < 1e-9, `z ${s.pos.z}`);
});

test("jump height is about 1.15 m and you land again", () => {
  const s = newPlayer();
  run(s, {}, 0.1, [FLOOR]);
  let peak = 0;
  stepPlayer(s, { ...idle, jump: true }, C.TICK, [FLOOR]);
  for (let i = 0; i < 120; i++) {
    stepPlayer(s, { ...idle, jump: true }, C.TICK, [FLOOR]);
    peak = Math.max(peak, s.pos.y);
  }
  assert.ok(peak > 1.05 && peak < 1.2, `peak ${peak}`);
  assert.ok(s.onGround);
  const before = s.pos.y;
  run(s, { jump: true }, 0.5, [FLOOR]);
  assert.equal(s.pos.y, before, "holding jump does not bunnyhop");
});

test("walks up a step but not a 1 m crate; jumps onto the crate", () => {
  const step: Box = { min: [-2, 0, -3], max: [2, 0.3, -2] };
  const s = newPlayer();
  run(s, { forward: 1 }, 1, [FLOOR, step]);
  assert.ok(s.pos.z < -2.5 && s.pos.y >= 0, `stepped up, z ${s.pos.z} y ${s.pos.y}`);

  const crate: Box = { min: [-2, 0, -8], max: [2, 1, -2] };
  const b = newPlayer();
  run(b, { forward: 1 }, 1, [FLOOR, crate]);
  assert.ok(b.pos.z > -2, "blocked by crate");
  run(b, { forward: 1, jump: true }, 1, [FLOOR, crate]);
  assert.ok(b.pos.y === 1 && b.pos.z < -2, `on crate: y ${b.pos.y} z ${b.pos.z}`);
});

test("crouching is slower and can't stand up under a low ceiling", () => {
  const s = newPlayer();
  run(s, { forward: 1, crouch: true }, 2, [FLOOR]);
  assert.ok(Math.hypot(s.vel.x, s.vel.z) <= C.MAX_SPEED * C.CROUCH_FACTOR + 1e-6);
  const ceiling: Box = { min: [-5, 1.5, -5], max: [5, 2, 5] };
  const t = newPlayer();
  run(t, { crouch: true }, 0.2, [FLOOR]);
  run(t, {}, 0.2, [FLOOR, ceiling]);
  assert.ok(t.crouched);
});

test("ray hits the face it enters with the right normal", () => {
  const b: Box = { min: [-1, 0, -6], max: [1, 2, -5] };
  const hit = rayBox({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, b);
  assert.deepEqual(hit, { t: 5, normal: [0, 0, 1] });
  assert.equal(rayBox({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, b), null);
});

test("every spawn is free and lands on the floor", () => {
  for (const sp of [...SPAWNS.attackers, ...SPAWNS.defenders]) {
    const s = newPlayer(sp.x, 0.5, sp.z);
    run(s, {}, 1, MAP);
    assert.equal(s.pos.y, 0, `spawn ${sp.x},${sp.z}`);
  }
});

test("the A stairs lead onto the 1.5 m platform", () => {
  const s = newPlayer(18, 0, -13);
  run(s, { forward: 1 }, 1, MAP);
  assert.equal(s.pos.y, 1.5, `y ${s.pos.y}`);
});

test("walking down the A stairs keeps the player grounded", () => {
  const s = newPlayer(18, 1.5, -18);
  run(s, {}, 0.2, MAP);
  let air = 0;
  for (let i = 0; i < 60 && s.pos.z < -13.5; i++) {
    stepPlayer(s, { ...idle, forward: -1 }, C.TICK, MAP);
    if (!s.onGround) air++;
  }
  assert.equal(air, 0);
  assert.equal(s.pos.y, 0);
});

test("walking off a 1 m crate is a fall, not a snap", () => {
  const crate: Box = { min: [-2, 0, -2], max: [2, 1, 2] };
  const s = newPlayer(0, 1, 0);
  run(s, {}, 0.2, [FLOOR, crate]);
  let airborne = false;
  for (let i = 0; i < 60; i++) {
    stepPlayer(s, { ...idle, forward: 1 }, C.TICK, [FLOOR, crate]);
    if (!s.onGround) airborne = true;
  }
  assert.ok(airborne);
  assert.equal(s.pos.y, 0);
});

test("chained strafe-jumps can't exceed the bunnyhop cap at take-off", () => {
  const s = newPlayer();
  run(s, {}, 0.1, [FLOOR]);
  s.vel.x = 15; // as if air strafing had built up a lot of speed
  s.onGround = true;
  stepPlayer(s, { ...idle, jump: true }, C.TICK, [FLOOR]);
  assert.ok(Math.hypot(s.vel.x, s.vel.z) <= C.MAX_SPEED * C.BHOP_CAP + 1e-9);
});

test("no sightline from any attacker spawn to any defender spawn", () => {
  const eye = C.STAND_EYE;
  const seen: string[] = [];
  for (const a of SPAWNS.attackers)
    for (const d of SPAWNS.defenders) {
      const o = { x: a.x, y: eye, z: a.z };
      const dir = { x: d.x - a.x, y: 0, z: d.z - a.z }; // t = 1 at the other spawn
      const blocked = MAP.some((b) => {
        const h = rayBox(o, dir, b, 1);
        return h !== null && h.t < 1;
      });
      if (!blocked) seen.push(`(${a.x},${a.z})→(${d.x},${d.z})`);
    }
  assert.deepEqual(seen, []);
});
