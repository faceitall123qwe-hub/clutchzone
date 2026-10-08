import assert from "node:assert/strict";
import { test } from "node:test";
import { challengesFor, levelOf, Progress, xpToNext } from "./profile.ts";

test("levels: 100 XP to level 2, each next level a bit more", () => {
  assert.deepEqual(levelOf(0), { level: 1, into: 0, need: 100 });
  assert.deepEqual(levelOf(100), { level: 2, into: 0, need: 140 });
  assert.equal(levelOf(xpToNext(1) + xpToNext(2) + 5).level, 3);
});

test("a kill gives XP, a headshot more, double XP while boosted, and levelling up names the unlocks", () => {
  const p = new Progress(); // no localStorage in node: a fresh profile
  const levels: [number, string[]][] = [];
  p.on({ level: (l, u) => levels.push([l, u]) });
  p.kill(false, 0);
  p.kill(true, 0);
  assert.equal(p.p.xp, 25);
  p.boost(60);
  p.kill(false, 0);
  assert.equal(p.p.xp, 45);
  p.gain(60, "test"); // 45 + 120 = 165: level 2
  assert.deepEqual(levels, [[2, ["Desert"]]]);
});

test("daily challenges: the same three for everyone on a day, done once, with their reward", () => {
  assert.deepEqual(challengesFor("2026-10-08"), challengesFor("2026-10-08"));
  assert.equal(new Set(challengesFor("2026-10-08").map((c) => c.id)).size, 3);
  const p = new Progress();
  const [first] = p.challenges();
  const done: string[] = [];
  p.on({ challenge: (c) => done.push(c.id) });
  // drive it with the event it counts
  const drive: Record<string, () => void> = {
    kills: () => p.kill(false, 0), heads: () => p.kill(true, 0), sniper: () => p.kill(false, 2), pistol: () => p.kill(false, 1),
    rounds: () => p.roundWon(), plant: () => p.planted(), defuse: () => p.defused(), match: () => p.matchEnded(false),
    life3: () => p.kill(false, 0),
  };
  for (let i = 0; i < 12; i++) drive[first.id]();
  assert.equal(done.filter((id) => id === first.id).length, 1, "completed once (a pistol kill can finish other challenges too)");
  assert.ok(p.challenges()[0].done);
});
