"""Plays the game in a real (headed) Chromium with the GPU: pointer lock, mouse look, trigger,
Esc, frame rate and draw calls, plus screenshots from around the map.

    py -3.14 scripts/playtest.py            # needs `npm run dev` and `npm run server:dev` running
"""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = "http://localhost:5173/"
OUT = Path("screenshots/playtest")
OUT.mkdir(parents=True, exist_ok=True)
problems = []


def check(ok, what):
    print(("  ok   " if ok else "  FAIL ") + what)
    if not ok:
        problems.append(what)


with sync_playwright() as pw:
    # Chrome throttles windows hidden behind other windows; the game loop runs on requestAnimationFrame.
    browser = pw.chromium.launch(headless=False, args=["--window-size=1600,940", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"])
    page = browser.new_page(viewport={"width": 1600, "height": 900})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto(URL)
    page.wait_for_timeout(1500)
    state = lambda: page.evaluate("__game.state()")

    gl = page.evaluate("""() => { const c = document.createElement('canvas').getContext('webgl2');
        const d = c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown'; }""")
    print("GPU:", gl)

    print("start screen & pointer lock")
    check(page.is_visible("#start"), "start menu visible before playing")
    page.click("#range")
    page.wait_for_timeout(400)
    check(state()["locked"], "clicking 'Shooting range' captures the mouse")
    check(not page.is_visible("#start"), "menu hides while playing")

    print("mouse look")
    page.mouse.move(400, 450)
    page.wait_for_timeout(100)
    before = state()
    for i in range(1, 11):
        page.mouse.move(400 + 20 * i, 450 + 4 * i)  # 200 px right, 40 px down in total
    page.wait_for_timeout(150)
    after = state()
    dyaw, dpitch = after["yaw"] - before["yaw"], after["pitch"] - before["pitch"]
    print(f"    200 px right: yaw {dyaw:+.3f} rad, 40 px down: pitch {dpitch:+.3f} rad")
    check(dyaw < -0.3, "mouse right turns right")
    check(dpitch < -0.05, "mouse down looks down")

    print("shooting with the real mouse button")
    page.evaluate("__game.look(0, 0)")
    ammo0 = state()["ammo"]
    page.mouse.down()
    page.wait_for_timeout(1000)
    page.mouse.up()
    page.wait_for_timeout(200)
    fired = ammo0 - state()["ammo"]
    print(f"    held 1 s: {fired} bullets (600 rpm -> ~10)")
    check(8 <= fired <= 11, "fire rate about 10 rounds per second")
    page.keyboard.press("KeyR")
    page.wait_for_timeout(2600)
    check(state()["ammo"] == 30, "R reloads to a full magazine")

    print("movement keys under pointer lock")
    p0 = state()["pos"]
    page.keyboard.down("KeyW"); page.wait_for_timeout(1000); page.keyboard.up("KeyW")
    p1 = state()["pos"]
    moved = ((p1["x"] - p0["x"]) ** 2 + (p1["z"] - p0["z"]) ** 2) ** 0.5
    print(f"    W for 1 s: {moved:.2f} m")
    check(4.0 < moved < 6.5, "W runs about 5 m in a second")
    page.keyboard.down("KeyC"); page.wait_for_timeout(300)
    check(state()["crouched"], "C crouches")
    page.keyboard.up("KeyC"); page.wait_for_timeout(300)
    check(not state()["crouched"], "releasing C stands up")

    print("performance while running and spraying")
    page.evaluate("__game.teleport(0, 0, 22); __game.look(0, 0)")
    page.keyboard.down("KeyW"); page.mouse.down()
    samples = []
    for _ in range(5):
        page.wait_for_timeout(1000)
        samples.append(state()["fps"])
    page.mouse.up(); page.keyboard.up("KeyW")
    s = state()
    print(f"    fps per second: {samples}, draw calls {s['drawCalls']}, triangles {s['triangles']}")
    check(min(samples) >= 55, "60 fps while running and shooting")
    check(s["drawCalls"] < 100, "under 100 draw calls")

    print("Esc releases the mouse")
    # Esc itself is handled by Chrome's UI, which synthetic key events don't reach
    page.evaluate("document.exitPointerLock()")
    page.wait_for_timeout(400)
    check(not state()["locked"] and page.is_visible("#start"), "Esc shows the menu again")

    print("screenshots around the map")
    views = {
        "t-spawn": (0, 0, 22, 0, -0.05), "mid-doors": (0, 0, -4, 0, 0), "a-site": (16, 0, -11, 0.6, 0),
        "b-site": (-14, 0, -10, -0.5, 0), "ct-spawn": (0, 0, -22, 3.14, 0), "a-long": (19, 0, 20, 0, 0),
    }
    page.evaluate("__game.start()")
    for name, (x, y, z, yaw, pitch) in views.items():
        page.evaluate(f"__game.teleport({x},{y},{z}); __game.look({yaw},{pitch})")
        page.wait_for_timeout(300)
        page.screenshot(path=str(OUT / f"{name}.png"))
    browser.close()

check(not errors, "no console errors" + (f": {errors[:3]}" if errors else ""))
print(f"\n{len(problems)} problem(s)")
sys.exit(1 if problems else 0)
