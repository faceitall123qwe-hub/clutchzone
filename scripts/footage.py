"""Gameplay footage for store previews and short clips: the dev autopilot ambushes bots and the game canvas is
recorded (no HUD, no cursor). Writes <out>.webm and <out>.json with the kill times (seconds into the video).
Needs `npm run dev` and `npm run server:dev`.

    py -3.14 scripts/footage.py marketing/raw/dock-land 1920x1080 dockyard 45 [slot:distance:head:strafe,...]
"""
import base64
import json
import sys
import time

from playwright.sync_api import sync_playwright

out, size, map_id, seconds = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4])
w, h = map(int, size.split("x"))
WEAPONS = [(0, 9, False, 1), (0, 11, False, -1), (1, 6, True, 1), (0, 8, False, 0)]  # slot, distance, aim at head, strafe
if len(sys.argv) > 5:
    WEAPONS = [(int(s), float(d), h == "1", float(r)) for s, d, h, r in (w.split(":") for w in sys.argv[5].split(","))]

with sync_playwright() as p:
    b = p.chromium.launch(headless=False, args=["--window-size=1300,800", "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--autoplay-policy=no-user-gesture-required"])
    pg = b.new_page(viewport={"width": w, "height": h})
    pg.goto(f"http://localhost:5173/?room=pub-film{int(time.time()) % 100000}")
    pg.wait_for_timeout(2000)
    pg.evaluate(f"__game.join('{map_id}')")
    pg.wait_for_function("__game.state().round && __game.state().round.phase === 'live'", timeout=30000)
    pg.evaluate("__game.god(true)")  # the bots can't end the take
    started = pg.evaluate("__game.record(30, 14)")
    kills, i, t0 = [], 0, time.time()
    kills_before = pg.evaluate("JSON.parse(localStorage.getItem('clutchzone-profile') || '{\"stats\":{\"kills\":0}}').stats.kills")
    while time.time() - t0 < seconds:
        s = pg.evaluate("__game.state()")
        if not s["alive"] or s["round"]["phase"] != "live":
            pg.wait_for_timeout(400)
            continue
        slot, dist, head, strafe = WEAPONS[i % len(WEAPONS)]
        i += 1
        pg.evaluate(f"__game.weapon({slot})")
        if not pg.evaluate(f"__game.ambush({dist}, 0.55)"):
            pg.wait_for_timeout(400)
            continue
        pg.evaluate(f"__game.auto(true, {str(head).lower()}, {strafe})")
        end = time.time() + 4
        while time.time() < end:
            k = pg.evaluate("JSON.parse(localStorage.getItem('clutchzone-profile')).stats.kills")
            if k > kills_before:
                kills.append(round((pg.evaluate("performance.now()") - started) / 1000, 2))
                kills_before = k
                break
            pg.wait_for_timeout(50)
        pg.evaluate("__game.auto(false)")
        pg.wait_for_timeout(700)
    data = pg.evaluate("__game.stopRecording()")
    open(f"{out}.webm", "wb").write(base64.b64decode(data))
    json.dump({"kills": kills, "size": [w, h], "map": map_id}, open(f"{out}.json", "w"))
    print(f"{out}.webm: {len(kills)} kills at {kills}")
    b.close()
