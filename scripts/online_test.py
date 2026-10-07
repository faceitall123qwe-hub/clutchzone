"""Two browsers in one room: they see each other, a headshot kills, the victim respawns, movement
replicates. Needs `npm run dev` and `npm run server:dev` (dev commands allow teleporting).

    py -3.14 scripts/online_test.py
"""
import math
import os
import random
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = f"{os.environ.get('GAME_URL', 'http://localhost:5173')}/?room=e2e{random.randint(1000, 9999)}"
OUT = Path("screenshots/online")
OUT.mkdir(parents=True, exist_ok=True)
problems = []


def check(ok, what):
    print(("  ok   " if ok else "  FAIL ") + what)
    if not ok:
        problems.append(what)


def wait_for(fn, timeout=8.0):
    end = time.time() + timeout
    while time.time() < end:
        if fn():
            return True
        time.sleep(0.1)
    return False


with sync_playwright() as pw:
    # Alice gets a real window on the GPU so her frame rate (and input latency) is realistic;
    # Bob runs headless with software rendering.
    # Chrome throttles windows hidden behind other windows; the game loop runs on requestAnimationFrame.
    gpu = pw.chromium.launch(headless=False, args=["--window-size=980,600", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"])
    soft = pw.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    errors = []

    def player(name, browser):
        page = browser.new_page(viewport={"width": 960, "height": 540})
        page.on("pageerror", lambda e: errors.append(f"{name}: {e}"))
        page.goto(URL)
        page.wait_for_timeout(800)
        page.fill("#name", name)
        page.evaluate("__game.join()")
        return page

    alice, bob = player("Alice", gpu), player("Bob", soft)
    st = lambda p: p.evaluate("__game.state()")
    # a round starts with a freeze time: nobody moves or shoots until it's live
    live = lambda: wait_for(lambda: (st(alice)["round"] or {}).get("phase") == "live", timeout=12)

    print("joining")
    check(wait_for(lambda: any(o["name"] == "Bob" for o in st(alice)["others"])), "Alice sees Bob")
    check(wait_for(lambda: any(o["name"] == "Alice" for o in st(bob)["others"])), "Bob sees Alice")
    time.sleep(2.5)
    pend = []
    for _ in range(20):
        pend.append(st(alice)["pending"])
        time.sleep(0.05)
    print(f"    ping: Alice {st(alice)['rtt']} ms, unacknowledged commands {pend}")
    # Informational only: with browsers, servers and Vite on one laptop this swings with CPU load.
    # Server latency is measured without browsers by scripts/loadtest.ts.
    print(f"    mean {sum(pend) / len(pend):.1f} ticks in flight")

    print("headshot")
    check(live(), "the round goes live after the freeze time")
    bob.evaluate("__game.teleport(0, 0, 0); __game.look(0, 0)")
    alice.evaluate(f"__game.teleport(0, 0, 10); __game.look(0, {math.atan2(1.64 - 1.62, 10)})")
    check(wait_for(lambda: any(abs(o["z"]) < 0.2 and abs(o["x"]) < 0.2 for o in st(alice)["others"])),
          "Alice sees Bob at his new position")
    alice.wait_for_timeout(500)
    alice.screenshot(path=str(OUT / "alice-aim.png"))
    alice.evaluate("__game.fire(1)")
    check(wait_for(lambda: not st(bob)["alive"]), "Bob dies from one headshot")
    feed_ok = wait_for(lambda: "Alice" in alice.inner_text("#feed") and "Bob" in alice.inner_text("#feed"))
    check(feed_ok, "kill feed shows Alice → Bob" + ("" if feed_ok else f" (feed: {alice.inner_text('#feed')!r})"))
    alice.screenshot(path=str(OUT / "alice-kill.png"))
    bob.screenshot(path=str(OUT / "bob-dead.png"))

    print("respawn")
    check(wait_for(lambda: st(bob)["alive"] and st(bob)["hp"] == 100, timeout=8), "Bob plays again next round with 100 hp")

    print("movement replicates")
    live()
    time.sleep(0.5)
    before = next(o for o in st(alice)["others"] if o["name"] == "Bob")
    bob.keyboard.down("KeyW")
    bob.wait_for_timeout(1500)
    bob.keyboard.up("KeyW")
    bob.wait_for_timeout(600)
    after = next(o for o in st(alice)["others"] if o["name"] == "Bob")
    mine = st(bob)["pos"]
    moved = math.hypot(after["x"] - before["x"], after["z"] - before["z"])
    gap = math.hypot(after["x"] - mine["x"], after["z"] - mine["z"])
    print(f"    Alice saw Bob move {moved:.2f} m; Bob's own position differs from Alice's view by {gap:.2f} m")
    check(moved > 1.0, "Alice sees Bob running")
    check(gap < 0.3, "after he stops, both agree where Bob is")

    print("scoreboard")
    alice.keyboard.down("Tab")
    alice.wait_for_timeout(200)
    board = alice.inner_text("#board")
    alice.keyboard.up("Tab")
    check("Alice" in board and "Bob" in board, "Tab shows both players")

    gpu.close()
    soft.close()

check(not errors, "no page errors" + (f": {errors[:3]}" if errors else ""))
print(f"\n{len(problems)} problem(s)")
sys.exit(1 if problems else 0)
