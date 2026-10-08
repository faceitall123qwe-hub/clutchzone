"""Store covers for CrazyGames (1920x1080, 800x1200, 800x800): a staged fight on Dockyard + the title.
Needs `npm run dev`.  py -3.14 scripts/covers.py marketing/covers"""
import json, math, sys
from playwright.sync_api import sync_playwright

def yaw_to(a, b):
    return math.atan2(-(b[0] - a[0]), -(b[1] - a[1]))

A1, D1 = (-2.5, 10.4), (2.6, 9.6)
POSES = [
    {"x": A1[0], "z": A1[1], "yaw": -1.25, "team": 0, "look": "gold.crown.stars", "pitch": 0.0, "stride": 0.4, "firing": True},
    {"x": D1[0], "z": D1[1], "yaw": 1.3, "team": 1, "look": "neon.viking.none", "pitch": 0.02, "stride": -0.45, "firing": True},
    {"x": -0.4, "z": 4.6, "yaw": 0.4, "team": 0, "look": "ice.cowboy.none", "gun": 1, "crouch": True, "pitch": 0.05},
    {"x": 1.2, "y": 2.6, "z": -8.8, "yaw": 3.0, "team": 1, "look": "forest.tophat.none", "gun": 2, "pitch": -0.12},
]
BEAMS = [[-1.6, 1.45, 10.2, 1.2, 1.4, 9.7], [2.0, 1.47, 9.5, -0.6, 1.42, 10.1]]
SHOTS = {  # viewport, camera (x, y, z, yaw, pitch), fov, title size and top, how far apart the duel is
    "landscape": ((1920, 1080), (0.1, 1.2, 12.9, 0.0, 0.05), 64, 150, 40, 1.0),
    "portrait": ((800, 1200), (0.25, 1.3, 13.0, 0.0, 0.06), 78, 108, 50, 1.0),
    "square": ((800, 800), (0.1, 1.2, 12.9, 0.0, 0.06), 70, 100, 30, 0.68),
}
out = sys.argv[1] if len(sys.argv) > 1 else "."
with sync_playwright() as p:
    b = p.chromium.launch(headless=False, args=["--window-size=1300,800", "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding", "--disable-background-timer-throttling"])
    errors = []
    for name, (size, cam, fov, tsize, ttop, spread) in SHOTS.items():
        poses = [dict(p, x=p["x"] * spread) if i < 2 else p for i, p in enumerate(POSES)]
        beams = [[b[0] * spread, b[1], b[2], b[3] * spread, b[4], b[5]] for b in BEAMS]
        if name == "portrait":  # a tall frame: the duel goes into the depth instead of across
            a, d = (-0.75, 11.0), (1.3, 6.2)
            poses = [dict(POSES[0], x=a[0], z=a[1], yaw=yaw_to(a, d) + 0.35), dict(POSES[1], x=d[0], z=d[1], yaw=yaw_to(d, a) - 0.3)] + POSES[2:]
            beams = [[-0.45, 1.45, 10.2, 1.15, 1.42, 6.9], [1.05, 1.47, 6.9, -0.4, 1.45, 9.8]]
        pg = b.new_page(viewport={"width": size[0], "height": size[1]})
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:5173/")
        pg.wait_for_timeout(2500)
        pg.evaluate("__game.map('dockyard')")
        pg.evaluate(f"__game.stage({json.dumps(poses)}, {json.dumps(beams)})")
        pg.evaluate(f"__game.clean({fov}); __game.camera({','.join(map(str, cam))}); __game.title({tsize}, {ttop})")
        pg.evaluate("document.fonts.ready")
        pg.wait_for_timeout(1200)
        pg.screenshot(path=f"{out}/cover-{name}.png")
        pg.close()
    print("errors", errors)
    b.close()
