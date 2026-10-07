"""Opens the game in headless Chromium, optionally holds keys, saves a screenshot and prints
console errors. Used to check changes without a human looking at the screen.

    py -3.14 scripts/shot.py                          # http://localhost:5173, screenshots/shot.png
    py -3.14 scripts/shot.py --keys KeyW:1500,KeyD:800 --out screenshots/move.png
    py -3.14 scripts/shot.py --eval "__game.start(); __game.fire(30)" --after "JSON.stringify(__game.state())"
"""
import argparse
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

p = argparse.ArgumentParser()
p.add_argument("--url", default="http://localhost:5173/")
p.add_argument("--out", default="screenshots/shot.png")
p.add_argument("--keys", default="", help="comma-separated Code:milliseconds to hold, in order")
p.add_argument("--wait", type=int, default=1500, help="ms to let the scene load before input")
p.add_argument("--size", default="1280x720")
p.add_argument("--eval", default="", help="JS to run before the keys (e.g. __game.start())")
p.add_argument("--after", default="", help="JS to run after the keys; its JSON result is printed")
a = p.parse_args()

w, h = map(int, a.size.split("x"))
errors = []
with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": w, "height": h})
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(a.url)
    page.wait_for_timeout(a.wait)
    if a.eval:
        page.evaluate(a.eval)
    for item in filter(None, a.keys.split(",")):
        code, ms = item.split(":")
        page.keyboard.down(code)
        page.wait_for_timeout(int(ms))
        page.keyboard.up(code)
    page.wait_for_timeout(300)
    if a.after:
        print("after:", page.evaluate(a.after))
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=a.out)
    browser.close()

print(f"screenshot: {a.out}")
if errors:
    print("console errors:", *errors, sep="\n  ")
    sys.exit(1)
print("console errors: none")
